import { FaseripRoll } from "../rolling/FaseripRoll";
import { Rank, RollResult } from "../enums";
import type { FaseripActor } from "../documents";
import {
  rollFaseripHackCheck,
  meetsRequiredColor,
  parseRequiredColor,
  ROLL_COLOR_RANK,
  type FaseripHackContext,
  type HackTargetInfo
} from "./holosuite-roll-adapter";
import { showTalentSelectionDialog } from "../applications/dialog-utils";
import { findTokenControllers, requestNodeHackMode } from "../socket/faserip-socket";
import { promptAndApplyHackDebuff } from "./holosuite-hacking";
import type { Talent } from "../types";

declare const game: any;
declare const ui: any;
declare const canvas: any;
declare const globalThis: any;

export const NODE_HACKER_MODULE_ID = "foundryvtt-node-hacker";

/**
 * Node Hacker replacement for the HoloSuite Hacking integration
 * (see holosuite-hacking.ts, now unused). Unlike HoloSuite, Node Hacker exposes a real
 * `CheckResolver` extension point and resolves every node capture attempt through it
 * natively, so there's no need for HoloSuite's libWrapper patching of private minigame
 * internals (see the now-unused holosuite-node-intrusion-patch.ts) - this system just
 * registers a resolver once and Node Hacker calls back into it per node.
 *
 * PvP note: this drops HoloSuite's hidden-map/node-ownership-flip/scan mechanics
 * (holosuite-pvp-intrusion.ts) in favor of Node Hacker's own built-in managed mode - a
 * real GM-authoritative live session (see attemptFaseripNodeHack's `managed` option and
 * presentHackToActor's combat-pairing check below). The GM still runs the trace/defense
 * side directly (via Node Hacker's GmTraceApp), same as HoloSuite's "GM plays defender"
 * fallback for an unowned NPC - the difference here is trace rolls use the targeted
 * actor's own FASERIP stats (via `defenderActor`) instead of an abstract minigame value.
 */
export function findHackingTalent(actor: FaseripActor): Talent | null {
  const talents: Talent[] = (actor as any)?.system?.talents ?? [];
  const activeFormId = (actor as any).getCurrentForm?.()?.id;
  return (
    talents.find(
      t =>
        t.name?.trim().toLowerCase() === "hacking" &&
        (!t.formIds?.length || (activeFormId && t.formIds.includes(activeFormId)))
    ) ?? null
  );
}

export function getNodeHackerApi(): any | null {
  const module = game.modules?.get?.(NODE_HACKER_MODULE_ID);
  // `module.api` is only set once Node Hacker's own "ready" hook runs, so an active-but-not-yet-
  // initialized module reads as `undefined` here, not `null` - normalize it so callers doing a
  // strict `!== null` check don't get fooled into thinking the API is actually available.
  return module?.active && module.api ? module.api : null;
}

/** Names of every graph saved in Node Hacker's Node Designer, for populating a graph-name
 * select list rather than asking the GM to type a name exactly right. */
export async function listNodeHackerGraphNames(): Promise<string[]> {
  const api = getNodeHackerApi();
  if (!api) return [];
  const graphs = await api.graphs.list();
  return graphs.map((g: { name: string }) => g.name).sort();
}

export function isNodeHackerActive(): boolean {
  return getNodeHackerApi() !== null;
}

/** Per-actor FASERIP check context Node Hacker replays for every node capture attempt,
 * for the duration of one hack session. Keyed by actor UUID so simultaneous hacks by
 * different actors (e.g. two players hacking separate terminals) don't collide. */
const pendingContexts = new Map<string, FaseripHackContext>();

function contextKey(actor: FaseripActor): string {
  return (actor as any).uuid ?? actor.id ?? "";
}

export function setHackContext(actor: FaseripActor, context: FaseripHackContext | null): void {
  const key = contextKey(actor);
  if (context) pendingContexts.set(key, context);
  else pendingContexts.delete(key);
}

