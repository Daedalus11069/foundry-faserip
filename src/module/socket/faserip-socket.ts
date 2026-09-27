/**
 * FASERIP Socket System
 * Handles multiplayer combat interactions - defense prompts, damage application, etc.
 */

import type { FaseripActor } from "../documents";
import DefenseResponseModal from "../applications/DefenseResponseModal.vue";
import CounterAttackModal from "../applications/CounterAttackModal.vue";
import { VueDialog } from "../applications/vue-dialog";
import { formatRankDisplay } from "../enums";
import type { BaseActorSystemData } from "../types/actor-system";
import { applyDamageToActor } from "../utils/damage-application";
import { getActiveLifeLinkRedirect } from "../utils/power-aura";
import type { ArmorPiercingResult } from "../utils/armor-piercing";
import { getEffectiveAttributeData } from "../utils/stat-debuffs";
import { applyTemporaryModifier } from "../utils/temp-effects";
import { PvpDefenderView } from "../applications/pvp-defender-view";
import {
  dispatchPvpAction,
  getPvpApp,
  type PvpSnapshot,
  type PvpDefenderAction,
  type FaseripPvpConfig
} from "../integrations/holosuite-pvp-intrusion";

/**
 * Socket module instance
 */
let socket: any = null;

interface ApplyStatDebuffData {
  targetActorId: string;
  targetTokenId?: string;
  attribute: string;
  chartShift: number;
  roundsRemaining: number;
  sourcePowerId?: string;
  sourcePowerName?: string;
  durationFormula?: string;
  combatId?: string | null;
}

interface ApplyDamageBuffData {
  targetActorId: string;
  targetTokenId?: string;
  chartShift: number;
  roundsRemaining: number;
  sourcePowerId?: string;
  sourcePowerName?: string;
  sourceWeaponId?: string;
  sourceWeaponName?: string;
  durationFormula?: string;
  combatId?: string | null;
}

interface ApplyStatusEffectData {
  targetActorId: string;
  targetTokenId?: string;
  statusId: string;
  roundsRemaining: number;
  indefinite?: boolean;
  sourcePowerId?: string;
  sourcePowerName?: string;
  sourceWeaponId?: string;
  sourceWeaponName?: string;
  durationFormula?: string;
  combatId?: string | null;
}

interface ApplyDotData {
  targetActorId: string;
  targetTokenId?: string;
  dotRank: string;
  /** Fixed per-tick damage, when the triggering roll's actual damage should be used instead of RANK_VALUES[dotRank]. */
  dotDamage?: number;
  armorPiercing?: string | null;
  roundsRemaining: number;
  indefinite?: boolean;
  casterActorId?: string | null;
  sourcePowerId?: string;
  sourcePowerName?: string;
  sourceWeaponId?: string;
  sourceWeaponName?: string;
  durationFormula?: string;
  combatId?: string | null;
}

/**
 * Data structure for defense prompt sent to defender
 */
interface DefensePromptData {
  targetActorId: string;
  targetTokenId?: string; // For unlinked tokens
  attackerName: string;
  attackRoll: number; // The attacker's roll result
  attackType: "melee" | "ranged" | "thrown" | "psyche" | "strength"; // Determines which attribute defender uses
  attackAttribute: string; // Name of attacking attribute (Fighting, Agility, Psyche)
  attackResult?: string; // FASERIP result (Red, Yellow, Green, White, etc.)
  attackRank?: string; // Attacker's rank
  powerName?: string; // If attacking with a power
  promptId?: string; // Unique ID for tracking race conditions in multi-GM scenarios
  comboIndex?: number; // Current attack number in combo (1-based)
  comboTotal?: number; // Total number of attacks in combo
}

/**
 * Response from defender after choosing defense
 */
interface DefenseResponse {
  defenseType: "defend" | "takeHit";
  defenseRoll?: number;
  defenseAttribute?: string; // Which attribute they defended with
  defended?: boolean;
  _rollJSON?: any; // Serialized roll data
  _defenseSuccess?: boolean;
  _resultText?: string; // Result text (e.g., "Success", "Critical")
  _resultClass?: string; // CSS class for result (e.g., "green", "red")
  _targetActorId?: string;
  _respondingUserId?: string;
  _isUltimateBotch?: boolean; // True if defense roll was 1 (catastrophic failure)
  _isBotch?: boolean; // True if defense roll was 2-5 (regular botch)
}

/**
 * Map to track active defense prompts (for cancellation in multi-GM scenarios)
 */
const activeDefensePrompts = new Map<
  string,
  { dialog: any; resolve: (value: DefenseResponse | null) => void }
>();

/**
 * Data structure for counter-attack prompt sent to defender
 */
interface CounterAttackPromptData {
  defenderActorId: string;
  defenderTokenId?: string;
  defenderName: string;
  attackerName: string;
  defenseRoll: number;
  attackRoll: number;
  // The actual color result each roll landed on, from that roller's own
  // rank chart - NOT derivable from the raw roll numbers, since the two
  // rolls are checked against different (and differently-ranked) charts.
  defenseResultColor: "white" | "green" | "yellow" | "red";
  attackResultColor: "white" | "green" | "yellow" | "red";
  counterType: "ultimate-vs-ultimate" | "ultimate-vs-normal" | "red-vs-normal";
  promptId?: string;
}

/**
 * Response from defender after choosing whether to counter
 */
interface CounterAttackResponse {
  counterAttack: boolean;
  _respondingUserId?: string;
}

/**
 * Map to track active counter-attack prompts
 */
const activeCounterPrompts = new Map<
  string,
  { dialog: any; resolve: (value: CounterAttackResponse | null) => void }
>();

/**
 * Initialize the socket system
 */
export function initializeSocket(): void {
  // @ts-expect-error - Foundry game global
  if (!game.ready) {
    console.warn("FASERIP Socket | Game not ready, deferring initialization");
    Hooks.once("ready", initializeSocket);
    return;
  }

  // @ts-expect-error - Foundry game.modules global
  if (!game.modules.get("socketlib")?.active) {
    console.warn(
      "FASERIP Socket | socketlib module is not active. Defense prompts may not work correctly in multiplayer."
    );
    return;
  }

  // @ts-expect-error - socketlib is a Foundry module
  socket = window.socketlib.registerSystem("faserip");

  // Register handler functions that can be called remotely
  socket.register("promptDefense", handleDefensePrompt);
  socket.register("cancelDefensePrompt", handleCancelDefensePrompt);
  socket.register("promptCounterAttack", handleCounterAttackPrompt);
  socket.register("cancelCounterAttackPrompt", handleCancelCounterAttackPrompt);
  socket.register("applyDamage", handleApplyDamage);
  socket.register("applyLifeLinkRedirect", handleApplyLifeLinkRedirect);
  socket.register("applyStatDebuff", handleApplyStatDebuff);
  socket.register("applyDamageBuff", handleApplyDamageBuff);
  socket.register("applyStatusEffect", handleApplyStatusEffect);
  socket.register("applyDot", handleApplyDot);
  socket.register("removeDot", handleRemoveDot);
  socket.register("setDoorLockState", handleSetDoorLockState);
  socket.register("closeHackSpectator", handleCloseHackSpectator);
  socket.register("promptManagedHackMode", handlePromptManagedHackMode);
  socket.register("promptNodeHackMode", handlePromptNodeHackMode);
  socket.register("openPvpDefenderView", handleOpenPvpDefenderView);
  socket.register("pvpStateUpdate", handlePvpStateUpdate);
  socket.register("pvpDefenderAction", handlePvpDefenderAction);
}

/** Open PvP defender views on THIS client, keyed by session id - at most
 * one per active managed intrusion this client is defending. */
const pvpDefenderViews = new Map<string, PvpDefenderView>();

/**
 * Opens the defender's cross-client view (see PvpDefenderView) on the
 * defending player's own client, the moment a managed PvP intrusion starts.
 * Runs on the defender's client via socketlib - the attacker's client never
 * touches this view directly, only ever sends it fresh snapshots.
 */
