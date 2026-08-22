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
import { Rank, RANK_VALUES } from "../enums";

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
  kind: "stat" | "damage" | "incoming" | "dot";
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
  /** kind: "dot" only - the rank the effect deals damage at, each round it ticks. */
  dotRank?: string;
  /**
   * kind: "dot" only - fixed per-tick damage amount, when the DoT should
   * deal the triggering attack's actual rolled/reduced damage rather than
   * RANK_VALUES[dotRank] every tick. Set once at application time and never
   * re-rolled.
   */
  dotDamage?: number;
  /** kind: "dot" only - armor-piercing rank applied to every tick's damage application. */
  dotArmorPiercing?: string | null;
  /**
   * kind: "dot" only - the actor id of whoever applied this DoT. It ticks
   * once when THIS actor's turn comes up in combat, not the afflicted
   * target's turn and not once per round for everyone.
   */
  dotCasterActorId?: string | null;
  /**
   * kind: "dot" only - when true, roundsRemaining is never decremented and
   * the effect is never auto-deleted by tickTemporaryModifiers. It persists
   * until removed manually (EffectsTab, or requestDotRemoval by any player).
   */
  indefinite?: boolean;
}

export interface ApplyTemporaryModifierOptions {
  kind: "stat" | "damage" | "incoming" | "dot";
  attribute?: AttributeKey;
  chartShift: number;
  roundsRemaining: number;
  trigger?: TemporaryModifierTrigger;
  usesRemaining?: number;
  sourceName?: string | null;
  sourcePowerId?: string | null;
  sourceWeaponId?: string | null;
  sourceWeaponName?: string | null;
  dotRank?: string;
  dotDamage?: number;
  dotArmorPiercing?: string | null;
  dotCasterActorId?: string | null;
  indefinite?: boolean;
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
  const roundsRemaining = options.indefinite
    ? 0
    : Math.max(1, Math.floor(Number(options.roundsRemaining) || 1));
  const sourceName = options.sourceName?.trim() || "GM Applied";

  const label =
    options.kind === "stat"
      ? `${sourceName} (${options.attribute} ${chartShift > 0 ? "+" : ""}${chartShift}CS)`
      : options.kind === "damage"
        ? `${sourceName} (Damage ${chartShift > 0 ? "+" : ""}${chartShift}CS)`
        : options.kind === "dot"
          ? `${sourceName} (${options.dotRank} DoT${options.indefinite ? ", until removed" : ""})`
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
    sourceWeaponName: options.sourceWeaponName ?? null,
    dotRank: options.dotRank,
    dotDamage: options.dotDamage,
    dotArmorPiercing: options.dotArmorPiercing ?? null,
    dotCasterActorId: options.dotCasterActorId ?? null,
    indefinite: options.indefinite
  };

  const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name: label,
      img:
        options.kind === "dot"
          ? "icons/svg/poison.svg"
          : chartShift >= 0
            ? "icons/svg/upgrade.svg"
            : "icons/svg/downgrade.svg",
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
  if (effect.flags?.faserip?.indefinite) return true;
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
 *
 * DoT damage itself is NOT dealt here - see tickDotEffectsForCombatant, fired
 * on turn change against the DoT's caster. This still decrements a DoT's
 * roundsRemaining (so its duration counts down in real rounds) but skips
 * calling applyDotTick a second time.
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

    // Each actor's effects are ticked independently - one actor's update/delete
    // failing (e.g. a permissions or validation error) must not abort the tick
    // for every other combatant, since Hooks.on callbacks reject silently.
    try {
      const toDelete: string[] = [];
      for (const effect of modifierEffects as any[]) {
        // A manual delete (e.g. from EffectsTab) may race with this tick -
        // skip effects that are no longer on the actor rather than erroring.
        if (!actor.effects.get(effect.id)) continue;

        const flags = effect.flags.faserip as TemporaryModifierFlags;

        if (flags.indefinite) continue;

        const current = Number(flags.roundsRemaining ?? 0);
        const next = Math.max(0, current - 1);
        try {
          if (next <= 0) {
            toDelete.push(effect.id);
          } else {
            await effect.update({ "flags.faserip.roundsRemaining": next });
          }
        } catch (err) {
          console.error(
            `faserip | failed to tick temporary modifier "${effect.name}" on ${actor.name}`,
            err
          );
        }
      }

      const stillPresent = toDelete.filter(id => actor.effects.get(id));
      if (stillPresent.length > 0) {
        await actor.deleteEmbeddedDocuments("ActiveEffect", stillPresent);
      }
    } catch (err) {
      console.error(
        `faserip | failed to tick temporary modifiers for ${actor.name}`,
        err
      );
    }
  }
}

