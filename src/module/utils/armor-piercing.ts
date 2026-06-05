/**
 * Armor piercing calculation utility for FASERIP system
 * Armor piercing is a flat reduction from the armor value
 */

import { RANK_VALUES, Rank } from "../enums";

export interface ArmorPiercingResult {
  originalArmor: number;
  piercingValue: number;
  effectiveArmor: number;
}

/**
 * Calculate effective armor after armor-piercing is applied
 *
 * Simple flat reduction system:
 * - Armor piercing value is subtracted directly from total armor
 *
 * Example: 10 armor pierce vs 30 armor
 * - Effective armor: 30 - 10 = 20
 *
 * @param totalArmor - Total armor value (from equipped armor + Body Armor power)
 * @param armorRank - Rank of the armor (not used in calculation, kept for compatibility)
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
      piercingValue: 0,
      effectiveArmor: totalArmor
    };
  }

  // Get piercing value from rank
  const piercingValue = RANK_VALUES[piercingRank as Rank] ?? 0;

  // Subtract piercing from armor (minimum 0)
  const effectiveArmor = Math.max(0, totalArmor - piercingValue);

  return {
    originalArmor: totalArmor,
    piercingValue,
    effectiveArmor
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

  return `-${result.piercingValue} armor piercing`;
}
