/**
 * Token HUD Utilities
 *
 * Adds intuition check button to the token HUD for FASERIP actions.
 */

import type { FaseripActor } from "../documents";
import { FaseripRoll } from "../rolling/FaseripRoll";
import { Rank } from "../enums";
import { getEffectiveAttributeData } from "./stat-debuffs";
import { showIntuitionCheckOptionsDialog } from "../applications/dialog-utils";
import { resolveBlendInSpotChecksFromRoll } from "./blend-in";

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

  // Gather chart shift + result shift together in a single dialog, rather
  // than the default separate pre-roll/post-roll karma prompts.
  const actorSystem = (actor as any).system;
  const availableKarma = actorSystem?.resources?.karma?.value || 0;

  let manualChartShift = 0;
  // Default to 0 (not undefined) so rollAttribute never falls back to its
  // own separate pre-roll/post-roll karma prompts - this dialog is the only
  // karma prompt shown for a token HUD intuition check.
  let preSpecifiedKarmaShifts = 0;
  let preSpecifiedResultShift = 0;

  if (availableKarma > 0) {
    const options = await showIntuitionCheckOptionsDialog(
      availableKarma,
      rank
    );

    if (options) {
      manualChartShift = options.manualChartShift || 0;
      preSpecifiedKarmaShifts = options.columnShifts || 0;
      preSpecifiedResultShift = options.resultShift || 0;
    }
  }

  // Roll the intuition check using the rollAttribute method
  const roll = await FaseripRoll.rollAttribute(
    "Intuition",
    rank,
    value,
    0, // No chart shift for token HUD rolls
    actor,
    [], // No talents for quick intuition checks
    flags,
    preSpecifiedKarmaShifts,
    preSpecifiedResultShift,
    false,
    manualChartShift
  );

  // This is the token HUD's dedicated "Intuition" button - i.e. exactly the
  // roll a player uses to try to spot something - so it doubles as a Blend
  // In spot check against every active, unspotted blending token on the
  // scene, using this same roll rather than a separate hidden one.
  if (roll) {
    await resolveBlendInSpotChecksFromRoll(actor, roll.result);
  }
}
