/**
 * Tracks the cumulative number of combat attacks taken by each actor during
 * their current turn via actor.system.actionsThisTurn (persisted to Foundry).
 *
 * Reads/writes go through the reactive actor system object so Vue's reactivity
 * keeps values current without waiting for async Foundry document updates.
 * FsrBaseSheet.#syncReactiveActor is patched to only overwrite actionsThisTurn
 * when that field is explicitly part of the triggering update, preventing other
 * actor updates (karma, health, etc.) from resetting it mid-turn.
 */

/**
 * Return how many attacks this actor has already made this turn.
 * Pass reactiveActor.system for an immediate, reactive read.
 *
 * Returns 0 outside of an active combat encounter — multiple-action CS
 * penalties only apply mid-combat, not to attacks rolled before combat
 * has started or after it has ended.
 */
export function getActionsThisTurn(actorSystem: any): number {
  if (!(game as any).combat) return 0;
  return actorSystem.actionsThisTurn ?? 0;
}

/**
 * Record that this actor completed `count` more attacks this turn.
 * Mutates the reactive system directly; FsrBaseSheet watchIgnorable persists it.
 * No-ops outside of an active combat encounter, since actions are only
 * tracked for the purpose of mid-combat CS penalties.
 */
export function addActionsThisTurn(actorSystem: any, count: number): void {
  if (!(game as any).combat) return;
  const current = actorSystem.actionsThisTurn ?? 0;
  actorSystem.actionsThisTurn = current + count;
}

/**
 * Reset the action count for this actor (called at the start of their turn).
 * Uses actor.update() directly since combat hooks don't have the reactive clone.
 * FsrBaseSheet propagates the reset to the reactive clone because actionsThisTurn
 * IS explicitly in the changed data for this specific update.
 */
export async function resetActionsThisTurn(actor: any): Promise<void> {
  await actor.update({ "system.actionsThisTurn": 0 });
}

/**
 * Clear exhaustion stuns from all combatants — they last one round only.
 * Called from the updateCombat hook in faserip.ts (keyed on changes.round,
 * like tickTemporaryModifiers) rather than Foundry's native "combatRound"
 * hook, because "combatRound" doesn't reliably fire for every round-changing
 * update - e.g. a GM jumping several rounds at once via the combat tracker -
 * which let exhaustion stuns linger past their one-round duration.
 */
export async function clearExhaustionStuns(combat: any): Promise<void> {
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.token?.actor || combatant.actor;
    if (!actor) continue;
    const hasExhaustionStun = actor.getFlag("faserip", "exhaustionStun");
    if (hasExhaustionStun) {
      await actor.toggleStatusEffect("stun", { active: false });
      await actor.unsetFlag("faserip", "exhaustionStun");
    }
  }
}

/**
 * Reset actionsThisTurn for every given combatant. Called from the
 * updateCombat hook in faserip.ts with the active combatant plus any
 * combatants a "Next Round"/multi-round jump skipped past (see
 * getSkippedCombatants), so a skipped combatant's stale action count from
 * before the jump doesn't carry into their next real turn and trigger
 * exhaustion early.
 */
export async function resetActionsThisTurnForCombatants(
  combatants: any[]
): Promise<void> {
  for (const combatant of combatants) {
    const actor = combatant.token?.actor || combatant.actor;
    if (actor) {
      await resetActionsThisTurn(actor);
    }
  }
}

/**
 * Register Foundry combat hooks that auto-reset an actor's count at the start
 * of their turn and when combat ends. Call once from the system init handler.
 */
export function initTurnActionsTracker(): void {
  Hooks.on("combatTurn", async (combat: any) => {
    const current = combat.combatant;
    if (current?.actor) {
      await resetActionsThisTurn(current.actor);
    }
  });

  Hooks.on("combatRound", async (combat: any) => {
    // Reset actions for the first combatant of the new round
    const current = combat.combatant;
    if (current?.actor) {
      await resetActionsThisTurn(current.actor);
    }

    // Temporary stat/damage modifiers are ticked separately by
    // tickTemporaryModifiers, called from the updateCombat hook in faserip.ts
    // (deliberately NOT via Foundry's native duration.rounds - see temp-effects.ts).
    // Exhaustion stuns are cleared there too now - see clearExhaustionStuns.
    // Skipped combatants' actionsThisTurn is also reset there now - see
    // resetActionsThisTurnForCombatants - since this hook only ever sees
    // the FINAL combatant of a multi-round jump, not everyone skipped over.
  });

  Hooks.on("deleteCombat", async (combat: any) => {
    for (const combatant of combat.combatants) {
      if (combatant.actor) {
        await resetActionsThisTurn(combatant.actor);
      }
    }
  });
}
