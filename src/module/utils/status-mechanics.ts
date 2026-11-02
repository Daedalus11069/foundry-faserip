/**
 * Mechanical rules for Foundry's registered status conditions (sleep, stun,
 * prone, etc.): whenever one of these is active on an actor - applied by a
 * power/weapon, the token HUD, or the Effects tab - its rules here apply.
 *
 * This file is the query/rules layer only (pure, no socket/roll imports, so
 * stat-debuffs.ts can use it without import cycles). The turn-start work -
 * periodic damage/healing, removal tests, escape rolls - lives in
 * status-ticks.ts, and the token/movement hooks in status-hooks.ts.
 *
 * Statuses are detected through actor.statuses, which covers every source
 * (HUD toggle, applyTemporaryModifier kind "status", power effects).
 *
 * A status can carry a payload on the effect's flags.faserip (chartShift and
 * attribute for upgrade/downgrade; dotDamage/dotRank for periodic ticks).
 * When the effect has none, the DEFAULT_* values below apply.
 */
import { Rank, RANK_ORDER, RANK_VALUES } from "../enums";
import type { AttributeKey } from "./stat-debuffs";

const COMBAT_ATTRIBUTES: AttributeKey[] = ["fighting", "agility"];

/** Tick amount for a periodic status with no rank supplied by its source. */
export const DEFAULT_TICK_RANK = Rank.Poor;
/** Chart shift for upgrade/downgrade with no shift supplied by its source. */
export const DEFAULT_UPGRADE_SHIFT = 1;

/** Statuses that stop an actor attacking, using powers, and defending. */
const ACTION_BLOCKING: Record<string, string> = {
  unconscious: "unconscious",
  sleep: "asleep",
  stun: "stunned",
  paralysis: "paralyzed"
};

/** Of the above, the ones that only stop PHYSICAL actions (mental powers still work). */
const PHYSICAL_ONLY_BLOCKING = new Set(["paralysis"]);

const MOVEMENT_BLOCKING: Record<string, string> = {
  unconscious: "unconscious",
  sleep: "asleep",
  paralysis: "paralyzed",
  restrain: "restrained",
  frozen: "frozen"
};

/** Fixed chart shifts a status applies to attributes while active. */
const STATUS_ATTRIBUTE_SHIFTS: Record<
  string,
  Partial<Record<AttributeKey, number>>
> = {
  prone: { fighting: -1, agility: -1 },
  blind: { fighting: -2, agility: -2 },
  fear: { fighting: -1, agility: -1 }
};

/** Chart shift applied to attacks against an actor with this status. */
const INCOMING_ATTACK_SHIFTS: Record<string, number> = {
  invisible: -2
};

/** Token movement action a status forces while active (restored to "walk" after). */
export const STATUS_MOVEMENT_ACTIONS: Record<string, string> = {
  prone: "crawl",
  fly: "fly",
  hover: "fly"
};

/** Words that mark a power as sound/speech-based for Silence. */
const SOUND_POWER_PATTERN =
  /\b(voice|sonic|sound|scream|shriek|song|siren|speech|sing)\b/i;

export function hasStatus(actor: any, statusId: string): boolean {
  return !!actor?.statuses?.has?.(statusId);
}

/** Every enabled ActiveEffect on the actor that carries this status. */
export function getStatusEffects(actor: any, statusId: string): any[] {
  return Array.from(actor?.effects ?? []).filter(
    (effect: any) => !effect.disabled && effect.statuses?.has?.(statusId)
  );
}

export function getStatusLabel(statusId: string): string {
  const config = (CONFIG.statusEffects as any[]).find(s => s.id === statusId);
  return typeof config?.name === "string"
    ? ((game as any).i18n?.localize(config.name) ?? config.name)
    : statusId;
}

/** Why the actor can't attack or use a power right now, or null if they can. */
export function getActionBlockReason(
  actor: any,
  options: { physical?: boolean } = {}
): string | null {
  const physical = options.physical ?? true;
  for (const [statusId, word] of Object.entries(ACTION_BLOCKING)) {
    if (!hasStatus(actor, statusId)) continue;
    if (PHYSICAL_ONLY_BLOCKING.has(statusId) && !physical) continue;
    return word;
  }
  return null;
}

/**
 * Whether the actor can't defend against a physical attack because of a
 * status. Same statuses as getActionBlockReason; stun and unconscious were
 * already handled separately by the defense flow, this adds sleep/paralysis.
 */
