/**
 * "Blend In" stealth mechanic
 *
 * A power flagged `blendIn` makes its owner's token client-hidden: nobody
 * (other than the GM and the owner) can see the token until they succeed on
 * an Intuition FEAT roll to spot it. The power's rank sets a base range from
 * BLEND_IN_RANGE_FEET (higher rank = smaller base radius = a better blend),
 * and activating it rolls the power itself (like any other power roll) to
 * scale that range for the duration:
 *   Green  -> half effectiveness (range x0.5)
 *   Yellow -> normal effectiveness (range x1)
 *   Red    -> double effectiveness (range x2)
 *   100    -> triple effectiveness (range x3)
 *   White  -> the blend fails to take hold at all
 * Difficulty for the observer then scales with distance from that rolled
 * range:
 *   distance <= range       -> Green or better spots it
 *   distance <= range * 2   -> Yellow or better spots it
 *   distance <= range * 4   -> Red or better spots it
 *   distance >= range * 8   -> automatic spot (no roll needed)
 * Between 4x and 8x the Red threshold still applies.
 */
import { Rank, BLEND_IN_RANGE_FEET, RollResult } from "../enums";
import { stringToRank } from "../utils";
import type { FaseripActor } from "../documents";
import type { PowerData } from "../types/actor-system";
import { FaseripRoll } from "../rolling/FaseripRoll";
import { showKarmaSpendDialog } from "../applications/dialog-utils";
import { getEffectiveAttributeData } from "./stat-debuffs";
import {
  requestBlendInStateChange,
  requestBlendInReveal
} from "../socket/faserip-socket";

export interface BlendInFlag {
  active: boolean;
  baseRangeFt: number; // raw range from the power's rank, before the activation roll
  rangeFt: number; // effective range after the activation roll's multiplier - what spotting checks use
  sourceItemId?: string;
  sourceItemName?: string;
  spottedBy: string[]; // user ids who have already spotted this token
  indefinite: boolean; // true when blendInDurationFormula was blank - stays active until manually toggled off
  roundsRemaining: number; // ignored when indefinite; ticked down each combat round by tickBlendInDurations
}

/**
 * Effectiveness multiplier applied to a Blend In power's base range based on
 * its activation roll: Green halves it, Yellow keeps it as-is, Red doubles
 * it, and a natural 100 triples it. White is not a multiplier - it means
 * the blend failed to activate at all (see activateBlendIn).
 */
export function getBlendEffectivenessMultiplier(
  result: RollResult,
  rollTotal: number
): number {
  if (rollTotal === 100) return 3;
  if (result === RollResult.Red) return 2;
  if (result === RollResult.Yellow) return 1;
  if (result === RollResult.Green) return 0.5;
  return 0;
}

const RESULT_ORDER: RollResult[] = [
  RollResult.White,
  RollResult.Green,
  RollResult.Yellow,
  RollResult.Red
];

function resultMeetsOrExceeds(
  result: RollResult,
  required: RollResult
): boolean {
  return RESULT_ORDER.indexOf(result) >= RESULT_ORDER.indexOf(required);
}

/**
 * Base range (in feet) a blend-in power grants, derived from the power's rank.
 */
export function getBlendBaseRange(rank: string | Rank): number {
  const rankEnum = typeof rank === "string" ? stringToRank(rank) : rank;
  return (
    BLEND_IN_RANGE_FEET[rankEnum as Rank] ?? BLEND_IN_RANGE_FEET[Rank.Typical]
  );
}

/**
 * Required Intuition FEAT result to spot a blending token from a given
 * distance, or "auto" if the distance is far enough that a spot is granted
 * without a roll.
 */
export function getRequiredSpotResult(
  distanceFt: number,
  baseRangeFt: number
): RollResult | "auto" {
  if (distanceFt >= baseRangeFt * 8) return "auto";
  if (distanceFt > baseRangeFt * 2) return RollResult.Red;
  if (distanceFt > baseRangeFt) return RollResult.Yellow;
  return RollResult.Green;
}

/**
 * Turn blend-in off for a token. GM-mediated so any client can trigger it
 * (e.g. from the power's item sheet) regardless of token ownership.
 */
export async function deactivateBlendIn(
  tokenDoc: TokenDocument
): Promise<void> {
  await requestBlendInStateChange(tokenDoc, null);
}

/**
 * Activate a Blend In power: rolls the power itself (like any other power
 * roll - full FEAT roll, karma, chart shifts, chat card) to determine how
 * effective this attempt at blending in is, then stores the resulting range
 * on the token's flag. GM-mediated so any client can trigger it regardless
 * of token ownership. Returns false (and never activates) on a White result.
 */
