/**
 * Centralized damage application for FASERIP system
 * Handles armor soak, overflow, and updates to healthByForm
 */

import type { FaseripActor } from "../documents";
import { calculateHealth } from "../utils";
import { type ArmorItem, isArmorItem } from "../types/items";
import {
  calculateArmorPiercing,
  type ArmorPiercingResult
} from "./armor-piercing";
import { rollResistance, type ResistanceRollResult } from "./resistance-roll";
import { Rank, RANK_VALUES } from "../enums";

export interface DamageApplicationResult {
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
  armorDestroyed: boolean;
  bodyArmorDestroyed: boolean;
  resistanceRollResult?: ResistanceRollResult; // Resistance roll result (if resistance was triggered)
  vulnerabilityPower?: any; // Vulnerability power that was applied
  vulnerabilityIncrease?: number; // Amount of damage increased by vulnerability
  originalDamage?: number; // Original damage before resistance/vulnerability
  piercingResult?: ArmorPiercingResult; // Armor piercing breakdown

  /** @deprecated Use resistanceRollResult instead */
  resistancePower?: any;
  /** @deprecated Use resistanceRollResult.damageResisted instead */
  resistanceReduction?: number;
}

export interface DamageApplicationData {
  reactiveSystem?: any; // Optional reactive system data to modify directly (for sheets)
  actor: FaseripActor; // The real actor (for accessing items collection, or extracting system if reactiveSystem not provided)
  damage: number;
  damageType?: string;
  degradingArmorMode?: string; // "none", "full", "per-hit"
  armorPiercing?: string | null; // Armor-piercing rank (optional)
  armorRank?: string; // Target's armor rank (optional)
  hitCount?: number; // Number of hits that contributed to this damage (for per-hit degradation)
}

/**
 * Apply damage to an actor with armor soak and overflow calculation
 * If reactiveSystem is provided, modifies it directly (for sheets with watcher)
 * If only actor is provided, modifies actor.system (caller must persist with actor.update)
 * ALWAYS calls item.update() for armor items (Item documents must be updated individually)
 */
