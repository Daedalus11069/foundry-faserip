/**
 * Temporary stat/damage modifiers, implemented as native Foundry ActiveEffects
 * carrying their chart-shift data in flags.faserip. Round-based expiry is
 * tracked explicitly via flags.faserip.roundsRemaining (decremented by the
 * combatRound hook in faserip.ts) rather than Foundry's built-in duration.
 *
 * The effect is deliberately given NO finite native duration (no
 * duration.rounds/turns/seconds). Foundry's core ActiveEffectRegistry
 * auto-expires and deletes any effect with a finite duration.value on every
 * combat round/turn change (see ActiveEffectRegistry#refresh, "roundEnd"/
 * "roundStart" events), independently of and concurrently with our own
 * combatRound hook. With a finite duration set, both systems raced to delete
 * the same effect on the same round transition, causing server-side
 * "id does not exist" errors. Leaving duration unset (infinite) means only
 * our own flags.faserip.roundsRemaining tracking ever deletes the effect.
 */
import type { AttributeKey } from "./stat-debuffs";

/**
 * "nextAttack"/"nextDodge"/"nextAction" effects are consumed the first time a
 * matching roll happens (see consumeTriggeredModifiers), regardless of
 * roundsRemaining. roundsRemaining still acts as a round-based backstop so a
 * trigger effect that's never used eventually falls off (per the source
 * table's "next round" wording) instead of lingering forever.
 */
export type TemporaryModifierTrigger =
  | "nextAttack"
  | "nextDodge"
  | "nextAction";

export interface TemporaryModifierFlags {
  kind: "stat" | "damage" | "incoming";
  attribute?: AttributeKey;
  chartShift: number;
  roundsRemaining: number;
  trigger?: TemporaryModifierTrigger;
  /**
   * Only meaningful when trigger is set. Number of matching rolls the
   * modifier survives before being deleted - each matching roll decrements
   * it by 1 instead of deleting the effect outright. Undefined preserves the
   * original behavior of consuming (deleting) on the first matching roll.
   */
  usesRemaining?: number;
  sourcePowerId?: string | null;
  sourcePowerName?: string | null;
  sourceWeaponId?: string | null;
  sourceWeaponName?: string | null;
}

export interface ApplyTemporaryModifierOptions {
  kind: "stat" | "damage" | "incoming";
  attribute?: AttributeKey;
  chartShift: number;
  roundsRemaining: number;
  trigger?: TemporaryModifierTrigger;
  usesRemaining?: number;
  sourceName?: string | null;
  sourcePowerId?: string | null;
  sourceWeaponId?: string | null;
  sourceWeaponName?: string | null;
}

/**
 * Create a temporary ActiveEffect on the actor representing a stat or damage
 * chart-shift modifier. Expiry is handled entirely by flags.faserip.roundsRemaining,
 * unless a trigger is set, in which case a matching roll consumes (deletes) it first.
 */
export async function applyTemporaryModifier(
  actor: any,
  options: ApplyTemporaryModifierOptions
): Promise<any> {
  const chartShift = Number(options.chartShift) || 0;
  const roundsRemaining = Math.max(
    1,
    Math.floor(Number(options.roundsRemaining) || 1)
  );
  const sourceName = options.sourceName?.trim() || "GM Applied";

  const label =
    options.kind === "stat"
      ? `${sourceName} (${options.attribute} ${chartShift > 0 ? "+" : ""}${chartShift}CS)`
      : options.kind === "damage"
        ? `${sourceName} (Damage ${chartShift > 0 ? "+" : ""}${chartShift}CS)`
        : `${sourceName} (Foes ${chartShift > 0 ? "+" : ""}${chartShift}CS to hit)`;

  const usesRemaining = options.usesRemaining
    ? Math.max(1, Math.floor(Number(options.usesRemaining) || 1))
    : undefined;

  const flags: TemporaryModifierFlags = {
    kind: options.kind,
    attribute: options.attribute,
    chartShift,
    roundsRemaining,
    trigger: options.trigger,
    usesRemaining,
    sourcePowerId: options.sourcePowerId ?? null,
    sourcePowerName: options.kind === "stat" ? sourceName : undefined,
    sourceWeaponId: options.sourceWeaponId ?? null,
    sourceWeaponName: options.sourceWeaponName ?? null
  };

  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name: label,
      img:
        chartShift >= 0 ? "icons/svg/upgrade.svg" : "icons/svg/downgrade.svg",
      changes: [],
      flags: {
        faserip: flags
      }
    }
  ]);

  return created;
}

