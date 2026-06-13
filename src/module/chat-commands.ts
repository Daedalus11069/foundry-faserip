import {
  Rank,
  RANK_VALUES,
  applyChartShift,
  formatRankDisplay,
  // @ts-expect-error - Attribute imported for potential future use
  Attribute
} from "./enums";
import { stringToRank } from "./utils";
import { FaseripRoll } from "./rolling/FaseripRoll";
import type { FaseripActor } from "./documents";

/**
 * Parse a rank expression like "good", "good+2", "remarkable-1", "ex+2k", "gd@20", "ex[reason]"
 * Returns { rank: Rank, chartShift: number, karmaShifts: number, resultShift: number, reason: string | null }
 * Karma shift syntax: "+Nk" means spend karma for N column shifts (pre-roll)
 * Result shift syntax: "@N" means spend up to N karma to shift die result (post-roll)
 * Reason syntax: "[reason text]" provides a label for the roll
 */
export function parseRankExpression(expr: string): {
  rank: Rank;
  chartShift: number;
  karmaShifts: number;
  resultShift: number;
  reason: string | null;
} | null {
  expr = expr.trim();

  // Check for reason in brackets: ex[attacking], gd+2[defending]
  let reason: string | null = null;
  const reasonMatch = expr.match(/\[([^\]]+)\]/);
  if (reasonMatch) {
    reason = reasonMatch[1].trim();
    // Remove the reason from the expression
    expr = expr.replace(/\[([^\]]+)\]/, "").trim();
  }

  expr = expr.toLowerCase();

  // Check for result shift modifiers: ex@20
  const resultMatch = expr.match(/^([a-z_0-9]+)@(\d+)$/);
  if (resultMatch) {
    const [, rankStr, shiftStr] = resultMatch;
    const rank = stringToRank(rankStr);
    if (!rank) return null;

    const resultShift = parseInt(shiftStr, 10);

    return { rank, chartShift: 0, karmaShifts: 0, resultShift, reason };
  }

  // Check for karma-powered chart shift modifiers: ex+2k
  const karmaMatch = expr.match(/^([a-z_0-9]+)([\+\-])(\d+)k$/);
  if (karmaMatch) {
    const [, rankStr, operator, shiftStr] = karmaMatch;
    const rank = stringToRank(rankStr);
    if (!rank) return null;

    const shift = parseInt(shiftStr, 10);
    const karmaShifts = operator === "+" ? shift : -shift;

    return { rank, chartShift: 0, karmaShifts, resultShift: 0, reason };
  }

  // Check for regular chart shift modifiers: ex+2
  const csMatch = expr.match(/^([a-z_0-9]+)([\+\-])(\d+)$/);
  if (csMatch) {
    const [, rankStr, operator, shiftStr] = csMatch;
    const rank = stringToRank(rankStr);
    if (!rank) return null;

    const shift = parseInt(shiftStr, 10);
    const chartShift = operator === "+" ? shift : -shift;

    return { rank, chartShift, karmaShifts: 0, resultShift: 0, reason };
  }

  // No modifiers, just a rank name
  const rank = stringToRank(expr);
  if (!rank) return null;

  return { rank, chartShift: 0, karmaShifts: 0, resultShift: 0, reason };
}

/**
 * Handle /r chat command for rolling FASERIP ranks
 */
