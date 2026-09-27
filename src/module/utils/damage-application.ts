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
import { Rank, RANK_VALUES, DamageType } from "../enums";

/** A single typed damage component of an attack (an attack may carry more than one). */
export interface DamageComponent {
  type: DamageType | string;
  amount: number;
}

/** Per-type armor soak lookup. Physical falls back to the legacy flat `value`
 * field when not explicitly configured; Magic/Mental have no legacy
 * equivalent and default to 0. Any other damage type (fire, cold, etc.)
 * keeps today's behavior of soaking off the flat `value` field. */
function getArmorSoak(
  source: {
    value?: number;
    physicalValue?: number | null;
    magicValue?: number;
    mentalValue?: number;
  },
  type: DamageType | string
): number {
  if (type === DamageType.Physical) {
    return source.physicalValue ?? source.value ?? 0;
  }
  if (type === DamageType.Magic) {
    return source.magicValue ?? 0;
  }
  if (type === DamageType.Mental) {
    return source.mentalValue ?? 0;
  }
  return source.value ?? 0;
}

/** Reduce the per-type armor field(s) that correspond to `type` by `amount`.
 * Returns the new remaining value for that bucket and whether it hit 0. */
function degradeArmorSoak(
  source: {
    value?: number;
    physicalValue?: number | null;
    magicValue?: number;
    mentalValue?: number;
  },
  type: DamageType | string,
  amount: number
): { newValue: number; destroyed: boolean } {
  if (type === DamageType.Magic) {
    const newValue = Math.max(0, (source.magicValue ?? 0) - amount);
    source.magicValue = newValue;
    return { newValue, destroyed: newValue === 0 };
  }
  if (type === DamageType.Mental) {
    const newValue = Math.max(0, (source.mentalValue ?? 0) - amount);
    source.mentalValue = newValue;
    return { newValue, destroyed: newValue === 0 };
  }
  // Physical (and any unbucketed type) degrades the legacy flat value,
  // unless physicalValue has been explicitly configured as its own bucket.
  if (type === DamageType.Physical && source.physicalValue != null) {
    const newValue = Math.max(0, source.physicalValue - amount);
    source.physicalValue = newValue;
    return { newValue, destroyed: newValue === 0 };
  }
  const newValue = Math.max(0, (source.value ?? 0) - amount);
  source.value = newValue;
  return { newValue, destroyed: newValue === 0 };
}

const PHYSICAL_DEFENSE_ATTRIBUTES = new Set([
  "fighting",
  "agility",
  "strength",
  "endurance"
]);

/**
 * An actor is unconscious (but not dead) when health is negative but has
 * not yet reached the -20 death threshold.
 */
export function isActorUnconscious(actor: FaseripActor): boolean {
  const health = (actor.system as any)?.resources?.health?.value;
  return typeof health === "number" && health < 0 && health >= -19;
}

export function isPhysicalDefenseAttribute(attribute: string): boolean {
  return PHYSICAL_DEFENSE_ATTRIBUTES.has(attribute.toLowerCase());
}

/** An actor at or below the -20 death threshold. */
export function isActorDead(actor: FaseripActor): boolean {
  const health = (actor.system as any)?.resources?.health?.value;
  return typeof health === "number" && health <= -20;
}

export interface PerTypeDamageResult {
  armorDamage: number;
  overflow: number;
  healthDamage: number;
  newArmorValue: number;
  armorDestroyed: boolean;
  bodyArmorDestroyed: boolean;
  resistanceRollResult?: ResistanceRollResult;
  vulnerabilityPower?: any;
  vulnerabilityIncrease?: number;
  originalDamage?: number;
  piercingResult?: ArmorPiercingResult;
}

export interface DamageApplicationResult {
  /** Per damage-type breakdown, keyed by DamageType value. */
  perType: Record<string, PerTypeDamageResult>;
  healthDamage: number;
  newHealthValue: number;
  armorDestroyed: boolean;
  bodyArmorDestroyed: boolean;

  // Flattened fields for the common single-damage-type case, so existing
  // callers reading a single result don't need to change. Populated from
  // the sole entry in `perType` when there was exactly one component.
  armorDamage?: number;
  newArmorValue?: number;
  resistanceRollResult?: ResistanceRollResult;
  vulnerabilityPower?: any;
  vulnerabilityIncrease?: number;
  originalDamage?: number;
  piercingResult?: ArmorPiercingResult;

