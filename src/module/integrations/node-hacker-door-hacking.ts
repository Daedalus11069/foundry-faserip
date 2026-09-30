import { Rank, RollResult } from "../enums";
import type { FaseripActor } from "../documents";
import { rollFaseripHackCheck, meetsRequiredColor } from "./holosuite-roll-adapter";
import { attemptFaseripNodeHack, registerCompletionAction } from "./node-hacker-hacking";
import { isDoorHackProof, isDoorUnbreakable } from "./door-hack-config";
import { requestSetDoorLockState } from "../socket/faserip-socket";

declare const game: any;
declare const ui: any;
declare const CONST: any;
declare const canvas: any;

const LOCKNKEY_MODULE_ID = "LocknKey";

/** Mirrors getHoloSuiteApi()/isHoloSuiteActive() in holosuite-hacking.ts. */
export function getLocknKeyApi(): any | null {
  const module = game.modules?.get?.(LOCKNKEY_MODULE_ID);
  return module?.active ? module.api : null;
}

export function isLocknKeyActive(): boolean {
  return getLocknKeyApi() !== null;
}

/**
 * True if the LocknKey module itself is enabled, regardless of whether its
 * `api` has been set yet. Modules commonly assign `module.api` from inside
 * their own `Hooks.once("ready")` callback, and Foundry gives no ordering
 * guarantee between different modules' ready hooks - so gating a one-time
 * registration (like the door overlay's libWrapper patch) on
 * isLocknKeyActive() at ready-time can lose the race and silently never
 * register anything if our ready hook happens to run first. This checks
 * only module activation for that gate; api lookups themselves stay lazy
 * (via getLocknKeyApi(), called at click time) so they still resolve
 * correctly once LocknKey has actually set it.
 */
export function isLocknKeyModuleActive(): boolean {
  return game.modules?.get?.(LOCKNKEY_MODULE_ID)?.active === true;
}

/**
 * Re-establishes `canvas.walls.hover` on the target wall immediately before
 * a call into LocknKey's own player-facing API - only still needed for the
 * plain, un-rolled LocknKey pick fallback (see locknkey-door-overlay.ts,
 * used when HoloSuite isn't active) where LocknKey's own roll is the only
 * check at all. Confirmed directly from LocknKey's source
 * (LnKutils.hoveredWall() reads `canvas.walls.hover`, a plain WallsLayer
 * property set by core's PlaceableObject._onHoverIn/_onHoverOut) - our menu
 * is a separate HTML overlay, so moving the mouse onto one of its buttons
 * clears that hover state via the icon's real mouseout before the button's
 * click handler runs.
 */
export function refreshLocknKeyHover(wall: any): void {
  try {
    if (canvas?.walls) canvas.walls.hover = wall;
  } catch (err) {
    console.warn("faserip | Failed to refresh LocknKey's hovered-door state", err);
  }
}

/**
 * Unlocks a door once a pick/hack succeeds, by setting core's own Wall
 * `ds` (door state) field directly instead of calling into LocknKey's
 * PickHoveredLock()/TogglehoveredLockGM() at all.
 *
 * Confirmed directly against LocknKey's source (KeyManager.onatemptedLockuse
 * -> onatemptedcircumventLock): its player-facing pick/break functions
 * don't apply a caller-determined success - they always run their OWN
 * internal dice roll against the lock's configured DC, completely ignoring
 * whatever check this system already resolved, and the whole GM-relay
 * request chain silently no-ops if there's no active GM client. That
 * roll is also not adapted to FASERIP at all (it defaults to a flat 0
 * modifier), so it was failing unconditionally regardless of what this
 * system's own Strength/Reasoning check rolled.
 *
 * LocknKey's own ToggleDoorLock does nothing more than flip this same core
 * `ds` field (LOCKED <-> CLOSED) once its roll succeeds, so setting it here
 * - now that our own check has already determined success - reaches the
 * same end state without going through LocknKey's incompatible pipeline.
 * Routed through requestSetDoorLockState so it works from a non-GM client
 * too (Wall documents are normally GM-only to update).
 */
async function unlockHackedDoor(wallUuid: string): Promise<void> {
  const ok = await requestSetDoorLockState(
    wallUuid,
    CONST.WALL_DOOR_STATES.CLOSED
  );
  // Temporary diagnostic - remove once the refresh-completion-action path is confirmed
  // working. Pins down whether this even ran and, if so, what the GM-relay call reported.
  console.log(`faserip | unlockHackedDoor(${wallUuid}) -> requestSetDoorLockState ok=${ok}`);
  if (!ok) {
    ui.notifications?.warn?.(
      "Hack succeeded, but the door couldn't be unlocked automatically - unlock it manually."
    );
  }
}

// Registered once, unconditionally, at module load - so the handler is already in place
// before FASERIP's "nodeHacker.ready" listener re-dispatches any door-unlock action that
// survived a refresh (see registerCompletionAction's own doc comment in node-hacker-hacking.ts).
registerCompletionAction("unlockDoor", async (payload: { wallUuid: string }) => {
  await unlockHackedDoor(payload.wallUuid);
});

