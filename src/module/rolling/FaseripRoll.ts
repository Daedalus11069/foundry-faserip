import {
  RollResult,
  UNIVERSAL_TABLE,
  RANK_VALUES,
  RANK_SHORTS,
  Rank,
  applyChartShift,
  formatRankDisplay
} from "../enums";
import { showKarmaSpendDialog } from "../applications/dialog-utils";
import { getCharmanService } from "../charman-service";
import type { FaseripActor } from "../documents";
import { createRoll } from "../utils/manual-roll-handler";
import {
  consumeTriggeredModifiers,
  consumeForcedResult,
  drawCriticalTableEffect
} from "../utils/temp-effects";

/**
 * FASERIP roll evaluation
 */
export class FaseripRoll {
  roll: Roll;
  targetValue: number;
  rank: Rank;
  baseRank: Rank;
  chartShift: number;
  result: RollResult;
  modifiedTotal?: number; // Karma-modified roll total (for botch detection in combos)
  /**
   * Set when a "forcedResult" temporary effect (see temp-effects.ts) was
   * consumed for this roll. Rather than overriding the displayed
   * tier/color independently of the roll total (which would desync from
   * everything downstream that reads roll.total directly - damage tier
   * lookups, bonus-damage-roll thresholds, botch detection, etc.),
   * rollAttribute clamps modifiedTotal into a real value inside the
   * shifted rank's actual Red or White zone on the Universal Table before
   * constructing this roll, so evaluateResult naturally lands on the
   * forced tier via the normal table lookup. This field is kept only for
   * display (e.g. distinguishing a forced "Failure" from a natural botch
   * in the chat card), not to drive evaluation.
   */
  forcedOutcome?: "critical" | "failure";

  constructor(
    roll: Roll,
    targetValue: number,
    rank: Rank,
    baseRank?: Rank,
    chartShift: number = 0,
    modifiedTotal?: number,
    forcedOutcome?: "critical" | "failure"
  ) {
    this.roll = roll;
    this.targetValue = targetValue;
    this.rank = rank;
    this.baseRank = baseRank || rank;
    this.chartShift = chartShift;
    this.modifiedTotal = modifiedTotal;
    this.forcedOutcome = forcedOutcome;
    this.result = this.evaluateResult();
  }

  /**
   * Evaluate the roll result based on FASERIP Universal Table
   */
  private evaluateResult(): RollResult {
    // Use karma-modified total if available, otherwise use raw roll total
    const rollValue = (this.modifiedTotal ?? this.roll.total) || 0;
    const shortRank = RANK_SHORTS[this.rank];
    const ranges = UNIVERSAL_TABLE[shortRank];

    if (!ranges) {
      return RollResult.White;
    }

    const [greenStart, yellowStart, redStart] = ranges;

    if (rollValue < greenStart) return RollResult.White;
    if (rollValue < yellowStart) return RollResult.Green;
    if (rollValue < redStart) return RollResult.Yellow;
    return RollResult.Red;
  }

  /**
   * Get result CSS class for display
   */
  getResultClass(): string {
    return FaseripRoll.getResultClass(this.roll, this.result);
  }

  static getResultClass(roll: Roll, result: RollResult): string {
    const rollValue = roll.total || 0;

    // Check for ultimate botch (rolling 1)
    if (rollValue === 1) {
      return "fsr-roll-ultimate-botch";
    }

    // Check for regular botch (rolling 2-5)
    if (rollValue >= 2 && rollValue <= 5) {
      return "fsr-roll-botch";
    }

    // Check for perfect 100 roll
    if (rollValue === 100) {
      return "fsr-roll-perfect";
    }

    switch (result) {
      case RollResult.Red:
        return "fsr-roll-red";
      case RollResult.Yellow:
        return "fsr-roll-yellow";
      case RollResult.Green:
        return "fsr-roll-green";
      case RollResult.White:
      default:
        return "fsr-roll-white";
    }
  }

  /**
   * Get result text
   */
  getResultText(): string {
    return FaseripRoll.getResultText(this.roll, this.result);
  }