  /** @deprecated Use resistanceRollResult instead */
  resistancePower?: any;
  /** @deprecated Use resistanceRollResult.damageResisted instead */
  resistanceReduction?: number;
}

export interface DamageApplicationData {
  reactiveSystem?: any; // Optional reactive system data to modify directly (for sheets)
  actor: FaseripActor; // The real actor (for accessing items collection, or extracting system if reactiveSystem not provided)
  /** Typed damage components - an attack may deal more than one damage type at once. */
  damageComponents?: DamageComponent[];
  /** @deprecated use damageComponents */
  damage?: number;
  /** @deprecated use damageComponents */
  damageType?: string;
  degradingArmorMode?: string; // "none", "full", "per-hit"
  armorPiercing?: string | null; // Armor-piercing rank (optional)
  armorRank?: string; // Target's armor rank (optional)
  hitCount?: number; // Number of hits that contributed to this damage (for per-hit degradation)
  hitDamages?: number[]; // Per-hit damage amounts for cumulative combo damage (single-type path only - see hitDamages/damageComponents note in applyDamageToActor)
  targetArmorOnly?: boolean; // Attack is aimed at armor specifically: ignores armor piercing and any overflow beyond armor's capacity is not applied to health
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

  // Normalize into typed components. Legacy callers pass damage/damageType;
  // an unset/"none" legacy type is treated as Physical, preserving the old
  // implicit-physical behavior for un-migrated callers.
  const damageComponents: DamageComponent[] =
    data.damageComponents && data.damageComponents.length > 0
      ? data.damageComponents
      : [
          {
            type:
              data.damageType && data.damageType !== "none"
                ? data.damageType
                : DamageType.Physical,
            amount: data.damage ?? 0
          }
        ];

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

  // Find equipped armor items from actor.items collection that apply to the active form
  const equippedArmorItems = actor.items.filter(
    (item): item is ArmorItem =>
      isArmorItem(item) &&
      item.system.equipped &&
      (!item.system.formIds?.length ||
        item.system.formIds.includes(currentFormId))
  );

  const perType: Record<string, PerTypeDamageResult> = {};
  let totalHealthDamage = 0;
  let anyArmorDestroyed = false;
  let anyBodyArmorDestroyed = false;