export async function handleRollCommand(message: string): Promise<boolean> {
  const trimmed = message.trim();

  // Check if message starts with /r or /roll
  if (!trimmed.startsWith("/r ") && !trimmed.startsWith("/roll ")) {
    return false;
  }

  // Extract the rank expressions after /r or /roll (only from first line for multi-line messages)
  const firstLine = message.split(/\r?\n/)[0];
  let slice = 3;
  if (trimmed.startsWith("/roll ")) {
    slice = 6;
  }
  const afterCommand = firstLine.slice(slice).trim();

  // Check for global reason after #
  let globalReason: string | null = null;
  let expressionsText = afterCommand;
  const hashIndex = afterCommand.indexOf("#");
  if (hashIndex !== -1) {
    expressionsText = afterCommand.slice(0, hashIndex).trim();
    globalReason = afterCommand.slice(hashIndex + 1).trim();
  }

  // Split expressions, respecting brackets (don't split inside [])
  const expressions: string[] = [];
  let currentExpr = "";
  let inBrackets = false;

  for (let i = 0; i < expressionsText.length; i++) {
    const char = expressionsText[i];

    if (char === "[") {
      inBrackets = true;
      currentExpr += char;
    } else if (char === "]") {
      inBrackets = false;
      currentExpr += char;
    } else if (char === " " && !inBrackets) {
      // Space outside brackets - end of expression
      if (currentExpr.trim()) {
        expressions.push(currentExpr.trim());
        currentExpr = "";
      }
    } else {
      currentExpr += char;
    }
  }

  // Push final expression
  if (currentExpr.trim()) {
    expressions.push(currentExpr.trim());
  }

  if (expressions.length === 0 || expressions[0] === "") {
    ui.notifications?.warn("Usage: /r <rank> [rank2] [rank3] ...");
    ui.notifications?.info(
      "Examples: /r typical, /r gd+2, /r ex[reason], /r in # global reason"
    );
    return true;
  }

  // Check if any expression is a valid Foundry dice formula
  // If so, don't intercept - let Foundry handle it
  for (const expr of expressions) {
    try {
      // Try to validate the expression as a dice formula
      if (Roll.validate(expr)) {
        return false;
      }
    } catch (e) {
      // Not a valid dice formula, continue checking
      // Suppress the error to prevent console spam
    }
  }

  // Parse all expressions
  const parsed = expressions
    .map(expr => parseRankExpression(expr))
    .filter(
      (
        p
      ): p is {
        rank: Rank;
        chartShift: number;
        karmaShifts: number;
        resultShift: number;
        reason: string | null;
      } => p !== null
    );

  if (parsed.length === 0) {
    // Not a valid rank expression and not a dice formula
    // Return true to prevent Foundry from trying to parse as dice
    ui.notifications?.error(
      "Invalid rank expression. Use rank names like 'typical', 'gd', 'ex+2', etc."
    );
    return true;
  }

  // Collect all rolls
  const rolls: FaseripRoll[] = [];
  // @ts-expect-error - game.user exists at runtime
  const actor = game.user?.character as Actor | undefined;

  for (let i = 0; i < parsed.length; i++) {
    const { rank, chartShift, karmaShifts, resultShift, reason } = parsed[i];
    const shiftedRank = applyChartShift(rank, chartShift);
    const value = RANK_VALUES[shiftedRank];

    // Create a label for the roll
    let label = formatRankDisplay(rank);
    if (chartShift !== 0) {
      const csText = chartShift > 0 ? `+${chartShift} CS` : `${chartShift} CS`;
      label = `${formatRankDisplay(rank)} (${csText})`;
    }
    if (karmaShifts !== 0) {
      const kText = karmaShifts > 0 ? `+${karmaShifts}K` : `${karmaShifts}K`;
      label = `${formatRankDisplay(rank)} (${kText})`;
    }
    if (resultShift !== 0) {
      label = `${formatRankDisplay(rank)} (@${resultShift})`;
    }

    // Add index if multiple rolls
    if (parsed.length > 1) {
      label = `Roll ${i + 1}: ${label}`;
    }

    // Add specific reason if provided
    if (reason) {
      label = `${label} - ${reason}`;
    }

    // Roll with skipMessage to combine later, passing individual reason as flavor
    const roll = await FaseripRoll.rollAttribute(
      label,
      rank,
      value,
      chartShift,
      // @ts-expect-error - actor may be undefined, but rollAttribute accepts undefined
      actor,
      undefined,
      undefined,
      karmaShifts,
      resultShift,
      true, // skipMessage
      0, // manualChartShift
      reason || undefined // flavor (undefined if no individual reason)
    );

    rolls.push(roll);
  }

  // Create combined message for all rolls
  if (rolls.length > 0) {
    await FaseripRoll.createCombinedRollMessage(
      rolls,
      // @ts-expect-error - actor may be undefined, but createCombinedRollMessage accepts undefined
      actor,
      undefined,
      globalReason ?? ""
    );
  }

  // loop through the rolls and see if any are 5 or below. If so, roll a configured roll table and add the result to the chat message as a flavor text
  for (const roll of rolls) {
    // loop through the roll's dice and check if any d100 die is 5 or below (botch)
    if (
      roll.getResultText() === "Botch" ||
      roll.getResultText() === "Ultimate Botch!"
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
            // @ts-expect-error - actor may be undefined, but getSpeaker accepts undefined
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Critical Botch Effect: ${roll.modifiedTotal} or below`
          });
        }
      }
    } else if (
      roll.getResultText() === "Critical" ||
      roll.getResultText() === "Ultimate Critical!"
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
            // @ts-expect-error - actor may be undefined, but getSpeaker accepts undefined
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Critical Success Effect: ${roll.getResultText()}`
          });
        }
      }
    }
  }

  return true;
}

/**
 * Stat abbreviation mapping
 */
const STAT_ABBREV: Record<string, string> = {
  f: "fighting",
  a: "agility",
  s: "strength",
  e: "endurance",
  r: "reasoning",
  i: "intuition",
  p: "psyche"
};

/**
 * Stat key to display name mapping
 */