function handleOpenPvpDefenderView(data: {
  pvp: FaseripPvpConfig;
  snapshot: PvpSnapshot;
}): void {
  const existing = pvpDefenderViews.get(data.snapshot.sessionId);
  if (existing) {
    existing.applySnapshot(data.snapshot);
    existing.render(true);
    return;
  }

  const view = new PvpDefenderView(data.snapshot, (action: PvpDefenderAction) => {
    if (!socket) return;
    socket.executeAsUser("pvpDefenderAction", data.pvp.attackerUserId, {
      sessionId: data.snapshot.sessionId,
      action
    });
  });
  pvpDefenderViews.set(data.snapshot.sessionId, view);
  void view.render(true);
}

/**
 * Pushes a fresh snapshot into an already-open defender view (or opens one,
 * defensively, if this client somehow missed the original open message -
 * e.g. it connected after the hack started). Also closes the view a few
 * seconds after the run ends, once the player has had a chance to read the
 * result.
 */
function handlePvpStateUpdate(snapshot: PvpSnapshot): void {
  const view = pvpDefenderViews.get(snapshot.sessionId);
  if (!view) return; // No open() message ever arrived for this session on this client - nothing to update.
  view.applySnapshot(snapshot);
  if (snapshot.ended) {
    globalThis.setTimeout(() => {
      view.close?.();
      pvpDefenderViews.delete(snapshot.sessionId);
    }, 6000);
  }
}

/**
 * Runs on the ATTACKER's client (the one actually holding the live,
 * authoritative Node Intrusion app instance) - applies a defender action
 * requested remotely from their own view, via the same move/recapture/scan
 * logic used when a GM plays both sides from one instance (see
 * holosuite-node-intrusion-patch.ts's registerPvpActionHandler call). The
 * resulting fresh snapshot is broadcast back so the defender's view reflects
 * the outcome (a failed recapture, an updated turn, etc).
 */
async function handlePvpDefenderAction(data: {
  sessionId: string;
  action: PvpDefenderAction;
}): Promise<void> {
  // Resolve the pvp config from the live app itself (registered under this
  // same session id) rather than trusting anything the remote client sent,
  // since dispatchPvpAction only hands back a plain snapshot.
  const app = getPvpApp(data.sessionId);
  const pvp: FaseripPvpConfig | undefined = app?.__faseripHackContext?.pvp;
  const snapshot = await dispatchPvpAction(data.sessionId, data.action);
  if (!snapshot || !pvp) return;
  broadcastPvpState(pvp, snapshot);
}

/**
 * Opens the defender's cross-client view for the first time, right after a
 * managed PvP intrusion's node graph is generated. No-op if there's no
 * connected defender user distinct from the attacker (the GM-plays-both-
 * sides case keeps using the single attacker-side instance, as before).
 */
export function openPvpDefenderView(
  pvp: FaseripPvpConfig,
  snapshot: PvpSnapshot
): void {
  if (!pvp.defenderUserId || pvp.defenderUserId === pvp.attackerUserId) return;
  if (!socket) {
    // requestManagedHackMode should already have refused to force managed
    // mode without a working transport - reaching here with a distinct
    // defenderUserId anyway means something upstream changed, so surface it
    // loudly instead of silently leaving the defender with no window at all
    // (again).
    console.warn(
      "faserip | Cannot open the PvP defender view - socketlib is not active."
    );
    return;
  }
  socket.executeAsUser("openPvpDefenderView", pvp.defenderUserId, { pvp, snapshot });
}

/** Pushes a fresh PvpSnapshot to the defender's cross-client view, if one is
 * open for this session (no-op otherwise, e.g. GM-plays-both-sides mode). */
export function broadcastPvpState(
  pvp: { defenderUserId: string | null },
  snapshot: PvpSnapshot
): void {
  if (!socket || !pvp.defenderUserId) return;
  socket.executeAsUser("pvpStateUpdate", pvp.defenderUserId, snapshot);
}

interface ManagedHackModePromptData {
  targetActorId: string;
  targetTokenId?: string;
  attackerName: string;
  /** True when the target is player-owned - managed mode is mandatory then,
   * so the prompt is informational only (no Yes/No choice). */
  forced: boolean;
}

interface ManagedHackModeResponse {
  managed: boolean;
}

/**
 * Shown on the defending actor's owner's client (GM for an NPC, the
 * controlling player for a PC) whenever a single-target HoloSuite hack is
 * about to start, to decide whether this runs as a PvP "managed" intrusion
 * (see holosuite-pvp-intrusion.ts - the defender actively moves/recaptures
 * nodes on their own combat turns) or the classic point/time trace. Forced
 * to managed with no choice when the target is player-owned, per design -
 * a PC is always an active defender, never a passive clock.
 */
async function handlePromptManagedHackMode(
  data: ManagedHackModePromptData
): Promise<ManagedHackModeResponse> {
  if (data.forced) return { managed: true };

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  const managed = await globalThis.foundry.applications.api.DialogV2.confirm({
    window: { title: "Incoming Intrusion" },
    content: `<p><strong>${data.attackerName}</strong> is attempting to hack a system you control. Run this as a managed defense (you actively move/recapture nodes on your own combat turns) instead of the passive trace clock?</p>`,
    rejectClose: false,
    modal: true
  });
  return { managed: !!managed };
}

/**
 * Requests the managed-vs-classic hack mode choice from the target's owner.
 * Mirrors requestDefenseResponse's owner-resolution (findTokenControllers)
 * but only ever asks the first controller - unlike a defense roll, this
 * isn't racing simultaneous responses, just picking who gets asked.
 */
export async function requestManagedHackMode(
  targetActor: FaseripActor,
  data: Omit<ManagedHackModePromptData, "forced">
): Promise<boolean> {
  // A player-owned actor always defends actively - no prompt, no opt-out.
  const forced = !targetActor.hasPlayerOwner;

  if (!socket) {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      // We already have write access to this actor locally (GM, or we
      // happen to own it too) - handle the prompt (or the forced-true
      // shortcut) right here, no transport needed.
      const result = await handlePromptManagedHackMode({ ...data, forced });
      return result.managed;
    }
    // No socketlib AND we don't own the target ourselves - there is no way
    // to ever reach its real owner's client, so managed mode must NOT be
    // forced blind here: every subsequent PvP message (opening the
    // defender's view, broadcasting state, relaying their actions) would
    // silently no-op the same way, leaving the defender permanently unable
    // to see or do anything - confirmed live as exactly that. Fall back to
    // the classic trace instead.
    if (forced) {
      ui.notifications?.warn?.(
        "socketlib is required for managed PvP hacking against another user's target - using the standard trace instead."
      );
    }
    return false;
  }

  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    const result = await handlePromptManagedHackMode({ ...data, forced });
    return result.managed;
  }

  const result = await socket.executeAsUser("promptManagedHackMode", owner.id, {
    ...data,
    forced
  });
  return result?.managed ?? forced;
}

export type NodeHackMode = "managed" | "auto-time" | "auto-points";

interface NodeHackModePromptData {
  attackerName: string;
  targetName?: string;
  /** Whether "Managed" is even an option - Node Hacker's managed mode needs a single real
   * target already paired with the attacker in the active combat encounter (see
   * shouldRunManaged in node-hacker-hacking.ts). Omitted entirely otherwise. */
  canManage: boolean;
}

/**
 * Shown on the GM's own client - unlike HoloSuite's requestManagedHackMode (which asked the
 * DEFENDING actor's owner), Node Hacker's managed mode always has the GM play the trace side
 * directly regardless of who owns the hacked actor, so the GM is who actually needs to
 * choose. Picks between a live managed trace and the classic passive trace, and for the
 * latter, which of the two "prior pvp code" trace flavors to use (see
 * holosuite-node-intrusion-patch.ts's checkDetection): a timed countdown that only starts
 * once a node attempt first fails, or a meter that only grows on failure, scaled by the
 * failed node's difficulty.
 */