/**
 * A trace recapture roll normally has no FASERIP actor to check against - Node Hacker's
 * trace side resolves with `context.actor: null` unless a managed session was started
 * with a `defenderActor` (see attemptFaseripNodeHack's `managed` option). With no
 * defender context, this falls back to a flat 1d100 vs. a difficulty-scaled threshold,
 * just to keep trace rolls appearing in chat alongside the hacker's own FASERIP rolls.
 */
async function resolveTraceCheck(context: any): Promise<{ success: boolean; total: number }> {
  if (context.actor) {
    const hackContext = pendingContexts.get(contextKey(context.actor));
    if (hackContext) {
      const faseripRoll = await rollFaseripHackCheck(
        { ...hackContext, chartShift: (hackContext.chartShift ?? 0) - (context.difficulty ?? 0) },
        context.label
      );
      return {
        success: meetsRequiredColor(faseripRoll.result, hackContext.requiredColor),
        total: faseripRoll.roll.total
      };
    }
  }

  const threshold = 30 + (context.difficulty ?? 0) * 12;
  const roll = await new Roll("1d100").evaluate();
  const total = roll.total ?? 0;
  await roll.toMessage({ flavor: `${context.label ?? "Trace"} (DC ${threshold})` });
  return { success: total >= threshold, total };
}

/**
 * Maps a node's difficulty rating to the minimum Universal Table color a node-capture roll
 * must reach - ported from the original libWrapper-based HoloSuite hacking modification:
 * difficulty 1 needed Green or better, 2 needed Yellow or better, 3 needed Red. Difficulty 0
 * (a trivial node) needs no more than any success at all, same as difficulty 1. Anything
 * above 3 stays capped at Red - there's no color harder than that to demand.
 *
 * Exposed as a settable function (mirroring setDefaultHackAttribute) so a homebrew ruleset
 * can define its own difficulty->color curve instead of being stuck with this one.
 */
let difficultyRequiredColor = (difficulty: number): RollResult => {
  if (difficulty >= 3) return RollResult.Red;
  if (difficulty === 2) return RollResult.Yellow;
  return RollResult.Green;
};

export function setDifficultyRequiredColor(mapper: (difficulty: number) => RollResult): void {
  difficultyRequiredColor = mapper;
}

export function getDifficultyRequiredColor(difficulty: number): RollResult {
  return difficultyRequiredColor(difficulty);
}

/** The stricter (harder to satisfy) of two required colors - a node's own difficulty tier
 * should never make a hack EASIER than whatever the overall target already demanded. */
function stricterColor(a: RollResult, b: RollResult): RollResult {
  return ROLL_COLOR_RANK[a] >= ROLL_COLOR_RANK[b] ? a : b;
}

let resolverRegistered = false;

/**
 * Registers this system's dice resolver with Node Hacker, once. Every node capture
 * attempt replays the same FASERIP attribute check that gated entry into the hack,
 * chart-shifted harder per node by that node's difficulty rating - unlike HoloSuite's
 * node-intrusion (one check up front, then abstract minigame mechanics with no further
 * dice), every node here gets its own full attribute roll, chat card, and karma-spend
 * opportunity.
 */