export async function activateBlendIn(
  tokenDoc: TokenDocument,
  actor: FaseripActor,
  power: Pick<
    PowerData,
    "id" | "name" | "rank" | "value" | "blendInDurationFormula"
  >
): Promise<boolean> {
  const rank = stringToRank(power.rank || Rank.Typical);
  const rankValue = power.value || 6;

  // rollAttribute normally prompts for karma twice in sequence (once before
  // rolling, once after seeing the result) - the same combined-dialog
  // treatment attacks get via ActionOptionsDialog (deciding both the
  // pre-roll column shift and the post-roll die modifier up front, before
  // rolling). Ask once here with the "combined" phase and hand both answers
  // to rollAttribute as pre-specified shifts so it skips its own internal
  // prompts entirely.
  const availableKarma = (actor as any).system?.resources?.karma?.value || 0;
  const karmaResult =
    availableKarma > 0
      ? await showKarmaSpendDialog(availableKarma, "combined", undefined, rank)
      : null;

  const roll = await FaseripRoll.rollAttribute(
    power.name,
    rank,
    rankValue,
    0,
    actor,
    undefined,
    undefined,
    karmaResult?.columnShifts || 0,
    karmaResult?.dieModifier || 0,
    false,
    karmaResult?.manualChartShift || 0
  );
  if (!roll) return false;

  const rollTotal = roll.roll.total || 0;
  const multiplier = getBlendEffectivenessMultiplier(roll.result, rollTotal);

  if (multiplier <= 0) {
    ui.notifications?.warn(
      `${power.name} fails to take hold - the blend doesn't activate.`
    );
    return false;
  }

  const durationFormula = (power.blendInDurationFormula || "").trim();
  let indefinite = true;
  let roundsRemaining = 0;
  if (durationFormula && durationFormula !== "indefinite") {
    const durationRoll = Roll.create(durationFormula);
    await durationRoll.evaluate();
    await durationRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>${power.name}</strong> Blend Duration Roll (${durationFormula})`
    });
    roundsRemaining = Math.max(1, Math.floor(durationRoll.total || 1));
    indefinite = false;
  }

  const baseRangeFt = getBlendBaseRange(power.rank);
  const flag: BlendInFlag = {
    active: true,
    baseRangeFt,
    rangeFt: Math.max(1, Math.round(baseRangeFt * multiplier)),
    sourceItemId: power.id,
    sourceItemName: power.name,
    spottedBy: [],
    indefinite,
    roundsRemaining
  };
  await requestBlendInStateChange(tokenDoc, flag);
  return true;
}

/**
 * Tick down roundsRemaining on every active, non-indefinite Blend In token
 * flag by one, deactivating (and posting a chat notice) any that hit zero.
 * Called from the same GM-only updateCombat round-change handler that ticks
 * other round-based systems (see faserip.ts).
 */
export async function tickBlendInDurations(): Promise<void> {
  // @ts-expect-error - Foundry game.scenes global
  for (const scene of game.scenes ?? []) {
    for (const tokenDoc of Array.from(scene.tokens ?? [])) {
      const flag = getBlendInFlag(tokenDoc as unknown as TokenDocument);
      if (!flag?.active || flag.indefinite) continue;

      const next = flag.roundsRemaining - 1;
      if (next > 0) {
        await (tokenDoc as any).setFlag("faserip", "blendIn", {
          ...flag,
          roundsRemaining: next
        });
        continue;
      }

      await (tokenDoc as any).unsetFlag("faserip", "blendIn");
      await ChatMessage.create({
        content: `<div class="fsr-combat-message" style="background: #134e4a; color: #99f6e4; padding: 0.5rem; border-radius: 4px;">
          <strong>${(tokenDoc as any).name}'s ${flag.sourceItemName || "Blend In"} fades</strong> - they're visible again.
        </div>`,
        speaker: { alias: (tokenDoc as any).name }
      });
    }
  }
}

export function getBlendInFlag(tokenDoc: TokenDocument): BlendInFlag | null {
  // @ts-expect-error - Foundry flag typing
  return tokenDoc.getFlag("faserip", "blendIn") ?? null;
}

/**
 * Distance in the scene's configured units between two tokens' centers.
 */
function measureTokenDistance(observer: Token, target: Token): number {
  const grid = canvas?.grid;
  if (!grid?.measurePath) {
    // Fallback: straight-line pixel distance converted via grid size/distance
    const dx = observer.center.x - target.center.x;
    const dy = observer.center.y - target.center.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);
    const gridSize = canvas?.grid?.size ?? 100;
    const gridDistance = canvas?.scene?.grid?.distance ?? 5;
    return (pixelDistance / gridSize) * gridDistance;
  }

  const result = grid.measurePath([observer.center, target.center], {});
  return result?.distance ?? 0;
}

/**
 * Have `observerActor` (controlled by the current user) attempt to spot a
 * blending target token. Rolls Intuition, compares against the required
 * tier for the current distance, and on success reveals the token to this
 * user via the GM.
 */
export async function attemptSpotBlendedToken(
  observerToken: Token,
  targetToken: Token,
  observerActor: FaseripActor
): Promise<void> {
  const flag = getBlendInFlag(targetToken.document as unknown as TokenDocument);
  if (!flag?.active) {
    ui.notifications?.info("That token isn't blending in.");
    return;
  }

  // @ts-expect-error - Foundry game.user global
  const userId: string = game.user.id;
  if (flag.spottedBy.includes(userId)) {
    ui.notifications?.info("You've already spotted them.");
    return;
  }

  const distance = measureTokenDistance(observerToken, targetToken);
  const required = getRequiredSpotResult(distance, flag.rangeFt);

  if (required === "auto") {
    await requestBlendInReveal(
      targetToken.document as unknown as TokenDocument,
      userId
    );
    ui.notifications?.info(
      "They're obviously nearby - you spot them without even trying."
    );
    return;
  }

  const intuition = getEffectiveAttributeData(observerActor, "intuition");
  if (!intuition) {
    ui.notifications?.warn("Observer has no Intuition score.");
    return;
  }

  const roll = await FaseripRoll.rollAttribute(
    "Intuition",
    intuition.rank,
    intuition.value,
    0,
    observerActor,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    0,
    `Spotting ${targetToken.name}`
  );

  if (resultMeetsOrExceeds(roll.result, required)) {
    await requestBlendInReveal(
      targetToken.document as unknown as TokenDocument,
      userId
    );
    ui.notifications?.info(`Spotted ${targetToken.name}!`);
  } else {
    ui.notifications?.info(`You don't see ${targetToken.name}.`);
  }
}

