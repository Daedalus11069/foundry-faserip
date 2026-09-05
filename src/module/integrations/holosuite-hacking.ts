import { FaseripRoll } from "../rolling/FaseripRoll";
import { Rank, RollResult } from "../enums";
import type { FaseripActor } from "../documents";
import {
  ensureNodeIntrusionPerNodeRollPatched,
  setupMultiTargetNodeIntrusion
} from "./holosuite-node-intrusion-patch";
import {
  rollFaseripHackCheck,
  meetsRequiredColor,
  parseRequiredColor,
  type HackTargetInfo
} from "./holosuite-roll-adapter";
import {
  showHackOptionsDialog,
  showTalentSelectionDialog,
  showHackDebuffDialog
} from "../applications/dialog-utils";
import { applyTemporaryModifier } from "../utils/temp-effects";
import type { Talent } from "../types";

declare const game: any;
declare const ui: any;
declare const canvas: any;

export const HOLOSUITE_MODULE_ID = "holosuite-hacking";

/**
 * HoloSuite Hacking's own "System skill roll" adapters are a hardcoded list
 * (dnd5e, pf2e, sf2e, CoC7, cyberpunk-red-core) baked into that module -
 * there is no registration hook for third-party systems, and FASERIP's
 * percentile/column-shift resolution doesn't map onto their additive
 * skill-modifier model anyway. So this never calls into HoloSuite's roll
 * dispatch (rollSkillCheck / rollSystemSkill). Instead it resolves the
 * check with FASERIP's own dice (FaseripRoll.rollAttribute, including karma
 * spends and chart shifts), then launches the minigame directly via
 * startHack's quickOutcome path, which skips HoloSuite's dice entirely.
 */
export function getHoloSuiteApi(): any | null {
  const module = game.modules?.get?.(HOLOSUITE_MODULE_ID);
  return module?.active ? module.api : null;
}

export function isHoloSuiteActive(): boolean {
  return getHoloSuiteApi() !== null;
}

const QUICK_OUTCOME_BY_COLOR: Record<RollResult, string> = {
  [RollResult.Red]: "critical_success",
  [RollResult.Yellow]: "strong_success",
  [RollResult.Green]: "success",
  [RollResult.White]: "failure_but_playable"
};

/**
 * Maps an already-resolved FaseripRoll onto one of HoloSuite's five
 * quickOutcome difficulty tiers. Botch (2-5) and Ultimate Botch (1) become
 * critical_failure; Ultimate Critical (100) becomes critical_success. A
 * result below requiredColor (e.g. a hackable target's DC) counts as
 * failure_but_playable regardless of which tier it would otherwise map to -
 * a Green roll against a Yellow-required target still fails, even though
 * Green alone would normally succeed. Otherwise follows the Universal Table
 * color (White/Green/Yellow/Red).
 */
export function faseripResultToQuickOutcome(
  faseripRoll: FaseripRoll,
  requiredColor: RollResult = RollResult.Green
): string {
  const rollTotal = faseripRoll.roll.total ?? 0;
  if (rollTotal >= 1 && rollTotal <= 5) return "critical_failure";
  if (rollTotal === 100) return "critical_success";
  if (!meetsRequiredColor(faseripRoll.result, requiredColor)) {
    return "failure_but_playable";
  }
  return QUICK_OUTCOME_BY_COLOR[faseripRoll.result] ?? "failure_but_playable";
}

export interface RunFaseripHackOptions {
  minigameType?: string;
  actor?: FaseripActor;
  label?: string;
  liveAudience?: "everyone" | "gm" | "none";
  requiredColor?: RollResult;
  onSuccess?: () => void;
  onFailure?: () => void;
}

/** Launches a HoloSuite minigame at the difficulty implied by a resolved FaseripRoll. */
export function runFaseripHack(faseripRoll: FaseripRoll, options: RunFaseripHackOptions = {}) {
  const hacking = getHoloSuiteApi();
  if (!hacking) {
    ui.notifications?.warn?.("HoloSuite Hacking is not active in this world.");
    return null;
  }

  const actor = options.actor;
  const label = options.label ?? "Hacking Attempt";

  return hacking.startHack({
    type: options.minigameType ?? "node-intrusion",
    quickOutcome: faseripResultToQuickOutcome(faseripRoll, options.requiredColor),
    liveAudience: options.liveAudience ?? "everyone",
    actorId: actor?.id ?? "",
    actorName: actor?.name ?? game.user?.name ?? "Hacker",
    userId: game.user?.id ?? "",
    challengeName: label,
    targetName: label,
    onSuccess: options.onSuccess,
    onFailure: options.onFailure
  });
}

