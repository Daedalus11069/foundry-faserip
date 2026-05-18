import { VueDialog } from "./vue-dialog";
import TalentSelectionDialog from "./dialogs/TalentSelectionDialog.vue";
import KarmaSpendDialog from "./dialogs/KarmaSpendDialog.vue";
import ComboDialog from "./dialogs/ComboDialog.vue";
import { Rank } from "../enums";
import type { Talent, SelectedTalent } from "../types";

interface KarmaSpendResult {
  karmaSpent: number;
  columnShifts?: number;
  dieModifier?: number;
}

/**
 * Show talent selection dialog and return selected talents
 */
export async function showTalentSelectionDialog(
  talents: Talent[],
  attributeName: string
): Promise<SelectedTalent[] | null> {
  const result = await VueDialog.show(
    TalentSelectionDialog,
    {
      talents,
      attributeName
    },
    {
      window: {
        title: "Apply Talents",
        icon: "fas fa-star",
        minimizable: false,
        resizable: false
      },
      position: {
        width: 500
      }
    }
  );

  return result as SelectedTalent[] | null;
}

/**
 * Show karma spending dialog
 */
export async function showKarmaSpendDialog(
  availableKarma: number,
  phase: "pre-roll" | "post-roll",
  currentRoll?: number,
  currentRank?: string
): Promise<KarmaSpendResult | null> {
  if (availableKarma <= 0) {
    return null;
  }

  const result = await VueDialog.show(
    KarmaSpendDialog,
    {
      availableKarma,
      phase,
      currentRoll,
      currentRank
    },
    {
      window: {
        title:
          phase === "pre-roll"
            ? "Spend Karma (Pre-Roll)"
            : "Spend Karma (Post-Roll)",
        icon: "fas fa-sparkles",
        minimizable: false,
        resizable: false
      },
      position: {
        width: 450
      }
    }
  );

  return result as KarmaSpendResult | null;
}

/**
 * Show combo attack dialog
 */
export async function showComboDialog(
  attributeName: string,
  attributeRank: Rank,
  availableKarma: number
): Promise<{
  comboCount: number;
  attackKarmaSettings: Array<{ columnShifts: number; resultShift: number }>;
} | null> {
  const result = await VueDialog.show(
    ComboDialog,
    {
      attributeName,
      attributeRank,
      availableKarma
    },
    {
      window: {
        title: "Combo Attack",
        icon: "fas fa-hand-fist",
        minimizable: false,
        resizable: false
      },
      position: {
        width: 700
      }
    }
  );

  return result as {
    comboCount: number;
    attackKarmaSettings: Array<{ columnShifts: number; resultShift: number }>;
  } | null;
}