/**
 * Applies an ALREADY-rolled Intuition result against every active, unspotted
 * Blend In token on the current scene that `observerActor`'s controlled
 * token can measure a distance to, revealing any it qualifies to spot.
 *
 * This is what actually wires Blend In into normal play: rolling Intuition
 * from the character sheet (StatsTab's plain attribute-roll button) goes
 * through here afterward instead of requiring a separate "attempt to spot"
 * action or console command - the same roll that appears in chat is the one
 * that's checked, rather than silently doing nothing or requiring a second,
 * hidden roll the player never sees.
 */
export async function resolveBlendInSpotChecksFromRoll(
  observerActor: FaseripActor,
  result: RollResult
): Promise<void> {
  // @ts-expect-error - Foundry canvas global
  const observerToken = (canvas.tokens?.controlled ?? []).find(
    (t: Token) => t.actor?.id === observerActor.id
  ) ?? observerActor.getActiveTokens(true)[0];
  if (!observerToken) return;

  // @ts-expect-error - Foundry canvas global
  const candidates: Token[] = (canvas.tokens?.placeables ?? []).filter(
    (t: Token) => {
      if (t.id === observerToken.id) return false;
      const flag = getBlendInFlag(t.document as unknown as TokenDocument);
      // @ts-expect-error - Foundry game.user global
      return Boolean(flag?.active && !flag.spottedBy.includes(game.user.id));
    }
  );
  if (!candidates.length) return;

  // @ts-expect-error - Foundry game.user global
  const userId: string = game.user.id;

  for (const targetToken of candidates) {
    const flag = getBlendInFlag(targetToken.document as unknown as TokenDocument);
    if (!flag) continue;

    const distance = measureTokenDistance(observerToken, targetToken);
    const required = getRequiredSpotResult(distance, flag.rangeFt);

    const spotted = required === "auto" || resultMeetsOrExceeds(result, required);
    if (!spotted) continue;

    await requestBlendInReveal(
      targetToken.document as unknown as TokenDocument,
      userId
    );
    ui.notifications?.info(`Spotted ${targetToken.name}!`);
  }
}

function isVisibleToCurrentUser(token: Token, flag: BlendInFlag): boolean {
  // @ts-expect-error - Foundry game globals
  const isGM = game.user?.isGM;
  // @ts-expect-error - Foundry token owner check
  const isOwner = token.isOwner;
  // @ts-expect-error - Foundry game.user global
  const spotted = flag.spottedBy.includes(game.user.id);
  return Boolean(isGM || isOwner || spotted);
}

let warnedNoLibWrapper = false;

/**
 * Makes a blending token actually invisible on this client. Core Foundry
 * recomputes `Token#isVisible` (from vision/fog/sight, not from anything we
 * control) on every perception refresh and writes the result straight to
 * `token.visible` afterward - so setting `token.visible` ourselves from a
 * `refreshToken`/`drawToken` hook only wins until the next perception tick,
 * which silently reverts it back to visible a frame later. The reliable fix
 * is to wrap the getter core itself reads, via libWrapper, so our check is
 * baked into every visibility computation instead of racing it.
 */
export function registerBlendInVisibilityHook(): void {
  if (typeof (globalThis as any).libWrapper === "undefined") {
    if (!warnedNoLibWrapper) {
      warnedNoLibWrapper = true;
      console.warn(
        "faserip | libWrapper is not active - Blend In will not reliably hide tokens. Install and enable the libWrapper module."
      );
    }
    return;
  }

  (globalThis as any).libWrapper.register(
    "faserip",
    "Token.prototype.isVisible",
    function (
      this: Token,
      wrapped: (...args: any[]) => boolean,
      ...args: any[]
    ) {
      const baseVisible = wrapped(...args);
      if (!baseVisible) return baseVisible;

      const flag = getBlendInFlag(this.document as unknown as TokenDocument);
      if (!flag?.active) return baseVisible;

      return isVisibleToCurrentUser(this, flag);
    },
    "WRAPPER"
  );
}