/**
 * Consume (delete) any of the actor's trigger-based modifier effects that
 * match the given roll kind, returning their summed chart shifts so the
 * caller can fold them into the roll before it resolves. Call this once,
 * right before computing the shifted rank, from the single choke point all
 * attribute rolls pass through (FaseripRoll.rollAttribute).
 */
export async function consumeTriggeredModifiers(
  actor: any,
  triggerKind: TemporaryModifierTrigger
): Promise<number> {
  if (!actor?.effects) return 0;

  const matches = Array.from(actor.effects).filter((effect: any) => {
    const flags = effect.flags?.faserip as TemporaryModifierFlags | undefined;
    if (!flags || flags.kind !== "stat") return false;
    if (!isModifierActive(effect)) return false;
    return flags.trigger === triggerKind || flags.trigger === "nextAction";
  }) as any[];

  if (!matches.length) return 0;

  return consumeModifierEffects(actor, matches);
}

/**
 * Consume (delete or decrement usesRemaining on) any "incoming attack"
 * modifier effects on the defender - debuffs like "foes get +2CS to hit me
 * next attack" that shift an attacker's roll instead of the defender's own.
 * Called from the single-target attack-roll path in combat-flow.ts once the
 * defending actor is known, right before the attack's chart shift is
 * finalized.
 */
export async function consumeIncomingAttackModifiers(
  defender: any
): Promise<number> {
  if (!defender?.effects) return 0;

  const matches = Array.from(defender.effects).filter((effect: any) => {
    const flags = effect.flags?.faserip as TemporaryModifierFlags | undefined;
    if (!flags || flags.kind !== "incoming") return false;
    return isModifierActive(effect);
  }) as any[];

  if (!matches.length) return 0;

  return consumeModifierEffects(defender, matches);
}

/**
 * Shared consumption logic: sums the matched effects' chart shifts, then
 * either decrements usesRemaining (if set) or deletes each effect outright.
 */
async function consumeModifierEffects(
  actor: any,
  matches: any[]
): Promise<number> {
  const totalShift = sumChartShift(matches);

  const toDelete: string[] = [];
  for (const effect of matches) {
    const usesRemaining = effect.flags?.faserip?.usesRemaining;
    if (usesRemaining !== undefined && usesRemaining !== null) {
      const next = Number(usesRemaining) - 1;
      if (next > 0) {
        await effect.update({ "flags.faserip.usesRemaining": next });
        continue;
      }
    }
    toDelete.push(effect.id);
  }

  if (toDelete.length > 0) {
    await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
  }

  return totalShift;
}

function isModifierActive(effect: any): boolean {
  if (effect.disabled) return false;
  const roundsRemaining = effect.flags?.faserip?.roundsRemaining;
  if (roundsRemaining !== null && roundsRemaining !== undefined) {
    return Number(roundsRemaining) > 0;
  }
  return true;
}

/**
 * Decrement roundsRemaining on every faserip temporary-modifier ActiveEffect
 * across all combatants for this combat round, deleting any that hit zero.
 * Called from the combatRound hook in faserip.ts.
 */
export async function tickTemporaryModifiers(combat: any): Promise<void> {
  const processedActors = new Set<string>();

  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.token?.actor || combatant.actor;
    if (!actor) continue;

    const actorKey = actor.uuid || actor.id || combatant.id;
    if (processedActors.has(actorKey)) continue;
    processedActors.add(actorKey);

    const modifierEffects = Array.from(actor.effects ?? []).filter(
      (effect: any) => !!effect.flags?.faserip
    );
    if (!modifierEffects.length) continue;

    const toDelete: string[] = [];
    for (const effect of modifierEffects as any[]) {
      // A manual delete (e.g. from EffectsTab) may race with this tick -
      // skip effects that are no longer on the actor rather than erroring.
      if (!actor.effects.get(effect.id)) continue;

      const current = Number(effect.flags.faserip.roundsRemaining ?? 0);
      const next = Math.max(0, current - 1);
      if (next <= 0) {
        toDelete.push(effect.id);
      } else {
        await effect.update({ "flags.faserip.roundsRemaining": next });
      }
    }

    const stillPresent = toDelete.filter(id => actor.effects.get(id));
    if (stillPresent.length > 0) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", stillPresent);
    }
  }
}

