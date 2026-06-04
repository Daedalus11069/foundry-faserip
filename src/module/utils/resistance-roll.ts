/**
 * Resistance roll system for FASERIP
 * Uses Universal Table color results to determine damage reduction
 */

import { Rank, RollResult, RANK_SHORTS, UNIVERSAL_TABLE } from "../enums";
import type { FaseripActor } from "../documents";

export interface ResistanceRollResult {
  /** Original incoming damage */
  incomingDamage: number;
  /** Resistance value (flat reduction) */
  resistanceValue: number;
  /** Damage exceeding flat resistance */
  overflowDamage: number;
  /** Final damage after resistance roll */
  finalDamage: number;
  /** Amount of damage resisted by roll (after flat reduction) */
  damageResistedByRoll: number;
  /** Total damage resisted (flat + roll) */
  totalDamageResisted: number;
  /** Percentage of overflow damage resisted by roll (0-75%) */
  resistancePercent: number;
  /** Resistance rank used */
  resistanceRank: Rank | string;
  /** Raw d100 roll value (undefined if no roll needed) */
  rollValue?: number;
  /** Universal Table color result (undefined if no roll needed) */
  colorResult?: RollResult;
  /** Resistance power that was used */
  resistancePower?: any;
  /** Whether damage was completely blocked by flat resistance */
  completelyBlocked: boolean;
}

/**
 * Roll resistance against incoming damage
 * Two-stage process:
 * 1. Flat reduction equal to resistance value
 * 2. Roll on Universal Table to reduce overflow damage based on color:
 *    - White: 0% reduction (full overflow)
 *    - Green: 25% reduction (3/4 overflow)
 *    - Yellow: 50% reduction (1/2 overflow)
 *    - Red: 75% reduction (1/4 overflow)
 */
export async function rollResistance(
  actor: FaseripActor,
  damageType: string,
  incomingDamage: number,
  currentFormId: string
): Promise<ResistanceRollResult | undefined> {
  const system = actor.system as any;

  // Find matching resistance power
  const resistancePower = (system.powers || []).find(
    (p: any) =>
      p.resistanceType === damageType &&
      (!p.formIds?.length || p.formIds.includes(currentFormId))
  );

  if (!resistancePower) {
    return undefined;
  }

  // Get resistance value (flat reduction)
  const resistanceValue = resistancePower.value || 0;
  const resistanceRank = resistancePower.rank as Rank | string;

  // Stage 1: Apply flat resistance
  const overflowDamage = Math.max(0, incomingDamage - resistanceValue);

  // If no overflow, resistance completely blocks damage
  if (overflowDamage === 0) {
    return {
      incomingDamage,
      resistanceValue,
      overflowDamage: 0,
      finalDamage: 0,
      damageResistedByRoll: 0,
      totalDamageResisted: incomingDamage,
      resistancePercent: 0,
      resistanceRank,
      resistancePower,
      completelyBlocked: true
    };
  }

  // Stage 2: Roll on Universal Table for overflow damage
  const rankShort = RANK_SHORTS[resistanceRank as Rank] || "ty";
  const ranges = UNIVERSAL_TABLE[rankShort];

  if (!ranges) {
    console.warn(`No Universal Table entry for rank: ${resistanceRank}`);
    // No roll - overflow goes through
    return {
      incomingDamage,
      resistanceValue,
      overflowDamage,
      finalDamage: overflowDamage,
      damageResistedByRoll: 0,
      totalDamageResisted: resistanceValue,
      resistancePercent: 0,
      resistanceRank,
      resistancePower,
      completelyBlocked: false
    };
  }

  // Roll d100
  const roll = await Roll.create("1d100");
  await roll.evaluate();
  const rollValue = roll.total || 0;

  // Determine color result
  const [greenStart, yellowStart, redStart] = ranges;
  let colorResult: RollResult;
  if (rollValue < greenStart) colorResult = RollResult.White;
  else if (rollValue < yellowStart) colorResult = RollResult.Green;
  else if (rollValue < redStart) colorResult = RollResult.Yellow;
  else colorResult = RollResult.Red;

  // Calculate percentage reduction of OVERFLOW damage based on color
  let resistancePercent = 0;
  switch (colorResult) {
    case RollResult.Red:
      resistancePercent = 75; // 1/4 overflow (75% reduction)
      break;
    case RollResult.Yellow:
      resistancePercent = 50; // 1/2 overflow (50% reduction)
      break;
    case RollResult.Green:
      resistancePercent = 25; // 3/4 overflow (25% reduction)
      break;
    case RollResult.White:
    default:
      resistancePercent = 0; // Full overflow (no reduction)
      break;
  }

  const damageResistedByRoll = Math.floor(
    (overflowDamage * resistancePercent) / 100
  );
  const finalDamage = overflowDamage - damageResistedByRoll;
  const totalDamageResisted = resistanceValue + damageResistedByRoll;

  return {
    incomingDamage,
    resistanceValue,
    overflowDamage,
    finalDamage,
    damageResistedByRoll,
    totalDamageResisted,
    resistancePercent,
    resistanceRank,
    rollValue,
    colorResult,
    resistancePower,
    completelyBlocked: false
  };
}

/**
 * Get CSS class for resistance roll color result
 */
export function getResistanceResultClass(colorResult: RollResult): string {
  switch (colorResult) {
    case RollResult.Red:
      return "fsr-roll-red";
    case RollResult.Yellow:
      return "fsr-roll-yellow";
    case RollResult.Green:
      return "fsr-roll-green";
    case RollResult.White:
    default:
      return "fsr-roll-white";
  }
}

/**
 * Get descriptive text for resistance roll result
 */
export function describeResistanceResult(result: ResistanceRollResult): string {
  const {
    incomingDamage,
    resistanceValue,
    overflowDamage,
    finalDamage,
    totalDamageResisted,
    colorResult,
    resistancePercent,
    completelyBlocked
  } = result;

  if (completelyBlocked) {
    return `Resistance (${resistanceValue}) completely blocks ${incomingDamage} damage`;
  }

  const colorText = colorResult?.toUpperCase() || "UNKNOWN";
  const reductionText =
    resistancePercent > 0 ? `${resistancePercent}% reduction` : "no reduction";

  return `${incomingDamage} damage - ${resistanceValue} resistance = ${overflowDamage} overflow. ${colorText} roll: ${reductionText} → ${finalDamage} final damage (${totalDamageResisted} total resisted)`;
}
