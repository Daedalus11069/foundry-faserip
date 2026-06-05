/**
 * Combat Flow System
 * Handles attack/defense interactions with proper sequencing
 */

import type { FaseripActor } from "../documents";
import { FaseripRoll } from "../rolling/FaseripRoll";
import {
  requestDefenseResponse,
  requestDamageApplication,
  requestCounterAttackResponse
} from "../socket/faserip-socket";
import { showAttackOptionsDialog } from "../applications/dialog-utils";
import { stringToRank } from "../utils";
import {
  type Rank,
  RollResult,
  applyChartShift,
  formatRankDisplay,
  RANK_VALUES
} from "../enums";
import { type ArmorItem, isArmorItem } from "../types/items";
import { createRoll } from "../utils/manual-roll-handler";
import { getCharmanService } from "../charman-service";

/**
 * Data for an attack attempt
 */
interface AttackData {
  attacker: FaseripActor;
  attackerToken?: Token;
  targets?: Token[]; // Optional: Explicit targets (for counter attacks, auto-targeting)
  attackAttribute: "fighting" | "agility" | "psyche";
  attackType: "melee" | "ranged" | "thrown" | "psyche";
  effectType?: "none" | "damage" | "heal-health" | "heal-armor"; // What effect this power has
  powerName?: string;
  powerRank?: Rank; // Base rank of the attacking power
  damageRoll?: string; // Optional: For house rules only - FASERIP uses result colors, not damage rolls
  damageType?: string; // Type of damage (fire, cold, etc.)
  armorPiercing?: string | null; // Armor-piercing rank (optional)
  talentNames?: string[]; // Optional: Talent names that apply to this attack
  talentCS?: number; // Optional: Column shift bonus from talents
  karmaColumnShifts?: number; // Optional: Pre-determined karma column shifts (from combo dialog)
  karmaResultShift?: number; // Optional: Pre-determined karma result shifts (from combo dialog)
  manualChartShift?: number; // Optional: Manual chart shift modifier (from combo dialog)
  damageRankBump?: number; // Optional: Global damage rank bump modifier (from combo dialog)
  perAttackKarma?: { damageRankShift: number; damageBonus: number }; // Optional: Per-attack damage karma for this specific attack
  comboIndex?: number; // Optional: Current attack number in combo (1-based)
  comboTotal?: number; // Optional: Total number of attacks in combo
  multiHit?: boolean; // True for AoE/multi-target powers (one roll, no combo penalty)
  deferDamageApplication?: boolean; // True to accumulate damage without applying (for cumulative combo damage)
  comboBotchCount?: number; // Optional: Number of botches so far in this combo (for cumulative penalty)
}

/**
 * Pending damage data for cumulative combo attacks
 */
export interface PendingDamage {
  targetActorId: string;
  targetTokenId: string;
  targetName: string;
  totalDamage: number;
  damageType?: string;
  armorPiercing?: string | null;
  armorRank?: string;
  powerName?: string;
  hits: Array<{
    damage: number;
    powerName?: string;
    comboIndex: number;
  }>;
}

/**
 * Result from executeCombatAttack with optional pending damage
 */
export interface CombatAttackResult {
  attackRollTotal: number | null;
  pendingDamages?: PendingDamage[]; // Accumulated damage if deferDamageApplication was true
  comboBotchCount: number; // Number of botches that have occurred in this combo
}

/**
 * FASERIP-specific chat message flags for combat messages
 */
interface FaseripCombatFlags {
  combatMessage: boolean;
  damageMessage: boolean;
  targetId: string;
  damage: number;
  baseRank: Rank;
  reducedRank: Rank;
  attackTier: number;
  defenseTier: number;
  rankReduction: number;
  attackRoll: number;
  defenseRoll: number | null;
  resultText: string;
  resultClass: string;
  powerName?: string;
  damageType?: string;
}

/**
 * FASERIP-specific chat message flags for deprecated damage roll messages (house rules)
 */
interface FaseripDamageRollFlags {
  damageRoll: boolean;
  targetId: string;
  damageType?: string;
}

/**
 * Result of damage calculation
 */
interface DamageResult {
  damage: number;
  baseRank: Rank;
  reducedRank: Rank;
  attackTier: number;
  defenseTier: number;
  rankReduction: number;
  formula: string;
  description: string;
  bonusRoll?: Roll; // The 3d6 or 5d10 roll for Red/Ultimate results
}

/**
 * Get the tier value from a roll result
 * White = 0 (failure), Green = 1, Yellow = 2, Red = 3, Ultimate (100) = 4
 */
function getResultTier(roll: FaseripRoll): number {
  const rollValue = roll.roll.total || 0;

  // Ultimate critical (rolling 100)
  if (rollValue === 100) {
    return 4;
  }

  // Check result color
  switch (roll.result) {
    case RollResult.Red:
      return 3;
    case RollResult.Yellow:
      return 2;
    case RollResult.Green:
      return 1;
    case RollResult.White:
    default:
      return 0;
  }
}

/**
 * Get background and text colors for a result class
 * Used for dynamically coloring Attack/Defense boxes in combat messages
 */
function getResultColors(resultClass: string): {
  background: string;
  color: string;
} {
  switch (resultClass) {
    case "fsr-roll-perfect":
      return { background: "#ffd700", color: "#7c2d12" }; // Gold background, dark brown text
    case "fsr-roll-red":
      return { background: "#dc2626", color: "#fecaca" }; // Red background, light red text
    case "fsr-roll-yellow":
      return { background: "#fbbf24", color: "#78350f" }; // Yellow background, dark yellow text
    case "fsr-roll-green":
      return { background: "#22c55e", color: "#dcfce7" }; // Green background, light green text
    case "fsr-roll-botch":
      return { background: "#991b1b", color: "#fca5a5" }; // Dark red background, light red text
    case "fsr-roll-ultimate-botch":
    case "fsr-roll-white":
    default:
      return { background: "#6b7280", color: "#f3f4f6" }; // Gray background, light gray text
  }
}

/**
 * Calculate damage using hybrid system:
 * - SPECIAL RULES (bypass normal calculation - handled in executeCombatAttack):
 *   - Ultimate (100) ALWAYS TRUMPS: 100 attack beats Red defense, 100 defense beats Red attack
 *   - Ultimate vs Ultimate: Defense wins + counter (melee attacks only)
 *   - Red defense (not 100): Complete defense + counter against non-100 attacks (melee attacks only)
 * - Failed defense (tier 0): No rank reduction, attack at full power
 * - Ultimate botch defense: Attack gets +2 CS bonus (catastrophic failure)
 * - Successful defense (Green/Yellow): Rank reduction = 1 + tier difference
 *   - Base: 1 CS for any successful defense
 *   - Additional: (defense tier - attack tier) if defender did better
 *   - Examples: Same tier = 1 CS, defense 1 tier better = 2 CS
 * - Tier-specific damage formulas (for attack rolls):
 *   - White (tier 0): base ÷ 4 (quarter damage)
 *   - Green (tier 1): base ÷ 2 (half damage)
 *   - Yellow (tier 2): base (full damage)
 *   - Red (tier 3): base + 3d6 (critical damage)
 *   - Ultimate (100): base + 5d10 (ultimate damage)
 * @param preRolledBonus - Optional pre-rolled bonus (for AOE attacks to use same bonus for all targets)
 * @returns DamageResult with bonusRoll set to null if preRolledBonus was used (to avoid re-displaying)
 */