export async function applyDamageToActor(
  data: DamageApplicationData
): Promise<DamageApplicationResult> {
  const { actor, degradingArmorMode = "none" } = data;
  // Use reactiveSystem if provided, otherwise extract from actor
  const system = data.reactiveSystem || (actor.system as any);

  // Check for vulnerability powers (house rule)
  const vulnerabilityEnabled =
    game.settings.get("faserip", "vulnerabilityPowers") ?? false;
  let damage = data.damage;

  // Find correct form ID using same fallback logic as prepareDerivedData
  let currentFormId = system.currentFormId;
  if (!currentFormId && system.forms?.length > 0) {
    const primaryForm = system.forms.find((f: any) => f.isPrimary);
    currentFormId = primaryForm ? primaryForm.id : system.forms[0].id;
  }
  if (!currentFormId) {
    currentFormId = "default";
  }

  // Get current health from healthByForm
  const healthByForm = system.healthByForm || {};
  const currentHealth =
    healthByForm[currentFormId] ?? system.resources.health.value ?? 0;

  // Find armor sources (use Item documents for equipped armor)
  const bodyArmorPower = (system.powers || []).find(
    (p: any) =>
      p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
      (!p.formIds?.length || p.formIds.includes(currentFormId))
  );

  // Find equipped armor items from actor.items collection
  const equippedArmorItems = actor.items.filter(
    (item): item is ArmorItem => isArmorItem(item) && item.system.equipped
  );

  // Calculate total armor from body armor power + all equipped armor items
  const bodyArmorValue = bodyArmorPower?.value ?? 0;
  const equippedArmorValue = equippedArmorItems.reduce(
    (sum, item) => sum + (item.system.value || 0),
    0
  );
  const totalArmor = bodyArmorValue + equippedArmorValue;

  let armorDamage = 0;
  let healthDamage = 0;
  let overflow = 0;
  let armorDestroyed = false;
  let bodyArmorDestroyed = false;
  let resistanceRollResult: ResistanceRollResult | undefined;
  let vulnerabilityPower: any = undefined;
  let vulnerabilityIncrease = 0;
  const originalDamage = damage;
  let piercingResult: ArmorPiercingResult | undefined;

  // Calculate effective armor with piercing
  let effectiveArmor = totalArmor;

  if (data.armorPiercing && data.armorRank && totalArmor > 0) {
    piercingResult = calculateArmorPiercing(
      totalArmor,
      data.armorRank as Rank,
      data.armorPiercing as Rank
    );
    effectiveArmor = piercingResult.effectiveArmor;
  }

  // Apply vulnerability if enabled and matching power found
  if (vulnerabilityEnabled && data.damageType && data.damageType !== "none") {
    vulnerabilityPower = (system.powers || []).find(
      (p: any) =>
        p.vulnerabilityType === data.damageType &&
        (!p.formIds?.length || p.formIds.includes(currentFormId))
    );

    if (vulnerabilityPower) {
      // Vulnerability increases damage by configured percentage (house rule)
      const vulnerabilityPercent = game.settings.get(
        "faserip",
        "vulnerabilityDamageIncrease"
      ) as number;
      vulnerabilityIncrease = Math.floor(damage * (vulnerabilityPercent / 100));
      damage += vulnerabilityIncrease;
    }
  }

  if (effectiveArmor > 0) {
    // Armor soaks damage (using effective armor after piercing)
    armorDamage = Math.min(damage, effectiveArmor);
    overflow = damage - armorDamage;

    // Reduce armor values (EQUIPPED ARMOR FIRST, then body armor power)
    let remainingArmorDamage = armorDamage;

    // Apply armor degradation based on mode
    if (degradingArmorMode === "full") {
      // Full degradation: Reduce armor by damage soaked
      // Equipped armor items soak first (update each directly)
      for (const armorItem of equippedArmorItems) {
        if (remainingArmorDamage <= 0) break;

        const armorValue = armorItem.system.value || 0;
        const armorReduction = Math.min(remainingArmorDamage, armorValue);

        if (armorReduction > 0) {
          const newValue = Math.max(0, armorValue - armorReduction);
          await armorItem.update({
            "system.value": newValue
          } as Record<string, unknown>);
          remainingArmorDamage -= armorReduction;

          if (newValue === 0) {
            armorDestroyed = true;
          }
        }
      }

      // Body Armor power soaks remainder
      if (bodyArmorPower && remainingArmorDamage > 0) {
        const bodyArmorReduction = Math.min(
          remainingArmorDamage,
          bodyArmorPower.value
        );
        bodyArmorPower.value = Math.max(
          0,
          bodyArmorPower.value - bodyArmorReduction
        );

        if (bodyArmorPower.value === 0) {
          bodyArmorDestroyed = true;
        }
      }
    } else if (degradingArmorMode === "per-hit" && armorDamage > 0) {
      // Per-hit degradation: Reduce armor by hitCount (default 1) when armor absorbs damage
      const degradationAmount = data.hitCount || 1;

      // Prioritize equipped armor degradation first
      if (equippedArmorItems.length > 0) {
        let remainingDegradation = degradationAmount;

        // Degrade equipped armor items until all degradation is applied
        for (const armorItem of equippedArmorItems) {
          if (remainingDegradation <= 0) break;
          if (armorItem.system.value <= 0) continue;

          const reduction = Math.min(
            remainingDegradation,
            armorItem.system.value
          );
          const newValue = armorItem.system.value - reduction;

          await armorItem.update({
            "system.value": newValue
          } as Record<string, unknown>);

          remainingDegradation -= reduction;

          if (newValue === 0) {
            armorDestroyed = true;
          }
        }

        // If equipped armor couldn't absorb all degradation, apply remainder to body armor
        if (
          remainingDegradation > 0 &&
          bodyArmorPower &&
          bodyArmorPower.value > 0
        ) {
          const reduction = Math.min(
            remainingDegradation,
            bodyArmorPower.value
          );
          bodyArmorPower.value -= reduction;
          if (bodyArmorPower.value === 0) {
            bodyArmorDestroyed = true;
          }
        }
      } else if (bodyArmorPower && bodyArmorPower.value > 0) {
        // No equipped armor, degrade body armor power
        const reduction = Math.min(degradationAmount, bodyArmorPower.value);
        bodyArmorPower.value -= reduction;
        if (bodyArmorPower.value === 0) {
          bodyArmorDestroyed = true;
        }
      }
    }
    // "none" mode: No degradation, armor soaks but keeps full value

    // Check resistance for overflow damage (roll-based system)
    if (overflow > 0 && data.damageType && data.damageType !== "none") {
      resistanceRollResult = await rollResistance(
        actor,
        data.damageType,
        overflow,
        currentFormId
      );

      if (resistanceRollResult) {
        // Apply resistance roll result
        overflow = resistanceRollResult.finalDamage;
      }
    }

    // Apply overflow to health
    if (overflow > 0) {
      healthDamage = overflow;
    }
  } else {
    // No armor - check resistance for all damage (roll-based system)
    let actualDamage = damage;

    if (data.damageType && data.damageType !== "none") {
      resistanceRollResult = await rollResistance(
        actor,
        data.damageType,
        actualDamage,
        currentFormId
      );

      if (resistanceRollResult) {
        actualDamage = resistanceRollResult.finalDamage;
      }
    }

    // All damage goes to health (after resistance)
    healthDamage = actualDamage;
  }

  // Update health in healthByForm
  const newHealthValue = Math.max(-20, currentHealth - healthDamage);

  // Ensure healthByForm exists
  if (!system.healthByForm) {
    system.healthByForm = {};
  }
  system.healthByForm[currentFormId] = newHealthValue;

  // Calculate new armor value for display
  const degradationAmount = data.hitCount || 1;
  const newArmorValue =
    degradingArmorMode === "full"
      ? totalArmor - armorDamage
      : degradingArmorMode === "per-hit" && armorDamage > 0
        ? totalArmor - degradationAmount
        : totalArmor;

  const result = {
    armorDamage,
    healthDamage,
    newArmorValue,
    newHealthValue,
    armorDestroyed,
    bodyArmorDestroyed,
    resistanceRollResult,
    vulnerabilityPower,
    vulnerabilityIncrease,
    originalDamage,
    piercingResult,
    // Deprecated fields for backward compatibility
    resistancePower: resistanceRollResult?.resistancePower,
    resistanceReduction: resistanceRollResult?.totalDamageResisted
  };

  return result;
}