export function cannotPhysicallyDefend(actor: any): boolean {
  return getActionBlockReason(actor, { physical: true }) !== null;
}

/** Why the actor can't move right now, or null if they can. */
export function getMovementBlockReason(actor: any): string | null {
  for (const [statusId, word] of Object.entries(MOVEMENT_BLOCKING)) {
    if (hasStatus(actor, statusId)) return word;
  }
  return null;
}

function isSoundPower(power: any): boolean {
  const types: string[] = [
    ...(power?.damageTypes ?? []),
    ...(power?.damageType ? [power.damageType] : [])
  ];
  return types.includes("sonic") || SOUND_POWER_PATTERN.test(power?.name ?? "");
}

/** Why this specific power can't be used (action blocks + Silence), or null. */
export function getPowerBlockReason(actor: any, power: any): string | null {
  const types: string[] = [
    ...(power?.damageTypes ?? []),
    ...(power?.damageType ? [power.damageType] : [])
  ];
  const mentalOnly = types.length > 0 && types.every(t => t === "mental");
  const actionBlock = getActionBlockReason(actor, { physical: !mentalOnly });
  if (actionBlock) return actionBlock;
  if (hasStatus(actor, "silence") && isSoundPower(power)) return "silenced";
  return null;
}

/** Chart shift for attacks AGAINST this actor from its statuses (e.g. invisible). */
export function getIncomingAttackStatusShift(actor: any): number {
  let total = 0;
  for (const [statusId, shift] of Object.entries(INCOMING_ATTACK_SHIFTS)) {
    if (hasStatus(actor, statusId)) total += shift;
  }
  return total;
}

export interface StatusAttributeModifier {
  id: string;
  chartShift: number;
  sourcePowerName: string;
}

/** Chart-shift modifiers statuses apply to one attribute, for getEffectiveAttributeData. */
export function getStatusAttributeModifiers(
  actor: any,
  attribute: AttributeKey
): StatusAttributeModifier[] {
  const modifiers: StatusAttributeModifier[] = [];

  for (const [statusId, shifts] of Object.entries(STATUS_ATTRIBUTE_SHIFTS)) {
    const shift = shifts[attribute];
    if (shift && hasStatus(actor, statusId)) {
      modifiers.push({
        id: `status-${statusId}`,
        chartShift: shift,
        sourcePowerName: getStatusLabel(statusId)
      });
    }
  }

  // Upgrade/Downgrade: the source's shift/attribute if supplied (flags),
  // otherwise the default shift across every attribute.
  for (const [statusId, sign] of [
    ["upgrade", 1],
    ["downgrade", -1]
  ] as const) {
    for (const effect of getStatusEffects(actor, statusId)) {
      const flags = effect.flags?.faserip ?? {};
      if (flags.attribute && flags.attribute !== attribute) continue;
      const supplied = Number(flags.chartShift) || 0;
      const shift = supplied !== 0 ? supplied : sign * DEFAULT_UPGRADE_SHIFT;
      modifiers.push({
        id: `status-${statusId}-${effect.id}`,
        chartShift: shift,
        sourcePowerName: getStatusLabel(statusId)
      });
    }
  }

  return modifiers;
}

/**
 * Stun forces Fighting and Agility to Feeble. Returns the capped rank, or the
 * rank unchanged if no status caps this attribute (or it's already lower).
 */
export function applyStatusRankOverride(
  actor: any,
  attribute: AttributeKey,
  rank: Rank
): Rank {
  if (!COMBAT_ATTRIBUTES.includes(attribute) || !hasStatus(actor, "stun")) {
    return rank;
  }
  const rankIndex = RANK_ORDER.indexOf(rank);
  const feebleIndex = RANK_ORDER.indexOf(Rank.Feeble);
  return rankIndex > feebleIndex ? Rank.Feeble : rank;
}

/** Amount one tick of a periodic status deals/heals: the effect's own payload, else the default. */
export function getTickAmount(effect: any): { amount: number; rank: string } {
  const flags = effect?.flags?.faserip ?? {};
  if (Number(flags.dotDamage) > 0) {
    return { amount: Number(flags.dotDamage), rank: "" };
  }
  if (flags.dotRank && RANK_VALUES[flags.dotRank as Rank] !== undefined) {
    return { amount: RANK_VALUES[flags.dotRank as Rank], rank: flags.dotRank };
  }
  return { amount: RANK_VALUES[DEFAULT_TICK_RANK], rank: DEFAULT_TICK_RANK };
}
