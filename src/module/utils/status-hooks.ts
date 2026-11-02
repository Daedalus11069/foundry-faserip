/**
 * Foundry hooks that enforce status condition rules on tokens (see
 * status-mechanics.ts for the rules themselves):
 *
 * - preMoveToken refuses movement for actors that can't move (asleep,
 *   restrained, ...). GMs are exempt so they can still reposition tokens.
 * - Statuses tied to a movement mode (prone → crawl, fly/hover → fly) switch
 *   the actor's tokens to it when applied and back to walk when removed.
 */
import {
  getMovementBlockReason,
  getStatusEffects,
  STATUS_MOVEMENT_ACTIONS
} from "./status-mechanics";

const DEFAULT_MOVEMENT_ACTION = "walk";

function isActiveGM(): boolean {
  // @ts-expect-error - Foundry game.user global
  return !!game.user?.isGM && !!game.users?.activeGM?.isSelf;
}

async function setTokensMovementAction(
  actor: any,
  action: string,
  onlyIfCurrently?: string
): Promise<void> {
  const tokens: any[] = actor.getActiveTokens?.(false, true) ?? [];
  for (const tokenDoc of tokens) {
    if (onlyIfCurrently && tokenDoc.movementAction !== onlyIfCurrently) continue;
    if (tokenDoc.movementAction === action) continue;
    await tokenDoc.update({ movementAction: action });
  }
}

export function registerStatusHooks(): void {
  // @ts-expect-error - preMoveToken (Foundry v13+) isn't in the bundled hook typings
  Hooks.on("preMoveToken", (tokenDoc: any) => {
    // @ts-expect-error - Foundry game.user global
    if (game.user?.isGM) return true;

    const reason = getMovementBlockReason(tokenDoc.actor);
    if (!reason) return true;

    ui.notifications?.warn(`${tokenDoc.name} is ${reason} and cannot move.`);
    return false;
  });

  Hooks.on("createActiveEffect", async (effect: any) => {
    const actor = effect.parent;
    if (!isActiveGM() || !actor?.getActiveTokens) return;

    for (const [statusId, action] of Object.entries(STATUS_MOVEMENT_ACTIONS)) {
      if (!effect.statuses?.has(statusId)) continue;
      await setTokensMovementAction(actor, action);
    }
  });

  Hooks.on("deleteActiveEffect", async (effect: any) => {
    const actor = effect.parent;
    if (!isActiveGM() || !actor?.getActiveTokens) return;

    for (const [statusId, action] of Object.entries(STATUS_MOVEMENT_ACTIONS)) {
      if (!effect.statuses?.has(statusId)) continue;

      // Another effect (or another status mapped to the same action) may still hold it
      const stillHeld = Object.entries(STATUS_MOVEMENT_ACTIONS).some(
        ([otherId, otherAction]) =>
          otherAction === action &&
          getStatusEffects(actor, otherId).some(e => e.id !== effect.id)
      );
      if (stillHeld) continue;

      await setTokensMovementAction(actor, DEFAULT_MOVEMENT_ACTION, action);
    }
  });
}
