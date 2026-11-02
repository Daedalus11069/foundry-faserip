/**
 * Helpers for the effects system shared by powers and weapons (see
 * EffectsData in types/actor-system.ts and buildEffectsSchema() in
 * data-models/ItemDataModels.ts).
 */
import type {
  EffectsData,
  PowerDamageDebuffData,
  PowerDotData,
  PowerStatDebuffData,
  PowerStatusEffectData,
  WeaponAreaOfEffectData
} from "../types/actor-system";

/** The list-valued effect fields, i.e. everything in EffectsData but areaOfEffect. */
export type EffectListField =
  | "statDebuffs"
  | "damageBuffs"
  | "dots"
  | "statusEffects";

export const EFFECT_ATTRIBUTE_CHOICES = [
  { value: "fighting", label: "Fighting" },
  { value: "agility", label: "Agility" },
  { value: "strength", label: "Strength" },
  { value: "endurance", label: "Endurance" },
  { value: "reasoning", label: "Reasoning" },
  { value: "intuition", label: "Intuition" },
  { value: "psyche", label: "Psyche" }
] as const;

export function newStatDebuff(): PowerStatDebuffData {
  return {
    enabled: true,
    attribute: "intuition",
    greenShift: 0,
    yellowShift: 0,
    redShift: 0,
    durationFormula: "1d3"
  };
}

export function newDamageBuff(): PowerDamageDebuffData {
  return {
    enabled: true,
    greenShift: 0,
    yellowShift: 0,
    redShift: 0,
    durationFormula: "1d3"
  };
}

export function newDot(): PowerDotData {
  return {
    enabled: true,
    rank: "",
    armorPiercing: "",
    durationFormula: "1d3"
  };
}

export function newStatusEffect(): PowerStatusEffectData {
  return {
    enabled: true,
    statusId: "",
    durationFormula: "1d3"
  };
}

export function defaultAreaOfEffect(): WeaponAreaOfEffectData {
  return {
    enabled: false,
    shape: "circle",
    size: 10,
    width: 5,
    angle: 53,
    color: "#ff0000",
    durationRounds: "",
    remotePlaced: false,
    maxRangeFeet: 0
  };
}

/** Factory for a fresh entry of the given list field. */
export const NEW_EFFECT_ENTRY: Record<EffectListField, () => unknown> = {
  statDebuffs: newStatDebuff,
  damageBuffs: newDamageBuff,
  dots: newDot,
  statusEffects: newStatusEffect
};

/**
 * Pick just the effect fields off a power or weapon, for handing to the combat
 * flow / region placement as one bundle.
 */
export function pickEffects(source: EffectsData): EffectsData {
  return {
    statDebuffs: source.statDebuffs,
    damageBuffs: source.damageBuffs,
    dots: source.dots,
    statusEffects: source.statusEffects,
    areaOfEffect: source.areaOfEffect
  };
}

/**
 * Foundry's own registered status conditions (sleep, stun, prone, etc.) rather
 * than a hand-maintained list, so any core/module-added status shows up in the
 * editor automatically.
 */
export function getStatusEffectChoices(): Array<{
  value: string;
  label: string;
}> {
  return ((CONFIG.statusEffects as any[]) || [])
    .map(s => ({
      value: s.id as string,
      // @ts-expect-error - Foundry game.i18n global
      label: typeof s.name === "string" ? game.i18n.localize(s.name) : s.id
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
