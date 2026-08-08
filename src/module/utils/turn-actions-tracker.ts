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
 */
export function getActionsThisTurn(actorSystem: any): number {
  return actorSystem.actionsThisTurn ?? 0;
}

/**
 * Record that this actor completed `count` more attacks this turn.
 * Mutates the reactive system directly; FsrBaseSheet watchIgnorable persists it.
 */
export function addActionsThisTurn(actorSystem: any, count: number): void {
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

    // Temporary stat/damage modifiers now live as combat-linked ActiveEffects
    // and expire automatically via Foundry's native duration.rounds tracking —
    // no manual decrement needed here.

    // Clear exhaustion stuns from all combatants — they last one round only
    for (const combatant of combat.combatants ?? []) {
      const actor = combatant.actor;
      if (!actor) continue;
      const hasExhaustionStun = actor.getFlag("faserip", "exhaustionStun");
      if (hasExhaustionStun) {
        await actor.toggleStatusEffect("stun", { active: false });
        await actor.unsetFlag("faserip", "exhaustionStun");
      }
    }
  });

  Hooks.on("deleteCombat", async (combat: any) => {
    for (const combatant of combat.combatants) {
      if (combatant.actor) {
        await resetActionsThisTurn(combatant.actor);
      }
    }
  });
}