  static getResultText(roll: Roll, result: RollResult): string {
    const rollValue = roll.total || 0;

    // Check for ultimate botch (rolling 1)
    if (rollValue === 1) {
      return "Ultimate Botch!";
    }

    // Check for regular botch (rolling 2-5)
    if (rollValue >= 2 && rollValue <= 5) {
      return "Botch";
    }

    // Check for perfect 100 roll
    if (rollValue === 100) {
      return "Ultimate Critical!";
    }

    switch (result) {
      case RollResult.Red:
        return "Critical";
      case RollResult.Yellow:
        return "Success";
      case RollResult.Green:
        return "Half Success";
      case RollResult.White:
      default:
        return "Failure";
    }
  }

  /**
   * Create a FASERIP roll for an attribute check
   */
  static async rollAttribute(
    attributeName: string,
    attributeRank: Rank,
    attributeValue: number,
    chartShift: number = 0,
    actor?: FaseripActor,
    talentNames?: string[],
    additionalFlags?: Record<string, any>,
    preSpecifiedKarmaShifts?: number,
    preSpecifiedResultShift?: number,
    skipMessage: boolean = false,
    manualChartShift: number = 0,
    flavor?: string
  ): Promise<FaseripRoll> {
    let totalChartShift = chartShift + manualChartShift;
    let preRollKarma = 0;
    let postRollKarma = 0;
    let karmaColumnShifts = 0;
    let rollTotal = 0;

    // Pre-roll karma: use pre-specified shifts if provided, otherwise prompt
    if (actor) {
      const actorSystem = (actor as any).system;
      const availableKarma = actorSystem?.resources?.karma?.value || 0;

      if (
        preSpecifiedKarmaShifts !== undefined &&
        preSpecifiedKarmaShifts > 0
      ) {
        // Use pre-specified karma shifts (from command syntax like +2k)
        karmaColumnShifts = preSpecifiedKarmaShifts;
        const newRank = applyChartShift(attributeRank, karmaColumnShifts);

        // Calculate karma cost using pico-bot formula
        const currentRankValue = RANK_VALUES[attributeRank];
        const newRankValue = RANK_VALUES[newRank];
        const scoreDiff = Math.abs(newRankValue - currentRankValue);
        preRollKarma = Math.max(10, scoreDiff);

        if (availableKarma >= preRollKarma) {
          totalChartShift += karmaColumnShifts;
        } else {
          ui.notifications?.error(
            `Insufficient karma: need ${preRollKarma}, have ${availableKarma}`
          );
          karmaColumnShifts = 0;
          preRollKarma = 0;
        }
      } else if (
        availableKarma > 0 &&
        preSpecifiedKarmaShifts === undefined &&
        preSpecifiedResultShift === undefined
      ) {
        // Only prompt if no pre-specified shifts and karma is available
        const preRollResult = await showKarmaSpendDialog(
          availableKarma,
          "pre-roll",
          undefined,
          attributeRank
        );

        if (preRollResult) {
          if (preRollResult.karmaSpent > 0) {
            preRollKarma = preRollResult.karmaSpent;
            // Use the column shifts returned from the dialog
            karmaColumnShifts = preRollResult.columnShifts || 0;
            totalChartShift += karmaColumnShifts;
          }
          // Always apply manual chart shift if provided
          if (preRollResult.manualChartShift) {
            totalChartShift += preRollResult.manualChartShift;
          }
        }
      }
    }

    // Roll the dice (with optional manual entry)
    const roll = await createRoll("1d100", `${attributeName} Roll`, "d100");

    if (!roll) {
      // User cancelled manual roll entry
      throw new Error("Roll cancelled");
    }

    rollTotal = roll.total || 0;

    // Dice animation will be handled by:
    // 1. ChatMessage.create (when skipMessage is false)
    // 2. Caller (when skipMessage is true, e.g., combat-flow.ts)

    // Post-roll karma: use pre-specified result shift if provided, otherwise prompt
    if (actor) {
      const actorSystem = (actor as any).system;
      const availableKarma = actorSystem?.resources?.karma?.value || 0;
      const remainingKarma = availableKarma - preRollKarma;

      if (
        preSpecifiedResultShift !== undefined &&
        preSpecifiedResultShift > 0
      ) {
        // Use pre-specified result shift (from command syntax like @20)
        const maxShift = Math.min(preSpecifiedResultShift, 100 - rollTotal);
        const actualShift = maxShift;
        postRollKarma = Math.max(10, actualShift);

        if (remainingKarma >= postRollKarma) {
          rollTotal += actualShift;
        } else {
          ui.notifications?.error(
            `Insufficient karma for result shift: need ${postRollKarma}, have ${remainingKarma}`
          );
          postRollKarma = 0;
        }
      } else if (
        remainingKarma > 0 &&
        preSpecifiedResultShift === undefined &&
        preSpecifiedKarmaShifts === undefined
      ) {
        // Only prompt if no pre-specified shifts and karma is available
        const postRollResult = await showKarmaSpendDialog(
          remainingKarma,
          "post-roll",
          rollTotal
        );

        if (postRollResult) {
          if (postRollResult.karmaSpent > 0) {
            postRollKarma = postRollResult.karmaSpent;
            // Use the die modifier returned from the dialog
            const actualShift = postRollResult.dieModifier || 0;
            rollTotal += actualShift;
          }
          // Always apply manual chart shift if provided
          if ((postRollResult as any).manualChartShift) {
            totalChartShift += (postRollResult as any).manualChartShift;
          }
        }
      }
    }

    // Deduct total karma spent
    const totalKarmaSpent = preRollKarma + postRollKarma;
    if (totalKarmaSpent > 0 && actor) {
      const actorSystem = (actor as any).system;
      const currentKarma = actorSystem?.resources?.karma?.value || 0;
      const newKarmaValue = Math.max(0, currentKarma - totalKarmaSpent);

      await actor.update({
        // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
        "system.resources.karma.value": newKarmaValue
      });

      // Sync karma with Charman if character is linked
      const charmanData = actorSystem?.charman;
      if (charmanData?.username && charmanData?.characterName) {
        try {
          const service = getCharmanService();
          await service.updateKarma(
            charmanData.username,
            charmanData.characterName,
            newKarmaValue
          );
        } catch (error) {
          // Service not initialized or sync failed - ignore silently
          console.warn("Could not sync karma to Charman:", error);
        }
      }
    }

    // Consume any "next attack"/"next dodge"/"next action" triggered
    // modifiers (e.g. from a critical-success table draw) that match this
    // roll, folding their chart shift in before the rank is looked up.
    let forcedOutcome: "critical" | "failure" | null = null;
    if (actor) {
      const triggerKind = additionalFlags?.attackRoll
        ? "nextAttack"
        : additionalFlags?.defenseRoll
          ? "nextDodge"
          : "nextAction";
      totalChartShift += await consumeTriggeredModifiers(actor, triggerKind);

      // Applies to any roll (attack, defense, FEAT, power use, etc.) -
      // overrides the die-based result entirely rather than shifting it.
      forcedOutcome = await consumeForcedResult(actor);
    }

    // Apply Chart Shift to the rank used for Universal Table lookup
    const shiftedRank = applyChartShift(attributeRank, totalChartShift);

    // A forced outcome must land in a REAL Red or White zone for the
    // shifted rank on the Universal Table, not just be painted red/white -
    // everything downstream (damage tier, bonus-damage-roll thresholds,
    // the roll-card total shown in chat) reads rollTotal/result together,
    // so they'd disagree if we only overrode the displayed tier. The
    // landing value is randomized across the FULL zone (Critical: redStart
    // to 100; Failure: 1 to greenStart - 1, which includes the Botch/
    // Ultimate Botch sub-ranges) via a real dice roll, rather than pinned
    // to one fixed edge value every time.
    let finalRoll = roll;
    if (forcedOutcome) {
      const shortRank = RANK_SHORTS[shiftedRank];
      const ranges = UNIVERSAL_TABLE[shortRank];
      if (ranges) {
        const [greenStart, , redStart] = ranges;
        const [rangeMin, rangeMax] =
          forcedOutcome === "critical" ? [redStart, 100] : [1, greenStart - 1];
        const span = rangeMax - rangeMin + 1;

        // A genuine dice roll (1d<span> + offset) that lands uniformly
        // somewhere in [rangeMin, rangeMax], rather than a fixed edge value.
        const formula =
          rangeMin > 1 ? `1d${span} + ${rangeMin - 1}` : `1d${span}`;
        // @ts-expect-error - Roll class has a static create method that returns a Promise
        finalRoll = Roll.create(formula);
        await finalRoll.evaluate();
        rollTotal = finalRoll.total || rangeMin;
      }
    }

    const faseripRoll = new FaseripRoll(
      finalRoll,
      attributeValue,
      shiftedRank,
      attributeRank,
      totalChartShift,
      rollTotal, // Pass the karma-modified total for botch detection
      forcedOutcome ?? undefined
    );

    // Store metadata on the roll for later use (e.g., combo attacks)
    (faseripRoll as any).metadata = {
      attributeName,
      talentNames,
      preRollKarma,
      postRollKarma,
      karmaColumnShifts,
      additionalFlags
    };

    // Set flavor on the roll for display in chat
    if (flavor) {
      // @ts-expect-error - TypeScript doesn't recognize the flavor property on Roll
      faseripRoll.roll.flavor = flavor;
    }

    // Create chat message unless skipped (for combo attacks that combine messages)
    if (!skipMessage) {
      await faseripRoll.toMessage(
        attributeName,
        actor,
        talentNames,
        preRollKarma,
        postRollKarma,
        karmaColumnShifts,
        additionalFlags
      );
    }

    // Draw from the configured critical botch/success table, if any, and
    // apply any effect configured on the drawn result to the actor.
    const resultText = faseripRoll.getResultText();
    if (
      additionalFlags?.attackRoll &&
      (resultText === "Botch" || resultText === "Ultimate Botch!")
    ) {
      await drawCriticalTableEffect(
        actor,
        "criticalBotchTable",
        "Critical Botch Effect"
      );
    } else if (
      additionalFlags?.attackRoll &&
      (resultText === "Critical" || resultText === "Ultimate Critical!")
    ) {
      await drawCriticalTableEffect(
        actor,
        "criticalSuccessTable",
        "Critical Success Effect"
      );
    }

    return faseripRoll;
  }

