import { VueDialog } from "./vue-dialog";
import TalentSelectionDialog from "./dialogs/TalentSelectionDialog.vue";
import KarmaSpendDialog from "./dialogs/KarmaSpendDialog.vue";
import ComboDialog from "./dialogs/ComboDialog.vue";
import AttackOptionsDialog from "./dialogs/AttackOptionsDialog.vue";
import DefenseOptionsDialog from "./dialogs/DefenseOptionsDialog.vue";
import MovementSettingsDialog from "./dialogs/MovementSettingsDialog.vue";
import { Rank } from "../enums";
import type { Talent, SelectedTalent } from "../types";

interface KarmaSpendResult {
  karmaSpent: number;
  columnShifts?: number;
  dieModifier?: number;
  manualChartShift?: number;
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
  availableKarma: number,
  talentNames?: string[],
  talentCS?: number
): Promise<{
  comboCount: number;
  attackKarmaSettings: Array<{ columnShifts: number; resultShift: number }>;
  manualChartShift?: number;
} | null> {
  const result = await VueDialog.show(
    ComboDialog,
    {
      attributeName,
      attributeRank,
      availableKarma,
      talentNames: talentNames || [],
      talentCS: talentCS || 0
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
    manualChartShift?: number;
  } | null;
}

/**
 * Show attack options dialog (karma spending + modifiers + combo attacks)
 */
export async function showAttackOptionsDialog(
  attackerName: string,
  attackAttribute: string,
  attackRank: Rank,
  availableKarma: number,
  powerName?: string,
  talentCS?: number
): Promise<{
  comboCount: number;
  attackKarmaSettings: Array<{ columnShifts: number; resultShift: number }>;
  manualChartShift: number;
} | null> {
  const result = await VueDialog.show(
    AttackOptionsDialog,
    {
      attackerName,
      attackAttribute,
      attackRank,
      availableKarma,
      powerName,
      talentCS
    },
    {
      window: {
        title: "Attack Options",
        icon: "fas fa-crosshairs",
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
    manualChartShift: number;
  } | null;
}

/**
 * Show defense options dialog (karma spending + modifiers)
 */
export async function showDefenseOptionsDialog(
  defenderName: string,
  defenseAttribute: string,
  defenseRank: Rank,
  availableKarma: number,
  attackerName: string,
  attackRankDisplay?: string,
  attackRoll?: number,
  attackResult?: string,
  powerName?: string,
  talentCS?: number
): Promise<{
  karmaColumnShifts: number;
  karmaResultShift: number;
  manualChartShift: number;
} | null> {
  const result = await VueDialog.show(
    DefenseOptionsDialog,
    {
      defenderName,
      defenseAttribute,
      defenseRank,
      availableKarma,
      attackerName,
      attackRankDisplay,
      attackRoll,
      attackResult,
      powerName,
      talentCS
    },
    {
      window: {
        title: "Defense Options",
        icon: "fas fa-shield",
        minimizable: false,
        resizable: false
      },
      position: {
        width: 550
      }
    }
  );

  return result as {
    karmaColumnShifts: number;
    karmaResultShift: number;
    manualChartShift: number;
  } | null;
}

/**
 * Show movement by rank settings dialog
 */
export async function showMovementSettingsDialog(
  currentValues: Record<string, number>
): Promise<Record<string, number> | null> {
  const result = await VueDialog.show(
    MovementSettingsDialog,
    {
      currentValues
    },
    {
      window: {
        title: "Movement By Rank Settings",
        icon: "fas fa-person-running",
        minimizable: false,
        resizable: false
      },
      position: {
        width: 700
      }
    }
  );

  return result as Record<string, number> | null;
}
