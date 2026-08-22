/**
 * Powers-negation gate. Rather than relying on Region "tokenEnter"/"tokenExit"
 * events to toggle a stored flag/effect (which proved unreliable - event
 * payload shape and firing timing are not fully controlled by this code),
 * isPowersNegated() computes the answer live: does any of the actor's active
 * tokens currently sit inside a Region with an enabled "powerNegation"
 * behavior whose configured actor types include this actor's type?
 *
 * Every player-facing power-use entry point (StatsTab quick-roll, the
 * chat-command power roller, and the passive Body Armor soak in
 * combat-flow.ts) checks isPowersNegated() before proceeding.
 *
 * Exception: a behavior with allowEnduranceResist checked lets the actor
 * attempt an Endurance FEAT roll (see grantNegationResist) to hold off the
 * negation for one round via a stored ActiveEffect flag, checked first here.
 */
export function isPowersNegated(actor: any): boolean {
  if (hasActiveNegationResist(actor)) return false;

  const tokens: any[] = actor?.getActiveTokens?.(true) ?? [];

  for (const token of tokens) {
    const regions: Set<any> | null = token.document?.regions ?? null;
    if (!regions) continue;

    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== "powerNegation") continue;
        if (behavior.disabled) continue;

        const actorTypes: string[] = Array.from(
          behavior.system?.actorTypes ?? []
        );
        if (!actorTypes.length || actorTypes.includes(actor.type)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Whether the actor currently sits inside at least one enabled powerNegation
 * region (matching their actor type) that has allowEnduranceResist checked -
 * i.e. whether an "attempt to resist" Endurance roll is currently offered.
 * Does NOT itself consider whether the actor already has an active resist
 * effect - callers combine this with hasActiveNegationResist as needed.
 */
export function canAttemptNegationResist(actor: any): boolean {
  const tokens: any[] = actor?.getActiveTokens?.(true) ?? [];

  for (const token of tokens) {
    const regions: Set<any> | null = token.document?.regions ?? null;
    if (!regions) continue;

    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== "powerNegation") continue;
        if (behavior.disabled) continue;
        if (!behavior.system?.allowEnduranceResist) continue;

        const actorTypes: string[] = Array.from(
          behavior.system?.actorTypes ?? []
        );
        if (!actorTypes.length || actorTypes.includes(actor.type)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isNegationResistEffect(effect: any): boolean {
  return effect?.flags?.faserip?.negationResist === true;
}

/** Whether the actor currently holds an active (non-expired) negation-resist effect. */
export function hasActiveNegationResist(actor: any): boolean {
  return Array.from(actor?.effects ?? []).some(
    (effect: any) =>
      isNegationResistEffect(effect) &&
      !effect.disabled &&
      Number(effect.flags?.faserip?.roundsRemaining ?? 1) > 0
  );
}

/**
 * Grant the actor a temporary effect that makes isPowersNegated() return
 * false for them, lasting until the start of their next turn (tracked via
 * flags.faserip.roundsRemaining, decremented by the same combatRound hook
 * that ticks every other temporary modifier - see utils/temp-effects.ts).
 * Outside combat it simply lasts until manually removed or combat begins.
 */
export async function grantNegationResist(actor: any): Promise<void> {
  const existing =
    actor.effects?.filter((effect: any) => isNegationResistEffect(effect)) ??
    [];
  if (existing.length) {
    await actor.deleteEmbeddedDocuments(
      "ActiveEffect",
      existing.map((effect: any) => effect.id)
    );
  }

  await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name: "Resisting Power Negation",
      img: "icons/svg/regen.svg",
      changes: [],
      flags: {
        faserip: {
          negationResist: true,
          roundsRemaining: 1
        }
      }
    }
  ]);
}

/**
 * Remove any active negation-resist effect on the actor. Called on
 * tokenEnter for a "powerNegation" region behavior so a resist earned in one
 * field (or a previous visit to the same field) never silently carries into
 * a fresh entry - re-entering always starts from unresisted.
 */
export async function clearNegationResist(actor: any): Promise<void> {
  const existing =
    actor.effects?.filter((effect: any) => isNegationResistEffect(effect)) ??
    [];
  if (!existing.length) return;

  await actor.deleteEmbeddedDocuments(
    "ActiveEffect",
    existing.map((effect: any) => effect.id)
  );
}

/**
 * Create/refresh (or remove) a purely cosmetic "Powers Negated" ActiveEffect
 * on the actor so the negation state is visible as a labeled status icon on
 * the token/sheet. This effect is NOT consulted by isPowersNegated() - it is
 * display-only and best-effort (it depends on the Region tokenEnter/tokenExit
 * events actually firing with the expected payload).
 */
export async function setPowersNegatedIndicator(
  actor: any,
  negated: boolean
): Promise<void> {
  const existing = actor.effects?.filter(
    (effect: any) => effect.flags?.faserip?.powersNegated === true
  );

  if (negated) {
    if (existing?.length) return;
    await actor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: "Powers Negated",
        img: "icons/svg/blind.svg",
        statuses: ["faseripPowersNegated"],
        changes: [],
        flags: {
          faserip: {
            powersNegated: true
          }
        }
      }
    ]);
  } else if (existing?.length) {
    await actor.deleteEmbeddedDocuments(
      "ActiveEffect",
      existing.map((effect: any) => effect.id)
    );
  }
}