/**
 * All active (non-expired), passively-applied temporary stat modifier effects
 * on the actor. Trigger-based effects (flags.faserip.trigger set) are
 * excluded here — they only apply once, via consumeTriggeredModifiers, at the
 * moment a matching roll happens. Including them here too would double-apply
 * their chart shift (once passively, once on consumption).
 */
export function getActiveStatModifierEffects(
  actor: any,
  attribute?: AttributeKey
): any[] {
  return Array.from(actor.effects ?? []).filter((effect: any) => {
    const flags = effect.flags?.faserip as TemporaryModifierFlags | undefined;
    if (flags?.kind !== "stat") return false;
    if (flags.trigger) return false;
    if (attribute && flags.attribute !== attribute) return false;
    return isModifierActive(effect);
  });
}

/** All active (non-expired), passively-applied temporary damage modifier effects on the actor. */
export function getActiveDamageModifierEffects(actor: any): any[] {
  return Array.from(actor.effects ?? []).filter((effect: any) => {
    const flags = effect.flags?.faserip as TemporaryModifierFlags | undefined;
    if (flags?.kind !== "damage") return false;
    if (flags.trigger) return false;
    return isModifierActive(effect);
  });
}

/** Plain, serializable snapshot of a temporary-modifier ActiveEffect, safe to pass through Vue's reactive() without touching the live Foundry document. */
export interface TemporaryModifierSnapshot {
  id: string;
  name: string;
  flags: TemporaryModifierFlags;
}

/**
 * Snapshot every faserip temporary-modifier ActiveEffect on the actor into
 * plain objects. Used to hand modifier data to Vue dialogs (e.g.
 * AttackOptionsDialog/DefenseOptionsDialog) without passing the live actor
 * document itself - VueDialog wraps its props in Vue's reactive(), which
 * deep-proxies objects and breaks Foundry's EmbeddedCollection internals
 * (actor.effects) if the actor is passed directly.
 */
export function snapshotTemporaryModifiers(
  actor: any
): TemporaryModifierSnapshot[] {
  return Array.from(actor?.effects ?? [])
    .filter((effect: any) => !effect.disabled && !!effect.flags?.faserip)
    .filter(isModifierActive)
    .map((effect: any) => ({
      id: effect.id,
      name: effect.name,
      flags: { ...effect.flags.faserip }
    }));
}

export function sumChartShift(effects: any[]): number {
  return effects.reduce((sum, effect) => {
    const flags = effect.flags?.faserip as TemporaryModifierFlags | undefined;
    return sum + Number(flags?.chartShift || 0);
  }, 0);
}

/**
 * Draw from a configured RollTable setting (e.g. "criticalBotchTable" /
 * "criticalSuccessTable"), post the result to chat, and — if the drawn
 * TableResult has flags.faserip configured via the Table Effects editor —
 * apply it to actor as a temporary modifier.
 *
 * Centralizes what was previously duplicated (draw + chat post, no effect
 * application) across manual-roll-handler.ts and chat-commands.ts.
 */
export async function drawCriticalTableEffect(
  actor: any,
  settingKey: "criticalBotchTable" | "criticalSuccessTable",
  label: "Critical Botch Effect" | "Critical Success Effect"
): Promise<void> {
  const tableName = game.settings.get("faserip", settingKey) as string;
  // @ts-expect-error - game.tables exists at runtime
  const table = game.tables?.getName(tableName);
  if (!table) return;

  const rollResult = await table.roll();
  if (!rollResult) return;

  const drawnResults = rollResult.results ?? [];

  await ChatMessage.create({
    content: `<strong>${label}</strong><br>${drawnResults.map((r: any) => r.description || r.text).join("<br>")}`,
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: label
  });

  if (!actor) return;

  for (const result of drawnResults as any[]) {
    const flags = result.flags?.faserip as
      | ApplyTemporaryModifierOptions
      | undefined;
    if (!flags) continue;

    await applyTemporaryModifier(actor, {
      ...flags,
      sourceName: result.description || result.text || label
    });
  }
}