async function handlePromptNodeHackMode(data: NodeHackModePromptData): Promise<{ mode: NodeHackMode }> {
  const options = [
    `<option value="auto-time">Auto - Timed Countdown</option>`,
    `<option value="auto-points" selected>Auto - Failure Meter</option>`
  ];
  if (data.canManage) {
    options.unshift(`<option value="managed">Managed (I play the trace live)</option>`);
  }

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  const mode = await globalThis.foundry.applications.api.DialogV2.prompt({
    window: { title: "Incoming Hack" },
    // Foundry's own `.form-group` lays out label+input as a horizontal row, which reads fine
    // for a short label but wraps badly once the label is this much descriptive text - the
    // description goes in its own paragraph instead, with a short, separate stacked label.
    content: `<p><strong>${data.attackerName}</strong> is attempting to hack${data.targetName ? ` <strong>${data.targetName}</strong>` : ""}.</p><div class="form-group" style="display:flex;flex-direction:column;align-items:stretch;gap:4px;"><label>Run this trace as:</label><select name="mode">${options.join("")}</select></div>`,
    ok: {
      label: "Start",
      callback: (_event: Event, button: any) => button.form.elements.mode.value
    },
    rejectClose: false
  });
  return { mode: (mode as NodeHackMode) ?? "auto-points" };
}

/** Requests the managed-vs-auto (and auto trace flavor) choice from the GM specifically. */
export async function requestNodeHackMode(data: NodeHackModePromptData): Promise<NodeHackMode> {
  // @ts-expect-error - Foundry game.user global
  if (game.user?.isGM) {
    const result = await handlePromptNodeHackMode(data);
    return result.mode;
  }
  if (!socket) {
    ui.notifications?.warn?.(
      "socketlib is required to ask the GM how to run this hack - defaulting to a failure-meter trace."
    );
    return "auto-points";
  }
  const result = await socket.executeAsGM("promptNodeHackMode", data);
  return result?.mode ?? "auto-points";
}

interface CloseHackSpectatorData {
  liveSessionId: string;
}

/**
 * Finds the rendered read-only hack spectator app for a live session via
 * Foundry's own canonical ApplicationV2 registry - NOT HoloSuite's internal
 * `pe`/`Q` bookkeeping maps (api.getActiveApp() reads `pe`). Confirmed live:
 * by the time this runs, HoloSuite's own live-end handling has already run
 * first (it always accompanies our broadcast) and already emptied `pe` for
 * this session - getActiveApp() reliably finds nothing, yet the window is
 * still visibly on screen. Foundry itself still knows about the instance
 * (it's still rendered) regardless of what HoloSuite's own bookkeeping
 * thinks, so this looks there instead.
 */
function findHackSpectatorApp(liveSessionId: string): any | null {
  // @ts-expect-error - Foundry ApplicationV2 registry
  const instances = globalThis.foundry?.applications?.instances;
  if (!instances?.values) return null;
  for (const app of instances.values()) {
    if (app?.readOnly && app?.liveSessionId === liveSessionId) return app;
  }
  return null;
}

/**
 * Removes any `.holosuite-hacking-window` DOM element that isn't backed by
 * a live entry in Foundry's own ApplicationV2 registry - confirmed live:
 * by the time our close broadcast is handled, HoloSuite's own live-end
 * handling has already run (it always accompanies it) and Foundry itself
 * no longer knows about the instance either (findHackSpectatorApp finds
 * nothing) - meaning the DOM element genuinely got orphaned during
 * HoloSuite's own close() (its bookkeeping and Foundry's own state both
 * consider it gone, but the element itself was never detached). There is
 * no live app reference left to close cleanly at this point, so this is a
 * direct, blunt sweep instead - safe because a *live* hack (this player's
 * own, or another live one) is always still tracked in the instances
 * registry and therefore skipped here.
 */
function removeOrphanedHackWindows(): number {
  const elements = document.querySelectorAll(".holosuite-hacking-window");
  // @ts-expect-error - Foundry ApplicationV2 registry
  const instances = globalThis.foundry?.applications?.instances;
  const liveElements = new Set<Element>();
  if (instances?.values) {
    for (const app of instances.values()) {
      if (app?.element) liveElements.add(app.element as Element);
    }
  }
  let removed = 0;
  elements.forEach(el => {
    if (!liveElements.has(el)) {
      el.remove();
      removed += 1;
    }
  });
  return removed;
}

/**
 * Closes a hack spectator window directly, bypassing HoloSuite's own
 * close()/onLiveEnd chain entirely (see findHackSpectatorApp) - a normal
 * close() attempt first (for correct internal state/cleanup, in case it
 * still works here), then a direct DOM sweep of orphaned windows as a hard
 * fallback, since close() alone was confirmed to leave the element on
 * screen even when both HoloSuite's own and Foundry's own bookkeeping
 * already considered the app gone.
 */
function tryCloseHackSpectator(liveSessionId: string): boolean {
  const app = findHackSpectatorApp(liveSessionId);
  if (app) {
    try {
      app.close?.({ force: true });
    } catch (err) {
      console.warn("faserip | closeHackSpectator: close() threw", err);
    }
    try {
      app.element?.remove?.();
    } catch (err) {
      console.warn("faserip | closeHackSpectator: element removal threw", err);
    }
  }
  const removed = removeOrphanedHackWindows();
  return !!app || removed > 0;
}

function handleCloseHackSpectator(data: CloseHackSpectatorData): void {
  tryCloseHackSpectator(data.liveSessionId);
  // Whether or not the app was found/attempted above, HoloSuite's own
  // live-end handling (which always fires alongside this message) may
  // still be mid-render - retry once shortly after it settles. Harmless
  // no-op if it already closed.
  globalThis.setTimeout(() => tryCloseHackSpectator(data.liveSessionId), 250);
}

/**
 * Broadcasts to every connected client to close their read-only HoloSuite
 * hack spectator view for the given live session, if they have one open.
 * See handleCloseHackSpectator for why this exists alongside (not instead
 * of) HoloSuite's own live-end message.
 */
export function broadcastCloseHackSpectator(liveSessionId: string): void {
  if (!socket || !liveSessionId) return;
  socket.executeForEveryone("closeHackSpectator", { liveSessionId });
}

interface SetDoorLockStateData {
  wallUuid: string;
  ds: number;
}


/** Runs on a GM client (or locally if the caller already is GM) - only a
 * GM typically holds update permission on Wall documents. */
async function handleSetDoorLockState(data: SetDoorLockStateData): Promise<boolean> {
  // @ts-expect-error - Foundry global fromUuid
  const wall = await fromUuid(data.wallUuid);
  if (!wall) return false;
  await wall.update({ ds: data.ds });
  return true;
}

/**
 * Sets a door's core Wall document `ds` (door state) field directly,
 * routed through a GM client via socketlib when the caller isn't GM.
 *
 * This exists because LocknKey's own PickHoveredLock()/BreakHoveredLock()
 * API functions don't actually apply a caller-determined success/failure -
 * they run their own internal dice roll against the lock's configured DC
 * (via onatemptedcircumventLock), entirely independent of any check already
 * resolved on this system's side, and that whole request chain silently
 * no-ops if there's no active GM client connected. Since core's door
 * lock/unlock visual state is just the standard `ds` field (LOCKED = 2,
 * CLOSED = 0 - confirmed against LocknKey's own ToggleDoorLock, which does
 * nothing more than flip this same field), setting it directly here - once
 * this system's own FASERIP check has already determined success - bypasses
 * LocknKey's incompatible roll pipeline entirely instead of fighting it.
 */