  for (const component of damageComponents) {
    const type = component.type;
    let damage = component.amount;

    // Total armor available against this specific damage type
    const bodyArmorValueForType = bodyArmorPower
      ? getArmorSoak(bodyArmorPower, type)
      : 0;
    const equippedArmorValueForType = equippedArmorItems.reduce(
      (sum, item) => sum + getArmorSoak(item.system as any, type),
      0
    );
    const totalArmor = bodyArmorValueForType + equippedArmorValueForType;

    let armorDamage = 0;
    let overflow = 0;
    let armorDestroyed = false;
    let bodyArmorDestroyed = false;
    let resistanceRollResult: ResistanceRollResult | undefined;
    let vulnerabilityPower: any = undefined;
    let vulnerabilityIncrease = 0;
    const originalDamage = damage;
    let piercingResult: ArmorPiercingResult | undefined;

    // Calculate effective armor with piercing. AP rank is a property of the
    // attack as a whole, applied against each type's armor total independently.
    // An attack aimed specifically at armor ignores armor piercing entirely -
    // it's trying to wear the armor down, not bypass it.
    let effectiveArmor = totalArmor;

    if (data.armorPiercing && totalArmor > 0 && !data.targetArmorOnly) {
      piercingResult = calculateArmorPiercing(
        totalArmor,
        data.armorRank as Rank,
        data.armorPiercing as Rank
      );
      effectiveArmor = piercingResult.effectiveArmor;
    }

    // Apply vulnerability if enabled and matching power found
    if (vulnerabilityEnabled && type && type !== "none") {
      vulnerabilityPower = (system.powers || []).find(
        (p: any) =>
          p.vulnerabilityType === type &&
          (!p.formIds?.length || p.formIds.includes(currentFormId))
      );

      if (vulnerabilityPower) {
        // Vulnerability increases damage by configured percentage (house rule)
        const vulnerabilityPercent = game.settings.get(
          "faserip",
          "vulnerabilityDamageIncrease"
        ) as number;
        vulnerabilityIncrease = Math.floor(
          damage * (vulnerabilityPercent / 100)
        );
        damage += vulnerabilityIncrease;
      }
    }

    if (totalArmor > 0) {
      // Armor soaks damage using effective armor after piercing - fully
      // pierced armor (effectiveArmor <= 0) soaks nothing and all damage goes
      // to health, but still degrades below. For cumulative combo damage
      // (single-type only), armor soaks each individual hit separately.
      const hitAmounts =
        damageComponents.length === 1 &&
        data.hitDamages &&
        data.hitDamages.length > 0
          ? data.hitDamages
          : [damage];

      for (const hitDamage of hitAmounts) {
        const soaked = Math.max(0, Math.min(hitDamage, effectiveArmor));
        armorDamage += soaked;
        overflow += hitDamage - soaked;
      }

      // Reduce armor values (EQUIPPED ARMOR FIRST, then body armor power).
      // Each damage type degrades only its own soak bucket independently.
      // "full" mode degrades by what armor would have soaked with no
      // piercing applied (pre-AP), even though the actual (post-AP)
      // armorDamage may be lower or zero - a fully-pierced hit still wears
      // the armor down.
      const preApArmorDamage = Math.min(damage, totalArmor);
      let remainingArmorDamage = preApArmorDamage;

      if (degradingArmorMode === "full") {
        for (const armorItem of equippedArmorItems) {
          if (remainingArmorDamage <= 0) break;

          const armorValue = getArmorSoak(armorItem.system as any, type);
          const armorReduction = Math.min(remainingArmorDamage, armorValue);

          if (armorReduction > 0) {
            const { newValue, destroyed } = degradeArmorSoak(
              armorItem.system as any,
              type,
              armorReduction
            );
            const updateKey =
              type === DamageType.Magic
                ? "system.magicValue"
                : type === DamageType.Mental
                  ? "system.mentalValue"
                  : type === DamageType.Physical &&
                      (armorItem.system as any).physicalValue != null
                    ? "system.physicalValue"
                    : "system.value";
            await armorItem.update({
              [updateKey]: newValue
            } as Record<string, unknown>);
            remainingArmorDamage -= armorReduction;

            if (destroyed) {
              armorDestroyed = true;
            }
          }
        }

        if (bodyArmorPower && remainingArmorDamage > 0) {
          const bodyArmorValue = getArmorSoak(bodyArmorPower, type);
          const bodyArmorReduction = Math.min(
            remainingArmorDamage,
            bodyArmorValue
          );
          if (bodyArmorReduction > 0) {
            const { destroyed } = degradeArmorSoak(
              bodyArmorPower,
              type,
              bodyArmorReduction
            );
            if (destroyed) {
              bodyArmorDestroyed = true;
            }
          }
        }
      } else if (degradingArmorMode === "per-hit" && preApArmorDamage > 0) {
        // Per-hit degradation: Reduce armor by hitCount (default 1) whenever
        // the hit would have reached armor (pre-AP), including fully-pierced hits.
        const degradationAmount = data.hitCount || 1;

        if (equippedArmorItems.length > 0) {
          let remainingDegradation = degradationAmount;

          for (const armorItem of equippedArmorItems) {
            if (remainingDegradation <= 0) break;
            const armorValue = getArmorSoak(armorItem.system as any, type);
            if (armorValue <= 0) continue;

            const reduction = Math.min(remainingDegradation, armorValue);
            const { newValue, destroyed } = degradeArmorSoak(
              armorItem.system as any,
              type,
              reduction
            );
            const updateKey =
              type === DamageType.Magic
                ? "system.magicValue"
                : type === DamageType.Mental
                  ? "system.mentalValue"
                  : type === DamageType.Physical &&
                      (armorItem.system as any).physicalValue != null
                    ? "system.physicalValue"
                    : "system.value";
            await armorItem.update({
              [updateKey]: newValue
            } as Record<string, unknown>);

            remainingDegradation -= reduction;

            if (destroyed) {
              armorDestroyed = true;
            }
          }

          if (
            remainingDegradation > 0 &&
            bodyArmorPower &&
            getArmorSoak(bodyArmorPower, type) > 0
          ) {
            const reduction = Math.min(
              remainingDegradation,
              getArmorSoak(bodyArmorPower, type)
            );
            const { destroyed } = degradeArmorSoak(
              bodyArmorPower,
              type,
              reduction
            );
            if (destroyed) {
              bodyArmorDestroyed = true;
            }
          }
        } else if (bodyArmorPower && getArmorSoak(bodyArmorPower, type) > 0) {
          const reduction = Math.min(
            degradationAmount,
            getArmorSoak(bodyArmorPower, type)
          );
          const { destroyed } = degradeArmorSoak(bodyArmorPower, type, reduction);
          if (destroyed) {
            bodyArmorDestroyed = true;
          }
        }
      }
      // "none" mode: No degradation, armor soaks but keeps full value

      // An attack aimed at armor only damages armor - any overflow beyond what
      // the armor could soak is wasted rather than spilling into health.
      if (data.targetArmorOnly) {
        overflow = 0;
      }

      // Check resistance for overflow damage (roll-based system), per type
      if (overflow > 0 && type && type !== "none") {
        resistanceRollResult = await rollResistance(
          actor,
          type,
          overflow,
          currentFormId
        );

        if (resistanceRollResult) {
          overflow = resistanceRollResult.finalDamage;
        }
      }
    } else if (data.targetArmorOnly) {
      // No armor to target - an armor-only attack has nothing to hit.
      overflow = 0;
    } else {
      // No armor - check resistance for all damage (roll-based system)
      let actualDamage = damage;

      if (type && type !== "none") {
        resistanceRollResult = await rollResistance(
          actor,
          type,
          actualDamage,
          currentFormId
        );

        if (resistanceRollResult) {
          actualDamage = resistanceRollResult.finalDamage;
        }
      }

      overflow = actualDamage;
    }

    const healthDamageForType = Math.max(0, overflow);
    totalHealthDamage += healthDamageForType;
    if (armorDestroyed) anyArmorDestroyed = true;
    if (bodyArmorDestroyed) anyBodyArmorDestroyed = true;

    perType[type] = {
      armorDamage,
      overflow,
      healthDamage: healthDamageForType,
      newArmorValue: totalArmor - armorDamage,
      armorDestroyed,
      bodyArmorDestroyed,
      resistanceRollResult,
      vulnerabilityPower,
      vulnerabilityIncrease,
      originalDamage,
      piercingResult
    };
  }