export function registerNodeHackerCheckResolver(): void {
  const api = getNodeHackerApi();
  if (!api || resolverRegistered) return;
  resolverRegistered = true;

  // Node Hacker's default reward-item type ("consumable") isn't a valid FASERIP Item type -
  // this system only allows power/talent/equipment/contact/armor/weapon (see system.json).
  // Without this, granting a database's Nuke/Stop Virus reward throws a
  // DataModelValidationError and the item is silently never created.
  api.items.setItemType("equipment");

  // Node Hacker's designer/generator clamp a node's own base difficulty to whatever this is
  // set to - 2 matches difficultyRequiredColor below (1 -> Green, 2 -> Yellow), leaving Red
  // (3) reachable only through Fortify's +1, never a base value straight from generation or
  // the designer.
  api.setMaxDifficulty(2);

  api.checks.setResolver(async (context: any) => {
    if (context.side === "trace" || !context.actor) {
      return resolveTraceCheck(context);
    }

    const hackContext = pendingContexts.get(contextKey(context.actor));

    // A node's own difficulty sets a minimum color it demands on top of whatever the
    // overall target already required (see difficultyRequiredColor/stricterColor) - the
    // chart shift below makes the roll itself harder to land well, and this is the separate,
    // original HoloSuite-style gate on top of that: even a great roll doesn't pass a
    // difficulty-3 node unless it actually came up Red.
    const nodeRequiredColor = stricterColor(
      getDifficultyRequiredColor(context.difficulty ?? 0),
      hackContext?.requiredColor ?? RollResult.Green
    );

    if (!hackContext) {
      // No FASERIP context registered for this actor (e.g. a session started outside
      // this integration) - fall back to a plain Typical-rank check rather than no-op.
      const faseripRoll = await FaseripRoll.rollAttribute(
        context.label ?? "Hacking Attempt",
        Rank.Typical,
        6,
        -(context.difficulty ?? 0),
        context.actor
      );
      return {
        success: meetsRequiredColor(faseripRoll.result, nodeRequiredColor),
        total: faseripRoll.roll.total
      };
    }

    const faseripRoll = await rollFaseripHackCheck(
      { ...hackContext, chartShift: (hackContext.chartShift ?? 0) - (context.difficulty ?? 0) },
      context.label
    );
    return {
      success: meetsRequiredColor(faseripRoll.result, nodeRequiredColor),
      total: faseripRoll.roll.total
    };
  });
}

/** Runs the hack as a Node Hacker managed session instead of solo: the GM keeps the
 * trace-control window (GmTraceApp) open and every trace-side check rolls this actor's
 * own FASERIP stats, while the attacker's owning player (if any) is prompted to open
 * their live hacker view. See resolveManagedHackMode for when this applies. */
export interface FaseripDefenderContext {
  actor: FaseripActor;
  attributeName: string;
  attributeRank: Rank;
  chartShift?: number;
  talentNames?: string[];
  requiredColor?: RollResult;
}

export interface AttemptFaseripNodeHackParams {
  actor: FaseripActor;
  attributeName: string;
  attributeRank: Rank;
  chartShift?: number;
  talentNames?: string[];
  label?: string;
  /** Minimum Universal Table color required on every node, sourced from a hackable
   * target's hackRequiredColor. Defaults to Green. */
  requiredColor?: RollResult;
  /** Difficulty rating for each node of a generated linear chain, one real target per
   * stage (see presentHackToActor's multi-target case). Ignored if `graphName` is set, and
   * only used when there's more than one stage - a single/no stage instead rolls an opening
   * check and generates a full network sized off its result (see attemptFaseripNodeHack). */
  stageDifficulties?: number[];
  /** Use a GM-designed graph (built with the Node Designer) instead of generating one. */
  graphName?: string;
  managed?: FaseripDefenderContext;
  /** Which "prior pvp code" passive trace flavor to run when this isn't managed - a timed
   * countdown that only starts once a node attempt first fails, or a meter that only grows
   * on failure (see Trace.registerAttempt). Falls back to the "hackTraceMode" world setting
   * if the caller didn't already ask the GM (see requestNodeHackMode). */
  traceUnit?: "time" | "points";
  onSuccess?: () => void;
  onFailure?: () => void;
}

/**
 * Only single-target hacks can go managed (Node Hacker's managed mode is one trace vs.
 * one hacker), and both sides must already be Combatants in the active encounter -
 * managed mode needs a real turn order to advance the trace against (see
 * `api.registerCombatTurnAdvance`). Mirrors resolvePvpCombatants' gating in the old
 * HoloSuite integration, minus the separate combatant-id bookkeeping Node Hacker doesn't need.
 */
function shouldRunManaged(attacker: FaseripActor, targetTokenId: string | undefined): boolean {
  if (!targetTokenId) return false;
  const combatants = game.combat?.combatants;
  if (!combatants) return false;
  const attackerCombatant = combatants.find((c: any) => c.actorId === attacker.id);
  const defenderCombatant = combatants.find((c: any) => c.tokenId === targetTokenId);
  return !!(attackerCombatant && defenderCombatant);
}