async function calculateDamage(
  attackRoll: FaseripRoll,
  defenseRoll: FaseripRoll | null,
  powerRank: Rank,
  isUltimateBotch: boolean = false,
  preRolledBonus?: Roll
): Promise<DamageResult> {
  const attackTier = getResultTier(attackRoll);
  const defenseTier = defenseRoll ? getResultTier(defenseRoll) : 0;

  // Ultimate botch on defense - attack gets +2 CS bonus (catastrophic failure)
  let botchBonus = 0;
  if (isUltimateBotch) {
    botchBonus = 2;
  }

  // Calculate rank reduction
  // Failed defense (tier 0) means no reduction; successful defense reduces based on tier difference
  let rankReduction = 0;
  if (defenseTier > 0) {
    // Base reduction: 1 CS for any successful defense
    // Additional reduction: how much better the defender did than the attacker
    const tierDifference = Math.max(0, defenseTier - attackTier);
    rankReduction = 1 + tierDifference;
  }

  // Apply chart shifts to reduce base rank
  // Note: botchBonus increases attack power, so it's added (not subtracted)
  const reducedRank = applyChartShift(powerRank, botchBonus - rankReduction);
  const reducedValue = RANK_VALUES[reducedRank];

  let damage = 0;
  let formula = "";
  let description = "";
  let bonusRoll: Roll | undefined | null = undefined;

  // Apply tier-specific damage formula to reduced base
  const rollValue = attackRoll.roll.total || 0;

  if (rollValue === 100) {
    // Ultimate: reduced base + 5d10
    // Use pre-rolled bonus if provided (for AOE attacks), otherwise roll new
    if (preRolledBonus) {
      bonusRoll = preRolledBonus;
    } else {
      bonusRoll = await createRoll("5d10", "Ultimate Damage Bonus", "d10");
      if (!bonusRoll) {
        // User cancelled, use 0 bonus
        bonusRoll = await Roll.create("0");
        await bonusRoll.evaluate();
      }
    }
    const bonus = bonusRoll.total || 0;
    damage = reducedValue + bonus;
    formula = `${reducedValue} + 5d10 = ${bonus}`;
    description = `Ultimate Critical! ${formatRankDisplay(reducedRank)} base + 5d10`;
  } else {
    switch (attackRoll.result) {
      case RollResult.Red:
        // Red: reduced base + 3d6
        // Use pre-rolled bonus if provided (for AOE attacks), otherwise roll new
        if (preRolledBonus) {
          bonusRoll = preRolledBonus;
        } else {
          bonusRoll = await createRoll("3d6", "Critical Damage Bonus", "d6");
          if (!bonusRoll) {
            // User cancelled, use 0 bonus
            bonusRoll = await Roll.create("0");
            await bonusRoll.evaluate();
          }
        }
        const redBonus = bonusRoll.total || 0;
        damage = reducedValue + redBonus;
        formula = `${reducedValue} + 3d6 = ${redBonus}`;
        description = `Critical! ${formatRankDisplay(reducedRank)} base + 3d6`;
        break;

      case RollResult.Yellow:
        // Yellow: reduced base (full)
        damage = reducedValue;
        formula = `${reducedValue}`;
        description = `Success! ${formatRankDisplay(reducedRank)} base damage`;
        break;

      case RollResult.Green:
        // Green: reduced base ÷ 2
        damage = Math.floor(reducedValue / 2);
        formula = `${reducedValue} ÷ 2`;
        description = `Half Success! ${formatRankDisplay(reducedRank)} base ÷ 2`;
        break;

      case RollResult.White:
      default:
        // White: reduced base ÷ 4
        damage = Math.floor(reducedValue / 4);
        formula = `${reducedValue} ÷ 4`;
        description = `Glancing Blow! ${formatRankDisplay(reducedRank)} base ÷ 4`;
        break;
    }
  }

  return {
    damage,
    baseRank: powerRank,
    reducedRank,
    attackTier,
    defenseTier,
    rankReduction,
    formula,
    description,
    bonusRoll: preRolledBonus ? undefined : bonusRoll // Don't return pre-rolled bonus (already shown)
  };
}

/**
 * Apply damage to an actor, reducing armor first then health
 * Priority: Equipped armor soaks first, Body Armor power soaks remainder, then health
 * @param actor Actor to apply damage to
 * @param damage Amount of damage to apply
 * @returns Object with armor damage, health damage, and remaining values
 */
async function applyDamageToActor(
  actor: FaseripActor,
  damage: number
): Promise<{
  armorDamage: number;
  healthDamage: number;
  newArmorValue: number;
  newHealthValue: number;
}> {
  const system = actor.system as any;
  const currentFormId = system.currentFormId;

  // Get degrading armor setting
  const degradingArmorEnabled =
    game.settings.get("faserip", "degradingArmor") ?? false;

  // Armor is derived from body armor power + equipped armor items
  const activeFormId = system.currentFormId;
  const bodyArmorPower = (system.powers || []).find(
    (p: any) =>
      p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
      (!p.formIds?.length || p.formIds.includes(activeFormId))
  );

  // Find equipped armor from actor.items collection (Item documents)
  const equippedArmorItems = actor.items.filter(
    (item): item is ArmorItem => isArmorItem(item) && item.system.equipped
  );

  const currentArmor = system.resources?.armor?.value || 0;
  const currentHealth =
    system.healthByForm?.[currentFormId] ??
    system.resources?.health?.value ??
    0;

  let armorDamage = 0;
  let healthDamage = 0;
  let newArmorValue = currentArmor;
  let newHealthValue = currentHealth;

  const updates: Record<string, any> = {};

  if (currentArmor > 0) {
    // Apply damage to armor first
    armorDamage = Math.min(damage, currentArmor);

    // Calculate new armor value based on degrading setting
    // When degrading is disabled, armor soaks but doesn't reduce
    newArmorValue = degradingArmorEnabled
      ? currentArmor - armorDamage
      : currentArmor;

    // Only reduce armor values if degrading armor is enabled
    if (degradingArmorEnabled) {
      // Reduce armor values (EQUIPPED ARMOR FIRST, then body armor power)
      let remainingArmorDamage = armorDamage;

      // Equipped armor items soak first (update each item directly)
      for (const armorItem of equippedArmorItems) {
        if (remainingArmorDamage <= 0) break;

        const armorValue = armorItem.system.value || 0;
        const armorReduction = Math.min(remainingArmorDamage, armorValue);

        if (armorReduction > 0) {
          await armorItem.update({
            "system.value": armorValue - armorReduction
          } as Record<string, unknown>);
          remainingArmorDamage -= armorReduction;
        }
      }

      // Body Armor power soaks remainder
      if (bodyArmorPower && remainingArmorDamage > 0) {
        const bodyArmorReduction = Math.min(
          remainingArmorDamage,
          bodyArmorPower.value
        );
        // Clone powers array and update the specific power
        const updatedPowers = [...system.powers];
        const powerIndex = updatedPowers.findIndex(
          (p: any) => p.id === bodyArmorPower.id
        );
        if (powerIndex !== -1) {
          updatedPowers[powerIndex] = {
            ...updatedPowers[powerIndex],
            value: bodyArmorPower.value - bodyArmorReduction
          };
          updates["system.powers"] = updatedPowers;
        }
      }
    }

    // NOTE: Do NOT manually set system.resources.armor.value here
    // It's a derived value that gets automatically recalculated in prepareDerivedData()
    // from the individual armor sources (equipped armor + body armor power)

    // If damage exceeds armor, overflow to health
    const overflow = damage - armorDamage;
    if (overflow > 0) {
      healthDamage = overflow;
      newHealthValue = currentHealth - healthDamage;
    }
  } else {
    // No armor, all damage goes to health
    healthDamage = damage;
    newHealthValue = currentHealth - healthDamage;
  }

  // Update health in healthByForm for current form
  if (healthDamage > 0) {
    // Get existing healthByForm or create new one
    const existingHealthByForm = system.healthByForm || {};
    const updatedHealthByForm = {
      ...existingHealthByForm,
      [currentFormId]: newHealthValue
    };
    updates["system.healthByForm"] = updatedHealthByForm;
    // CRITICAL: Also update resources.health.value directly
    // prepareDerivedData() will recalculate from healthByForm, but we need immediate update
    updates["system.resources.health.value"] = newHealthValue;
  }

  // Update actor with new values
  try {
    await actor.update(updates);
  } catch (error) {
    console.error("FASERIP Combat | Error updating actor:", error);
  }

  return {
    armorDamage,
    healthDamage,
    newArmorValue,
    newHealthValue
  };
}

/**
 * Execute a full combat flow: attack → defense prompt → resolution → damage
 * Returns CombatAttackResult with attack roll total and optional pending damages
 * When deferDamageApplication is true, damage is accumulated but not applied
 */
