<script setup lang="ts">
import { inject, computed, ref, watch } from "vue";
import {
  formatRankDisplay,
  applyChartShift,
  type Rank,
  RollResult
} from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { stringToRank, calculateHealth } from "../../utils";
import { getCharmanService } from "../../charman-service";
import {
  showTalentSelectionDialog,
  showComboDialog
} from "../../applications/dialog-utils";
import type { Talent, Power, Form } from "../../types";
import { executeCombatAttack } from "../../combat/combat-flow";

interface Weapon {
  id: string;
  name: string;
  type: "melee" | "ranged";
  damage: string | number; // CS number for melee (+X), Rank string for ranged
  stat: "fighting" | "agility";
  applicableTalent?: string;
  description?: string;
  equipped?: boolean;
}

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor<"pc" | "npc">;

const forms = computed<Form[]>(() => reactiveActor.system.forms || []);

// Local ref: which form is being viewed/rolled (independent of active combat form)
const viewFormId = ref("");

// Keep viewFormId synced to the active form when it changes externally
watch(
  () => reactiveActor.system.currentFormId,
  id => {
    viewFormId.value = id || forms.value[0]?.id || "";
  },
  { immediate: true }
);

// Also fall back if the viewed form gets deleted
watch(forms, list => {
  if (!list.find(f => f.id === viewFormId.value)) {
    viewFormId.value = list[0]?.id ?? "";
  }
});

const currentForm = computed<Form | undefined>(
  () => forms.value.find(f => f.id === viewFormId.value) ?? forms.value[0]
);

// Computed health max based on current form (recalculated reactively)
const healthMax = computed(() => {
  const form = currentForm.value;
  if (!form) return reactiveActor.system.resources.health.max || 0;
  return calculateHealth(form);
});

const healthValue = computed(
  () => reactiveActor.system.resources.health.value ?? 0
);

const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);
const weapons = computed<Weapon[]>(() => reactiveActor.system.weapons || []);
const powers = computed<Power[]>(() =>
  (reactiveActor.system.powers || []).filter(
    (p: Power) => !p.formIds?.length || p.formIds.includes(viewFormId.value)
  )
);

const weaponsEnabled = computed(
  () => game.settings.get("faserip", "weaponsEnabled") ?? false
);

// Check if MP (Mental Points) system is enabled
const mpEnabled = computed(
  () => game.settings.get("faserip", "mpEnabled") ?? false
);

const armorEnabled = computed(
  () => game.settings.get("faserip", "armorEnabled") ?? false
);

const degradingEnabled = computed(
  () => game.settings.get("faserip", "degradingArmor") ?? false
);

const equippedArmor = computed(() => {
  if (!armorEnabled.value) return null;
  return (
    (reactiveActor.system.armors || []).find((a: any) => a.equipped) ?? null
  );
});

// Body Armor power — always active regardless of the armor setting
const bodyArmorPower = computed(() => {
  const activeFormId = reactiveActor.system.currentFormId;
  return (
    (reactiveActor.system.powers || []).find(
      (p: any) =>
        p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
        (!p.formIds?.length || p.formIds.includes(activeFormId))
    ) ?? null
  );
});

// Damage/Healing
const damageAmount = ref(0);