export async function requestSetDoorLockState(
  wallUuid: string,
  ds: number
): Promise<boolean> {
  // @ts-expect-error - Foundry game.user global
  if (game.user?.isGM) {
    return handleSetDoorLockState({ wallUuid, ds });
  }
  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - cannot update door lock state remotely"
    );
    return false;
  }
  return await socket.executeAsGM("setDoorLockState", { wallUuid, ds });
}

/**
 * Request a defense response from the target's owner
 * Called by the attacker's client
 */
export async function requestDefenseResponse(
  data: DefensePromptData
): Promise<DefenseResponse | null> {
  // Get the target actor
  let targetActor: FaseripActor | undefined;
  if (data.targetTokenId) {
    const token = canvas?.tokens?.get(data.targetTokenId);
    targetActor = token?.actor as FaseripActor | undefined;
  } else {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return null;
  }

  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - falling back to local"
    );
    // Fallback: handle locally if user is GM or owns the target
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleDefensePrompt(data);
    }
    console.error("FASERIP Socket | Cannot handle defense locally");
    return null;
  }

  // Generate unique prompt ID for tracking
  const promptId = foundry.utils.randomID();
  data.promptId = promptId;

  // Find users who could handle this defense
  const potentialControllers = findTokenControllers(targetActor);

  if (potentialControllers.length === 0) {
    console.warn("FASERIP Socket | No controllers found - taking hit");
    return { defenseType: "takeHit" };
  }

  // If only one user, just send to them
  if (potentialControllers.length === 1) {
    const user = potentialControllers[0];
    return await socket.executeAsUser("promptDefense", user.id, data);
  }

  // Multiple GMs - race condition handling (first to respond wins)

  let firstResponseReceived = false;
  let winningResponse: DefenseResponse | null = null;
  let resolveWinner: ((value: DefenseResponse | null) => void) | null = null;

  const winnerPromise = new Promise<DefenseResponse | null>(resolve => {
    resolveWinner = resolve;
  });

  const gmPromises = potentialControllers.map((user: any) =>
    socket.executeAsUser("promptDefense", user.id, data).then((result: any) => {
      // First valid response wins (including "takeHit")
      if (!firstResponseReceived && result !== null) {
        firstResponseReceived = true;
        winningResponse = result;

        // Cancel all other prompts (even if this user took the hit)
        potentialControllers.forEach((otherUser: any) => {
          if (otherUser.id !== user.id) {
            socket.executeAsUser("cancelDefensePrompt", otherUser.id, {
              promptId,
              winnerUserId: user.id
            });
          }
        });

        resolveWinner?.(result);
      }
      return result;
    })
  );

  // Wait for first response or all timeouts
  const response = (await Promise.race([
    winnerPromise,
    Promise.all(gmPromises).then(() => winningResponse)
  ])) as DefenseResponse & { _targetActor?: FaseripActor };

  if (!response) {
    console.warn("FASERIP Socket | No response - defaulting to takeHit");
    return { defenseType: "takeHit" };
  }

  // Reconstruct target actor on this client
  if (response._targetActorId) {
    // @ts-expect-error - Foundry game.actors collection
    response._targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === response._targetActorId
    ) as FaseripActor | undefined;
  }

  // Reconstruct roll object from JSON
  if (response._rollJSON) {
    (response as any)._rollObject = Roll.fromData(response._rollJSON);
  }

  return response;
}

/**
 * Find users who can control this token (owner or GM)
 */
export function findTokenControllers(actor: FaseripActor): User[] {
  // First, find all non-GM users who own the actor
  const playerOwners: User[] =
    // @ts-expect-error - Foundry game.users collection
    game.users?.filter(
      (user: User) =>
        user.active && !user.isGM && actor.testUserPermission(user, "OWNER")
    ) || [];

  // If there are player owners, only return them (exclude GMs)
  if (playerOwners.length > 0) {
    return playerOwners;
  }

  // If no players own the actor, return GMs (for unowned NPCs)
  const gmOwners: User[] =
    // @ts-expect-error - Foundry game.users collection
    game.users?.filter(
      (user: User) =>
        user.active && user.isGM && actor.testUserPermission(user, "OWNER")
    ) || [];

  return gmOwners;
}

/**
 * Handle a defense prompt on the defender's client
 * Shows the defense modal and waits for user response
 * This function is called remotely via socketlib
 */
async function handleDefensePrompt(
  data: DefensePromptData
): Promise<DefenseResponse | null> {
  // Get the target actor and token
  let targetActor: FaseripActor | undefined;
  let targetToken: Token | undefined;
  if (data.targetTokenId) {
    targetToken = canvas?.tokens?.placeables.find(
      (t: Token) => t.id === data.targetTokenId
    );
    targetActor = targetToken?.actor as FaseripActor | undefined;
  } else {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return { defenseType: "takeHit" };
  }

  // Check if target is stunned - stunned enemies cannot defend
  let isStunned = false;
  if (targetToken && targetToken.actor) {
    // For both linked and unlinked tokens, check the token's actor
    // Note: Foundry uses "stun" as the status ID, not "stunned"
    const hasStatusEffectResult =
      // @ts-expect-error - hasStatusEffect may not be in types
      targetToken.actor.hasStatusEffect?.("stun") || false;

    // Also check statuses collection directly as fallback
    const statusesArray = Array.from(targetToken.actor.statuses || []);

    isStunned = hasStatusEffectResult || statusesArray.includes("stun");
  } else if (targetActor) {
    // Fallback: check actor directly if no token
    // @ts-expect-error - hasStatusEffect may not be in types
    isStunned = targetActor.hasStatusEffect?.("stun") || false;
  }

  if (isStunned) {
    // Don't create chat message here - let the caller handle it to avoid duplicates
    return { defenseType: "takeHit" };
  }

  // Security check - verify this user owns the target
  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - returning takeHit"
    );
    return { defenseType: "takeHit" };
  }

  // Determine which attribute the defender should use
  let defenseAttribute: string;
  switch (data.attackType) {
    case "melee":
      defenseAttribute = "Fighting";
      break;
    case "ranged":
    case "thrown":
      defenseAttribute = "Agility";
      break;
    case "psyche":
      defenseAttribute = "Psyche";
      break;
    case "strength":
      defenseAttribute = "Strength";
      break;
    default:
      defenseAttribute = "Fighting";
  }

  // Get defender's attribute value
  const system = targetActor.system as any;
  const defenseAttr = getEffectiveAttributeData(
    targetActor,
    defenseAttribute.toLowerCase() as any
  );
  if (!defenseAttr) {
    console.error("FASERIP Socket | Defense attribute not found");
    return { defenseType: "takeHit" };
  }

  const promptId = data.promptId || foundry.utils.randomID();

  // Find applicable defense talents
  const talents = system.talents || [];
  const defenseAttributeLower = defenseAttribute.toLowerCase();
  const applicableTalents = talents.filter((t: any) => {
    const talentName = t.name.toLowerCase();
    // Check if talent applies to this defense attribute
    // Common defense talents: Martial Arts, Dodging, Blocking, Combat Sense, etc.
    if (defenseAttributeLower === "fighting") {
      return (
        talentName.includes("martial") ||
        talentName.includes("block") ||
        talentName.includes("combat") ||
        talentName.includes("melee") ||
        talentName.includes("parry")
      );
    } else if (defenseAttributeLower === "agility") {
      return (
        talentName.includes("dodge") ||
        talentName.includes("evasion") ||
        talentName.includes("acrobat") ||
        talentName.includes("reflex")
      );
    } else if (defenseAttributeLower === "psyche") {
      return (
        talentName.includes("mental") ||
        talentName.includes("resist") ||
        talentName.includes("willpower")
      );
    } else if (defenseAttributeLower === "strength") {
      return (
        talentName.includes("wrestling") ||
        talentName.includes("grappl") ||
        talentName.includes("wrestl")
      );
    }
    return false;
  });

  const talentNames = applicableTalents.map((t: any) => t.name);
  const talentCS = applicableTalents.reduce(
    (sum: number, t: any) => sum + (t.bonus || 0),
    0
  );

  // Create dialog instance BEFORE showing it so we can track and cancel it
  const dialog = new VueDialog(
    DefenseResponseModal,
    {
      targetActor,
      attackerName: data.attackerName,
      attackRoll: data.attackRoll,
      attackType: data.attackType,
      attackAttribute: data.attackAttribute,
      attackResult: data.attackResult,
      attackRank: data.attackRank,
      powerName: data.powerName,
      defenseAttribute,
      defenseRank: defenseAttr.rank,
      defenseValue: defenseAttr.value,
      talentNames: talentNames.length > 0 ? talentNames : undefined,
      talentCS: talentCS > 0 ? talentCS : undefined,
      comboIndex: data.comboIndex,
      comboTotal: data.comboTotal
    },
    {
      window: {
        title: "Incoming Attack!",
        icon: "fas fa-shield",
        modal: false
      },
      position: {
        width: 450
      }
    }
  );

  // Store prompt for cancellation BEFORE showing the dialog
  const dialogPromise = new Promise<DefenseResponse | null>(resolve => {
    activeDefensePrompts.set(promptId, { dialog, resolve });
  });

  // Render the dialog
  await dialog.render(true);

  // Wait for either the dialog result or external cancellation
  const result = await Promise.race([
    dialog.wait() as Promise<DefenseResponse | null>,
    dialogPromise
  ]);

  // Clean up the prompt from tracking
  activeDefensePrompts.delete(promptId);

  // Handle cancellation by another GM
  if (!result) {
    return { defenseType: "takeHit" };
  }

  if (result.defenseType === "takeHit") {
    return { defenseType: "takeHit" };
  }

  // Build response with roll data
  return {
    defenseType: result.defenseType,
    defenseRoll: result.defenseRoll,
    defenseAttribute: result.defenseAttribute,
    defended: result.defended,
    _rollJSON: result._rollJSON,
    _defenseSuccess: result._defenseSuccess,
    _resultText: result._resultText,
    _resultClass: result._resultClass,
    _targetActorId: targetActor.id!,
    // @ts-expect-error - Foundry game.user global
    _respondingUserId: game.user?.id,
    _isUltimateBotch: result._isUltimateBotch,
    _isBotch: result._isBotch
  };
}

