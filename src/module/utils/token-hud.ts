/**
 * Token HUD Utilities
 *
 * Adds intuition check button to the token HUD for FASERIP actions.
 */

import type { FaseripActor } from "../documents";
import { FaseripRoll } from "../rolling/FaseripRoll";
import { Rank } from "../enums";
import { stringToRank } from "../utils";

/**
 * Roll an intuition check for the given actor
 */
export async function rollIntuitionCheck(actor: FaseripActor): Promise<void> {
  const system = actor.system as any;

  // Get the current form
  const currentFormId = system.currentFormId;
  const currentForm = system.forms?.find((f: any) => f.id === currentFormId);

  if (!currentForm) {
    ui.notifications?.warn("No active form found for intuition check");
    return;
  }

  // Get intuition attribute
  const intuition = currentForm.attributes?.intuition;
  if (!intuition) {
    ui.notifications?.warn("Intuition attribute not found");
    return;
  }

  const rank: Rank = stringToRank(intuition.rank);
  const value = intuition.value || 0;

  // Find the token for overlay
  const tokenObj = (canvas as any)?.tokens?.placeables?.find(
    (t: any) => t.actor?.id === actor.id
  ) as any;
  const tokenId: string | undefined = tokenObj?.id;

  // Prepare flags for the chat message
  const flags = tokenId
    ? {
        faserip: {
          intuitionCheck: true,
          tokenId: tokenId
        }
      }
    : undefined;

  // Roll the intuition check using the rollAttribute method
  await FaseripRoll.rollAttribute(
    "Intuition",
    rank,
    value,
    0, // No chart shift for token HUD rolls
    actor,
    [], // No talents for quick intuition checks
    flags,
    undefined, // No pre-specified karma shifts
    undefined // No pre-specified result shift
  );
}
