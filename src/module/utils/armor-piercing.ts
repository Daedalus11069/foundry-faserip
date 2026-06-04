/**
 * Armor piercing calculation utility for FASERIP system
 * Implements hybrid armor-piercing: flat reduction + percentage bypass
 */

import { RANK_VALUES, RANK_ORDER, Rank } from "../enums";

export interface ArmorPiercingResult {
  originalArmor: number;
  flatReduction: number;
  remainingAfterFlat: number;
  percentageBypass: number;
  effectiveArmor: number;
  rankSteps: number;
}

/**
 * Calculate effective armor after armor-piercing is applied
 *
 * Uses hybrid system:
 * 1. Flat reduction: (piercing rank value - armor rank value) subtracted from total armor
 * 2. Percentage bypass: 10% per rank step higher, max 50%
 *
 * Example: Excellent (20) piercing vs Good (10) armor with 30 total armor
 * - Flat reduction: 20 - 10 = 10 points removed → 20 armor remains
 * - Rank difference: 2 steps (Good → Excellent → Remarkable)
 * - Percentage bypass: 2 × 10% = 20%
 * - Effective armor: 20 × 0.8 = 16
 *
 * @param totalArmor - Total armor value (from equipped armor + Body Armor power)
 * @param armorRank - Rank of the armor (typically from armor item's rank field)
 * @param piercingRank - Armor-piercing rank of the attack (from weapon/power)
 * @returns Detailed breakdown of armor reduction
 */
export function calculateArmorPiercing(
  totalArmor: number,
  armorRank: Rank | string,
  piercingRank?: Rank | string
): ArmorPiercingResult {
  // No piercing = full armor applies
  if (!piercingRank || piercingRank === "") {
    return {
      originalArmor: totalArmor,
      flatReduction: 0,
      remainingAfterFlat: totalArmor,
      percentageBypass: 0,
      effectiveArmor: totalArmor,
      rankSteps: 0
    };
  }

  // Get rank values
  const piercingValue = RANK_VALUES[piercingRank as Rank] ?? 0;
  const armorValue = RANK_VALUES[armorRank as Rank] ?? 0;

  // Step 1: Flat reduction (pierce value - armor value, minimum 0)
  const flatReduction = Math.max(0, piercingValue - armorValue);
  const remainingAfterFlat = Math.max(0, totalArmor - flatReduction);

  // Step 2: Calculate rank steps difference
  const piercingIndex = RANK_ORDER.indexOf(piercingRank as Rank);
  const armorIndex = RANK_ORDER.indexOf(armorRank as Rank);
  const rankSteps = Math.max(0, piercingIndex - armorIndex);

  // Step 3: Percentage bypass (10% per rank step, max 50%)
  const percentageBypass = Math.min(50, rankSteps * 10);

  // Step 4: Apply percentage to remaining armor
  const effectiveArmor = Math.floor(
    remainingAfterFlat * (1 - percentageBypass / 100)
  );

  return {
    originalArmor: totalArmor,
    flatReduction,
    remainingAfterFlat,
    percentageBypass,
    effectiveArmor,
    rankSteps
  };
}

/**
 * Get a human-readable description of armor piercing effects
 * Used for chat messages and tooltips
 */
export function describeArmorPiercing(result: ArmorPiercingResult): string {
  if (result.effectiveArmor === result.originalArmor) {
    return "No armor piercing";
  }

  const parts: string[] = [];

  if (result.flatReduction > 0) {
    parts.push(`-${result.flatReduction} flat reduction`);
  }

  if (result.percentageBypass > 0) {
    parts.push(`-${result.percentageBypass}% bypass (${result.rankSteps} CS)`);
  }

  const totalReduction = result.originalArmor - result.effectiveArmor;
  parts.push(`= ${totalReduction} total reduced`);

  return parts.join(", ");
}