/**
 * Handle canceling a defense prompt (when another GM responds first)
 */
function handleCancelDefensePrompt(data: {
  promptId: string;
  winnerUserId?: string;
}): void {
  const prompt = activeDefensePrompts.get(data.promptId);
  if (prompt) {
    prompt.dialog?.close();
    prompt.resolve(null);
    activeDefensePrompts.delete(data.promptId);
  }
}

/**
 * Request a counter-attack response from the defender's owner
 * Called after a successful defense that allows counter-attack
 */
export async function requestCounterAttackResponse(
  data: CounterAttackPromptData
): Promise<CounterAttackResponse | null> {
  // Get the defender actor
  let defenderActor: FaseripActor | undefined;
  if (data.defenderTokenId) {
    const token = canvas?.tokens?.get(data.defenderTokenId);
    defenderActor = token?.actor as FaseripActor | undefined;
  } else {
    // @ts-expect-error - Foundry game.actors collection
    defenderActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.defenderActorId
    ) as FaseripActor | undefined;
  }

  if (!defenderActor) {
    console.error("FASERIP Socket | Defender actor not found");
    return { counterAttack: false };
  }

  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - falling back to local"
    );
    // Fallback: handle locally if user is GM or owns the defender
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || defenderActor.isOwner) {
      return await handleCounterAttackPrompt(data);
    }
    console.error("FASERIP Socket | Cannot handle counter-attack locally");
    return { counterAttack: false };
  }

  // Generate unique prompt ID for tracking
  const promptId = foundry.utils.randomID();
  data.promptId = promptId;

  // Find users who could handle this counter-attack
  const potentialControllers = findTokenControllers(defenderActor);

  if (potentialControllers.length === 0) {
    console.warn("FASERIP Socket | No controllers found - no counter-attack");
    return { counterAttack: false };
  }

  // If only one user, just send to them
  if (potentialControllers.length === 1) {
    const user = potentialControllers[0];
    return await socket.executeAsUser("promptCounterAttack", user.id, data);
  }

  // Multiple GMs - race condition handling (first to respond wins)

  const promises = potentialControllers.map((user: any) =>
    socket
      .executeAsUser("promptCounterAttack", user.id, data)
      .then((response: CounterAttackResponse | null) => ({
        response,
        userId: user.id
      }))
  );

  const firstResult = await Promise.race(promises);

  if (!firstResult || !firstResult.response) {
    return { counterAttack: false };
  }

  // Cancel other prompts
  for (const user of potentialControllers) {
    if (user.id !== firstResult.userId) {
      socket
        .executeAsUser("cancelCounterAttackPrompt", user.id, {
          promptId,
          winnerUserId: firstResult.userId
        })
        .catch((err: any) => {
          console.warn(
            "FASERIP Socket | Failed to cancel counter prompt for user:",
            user.id,
            err
          );
        });
    }
  }

  return firstResult.response;
}

/**
 * Handle counter-attack prompt on the defender's client
 * Shows VueDialog for choosing whether to counter-attack
 */
async function handleCounterAttackPrompt(
  data: CounterAttackPromptData
): Promise<CounterAttackResponse | null> {
  const promptId = data.promptId || foundry.utils.randomID();

  try {
    // Create cancellation promise (for multi-GM race conditions)
    let externalResolve:
      | ((value: CounterAttackResponse | null) => void)
      | null = null;
    const cancellationPromise = new Promise<CounterAttackResponse | null>(
      resolve => {
        externalResolve = resolve;
      }
    );

    // Create the dialog (but don't await show() - we need to track it first)
    const dialog = new VueDialog(
      CounterAttackModal,
      {
        defenderName: data.defenderName,
        attackerName: data.attackerName,
        defenseRoll: data.defenseRoll,
        attackRoll: data.attackRoll,
        defenseResultColor: data.defenseResultColor,
        attackResultColor: data.attackResultColor,
        counterType: data.counterType
      },
      {
        window: { title: "Counter-Attack?" },
        position: { width: 500 }
      }
    );

    // Store dialog reference BEFORE showing it (for cancellation)
    if (externalResolve) {
      activeCounterPrompts.set(promptId, {
        dialog: dialog,
        resolve: externalResolve
      });
    }

    // Render the dialog
    await dialog.render(true);

    // Race between user response and external cancellation
    const result = (await Promise.race([
      dialog.wait(),
      cancellationPromise
    ])) as CounterAttackResponse | null;

    // Clean up
    activeCounterPrompts.delete(promptId);

    if (result) {
      // @ts-expect-error - Foundry game.user global
      result._respondingUserId = game.user?.id;
    }

    return result;
  } catch (error) {
    console.error("FASERIP Socket | Error in counter-attack prompt:", error);
    activeCounterPrompts.delete(promptId);
    return { counterAttack: false };
  }
}

/**
 * Cancel a counter-attack prompt (called when another user responds first)
 */
function handleCancelCounterAttackPrompt(data: {
  promptId: string;
  winnerUserId?: string;
}): void {
  const prompt = activeCounterPrompts.get(data.promptId);
  if (prompt) {
    prompt.dialog?.close();
    prompt.resolve({ counterAttack: false });
    activeCounterPrompts.delete(data.promptId);
  }
}

/**
 * Data structure for damage application
 */
interface ApplyDamageData {
  targetActorId: string;
  targetTokenId?: string;
  damage: number;
  damageType?: string; // Type of damage (fire, cold, etc.) for resistance checking
  powerName?: string; // Name of attacking power for resistance messages
  armorPiercing?: string | null; // Armor-piercing rank (optional)
  armorRank?: string; // Target's armor rank (optional)
  hitCount?: number; // Number of hits for per-hit armor degradation
  hitDamages?: number[]; // Per-hit damage amounts (armor soaks each hit separately)
  targetArmorOnly?: boolean; // Attack is aimed at armor: ignores armor piercing, no overflow to health
  armorUpdates?: any[]; // Legacy: Deprecated - armor is now Item documents
  powerUpdates?: any[];
}