async function applyDamage() {
  if (damageAmount.value === 0) return;

  let incoming = damageAmount.value;
  const soakSources: string[] = [];
  let equipmentArmorDamaged = false;
  let bodyArmorPowerDamaged = false;

  // Equipped armor soaks first (house rule setting)
  if (equippedArmor.value) {
    const armorSoak = Math.min(incoming, equippedArmor.value.value);
    if (armorSoak > 0) {
      soakSources.push(`${equippedArmor.value.name} –${armorSoak}`);
      incoming = Math.max(0, incoming - armorSoak);

      // Degrade armor if the setting is enabled
      const degradingEnabled =
        game.settings.get("faserip", "degradingArmor") ?? false;
      if (degradingEnabled) {
        equippedArmor.value.value = Math.max(
          0,
          equippedArmor.value.value - armorSoak
        );
        equipmentArmorDamaged = true;
        if (equippedArmor.value.value === 0) {
          ui.notifications?.warn(`${equippedArmor.value.name} is destroyed!`);
        }
      }
    }
  }

  // Body Armor power soaks remainder (always active)
  if (bodyArmorPower.value && incoming > 0) {
    const powerSoak = Math.min(incoming, bodyArmorPower.value.value);
    if (powerSoak > 0) {
      soakSources.push(`${bodyArmorPower.value.name} –${powerSoak}`);
      incoming = Math.max(0, incoming - powerSoak);

      // Degrade Body Armor power if the setting is enabled
      const degradingEnabled =
        game.settings.get("faserip", "degradingArmor") ?? false;
      if (degradingEnabled) {
        bodyArmorPower.value.value = Math.max(
          0,
          bodyArmorPower.value.value - powerSoak
        );
        bodyArmorPowerDamaged = true;
        if (bodyArmorPower.value.value === 0) {
          ui.notifications?.warn(`${bodyArmorPower.value.name} is destroyed!`);
        }
      }
    }
  }

  reactiveActor.system.resources.health.value = Math.max(
    -20,
    healthValue.value - incoming
  );

  if (soakSources.length > 0) {
    // ui.notifications?.info(
    //   `Absorbed: ${soakSources.join(", ")}. ${incoming} damage applied.`
    // );
  }

  // Sync armor changes with Charman if character is linked
  const charmanData = actor.system.charman;
  if (charmanData?.username && charmanData?.characterName) {
    try {
      const service = getCharmanService();

      // Sync equipment armor if damaged
      if (equipmentArmorDamaged && equippedArmor.value) {
        await service.updateEquipmentArmor(
          charmanData.username,
          charmanData.characterName,
          equippedArmor.value.name,
          equippedArmor.value.value
        );
      }

      // Sync Body Armor power if damaged
      if (bodyArmorPowerDamaged && bodyArmorPower.value) {
        await service.updateBodyArmorPower(
          charmanData.username,
          charmanData.characterName,
          bodyArmorPower.value.value
        );
      }
    } catch (error) {
      // Service not initialized or sync failed - ignore silently
      console.warn("Could not sync armor to Charman:", error);
    }
  }

  damageAmount.value = 0;
}

async function applyHealing() {
  if (damageAmount.value === 0) return;

  const newValue = Math.min(
    healthMax.value,
    healthValue.value + damageAmount.value
  );

  // Update reactive actor (base sheet class handles syncing to Foundry actor)
  reactiveActor.system.resources.health.value = newValue;

  damageAmount.value = 0;
}

const faseAttributes = [
  { key: "fighting", label: "Fighting", icon: "⚔️" },
  { key: "agility", label: "Agility", icon: "🏃" },
  { key: "strength", label: "Strength", icon: "💪" },
  { key: "endurance", label: "Endurance", icon: "🛡️" }
];

const ripAttributes = [
  { key: "reasoning", label: "Reasoning", icon: "🧠" },
  { key: "intuition", label: "Intuition", icon: "👁️" },
  { key: "psyche", label: "Psyche", icon: "✨" }
];

const attributes = [...faseAttributes, ...ripAttributes];

