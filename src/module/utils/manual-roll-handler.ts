import { VueDialog } from "../applications/vue-dialog";
import ManualRollEntryModal from "../applications/ManualRollEntryModal.vue";

/**
 * Interface for manual roll options
 */
export interface ManualRollOptions {
  formula: string;
  rollTitle: string;
  diceType?: "d100" | "d6" | "d10" | string;
  rollData?: Record<string, any>;
}

/**
 * Interface for the result of a manual roll entry
 */
export interface ManualRollResult {
  expression: string; // User's complete roll expression
  naturalRoll?: number; // The natural (unmodified) die value
}

/**
 * Check if manual roll entry is enabled for the current user
 */
export function isManualRollEnabled(): boolean {
  return game.settings.get("faserip", "manualRollEntry") === true;
}

/**
 * Show the manual roll entry dialog
 * @param options - Options for the manual roll
 * @returns Promise that resolves to the manual roll result, or null if cancelled
 */
export async function showManualRollDialog(
  options: ManualRollOptions
): Promise<ManualRollResult | null> {
  try {
    const result = (await VueDialog.show(
      ManualRollEntryModal,
      {
        formula: options.formula,
        rollTitle: options.rollTitle,
        diceType: options.diceType || "d100",
        rollData: options.rollData || {}
      },
      {
        window: {
          title: "Manual Roll Entry",
          icon: "fas fa-dice"
        },
        position: {
          width: 600
        }
      }
    )) as ManualRollResult | null;

    return result || null;
  } catch (error) {
    console.error(
      "[Manual Roll Handler] Error showing manual roll dialog:",
      error
    );
    return null;
  }
}

/**
 * Create a roll with optional manual entry
 *
 * @param formula - The roll formula (e.g., "1d100")
 * @param rollTitle - Title for the manual roll dialog
 * @param diceType - Type of dice being rolled
 * @param rollData - Roll data context
 * @returns An evaluated Roll object, or null if manual entry was cancelled
 */
export async function createRoll(
  formula: string,
  rollTitle: string,
  diceType: "d100" | "d6" | "d10" | string = "d100",
  rollData?: Record<string, any>
): Promise<Roll | null> {
  if (!formula || formula.trim() === "") {
    console.error("[createRoll] Empty formula provided:", { rollTitle });
    ui.notifications?.error(
      `Cannot create roll: empty formula for ${rollTitle}`
    );
    return null;
  }

  if (isManualRollEnabled()) {
    const manualResult = await showManualRollDialog({
      formula,
      rollTitle,
      diceType,
      rollData: rollData || {}
    });

    if (!manualResult) return null; // User cancelled

    return await createRollFromManualEntry(formula, manualResult, rollData);
  } else {
    // Normal automatic roll
    const roll = await Roll.create(formula, rollData);
    await roll.evaluate();
    return roll;
  }
}

/**
 * Create a Roll object from a manual entry expression
 *
 * @param originalFormula - The original roll formula
 * @param manualResult - The manual roll result with user's expression
 * @param rollData - Roll data context
 * @returns An evaluated Roll object with manual results
 */
export async function createRollFromManualEntry(
  originalFormula: string,
  manualResult: ManualRollResult,
  rollData?: Record<string, any>
): Promise<Roll> {
  if (!manualResult.expression || manualResult.expression.trim() === "") {
    console.error("[createRollFromManualEntry] Empty manual expression");
    ui.notifications?.error("Roll expression cannot be empty");
    throw new Error("Empty roll expression");
  }

  // Create template roll from original formula
  const templateRoll = await Roll.create(originalFormula, rollData);
  await templateRoll.evaluate();
  const templateJson = templateRoll.toJSON();

  // Parse user's expression
  let userRoll;
  try {
    userRoll = await Roll.create(manualResult.expression, rollData);
    await userRoll.evaluate();
  } catch (error) {
    console.error(
      "[createRollFromManualEntry] Failed to parse user expression:",
      error
    );
    ui.notifications?.error(
      `Invalid roll expression: ${manualResult.expression}`
    );
    throw new Error(`Failed to parse roll expression: ${error}`);
  }
  const rollJson = userRoll.toJSON();

  // Use template structure with user's results
  const finalJson = {
    ...templateJson,
    formula: templateJson.formula,
    evaluated: true
  };

  // Map user's results to template's dice terms
  if (finalJson.terms && rollJson.terms) {
    // Extract numeric values from user's expression
    const userNumbers: number[] = [];
    for (const term of rollJson.terms) {
      if ((term as any).class === "NumericTerm") {
        userNumbers.push((term as any).number);
      }
    }

    const newTerms: any[] = [];
    let numberIndex = 0;

    // Get dice terms from template and populate with user's numbers
    const templateDiceTerms = finalJson.terms.filter(
      (t: any) => t.class === "Die"
    );

    for (const templateDieTerm of templateDiceTerms) {
      const updatedDie = { ...(templateDieTerm as any) };

      // Replace die results with user's numbers
      for (let j = 0; j < updatedDie.results.length; j++) {
        if (numberIndex < userNumbers.length) {
          updatedDie.results[j].result = userNumbers[numberIndex];
          updatedDie.results[j].active = true;
          numberIndex++;
        }
      }

      // Recalculate term total
      updatedDie.total = updatedDie.results.reduce(
        (sum: number, r: any) => sum + r.result,
        0
      );

      updatedDie._evaluated = true;
      newTerms.push(updatedDie);
    }

    // Add all non-dice terms from template
    for (const term of templateJson.terms) {
      const t = term as any;
      if (t.class !== "Die") {
        newTerms.push(term);
      }
    }

    finalJson.terms = newTerms;

    // Recalculate total
    let calculatedTotal = 0;
    let currentOperator = "+";

    for (const term of newTerms) {
      if (term.class === "Die") {
        if (currentOperator === "+") {
          calculatedTotal += term.total;
        } else if (currentOperator === "-") {
          calculatedTotal -= term.total;
        }
      } else if (term.class === "NumericTerm") {
        if (currentOperator === "+") {
          calculatedTotal += term.number;
        } else if (currentOperator === "-") {
          calculatedTotal -= term.number;
        }
      } else if (term.class === "OperatorTerm") {
        currentOperator = term.operator;
      }
    }

    finalJson.total = calculatedTotal;
  }

  // Create Roll from JSON
  const finalRoll = Roll.fromData(finalJson);
  return finalRoll;
}
