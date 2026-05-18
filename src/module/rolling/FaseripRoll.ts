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

  constructor(
    roll: Roll,
    targetValue: number,
    rank: Rank,
    baseRank?: Rank,
    chartShift: number = 0
  ) {
    this.roll = roll;
    this.targetValue = targetValue;
    this.rank = rank;
    this.baseRank = baseRank || rank;
    this.chartShift = chartShift;
    this.result = this.evaluateResult();
  }

  /**
   * Evaluate the roll result based on FASERIP Universal Table
   */
  private evaluateResult(): RollResult {
    const rollValue = this.roll.total || 0;
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
    const rollValue = this.roll.total || 0;

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

    switch (this.result) {
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
    const rollValue = this.roll.total || 0;

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

    switch (this.result) {
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
    actor?: Actor,
    talentNames?: string[],
    additionalFlags?: Record<string, any>,
    preSpecifiedKarmaShifts?: number,
    preSpecifiedResultShift?: number
  ): Promise<FaseripRoll> {
    let totalChartShift = chartShift;
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

        if (preRollResult && preRollResult.karmaSpent > 0) {
          preRollKarma = preRollResult.karmaSpent;
          // Use the column shifts returned from the dialog
          karmaColumnShifts = preRollResult.columnShifts || 0;
          totalChartShift += karmaColumnShifts;
        }
      }
    }

    // Roll the dice
    const roll = await Roll.create("1d100");
    await roll.evaluate();
    rollTotal = roll.total || 0;

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

        if (postRollResult && postRollResult.karmaSpent > 0) {
          postRollKarma = postRollResult.karmaSpent;
          // Use the die modifier returned from the dialog
          const actualShift = postRollResult.dieModifier || 0;
          rollTotal += actualShift;
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

    // Apply Chart Shift to the rank used for Universal Table lookup
    const shiftedRank = applyChartShift(attributeRank, totalChartShift);

    // Create a modified roll if post-roll karma was spent
    let finalRoll = roll;
    if (postRollKarma > 0) {
      // Create a new roll with the modified total
      finalRoll = await Roll.create(`${rollTotal}`);
      await finalRoll.evaluate();
    }

    const faseripRoll = new FaseripRoll(
      finalRoll,
      attributeValue,
      shiftedRank,
      attributeRank,
      totalChartShift
    );

    // Create chat message
    await faseripRoll.toMessage(
      attributeName,
      actor,
      talentNames,
      preRollKarma,
      postRollKarma,
      karmaColumnShifts,
      additionalFlags
    );

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
    actor?: Actor,
    talentNames?: string[],
    additionalFlags?: Record<string, any>,
    attackKarmaSettings?: Array<{ columnShifts: number; resultShift: number }>
  ): Promise<FaseripRoll[]> {
    const rolls: FaseripRoll[] = [];

    for (let i = 1; i <= comboCount; i++) {
      // Each attack gets an increasing CS penalty (only if comboCount > 1)
      const comboPenalty = comboCount > 1 ? -i : 0;
      const totalCS = chartShift + comboPenalty;

      // Get karma settings for this attack (if provided)
      const karmaSettings = attackKarmaSettings?.[i - 1];
      const preSpecifiedKarmaShifts = karmaSettings?.columnShifts || undefined;
      const preSpecifiedResultShift = karmaSettings?.resultShift || undefined;

      // Execute the attack roll with karma settings
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
        preSpecifiedResultShift
      );

      rolls.push(roll);
    }

    return rolls;
  }

  /**
   * Create a FASERIP roll for initiative (uses rank-based die)
   */
  static async rollInitiative(
    agilityRank: Rank | string,
    actor?: Actor
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
    actor?: Actor,
    talentNames?: string[],
    preRollKarma: number = 0,
    postRollKarma: number = 0,
    karmaColumnShifts: number = 0,
    additionalFlags?: Record<string, any>
  ): Promise<ChatMessage | undefined> {
    const resultText = this.getResultText();
    const resultClass = this.getResultClass();

    let talentSection = "";
    if (talentNames && talentNames.length > 0) {
      talentSection = `<div class="fsr-roll-card-detail">
        <strong>Talents:</strong> <span>${talentNames.join(", ")}</span>
      </div>`;
    }

    let csSection = "";
    if (this.chartShift !== 0) {
      const csText =
        this.chartShift > 0
          ? `+${this.chartShift} CS`
          : `${this.chartShift} CS`;
      csSection = `<div class="fsr-roll-card-detail">
        <strong>Chart Shift:</strong> <span>${csText}</span>
      </div>`;
    }

    let karmaSection = "";
    const totalKarmaSpent = preRollKarma + postRollKarma;
    if (totalKarmaSpent > 0) {
      const karmaDetails = [];
      if (preRollKarma > 0) {
        karmaDetails.push(`${preRollKarma} karma for ${karmaColumnShifts} CS`);
      }
      if (postRollKarma > 0) {
        karmaDetails.push(`${postRollKarma} karma to modify roll`);
      }
      karmaSection = `<div class="fsr-roll-card-detail">
        <strong>Karma Spent:</strong> <span class="text-yellow-400">${totalKarmaSpent} (${karmaDetails.join(", ")})</span>
      </div>`;
    }

    return await ChatMessage.create({
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
      content: `<div class="fsr-roll-card ${resultClass}">
        <h3>${checkName}</h3>
        <div class="fsr-roll-card-result">
          ${resultText}
        </div>
        <div class="fsr-roll-card-details">
          <div class="fsr-roll-card-detail">
            <strong>Rank:</strong> <span>${formatRankDisplay(this.rank)}</span>
          </div>
          <div class="fsr-roll-card-detail">
            <strong>Value:</strong> <span>${this.targetValue}</span>
          </div>
          <div class="fsr-roll-card-detail">
            <strong>Roll:</strong> <span>${this.roll.total}%</span>
          </div>
          ${csSection}
          ${karmaSection}
          ${talentSection}
        </div>
      </div>`,
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
  actor?: Actor
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
  actor?: Actor
): Promise<Roll> {
  return await FaseripRoll.rollInitiative(agilityRank, actor);
}