const STAT_LABELS: Record<string, string> = {
  fighting: "Fighting",
  agility: "Agility",
  strength: "Strength",
  endurance: "Endurance",
  reasoning: "Reasoning",
  intuition: "Intuition",
  psyche: "Psyche"
};

/**
 * Find actor by callname (case-insensitive) with ownership check
 * Only returns actors owned by the current user, or any actor if user is GM
 */
function findActorByCallname(callname: string): FaseripActor | null {
  const searchName = callname.toLowerCase();
  // @ts-expect-error - game.user exists at runtime
  const currentUser = game.user;

  // If no user, fail
  if (!currentUser) return null;

  for (const actor of (game.actors ?? []) as Iterable<Actor<"pc" | "npc">>) {
    const charmanName = actor.system?.charman?.characterName?.toLowerCase();
    const standaloneName = (actor.system as any)?.callname?.toLowerCase();
    const nameMatch =
      charmanName === searchName ||
      standaloneName === searchName ||
      actor.name?.toLowerCase() === searchName;

    if (!nameMatch) continue;

    // Check permissions: must be owner OR be a GM
    const isGM = currentUser.isGM;
    const isOwner = actor.testUserPermission(currentUser, "OWNER");

    if (isGM || isOwner) {
      return actor as unknown as FaseripActor;
    }
  }

  return null;
}

/**
 * Parse a stat expression for character rolls
 * Examples: "fighting+2", "f+2", "agility+gun", "s-1", "f+2k", "f@20", "circular-vision"
 */
function parseStatExpression(
  expr: string,
  actor: FaseripActor,
  form: any
): {
  type: "stat" | "power";
  name: string;
  chartShift: number;
  karmaShifts: number;
  resultShift: number;
  talentNames: string[];
} | null {
  expr = expr.trim().toLowerCase();

  // Check if it's a power (no +/- modifier, not a stat name)
  const expandedExpr = STAT_ABBREV[expr] || expr;
  const attributes = form?.attributes || {};

  // If it's a stat name without modifiers, treat as stat
  if (attributes[expandedExpr]) {
    return {
      type: "stat",
      name: expandedExpr,
      chartShift: 0,
      karmaShifts: 0,
      resultShift: 0,
      talentNames: []
    };
  }

  // Try to match stat with result shift: "fighting@20", "f@20"
  const resultMatch = expr.match(/^([a-z]+)@(\d+)$/);
  if (resultMatch) {
    const [, statName, shiftStr] = resultMatch;
    const expandedStat = STAT_ABBREV[statName] || statName;

    if (attributes[expandedStat]) {
      const resultShift = parseInt(shiftStr, 10);

      return {
        type: "stat",
        name: expandedStat,
        chartShift: 0,
        karmaShifts: 0,
        resultShift,
        talentNames: []
      };
    }
  }

  // Try to match stat with karma CS modifier: "fighting+2k", "f+2k"
  const karmaMatch = expr.match(/^([a-z]+)([\+\-])(\d+)k$/);
  if (karmaMatch) {
    const [, statName, operator, shiftStr] = karmaMatch;
    const expandedStat = STAT_ABBREV[statName] || statName;

    if (attributes[expandedStat]) {
      const shift = parseInt(shiftStr, 10);
      const karmaShifts = operator === "+" ? shift : -shift;

      return {
        type: "stat",
        name: expandedStat,
        chartShift: 0,
        karmaShifts,
        resultShift: 0,
        talentNames: []
      };
    }
  }

  // Try to match stat with regular CS modifier: "fighting+2", "f+2"
  const numericMatch = expr.match(/^([a-z]+)([\+\-])(\d+)$/);
  if (numericMatch) {
    const [, statName, operator, shiftStr] = numericMatch;
    const expandedStat = STAT_ABBREV[statName] || statName;

    if (attributes[expandedStat]) {
      const shift = parseInt(shiftStr, 10);
      const chartShift = operator === "+" ? shift : -shift;

      return {
        type: "stat",
        name: expandedStat,
        chartShift,
        karmaShifts: 0,
        resultShift: 0,
        talentNames: []
      };
    }
  }

  // Try to match stat with talent: "agility+gun", "f+martial-arts"
  const talentMatch = expr.match(/^([a-z]+)\+([a-z\-]+)$/);
  if (talentMatch) {
    const [, statName, talentName] = talentMatch;
    const expandedStat = STAT_ABBREV[statName] || statName;

    if (attributes[expandedStat]) {
      // Find the talent — must apply to the active form
      // @ts-expect-error - talents exists on PC/NPC data model
      const talents = actor.system.talents || [];
      const activeFormId = form?.id;
      const talent = talents.find(
        (t: any) =>
          (t.name.toLowerCase().replace(/\s+/g, "-") === talentName ||
            t.name.toLowerCase().replace(/\s+/g, "") ===
              talentName.replace(/-/g, "")) &&
          (!t.formIds?.length || t.formIds.includes(activeFormId))
      );

      if (talent) {
        return {
          type: "stat",
          name: expandedStat,
          chartShift: talent.bonus || 0,
          karmaShifts: 0,
          resultShift: 0,
          talentNames: [talent.name]
        };
      }
    }
  }

  // Otherwise, treat as power name — must apply to the active form
  // @ts-expect-error - powers exists on PC/NPC data model
  const powers = actor.system.powers || [];
  const activeFormId = form?.id;
  const power = powers.find(
    (p: any) =>
      (p.name.toLowerCase().replace(/\s+/g, "-") === expr ||
        p.name.toLowerCase().replace(/\s+/g, "") === expr.replace(/-/g, "")) &&
      (!p.formIds?.length || p.formIds.includes(activeFormId))
  );

  if (power) {
    return {
      type: "power",
      name: power.name,
      chartShift: 0,
      karmaShifts: 0,
      resultShift: 0,
      talentNames: []
    };
  }

  return null;
}

