/**
 * "Target Armor" attack option: aim at a target's armor instead of their body.
 * The attack ignores armor piercing and always wears the armor down, and any
 * damage beyond the armor's capacity spills over to the target's health. The
 * trade-off is a chart-shift penalty to hit, and (by default) access is gated
 * behind a talent.
 */

import type { FaseripActor } from "../documents";
import type { Talent } from "../types";

/** Default name of the talent that unlocks armor targeting (configurable in settings). */
export const DEFAULT_ARMOR_TARGETING_TALENT = "Sunder";

/** Configured talent name (matched case-insensitively) that unlocks armor targeting. */
export function getArmorTargetingTalentName(): string {
  const name = game.settings.get("faserip", "armorTargetingTalent") as string;
  return name?.trim() || DEFAULT_ARMOR_TARGETING_TALENT;
}

export type ArmorTargetingMode = "off" | "talent" | "anyone";

export interface ArmorTargetingAccess {
  allowed: boolean;
  /** Chart-shift penalty applied to the attack roll while targeting armor. */
  penalty: number;
  /** Why it is unavailable, shown in the attack dialog. */
  reason?: string;
}

export function hasArmorTargetingTalent(actor: FaseripActor): boolean {
  const talents: Talent[] = (actor as any)?.system?.talents ?? [];
  const activeFormId = (actor as any).getCurrentForm?.()?.id;
  const talentName = getArmorTargetingTalentName().toLowerCase();
  return talents.some(
    t =>
      t.name?.trim().toLowerCase() === talentName &&
      (!t.formIds?.length || (activeFormId && t.formIds.includes(activeFormId)))
  );
}

export function getArmorTargetingAccess(
  actor?: FaseripActor | null
): ArmorTargetingAccess {
  const mode = (game.settings.get("faserip", "armorTargeting") ??
    "talent") as ArmorTargetingMode;
  const penalty = Math.max(
    0,
    Number(game.settings.get("faserip", "armorTargetingPenalty") ?? 0)
  );

  if (mode === "off") {
    return {
      allowed: false,
      penalty,
      reason: "Armor targeting is disabled in this world."
    };
  }
  if (mode === "talent" && !(actor && hasArmorTargetingTalent(actor))) {
    return {
      allowed: false,
      penalty,
      reason: `Requires the ${getArmorTargetingTalentName()} talent.`
    };
  }
  return { allowed: true, penalty };
}