  /**
   * Execute a combo attack with multiple strikes
   * Each attack after the first incurs increasing CS penalties
   */
  static async rollComboAttack(
    attributeName: string,
    attributeRank: Rank,
    attributeValue: number,
    chartShift: number = 0,
    comboCount: number = 1,
    actor?: FaseripActor,
    talentNames?: string[],
    additionalFlags?: Record<string, any>,
    attackKarmaSettings?: Array<{ columnShifts: number; resultShift: number }>,
    manualChartShift: number = 0
  ): Promise<void> {
    const rolls: Array<FaseripRoll & { comboPenalty: number; index: number }> =
      [];

    for (let i = 1; i <= comboCount; i++) {
      // Each attack gets an increasing CS penalty (only if comboCount > 1)
      const comboPenalty = comboCount > 1 ? -i : 0;
      const totalCS = chartShift + comboPenalty + manualChartShift;

      // Get karma settings for this attack
      const karmaSettings = attackKarmaSettings?.[i - 1];
      // If attackKarmaSettings provided (combo dialog was shown), always pass numbers to prevent additional dialogs
      // If not provided, pass undefined to allow dialogs
      const preSpecifiedKarmaShifts = attackKarmaSettings
        ? (karmaSettings?.columnShifts ?? 0)
        : undefined;
      const preSpecifiedResultShift = attackKarmaSettings
        ? (karmaSettings?.resultShift ?? 0)
        : undefined;

      // Execute the attack roll with karma settings (skipMessage=true to combine later)
      const roll = await this.rollAttribute(
        `${attributeName} (Attack ${i}${comboCount > 1 ? ` of ${comboCount}` : ""})`,
        attributeRank,
        attributeValue,
        totalCS,
        actor,
        talentNames,
        {
          ...additionalFlags,
          comboAttack: true,
          comboIndex: i,
          comboTotal: comboCount,
          comboPenalty
        },
        preSpecifiedKarmaShifts,
        preSpecifiedResultShift,
        true, // skipMessage - we'll send one combined message
        0 // manualChartShift is already included in totalCS
      );

      // Store combo metadata on the roll
      (roll as any).comboPenalty = comboPenalty;
      (roll as any).index = i;

      rolls.push(roll as any);

      // Check for botch (1-5) - break combo immediately
      const rollTotal = roll.roll.total || 0;
      if (rollTotal <= 5) {
        break;
      }
    }

    // Send one combined message for all attacks
    await this.createCombinedComboMessage(
      rolls,
      attributeName,
      actor,
      talentNames,
      additionalFlags
    );
  }