async function rollAttribute(attrKey: string, skipTalents: boolean = false) {
  if (!currentForm.value) return;

  const attr = currentForm.value.attributes[attrKey];
  const attrLabel = attributes.find(a => a.key === attrKey)?.label || attrKey;
  const rank = stringToRank(attr.rank);

  // For Fighting and Agility, check for equipped weapon
  if (attrKey === "fighting" || attrKey === "agility") {
    const equippedWeapon = weapons.value.find(w => {
      if (attrKey === "fighting") return w.type === "melee" && w.equipped;
      if (attrKey === "agility") return w.type === "ranged" && w.equipped;
      return false;
    });

    if (equippedWeapon) {
      // Attack with equipped weapon
      await rollWeapon(equippedWeapon);
      return;
    } else if (attrKey === "fighting") {
      // No equipped melee weapon - attack unarmed with Strength damage
      const strengthRank = stringToRank(
        currentForm.value.attributes.strength.rank
      );

      // Show talent selection dialog if talents are available and not skipped
      let talentNames: string[] = [];
      let talentCS = 0;

      if (!skipTalents && talents.value.length > 0) {
        const selectedTalents = await showTalentSelectionDialog(
          talents.value,
          attrLabel
        );

        if (selectedTalents === null) {
          return;
        }

        if (selectedTalents.length > 0) {
          talentNames = selectedTalents.map(t => t.name);
          talentCS = selectedTalents.reduce((sum, t) => sum + t.bonus, 0);
        }
      }

      await executeCombatAttack({
        attacker: actor as any,
        attackAttribute: "fighting",
        attackType: "melee",
        powerName: "Unarmed Strike",
        powerRank: strengthRank,
        damageType: undefined,
        talentNames: talentNames.length > 0 ? talentNames : undefined,
        talentCS: talentCS > 0 ? talentCS : undefined
      });
      return;
    }
    // For Agility with no equipped ranged weapon, fall through to standard roll
  }

  // Standard attribute roll (no combat flow)
  // Show talent selection dialog if talents are available and not skipped
  let totalCS = 0;
  let talentNames: string[] = [];

  if (!skipTalents && talents.value.length > 0) {
    const selectedTalents = await showTalentSelectionDialog(
      talents.value,
      attrLabel
    );

    // User cancelled
    if (selectedTalents === null) {
      return;
    }

    // Calculate total CS from selected talents
    if (selectedTalents.length > 0) {
      talentNames = selectedTalents.map(t => t.name);
      const talentCS = selectedTalents.reduce((sum, t) => sum + t.bonus, 0);
      totalCS += talentCS;
    }
  }

  // All stats go through the combo/karma dialog
  const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

  const comboResult = await showComboDialog(
    attrLabel,
    rank,
    availableKarma,
    talentNames,
    totalCS
  );

  if (comboResult === null) {
    return;
  }

  if (comboResult.comboCount > 1) {
    await FaseripRoll.rollComboAttack(
      attrLabel,
      rank,
      attr.value,
      totalCS,
      comboResult.comboCount,
      actor,
      talentNames,
      undefined,
      comboResult.attackKarmaSettings,
      comboResult.manualChartShift ?? 0
    );
  } else {
    const firstAttackKarma = comboResult.attackKarmaSettings[0];
    await FaseripRoll.rollAttribute(
      attrLabel,
      rank,
      attr.value,
      totalCS,
      actor,
      talentNames,
      undefined,
      firstAttackKarma?.columnShifts ?? 0,
      firstAttackKarma?.resultShift ?? 0,
      false,
      comboResult.manualChartShift ?? 0
    );
  }
}

function formatWeaponDamage(weapon: Weapon): string {
  if (weapon.type === "melee") {
    const cs =
      typeof weapon.damage === "number"
        ? weapon.damage
        : Number(weapon.damage) || 0;
    if (!currentForm.value?.attributes?.strength?.rank) {
      return `Str ${cs > 0 ? "+" : ""}${cs} CS`;
    }
    const strengthRank = stringToRank(
      currentForm.value.attributes.strength.rank
    );
    const finalRank = applyChartShift(strengthRank, cs);
    return formatRankDisplay(finalRank);
  } else {
    return formatRankDisplay(
      typeof weapon.damage === "string" ? weapon.damage : "Typical"
    );
  }
}

async function rollWeapon(weapon: Weapon) {
  if (!currentForm.value) return;

  const attackAttribute = weapon.stat;
  const attackType = weapon.type;
  let damageRank: Rank;

  // Calculate damage based on weapon type
  if (weapon.type === "melee") {
    // Melee: Strength + weapon CS
    const strengthRank = stringToRank(
      currentForm.value.attributes.strength.rank
    );
    const weaponCS =
      typeof weapon.damage === "number"
        ? weapon.damage
        : Number(weapon.damage) || 0;
    damageRank = applyChartShift(strengthRank, weaponCS);
  } else {
    // Ranged: Fixed damage rank
    damageRank = stringToRank(
      typeof weapon.damage === "string" ? weapon.damage : "Typical"
    );
  }

  // Find applicable talent for bonus
  const talentNames: string[] = [];
  let talentCS = 0;
  if (weapon.applicableTalent) {
    const talent = talents.value.find(
      t =>
        t.name.toLowerCase().replace(/[\s_-]+/g, "") ===
        weapon.applicableTalent?.toLowerCase().replace(/[\s_-]+/g, "")
    );
    if (talent) {
      talentNames.push(talent.name);
      talentCS = talent.bonus || 0;
    }
  }

  // Use combat flow system
  await executeCombatAttack({
    attacker: actor as any,
    attackAttribute,
    attackType,
    powerName: weapon.name,
    powerRank: damageRank,
    damageType: undefined,
    talentNames: talentNames.length > 0 ? talentNames : undefined,
    talentCS: talentCS > 0 ? talentCS : undefined
  });
}