  // Update health in healthByForm
  const newHealthValue = Math.max(-20, currentHealth - totalHealthDamage);

  // Ensure healthByForm exists
  if (!system.healthByForm) {
    system.healthByForm = {};
  }
  system.healthByForm[currentFormId] = newHealthValue;

  // Mark actor as dead once health reaches the -20 death threshold
  if (newHealthValue <= -20 && actor) {
    await actor.toggleStatusEffect("dead", { active: true });
  }

  const singleTypeResult =
    damageComponents.length === 1 ? perType[damageComponents[0].type] : undefined;

  const result: DamageApplicationResult = {
    perType,
    healthDamage: totalHealthDamage,
    newHealthValue,
    armorDestroyed: anyArmorDestroyed,
    bodyArmorDestroyed: anyBodyArmorDestroyed,
    // Flattened fields for single-type callers
    armorDamage: singleTypeResult?.armorDamage,
    newArmorValue: singleTypeResult?.newArmorValue,
    resistanceRollResult: singleTypeResult?.resistanceRollResult,
    vulnerabilityPower: singleTypeResult?.vulnerabilityPower,
    vulnerabilityIncrease: singleTypeResult?.vulnerabilityIncrease,
    originalDamage: singleTypeResult?.originalDamage,
    piercingResult: singleTypeResult?.piercingResult,
    // Deprecated fields for backward compatibility
    resistancePower: singleTypeResult?.resistanceRollResult?.resistancePower,
    resistanceReduction:
      singleTypeResult?.resistanceRollResult?.totalDamageResisted
  };

  return result;
}

/**
 * Apply healing to an actor
 * Modifies reactiveSystem.healthByForm directly
 */
export async function applyHealingToActor(
  reactiveSystem: any,
  healAmount: number,
  actor?: FaseripActor
): Promise<number> {
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

  // Revive actor if healing brought them back above the death threshold
  if (newHealthValue > -20 && actor) {
    await actor.toggleStatusEffect("dead", { active: false });
  }

  return newHealthValue;
}