/**
 * Request damage application on the target owner's client
 * Called by the attacker's client after calculating damage
 */
export async function requestDamageApplication(
  targetActor: FaseripActor,
  damage: number,
  damageType?: string,
  powerName?: string,
  targetTokenId?: string,
  armorPiercing?: string | null,
  armorRank?: string,
  hitCount?: number,
  hitDamages?: number[],
  targetArmorOnly?: boolean
): Promise<{
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
  piercingResult?: ArmorPiercingResult;
} | null> {
  if (!socket) {
    console.warn(
      "FASERIP Socket | Socket not initialized - applying damage locally"
    );
    // Fallback: apply locally if user is GM or owns the target
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleApplyDamage({
        targetActorId: targetActor.id!,
        targetTokenId,
        damage,
        damageType,
        powerName,
        armorPiercing,
        armorRank,
        hitCount,
        hitDamages,
        targetArmorOnly
      });
    }
    console.error("FASERIP Socket | Cannot apply damage locally");
    return null;
  }

  // Find the owner of the target
  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    return await handleApplyDamage({
      targetActorId: targetActor.id!,
      targetTokenId,
      damage,
      damageType,
      powerName,
      armorPiercing,
      armorRank,
      hitCount,
      hitDamages,
      targetArmorOnly
    });
  }

  // Execute damage application on the owner's client
  const result = await socket.executeAsUser("applyDamage", owner.id, {
    targetActorId: targetActor.id!,
    targetTokenId,
    damage,
    damageType,
    powerName,
    armorPiercing,
    armorRank,
    hitCount,
    hitDamages,
    targetArmorOnly
  });

  return result;
}

export async function requestStatDebuffApplication(
  targetActor: FaseripActor,
  data: ApplyStatDebuffData
): Promise<ApplyStatDebuffData | null> {
  if (!socket) {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleApplyStatDebuff(data);
    }
    return null;
  }

  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    return await handleApplyStatDebuff(data);
  }

  return await socket.executeAsUser("applyStatDebuff", owner.id, data);
}

/**
 * Handle applying damage to an actor on the owner's client
 * This function is called remotely via socketlib
 */