async function toggleEquip(weapon: Weapon) {
  if (!reactiveActor.system.weapons) return;

  const weaponIndex = reactiveActor.system.weapons.findIndex(
    (w: Weapon) => w.id === weapon.id
  );
  if (weaponIndex === -1) return;

  const newEquippedState = !weapon.equipped;

  // If equipping, unequip any other weapon of the same type
  if (newEquippedState) {
    reactiveActor.system.weapons.forEach((w: Weapon, idx: number) => {
      if (idx !== weaponIndex && w.type === weapon.type && w.equipped) {
        w.equipped = false;
      }
    });
  }

  // Toggle this weapon's equipped state
  reactiveActor.system.weapons[weaponIndex].equipped = newEquippedState;

  // Persist to actor
  // await actor.update({
  //   "system.weapons": JSON.parse(JSON.stringify(reactiveActor.system.weapons))
  // });
}

async function rollPower(power: any) {
  if (!currentForm.value) return;

  const rank = stringToRank(power.rank);
  const rankValue = power.value || 6;

  // Check MP cost if enabled
  const mpCost = mpEnabled.value && power.mpCost ? power.mpCost : 0;
  if (mpCost > 0) {
    const currentMP = reactiveActor.system.resources?.mentalPoints?.value ?? 0;
    if (currentMP < mpCost) {
      ui.notifications?.error(
        `Not enough Mental Points. Required: ${mpCost}, Available: ${currentMP}`
      );
      return;
    }
  }

  // Initialize CS and talent tracking (quick-roll doesn't show talent dialog)
  let totalCS = 0;
  let talentNames: string[] = [];

  // Route healing powers - must be rolled first
  if (power.effectType === "heal-health" || power.effectType === "heal-armor") {
    // Roll the power (skipMessage: true so we can combine with healing result)
    const faseripRoll = await FaseripRoll.rollAttribute(
      power.name,
      rank,
      rankValue,
      totalCS,
      actor,
      talentNames,
      undefined,
      0,
      0,
      true, // skipMessage - we'll create combined card below
      0
    );

    if (!faseripRoll) return;

    const rollTotal = faseripRoll.roll.total || 0;
    const rollResult = faseripRoll.result;

    // Calculate healing/repair amount based on roll result
    let amount = 0;

    if (rollTotal === 100) {
      const bonusRoll = await Roll.create("5d10");
      await bonusRoll.evaluate();
      amount = power.value + (bonusRoll.total || 0);
      await bonusRoll.toMessage({
        flavor: `${power.name} - Ultimate Critical ${power.effectType === "heal-health" ? "Healing" : "Repair"} Bonus`,
        speaker: ChatMessage.getSpeaker({ actor })
      });
    } else if (rollResult === RollResult.Red) {
      const bonusRoll = await Roll.create("3d6");
      await bonusRoll.evaluate();
      amount = power.value + (bonusRoll.total || 0);
      await bonusRoll.toMessage({
        flavor: `${power.name} - Critical ${power.effectType === "heal-health" ? "Healing" : "Repair"} Bonus`,
        speaker: ChatMessage.getSpeaker({ actor })
      });
    } else if (rollResult === RollResult.Yellow) {
      amount = power.value;
    } else if (rollResult === RollResult.Green) {
      amount = Math.floor(power.value / 2);
    } else {
      // White result - healing failed
      amount = 0;
      await ChatMessage.create({
        content: `<div class="fsr-chat-card fsr-fail">
          <h3>${power.effectType === "heal-health" ? "Healing" : "Repair"} Failed</h3>
          <p><strong>${power.name}</strong> roll failed (White result)!</p>
        </div>`,
        speaker: ChatMessage.getSpeaker({ actor })
      });
    }

    // Build combined roll + healing result card
    const resultText = faseripRoll.getResultText();
    const resultClass = faseripRoll.getResultClass();
    const rollCardContent =
      await foundry.applications.handlebars.renderTemplate(
        "/systems/faserip/templates/chat/roll-card.hbs",
        {
          checkName: power.name,
          resultText,
          resultClass,
          rankDisplay: formatRankDisplay(rank),
          targetValue: rankValue,
          rollTotal: faseripRoll.roll.total,
          chartShift: faseripRoll.chartShift,
          chartShiftText:
            faseripRoll.chartShift !== 0
              ? faseripRoll.chartShift > 0
                ? `+${faseripRoll.chartShift} CS`
                : `${faseripRoll.chartShift} CS`
              : undefined
        }
      );

    // Build healing result section
    let healingResultHtml = "";

    // Apply the healing/repair
    if (power.effectType === "heal-health" && amount > 0) {
      const healthMax = reactiveActor.system.resources.health.max;
      const oldValue = reactiveActor.system.resources.health.value;
      const newValue = Math.min(healthMax, oldValue + amount);
      const actualHealing = newValue - oldValue;

      if (actualHealing > 0) {
        reactiveActor.system.resources.health.value = newValue;
        healingResultHtml = `<div style="background: rgba(34, 197, 94, 0.15); border-left: 3px solid rgb(34, 197, 94); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
          <h4 style="color: rgb(34, 197, 94); margin: 0 0 0.25rem 0; font-size: 1em;">Health Restored</h4>
          <p style="margin: 0.25rem 0;">Healed <strong>${actualHealing}</strong> health.</p>
          <p style="margin: 0.25rem 0; font-size: 0.9em; opacity: 0.8;">Health: ${oldValue} → ${newValue} / ${healthMax}</p>
        </div>`;
        ui.notifications?.info(
          `${power.name}: Healed ${actualHealing} health.`
        );
      } else {
        healingResultHtml = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
          <h4 style="color: rgb(251, 191, 36); margin: 0 0 0.25rem 0; font-size: 1em;">Already Healthy</h4>
          <p style="margin: 0.25rem 0;">Already at full health (${healthMax}).</p>
        </div>`;
        ui.notifications?.warn(`${power.name}: Already at full health.`);
      }
    } else if (power.effectType === "heal-armor" && amount > 0) {
      const bodyArmorPower = (reactiveActor.system.powers || []).find(
        (p: any) =>
          p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
          (!p.formIds?.length ||
            p.formIds.includes(reactiveActor.system.currentFormId))
      );

      if (bodyArmorPower) {
        const maxValue = bodyArmorPower.maxValue || bodyArmorPower.value;
        const oldValue = bodyArmorPower.value;
        const newValue = Math.min(maxValue, oldValue + amount);
        const actualRepair = newValue - oldValue;

        if (actualRepair > 0) {
          bodyArmorPower.value = newValue;
          healingResultHtml = `<div style="background: rgba(59, 130, 246, 0.15); border-left: 3px solid rgb(59, 130, 246); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
            <h4 style="color: rgb(59, 130, 246); margin: 0 0 0.25rem 0; font-size: 1em;">Body Armor Repaired</h4>
            <p style="margin: 0.25rem 0;">Repaired <strong>${actualRepair}</strong> armor.</p>
            <p style="margin: 0.25rem 0; font-size: 0.9em; opacity: 0.8;">Body Armor: ${oldValue} → ${newValue} / ${maxValue}</p>
          </div>`;
          ui.notifications?.info(
            `${power.name}: Repaired ${actualRepair} Body Armor.`
          );

          // Sync with Charman if character is linked
          const charmanData = actor.system.charman;
          if (charmanData?.username && charmanData?.characterName) {
            try {
              const service = getCharmanService();
              await service.updateBodyArmorPower(
                charmanData.username,
                charmanData.characterName,
                bodyArmorPower.value
              );
            } catch (error) {
              console.warn(
                "Could not sync Body Armor repair to Charman:",
                error
              );
            }
          }
        } else {
          healingResultHtml = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
            <h4 style="color: rgb(251, 191, 36); margin: 0 0 0.25rem 0; font-size: 1em;">Armor Already Full</h4>
            <p style="margin: 0.25rem 0;">Body Armor already at maximum (${maxValue}).</p>
          </div>`;
          ui.notifications?.warn(`${power.name}: Body Armor already at full.`);
        }
      } else {
        healingResultHtml = `<div style="background: rgba(239, 68, 68, 0.15); border-left: 3px solid rgb(239, 68, 68); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
          <h4 style="color: rgb(239, 68, 68); margin: 0 0 0.25rem 0; font-size: 1em;">No Body Armor Found</h4>
          <p style="margin: 0.25rem 0;">No Body Armor power found to heal.</p>
        </div>`;
        ui.notifications?.warn(
          `${power.name}: No Body Armor power found to heal.`
        );
      }
    }

    // Create combined chat message with roll + healing result
    const combinedContent = `<div>${rollCardContent}${healingResultHtml}</div>`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: combinedContent,
      rolls: [faseripRoll.roll]
    });

    // Deduct MP
    if (mpCost > 0) {
      const currentMP = reactiveActor.system.resources.mentalPoints.value;
      reactiveActor.system.resources.mentalPoints.value = Math.max(
        0,
        currentMP - mpCost
      );
    }

    return;
  }

  // Route attack-type damage powers through combat flow
  if (
    power.effectType === "damage" &&
    (power.attackType === "melee" || power.attackType === "ranged")
  ) {
    // Determine attack attribute based on type
    let attackAttribute: "fighting" | "agility";
    let attackType: "melee" | "ranged";

    if (power.attackType === "melee") {
      attackAttribute = "fighting";
      attackType = "melee";
    } else {
      attackAttribute = "agility";
      attackType = "ranged";
    }

    // Use combat flow system
    await executeCombatAttack({
      attacker: actor as any,
      attackAttribute,
      attackType,
      powerName: power.name,
      powerRank: rank, // Pass the power's rank for damage calculation
      damageRoll: `1d${rankValue}`, // Simple damage based on power rank value
      damageType: power.damageType !== "none" ? power.damageType : undefined
    });

    // Deduct MP after successful attack
    if (mpCost > 0) {
      const currentMP = reactiveActor.system.resources.mentalPoints.value;
      reactiveActor.system.resources.mentalPoints.value = Math.max(
        0,
        currentMP - mpCost
      );

      await actor.update({
        system: {
          resources: {
            mentalPoints: {
              value: reactiveActor.system.resources.mentalPoints!.value
            }
          }
        }
      });

      // Sync MP with Charman if character is linked
      const charmanData = actor.system.charman;
      if (charmanData?.username && charmanData?.characterName) {
        try {
          const service = getCharmanService();
          await service.updateMP(
            charmanData.username,
            charmanData.characterName,
            reactiveActor.system.resources.mentalPoints.value
          );
        } catch (error) {
          console.warn("Could not sync MP to Charman:", error);
        }
      }
    }

    return; // Exit early - combat flow handles everything
  }

  // totalCS and talentNames already declared above

  if (!power.skipDialogs) {
    // Talent selection
    if (talents.value.length > 0) {
      const selectedTalents = await showTalentSelectionDialog(
        talents.value,
        power.name
      );

      if (selectedTalents === null) {
        return;
      }

      if (selectedTalents.length > 0) {
        talentNames = selectedTalents.map(t => t.name);
        const talentCS = selectedTalents.reduce((sum, t) => sum + t.bonus, 0);
        totalCS += talentCS;
      }
    }
  }
  const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

  const comboResult = await showComboDialog(
    power.name,
    rank,
    availableKarma,
    talentNames,
    totalCS
  );

  if (comboResult === null) {
    return;
  }

  if (comboResult.comboCount > 1) {
    await FaseripRoll.rollComboAttack(
      power.name,
      rank,
      rankValue,
      totalCS,
      comboResult.comboCount,
      actor,
      talentNames,
      undefined,
      comboResult.attackKarmaSettings,
      comboResult.manualChartShift ?? 0
    );
  } else {
    const firstAttackKarma = comboResult.attackKarmaSettings[0];
    await FaseripRoll.rollAttribute(
      power.name,
      rank,
      rankValue,
      totalCS,
      actor,
      talentNames,
      undefined,
      firstAttackKarma?.columnShifts ?? 0,
      firstAttackKarma?.resultShift ?? 0,
      false,
      comboResult.manualChartShift ?? 0
    );
  }

  // Deduct MP after successful roll
  if (mpCost > 0) {
    const currentMP = reactiveActor.system.resources.mentalPoints.value;
    reactiveActor.system.resources.mentalPoints.value = Math.max(
      0,
      currentMP - mpCost
    );

    // Persist to actor
    // await actor.update({
    //   system: {
    //     resources: {
    //       mentalPoints: {
    //         value: reactiveActor.system.resources.mentalPoints!.value
    //       }
    //     }
    //   }
    // });

    // Sync MP with Charman if character is linked
    const charmanData = actor.system.charman;
    if (charmanData?.username && charmanData?.characterName) {
      try {
        const service = getCharmanService();
        await service.updateMP(
          charmanData.username,
          charmanData.characterName,
          reactiveActor.system.resources.mentalPoints.value
        );
      } catch (error) {
        // Service not initialized or sync failed - ignore silently
        console.warn("Could not sync MP to Charman:", error);
      }
    }
  }
}
</script>