/**
 * Prompts for an optional debuff (stat/damage/incoming chart shift, or a
 * forced-failure next roll) and applies it to a successfully hacked target
 * actor as a normal faserip ActiveEffect (see applyTemporaryModifier) -
 * reuses the same infrastructure the Effects tab's "GM Applied" modifiers
 * use, just triggered from a breach instead of a manual button.
 */
export async function promptAndApplyHackDebuff(
  targetTokenId: string,
  targetActorName: string
): Promise<void> {
  // Resolved via the specific targeted TOKEN, not game.actors.get(actorId) -
  // an unlinked token's synthetic actor carries its own ActiveEffects
  // independent of other tokens sharing the same base Actor, so this is the
  // only way to debuff just the one token that was actually hacked.
  const targetToken =
    (canvas as any)?.tokens?.get?.(targetTokenId) ??
    (canvas as any)?.scene?.tokens?.get?.(targetTokenId);
  const targetActor = targetToken?.actor;
  if (!targetActor) return;

  const options = await showHackDebuffDialog(targetActorName);
  if (!options) return;

  await applyTemporaryModifier(targetActor, {
    kind: options.kind,
    attribute: options.attribute as any,
    chartShift: options.chartShift,
    roundsRemaining: options.roundsRemaining,
    sourceName: options.sourceName,
    indefinite: options.kind === "forcedResult" ? true : undefined,
    trigger: options.kind === "forcedResult" ? "nextAction" : undefined,
    forcedOutcome: options.kind === "forcedResult" ? "failure" : undefined
  });
}

export interface AttemptFaseripHackParams {
  actor: FaseripActor;
  attributeName: string;
  attributeRank: Rank;
  chartShift?: number;
  talentNames?: string[];
  minigameType?: string;
  label?: string;
  liveAudience?: "everyone" | "gm" | "none";
  /** Minimum Universal Table color required to succeed - sourced from a
   * hackable target actor's hackRequiredColor. Defaults to Green. Used for
   * the initial roll's difficulty tier; with 2+ targets each finish node
   * uses its own target's requiredColor instead (see targets below). */
  requiredColor?: RollResult;
  /** All hackable actors targeted for this attempt (Foundry's Target tool).
   * With 2+ entries, Node Intrusion places one finish node per target
   * instead of a single one. */
  targets?: HackTargetInfo[];
  onSuccess?: () => void;
  onFailure?: () => void;
}

/**
 * Rolls the given FASERIP attribute/talent check (one combined karma-spend
 * dialog and the normal chat card) and immediately launches the configured
 * HoloSuite minigame at the difficulty implied by the result.
 */