/**
 * How hard/large a procedurally generated network is, keyed by the opening hack roll's
 * Universal Table color. `difficulty` is capped at 2 by RandomGraphGenerator regardless of
 * what's passed here (see MAX_GENERATED_DIFFICULTY there) - difficulty 3, needing a Red on
 * every node, only ever comes from Fortify during play, never straight from generation. So
 * a bare Green pass and an outright White failure can't be distinguished by node difficulty
 * alone (both already at the ceiling) - a failed roll instead gets thrown into the "huge"
 * network size, meaningfully harder through sheer number of Yellow-gated nodes to fight
 * through rather than a bigger, mechanically-meaningless difficulty number.
 */
function graphParamsForOpeningRoll(color: RollResult): { size: "small" | "medium" | "large" | "huge"; difficulty: number } {
  switch (color) {
    case RollResult.Red:
      return { size: "small", difficulty: 1 };
    case RollResult.Yellow:
      return { size: "medium", difficulty: 1 };
    case RollResult.Green:
      return { size: "large", difficulty: 2 };
    default:
      return { size: "huge", difficulty: 2 };
  }
}

/**
 * Rolls the given FASERIP attribute/talent check's karma-spend dialog once up front
 * (mirroring attemptFaseripHack's UX), tags the actor's per-session check context, then
 * launches the Node Hacker minigame - either against a GM-designed graph, a chain of real
 * per-target stages, or (the common case) a procedurally generated network sized off this
 * same opening roll's result.
 */