function isPowersNegatedEffect(effect: any): boolean {
  return effect?.flags?.faserip?.powersNegated === true;
}

/**
 * Subscribe a callback to fire whenever the given actor's power-negation
 * state might have changed: its token moves (region containment can change),
 * or its cosmetic "Powers Negated" effect is created/deleted. Returns an
 * unsubscribe function - call it from onUnmounted to avoid leaking Hooks
 * listeners across sheet renders.
 */
export function onPowersNegationChange(
  actor: any,
  callback: () => void
): () => void {
  const handleEffectCreate = (effect: any) => {
    if (effect.parent?.id === actor?.id && isPowersNegatedEffect(effect)) {
      callback();
    }
  };
  const handleEffectDelete = (effect: any) => {
    if (effect.parent?.id === actor?.id && isPowersNegatedEffect(effect)) {
      callback();
    }
  };
  const handleTokenUpdate = (tokenDoc: any) => {
    if (tokenDoc.actor?.id === actor?.id) {
      callback();
    }
  };

  Hooks.on("createActiveEffect", handleEffectCreate);
  Hooks.on("deleteActiveEffect", handleEffectDelete);
  Hooks.on("updateToken", handleTokenUpdate);
  Hooks.on("refreshToken", handleTokenUpdate);

  return () => {
    Hooks.off("createActiveEffect", handleEffectCreate);
    Hooks.off("deleteActiveEffect", handleEffectDelete);
    Hooks.off("updateToken", handleTokenUpdate);
    Hooks.off("refreshToken", handleTokenUpdate);
  };
}

/**
 * Power-dampening gate, mirroring isPowersNegated() above but returning a
 * negative chart-shift penalty instead of an all-or-nothing bool. Sums the
 * configured chartShift of every enabled "powerDampening" behavior (matching
 * the actor's type) across all regions any of the actor's tokens sit in, then
 * softens that by any active dampeningResist effect (see
 * grantDampeningResist), floored so resisting can never turn dampening into
 * a bonus.
 *
 * Callers add the result directly into the chart-shift passed to
 * FaseripRoll.rollAttribute for power rolls only - see StatsTab.vue's
 * rollPower and the power branch of chat-commands.ts.
 */
export function getPowerDampeningShift(actor: any): number {
  let totalPenalty = 0;

  const tokens: any[] = actor?.getActiveTokens?.(true) ?? [];
  for (const token of tokens) {
    const regions: Set<any> | null = token.document?.regions ?? null;
    if (!regions) continue;

    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== "powerDampening") continue;
        if (behavior.disabled) continue;

        const actorTypes: string[] = Array.from(
          behavior.system?.actorTypes ?? []
        );
        if (actorTypes.length && !actorTypes.includes(actor.type)) continue;

        const chartShift = Number(behavior.system?.chartShift ?? 0);
        if (chartShift < 0) totalPenalty += chartShift;
      }
    }
  }

  if (totalPenalty >= 0) return 0;

  const resistOffset = getActiveDampeningResistOffset(actor);
  return Math.min(0, totalPenalty + resistOffset);
}

/**
 * Power-enhancement gate, the mirror image of getPowerDampeningShift(): sums
 * the configured chartShift of every enabled "powerEnhancement" behavior
 * (matching the actor's type) across all regions any of the actor's tokens
 * sit in. There's nothing to resist here, so unlike dampening this is a
 * plain sum with no temp-effect softening.
 */
