/**
 * Centralized damage application for FASERIP system
 * Handles armor soak, overflow, and updates to healthByForm
 */

import type { FaseripActor } from "../documents";
import { calculateHealth } from "../utils";
import { type ArmorItem, isArmorItem } from "../types/items";

export interface DamageApplicationResult {
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
  armorDestroyed: boolean;
  bodyArmorDestroyed: boolean;
  resistancePower?: any; // Resistance power that was applied
  resistanceReduction?: number; // Amount of damage reduced by resistance
  vulnerabilityPower?: any; // Vulnerability power that was applied
  vulnerabilityIncrease?: number; // Amount of damage increased by vulnerability
  originalDamage?: number; // Original damage before resistance/vulnerability
}

export interface DamageApplicationData {
  actor: FaseripActor;
  damage: number;
  damageType?: string;
  degradingArmorMode?: string; // "none", "full", "per-hit"
}

/**
 * Apply damage to an actor with armor soak and overflow calculation
 * Updates healthByForm (source data) and armor items directly
 * Does NOT call actor.update() for health - caller must handle health persistence
 * DOES call item.update() for armor items (Item documents must be updated individually)
 */
export async function applyDamageToActor(
  data: DamageApplicationData
): Promise<DamageApplicationResult> {
  const { actor, degradingArmorMode = "none" } = data;
  const system = actor.system as any;

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
    healthByForm[currentFormId] ?? system.resources.health.max ?? 0;

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
  let resistancePower: any = undefined;
  let resistanceReduction = 0;
  let vulnerabilityPower: any = undefined;
  let vulnerabilityIncrease = 0;
  const originalDamage = damage;

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

  if (totalArmor > 0) {
    // Armor soaks damage
    armorDamage = Math.min(damage, totalArmor);
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
    } else if (degradingArmorMode === "per-hit" && overflow > 0) {
      // Per-hit degradation: Reduce armor by 1 only if damage penetrated
      // Prioritize equipped armor degradation first
      if (equippedArmorItems.length > 0) {
        // Degrade the first equipped armor item with value > 0
        const armorToDegrade = equippedArmorItems.find(
          item => item.system.value > 0
        );
        if (armorToDegrade) {
          const newValue = Math.max(0, armorToDegrade.system.value - 1);
          await armorToDegrade.update({
            "system.value": newValue
          } as Record<string, unknown>);
          if (newValue === 0) {
            armorDestroyed = true;
          }
        }
      } else if (bodyArmorPower && bodyArmorPower.value > 0) {
        bodyArmorPower.value = Math.max(0, bodyArmorPower.value - 1);
        if (bodyArmorPower.value === 0) {
          bodyArmorDestroyed = true;
        }
      }
    }
    // "none" mode: No degradation, armor soaks but keeps full value

    // Check resistance for overflow damage
    if (overflow > 0 && data.damageType && data.damageType !== "none") {
      resistancePower = (system.powers || []).find(
        (p: any) =>
          p.resistanceType === data.damageType &&
          (!p.formIds?.length || p.formIds.includes(currentFormId))
      );

      if (resistancePower) {
        const resistanceValue = resistancePower.value;
        if (resistanceValue >= overflow) {
          // Complete resistance to overflow
          resistanceReduction = overflow;
          overflow = 0;
        } else {
          // Partial resistance to overflow
          resistanceReduction = resistanceValue;
          overflow -= resistanceValue;
        }
      }
    }

    // Apply overflow to health
    if (overflow > 0) {
      healthDamage = overflow;
    }
  } else {
    // No armor - check resistance for all damage
    let actualDamage = damage;

    if (data.damageType && data.damageType !== "none") {
      resistancePower = (system.powers || []).find(
        (p: any) =>
          p.resistanceType === data.damageType &&
          (!p.formIds?.length || p.formIds.includes(currentFormId))
      );

      if (resistancePower) {
        const resistanceValue = resistancePower.value;
        if (resistanceValue >= actualDamage) {
          // Complete resistance - no damage
          resistanceReduction = actualDamage;
          actualDamage = 0;
        } else {
          // Partial resistance - reduce damage
          resistanceReduction = resistanceValue;
          actualDamage -= resistanceValue;
        }
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
  const newArmorValue =
    degradingArmorMode === "full"
      ? totalArmor - armorDamage
      : degradingArmorMode === "per-hit" && overflow > 0
        ? totalArmor - 1
        : totalArmor;

  const result = {
    armorDamage,
    healthDamage,
    newArmorValue,
    newHealthValue,
    armorDestroyed,
    bodyArmorDestroyed,
    resistancePower,
    resistanceReduction,
    vulnerabilityPower,
    vulnerabilityIncrease,
    originalDamage
  };

  return result;
}

/**
 * Apply healing to an actor
 * Updates healthByForm (source data)
 * Does NOT call actor.update() - caller must handle persistence
 */
export function applyHealingToActor(
  actor: FaseripActor,
  healAmount: number
): number {
  const system = actor.system as any;

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