/**
 * Deals damage for every active DoT effect (on any actor in this combat)
 * whose caster is one of the given combatants. Called from the updateCombat
 * "turn changed" hook in faserip.ts, once per combatant whose turn started -
 * normally just the one combatant whose turn just began, but the caller may
 * pass several when a "Next Round" jump skipped past other combatants'
 * turns entirely (see faserip.ts), so a DoT doesn't silently miss ticks
 * whenever a GM uses the round-skip shortcut instead of stepping through
 * every turn.
 */
export async function tickDotEffectsForCombatant(
  combat: any,
  activeCombatants: any | any[]
): Promise<void> {
  const combatantList: any[] = Array.isArray(activeCombatants)
    ? activeCombatants
    : [activeCombatants];

  for (const activeCombatant of combatantList) {
    const casterActor = activeCombatant?.token?.actor || activeCombatant?.actor;
    if (!casterActor) continue;

    const casterActorId = casterActor.id;

    for (const combatant of combat.combatants ?? []) {
      const actor = combatant.token?.actor || combatant.actor;
      if (!actor) continue;

      const dotEffects = Array.from(actor.effects ?? []).filter(
        (effect: any) =>
          effect.flags?.faserip?.kind === "dot" &&
          effect.flags?.faserip?.dotCasterActorId === casterActorId
      ) as any[];

      for (const effect of dotEffects) {
        if (!actor.effects.get(effect.id)) continue;

        const flags = effect.flags.faserip as TemporaryModifierFlags;
        if (!flags.dotRank) continue;

        try {
          await applyDotTick(actor, combatant.token?.id, flags, effect.name);
        } catch (err) {
          console.error(
            `faserip | failed to apply DoT tick "${effect.name}" on ${actor.name}`,
            err
          );
        }
      }
    }
  }
}

/**
 * Apply one round's worth of damage-over-time to an actor, using the amount
 * fixed at the time the DoT was applied (never re-rolled or recomputed each
 * round). Prefers dotDamage - the triggering attack's actual post-reduction
 * damage - when set; falls back to a flat RANK_VALUES[dotRank] lookup only
 * when the DoT wasn't tied to a specific attack roll (e.g. an automatic
 * "none" effectType power, or a rank explicitly pinned on the power/weapon).
 * Routed through requestDamageApplication so it respects the same owner/GM
 * socket handoff and armor/AP soak as normal hits.
 */
async function applyDotTick(
  actor: any,
  tokenId: string | undefined,
  flags: TemporaryModifierFlags,
  effectName: string
): Promise<void> {
  const damage =
    flags.dotDamage !== undefined && flags.dotDamage > 0
      ? flags.dotDamage
      : (RANK_VALUES[flags.dotRank as Rank] ?? 0);
  if (damage <= 0) return;

  const { requestDamageApplication } = await import(
    "../socket/faserip-socket"
  );

  const result = await requestDamageApplication(
    actor,
    damage,
    "dot",
    effectName,
    tokenId,
    flags.dotArmorPiercing ?? null,
    undefined,
    1
  );

  if (!result) return;

  const apText =
    result.piercingResult && result.piercingResult.piercingValue > 0
      ? ` (${flags.dotArmorPiercing} AP: -${result.piercingResult.piercingValue} armor)`
      : "";

  const rankText =
    flags.dotDamage !== undefined && flags.dotDamage > 0
      ? ""
      : ` ${flags.dotRank}`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: "Damage Over Time",
    content: `<div class="fsr-combat-message" style="background: #14532d; color: #bbf7d0; padding: 0.5rem; border-radius: 4px;">
      <strong>${effectName}</strong>
      <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">
        ${actor.name} takes ${damage}${rankText} damage${apText}
        ${result.armorDamage > 0 ? ` (${result.armorDamage} absorbed by armor, ${result.healthDamage} to health)` : ` (${result.healthDamage} to health)`}.
      </p>
    </div>`
  });
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

/** All active (non-expired) damage-over-time effects on the actor. */
export function getActiveDotEffects(actor: any): any[] {
  return Array.from(actor.effects ?? []).filter((effect: any) => {
    const flags = effect.flags?.faserip as TemporaryModifierFlags | undefined;
    if (flags?.kind !== "dot") return false;
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
