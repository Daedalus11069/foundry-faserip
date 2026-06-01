/**
 * Centralized damage application for FASERIP system
 * Handles armor soak, overflow, and updates to healthByForm
 */

import type { FaseripActor } from "../documents";
import { calculateHealth } from "../utils";

export interface DamageApplicationResult {
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
  armorDestroyed: boolean;
  bodyArmorDestroyed: boolean;
  resistancePower?: any; // Resistance power that was applied
  resistanceReduction?: number; // Amount of damage reduced by resistance
  originalDamage?: number; // Original damage before resistance
}

export interface DamageApplicationData {
  actor: FaseripActor;
  damage: number;
  damageType?: string;
  degradingArmorEnabled?: boolean;
}

/**
 * Apply damage to an actor with armor soak and overflow calculation
 * Updates healthByForm (source data) and armor/power arrays
 * Does NOT call actor.update() - caller must handle persistence
 */
export function applyDamageToActor(
  data: DamageApplicationData
): DamageApplicationResult {
  const { actor, damage, degradingArmorEnabled = true } = data;
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
    healthByForm[currentFormId] ?? system.resources.health.max ?? 0;

  // Find armor sources
  const bodyArmorPower = (system.powers || []).find(
    (p: any) =>
      p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
      (!p.formIds?.length || p.formIds.includes(currentFormId))
  );
  const equippedArmor = (system.armors || []).find((a: any) => a.equipped);

  // Calculate total armor
  const bodyArmorValue = bodyArmorPower?.value ?? 0;
  const equippedArmorValue = equippedArmor?.value ?? 0;
  const totalArmor = bodyArmorValue + equippedArmorValue;

  let armorDamage = 0;
  let healthDamage = 0;
  let overflow = 0;
  let armorDestroyed = false;
  let bodyArmorDestroyed = false;
  let resistancePower: any = undefined;
  let resistanceReduction = 0;
  const originalDamage = damage;

  if (totalArmor > 0) {
    // Armor soaks damage
    armorDamage = Math.min(damage, totalArmor);
    overflow = damage - armorDamage;

    // Reduce armor values (EQUIPPED ARMOR FIRST, then body armor power)
    let remainingArmorDamage = armorDamage;

    // Equipped armor soaks first
    if (equippedArmor && remainingArmorDamage > 0 && degradingArmorEnabled) {
      const equippedArmorReduction = Math.min(
        remainingArmorDamage,
        equippedArmor.value
      );
      equippedArmor.value = Math.max(
        0,
        equippedArmor.value - equippedArmorReduction
      );
      remainingArmorDamage -= equippedArmorReduction;

      if (equippedArmor.value === 0) {
        armorDestroyed = true;
      }
    }

    // Body Armor power soaks remainder
    if (bodyArmorPower && remainingArmorDamage > 0 && degradingArmorEnabled) {
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

  const result = {
    armorDamage,
    healthDamage,
    newArmorValue: totalArmor - armorDamage,
    newHealthValue,
    armorDestroyed,
    bodyArmorDestroyed,
    resistancePower,
    resistanceReduction,
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