export interface AttemptDoorHackParams {
  actor: FaseripActor;
  wall: any;
  attributeName: string;
  attributeRank: Rank;
  chartShift?: number;
  talentNames?: string[];
  label?: string;
  requiredColor?: RollResult;
  /** Alternative to requiredColor - see AttemptFaseripNodeHackParams.requiredDC
   * in node-hacker-hacking.ts. */
  requiredDC?: number;
  /** Use a GM-designed Node Designer graph for this door instead of one
   * generated fresh off the opening roll - see AttemptFaseripNodeHackParams.graphName. */
  graphName?: string;
}

/**
 * Rolls the given FASERIP attribute/talent check and launches a Node Hacker
 * session against a door instead of an actor, mirroring
 * attemptFaseripNodeHack in node-hacker-hacking.ts. This is the single "Pick
 * Lock" action for a door - picking and hacking aren't offered as separate
 * choices, so a plain, non-electronic LocknKey pick only happens as a
 * fallback (see locknkey-door-overlay.ts) when Node Hacker isn't active or
 * the door is hack-proof. On success here, the door is unlocked via
 * LocknKey.
 */
export async function attemptDoorHack(params: AttemptDoorHackParams): Promise<void> {
  if (isDoorHackProof(params.wall)) {
    ui.notifications?.warn?.("This door is hack-proof.");
    return;
  }

  // Captured now, not read from params.wall inside onSuccess below - a hack session can run
  // for several turns before it resolves, and by then the canvas may have redrawn (scene
  // navigation, a token update, anything that re-renders WallsLayer), destroying and
  // recreating the Wall's PlaceableObject and leaving this closure holding a stale
  // `wall.document` reference (undefined uuid). A wallUuid string has no such lifecycle -
  // requestSetDoorLockState re-resolves the live document from it via fromUuid() regardless
  // of how long has passed or how many times the canvas has redrawn since.
  const document = params.wall?.document ?? params.wall;
  const wallUuid: string | undefined = document?.uuid;
  if (!wallUuid) {
    ui.notifications?.warn?.("Could not identify this door - it may need to be re-selected.");
    return;
  }

  await attemptFaseripNodeHack({
    actor: params.actor,
    attributeName: params.attributeName,
    attributeRank: params.attributeRank,
    chartShift: params.chartShift,
    talentNames: params.talentNames,
    requiredColor: params.requiredColor,
    requiredDC: params.requiredDC,
    graphName: params.graphName,
    label: params.label ?? `${params.actor.name} Picking Lock`,
    completionAction: { kind: "unlockDoor", payload: { wallUuid } }
  });
}

export interface AttemptBreakDoorLockParams {
  actor: FaseripActor;
  wall: any;
  attributeRank: Rank;
  chartShift?: number;
  talentNames?: string[];
  /** Display label for the attribute being rolled, e.g. "Strength" or "Psyche" - this is a
   * brute-force check either way (raw physical force, or forcing the lock open with
   * magic/psionics instead), not a hacking attempt, so it never touches isDoorHackProof or
   * launches a minigame regardless of which attribute backs it. Defaults to "Strength" to
   * match this function's original, physical-only behavior. */
  attributeLabel?: string;
}

/**
 * Rolls the acting actor's chosen attribute (Strength for a physical break, Psyche for
 * forcing the lock via magic/psionics - see attributeLabel) and only calls LocknKey's
 * BreakHoveredLock() on a Green-or-better result - breaking a lock is a brute-force action
 * either way, unrelated to hack-proof/HoloSuite at all, so this doesn't check
 * isDoorHackProof and doesn't launch any minigame. A White result fails outright with no
 * side effect on the lock.
 */
export async function attemptBreakDoorLock(
  params: AttemptBreakDoorLockParams
): Promise<void> {
  if (isDoorUnbreakable(params.wall)) {
    ui.notifications?.warn?.("This door's lock is unbreakable.");
    return;
  }

  const api = getLocknKeyApi();
  if (!api) return;

  // Captured now, not after the roll below - the roll can pause on a karma-spend dialog for
  // as long as the player deliberates, and by then the canvas may have redrawn (see
  // attemptDoorHack's identical comment on this same failure mode).
  const document = params.wall?.document ?? params.wall;
  const wallUuid: string | undefined = document?.uuid;
  if (!wallUuid) return;

  const attributeLabel = params.attributeLabel ?? "Strength";
  const faseripRoll = await rollFaseripHackCheck({
    actor: params.actor,
    attributeName: `${params.actor.name} Breaking Lock (${attributeLabel})`,
    attributeRank: params.attributeRank,
    chartShift: params.chartShift,
    talentNames: params.talentNames,
    requiredColor: RollResult.Green
  });

  if (!meetsRequiredColor(faseripRoll.result, RollResult.Green)) {
    ui.notifications?.info?.("The lock holds.");
    return;
  }

  // Bypasses LocknKey's own BreakHoveredLock() entirely - see
  // unlockHackedDoor's doc comment for why (it runs its own incompatible
  // internal roll and ignores the check just resolved above).
  const ok = await requestSetDoorLockState(
    wallUuid,
    CONST.WALL_DOOR_STATES.CLOSED
  );
  if (!ok) {
    ui.notifications?.warn?.(
      "The check succeeded, but the lock couldn't be broken automatically."
    );
  }
}
