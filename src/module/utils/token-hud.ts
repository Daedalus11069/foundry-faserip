/**
 * Token HUD Utilities
 *
 * Adds intuition check button to the token HUD for FASERIP actions.
 */

import type { FaseripActor } from "../documents";
import { FaseripRoll } from "../rolling/FaseripRoll";
import { Rank } from "../enums";
import { getEffectiveAttributeData } from "./stat-debuffs";

/**
 * Roll an intuition check for the given actor
 */
export async function rollIntuitionCheck(actor: FaseripActor): Promise<void> {
  const intuition = getEffectiveAttributeData(actor, "intuition");
  if (!intuition) {
    ui.notifications?.warn("Intuition attribute not found");
    return;
  }

  const rank: Rank = intuition.rank;
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
