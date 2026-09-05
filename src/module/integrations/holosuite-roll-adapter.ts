import { FaseripRoll } from "../rolling/FaseripRoll";
import { RANK_VALUES, Rank, RollResult } from "../enums";
import { showHackCheckOptionsDialog } from "../applications/dialog-utils";
import type { FaseripActor } from "../documents";

/** Shared per-hack context: the same check (attribute, rank, talents, chart
 * shift, required color) is reused for the initial roll and every
 * subsequent per-node roll in Node Intrusion (see
 * holosuite-node-intrusion-patch.ts). */
export interface FaseripHackContext {
  actor?: FaseripActor;
  attributeName: string;
  attributeRank: Rank;
  chartShift?: number;
  talentNames?: string[];
  /** Minimum Universal Table color the roll must reach to succeed - sourced
   * from a hackable target actor's hackRequiredColor. Defaults to Green
   * (any non-White success passes), matching prior behavior. */
  requiredColor?: RollResult;
}

/** Ordinal ranking of Universal Table colors, low to high. */
export const ROLL_COLOR_RANK: Record<RollResult, number> = {
  [RollResult.White]: 0,
  [RollResult.Green]: 1,
  [RollResult.Yellow]: 2,
  [RollResult.Red]: 3
};

/** True if a resolved roll's color meets or exceeds the required threshold. */
export function meetsRequiredColor(
  result: RollResult,
  requiredColor: RollResult = RollResult.Green
): boolean {
  return ROLL_COLOR_RANK[result] >= ROLL_COLOR_RANK[requiredColor];
}

/** Parses an actor's stored hackRequiredColor string into a RollResult. */
export function parseRequiredColor(value: unknown): RollResult {
  return value === RollResult.Yellow || value === RollResult.Red
    ? (value as RollResult)
    : RollResult.Green;
}

/**
 * Rolls one FASERIP check for a HoloSuite hacking attempt, gathering karma
 * spend through a single combined dialog (chart shift + result shift
 * together) instead of FaseripRoll.rollAttribute's own separate pre-roll/
 * post-roll prompts - used for both the initial roll and each per-node
 * roll, so every hacking roll only ever shows one karma dialog.
 */
export async function rollFaseripHackCheck(
  context: FaseripHackContext,
  labelSuffix?: string
): Promise<FaseripRoll> {
  const actor = context.actor;
  const actorSystem = (actor as any)?.system;
  const availableKarma = actorSystem?.resources?.karma?.value || 0;

  let columnShifts = 0;
  let resultShift = 0;
  let manualChartShift = 0;

  if (availableKarma > 0) {
    const options = await showHackCheckOptionsDialog(
      availableKarma,
      context.attributeRank
    );
    if (options) {
      columnShifts = options.columnShifts || 0;
      resultShift = options.resultShift || 0;
      manualChartShift = options.manualChartShift || 0;
    }
  }

  const attributeValue = RANK_VALUES[context.attributeRank];
  const label = labelSuffix
    ? `${context.attributeName} (${labelSuffix})`
    : context.attributeName;

  return FaseripRoll.rollAttribute(
    label,
    context.attributeRank,
    attributeValue,
    context.chartShift ?? 0,
    actor,
    context.talentNames,
    undefined,
    columnShifts,
    resultShift,
    false,
    manualChartShift
  );
}