export function getPowerEnhancementShift(actor: any): number {
  let totalBonus = 0;

  const tokens: any[] = actor?.getActiveTokens?.(true) ?? [];
  for (const token of tokens) {
    const regions: Set<any> | null = token.document?.regions ?? null;
    if (!regions) continue;

    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== "powerEnhancement") continue;
        if (behavior.disabled) continue;

        const actorTypes: string[] = Array.from(
          behavior.system?.actorTypes ?? []
        );
        if (actorTypes.length && !actorTypes.includes(actor.type)) continue;

        const chartShift = Number(behavior.system?.chartShift ?? 0);
        if (chartShift > 0) totalBonus += chartShift;
      }
    }
  }

  return totalBonus;
}

/**
 * Convenience wrapper combining getPowerDampeningShift and
 * getPowerEnhancementShift into the single chart-shift delta callers should
 * add to a power roll (dampening and enhancement regions can both be
 * present, e.g. overlapping regions from different sources).
 */
export function getPowerChartShift(actor: any): number {
  return getPowerDampeningShift(actor) + getPowerEnhancementShift(actor);
}

/**
 * Whether the actor currently sits inside at least one enabled
 * powerDampening region (matching their actor type) that has
 * allowEnduranceResist checked - i.e. whether an "attempt to resist" roll is
 * currently offered.
 */
export function canAttemptDampeningResist(actor: any): boolean {
  const tokens: any[] = actor?.getActiveTokens?.(true) ?? [];

  for (const token of tokens) {
    const regions: Set<any> | null = token.document?.regions ?? null;
    if (!regions) continue;

    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== "powerDampening") continue;
        if (behavior.disabled) continue;
        if (!behavior.system?.allowEnduranceResist) continue;

        const actorTypes: string[] = Array.from(
          behavior.system?.actorTypes ?? []
        );
        if (!actorTypes.length || actorTypes.includes(actor.type)) {
          return true;
        }
      }
    }
  }

  return false;
}

function isDampeningResistEffect(effect: any): boolean {
  return effect?.flags?.faserip?.dampeningResist === true;
}

/** Whether the actor currently holds an active (non-expired) dampening-resist effect. */
export function hasActiveDampeningResist(actor: any): boolean {
  return Array.from(actor?.effects ?? []).some(
    (effect: any) =>
      isDampeningResistEffect(effect) &&
      !effect.disabled &&
      Number(effect.flags?.faserip?.roundsRemaining ?? 1) > 0
  );
}

function getActiveDampeningResistOffset(actor: any): number {
  return Array.from(actor?.effects ?? []).reduce((sum: number, effect: any) => {
    if (!isDampeningResistEffect(effect)) return sum;
    if (effect.disabled) return sum;
    if (Number(effect.flags?.faserip?.roundsRemaining ?? 1) <= 0) return sum;
    return sum + Number(effect.flags?.faserip?.dampeningOffset ?? 0);
  }, 0);
}

/**
 * Grant the actor a temporary effect that softens getPowerDampeningShift()
 * by `offset` chart-shifts (a positive number of CS given back), lasting
 * until the start of their next turn - same roundsRemaining tick as every
 * other temporary modifier (see utils/temp-effects.ts).
 */
export async function grantDampeningResist(
  actor: any,
  offset: number
): Promise<void> {
  const existing =
    actor.effects?.filter((effect: any) => isDampeningResistEffect(effect)) ??
    [];
  if (existing.length) {
    await actor.deleteEmbeddedDocuments(
      "ActiveEffect",
      existing.map((effect: any) => effect.id)
    );
  }

  await actor.createEmbeddedDocuments("ActiveEffect", [
    {
      name: `Resisting Power Dampening (+${offset}CS)`,
      img: "icons/svg/upgrade.svg",
      changes: [],
      flags: {
        faserip: {
          dampeningResist: true,
          dampeningOffset: offset,
          roundsRemaining: 1
        }
      }
    }
  ]);
}

/**
 * Remove any active dampening-resist effect on the actor. Called on
 * tokenEnter for a "powerDampening" region behavior so a resist earned in
 * one field (or a previous visit to the same field) never silently carries
 * into a fresh entry - re-entering always starts from unresisted.
 */
export async function clearDampeningResist(actor: any): Promise<void> {
  const existing =
    actor.effects?.filter((effect: any) => isDampeningResistEffect(effect)) ??
    [];
  if (!existing.length) return;

  await actor.deleteEmbeddedDocuments(
    "ActiveEffect",
    existing.map((effect: any) => effect.id)
  );
}