/**
 * Handle /cr or /croll chat command for rolling character stats
 */
export async function handleCharacterRollCommand(
  message: string
): Promise<boolean> {
  // Check if message starts with /cr or /croll (only check first line for multi-line)
  const firstLine = message.split(/\r?\n/)[0];
  const crMatch = firstLine.trim().match(/^\/cr(?:oll)?\s+(.+)$/);
  if (!crMatch) {
    return false;
  }

  const args = crMatch[1].trim().split(/\s+/);

  if (args.length < 2) {
    ui.notifications?.warn(
      "Usage: /cr <callname>[/formname] <stat> [stat2] [stat3] ..."
    );
    ui.notifications?.info(
      "Examples: /cr Art fighting+2, /cr Art/MegaDamage f+2 agility+gun s-1"
    );
    return true;
  }

  const [callnameArg, ...expressions] = args;

  // Parse callname and optional form name
  const [callname, formName] = callnameArg.split("/").map(s => s.trim());

  // Find the actor
  const actor = findActorByCallname(callname);
  if (!actor) {
    ui.notifications?.error(
      `Character not found or you do not have permission: ${callname}`
    );
    return true;
  }

  // Find the form
  let targetForm;
  if (formName) {
    // Find form by name (case-insensitive)
    // @ts-expect-error - forms exists on PC/NPC data model
    const forms = actor.system.forms || [];
    targetForm = forms.find(
      (f: any) => f.name?.toLowerCase() === formName.toLowerCase()
    );

    if (!targetForm) {
      ui.notifications?.error(`Form not found: ${formName}`);
      return true;
    }
  } else {
    // Use current form
    // @ts-expect-error - forms exists on PC/NPC data model
    targetForm = (actor as any).getCurrentForm?.() || actor.system.forms?.[0];
  }

  if (!targetForm) {
    ui.notifications?.error(`Character ${callname} has no active form`);
    return true;
  }

  // Parse and roll each expression
  for (const expr of expressions) {
    const parsed = parseStatExpression(expr, actor, targetForm);

    if (!parsed) {
      ui.notifications?.warn(`Invalid expression: ${expr}`);
      continue;
    }

    if (parsed.type === "stat") {
      const attr = targetForm.attributes[parsed.name];
      if (!attr) {
        ui.notifications?.warn(`Stat not found: ${parsed.name}`);
        continue;
      }

      const rank = stringToRank(attr.rank);
      const statLabel = STAT_LABELS[parsed.name] || parsed.name;

      await FaseripRoll.rollAttribute(
        `${actor.name} - ${statLabel}`,
        rank,
        attr.value,
        parsed.chartShift,
        // @ts-expect-error - actor exists at runtime
        actor as Actor,
        parsed.talentNames.length > 0 ? parsed.talentNames : undefined,
        undefined,
        parsed.karmaShifts,
        parsed.resultShift
      );
    } else {
      // Roll power
      // @ts-expect-error - powers exists on PC/NPC data model
      const powers = actor.system.powers || [];
      const power = powers.find((p: any) => p.name === parsed.name);

      if (power) {
        const rank = stringToRank(power.rank);
        const value = power.value || RANK_VALUES[rank];

        await FaseripRoll.rollAttribute(
          `${actor.name} - ${power.name}`,
          rank,
          value,
          parsed.karmaShifts, // Use karma shifts as chart shift for powers
          // @ts-expect-error - actor exists at runtime
          actor as Actor,
          undefined,
          undefined,
          parsed.karmaShifts,
          parsed.resultShift
        );
      }
    }
  }

  return true;
}