export async function attemptFaseripHack(params: AttemptFaseripHackParams) {
  const faseripRoll = await rollFaseripHackCheck({
    actor: params.actor,
    attributeName: params.attributeName,
    attributeRank: params.attributeRank,
    chartShift: params.chartShift,
    talentNames: params.talentNames,
    requiredColor: params.requiredColor
  });

  // A single (or zero) target's breach isn't reported per-node (see the
  // multi-target completeNodeClaim patch for that) - it's only known once
  // the whole attempt succeeds, so the debuff prompt is folded into
  // onSuccess here instead. 2+ targets prompt individually as each is
  // breached (see the onTargetHacked callback below) and are skipped here.
  const singleTarget =
    params.targets && params.targets.length === 1 ? params.targets[0] : null;
  const onSuccess = async () => {
    if (singleTarget) {
      await promptAndApplyHackDebuff(
        singleTarget.tokenId,
        singleTarget.actorName
      );
    }
    params.onSuccess?.();
  };

  const app = runFaseripHack(faseripRoll, {
    minigameType: params.minigameType,
    actor: params.actor,
    label: params.label,
    liveAudience: params.liveAudience,
    requiredColor: params.requiredColor,
    onSuccess,
    onFailure: params.onFailure
  });

  // Tags the minigame app with the same check used for the initial roll so
  // the Node Intrusion per-node-roll patch (see
  // holosuite-node-intrusion-patch.ts) can re-roll it for every node
  // attempt instead of just once up front.
  if (app) {
    app.__faseripHackContext = {
      actor: params.actor,
      attributeName: params.attributeName,
      attributeRank: params.attributeRank,
      chartShift: params.chartShift,
      talentNames: params.talentNames,
      requiredColor: params.requiredColor
    };

    if ((params.minigameType ?? "node-intrusion") === "node-intrusion") {
      ensureNodeIntrusionPerNodeRollPatched(app);
      if (params.targets && params.targets.length >= 2) {
        setupMultiTargetNodeIntrusion(app, params.targets, target =>
          promptAndApplyHackDebuff(target.tokenId, target.actorName)
        );
      }
    }
  }

  return app;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  fighting: "Fighting",
  agility: "Agility",
  strength: "Strength",
  endurance: "Endurance",
  reasoning: "Reasoning",
  intuition: "Intuition",
  psyche: "Psyche"
};

/**
 * Scene-control "Present Hack" action: prompts for minigame + check
 * attribute, lets the player apply talents, then runs attemptFaseripHack -
 * the same flow an Equipment hack lock uses, just without an Item backing
 * it. `actor` is the hacker (the controlled token). Any targeted (Foundry's
 * Target tool, not merely controlled) hackable actors become the DC
 * source(s): one target sets this attempt's required color as before; 2+
 * targets each become their own finish node in Node Intrusion, with
 * hacking any one of them (before the trace timer completes) counting as
 * an overall success. No hackable target keeps the old default (any
 * non-White success passes).
 */
export async function presentHackToActor(actor: FaseripActor): Promise<void> {
  if (!isHoloSuiteActive()) {
    ui.notifications?.warn?.("HoloSuite Hacking is not active in this world.");
    return;
  }

  const options = await showHackOptionsDialog();
  if (!options) return;

  const attributeRank: Rank =
    (actor as any).getCurrentForm?.()?.attributes?.[options.attribute]?.rank ??
    Rank.Typical;

  const talents: Talent[] = (actor as any).system?.talents ?? [];
  let talentNames: string[] | undefined;
  let chartShift = 0;

  if (talents.length > 0) {
    const attributeLabel = ATTRIBUTE_LABELS[options.attribute] ?? "Hacking";
    const selectedTalents = await showTalentSelectionDialog(
      talents,
      attributeLabel
    );
    if (selectedTalents === null) return; // Cancelled

    if (selectedTalents.length > 0) {
      talentNames = selectedTalents.map(t => t.name);
      chartShift = selectedTalents.reduce((sum, t) => sum + t.bonus, 0);
    }
  }

  // Every targeted (not merely controlled) hackable actor becomes a DC
  // source - e.g. targeting a robot with hackRequiredColor "yellow" means
  // a hacker's roll must reach Yellow or better to breach it.
  const targetedTokens = [...(game.user?.targets ?? [])] as any[];
  const targets: HackTargetInfo[] = targetedTokens
    .filter(token => token.actor?.system?.hackable)
    .map(token => ({
      tokenId: token.id,
      actorId: token.actor.id,
      actorName: token.actor.name ?? "Target",
      requiredColor: parseRequiredColor(token.actor.system.hackRequiredColor)
    }));

  const requiredColor = targets[0]?.requiredColor;
  const label =
    targets.length > 1
      ? `${actor.name} Hacking ${targets.length} Targets`
      : targets.length === 1
        ? `${actor.name} Hacking ${targets[0].actorName}`
        : (actor.name ?? "Hacking Attempt");

  await attemptFaseripHack({
    actor,
    attributeName: `${actor.name} Hacking Attempt`,
    attributeRank,
    chartShift,
    talentNames,
    minigameType: options.minigameType,
    label,
    liveAudience: "everyone",
    requiredColor,
    targets: targets.length > 0 ? targets : undefined,
    onSuccess: () => {},
    onFailure: () => {}
  });
}