  /**
   * Create a single combined chat message for all combo attacks
   */
  private static async createCombinedComboMessage(
    rolls: Array<FaseripRoll & { comboPenalty: number; index: number }>,
    attributeName: string,
    actor: FaseripActor | undefined,
    talentNames: string[] | undefined,
    additionalFlags: Record<string, any> | undefined
  ): Promise<void> {
    if (rolls.length === 0) return;

    // Build attack details sections with individual result colors
    const attackDetails = await Promise.all(
      rolls.map(async (roll: any) => {
        const metadata = roll.metadata || {};
        const resultText = roll.getResultText();
        const resultClass = roll.getResultClass();
        const penaltyText =
          roll.comboPenalty !== 0 ? `${roll.comboPenalty} CS` : "";

        // Get color and text styling for this result
        let borderColor = "#4b5563"; // default white
        let textColor = "#9ca3af";

        if (resultClass.includes("perfect")) {
          borderColor = "#fbbf24";
          textColor = "#fffacd";
        } else if (resultClass.includes("ultimate-botch")) {
          borderColor = "#4b5563";
          textColor = "#fca5a5";
        } else if (resultClass.includes("botch")) {
          borderColor = "#991b1b";
          textColor = "#fca5a5";
        } else if (resultClass.includes("red")) {
          borderColor = "#dc2626";
          textColor = "#fca5a5";
        } else if (resultClass.includes("yellow")) {
          borderColor = "#eab308";
          textColor = "#fcd34d";
        } else if (resultClass.includes("green")) {
          borderColor = "#22c55e";
          textColor = "#86efac";
        }

        let chartShiftText = "";
        if (roll.chartShift !== 0) {
          chartShiftText =
            roll.chartShift > 0
              ? `+${roll.chartShift} CS`
              : `${roll.chartShift} CS`;
        }

        let karmaSpentText = "";
        const totalKarmaSpent =
          (metadata.preRollKarma || 0) + (metadata.postRollKarma || 0);
        if (totalKarmaSpent > 0) {
          const karmaDetails = [];
          if (metadata.preRollKarma > 0) {
            karmaDetails.push(
              `${metadata.preRollKarma} karma for ${metadata.karmaColumnShifts || 0} CS`
            );
          }
          if (metadata.postRollKarma > 0) {
            karmaDetails.push(`${metadata.postRollKarma} karma to modify roll`);
          }
          karmaSpentText = `${totalKarmaSpent} (${karmaDetails.join(", ")})`;
        }

        return await foundry.applications.handlebars.renderTemplate(
          "/systems/faserip/templates/chat/roll-card.hbs",
          {
            attackIndex: roll.index,
            penaltyText,
            resultText,
            resultClass,
            borderColor,
            textColor,
            rankDisplay: formatRankDisplay(roll.rank),
            rollTotal: roll.roll.total,
            chartShiftText,
            karmaSpent: karmaSpentText
          }
        );
      })
    );

    const attackDetailsHtml = attackDetails.join("");

    let talentSection = "";
    if (talentNames && talentNames.length > 0) {
      talentSection = `<div class="fsr-roll-card-detail">
        <strong>Talents:</strong> <span>${talentNames.join(", ")}</span>
      </div>`;
    }

    // Check if combo was broken early by a botch
    const lastRoll = rolls[rolls.length - 1];
    const lastRollTotal = lastRoll.roll.total || 0;
    const comboBroken = lastRollTotal <= 5;
    const originalComboTotal = (lastRoll as any).comboTotal || rolls.length;

    const comboLabel =
      rolls.length > 1
        ? comboBroken
          ? `(Combo - ${rolls.length} of ${originalComboTotal} Attacks - Botch broke combo!)`
          : `(Combo - ${rolls.length} Attacks)`
        : "";

    const content = `<div class="fsr-roll-card-combo">
      <h3>${attributeName} ${comboLabel}</h3>
      <div class="fsr-roll-card-details">
        ${talentSection}
      </div>
      ${attackDetailsHtml}
    </div>`;
    // Collect all rolls for the message
    const allRolls = rolls.map((r: any) => r.roll);

    await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content,
      rolls: allRolls,
      flags: (additionalFlags ?? {}) as Record<string, any>
    });
  }

  /**
   * Create a combined chat message for multiple rolls (e.g., /r in in in)
   */
  static async createCombinedRollMessage(
    rolls: FaseripRoll[],
    actor: FaseripActor | undefined,
    additionalFlags?: Record<string, any>,
    globalReason?: string
  ): Promise<void> {
    if (rolls.length === 0) return;

    // Build roll cards with individual result colors
    const rollCards = await Promise.all(
      rolls.map(async (roll: any, index: number) => {
        const resultText = roll.getResultText();
        const resultClass = roll.getResultClass();

        // Get color and text styling for this result
        let borderColor = "#4b5563"; // default white
        let textColor = "#9ca3af";

        if (resultClass.includes("perfect")) {
          borderColor = "#fbbf24";
          textColor = "#fffacd";
        } else if (resultClass.includes("ultimate-botch")) {
          borderColor = "#4b5563";
          textColor = "#fca5a5";
        } else if (resultClass.includes("botch")) {
          borderColor = "#991b1b";
          textColor = "#fca5a5";
        } else if (resultClass.includes("red")) {
          borderColor = "#dc2626";
          textColor = "#fca5a5";
        } else if (resultClass.includes("yellow")) {
          borderColor = "#eab308";
          textColor = "#fcd34d";
        } else if (resultClass.includes("green")) {
          borderColor = "#22c55e";
          textColor = "#86efac";
        }

        const metadata = roll.metadata || {};

        let chartShiftText = "";
        if (roll.chartShift !== 0) {
          chartShiftText =
            roll.chartShift > 0
              ? `+${roll.chartShift} CS`
              : `${roll.chartShift} CS`;
        }

        let karmaSpentText = "";
        const totalKarmaSpent =
          (metadata.preRollKarma || 0) + (metadata.postRollKarma || 0);
        if (totalKarmaSpent > 0) {
          const karmaDetails = [];
          if (metadata.preRollKarma > 0) {
            karmaDetails.push(
              `${metadata.preRollKarma} karma for ${metadata.karmaColumnShifts || 0} CS`
            );
          }
          if (metadata.postRollKarma > 0) {
            karmaDetails.push(`${metadata.postRollKarma} karma to modify roll`);
          }
          karmaSpentText = `${totalKarmaSpent} (${karmaDetails.join(", ")})`;
        }

        const flavor = (roll.roll as any).flavor;

        return await foundry.applications.handlebars.renderTemplate(
          "/systems/faserip/templates/chat/roll-card.hbs",
          {
            attackIndex: index + 1,
            penaltyText: "",
            resultText,
            resultClass,
            borderColor,
            textColor,
            rankDisplay: formatRankDisplay(roll.rank),
            rollTotal: roll.roll.total,
            chartShiftText,
            karmaSpent: karmaSpentText,
            flavor
          }
        );
      })
    );

    const rollCardsHtml = rollCards.join("");

    // Try to extract a meaningful title from the rolls
    let title = "Multiple Rolls";
    const metadata = (rolls[0] as any).metadata;
    if (metadata?.attributeName) {
      // Extract the base attribute name (remove "Roll X:" prefix if present)
      const baseName = metadata.attributeName.replace(/^Roll \d+: /, "");
      // Check if all rolls have the same base attribute
      const allSame = rolls.every((r: any) => {
        const name = ((r as any).metadata?.attributeName || "").replace(
          /^Roll \d+: /,
          ""
        );
        return name === baseName;
      });
      if (allSame) {
        title = baseName;
      }
    }

    // Add global reason to title if provided
    if (globalReason) {
      title = `${title} - ${globalReason}`;
    }

    const content = `<div class="fsr-roll-card-combo">
      <h3>${title}</h3>
      ${rollCardsHtml}
    </div>`;

    // Collect all rolls for the message
    const allRolls = rolls.map((r: any) => r.roll);

    await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content,
      rolls: allRolls,
      flags: (additionalFlags ?? {}) as Record<string, any>
    });
  }

  /**
   * Create a FASERIP roll for initiative (uses rank-based die)
   */
  static async rollInitiative(
    agilityRank: Rank | string,
    actor?: FaseripActor
  ): Promise<Roll> {
    const agilityValue = RANK_VALUES[agilityRank as Rank] || 6;
    const dieSize = Math.min(agilityValue, 100);

    const roll = await Roll.create(`1d${dieSize}`);
    await roll.evaluate();

    await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content: `<div class="fsr-roll-card fsr-roll-initiative">
        <h3>Initiative Roll</h3>
        <div class="fsr-roll-card-details">
          <div class="fsr-roll-card-detail">
            <strong>Agility:</strong> <span>${formatRankDisplay(agilityRank as string)}</span>
          </div>
          <div class="fsr-roll-card-detail">
            <strong>Die:</strong> <span>1d${dieSize}</span>
          </div>
          <div class="fsr-roll-card-detail">
            <strong>Result:</strong> <span>${roll.total}</span>
          </div>
        </div>
      </div>`,
      rolls: [roll]
    });

    return roll;
  }

  /**
   * Send this roll to chat
   */
  async toMessage(
    checkName: string,
    actor?: FaseripActor,
    talentNames?: string[],
    preRollKarma: number = 0,
    postRollKarma: number = 0,
    karmaColumnShifts: number = 0,
    additionalFlags?: Record<string, any>
  ): Promise<ChatMessage | undefined> {
    const resultText = this.getResultText();
    const resultClass = this.getResultClass();

    // Add combo info to checkName if present
    let displayName = checkName;
    if (
      additionalFlags?.comboIndex &&
      additionalFlags?.comboTotal &&
      additionalFlags.comboTotal > 1
    ) {
      displayName = `${checkName} (${additionalFlags.comboIndex} of ${additionalFlags.comboTotal})`;
    }

    let karmaSpentText = "";
    const totalKarmaSpent = preRollKarma + postRollKarma;
    if (totalKarmaSpent > 0) {
      const karmaDetails = [];
      if (preRollKarma > 0) {
        karmaDetails.push(`${preRollKarma} karma for ${karmaColumnShifts} CS`);
      }
      if (postRollKarma > 0) {
        karmaDetails.push(`${postRollKarma} karma to modify roll`);
      }
      karmaSpentText = `${totalKarmaSpent} (${karmaDetails.join(", ")})`;
    }

    const chartShiftText =
      this.chartShift > 0 ? `+${this.chartShift} CS` : `${this.chartShift} CS`;

    const content = await foundry.applications.handlebars.renderTemplate(
      "/systems/faserip/templates/chat/roll-card.hbs",
      {
        checkName: displayName,
        resultText,
        resultClass,
        rankDisplay: formatRankDisplay(this.rank),
        targetValue: this.targetValue,
        rollTotal: this.roll.total,
        chartShift: this.chartShift,
        chartShiftText,
        karmaSpent: karmaSpentText,
        talentNames: talentNames ? talentNames.join(", ") : undefined
      }
    );

    return await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content,
      rolls: [this.roll],
      flags: additionalFlags || {}
    });
  }
}

/**
 * Helper functions for rolling
 */
export async function rollFaseripCheck(
  attributeName: string,
  attributeRank: Rank,
  attributeValue: number,
  bonus: number = 0,
  actor?: FaseripActor
): Promise<FaseripRoll> {
  return await FaseripRoll.rollAttribute(
    attributeName,
    attributeRank,
    attributeValue,
    bonus,
    actor
  );
}

export async function rollFaseripInitiative(
  agilityRank: Rank | string,
  actor?: FaseripActor
): Promise<Roll> {
  return await FaseripRoll.rollInitiative(agilityRank, actor);
}
