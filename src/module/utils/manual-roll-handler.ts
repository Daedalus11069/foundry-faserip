import { VueDialog } from "../applications/vue-dialog";
import ManualRollEntryModal from "../applications/ManualRollEntryModal.vue";
import { FaseripRoll } from "../rolling/index.ts";

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

  let roll: Roll;

  if (isManualRollEnabled()) {
    const manualResult = await showManualRollDialog({
      formula,
      rollTitle,
      diceType,
      rollData: rollData || {}
    });

    if (!manualResult) return null; // User cancelled

    roll = await createRollFromManualEntry(formula, manualResult, rollData);
  } else {
    // Normal automatic roll
    // @ts-expect-error - Roll class has a static create method that returns a Promise
    roll = Roll.create(formula, rollData);
    await roll.evaluate();

    // loop through the rolls and see if any are 5 or below. If so, roll a configured roll table and add the result to the chat message as a flavor text
    for (const term of roll.terms) {
      if ((term as any).class === "Die") {
        const dieTerm = term as any;
        for (const result of dieTerm.results) {
          if (result.result <= 5) {
            const tableName = game.settings.get(
              "faserip",
              "criticalBotchTable"
            );
            // @ts-expect-error - game.tables?.getName is a valid method to get a RollTable by name
            const table = game.tables?.getName(tableName);
            if (table) {
              const rollResult = await table.roll();
              // Display the critical failure result in the chat message flavor text
              await ChatMessage.create({
                content: rollResult.results[0].text,
                flavor: `${rollTitle} - Critical Botch`
              });
            }
          }
        }
      }
    }
  }

  // loop through the rolls and see if any are 5 or below. If so, roll a configured roll table and add the result to the chat message as a flavor text
  if (
    FaseripRoll.getResultText(roll) === "Botch" ||
    FaseripRoll.getResultText(roll) === "Ultimate Botch!"
  ) {
    const tableName = game.settings.get("faserip", "criticalBotchTable");
    // @ts-expect-error - game.tables exists at runtime
    const table = game.tables?.getName(tableName);
    if (table) {
      const rollResult = await table.roll();
      if (rollResult) {
        // Create the chat message with the critical botch effect as flavor text
        await ChatMessage.create({
          content: `<strong>Critical Botch Effect</strong><br>${rollResult.results.map((r: any) => r.description).join("<br>")}`,
          flavor: `Critical Botch Effect: ${FaseripRoll.getResultText(roll)}`
        });
      }
    }
  } else if (
    FaseripRoll.getResultText(roll) === "Critical" ||
    FaseripRoll.getResultText(roll) === "Ultimate Critical!"
  ) {
    const tableName = game.settings.get("faserip", "criticalSuccessTable");
    // @ts-expect-error - game.tables exists at runtime
    const table = game.tables?.getName(tableName);
    if (table) {
      const rollResult = await table.roll();
      if (rollResult) {
        // Create the chat message with the critical success effect as flavor text
        await ChatMessage.create({
          content: `<strong>Critical Success Effect</strong><br>${rollResult.results.map((r: any) => r.description).join("<br>")}`,
          flavor: `Critical Success Effect: ${FaseripRoll.getResultText(roll)}`
        });
      }
    }
  }

  return roll;
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
    evaluated: true,
    results: [] // Will be populated with user's results
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
  // @ts-expect-error - Roll.fromData is a valid method to create a Roll from JSON data
  const finalRoll = Roll.fromData(finalJson);
  // @ts-expect-error - Roll class has an evaluate method that returns a Promise
  return finalRoll;
}
