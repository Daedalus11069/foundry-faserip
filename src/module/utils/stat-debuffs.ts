import { applyChartShift, type Rank, RANK_VALUES, RollResult } from "../enums";
import type {
  PowerStatDebuffData,
  TemporaryStatModifierData
} from "../types/actor-system";
import { stringToRank } from "../utils";

export const ATTRIBUTE_KEYS = [
  "fighting",
  "agility",
  "strength",
  "endurance",
  "reasoning",
  "intuition",
  "psyche"
] as const;

export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export interface EffectiveAttributeData {
  key: AttributeKey;
  rank: Rank;
  value: number;
  baseRank: Rank;
  baseValue: number;
  totalShift: number;
  modifiers: TemporaryStatModifierData[];
}

export function getCurrentFormFromSystem(system: any): any | null {
  if (!system?.forms?.length) {
    return null;
  }

  return (
    system.forms.find((form: any) => form.id === system.currentFormId) ||
    system.forms[0] ||
    null
  );
}

export function getEffectiveAttributeData(
  actorOrSystem: { system?: any } | any,
  attributeKey: AttributeKey
): EffectiveAttributeData | null {
  const system = actorOrSystem?.system ?? actorOrSystem;
  const currentForm = getCurrentFormFromSystem(system);

  if (!currentForm?.attributes?.[attributeKey]) {
    return null;
  }

  const baseAttribute = currentForm.attributes[attributeKey];
  const baseRank = stringToRank(baseAttribute.rank) as Rank;
  const baseValue = Number(baseAttribute.value || 0);
  const modifiers = (
    (system.temporaryStatModifiers || []) as TemporaryStatModifierData[]
  )
    .filter(
      modifier =>
        modifier.attribute === attributeKey &&
        Number(modifier.roundsRemaining || 0) > 0
    )
    .map(modifier => ({
      ...modifier,
      chartShift: Number(modifier.chartShift || 0),
      roundsRemaining: Number(modifier.roundsRemaining || 0)
    }));

  const totalShift = modifiers.reduce(
    (sum, modifier) => sum + Number(modifier.chartShift || 0),
    0
  );
  const rank = applyChartShift(baseRank, totalShift);
  const value = RANK_VALUES[rank] ?? baseValue;

  return {
    key: attributeKey,
    rank,
    value,
    baseRank,
    baseValue,
    totalShift,
    modifiers
  };
}

export function getStatDebuffShiftForResult(
  statDebuff: PowerStatDebuffData | null | undefined,
  result: RollResult | undefined,
  rollTotal?: number
): number {
  if (!statDebuff?.enabled) {
    return 0;
  }

  if (rollTotal === 100 || result === RollResult.Red) {
    return Number(statDebuff.redShift || 0);
  }

  if (result === RollResult.Yellow) {
    return Number(statDebuff.yellowShift || 0);
  }

  if (result === RollResult.Green) {
    return Number(statDebuff.greenShift || 0);
  }

  return 0;
}