<template>
  <div v-if="currentForm">
    <!-- Form View Selector (only shown when multiple forms exist) -->
    <div v-if="forms.length > 1" class="mb-3 flex gap-1 flex-wrap">
      <button
        v-for="form in forms"
        :key="form.id"
        @click="viewFormId = form.id"
        :class="[
          'fsr-btn fsr-btn-sm text-xs px-3 py-1',
          viewFormId === form.id
            ? 'fsr-btn-primary'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        ]"
      >
        <span v-if="form.isPrimary" class="mr-1 text-yellow-400">★</span
        >{{ form.name }}
      </button>
    </div>

    <!-- Damage/Healing Section -->
    <div class="mb-4 p-3 bg-gray-800 rounded border border-gray-700">
      <h3 class="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wider">
        Health Management
      </h3>
      <!-- Equipped armor / body armor power indicator -->
      <div
        v-if="bodyArmorPower || equippedArmor"
        class="mb-2 flex flex-wrap gap-3 text-xs text-green-400"
      >
        <span v-if="bodyArmorPower" class="flex items-center gap-1">
          🦾 <span>{{ bodyArmorPower.name }}</span>
          <span class="fsr-rank-badge">{{ bodyArmorPower.rank }}</span>
          <span v-if="degradingEnabled"
            >absorbs {{ bodyArmorPower.value }}/{{
              bodyArmorPower.maxValue || bodyArmorPower.value
            }}</span
          >
          <span v-else>absorbs {{ bodyArmorPower.value }}</span>
        </span>
        <span v-if="equippedArmor" class="flex items-center gap-1">
          🛡️ <span>{{ equippedArmor.name }}</span>
          <span class="fsr-rank-badge">{{ equippedArmor.rank }}</span>
          <span v-if="degradingEnabled"
            >absorbs {{ equippedArmor.value }}/{{
              equippedArmor.maxValue || equippedArmor.value
            }}</span
          >
          <span v-else>absorbs {{ equippedArmor.value }}</span>
        </span>
      </div>
      <div class="flex gap-2 items-center">
        <input
          type="number"
          v-model.number="damageAmount"
          :min="0"
          class="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white"
          placeholder="Amount"
        />
        <button
          @click="applyDamage"
          :disabled="damageAmount <= 0"
          class="fsr-btn fsr-btn-danger px-4 py-2"
          :class="{ 'opacity-50 cursor-not-allowed': damageAmount <= 0 }"
        >
          💔 Damage
        </button>
        <button
          @click="applyHealing"
          :disabled="damageAmount <= 0"
          class="fsr-btn fsr-btn-success px-4 py-2"
          :class="{ 'opacity-50 cursor-not-allowed': damageAmount <= 0 }"
        >
          💚 Heal
        </button>
      </div>
      <div
        class="mt-2 text-xs"
        :class="healthValue < 0 ? 'text-red-400 font-bold' : 'text-gray-400'"
      >
        Current Health: {{ healthValue }} / {{ healthMax }}
        <span v-if="healthValue < 0" class="ml-2 text-red-500">
          (Dying/Unconscious)
        </span>
      </div>
    </div>

    <!-- Two Column Layout: Stats (8/12) and Weapons/Powers (4/12) -->
    <div class="flex gap-3">
      <!-- Left Column: FASE and RIP Stats -->
      <div class="basis-8/12">
        <!-- PHYSICAL Group -->
        <div class="mb-3">
          <h3
            class="text-sm font-bold text-red-400 mb-2 uppercase tracking-wider"
          >
            PHYSICAL
          </h3>
          <div class="fsr-grid fsr-grid-2">
            <div
              v-for="attr in faseAttributes"
              :key="attr.key"
              class="fsr-stat"
            >
              <div class="flex justify-between items-start mb-1">
                <div>
                  <div class="fsr-stat-name">
                    {{ attr.icon }} {{ attr.label }}
                  </div>
                  <div class="fsr-stat-rank">
                    {{
                      formatRankDisplay(currentForm.attributes[attr.key].rank)
                    }}
                  </div>
                </div>
                <div class="fsr-stat-value">
                  {{ currentForm.attributes[attr.key].value }}
                </div>
              </div>

              <button
                @click="rollAttribute(attr.key)"
                class="fsr-roll-btn w-full mt-1"
              >
                🎲 {{ attr.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- MENTAL Group -->
        <div class="mb-3">
          <h3
            class="text-sm font-bold text-blue-400 mb-2 uppercase tracking-wider"
          >
            MENTAL
          </h3>
          <div class="fsr-grid fsr-grid-3">
            <div v-for="attr in ripAttributes" :key="attr.key" class="fsr-stat">
              <div class="flex justify-between items-start mb-1">
                <div>
                  <div class="fsr-stat-name">
                    {{ attr.icon }} {{ attr.label }}
                  </div>
                  <div class="fsr-stat-rank">
                    {{
                      formatRankDisplay(currentForm.attributes[attr.key].rank)
                    }}
                  </div>
                </div>
                <div class="fsr-stat-value">
                  {{ currentForm.attributes[attr.key].value }}
                </div>
              </div>

              <button
                @click="rollAttribute(attr.key)"
                class="fsr-roll-btn w-full mt-1"
              >
                🎲 {{ attr.label }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column: Weapons and Powers -->
      <div class="basis-4/12">
        <!-- WEAPONS Quick-Roll Section -->
        <div v-if="weaponsEnabled && weapons.length > 0" class="mb-3">
          <h3
            class="text-sm font-bold text-orange-400 mb-2 uppercase tracking-wider"
          >
            WEAPONS
          </h3>
          <div class="flex flex-col gap-2">
            <div
              v-for="weapon in weapons"
              :key="weapon.id"
              class="flex items-center gap-2"
            >
              <button
                @click="rollWeapon(weapon)"
                class="fsr-btn fsr-btn-secondary text-xs px-3 py-1 text-left flex-1"
                :title="`${weapon.name} (${formatWeaponDamage(weapon)}) - ${weapon.stat.toUpperCase()}${
                  weapon.applicableTalent ? ` + ${weapon.applicableTalent}` : ''
                }`"
              >
                {{ weapon.type === "melee" ? "⚔️" : "🏹" }} {{ weapon.name }}
                <span class="ml-1 fsr-rank-badge text-xs">{{
                  formatWeaponDamage(weapon)
                }}</span>
              </button>
              <button
                @click="toggleEquip(weapon)"
                class="text-xs px-2 py-1 rounded"
                :class="[
                  weapon.equipped
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
                ]"
                :title="weapon.equipped ? 'Equipped' : 'Equip'"
              >
                {{ weapon.equipped ? "✓" : "○" }}
              </button>
            </div>
          </div>
        </div>

        <!-- POWERS Quick-Roll Section -->
        <div v-if="powers.length > 0" class="mb-3">
          <h3
            class="text-sm font-bold text-purple-400 mb-2 uppercase tracking-wider"
          >
            POWERS
          </h3>
          <div class="flex flex-col gap-2">
            <button
              v-for="power in powers"
              :key="power.id"
              @click="rollPower(power)"
              class="fsr-btn fsr-btn-secondary text-xs px-3 py-1 text-left"
              :title="`${power.name} (${formatRankDisplay(power.rank)})${
                mpEnabled && power.mpCost ? ` - MP Cost: ${power.mpCost}` : ''
              }`"
            >
              ⚡ {{ power.name }}
              <span
                v-if="mpEnabled && power.mpCost"
                class="ml-1 text-yellow-400"
              >
                ({{ power.mpCost }} MP)
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