/**
 * Apply healing to an actor
 * Modifies reactiveSystem.healthByForm directly
 */
export function applyHealingToActor(
  reactiveSystem: any,
  healAmount: number
): number {
  const system = reactiveSystem;

  // Find correct form ID using same fallback logic as prepareDerivedData
  let currentFormId = system.currentFormId;
  if (!currentFormId && system.forms?.length > 0) {
    const primaryForm = system.forms.find((f: any) => f.isPrimary);
    currentFormId = primaryForm ? primaryForm.id : system.forms[0].id;
  }
  if (!currentFormId) {
    currentFormId = "default";
  }

  // Get current health from healthByForm
  const healthByForm = system.healthByForm || {};
  const currentHealth =
    healthByForm[currentFormId] ?? system.resources?.health?.value ?? 0;

  // Calculate max health from form stats (same as prepareDerivedData)
  const forms = system.forms || [];
  const currentForm =
    forms.find((f: any) => f.id === currentFormId) || forms[0];
  const maxHealth = currentForm ? calculateHealth(currentForm) : 0;

  // Calculate new health (capped at max)
  const newHealthValue = Math.min(maxHealth, currentHealth + healAmount);

  // Ensure healthByForm exists
  if (!system.healthByForm) {
    system.healthByForm = {};
  }
  system.healthByForm[currentFormId] = newHealthValue;

  return newHealthValue;
}