export async function attemptFaseripNodeHack(params: AttemptFaseripNodeHackParams) {
  const api = getNodeHackerApi();
  if (!api) {
    ui.notifications?.warn?.("Node Hacker is not active in this world.");
    return null;
  }

  registerNodeHackerCheckResolver();

  // A saved graph wins if named. Multiple stages means multiple real targets (one node per
  // target, see presentHackToActor) - a straight chain is the right shape there since each
  // node stands for something specific. Otherwise there's no real per-node data to lay out
  // and no trivial "single node" placeholder either - the opening check itself is rolled
  // right here, and its success color drives how large/hard the generated network is.
  const label = params.label ?? "Hack Attempt";
  let graphConfig: any;
  if (params.graphName) {
    graphConfig = await api.graphs.get(params.graphName);
  } else if (params.stageDifficulties && params.stageDifficulties.length > 1) {
    graphConfig = api.generateQuickGraph(label, params.stageDifficulties);
  } else {
    const openingRoll = await rollFaseripHackCheck(
      {
        actor: params.actor,
        attributeName: params.attributeName,
        attributeRank: params.attributeRank,
        chartShift: params.chartShift,
        talentNames: params.talentNames,
        requiredColor: params.requiredColor
      },
      label
    );

    // A failed opening roll no longer aborts the attempt outright - it generates the hardest,
    // largest network instead (see graphParamsForOpeningRoll's White case), so the hacker
    // still gets a real minigame to fight through rather than a flat "no" with nothing to do.
    const { size, difficulty } = graphParamsForOpeningRoll(openingRoll.result);
    graphConfig = api.generateRandomGraph(label, difficulty, size);
  }

  if (!graphConfig) {
    ui.notifications?.warn?.(`No saved Node Hacker graph named "${params.graphName}" was found.`);
    return null;
  }

  setHackContext(params.actor, {
    actor: params.actor,
    attributeName: params.attributeName,
    attributeRank: params.attributeRank,
    chartShift: params.chartShift,
    talentNames: params.talentNames,
    requiredColor: params.requiredColor
  });

  const cleanup = () => {
    setHackContext(params.actor, null);
    if (params.managed) setHackContext(params.managed.actor, null);
  };

  if (params.managed) {
    const managedSession = api.startManaged(graphConfig, params.actor, 6, params.managed.actor);
    if (!managedSession) return null; // Already notified - see NodeHackerApi.startManaged.
    const { sessionId, gmApp } = managedSession;

    setHackContext(params.managed.actor, {
      actor: params.managed.actor,
      attributeName: params.managed.attributeName,
      attributeRank: params.managed.attributeRank,
      chartShift: params.managed.chartShift,
      talentNames: params.managed.talentNames,
      requiredColor: params.managed.requiredColor
    });

    api.registerCombatTurnAdvance(sessionId);

    const attackerOwner = findTokenControllers(params.actor)[0];
    if (attackerOwner && !attackerOwner.isGM) {
      api.notifyPlayer(sessionId, attackerOwner.id);
    }

    const onComplete = (completedId: string, _session: any, result: "won" | "lost" | "aborted") => {
      if (completedId !== sessionId) return;
      Hooks.off("nodeHacker.managedSessionComplete", onComplete);
      cleanup();
      // An aborted hack is neither a success nor a failure - no debuff, no consequence, the
      // attempt was simply called off before it resolved either way.
      if (result === "won") params.onSuccess?.();
      else if (result === "lost") params.onFailure?.();
    };
    Hooks.on("nodeHacker.managedSessionComplete", onComplete);

    return gmApp;
  }

  const traceMode = params.traceUnit ?? game.settings?.get?.("faserip", "hackTraceMode") ?? "time";
  // Points mode is always a 0-100% failure meter now (Trace's constructor forces max=100 for
  // it regardless of what's passed here) - this only actually matters for time mode's literal
  // countdown length.
  const traceMax = traceMode === "time" ? 20 : 100;

  const app = await api.startSolo(graphConfig, params.actor, traceMax, traceMode);

  const onComplete = (session: any, result: "won" | "lost" | "aborted") => {
    if (session !== app?.session) return;
    Hooks.off("nodeHacker.sessionComplete", onComplete);
    cleanup();
    if (result === "won") params.onSuccess?.();
    else if (result === "lost") params.onFailure?.();
  };
  Hooks.on("nodeHacker.sessionComplete", onComplete);

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

function difficultyFromColor(color: RollResult): number {
  switch (color) {
    case RollResult.Red:
      return 3;
    case RollResult.Yellow:
      return 2;
    case RollResult.Green:
      return 1;
    default:
      return 0;
  }
}

let defaultHackAttribute = "reasoning";

/** Lets a macro/other module change which attribute the "Present Hack" prompt preselects,
 * instead of it being fixed to "reasoning" in source - e.g. a homebrew ruleset that runs
 * hacking off Intuition instead. */
export function setDefaultHackAttribute(attribute: keyof typeof ATTRIBUTE_LABELS): void {
  defaultHackAttribute = attribute;
}

export function getDefaultHackAttribute(): string {
  return defaultHackAttribute;
}

async function promptForAttribute(): Promise<string | null> {
  const options = Object.entries(ATTRIBUTE_LABELS)
    .map(
      ([key, label]) =>
        `<option value="${key}"${key === defaultHackAttribute ? " selected" : ""}>${label}</option>`
    )
    .join("");

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  return globalThis.foundry.applications.api.DialogV2.prompt({
    window: { title: "Present Hacking Challenge" },
    content: `<div class="form-group"><label>Check Attribute</label><select name="attribute">${options}</select></div>`,
    ok: {
      label: "Present",
      callback: (_event: Event, button: any) => button.form.elements.attribute.value
    },
    rejectClose: false
  });
}

/**
 * Scene-control "Present Hack" action: prompts for a check attribute, lets the player
 * apply talents, then runs attemptFaseripNodeHack - the same flow an Equipment hack lock
 * uses, just without an Item backing it. `actor` is the hacker (the controlled token).
 * Any targeted (Foundry's Target tool) hackable actors set that node's difficulty from
 * their hackRequiredColor and become additional stages of a generated linear graph.
 */
export async function presentHackToActor(actor: FaseripActor): Promise<void> {
  if (!isNodeHackerActive()) {
    ui.notifications?.warn?.("Node Hacker is not active in this world.");
    return;
  }

  const attribute = await promptForAttribute();
  if (!attribute) return;

  const attributeRank: Rank =
    (actor as any).getCurrentForm?.()?.attributes?.[attribute]?.rank ?? Rank.Typical;

  const hackingTalent = findHackingTalent(actor);
  const talents: Talent[] = ((actor as any).system?.talents ?? []).filter(
    (t: Talent) => t.id !== hackingTalent?.id
  );
  const talentNameSet = new Set<string>();
  let chartShift = 0;

  if (hackingTalent) {
    talentNameSet.add(hackingTalent.name);
    chartShift += hackingTalent.bonus;
  }

  if (talents.length > 0) {
    const attributeLabel = ATTRIBUTE_LABELS[attribute] ?? "Hacking";
    const selectedTalents = await showTalentSelectionDialog(talents, attributeLabel);
    if (selectedTalents === null) return; // Cancelled
    for (const t of selectedTalents) {
      talentNameSet.add(t.name);
      chartShift += t.bonus;
    }
  }

  const talentNames = talentNameSet.size > 0 ? [...talentNameSet] : undefined;

  const targetedTokens = [...(game.user?.targets ?? [])] as any[];
  const targets: HackTargetInfo[] = targetedTokens
    .filter(token => token.actor?.system?.hackable)
    .map(token => ({
      tokenId: token.id,
      actorId: token.actor.id,
      actorName: token.actor.name ?? "Target",
      requiredColor: parseRequiredColor(token.actor.system.hackRequiredColor),
      graphName: token.actor.system.hackGraphName || undefined
    }));

  const stageDifficulties =
    targets.length > 0 ? targets.map(t => difficultyFromColor(t.requiredColor)) : [1];

  // A saved graph only makes sense for a single target - it's one fixed network, not
  // something that chains meaningfully across multiple targeted actors.
  const graphName = targets.length === 1 ? targets[0].graphName : undefined;

  const label =
    targets.length > 1
      ? `${actor.name} Hacking ${targets.length} Targets`
      : targets.length === 1
        ? `${actor.name} Hacking ${targets[0].actorName}`
        : (actor.name ?? "Hacking Attempt");

  // A single target that's also in the active combat encounter (alongside the attacker) is
  // technically eligible for a managed session (the trace side rolling that target's own
  // FASERIP stats turn-by-turn), but which mode actually runs is the GM's call, not an
  // automatic decision - see requestNodeHackMode.
  const singleTarget = targets.length === 1 ? targets[0] : undefined;
  const targetActor = singleTarget
    ? ((canvas as any)?.tokens?.get?.(singleTarget.tokenId)?.actor as FaseripActor | undefined)
    : undefined;
  // TODO: PvP managed mode is disabled for now - it can't be tested/finished in the
  // current environment. Re-enable by restoring `!!targetActor && shouldRunManaged(actor,
  // singleTarget!.tokenId)` here once it's been verified end-to-end.
  const canManage = false && !!targetActor && shouldRunManaged(actor, singleTarget!.tokenId);

  const mode = await requestNodeHackMode({
    attackerName: actor.name ?? "Hacker",
    targetName: targetActor?.name,
    canManage
  });

  let managed: FaseripDefenderContext | undefined;
  let traceUnit: "time" | "points" | undefined;
  if (mode === "managed" && targetActor) {
    const defenderRank: Rank =
      (targetActor as any).getCurrentForm?.()?.attributes?.[attribute]?.rank ?? Rank.Typical;
    managed = {
      actor: targetActor,
      attributeName: `${targetActor.name} Defense`,
      attributeRank: defenderRank,
      requiredColor: singleTarget!.requiredColor
    };
  } else {
    traceUnit = mode === "auto-time" ? "time" : "points";
  }

  await attemptFaseripNodeHack({
    actor,
    attributeName: `${actor.name} Hacking Attempt`,
    attributeRank,
    chartShift,
    talentNames,
    managed,
    traceUnit,
    label,
    graphName,
    stageDifficulties,
    // Success proceeds through the same GM debuff-application path HoloSuite's node-intrusion
    // used (promptAndApplyHackDebuff -> applyTemporaryModifier, a real ActiveEffect) - every
    // targeted actor gets prompted once the OVERALL hack succeeds. Unlike HoloSuite's
    // per-node "as each target is individually breached" granularity, Node Hacker only
    // exposes a whole-session success/failure event (nodeHacker.sessionComplete /
    // managedSessionComplete), so multi-target hacks debuff every target together at the end
    // rather than one at a time mid-hack.
    onSuccess: async () => {
      for (const target of targets) {
        await promptAndApplyHackDebuff(target.tokenId, target.actorName);
      }
    },
    onFailure: () => {}
  });
}