async function handleApplyDamage(data: ApplyDamageData): Promise<{
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
  piercingResult?: ArmorPiercingResult;
} | null> {
  // Get the target actor - prioritize token actor for unlinked tokens
  let targetActor: FaseripActor | undefined;

  // First try to get actor from token (for unlinked tokens)
  if (data.targetTokenId) {
    const token = canvas?.tokens?.placeables.find(
      (t: Token) => t.id === data.targetTokenId
    );
    if (token) {
      targetActor = token.actor as FaseripActor;
    }
  }

  // Fall back to world actor if no token found
  if (!targetActor) {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found");
    return null;
  }

  // Security check - verify this user owns the target
  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - cannot apply damage"
    );
    return null;
  }

  // Get degrading armor setting
  const degradingMode =
    (game.settings.get("faserip", "degradingArmor") as string) ?? "none";

  // @todo fix me later; don't cast to any.
  const system = targetActor.system as any;

  // CRITICAL: Clone powers array BEFORE damage application to avoid mutating source
  // (Armor is now handled via Item documents which are updated directly)
  const clonedPowers = system.powers ? [...system.powers] : [];

  // Use centralized damage application (updates armor items directly, mutates clonedPowers)
  const result = await applyDamageToActor({
    actor: targetActor,
    damage: data.damage,
    damageType: data.damageType,
    degradingArmorMode: degradingMode,
    armorPiercing: data.armorPiercing,
    armorRank: data.armorRank,
    hitCount: data.hitCount,
    hitDamages: data.hitDamages,
    targetArmorOnly: data.targetArmorOnly
  });

  // Life-link: redirect a % of the health damage just dealt onto a bonded
  // actor instead (see getActiveLifeLinkRedirect in utils/power-aura.ts).
  // Only the FINAL health-damage number is split (after armor/resistance) -
  // the redirected share is applied to the linked actor as-is, not re-run
  // through their own armor/resistance. Single hop only: the linked actor's
  // own life-link (if any) is not itself checked, to avoid infinite chains.
  if (result.healthDamage > 0) {
    const redirect = getActiveLifeLinkRedirect(targetActor);
    if (redirect && redirect.redirectActor.id !== targetActor.id) {
      const redirectedAmount = Math.round(
        result.healthDamage * (redirect.percent / 100)
      );
      if (redirectedAmount > 0) {
        let redirectFormId = system.currentFormId;
        if (!redirectFormId && system.forms?.length > 0) {
          const primaryForm = system.forms.find((f: any) => f.isPrimary);
          redirectFormId = primaryForm ? primaryForm.id : system.forms[0].id;
        }
        if (!redirectFormId) redirectFormId = "default";

        result.healthDamage -= redirectedAmount;
        result.newHealthValue += redirectedAmount;
        system.healthByForm[redirectFormId] = result.newHealthValue;

        await requestLifeLinkRedirect(redirect.redirectActor, redirectedAmount);

        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Life-Link</h3>
            <p><strong>${redirect.redirectActor.name}</strong> is bonded to <strong>${targetActor.name}</strong> and takes <strong>${redirectedAmount}</strong> of the health damage instead.</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      }
    }
  }

  // Show resistance chat messages if applicable
  if (result.resistanceRollResult) {
    const rr = result.resistanceRollResult;

    if (rr.completelyBlocked) {
      // Flat resistance completely blocked damage - no roll needed
      await ChatMessage.create({
        content: `<div class="fsr-chat-card fsr-success">
          <h3>Resistance: Complete Protection</h3>
          <p><strong>${targetActor.name}</strong>'s ${rr.resistancePower.name} (${formatRankDisplay(rr.resistanceRank)}: ${rr.resistanceValue}) completely blocks ${rr.incomingDamage} ${data.damageType} damage${data.powerName ? ` from <strong>${data.powerName}</strong>` : ""}!</p>
          <p class="fsr-rank-change">No roll needed - damage did not exceed resistance value</p>
        </div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor })
      });
    } else {
      // Damage exceeded flat resistance - roll was made
      const colorClass =
        rr.colorResult === "red"
          ? "fsr-roll-red"
          : rr.colorResult === "yellow"
            ? "fsr-roll-yellow"
            : rr.colorResult === "green"
              ? "fsr-roll-green"
              : "fsr-roll-white";

      if (result.armorDamage > 0) {
        // Resistance applied to overflow after armor
        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Resistance: Two-Stage Protection</h3>
            <p><strong>${targetActor.name}</strong>'s armor absorbed ${result.armorDamage} damage</p>
            <p><strong>${rr.resistancePower.name}</strong> (${formatRankDisplay(rr.resistanceRank)}): ${rr.resistanceValue} flat reduction</p>
            <p class="fsr-rank-change">${rr.incomingDamage} overflow - ${rr.resistanceValue} resistance = ${rr.overflowDamage} remaining</p>
            <p>Resistance Roll: <span class="${colorClass}">${rr.rollValue}</span> - <strong class="${colorClass}">${rr.colorResult?.toUpperCase()}</strong> result (${rr.resistancePercent}% reduction of overflow)</p>
            <p class="fsr-rank-change">${rr.overflowDamage} overflow → ${rr.finalDamage} final damage</p>
            <p><strong>Total resisted: ${rr.totalDamageResisted}</strong> (${rr.resistanceValue} flat + ${rr.damageResistedByRoll} roll)</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      } else {
        // Resistance applied to all damage (no armor)
        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Resistance: Two-Stage Protection</h3>
            <p><strong>${targetActor.name}</strong>'s ${rr.resistancePower.name} (${formatRankDisplay(rr.resistanceRank)}): ${rr.resistanceValue} flat reduction</p>
            <p class="fsr-rank-change">${rr.incomingDamage} damage - ${rr.resistanceValue} resistance = ${rr.overflowDamage} remaining</p>
            <p>Resistance Roll: <span class="${colorClass}">${rr.rollValue}</span> - <strong class="${colorClass}">${rr.colorResult?.toUpperCase()}</strong> result (${rr.resistancePercent}% reduction of overflow)</p>
            <p class="fsr-rank-change">${rr.overflowDamage} overflow → ${rr.finalDamage} final damage</p>
            <p><strong>Total resisted: ${rr.totalDamageResisted}</strong> (${rr.resistanceValue} flat + ${rr.damageResistedByRoll} roll)</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      }
    }
  } else if (result.resistancePower && result.resistanceReduction) {
    // Legacy fallback for old resistance system (deprecated - kept for backward compatibility)
    if (result.armorDamage > 0) {
      // Resistance applied to overflow
      if (
        result.resistanceReduction >=
        result.originalDamage! - result.armorDamage
      ) {
        // Complete resistance to overflow
        await ChatMessage.create({
          content: `<div class="fsr-chat-card fsr-success">
            <h3>Resistance: Complete Protection</h3>
            <p><strong>${targetActor.name}</strong>'s armor absorbed ${result.armorDamage} damage</p>
            <p><strong>${result.resistancePower.name}</strong> (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) completely resists ${result.resistanceReduction} overflow ${data.damageType} damage${data.powerName ? ` from <strong>${data.powerName}</strong>` : ""}!</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      } else {
        // Partial resistance to overflow
        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Resistance: Partial Protection</h3>
            <p><strong>${targetActor.name}</strong>'s armor absorbed ${result.armorDamage} damage</p>
            <p><strong>${result.resistancePower.name}</strong> (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) reduces overflow ${data.damageType} damage by ${result.resistanceReduction}</p>
            <p class="fsr-rank-change">${result.originalDamage! - result.armorDamage} → ${result.healthDamage} overflow damage</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      }
    } else {
      // Resistance applied to all damage (no armor)
      if (result.resistanceReduction >= result.originalDamage!) {
        // Complete resistance
        await ChatMessage.create({
          content: `<div class="fsr-chat-card fsr-success">
            <h3>Resistance: Complete Immunity</h3>
            <p><strong>${targetActor.name}</strong>'s ${result.resistancePower.name} (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) completely resists ${result.originalDamage} ${data.damageType} damage${data.powerName ? ` from <strong>${data.powerName}</strong>` : ""}!</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      } else {
        // Partial resistance
        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Resistance: Partial Protection</h3>
            <p><strong>${targetActor.name}</strong>'s ${result.resistancePower.name} (${formatRankDisplay(result.resistancePower.rank)}: ${result.resistancePower.value}) reduces ${data.damageType} damage by ${result.resistanceReduction}</p>
            <p class="fsr-rank-change">${result.originalDamage} → ${result.healthDamage} damage</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
      }
    }
  }

  const currentFormId = system.currentFormId || "";

  // Build updates object using the cloned arrays (which now have mutations applied)
  const updates: Record<string, any> = {};

  // Add power updates - use cloned arrays (always update if actor has powers property)
  if (system.powers !== undefined) {
    updates["system.powers"] = clonedPowers;
  }

  // CRITICAL: Always add health updates (damage application modifies healthByForm)
  if (!system.healthByForm) {
    system.healthByForm = {};
  }
  updates["system.healthByForm"] = system.healthByForm;

  // Update actor with new values
  try {
    // CRITICAL: Get the specific token if token ID provided (for unlinked multi-target attacks)
    // Otherwise fall back to first active token
    const targetToken = data.targetTokenId
      ? canvas?.tokens?.placeables.find(
          (t: Token) => t.id === data.targetTokenId
        )?.document
      : targetActor.getActiveTokens()[0]?.document || null;

    // Update the token document if it exists and is unlinked, otherwise update the actor
    if (targetToken && !targetToken.actorLink) {
      // Unlinked token: call update() on the SYNTHETIC ACTOR (not the token document).
      // In Foundry v13, the synthetic actor's update() routes to the token's ActorDelta
      // internally AND fires updateActor hooks, which triggers the complete bar refresh
      // pipeline — the same path that makes sheet-initiated damage work correctly.
      if (currentFormId) {
        updates["system.currentFormId"] = currentFormId;
      }

      await targetToken.actor!.update(updates);

      // After the actor update, refresh bar caches and redraw
      const updatedActor = targetToken.actor;
      if (updatedActor && targetToken.object) {
        const actorSystem =
          // @ts-expect-error - drawBars not in Foundry type declarations for Token
          updatedActor.system as BaseActorSystemData;
        const healthResource = actorSystem.resources?.health;
        const armorResource = actorSystem.resources?.armor;
        const tokenDoc = targetToken as unknown as {
          bar1: { value: number; max: number };
          bar2: { value: number; max: number };
        };
        if (healthResource !== undefined) {
          tokenDoc.bar1.value = healthResource.value;
          tokenDoc.bar1.max = healthResource.max;
        }
        if (armorResource !== undefined) {
          tokenDoc.bar2.value = armorResource.value;
          tokenDoc.bar2.max = armorResource.max;
        }
        targetToken.object.drawBars();
      }

      if (updatedActor?.sheet?.rendered) {
        updatedActor.sheet.render(false);
      }
    } else {
      // Linked actor or no token - update the base actor
      await targetActor.update(updates);

      // Force token bars to refresh
      const activeTokens = targetActor.getActiveTokens();
      for (const token of activeTokens) {
        token.drawBars();
      }
    }
  } catch (error) {
    console.error("FASERIP Socket | Error updating actor:", error);
    return null;
  }

  const returnResult = {
    armorDamage: result.armorDamage,
    healthDamage: result.healthDamage,
    newArmorValue: result.newArmorValue,
    newHealthValue: result.newHealthValue,
    piercingResult: result.piercingResult
  };

  return returnResult;
}

/**
 * Life-link: apply a pre-computed, already-mitigated health-damage share to
 * a bonded actor (armor/resistance were already applied once to the original
 * target in handleApplyDamage - this is a raw health subtraction only, no
 * second mitigation pass). Routed through socket like requestDamageApplication
 * so it lands on the redirect actor's own owner's client.
 */
async function requestLifeLinkRedirect(
  targetActor: FaseripActor,
  amount: number
): Promise<void> {
  const data = { targetActorId: targetActor.id!, amount };

  if (!socket) {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      await handleApplyLifeLinkRedirect(data);
    }
    return;
  }

  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    await handleApplyLifeLinkRedirect(data);
    return;
  }

  await socket.executeAsUser("applyLifeLinkRedirect", owner.id, data);
}

async function handleApplyLifeLinkRedirect(data: {
  targetActorId: string;
  amount: number;
}): Promise<void> {
  // @ts-expect-error - Foundry game.actors collection
  const targetActor = game.actors?.get(data.targetActorId) as
    | FaseripActor
    | undefined;
  if (!targetActor) {
    console.error("FASERIP Socket | Life-link redirect target not found");
    return;
  }

  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own life-link redirect target"
    );
    return;
  }

  const system = targetActor.system as any;
  let currentFormId = system.currentFormId;
  if (!currentFormId && system.forms?.length > 0) {
    const primaryForm = system.forms.find((f: any) => f.isPrimary);
    currentFormId = primaryForm ? primaryForm.id : system.forms[0].id;
  }
  if (!currentFormId) currentFormId = "default";

  const healthByForm = system.healthByForm || {};
  const currentHealth =
    healthByForm[currentFormId] ?? system.resources?.health?.value ?? 0;
  const newHealthValue = Math.max(-20, currentHealth - data.amount);

  await targetActor.update({
    [`system.healthByForm.${currentFormId}`]: newHealthValue
  } as Record<string, unknown>);

  if (newHealthValue <= -20) {
    await targetActor.toggleStatusEffect("dead", { active: true });
  }

  for (const token of targetActor.getActiveTokens()) {
    token.drawBars();
  }
}

async function handleApplyStatDebuff(
  data: ApplyStatDebuffData
): Promise<ApplyStatDebuffData | null> {
  let targetActor: FaseripActor | undefined;

  if (data.targetTokenId) {
    const token = canvas?.tokens?.placeables.find(
      (t: Token) => t.id === data.targetTokenId
    );
    if (token) {
      targetActor = token.actor as FaseripActor;
    }
  }

  if (!targetActor) {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found for stat debuff");
    return null;
  }

  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - cannot apply stat debuff"
    );
    return null;
  }

  await applyTemporaryModifier(targetActor, {
    kind: "stat",
    attribute: data.attribute as any,
    chartShift: data.chartShift,
    roundsRemaining: data.roundsRemaining,
    sourceName: data.sourcePowerName,
    sourcePowerId: data.sourcePowerId
  });

  return data;
}

async function handleApplyDamageBuff(
  data: ApplyDamageBuffData
): Promise<ApplyDamageBuffData | null> {
  let targetActor: FaseripActor | undefined;

  if (data.targetTokenId) {
    const token = canvas?.tokens?.placeables.find(
      (t: Token) => t.id === data.targetTokenId
    );
    if (token) {
      targetActor = token.actor as FaseripActor;
    }
  }

  if (!targetActor) {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found for damage buff");
    return null;
  }

  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - cannot apply damage buff"
    );
    return null;
  }

  await applyTemporaryModifier(targetActor, {
    kind: "damage",
    chartShift: data.chartShift,
    roundsRemaining: data.roundsRemaining,
    sourceName: data.sourcePowerName,
    sourcePowerId: data.sourcePowerId,
    sourceWeaponId: data.sourceWeaponId,
    sourceWeaponName: data.sourceWeaponName
  });

  return data;
}

export async function requestDamageBuffApplication(
  targetActor: FaseripActor,
  data: ApplyDamageBuffData
): Promise<ApplyDamageBuffData | null> {
  if (!socket) {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleApplyDamageBuff(data);
    }
    return null;
  }

  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    return await handleApplyDamageBuff(data);
  }

  return await socket.executeAsUser("applyDamageBuff", owner.id, data);
}

async function handleApplyStatusEffect(
  data: ApplyStatusEffectData
): Promise<ApplyStatusEffectData | null> {
  let targetActor: FaseripActor | undefined;

  if (data.targetTokenId) {
    const token = canvas?.tokens?.placeables.find(
      (t: Token) => t.id === data.targetTokenId
    );
    if (token) {
      targetActor = token.actor as FaseripActor;
    }
  }

  if (!targetActor) {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found for status effect");
    return null;
  }

  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn(
      "FASERIP Socket | User doesn't own target - cannot apply status effect"
    );
    return null;
  }

  await applyTemporaryModifier(targetActor, {
    kind: "status",
    chartShift: 0,
    roundsRemaining: data.roundsRemaining,
    indefinite: data.indefinite,
    statusId: data.statusId,
    sourceName: data.sourcePowerName,
    sourcePowerId: data.sourcePowerId,
    sourceWeaponId: data.sourceWeaponId,
    sourceWeaponName: data.sourceWeaponName
  });

  return data;
}

export async function requestStatusEffectApplication(
  targetActor: FaseripActor,
  data: ApplyStatusEffectData
): Promise<ApplyStatusEffectData | null> {
  if (!socket) {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleApplyStatusEffect(data);
    }
    return null;
  }

  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    return await handleApplyStatusEffect(data);
  }

  return await socket.executeAsUser("applyStatusEffect", owner.id, data);
}

async function handleApplyDot(data: ApplyDotData): Promise<ApplyDotData | null> {
  let targetActor: FaseripActor | undefined;

  if (data.targetTokenId) {
    const token = canvas?.tokens?.placeables.find(
      (t: Token) => t.id === data.targetTokenId
    );
    if (token) {
      targetActor = token.actor as FaseripActor;
    }
  }

  if (!targetActor) {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found for DoT");
    return null;
  }

  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && !targetActor.isOwner) {
    console.warn("FASERIP Socket | User doesn't own target - cannot apply DoT");
    return null;
  }

  await applyTemporaryModifier(targetActor, {
    kind: "dot",
    chartShift: 0,
    roundsRemaining: data.roundsRemaining,
    indefinite: data.indefinite,
    dotRank: data.dotRank,
    dotDamage: data.dotDamage,
    dotArmorPiercing: data.armorPiercing ?? null,
    dotCasterActorId: data.casterActorId ?? null,
    sourceName: data.sourcePowerName,
    sourcePowerId: data.sourcePowerId,
    sourceWeaponId: data.sourceWeaponId,
    sourceWeaponName: data.sourceWeaponName
  });

  return data;
}

export async function requestDotApplication(
  targetActor: FaseripActor,
  data: ApplyDotData
): Promise<ApplyDotData | null> {
  if (!socket) {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      return await handleApplyDot(data);
    }
    return null;
  }

  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    return await handleApplyDot(data);
  }

  return await socket.executeAsUser("applyDot", owner.id, data);
}

interface RemoveDotData {
  targetActorId: string;
  targetTokenId?: string | null;
  effectId: string;
}

/**
 * Removes a DoT ActiveEffect. Unlike other temporary-modifier removal (which
 * is GM-only via EffectsTab), any connected player may request this - a DoT
 * is meant to be curable by an ally's character, not just the GM or the
 * afflicted actor's own owner. Permission is enforced by always executing the
 * actual delete on a client that does have write access to the target
 * (its owner, or the GM as fallback), never on the requesting player's own
 * client.
 *
 * Resolves the target the same way handleApplyDamage/handleApplyDot do:
 * prefer the token's synthetic actor when a token ID is given, since an
 * unlinked token's effects live on its synthetic actor, not the world/base
 * actor that game.actors.find() would return.
 */
async function handleRemoveDot(
  data: RemoveDotData
): Promise<{ removed: boolean }> {
  let targetActor: FaseripActor | undefined;

  if (data.targetTokenId) {
    const token = canvas?.tokens?.placeables.find(
      (t: Token) => t.id === data.targetTokenId
    );
    if (token) {
      targetActor = token.actor as FaseripActor;
    }
  }

  if (!targetActor) {
    // @ts-expect-error - Foundry game.actors collection
    targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === data.targetActorId
    ) as FaseripActor | undefined;
  }

  if (!targetActor) {
    console.error("FASERIP Socket | Target actor not found for DoT removal");
    return { removed: false };
  }

  const effect = targetActor.effects.get(data.effectId);
  if (!effect) {
    // Already removed (e.g. round-tick expiry raced the request) - treat as success.
    return { removed: true };
  }

  await effect.delete();
  return { removed: true };
}

export async function requestDotRemoval(
  targetActor: FaseripActor,
  effectId: string
): Promise<boolean> {
  // @ts-expect-error - Foundry token property may exist on synthetic actors
  const targetTokenId: string | null = targetActor.token?.id ?? null;
  const data: RemoveDotData = {
    targetActorId: targetActor.id!,
    targetTokenId,
    effectId
  };

  if (!socket) {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM || targetActor.isOwner) {
      const result = await handleRemoveDot(data);
      return result.removed;
    }
    return false;
  }

  // @ts-expect-error - Foundry game.user global
  if (game.user?.isGM || targetActor.isOwner) {
    const result = await handleRemoveDot(data);
    return result.removed;
  }

  const owner = findTokenControllers(targetActor)[0];
  if (!owner) {
    // No connected owner/GM to route the delete through.
    return false;
  }

  const result = await socket.executeAsUser("removeDot", owner.id, data);
  return result?.removed ?? false;
}
