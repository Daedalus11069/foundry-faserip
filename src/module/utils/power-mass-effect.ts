/**
 * "Mass Effect" powers
 *
 * A power with `massEffect.enabled` isn't rolled against a single defender.
 * Using it affects every token in range (scope "area") or every targeted
 * token (scope "targets"), and each affected actor gets a resist roll on one
 * of its own attributes (e.g. an Intuition FEAT against Hypnotic Voice).
 * Anyone who fails has the power's status effects applied. The resist roll
 * runs on each affected actor's owner's client through the normal roll flow,
 * so every owner chooses whether to spend karma.
 *
 * Range works in steps: inside `baseRangeFeet` the power is at full strength;
 * every further `falloffFeet` is one step of weakening (-1CS in the source
 * powers), and each step lowers the result a target needs to resist by one
 * tier. Once that tier reaches "any roll resists" the target is effectively
 * out of range. `falloffFeet` 0 means a hard cutoff at `baseRangeFeet`.
 */
import type { FaseripActor } from "../documents";
import type { PowerData, PowerMassEffectData } from "../types/actor-system";
import { requestResistRoll } from "../socket/faserip-socket";
import {
  applyHitDamageOverTime,
  applyHitStatusEffect
} from "../combat/combat-flow";
import { stringToRank } from "../utils";

const RESULT_TIER: Record<string, number> = { green: 1, yellow: 2, red: 3 };

function tokenDistance(a: Token, b: Token): number {
  const grid = canvas?.grid;
  if (grid?.measurePath) {
    return grid.measurePath([a.center, b.center], {})?.distance ?? 0;
  }
  const dx = a.center.x - b.center.x;
  const dy = a.center.y - b.center.y;
  const gridSize = canvas?.grid?.size ?? 100;
  const gridDistance = canvas?.scene?.grid?.distance ?? 5;
  return (Math.sqrt(dx * dx + dy * dy) / gridSize) * gridDistance;
}

/** Steps of weakening at a distance, or null when out of range. */
export function getMassEffectSteps(
  distanceFeet: number,
  config: Pick<PowerMassEffectData, "baseRangeFeet" | "falloffFeet">
): number | null {
  if (distanceFeet <= config.baseRangeFeet) return 0;
  if (config.falloffFeet <= 0) return null;
  return Math.ceil((distanceFeet - config.baseRangeFeet) / config.falloffFeet);
}

export async function activateMassEffect(
  actor: FaseripActor,
  power: PowerData
): Promise<void> {
  const config = power.massEffect;
  if (!config?.enabled) return;

  const ownerToken = actor.getActiveTokens(true)[0] as Token | undefined;
  if (config.scope === "area" && !ownerToken) {
    ui.notifications?.warn(
      `${actor.name} has no token on the active scene, so ${power.name} has no origin.`
    );
    return;
  }

  // @ts-expect-error - game.user.targets is a Set
  const targeted = Array.from(game.user?.targets ?? []) as Token[];
  if (config.scope === "targets" && targeted.length === 0) {
    ui.notifications?.warn(
      `${power.name} needs targets. Select one or more target tokens first.`
    );
    return;
  }

  const candidates: Token[] =
    config.scope === "targets"
      ? targeted
      : // @ts-expect-error - canvas.tokens placeables
        ((canvas.tokens?.placeables ?? []) as Token[]);

  const affected: string[] = [];
  const resisted: string[] = [];
  const outOfRange: string[] = [];

  // Work out who is hit and what they need to roll, then roll for everyone
  // at once so one player's open prompt doesn't hold up the rest.
  type Pending = { token: Token; targetActor: FaseripActor; label: string };
  const pending: Array<Pending & { required: number }> = [];
  const unrolled: Pending[] = [];

  for (const token of candidates) {
    const targetActor = token.actor as FaseripActor | null;
    if (!targetActor) continue;
    if (token.id === ownerToken?.id && !config.includeSelf) continue;

    // Distance only matters for area powers; targeted powers hit whoever is
    // targeted, wherever they are.
    let steps: number | null = 0;
    if (config.scope === "area" && ownerToken) {
      steps = getMassEffectSteps(tokenDistance(ownerToken, token), config);
      if (steps === null) continue;
    }

    const label = token.name ?? targetActor.name ?? "Unknown";
    if (!config.resistAttribute) {
      unrolled.push({ token, targetActor, label });
      continue;
    }

    const required = (RESULT_TIER[config.resistResult] ?? 1) - (steps ?? 0);
    if (required <= 0) {
      // Weakened past the point where any roll resists it
      outOfRange.push(label);
      continue;
    }
    pending.push({ token, targetActor, label, required });
  }

  const outcomes = await Promise.all(
    pending.map(async p => ({
      p,
      result: await requestResistRoll(p.targetActor, p.token.id, {
        attribute: config.resistAttribute,
        powerName: power.name,
        sourceName: actor.name ?? "Someone"
      })
    }))
  );

  const toAffect: Pending[] = [...unrolled];
  for (const { p, result } of outcomes) {
    if (result.rolled && result.tier >= p.required) {
      resisted.push(p.label);
    } else {
      toAffect.push(p);
    }
  }

  for (const { token, targetActor, label } of toAffect) {
    for (const se of power.statusEffects ?? []) {
      await applyHitStatusEffect(targetActor, token.id!, se, {
        powerName: power.name,
        attacker: actor as any
      });
    }
    // Damage-over-time ticks at the power's rank, same as a normal hit
    for (const d of power.dots ?? []) {
      await applyHitDamageOverTime(targetActor, token.id!, d, {
        powerName: power.name,
        powerRank: stringToRank(power.rank),
        attacker: actor as any
      });
    }
    affected.push(label);
  }

  const list = (names: string[]) => (names.length ? names.join(", ") : "none");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="fsr-combat-message" style="padding: 0.5rem; border-radius: 4px;">
      <strong>${actor.name} uses ${power.name}</strong>
      <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;"><strong>Affected:</strong> ${list(affected)}</p>
      <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;"><strong>Resisted:</strong> ${list(resisted)}</p>
      ${outOfRange.length ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;"><strong>Too weak to affect:</strong> ${list(outOfRange)}</p>` : ""}
    </div>`
  });
}