export async function executeCombatAttack(
  attackData: AttackData
): Promise<CombatAttackResult | null> {
  const {
    attacker,
    attackAttribute,
    attackType,
    powerName,
    talentNames,
    talentCS,
    karmaColumnShifts: presetKarmaColumnShifts,
    karmaResultShift: presetKarmaResultShift,
    manualChartShift: presetManualChartShift,
    comboIndex,
    comboTotal
  } = attackData;

  // Initialize array for accumulating damage when deferDamageApplication is true
  const pendingDamages: PendingDamage[] = [];

  // Get targeted tokens - use explicit targets if provided, otherwise use selected targets
  const targets = attackData.targets
    ? attackData.targets
    : // @ts-expect-error - game.user.targets may not be typed
      (Array.from(game.user?.targets ?? []) as Token[]);

  // MULTI-TARGET HANDLING:
  // If NOT multi-hit and multiple targets, process each target individually with separate rolls
  // IMPORTANT: If comboIndex/comboTotal are already set (from combo dialog), preserve them
  // Only use multi-target indexing if NOT part of a combo attack
  if (!attackData.multiHit && targets.length > 1 && !attackData.comboIndex) {
    let cumulativeBotches = attackData.comboBotchCount ?? 0;

    for (let i = 0; i < targets.length; i++) {
      const result = await executeCombatAttack({
        ...attackData,
        targets: [targets[i]], // Single target
        comboIndex: i + 1, // 1-based index for combo penalty
        comboTotal: targets.length, // Total number of targets
        comboBotchCount: cumulativeBotches // Pass cumulative botch count
      });

      // Check for cancellation (null) - break combo immediately
      console.log("[Combo Multi-Target] Attack roll result:", {
        attackRollTotal: result?.attackRollTotal,
        targetIndex: i + 1,
        totalTargets: targets.length
      });

      if (result === null) {
        console.log("[Combo Multi-Target] Breaking combo - roll cancelled");
        // Cancellation message already shown by executeCombatAttack
        break;
      }

      // Update cumulative botch count from result
      cumulativeBotches = result.comboBotchCount;

      // Check for botch (1-5) - break combo immediately
      if (result.attackRollTotal !== null && result.attackRollTotal <= 5) {
        console.log(
          "[Combo Multi-Target] Breaking combo - botch detected:",
          result.attackRollTotal
        );
        // Show message about combo break
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: attacker }),
          content: `<div class="fsr-combat-message" style="background: #991b1b; color: #fca5a5; padding: 0.5rem; border-radius: 4px;">
            <strong>Botch! Combo Broken!</strong>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${attacker.name}'s attack botched on target ${i + 1} of ${targets.length}. Remaining attacks cancelled.</p>
          </div>`
        });
        break;
      }

      // Brief delay between attacks for readability
      if (i < targets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    return null;
  }

  // If no targets, show warning and just roll the attack without combat flow
  if (targets.length === 0) {
    const system = attacker.system as any;
    const currentForm =
      system.forms?.find((f: any) => f.id === system.currentFormId) ||
      system.forms?.[0];

    if (!currentForm) {
      ui.notifications?.error("No form found for attacker!");
      return null;
    }

    const attackAttr = currentForm.attributes?.[attackAttribute];
    if (!attackAttr) {
      ui.notifications?.error(`${attackAttribute} attribute not found!`);
      return null;
    }

    const attackRank = stringToRank(attackAttr.rank) as Rank;
    const attackValue = attackAttr.value;
    const currentKarma = system.resources?.karma?.value ?? 0;

    // If karma/modifiers are already set (from caller), use them directly
    let karmaColumnShifts: number;
    let karmaResultShift: number;
    let manualChartShift: number;
    let damageRankBump: number = 0;

    if (
      presetKarmaColumnShifts !== undefined ||
      presetKarmaResultShift !== undefined ||
      presetManualChartShift !== undefined
    ) {
      karmaColumnShifts = presetKarmaColumnShifts ?? 0;
      karmaResultShift = presetKarmaResultShift ?? 0;
      manualChartShift = presetManualChartShift ?? 0;
      damageRankBump = attackData.damageRankBump ?? 0;
    } else {
      // Show attack options dialog
      const attackOptions = await showAttackOptionsDialog(
        attacker.name!,
        attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1),
        attackRank,
        currentKarma,
        powerName,
        talentCS
      );

      if (!attackOptions) {
        return null;
      }

      // Extract first attack's karma settings from combo result
      const firstAttackKarma = attackOptions.attackKarmaSettings[0];
      karmaColumnShifts = firstAttackKarma?.columnShifts ?? 0;
      karmaResultShift = firstAttackKarma?.resultShift ?? 0;
      manualChartShift = attackOptions.manualChartShift ?? 0;
      damageRankBump = attackOptions.damageRankBump ?? 0;
    }

    // Get consecutive botch penalty from combo (not from actor flags - this is per-combo)
    const comboBotchCount = attackData.comboBotchCount ?? 0;
    const botchPenalty = -comboBotchCount;

    // Show botch penalty warning if active
    if (comboBotchCount > 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: `<div class="fsr-combat-message" style="background: #dc2626; color: #fca5a5; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.5rem;">
          <strong>⚠️ Combo Botch Penalty Active!</strong>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${attacker.name} has botched ${comboBotchCount} time${comboBotchCount > 1 ? "s" : ""} in this combo. Attack suffers -${comboBotchCount} CS penalty.</p>
        </div>`
      });
    }

    // Roll and show attack (no combat flow) - include talent bonus and botch penalty in chart shift
    const noTargetRoll = await FaseripRoll.rollAttribute(
      powerName ||
        attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1),
      attackRank,
      attackValue,
      manualChartShift + (talentCS || 0) + botchPenalty,
      attacker,
      talentNames,
      {
        attackRoll: true,
        attackType,
        powerName
      },
      karmaColumnShifts,
      karmaResultShift,
      false // Show message
    );

    // Return attack total for combo botch detection
    const noTargetTotal =
      (noTargetRoll.modifiedTotal ?? noTargetRoll.roll.total) || 0;

    // Track botches within this combo
    const newBotchCount =
      noTargetTotal <= 5 ? comboBotchCount + 1 : comboBotchCount;
    if (noTargetTotal <= 5) {
      console.log(
        `[Combat Flow - No Targets] Botch detected! Combo botches: ${newBotchCount}`
      );
    }

    console.log("[Combat Flow - No Targets] Returning attack total:", {
      modifiedTotal: noTargetRoll.modifiedTotal,
      rollTotal: noTargetRoll.roll.total,
      finalTotal: noTargetTotal,
      comboIndex,
      comboTotal
    });
    return {
      attackRollTotal: noTargetTotal,
      pendingDamages: [],
      comboBotchCount: newBotchCount
    };
  }

  // Step 1: Roll attack (but don't show yet)
  const system = attacker.system as any;
  const currentForm =
    system.forms?.find((f: any) => f.id === system.currentFormId) ||
    system.forms?.[0];

  if (!currentForm) {
    ui.notifications?.error("No form found for attacker!");
    return null;
  }

  const attackAttr = currentForm.attributes?.[attackAttribute];
  if (!attackAttr) {
    ui.notifications?.error(`${attackAttribute} attribute not found!`);
    return null;
  }

  const attackRank = stringToRank(attackAttr.rank) as Rank;
  const attackValue = attackAttr.value;

  // Step 0.5: Get attack options (either preset from caller or show options dialog)
  const currentKarma = system.resources?.karma?.value ?? 0;
  let attackOptions;
  let karmaColumnShifts: number;
  let karmaResultShift: number;
  let manualChartShift: number;
  let damageRankBump: number = 0;

  if (
    presetKarmaColumnShifts !== undefined ||
    presetKarmaResultShift !== undefined ||
    presetManualChartShift !== undefined
  ) {
    // Use preset values from caller (combo attack scenario)
    karmaColumnShifts = presetKarmaColumnShifts ?? 0;
    karmaResultShift = presetKarmaResultShift ?? 0;
    manualChartShift = presetManualChartShift ?? 0;
    damageRankBump = attackData.damageRankBump ?? 0;
  } else {
    // Show attack options dialog
    attackOptions = await showAttackOptionsDialog(
      attacker.name!,
      attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1),
      attackRank,
      currentKarma,
      powerName,
      talentCS
    );

    if (!attackOptions) {
      // User cancelled
      return null;
    }

    // Extract first attack's karma settings from combo result
    const firstAttackKarma = attackOptions.attackKarmaSettings[0];
    karmaColumnShifts = firstAttackKarma?.columnShifts ?? 0;
    karmaResultShift = firstAttackKarma?.resultShift ?? 0;
    manualChartShift = attackOptions.manualChartShift ?? 0;
    damageRankBump = attackOptions.damageRankBump ?? 0;

    console.log(
      `[Combat Flow] Attack options extracted: damageRankBump=${damageRankBump}, manualChartShift=${manualChartShift}`
    );
  }

  // Get consecutive botch penalty from combo (not from actor flags - this is per-combo)
  const comboBotchCount = attackData.comboBotchCount ?? 0;
  const botchPenalty = -comboBotchCount;

  // Debug armor piercing data
  console.log("[Combat Flow] Armor piercing data:", {
    armorPiercing: attackData.armorPiercing,
    armorPiercingType: typeof attackData.armorPiercing,
    powerName: attackData.powerName,
    fullAttackData: attackData
  });

  // Calculate combo penalty if this is part of a combo attack
  // Multi-hit powers (AoE) don't suffer combo penalty - one roll for all targets
  const comboPenalty =
    !attackData.multiHit && comboTotal && comboTotal > 1
      ? -(comboIndex ?? 1)
      : 0;

  // Calculate total chart shift (manual + talent bonuses + combo penalty + botch penalty)
  const totalChartShift =
    manualChartShift + (talentCS || 0) + comboPenalty + botchPenalty;

  // Step 1: Roll attack with applied chart shifts
  // Pass karma shifts to rollAttribute - it will handle deduction and application
  let attackRoll;
  try {
    attackRoll = await FaseripRoll.rollAttribute(
      attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1),
      attackRank,
      attackValue,
      totalChartShift, // Manual chart shift only
      attacker,
      talentNames, // Pass talent names from attack data
      {
        attackRoll: true,
        attackType,
        powerName
      },
      karmaColumnShifts, // Let rollAttribute handle column shifts
      karmaResultShift, // Let rollAttribute handle result shift
      true // Skip message - we'll show it after defenses are chosen
    );
  } catch (error: any) {
    // Handle manual roll cancellation
    if (error?.message === "Roll cancelled") {
      // User cancelled the manual roll entry - treat as combo break
      if (comboIndex && comboTotal && comboTotal > 1) {
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: attacker }),
          content: `<div class="fsr-combat-message" style="background: #6b7280; color: #e5e7eb; padding: 0.5rem; border-radius: 4px;">
            <strong>Roll Cancelled - Combo Broken!</strong>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${attacker.name} cancelled the roll on attack ${comboIndex} of ${comboTotal}. Remaining attacks cancelled.</p>
          </div>`
        });
      }
      return null;
    }
    // Re-throw other errors
    throw error;
  }

  // Use karma-modified total if available (for botch detection), otherwise use raw roll total
  const attackTotal = (attackRoll.modifiedTotal ?? attackRoll.roll.total) || 0;
  console.log("[Combat Flow] attackTotal calculated:", {
    modifiedTotal: attackRoll.modifiedTotal,
    rollTotal: attackRoll.roll.total,
    finalAttackTotal: attackTotal,
    comboIndex,
    comboTotal
  });

  // Track botches within this combo
  const newBotchCount =
    attackTotal <= 5 ? comboBotchCount + 1 : comboBotchCount;
  if (attackTotal <= 5) {
    // Botch detected
  }

  // Deduct damage karma ONLY if using attack options dialog (not preset values from StatsTab)
  // When using preset values, karma is already deducted in StatsTab
  if (
    attackOptions &&
    attackOptions.attackKarmaSettings &&
    presetKarmaColumnShifts === undefined &&
    presetKarmaResultShift === undefined &&
    presetManualChartShift === undefined
  ) {
    let totalDamageKarma = 0;

    // Calculate total damage karma cost from all attacks
    for (let i = 0; i < attackOptions.attackKarmaSettings.length; i++) {
      const attack = attackOptions.attackKarmaSettings[i];
      const comboPenalty = -(i + 1); // Combo penalty for this attack

      // Damage rank shift cost (same as pre-roll CS calculation)
      if (attack.damageRankShift > 0) {
        const effectiveRank = applyChartShift(
          attackRank,
          comboPenalty + (talentCS || 0)
        );
        const shiftedRank = applyChartShift(
          effectiveRank,
          attack.damageRankShift
        );
        const effectiveValue = RANK_VALUES[effectiveRank] || 6;
        const shiftedValue = RANK_VALUES[shiftedRank] || 6;
        const scoreDiff = Math.abs(shiftedValue - effectiveValue);
        totalDamageKarma += Math.max(10, scoreDiff);
      }

      // Damage bonus cost (1:1 ratio, minimum 10)
      if (attack.damageBonus > 0) {
        totalDamageKarma += Math.max(10, attack.damageBonus);
      }
    }

    // Deduct karma if any damage karma was spent
    if (totalDamageKarma > 0) {
      const actorSystem = (attacker as any).system;
      const currentKarma = actorSystem?.resources?.karma?.value || 0;
      const newKarmaValue = Math.max(0, currentKarma - totalDamageKarma);

      await attacker.update({
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
  }

  // Show the attack roll to chat BEFORE defense dialogs
  // ChatMessage.create will handle the dice animation automatically
  const attackMetadata = (attackRoll as any).metadata || {};

  // Build attack name (combo info will be added by toMessage if present in flags)
  const attackName = powerName
    ? `${powerName} Attack`
    : `${attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1)} Attack`;

  // Show botch penalty warning if active
  if (comboBotchCount > 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div class="fsr-combat-message" style="background: #dc2626; color: #fca5a5; padding: 0.5rem; border-radius: 4px; margin-bottom: 0.5rem;">
        <strong>⚠️ Combo Botch Penalty Active!</strong>
        <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${attacker.name} has botched ${comboBotchCount} time${comboBotchCount > 1 ? "s" : ""} in this combo. Attack suffers -${comboBotchCount} CS penalty.</p>
      </div>`
    });
  }

  const attackMessage = await attackRoll.toMessage(
    attackName,
    attacker,
    attackMetadata.talentNames,
    attackMetadata.preRollKarma || 0,
    attackMetadata.postRollKarma || 0,
    attackMetadata.karmaColumnShifts || 0,
    {
      attackRoll: true,
      attackType,
      powerName,
      targetCount: targets.length,
      comboIndex,
      comboTotal,
      ...(attackMetadata.additionalFlags || {})
    }
  );

  // Wait for dice animation to complete before showing defense dialog
  if ((game as any).dice3d && attackMessage) {
    await (game as any).dice3d.waitFor3DAnimationByMessageID(attackMessage.id);
  }

  // Calculate effective attack rank after all modifiers (including combo penalty)
  const effectiveAttackRank = applyChartShift(
    attackRank,
    karmaColumnShifts + manualChartShift + (talentCS || 0) + comboPenalty
  );

  // Step 2: Request defense responses from all targets
  const defenseResponses: Array<any> = [];

  for (const target of targets) {
    const targetActor = target.actor as FaseripActor | undefined;

    if (!targetActor) {
      console.warn("FASERIP Combat | Target has no actor:", target.name);
      defenseResponses.push(null);
      continue;
    }

    const defenseResponse = await requestDefenseResponse({
      targetActorId: targetActor.id!,
      targetTokenId: target.id,
      attackerName: attacker.name!,
      attackRoll: attackTotal,
      attackType,
      attackAttribute:
        attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1),
      attackResult: attackRoll.getResultText(),
      attackRank: effectiveAttackRank,
      powerName,
      comboIndex,
      comboTotal
    });

    defenseResponses.push(defenseResponse);
  }

  // Step 2.5: For multi-hit/AOE attacks with crit/ultimate, pre-roll bonus damage ONCE
  let sharedBonusRoll: Roll | null | undefined = undefined;
  let sharedBonusIsUltimate = false;
  if (attackData.multiHit && targets.length > 1) {
    const rollValue = attackRoll.roll.total || 0;
    if (rollValue === 100) {
      // Ultimate crit - roll 5d10 once for all targets
      sharedBonusRoll = await createRoll(
        "5d10",
        "Ultimate Damage Bonus (AOE)",
        "d10"
      );
      if (!sharedBonusRoll) {
        sharedBonusRoll = await Roll.create("0");
        await sharedBonusRoll.evaluate();
      }
      sharedBonusIsUltimate = true;
      // Will show to chat AFTER damage cards
    } else if (attackRoll.result === RollResult.Red) {
      // Red crit - roll 3d6 once for all targets
      sharedBonusRoll = await createRoll(
        "3d6",
        "Critical Damage Bonus (AOE)",
        "d6"
      );
      if (!sharedBonusRoll) {
        sharedBonusRoll = await Roll.create("0");
        await sharedBonusRoll.evaluate();
      }
      sharedBonusIsUltimate = false;
      // Will show to chat AFTER damage cards
    }
  }

  // Step 3: Show results and determine hits
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const defenseResponse = defenseResponses[i];
    const targetActor = target.actor as FaseripActor | undefined;

    if (!targetActor) continue;

    let attackHit = false;
    let defenseRoll = null;
    let combatComparison: any = null;

    if (!defenseResponse || defenseResponse.defenseType === "takeHit") {
      // Target took the hit without defending
      attackHit = true;

      const attackResultText = attackRoll.getResultText();
      const attackResultClass = attackRoll.getResultClass();
      const attackTier = getResultTier(attackRoll);

      combatComparison = {
        attackTotal,
        defenseTotal: 0,
        attackTier,
        defenseTier: 0,
        attackResultText,
        attackResultClass,
        defenseResultText: "No Defense",
        defenseResultClass: "white",
        attackHit: true
      };
    } else {
      // Target defended - defense roll card was already shown on their client
      // We just need to reconstruct the result for damage calculation

      // Create a minimal roll object for tier calculation
      if (defenseResponse._rollJSON) {
        const reconstructedRoll = Roll.fromData(defenseResponse._rollJSON);
        defenseRoll = {
          roll: reconstructedRoll,
          result: defenseResponse._resultText
            ?.toLowerCase()
            .includes("critical")
            ? RollResult.Red
            : defenseResponse._resultText?.toLowerCase().includes("success") &&
                !defenseResponse._resultText?.toLowerCase().includes("half")
              ? RollResult.Yellow
              : defenseResponse._resultText?.toLowerCase().includes("half")
                ? RollResult.Green
                : RollResult.White,
          getResultText: () => defenseResponse._resultText || "Success",
          getResultClass: () => defenseResponse._resultClass || "green"
        } as any;
      }

      const defenseTotal = defenseResponse.defenseRoll || 0;

      // Get tiers for comparison
      const attackTier = getResultTier(attackRoll);
      const defenseTier = defenseRoll ? getResultTier(defenseRoll) : 0;

      // Check for Ultimate (100) results - 100 ALWAYS TRUMPS except another 100
      const attackIs100 = (attackRoll.roll.total || 0) === 100;
      const defenseIs100 = defenseRoll
        ? (defenseRoll.roll.total || 0) === 100
        : false;

      if (attackIs100 && defenseIs100) {
        // Both rolled 100 - defense wins (defender advantage on ties) + counter (melee only)
        attackHit = false;

        // Offer counter-attack for Ultimate defense (melee attacks only)
        if (attackType === "melee") {
          const counterResponse = await requestCounterAttackResponse({
            defenderActorId: targetActor.id!,
            defenderTokenId: target.id,
            defenderName: targetActor.name,
            attackerName: attacker.name,
            defenseRoll: defenseRoll.roll.total || 100,
            attackRoll: attackRoll.roll.total || 100,
            counterType: "ultimate-vs-ultimate"
          });

          if (counterResponse?.counterAttack) {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: targetActor }),
              content: `<div class="fsr-combat-message result-ultimate">
                <h3 style="margin: 0; font-size: 1rem;">⚡ Ultimate Counter-Attack!</h3>
                <p style="margin: 0.25rem 0; font-size: 0.9rem;"><strong>${targetActor.name}</strong> counters ${attacker.name}'s Ultimate attack!</p>
              </div>`
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            // Find attacker's token to target for counter attack
            const attackerToken = canvas?.tokens?.placeables.find(
              (t: Token) => t.actor?.id === attacker.id
            );

            await executeCombatAttack({
              attacker: targetActor,
              targets: attackerToken ? [attackerToken] : [],
              attackAttribute: "fighting",
              attackType: "melee",
              effectType: "damage",
              powerName: "Ultimate Counter-Attack"
            });

            continue;
          }
        }
      } else if (attackIs100) {
        // Attack is 100, defense is not - attack ALWAYS hits (trumps Red defense)
        attackHit = true;
      } else if (defenseIs100) {
        // Defense is 100, attack is not - defense ALWAYS succeeds + counter (melee only)
        attackHit = false;

        // Offer counter-attack (melee attacks only)
        if (attackType === "melee") {
          const counterResponse = await requestCounterAttackResponse({
            defenderActorId: targetActor.id!,
            defenderTokenId: target.id,
            defenderName: targetActor.name,
            attackerName: attacker.name,
            defenseRoll: defenseRoll.roll.total || 100,
            attackRoll: attackRoll.roll.total || 0,
            counterType: "ultimate-vs-normal"
          });

          if (counterResponse?.counterAttack) {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: targetActor }),
              content: `<div class="fsr-combat-message result-ultimate">
                <h3 style="margin: 0; font-size: 1rem;">⚡ Ultimate Counter-Attack!</h3>
                <p style="margin: 0.25rem 0; font-size: 0.9rem;"><strong>${targetActor.name}</strong> counters ${attacker.name}'s attack!</p>
              </div>`
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            // Find attacker's token to target for counter attack
            const attackerToken = canvas?.tokens?.placeables.find(
              (t: Token) => t.actor?.id === attacker.id
            );

            await executeCombatAttack({
              attacker: targetActor,
              targets: attackerToken ? [attackerToken] : [],
              attackAttribute: "fighting",
              attackType: "melee",
              effectType: "damage",
              powerName: "Ultimate Counter-Attack"
            });

            continue;
          }
        }
      } else if (defenseTier === 3) {
        // Defense is Red (not 100), attack is not 100 - complete defense + counter (melee only)
        attackHit = false;

        // Offer counter-attack (melee attacks only)
        if (attackType === "melee") {
          const counterResponse = await requestCounterAttackResponse({
            defenderActorId: targetActor.id!,
            defenderTokenId: target.id,
            defenderName: targetActor.name,
            attackerName: attacker.name,
            defenseRoll: defenseRoll.roll.total || 0,
            attackRoll: attackRoll.roll.total || 0,
            counterType: "red-vs-normal"
          });

          if (counterResponse?.counterAttack) {
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor: targetActor }),
              content: `<div class="fsr-combat-message result-red">
                <h3 style="margin: 0; font-size: 1rem;">💥 Counter-Attack!</h3>
                <p style="margin: 0.25rem 0; font-size: 0.9rem;"><strong>${targetActor.name}</strong> counters ${attacker.name}'s attack!</p>
              </div>`
            });

            await new Promise(resolve => setTimeout(resolve, 500));

            // Find attacker's token to target for counter attack
            const attackerToken = canvas?.tokens?.placeables.find(
              (t: Token) => t.actor?.id === attacker.id
            );

            await executeCombatAttack({
              attacker: targetActor,
              targets: attackerToken ? [attackerToken] : [],
              attackAttribute: "fighting",
              attackType: "melee",
              effectType: "damage",
              powerName: "Counter-Attack"
            });

            continue;
          }
        }
      } else {
        // Normal defense (Green/Yellow) - Compare tiers first, then roll totals if tied
        if (attackTier > defenseTier) {
          // Attack has higher tier (Red > Yellow > Green > White) - attack wins
          attackHit = true;
        } else if (attackTier < defenseTier) {
          // Defense has higher tier - defense wins
          attackHit = false;
        } else {
          // Same tier - compare roll totals (defense wins if >= attack)
          attackHit = defenseTotal < attackTotal;
        }
      }

      // Build result message with roll card information
      const attackResultText = attackRoll.getResultText();
      const attackResultClass = attackRoll.getResultClass();
      const defenseResultText = defenseRoll?.getResultText() || "Unknown";
      const defenseResultClass = defenseRoll?.getResultClass() || "white";

      // Store combat comparison data for later use in damage card
      combatComparison = {
        attackTotal,
        defenseTotal,
        attackTier,
        defenseTier,
        attackResultText,
        attackResultClass,
        defenseResultText,
        defenseResultClass,
        attackHit
      };
    }

    // Brief delay before next target
    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 5: Calculate and apply damage using hybrid system (skip if power doesn't deal damage)
    if (attackHit && attackData.effectType === "damage") {
      // Get power rank (from attackData or default to attack attribute rank)
      let powerRank = attackData.powerRank || attackRank;
      console.log(
        `[Combat Flow] Starting damage calculation with powerRank: ${formatRankDisplay(powerRank)}, damageRankBump: ${damageRankBump}`
      );

      // Apply damage rank bump if specified (global modifier)
      if (damageRankBump !== 0) {
        powerRank = applyChartShift(powerRank, damageRankBump);
      }

      // Apply per-attack damage rank shift from karma (if using dialog OR preset values)
      let perAttackDamageRankShift = 0;
      let perAttackDamageBonus = 0;

      if (attackData.perAttackKarma) {
        // Preset per-attack karma from combo (passed via attackData)
        perAttackDamageRankShift =
          attackData.perAttackKarma.damageRankShift ?? 0;
        perAttackDamageBonus = attackData.perAttackKarma.damageBonus ?? 0;
      } else if (attackOptions && attackOptions.attackKarmaSettings) {
        // Dialog-based karma settings (single attack or no preset values)
        const karmaIndex = comboIndex ? comboIndex - 1 : 0;
        const attackKarma = attackOptions.attackKarmaSettings[karmaIndex];
        if (attackKarma) {
          perAttackDamageRankShift = attackKarma.damageRankShift ?? 0;
          perAttackDamageBonus = attackKarma.damageBonus ?? 0;
        }
      }

      // Apply per-attack damage rank shift
      if (perAttackDamageRankShift !== 0) {
        powerRank = applyChartShift(powerRank, perAttackDamageRankShift);
      }

      // Calculate damage with tier-based rank reduction
      // Pass ultimate botch flag if defender rolled 1
      const isUltimateBotch =
        defenseResponse &&
        defenseResponse.defenseType === "defend" &&
        defenseResponse._isUltimateBotch === true;

      const damageResult = await calculateDamage(
        attackRoll,
        combatComparison.defenseTier > 0 ? defenseRoll : null,
        powerRank,
        isUltimateBotch,
        sharedBonusRoll // Pass pre-rolled bonus for AOE attacks
      );

      // Apply per-attack flat damage bonus from karma
      if (perAttackDamageBonus > 0) {
        damageResult.damage += perAttackDamageBonus;
      }

      // Build damage modifier display text
      let damageModifiersText = "";
      const modifiers: string[] = [];
      if (damageRankBump !== 0) {
        modifiers.push(
          `Global Bump: ${damageRankBump >= 0 ? "+" : ""}${damageRankBump} CS`
        );
      }
      if (perAttackDamageRankShift !== 0) {
        modifiers.push(
          `Damage CS: ${perAttackDamageRankShift >= 0 ? "+" : ""}${perAttackDamageRankShift} CS`
        );
      }
      if (perAttackDamageBonus > 0) {
        modifiers.push(`Flat Bonus: +${perAttackDamageBonus}`);
      }
      if (modifiers.length > 0) {
        damageModifiersText = `<div style="font-size: 0.75rem; background: #dbeafe; color: #1e40af; padding: 0.15rem 0.4rem; border-radius: 3px; margin: 0.25rem 0;">⚡ Karma Boosts: ${modifiers.join(" • ")}</div>`;
      }

      // Get target's armor rank for armor piercing calculation
      const targetSystem = targetActor.system as any;
      let targetArmorRank: string | undefined;

      // Check for equipped armor items first
      const equippedArmorItems = targetActor.items.filter(
        (item): item is ArmorItem => isArmorItem(item) && item.system.equipped
      );

      if (equippedArmorItems.length > 0) {
        // Use first equipped armor's rank
        targetArmorRank = equippedArmorItems[0].system.rank;
      } else {
        // Fall back to Body Armor power rank
        const bodyArmorPower = (targetSystem.powers || []).find(
          (p: any) =>
            p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor"
        );
        if (bodyArmorPower) {
          targetArmorRank = bodyArmorPower.rank;
        }
      }

      // Check if damage should be deferred (for cumulative combo damage)
      if (attackData.deferDamageApplication) {
        // Accumulate damage instead of applying it immediately
        const existingPendingDamage = pendingDamages.find(
          pd =>
            pd.targetActorId === targetActor.id &&
            pd.targetTokenId === target.id
        );

        if (existingPendingDamage) {
          // Add to existing accumulated damage for this target
          existingPendingDamage.totalDamage += damageResult.damage;
          existingPendingDamage.hits.push({
            damage: damageResult.damage,
            powerName: attackData.powerName,
            comboIndex: comboIndex || 1
          });
        } else {
          // Create new pending damage entry
          pendingDamages.push({
            targetActorId: targetActor.id!,
            targetTokenId: target.id,
            targetName: targetActor.name!,
            totalDamage: damageResult.damage,
            damageType: attackData.damageType,
            armorPiercing: attackData.armorPiercing,
            armorRank: targetArmorRank,
            powerName: attackData.powerName,
            hits: [
              {
                damage: damageResult.damage,
                powerName: attackData.powerName,
                comboIndex: comboIndex || 1
              }
            ]
          });
        }

        // Still show combat result message (but without damage application text)
        console.log(
          `[Combo Damage] Deferred ${damageResult.damage} damage to ${targetActor.name} (cumulative: ${existingPendingDamage ? existingPendingDamage.totalDamage : damageResult.damage})`
        );

        // Build damage deferred text
        const damageApplicationText = `<div style="font-size: 0.8rem; background: #fef3c7; color: #92400e; padding: 0.25rem 0.5rem; border-radius: 3px; margin: 0.25rem 0; font-style: italic;">⏳ Damage accumulated (will apply at end of combo)</div>`;

        // Build damage modifier display text (for deferred damage)
        let damageModifiersText = "";
        const deferredModifiers: string[] = [];
        if (damageRankBump !== 0) {
          deferredModifiers.push(
            `Global Bump: ${damageRankBump >= 0 ? "+" : ""}${damageRankBump} CS`
          );
        }
        if (perAttackDamageRankShift !== 0) {
          deferredModifiers.push(
            `Damage CS: ${perAttackDamageRankShift >= 0 ? "+" : ""}${perAttackDamageRankShift} CS`
          );
        }
        if (perAttackDamageBonus > 0) {
          deferredModifiers.push(`Flat Bonus: +${perAttackDamageBonus}`);
        }
        if (deferredModifiers.length > 0) {
          damageModifiersText = `<div style="font-size: 0.75rem; background: #dbeafe; color: #1e40af; padding: 0.15rem 0.4rem; border-radius: 3px; margin: 0.25rem 0;">⚡ Karma Boosts: ${deferredModifiers.join(" • ")}</div>`;
        }

        // Continue with combat message display (copied from below with damageApplicationText)
        // Build compact defense info
        let defenseInfo = "";
        const isUltimateBotchDefense =
          defenseResponse &&
          defenseResponse.defenseType === "defend" &&
          defenseResponse._isUltimateBotch === true;

        const defendedWithRoll =
          defenseResponse && defenseResponse.defenseType === "defend";

        if (defendedWithRoll && defenseRoll) {
          if (isUltimateBotchDefense) {
            defenseInfo = `<span style="color: #dc2626; font-weight: 600;">ULTIMATE BOTCH! Attack +2 CS</span>`;
          } else if (damageResult.rankReduction > 0) {
            defenseInfo = `reduced ${damageResult.rankReduction} rank${damageResult.rankReduction > 1 ? "s" : ""}`;
          } else if (damageResult.defenseTier === 0) {
            defenseInfo = `no reduction (White defense)`;
          } else {
            defenseInfo = `no reduction`;
          }
        } else {
          defenseInfo = `undefended`;
        }

        const resultText = attackRoll.getResultText();
        const resultClass = attackRoll.getResultClass();

        // Build comparison note if needed
        let comparisonNote = "";
        if (defendedWithRoll) {
          if (combatComparison.attackTier !== combatComparison.defenseTier) {
            comparisonNote = `<div style="font-size: 0.75rem; font-style: italic; margin: 0.25rem 0; background: #f3f4f6; color: #374151; padding: 0.15rem 0.4rem; border-radius: 3px;">${combatComparison.attackTier > combatComparison.defenseTier ? "Attack" : "Defense"} wins (higher tier)</div>`;
          } else if (
            combatComparison.attackTotal === combatComparison.defenseTotal
          ) {
            comparisonNote = `<div style="font-size: 0.75rem; font-style: italic; margin: 0.25rem 0; background: #f3f4f6; color: #374151; padding: 0.15rem 0.4rem; border-radius: 3px;">Tied - Defense succeeds</div>`;
          }
        }

        // Get colors for attack and defense result badges
        const attackColors = getResultColors(
          combatComparison.attackResultClass
        );
        const defenseColors = getResultColors(
          combatComparison.defenseResultClass
        );

        // Build flags object with proper typing
        const combatFlags: FaseripCombatFlags = {
          combatMessage: true,
          damageMessage: true,
          targetId: targetActor.id!,
          damage: damageResult.damage,
          baseRank: damageResult.baseRank,
          reducedRank: damageResult.reducedRank,
          attackTier: damageResult.attackTier,
          defenseTier: damageResult.defenseTier,
          rankReduction: damageResult.rankReduction,
          attackRoll: combatComparison.attackTotal,
          defenseRoll: defendedWithRoll ? combatComparison.defenseTotal : null,
          resultText,
          resultClass,
          powerName,
          damageType: attackData.damageType
        };

        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: attacker }),
          content: `<div class="fsr-combat-message result-${resultClass}">
          <h3 style="margin: 0 0 0.35rem 0; font-size: 0.95rem;">💥 ${powerName || "Attack"} Damage${comboTotal && comboTotal > 1 ? ` (${comboIndex} of ${comboTotal})` : ""} → ${targetActor.name}</h3>
          
          ${
            defendedWithRoll
              ? `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; margin: 0 0 0.35rem 0; font-size: 0.8rem;">
            <div style="text-align: center;">
              <div style="font-weight: 600; background: ${attackColors.background}; color: ${attackColors.color}; padding: 0.15rem 0.4rem; border-radius: 3px;">Attack: ${combatComparison.attackTotal}</div>
              <div class="result-badge ${combatComparison.attackResultClass}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;">${combatComparison.attackResultText} (T${combatComparison.attackTier})</div>
            </div>
            <div style="text-align: center;">
              <div style="font-weight: 600; background: ${defenseColors.background}; color: ${defenseColors.color}; padding: 0.15rem 0.4rem; border-radius: 3px;">Defense: ${combatComparison.defenseTotal}</div>
              <div class="result-badge ${combatComparison.defenseResultClass}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;">${combatComparison.defenseResultText} (T${combatComparison.defenseTier})</div>
            </div>
          </div>
          ${comparisonNote}`
              : `<div style="font-size: 0.8rem; background: #f3f4f6; color: #374151; padding: 0.25rem 0.5rem; border-radius: 3px; margin: 0 0 0.35rem 0; font-style: italic;">${targetActor.name} chose not to defend</div>`
          }
          
          <div style="background: rgba(0,0,0,0.05); padding: 0.35rem; border-radius: 3px; margin: 0.35rem 0;">
            <div style="font-size: 0.8rem; margin-bottom: 0.25rem;"><strong>Base:</strong> ${formatRankDisplay(damageResult.baseRank)} • <strong>Defense:</strong> ${defenseInfo}</div>
            <div style="font-size: 0.8rem; margin-bottom: 0.25rem;"><strong>Final:</strong> ${formatRankDisplay(damageResult.reducedRank)} • <strong>Formula:</strong> ${damageResult.formula}</div>
            <div style="font-size: 1.1rem; background: #fee2e2; color: #991b1b; font-weight: bold; margin-top: 0.25rem; padding: 0.25rem 0.5rem; border-radius: 3px;">
              💥 <strong>${damageResult.damage}</strong> damage
            </div>
            ${damageApplicationText}
          </div>
          
          ${damageModifiersText}
          
          <div style="font-size: 0.75rem; font-style: italic; background: #f9fafb; color: #4b5563; padding: 0.15rem 0.4rem; border-radius: 3px;">${damageResult.description}${attackData.damageType ? ` • ${attackData.damageType}` : ""}</div>
        </div>`,
          flags: {
            faserip: combatFlags
          } as Record<string, unknown>
        });

        // Show bonus damage roll if applicable (Red/Ultimate)
        if (damageResult.bonusRoll) {
          await damageResult.bonusRoll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: attacker }),
            flavor: `<strong>Bonus Damage Roll</strong> (${damageResult.attackTier === 4 ? "Ultimate +5d10" : "Critical +3d6"})`
          });
        }
      } else {
        // Apply damage immediately (normal flow)
        // Apply damage to target actor via socket (executes on target owner's client)
        const damageApplication = await requestDamageApplication(
          targetActor,
          damageResult.damage,
          attackData.damageType,
          attackData.powerName,
          target.id, // Pass token ID for unlinked tokens
          attackData.armorPiercing, // Pass armor piercing rank
          targetArmorRank // Pass target's armor rank
        );

        // Handle case where damage application failed
        if (!damageApplication) {
          console.error(
            "FASERIP Combat | Damage application failed for:",
            targetActor.name,
            "| Damage was:",
            damageResult.damage
          );
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: attacker }),
            content: `<div class="fsr-combat-message" style="background: #fef3c7; border-color: #f59e0b;">
            <p style="color: #92400e; font-weight: 600;">⚠️ Damage application failed for ${targetActor.name}</p>
            <p style="font-size: 0.8rem; color: #78350f;">Check console for details.</p>
          </div>`
          });
          // Continue with chat message even if application failed
        }

        // Build damage application text
        let damageApplicationText = "";
        if (damageApplication) {
          // Check degrading armor setting for display
          const degradingMode =
            (game.settings.get("faserip", "degradingArmor") as string) ??
            "none";

          if (
            damageApplication.armorDamage > 0 &&
            damageApplication.healthDamage > 0
          ) {
            // Show "remaining" for armor based on degradation mode
            let armorText = "";
            if (degradingMode === "none") {
              armorText = `${damageApplication.armorDamage} absorbed by armor`;
            } else if (degradingMode === "per-hit") {
              armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining, -1 per hit)`;
            } else {
              // "full" mode
              armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining)`;
            }
            damageApplicationText = `<div style="font-size: 0.8rem; background: #fef3c7; color: #92400e; padding: 0.25rem 0.5rem; border-radius: 3px; margin: 0.25rem 0;">${armorText}, ${damageApplication.healthDamage} to health (${damageApplication.newHealthValue} remaining)</div>`;
          } else if (damageApplication.armorDamage > 0) {
            // Show "remaining" based on degradation mode
            let armorText = "";
            if (degradingMode === "none") {
              armorText = `${damageApplication.armorDamage} absorbed by armor`;
            } else if (degradingMode === "per-hit") {
              armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining, -1 per hit)`;
            } else {
              // "full" mode
              armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining)`;
            }
            damageApplicationText = `<div style="font-size: 0.8rem; background: #fef3c7; color: #92400e; padding: 0.25rem 0.5rem; border-radius: 3px; margin: 0.25rem 0;">${armorText}</div>`;
          } else if (damageApplication.healthDamage > 0) {
            damageApplicationText = `<div style="font-size: 0.8rem; background: #fee2e2; color: #991b1b; padding: 0.25rem 0.5rem; border-radius: 3px; margin: 0.25rem 0;">${damageApplication.healthDamage} to health (${damageApplication.newHealthValue} remaining)</div>`;
          }
        }

        // Build compact defense info
        let defenseInfo = "";
        const isUltimateBotchDefense =
          defenseResponse &&
          defenseResponse.defenseType === "defend" &&
          defenseResponse._isUltimateBotch === true;

        // Check if defender actually rolled (not takeHit) rather than checking tier
        // This handles botch cases where defenseTier is 0 but they still defended
        const defendedWithRoll =
          defenseResponse && defenseResponse.defenseType === "defend";

        if (defendedWithRoll && defenseRoll) {
          if (isUltimateBotchDefense) {
            defenseInfo = `<span style="color: #dc2626; font-weight: 600;">ULTIMATE BOTCH! Attack +2 CS</span>`;
          } else if (damageResult.rankReduction > 0) {
            defenseInfo = `reduced ${damageResult.rankReduction} rank${damageResult.rankReduction > 1 ? "s" : ""}`;
          } else if (damageResult.defenseTier === 0) {
            defenseInfo = `no reduction (White defense)`;
          } else {
            defenseInfo = `no reduction`;
          }
        } else {
          defenseInfo = `undefended`;
        }

        const resultText = attackRoll.getResultText();
        const resultClass = attackRoll.getResultClass();

        // Build comparison note if needed
        let comparisonNote = "";
        if (defendedWithRoll) {
          if (combatComparison.attackTier !== combatComparison.defenseTier) {
            comparisonNote = `<div style="font-size: 0.75rem; font-style: italic; margin: 0.25rem 0; background: #f3f4f6; color: #374151; padding: 0.15rem 0.4rem; border-radius: 3px;">${combatComparison.attackTier > combatComparison.defenseTier ? "Attack" : "Defense"} wins (higher tier)</div>`;
          } else if (
            combatComparison.attackTotal === combatComparison.defenseTotal
          ) {
            comparisonNote = `<div style="font-size: 0.75rem; font-style: italic; margin: 0.25rem 0; background: #f3f4f6; color: #374151; padding: 0.15rem 0.4rem; border-radius: 3px;">Tied - Defense succeeds</div>`;
          }
        }

        // Get colors for attack and defense result badges
        const attackColors = getResultColors(
          combatComparison.attackResultClass
        );
        const defenseColors = getResultColors(
          combatComparison.defenseResultClass
        );

        // Build flags object with proper typing
        const combatFlags: FaseripCombatFlags = {
          combatMessage: true,
          damageMessage: true,
          targetId: targetActor.id!,
          damage: damageResult.damage,
          baseRank: damageResult.baseRank,
          reducedRank: damageResult.reducedRank,
          attackTier: damageResult.attackTier,
          defenseTier: damageResult.defenseTier,
          rankReduction: damageResult.rankReduction,
          attackRoll: combatComparison.attackTotal,
          defenseRoll: defendedWithRoll ? combatComparison.defenseTotal : null,
          resultText,
          resultClass,
          powerName,
          damageType: attackData.damageType
        };

        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: attacker }),
          content: `<div class="fsr-combat-message result-${resultClass}">
          <h3 style="margin: 0 0 0.35rem 0; font-size: 0.95rem;">💥 ${powerName || "Attack"} Damage${comboTotal && comboTotal > 1 ? ` (${comboIndex} of ${comboTotal})` : ""} → ${targetActor.name}</h3>
          
          ${
            defendedWithRoll
              ? `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; margin: 0 0 0.35rem 0; font-size: 0.8rem;">
            <div style="text-align: center;">
              <div style="font-weight: 600; background: ${attackColors.background}; color: ${attackColors.color}; padding: 0.15rem 0.4rem; border-radius: 3px;">Attack: ${combatComparison.attackTotal}</div>
              <div class="result-badge ${combatComparison.attackResultClass}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;">${combatComparison.attackResultText} (T${combatComparison.attackTier})</div>
            </div>
            <div style="text-align: center;">
              <div style="font-weight: 600; background: ${defenseColors.background}; color: ${defenseColors.color}; padding: 0.15rem 0.4rem; border-radius: 3px;">Defense: ${combatComparison.defenseTotal}</div>
              <div class="result-badge ${combatComparison.defenseResultClass}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;">${combatComparison.defenseResultText} (T${combatComparison.defenseTier})</div>
            </div>
          </div>
          ${comparisonNote}`
              : `<div style="font-size: 0.8rem; background: #f3f4f6; color: #374151; padding: 0.25rem 0.5rem; border-radius: 3px; margin: 0 0 0.35rem 0; font-style: italic;">${targetActor.name} chose not to defend</div>`
          }
          
          <div style="background: rgba(0,0,0,0.05); padding: 0.35rem; border-radius: 3px; margin: 0.35rem 0;">
            <div style="font-size: 0.8rem; margin-bottom: 0.25rem;"><strong>Base:</strong> ${formatRankDisplay(damageResult.baseRank)} • <strong>Defense:</strong> ${defenseInfo}</div>
            <div style="font-size: 0.8rem; margin-bottom: 0.25rem;"><strong>Final:</strong> ${formatRankDisplay(damageResult.reducedRank)} • <strong>Formula:</strong> ${damageResult.formula}</div>
            <div style="font-size: 1.1rem; background: #fee2e2; color: #991b1b; font-weight: bold; margin-top: 0.25rem; padding: 0.25rem 0.5rem; border-radius: 3px;">
              💥 <strong>${damageResult.damage}</strong> damage
            </div>
            ${damageApplicationText}
          </div>
          
          ${damageModifiersText}
          
          <div style="font-size: 0.75rem; font-style: italic; background: #f9fafb; color: #4b5563; padding: 0.15rem 0.4rem; border-radius: 3px;">${damageResult.description}${attackData.damageType ? ` • ${attackData.damageType}` : ""}</div>
        </div>`,
          flags: {
            faserip: combatFlags
          } as Record<string, unknown>
        });

        // Show bonus damage roll if applicable (Red/Ultimate)
        if (damageResult.bonusRoll) {
          await damageResult.bonusRoll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor: attacker }),
            flavor: `<strong>Bonus Damage Roll</strong> (${damageResult.attackTier === 4 ? "Ultimate +5d10" : "Critical +3d6"})`
          });
        }
      } // End of else block for immediate damage application
    } else if (attackHit && attackData.effectType !== "damage") {
      // Non-damaging attack hit - show result message without damage
      const resultText = attackRoll.getResultText();
      const resultClass = attackRoll.getResultClass();

      // Build compact defense info
      const defendedWithRoll =
        defenseResponse && defenseResponse.defenseType === "defend";

      // Get colors for attack and defense result badges
      const attackColors = getResultColors(combatComparison.attackResultClass);
      const defenseColors = getResultColors(
        combatComparison.defenseResultClass
      );

      // Build comparison note if needed
      let comparisonNote = "";
      if (defendedWithRoll) {
        if (combatComparison.attackTier !== combatComparison.defenseTier) {
          comparisonNote = `<div style="font-size: 0.75rem; font-style: italic; margin: 0.25rem 0; background: #f3f4f6; color: #374151; padding: 0.15rem 0.4rem; border-radius: 3px;">${combatComparison.attackTier > combatComparison.defenseTier ? "Attack" : "Defense"} wins (higher tier)</div>`;
        } else if (
          combatComparison.attackTotal === combatComparison.defenseTotal
        ) {
          comparisonNote = `<div style="font-size: 0.75rem; font-style: italic; margin: 0.25rem 0; background: #f3f4f6; color: #374151; padding: 0.15rem 0.4rem; border-radius: 3px;">Tied - Defense succeeds</div>`;
        }
      }

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: `<div class="fsr-combat-message result-${resultClass}">
          <h3 style="margin: 0 0 0.35rem 0; font-size: 0.95rem;">${powerName || "Attack"}${comboTotal && comboTotal > 1 ? ` (${comboIndex} of ${comboTotal})` : ""} → ${targetActor.name}</h3>
          
          ${
            defendedWithRoll
              ? `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem; margin: 0 0 0.35rem 0; font-size: 0.8rem;">
            <div style="text-align: center;">
              <div style="font-weight: 600; background: ${attackColors.background}; color: ${attackColors.color}; padding: 0.15rem 0.4rem; border-radius: 3px;">Attack: ${combatComparison.attackTotal}</div>
              <div class="result-badge ${combatComparison.attackResultClass}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;">${combatComparison.attackResultText} (T${combatComparison.attackTier})</div>
            </div>
            <div style="text-align: center;">
              <div style="font-weight: 600; background: ${defenseColors.background}; color: ${defenseColors.color}; padding: 0.15rem 0.4rem; border-radius: 3px;">Defense: ${combatComparison.defenseTotal}</div>
              <div class="result-badge ${combatComparison.defenseResultClass}" style="padding: 0.15rem 0.4rem; font-size: 0.75rem;">${combatComparison.defenseResultText} (T${combatComparison.defenseTier})</div>
            </div>
          </div>
          ${comparisonNote}`
              : `<div style="font-size: 0.8rem; background: #f3f4f6; color: #374151; padding: 0.25rem 0.5rem; border-radius: 3px; margin: 0 0 0.35rem 0; font-style: italic;">${targetActor.name} chose not to defend</div>`
          }
          
          <div style="background: rgba(0,0,0,0.05); padding: 0.35rem; border-radius: 3px; margin: 0.35rem 0;">
            <div style="font-size: 1rem; background: #dcfce7; color: #166534; font-weight: bold; padding: 0.25rem 0.5rem; border-radius: 3px; text-align: center;">
              ✅ <strong>${resultText} Success!</strong>
            </div>
          </div>
          
          <div style="font-size: 0.75rem; font-style: italic; background: #f9fafb; color: #4b5563; padding: 0.15rem 0.4rem; border-radius: 3px;">Contested roll - no damage dealt</div>
        </div>`
      });
    }
  }

  // Step 4: Show AOE bonus damage roll AFTER all damage cards (if applicable)
  if (sharedBonusRoll && attackData.multiHit) {
    await sharedBonusRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      flavor: `<strong>Bonus Damage Roll (AOE)</strong> (${sharedBonusIsUltimate ? "Ultimate +5d10" : "Critical +3d6"})`
    });
  }

  // Return the attack roll total and any pending damages (for combo accumulation)
  return {
    attackRollTotal: attackTotal,
    pendingDamages: pendingDamages.length > 0 ? pendingDamages : undefined,
    comboBotchCount: newBotchCount
  };
}

/**
 * Apply accumulated pending damages from a combo attack
 * Call this after all combo attacks are complete to apply cumulative damage to armor
 * @param attacker - The attacking actor
 * @param pendingDamages - Array of pending damages accumulated during combo
 */
export async function applyPendingDamages(
  attacker: FaseripActor,
  pendingDamages: PendingDamage[]
): Promise<void> {
  if (!pendingDamages || pendingDamages.length === 0) {
    return;
  }

  // Apply each target's accumulated damage
  for (const pending of pendingDamages) {
    // Find the target actor and token
    // @ts-expect-error - Foundry game.actors collection
    const targetActor = game.actors?.find(
      (a: FaseripActor) => a.id === pending.targetActorId
    ) as FaseripActor | undefined;

    if (!targetActor) {
      console.error(
        "FASERIP Combat | Target actor not found for pending damage:",
        pending.targetActorId
      );
      continue;
    }

    // Apply the total accumulated damage
    const damageApplication = await requestDamageApplication(
      targetActor,
      pending.totalDamage,
      pending.damageType,
      pending.powerName,
      pending.targetTokenId, // Pass token ID for unlinked tokens
      pending.armorPiercing, // Pass armor piercing rank
      pending.armorRank, // Pass target's armor rank
      pending.hits.length // Pass hit count for per-hit degradation
    );

    // Build summary message showing all hits
    const hitsText = pending.hits
      .map(
        hit =>
          `<li>Hit ${hit.comboIndex}: ${hit.damage} damage${hit.powerName ? ` (${hit.powerName})` : ""}</li>`
      )
      .join("");

    // Check degrading armor setting for display
    const degradingMode =
      (game.settings.get("faserip", "degradingArmor") as string) ?? "none";
    const hitCount = pending.hits.length;

    let damageApplicationText = "";
    if (damageApplication) {
      if (
        damageApplication.armorDamage > 0 &&
        damageApplication.healthDamage > 0
      ) {
        // Show "remaining" for armor based on degradation mode
        let armorText = "";
        if (degradingMode === "none") {
          armorText = `${damageApplication.armorDamage} absorbed by armor`;
        } else if (degradingMode === "per-hit") {
          armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining, -${hitCount} from ${hitCount} hit${hitCount !== 1 ? "s" : ""})`;
        } else {
          // "full" mode
          armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining)`;
        }
        damageApplicationText = `<div style="font-size: 0.85rem; background: #fef3c7; color: #92400e; padding: 0.35rem 0.5rem; border-radius: 3px; margin: 0.35rem 0;">${armorText}, ${damageApplication.healthDamage} to health (${damageApplication.newHealthValue} remaining)</div>`;
      } else if (damageApplication.armorDamage > 0) {
        // Show "remaining" based on degradation mode
        let armorText = "";
        if (degradingMode === "none") {
          armorText = `${damageApplication.armorDamage} absorbed by armor`;
        } else if (degradingMode === "per-hit") {
          armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining, -${hitCount} from ${hitCount} hit${hitCount !== 1 ? "s" : ""})`;
        } else {
          // "full" mode
          armorText = `${damageApplication.armorDamage} to armor (${damageApplication.newArmorValue} remaining)`;
        }
        damageApplicationText = `<div style="font-size: 0.85rem; background: #fef3c7; color: #92400e; padding: 0.35rem 0.5rem; border-radius: 3px; margin: 0.35rem 0;">${armorText}</div>`;
      } else if (damageApplication.healthDamage > 0) {
        damageApplicationText = `<div style="font-size: 0.85rem; background: #fee2e2; color: #991b1b; padding: 0.35rem 0.5rem; border-radius: 3px; margin: 0.35rem 0;">${damageApplication.healthDamage} to health (${damageApplication.newHealthValue} remaining)</div>`;
      }
    }

    // Show cumulative damage message
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div class="fsr-combat-message" style="background: #fee2e2; border-color: #dc2626;">
        <h3 style="margin: 0 0 0.5rem 0; color: #991b1b; font-size: 1rem;">💥 Cumulative Combo Damage → ${pending.targetName}</h3>
        
        <div style="background: rgba(0,0,0,0.05); padding: 0.5rem; border-radius: 3px; margin: 0.35rem 0;">
          <div style="font-size: 0.85rem; margin-bottom: 0.35rem; font-weight: 600;">Individual Hits:</div>
          <ul style="margin: 0; padding-left: 1.5rem; font-size: 0.85rem;">
            ${hitsText}
          </ul>
          <div style="font-size: 1.2rem; background: #991b1b; color: #fca5a5; font-weight: bold; margin-top: 0.5rem; padding: 0.35rem 0.5rem; border-radius: 3px; text-align: center;">
            TOTAL: <strong>${pending.totalDamage}</strong> damage to armor
          </div>
          ${damageApplicationText}
        </div>
        
        <div style="font-size: 0.75rem; font-style: italic; background: #f9fafb; color: #4b5563; padding: 0.25rem 0.5rem; border-radius: 3px; margin-top: 0.35rem;">
          All damage from combo attacks applied cumulatively to armor
        </div>
      </div>`
    });

    // Brief delay before next target
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * @deprecated This function is for house rules only
 * Standard FASERIP uses result colors (Red/Yellow/Green/White) to determine effects,
 * not separate damage rolls. Use attack result + power rank instead.
 *
 * Roll damage and show in chat (House Rules Only)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// @ts-expect-error - Deprecated function kept for reference, intentionally unused
async function _rollDamage(
  attacker: FaseripActor,
  target: FaseripActor,
  damageFormula: string,
  damageType?: string
): Promise<void> {
  const damageRoll = await Roll.create(damageFormula);
  await damageRoll.evaluate();

  const damageTotal = damageRoll.total || 0;

  let damageTypeText = "";
  if (damageType && damageType !== "none") {
    damageTypeText = `<p><strong>Damage Type:</strong> ${damageType.charAt(0).toUpperCase() + damageType.slice(1)}</p>`;
  }

  // Build flags object with proper typing
  const damageFlags: FaseripDamageRollFlags = {
    damageRoll: true,
    targetId: target.id!,
    damageType
  };

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: `<div class="fsr-damage-roll">
      <h3 style="margin: 0 0 0.5rem 0; font-size: 1rem;">Damage Roll</h3>
      <p style="margin: 0.25rem 0; font-size: 0.9rem;"><strong>Target:</strong> ${target.name}</p>
      ${damageTypeText.replace("<p>", '<p style="margin: 0.25rem 0; font-size: 0.9rem;">').replace("<strong>", '<strong style="font-size: 0.9rem;">')}
      <p style="margin: 0.25rem 0; font-size: 0.9rem;"><strong>Damage:</strong> <span style="color: #ef4444; font-size: 1.1rem; font-weight: bold;">${damageTotal}</span></p>
      <div class="dice-result" style="margin-top: 0.25rem;">
        <div class="dice-formula" style="font-size: 0.85rem;">${damageFormula}</div>
      </div>
    </div>`,
    rolls: [damageRoll],
    flags: {
      faserip: damageFlags
    } as Record<string, unknown>
  });

  // TODO: Apply damage to target (requires damage application system)
}

/**
 * Quick attack with a specific attribute (for macros/token HUD)
 */
export async function quickAttack(
  actor: FaseripActor,
  attributeName: "fighting" | "agility" | "psyche"
): Promise<void> {
  let attackType: "melee" | "ranged" | "psyche";

  switch (attributeName) {
    case "fighting":
      attackType = "melee";
      break;
    case "agility":
      attackType = "ranged";
      break;
    case "psyche":
      attackType = "psyche";
      break;
  }

  await executeCombatAttack({
    attacker: actor,
    attackAttribute: attributeName,
    attackType,
    effectType: "damage"
  });
}
