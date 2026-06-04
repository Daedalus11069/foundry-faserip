<script setup lang="ts">
import { inject, computed, ref } from "vue";
import { formatRankDisplay, RANK_ORDER, RollResult } from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { executeCombatAttack } from "../../combat/combat-flow";
import { stringToRank, getRankValue } from "../../utils";
import { getCharmanService } from "../../charman-service";
import {
  showTalentSelectionDialog,
  showComboDialog
} from "../../applications/dialog-utils";
import type { Talent } from "../../types";
import type { ReactiveActorData, PowerData } from "../../types/actor-system";
import type { FaseripActor } from "../../documents";

const reactiveActor = inject("reactiveActor") as ReactiveActorData;
const actor = inject("actor") as FaseripActor;

const powers = computed(() => reactiveActor.system.powers || []);
const forms = computed(() => reactiveActor.system.forms || []);
const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);

// Form filter: '' = show all forms, otherwise show only matching
const filterFormId = ref("");

const filteredPowers = computed(() => {
  const all = powers.value;
  if (!filterFormId.value) return all;
  return all.filter(
    p =>
      !p.formIds ||
      p.formIds.length === 0 ||
      p.formIds.includes(filterFormId.value)
  );
});

// Which power has its form-assignment panel open
const expandedFormPanel = ref<string | null>(null);

function toggleFormPanel(powerId: string) {
  expandedFormPanel.value =
    expandedFormPanel.value === powerId ? null : powerId;
}

function togglePowerForm(power: PowerData, formId: string) {
  if (!power.formIds) power.formIds = [];
  const idx = power.formIds.indexOf(formId);
  if (idx === -1) {
    power.formIds.push(formId);
  } else {
    power.formIds.splice(idx, 1);
  }
}

// Check if MP (Mental Points) system is enabled
const mpEnabled = computed(
  () => game.settings.get("faserip", "mpEnabled") ?? false
);

// Check if degrading armor is enabled
const degradingEnabled = computed(
  () => game.settings.get("faserip", "degradingArmor") ?? false
);

function addPower() {
  if (!reactiveActor.system.powers) {
    reactiveActor.system.powers = [];
  }

  const newPower: PowerData = {
    id: crypto.randomUUID(),
    name: "New Power",
    rank: "typical",
    category: "general",
    value: 6, // Typical rank value
    maxValue: 6, // Initialize maxValue
    formIds: [],
    effectType: "none",
    attackType: "none",
    damageType: "none",
    resistanceType: undefined,
    vulnerabilityType: undefined
  };
  reactiveActor.system.powers.push(newPower);
}

function removePower(index: number) {
  reactiveActor.system.powers.splice(index, 1);
}

function isBodyArmor(power: PowerData): boolean {
  return power.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor";
}

async function repairPower(power: PowerData) {
  const maxValue = power.maxValue || power.value;
  const currentDamage = maxValue - power.value;

  if (currentDamage <= 0) return;

  // @ts-expect-error - DialogV2 path not fully typed
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Repair ${power.name}` },
    content: `
      <form>
        <div class="form-group">
          <label>Repair Amount (Current: ${power.value}/${maxValue}, Damage: ${currentDamage})</label>
          <input type="number" name="amount" value="${currentDamage}" min="1" max="${currentDamage}" autofocus />
        </div>
      </form>
    `,
    modal: true,
    rejectClose: false,
    ok: {
      label: "Repair",
      callback: (_event: any, button: any, _dialog: any) => {
        const form = button.form;
        return new FormDataExtended(form).object;
      }
    }
  });

  if (result && result.amount) {
    const repairAmount = Math.min(
      Math.max(1, Number(result.amount)),
      currentDamage
    );
    power.value = Math.min(maxValue, power.value + repairAmount);

    // Sync Body Armor power repair with Charman if character is linked and this is Body Armor
    if (isBodyArmor(power)) {
      // @ts-expect-error - charman property exists on system
      const charmanData = actor.system.charman;
      if (charmanData?.username && charmanData?.characterName) {
        try {
          const service = getCharmanService();
          await service.updateBodyArmorPower(
            charmanData.username,
            charmanData.characterName,
            power.value
          );
        } catch (error) {
          // Service not initialized or sync failed - ignore silently
          console.warn("Could not sync Body Armor repair to Charman:", error);
        }
      }
    }
  }
}

function onPowerRankChange(power: PowerData, rank: string) {
  power.rank = rank;
  const newValue = getRankValue(rank);
  power.value = newValue;
  power.maxValue = newValue;
}

/*
// Legacy power rolling function - replaced by combat flow system
// Kept for reference but not currently used
async function _rollPower(power: PowerData) {
  const rank = stringToRank(power.rank);
  const value = power.value || 6;

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

  // Route ALL attack powers (damage or contested) through combat flow
  // Only powers with attackType "none" skip combat flow
  if (power.attackType && power.attackType !== "none") {
    // Determine attack attribute based on power settings
    let attackAttribute: "fighting" | "agility" | "psyche";
    let attackType: "melee" | "ranged" | "psyche";

    if (power.attackType === "melee") {
      attackAttribute = "fighting";
      attackType = "melee";
    } else if (power.attackType === "psyche") {
      attackAttribute = "psyche";
      attackType = "psyche";
    } else {
      // Default to ranged for all other attack types (blast, area, etc.)
      attackAttribute = "agility";
      attackType = "ranged";
    }

    // Use combat flow system - handles attack/defense and damage if applicable
    await executeCombatAttack({
      attacker: actor,
      attackAttribute,
      attackType,
      effectType: power.effectType || "none",
      powerName: power.name,
      powerRank: rank, // Pass the power's rank for damage calculation
      damageRoll: `1d${value}`, // Simple damage based on power rank value
      damageType: power.damageType !== "none" ? power.damageType : undefined,
      multiHit: power.multiHit || false // Pass multiHit flag for AoE powers
    });

    // Deduct MP after successful attack
    if (mpCost > 0 && reactiveActor.system.resources.mentalPoints) {
      const mentalPoints = reactiveActor.system.resources.mentalPoints;
      mentalPoints.value = Math.max(0, mentalPoints.value - mpCost);

      await actor.update({
        system: {
          resources: {
            mentalPoints: {
              value: reactiveActor.system.resources.mentalPoints.value
            }
          }
        }
      });

      // Sync MP with Charman if character is linked
      // @ts-expect-error - charman property exists on system
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

  let totalCS = 0;
  let talentNames: string[] = [];

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

  // Karma/chart shift dialog — shown for all power rolls
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

  let faseripRoll: any = null; // Store roll result for healing calculations

  if (comboResult.comboCount > 1) {
    await FaseripRoll.rollComboAttack(
      power.name,
      rank,
      value,
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
    faseripRoll = await FaseripRoll.rollAttribute(
      power.name,
      rank,
      value,
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
  if (mpCost > 0 && reactiveActor.system.resources.mentalPoints) {
    const mentalPoints = reactiveActor.system.resources.mentalPoints;
    mentalPoints.value = Math.max(0, mentalPoints.value - mpCost);

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
    // @ts-expect-error - charman property exists on system
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

  // Apply power effect (healing only - damage goes through combat flow)
  if ((power.effectType || "none") !== "none") {
    // @ts-expect-error - game.user.targets is a Set, but TypeScript doesn't know that
    const targets = Array.from(game.user?.targets || []);

    // Determine who to apply effects to
    let applyToSelf = false;
    let applyToTargets = targets.length > 0;

    // Healing can be used on self if no targets
    if (!applyToTargets) {
      applyToSelf = true;
    }

    // Apply to targeted actors
    if (applyToTargets) {
      for (const token of targets) {
        // @ts-expect-error - token.actor can be null, but we'll skip if it is
        const targetActor = token.actor;
        if (!targetActor) continue;

        if (power.effectType === "heal-health") {
          // Calculate healing based on roll result
          let healAmount = power.value;

          if (faseripRoll) {
            const rollTotal = faseripRoll.roll.total || 0;
            const rollResult = faseripRoll.result;

            if (rollTotal === 100) {
              const bonusRoll = await Roll.create("5d10");
              await bonusRoll.evaluate();
              healAmount = power.value + (bonusRoll.total || 0);
              await bonusRoll.toMessage({
                flavor: `${power.name} - Ultimate Critical Healing Bonus`,
                speaker: ChatMessage.getSpeaker({ actor: actor as any })
              });
            } else if (rollResult === RollResult.Red) {
              const bonusRoll = await Roll.create("3d6");
              await bonusRoll.evaluate();
              healAmount = power.value + (bonusRoll.total || 0);
              await bonusRoll.toMessage({
                flavor: `${power.name} - Critical Healing Bonus`,
                speaker: ChatMessage.getSpeaker({ actor: actor as any })
              });
            } else if (rollResult === RollResult.Yellow) {
              healAmount = power.value;
            } else if (rollResult === RollResult.Green) {
              healAmount = Math.floor(power.value / 2);
            } else {
              healAmount = 0;
              await ChatMessage.create({
                content: `<div class="fsr-chat-card fsr-fail">
                  <h3>Healing Failed</h3>
                  <p><strong>${power.name}</strong> healing roll failed (White result)!</p>
                </div>`,
                speaker: ChatMessage.getSpeaker({ actor: actor as any })
              });
            }
          }

          await applyHealthHealingToTarget(targetActor, healAmount, power.name);
        } else if (power.effectType === "heal-armor") {
          // Calculate armor repair based on roll result
          let repairAmount = power.value;

          if (faseripRoll) {
            const rollTotal = faseripRoll.roll.total || 0;
            const rollResult = faseripRoll.result;

            if (rollTotal === 100) {
              const bonusRoll = await Roll.create("5d10");
              await bonusRoll.evaluate();
              repairAmount = power.value + (bonusRoll.total || 0);
              await bonusRoll.toMessage({
                flavor: `${power.name} - Ultimate Critical Repair Bonus`,
                speaker: ChatMessage.getSpeaker({ actor: actor as any })
              });
            } else if (rollResult === RollResult.Red) {
              const bonusRoll = await Roll.create("3d6");
              await bonusRoll.evaluate();
              repairAmount = power.value + (bonusRoll.total || 0);
              await bonusRoll.toMessage({
                flavor: `${power.name} - Critical Repair Bonus`,
                speaker: ChatMessage.getSpeaker({ actor: actor as any })
              });
            } else if (rollResult === RollResult.Yellow) {
              repairAmount = power.value;
            } else if (rollResult === RollResult.Green) {
              repairAmount = Math.floor(power.value / 2);
            } else {
              repairAmount = 0;
              await ChatMessage.create({
                content: `<div class="fsr-chat-card fsr-fail">
                  <h3>Repair Failed</h3>
                  <p><strong>${power.name}</strong> repair roll failed (White result)!</p>
                </div>`,
                speaker: ChatMessage.getSpeaker({ actor: actor as any })
              });
            }
          }

          await applyArmorHealingToTarget(
            targetActor,
            repairAmount,
            power.name
          );
        }
      }
    }

    // Apply to self
    if (applyToSelf) {
      if (power.effectType === "heal-health") {
        // Calculate healing based on roll result
        let healAmount = power.value;

        if (faseripRoll) {
          const rollTotal = faseripRoll.roll.total || 0;
          const rollResult = faseripRoll.result;

          if (rollTotal === 100) {
            const bonusRoll = await Roll.create("5d10");
            await bonusRoll.evaluate();
            healAmount = power.value + (bonusRoll.total || 0);
            await bonusRoll.toMessage({
              flavor: `${power.name} - Ultimate Critical Healing Bonus`,
              speaker: ChatMessage.getSpeaker({ actor: actor as any })
            });
          } else if (rollResult === RollResult.Red) {
            const bonusRoll = await Roll.create("3d6");
            await bonusRoll.evaluate();
            healAmount = power.value + (bonusRoll.total || 0);
            await bonusRoll.toMessage({
              flavor: `${power.name} - Critical Healing Bonus`,
              speaker: ChatMessage.getSpeaker({ actor: actor as any })
            });
          } else if (rollResult === RollResult.Yellow) {
            healAmount = power.value;
          } else if (rollResult === RollResult.Green) {
            healAmount = Math.floor(power.value / 2);
          } else {
            healAmount = 0;
            await ChatMessage.create({
              content: `<div class="fsr-chat-card fsr-fail">
                <h3>Healing Failed</h3>
                <p><strong>${power.name}</strong> healing roll failed (White result)!</p>
              </div>`,
              speaker: ChatMessage.getSpeaker({ actor: actor as any })
            });
          }
        }

        await applyHealthHealingToTarget(actor, healAmount, power.name);
      } else if (power.effectType === "heal-armor") {
        // Calculate armor repair based on roll result
        let repairAmount = power.value;

        if (faseripRoll) {
          const rollTotal = faseripRoll.roll.total || 0;
          const rollResult = faseripRoll.result;

          if (rollTotal === 100) {
            const bonusRoll = await Roll.create("5d10");
            await bonusRoll.evaluate();
            repairAmount = power.value + (bonusRoll.total || 0);
            await bonusRoll.toMessage({
              flavor: `${power.name} - Ultimate Critical Repair Bonus`,
              speaker: ChatMessage.getSpeaker({ actor: actor as any })
            });
          } else if (rollResult === RollResult.Red) {
            const bonusRoll = await Roll.create("3d6");
            await bonusRoll.evaluate();
            repairAmount = power.value + (bonusRoll.total || 0);
            await bonusRoll.toMessage({
              flavor: `${power.name} - Critical Repair Bonus`,
              speaker: ChatMessage.getSpeaker({ actor: actor as any })
            });
          } else if (rollResult === RollResult.Yellow) {
            repairAmount = power.value;
          } else if (rollResult === RollResult.Green) {
            repairAmount = Math.floor(power.value / 2);
          } else {
            repairAmount = 0;
            await ChatMessage.create({
              content: `<div class="fsr-chat-card fsr-fail">
                <h3>Repair Failed</h3>
                <p><strong>${power.name}</strong> repair roll failed (White result)!</p>
              </div>`,
              speaker: ChatMessage.getSpeaker({ actor: actor as any })
            });
          }
        }

        await applyArmorHealingToTarget(actor, repairAmount, power.name);
      }
    }
  }
}
*/

// Helper function to apply damage to a target (currently unused - entire function commented out)
/*
async function applyDamageToTarget(
  targetActor: any,
  damageAmount: number,
  powerName: string,
  attackType: string,
  skipDodge: boolean = false,
  damageType: string = "none"
) {
  // Skip dodge prompt if already handled in rollPower
  if (!skipDodge) {
    // Determine dodge attribute based on attack type
    let dodgeAttribute: "agility" | "fighting" | null = null;
    if (attackType === "ranged") {
      dodgeAttribute = "agility";
    } else if (attackType === "melee") {
      dodgeAttribute = "fighting";
    }

    // Prompt for dodge if attack type is specified
    if (dodgeAttribute) {
      const dodgeRank =
        targetActor.system.attributes[dodgeAttribute]?.rank || "typical";
      const dodgeValue =
        targetActor.system.attributes[dodgeAttribute]?.value || 6;

      // @ts-expect-error - DialogV2 path not fully typed
      const dodgeAttempt = await foundry.applications.api.DialogV2.confirm({
        window: { title: `Dodge ${powerName}?` },
        content: `<p><strong>${targetActor.name}</strong> is targeted by <strong>${powerName}</strong> (${attackType} attack).</p>
                <p>Attempt to dodge using <strong>${dodgeAttribute.charAt(0).toUpperCase() + dodgeAttribute.slice(1)}</strong> (${formatRankDisplay(dodgeRank)} / ${dodgeValue})?</p>`,
        modal: true,
        rejectClose: false,
        yes: { label: "Dodge", icon: "fa-solid fa-person-running" },
        no: { label: "Don't Dodge", icon: "fa-solid fa-xmark" }
      });

      if (dodgeAttempt) {
        // Roll dodge
        await FaseripRoll.rollAttribute(
          `Dodge ${powerName}`,
          dodgeRank,
          dodgeValue,
          0,
          targetActor,
          [],
          undefined,
          0,
          0,
          false,
          0
        );

        ui.notifications?.info(
          `${targetActor.name} attempts to dodge! Check the chat for the result.`
        );

        // For now, GM must manually decide if dodge succeeded
        // Future enhancement: compare dodge roll to attack roll
        return;
      }
    }
  }

  // Check for damage type resistance
  if (damageType && damageType !== "none") {
    const resistancePower = (targetActor.system.powers || []).find(
      (p: any) =>
        p.resistanceType === damageType &&
        (!p.formIds?.length ||
          p.formIds.includes(targetActor.system.currentFormId))
    );

    if (resistancePower) {
      const resistanceValue = resistancePower.value;
      if (resistanceValue >= damageAmount) {
        // Complete resistance
        await ChatMessage.create({
          content: `<div class="fsr-chat-card fsr-success">
            <h3>Resistance: Complete Immunity</h3>
            <p><strong>${targetActor.name}</strong>'s ${resistancePower.name} (${formatRankDisplay(resistancePower.rank)}: ${resistanceValue}) completely resists ${damageAmount} ${damageType} damage from <strong>${powerName}</strong>!</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
        return; // No damage applied
      } else {
        // Partial resistance
        await ChatMessage.create({
          content: `<div class="fsr-chat-card">
            <h3>Resistance: Partial Protection</h3>
            <p><strong>${targetActor.name}</strong>'s ${resistancePower.name} (${formatRankDisplay(resistancePower.rank)}: ${resistanceValue}) reduces ${damageType} damage by ${resistanceValue}</p>
            <p class="fsr-rank-change">${damageAmount} → ${damageAmount - resistanceValue} damage</p>
          </div>`,
          speaker: ChatMessage.getSpeaker({ actor: targetActor })
        });
        damageAmount -= resistanceValue;
      }
    }
  }

  let incoming = damageAmount;
  const soakSources: string[] = [];

  // Check for equipped armor (house rule setting)
  const armorEnabled = game.settings.get("faserip", "armorEnabled") ?? false;
  const equippedArmor = armorEnabled
    ? (targetActor.system.armors || []).find((a: any) => a.equipped)
    : null;

  // Equipped armor soaks first (if enabled)
  if (equippedArmor) {
    const armorSoak = Math.min(incoming, equippedArmor.value);
    if (armorSoak > 0) {
      soakSources.push(`${equippedArmor.name} –${armorSoak}`);
      incoming = Math.max(0, incoming - armorSoak);

      // Degrade armor if the setting is enabled
      const degradingEnabled =
        game.settings.get("faserip", "degradingArmor") ?? false;
      if (degradingEnabled) {
        equippedArmor.value = Math.max(0, equippedArmor.value - armorSoak);
        if (equippedArmor.value === 0) {
          ui.notifications?.warn(
            `${targetActor.name}'s ${equippedArmor.name} is destroyed!`
          );
        }
      }
    }
  }

  // Body Armor power soaks remainder
  const bodyArmorPower = (targetActor.system.powers || []).find(
    (p: any) =>
      p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
      (!p.formIds?.length ||
        p.formIds.includes(targetActor.system.currentFormId))
  );

  if (bodyArmorPower && incoming > 0) {
    const powerSoak = Math.min(incoming, bodyArmorPower.value);
    if (powerSoak > 0) {
      soakSources.push(`${bodyArmorPower.name} –${powerSoak}`);
      incoming = Math.max(0, incoming - powerSoak);

      // Degrade Body Armor power if the setting is enabled
      const degradingEnabled =
        game.settings.get("faserip", "degradingArmor") ?? false;
      if (degradingEnabled) {
        bodyArmorPower.value = Math.max(0, bodyArmorPower.value - powerSoak);
        if (bodyArmorPower.value === 0) {
          ui.notifications?.warn(
            `${targetActor.name}'s ${bodyArmorPower.name} is destroyed!`
          );
        }
      }
    }
  }

  // Apply remaining damage to health
  const oldHealth = targetActor.system.resources.health.value;
  const newHealth = Math.max(-20, oldHealth - incoming);

  await targetActor.update({
    "system.resources.health.value": newHealth
  });

  if (soakSources.length > 0) {
    ui.notifications?.info(
      `${powerName} → ${targetActor.name}: Absorbed ${soakSources.join(", ")}. ${incoming} damage applied.`
    );
  } else {
    ui.notifications?.info(
      `${powerName} → ${targetActor.name}: ${incoming} damage applied.`
    );
  }
}
*/

// Helper function to apply health healing to a target
async function applyHealthHealingToTarget(
  targetActor: any,
  healAmount: number,
  powerName: string
) {
  const healthMax = targetActor.system.resources.health.max;
  const oldValue = targetActor.system.resources.health.value;
  const newValue = Math.min(healthMax, oldValue + healAmount);
  const actualHealing = newValue - oldValue;

  // Post healing result to chat BEFORE updating actor
  if (actualHealing > 0) {
    await ChatMessage.create({
      content: `<div class="fsr-chat-card fsr-success">
        <h3>Health Restored</h3>
        <p><strong>${powerName}</strong> → <strong>${targetActor.name}</strong></p>
        <p>Healed <strong>${actualHealing}</strong> health.</p>
        <p style="font-size: 0.9em; opacity: 0.8;">Health: ${oldValue} → ${newValue} / ${healthMax}</p>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor: actor as any })
    });
  } else {
    await ChatMessage.create({
      content: `<div class="fsr-chat-card fsr-warning">
        <h3>Already Healthy</h3>
        <p><strong>${powerName}</strong> → <strong>${targetActor.name}</strong></p>
        <p>Already at full health (${healthMax}).</p>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor: actor as any })
    });
  }

  // NOW update the actor
  if (actualHealing > 0) {
    await targetActor.update({
      "system.resources.health.value": newValue
    });

    ui.notifications?.info(
      `${powerName} → ${targetActor.name}: Healed ${actualHealing} health.`
    );
  } else {
    ui.notifications?.warn(
      `${powerName} → ${targetActor.name}: Already at full health.`
    );
  }
}

// Helper function to apply armor healing to a target
async function applyArmorHealingToTarget(
  targetActor: any,
  repairAmount: number,
  powerName: string
) {
  const bodyArmorPower = (targetActor.system.powers || []).find(
    (p: any) =>
      p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
      (!p.formIds?.length ||
        p.formIds.includes(targetActor.system.currentFormId))
  );

  if (bodyArmorPower) {
    const maxValue = bodyArmorPower.maxValue || bodyArmorPower.value;
    const oldValue = bodyArmorPower.value;
    const newValue = Math.min(maxValue, oldValue + repairAmount);
    const actualRepair = newValue - oldValue;

    // Post repair result to chat BEFORE updating actor
    if (actualRepair > 0) {
      await ChatMessage.create({
        content: `<div class="fsr-chat-card fsr-success">
          <h3>Body Armor Repaired</h3>
          <p><strong>${powerName}</strong> → <strong>${targetActor.name}</strong></p>
          <p>Repaired <strong>${actualRepair}</strong> armor.</p>
          <p style="font-size: 0.9em; opacity: 0.8;">Body Armor: ${oldValue} → ${newValue} / ${maxValue}</p>
        </div>`,
        speaker: ChatMessage.getSpeaker({ actor: actor as any })
      });
    } else {
      await ChatMessage.create({
        content: `<div class="fsr-chat-card fsr-warning">
          <h3>Armor Already Full</h3>
          <p><strong>${powerName}</strong> → <strong>${targetActor.name}</strong></p>
          <p>Body Armor already at maximum (${maxValue}).</p>
        </div>`,
        speaker: ChatMessage.getSpeaker({ actor: actor as any })
      });
    }

    // NOW update the actor
    if (actualRepair > 0) {
      // Find the power index
      const powerIndex = targetActor.system.powers.findIndex(
        (p: any) => p.id === bodyArmorPower.id
      );

      if (powerIndex !== -1) {
        // Clone the array, update the specific value, then overwrite
        const newPowers = [...targetActor.system.powers];
        newPowers[powerIndex].value = newValue;
        await targetActor.update({
          "system.powers": newPowers
        });

        ui.notifications?.info(
          `${powerName} → ${targetActor.name}: Repaired ${actualRepair} Body Armor (now ${newValue}/${maxValue}).`
        );

        // Sync Body Armor power repair with Charman if character is linked
        const charmanData = targetActor.system.charman;
        if (charmanData?.username && charmanData?.characterName) {
          try {
            const service = getCharmanService();
            await service.updateBodyArmorPower(
              charmanData.username,
              charmanData.characterName,
              newValue
            );
          } catch (error) {
            console.warn("Could not sync Body Armor repair to Charman:", error);
          }
        }
      }
    } else {
      ui.notifications?.warn(
        `${powerName} → ${targetActor.name}: Body Armor already at full.`
      );
    }
  } else {
    // No Body Armor power found - show error in chat
    await ChatMessage.create({
      content: `<div class="fsr-chat-card fsr-fail">
        <h3>No Body Armor Found</h3>
        <p><strong>${powerName}</strong> → <strong>${targetActor.name}</strong></p>
        <p>No Body Armor power found to repair.</p>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor: actor as any })
    });

    ui.notifications?.warn(
      `${powerName} → ${targetActor.name}: No Body Armor power found to heal.`
    );
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Powers</h2>
      <button @click="addPower" class="fsr-btn fsr-btn-primary fsr-btn-sm">
        + Add Power
      </button>
    </div>

    <!-- Form filter bar -->
    <div v-if="forms.length > 1" class="flex gap-1 flex-wrap mb-3">
      <button
        @click="filterFormId = ''"
        :class="[
          'fsr-btn fsr-btn-sm text-xs px-3 py-1',
          filterFormId === ''
            ? 'fsr-btn-primary'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        ]"
      >
        All Forms
      </button>
      <button
        v-for="form in forms"
        :key="form.id"
        @click="filterFormId = form.id"
        :class="[
          'fsr-btn fsr-btn-sm text-xs px-3 py-1',
          filterFormId === form.id
            ? 'fsr-btn-primary'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        ]"
      >
        <span v-if="form.isPrimary" class="mr-1 text-yellow-400">★</span
        >{{ form.name }}
      </button>
    </div>

    <div class="fsr-list">
      <div
        v-for="power in filteredPowers"
        :key="power.id"
        class="fsr-list-item"
        :title="`${power.name} - ${formatRankDisplay(power.rank)}`"
      >
        <div class="fsr-list-item-header mb-2">
          <input
            v-model="power.name"
            type="text"
            class="fsr-input flex-1 mr-2"
            placeholder="Power Name"
          />
          <button
            @click="removePower(powers.indexOf(power))"
            class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2"
          >
            ✕
          </button>
        </div>

        <!-- Form badges + assign button -->
        <div
          v-if="forms.length > 1"
          class="flex flex-wrap gap-1 mb-2 items-center"
        >
          <span class="text-xs text-gray-500">Forms:</span>
          <span
            v-if="!power.formIds || power.formIds.length === 0"
            class="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5"
            >All</span
          >
          <span
            v-else
            v-for="fid in power.formIds"
            :key="fid"
            class="text-xs bg-yellow-900/60 text-yellow-300 rounded px-2 py-0.5"
            >{{ forms.find(f => f.id === fid)?.name ?? fid }}</span
          >
          <button
            @click="toggleFormPanel(power.id)"
            class="fsr-btn fsr-btn-sm text-xs bg-gray-600 hover:bg-gray-500 text-white px-2 py-0.5 ml-auto"
            :title="
              expandedFormPanel === power.id
                ? 'Close form assignment'
                : 'Assign to forms'
            "
          >
            {{ expandedFormPanel === power.id ? "▲ Forms" : "▼ Forms" }}
          </button>
        </div>

        <!-- Form assignment panel -->
        <div
          v-if="forms.length > 1 && expandedFormPanel === power.id"
          class="mb-2 p-2 bg-gray-800 rounded border border-gray-700"
        >
          <p class="text-xs text-gray-400 mb-2">
            Check forms this power applies to. Unchecking all means it applies
            to every form.
          </p>
          <div class="flex flex-col gap-1">
            <label
              v-for="form in forms"
              :key="form.id"
              class="flex items-center gap-2 text-sm cursor-pointer hover:text-white"
            >
              <input
                type="checkbox"
                :checked="!!power.formIds?.includes(form.id)"
                @change="togglePowerForm(power, form.id)"
                class="form-checkbox"
              />
              <span
                :class="form.isPrimary ? 'text-yellow-400' : 'text-gray-300'"
              >
                <span v-if="form.isPrimary" class="mr-1">★</span>{{ form.name }}
              </span>
            </label>
          </div>
        </div>

        <div
          :class="[
            'grid gap-2 mb-2',
            mpEnabled ? 'grid-cols-3' : 'grid-cols-2'
          ]"
        >
          <div>
            <label class="fsr-label">Rank</label>
            <select
              :value="power.rank"
              @change="(e: any) => onPowerRankChange(power, e.target.value)"
              class="fsr-select text-sm w-40"
            >
              <option v-for="r in RANK_ORDER" :key="r" :value="r">
                {{ formatRankDisplay(r) }}
              </option>
            </select>
          </div>
          <div>
            <label class="fsr-label">Category</label>
            <input
              v-model="power.category"
              type="text"
              class="fsr-input"
              placeholder="e.g. Fighting"
            />
          </div>
          <div v-if="mpEnabled">
            <label class="fsr-label">MP Cost</label>
            <input
              v-model.number="power.mpCost"
              type="number"
              class="fsr-input"
              placeholder="0"
              min="0"
            />
          </div>
        </div>

        <!-- Effect Type and Attack Type -->
        <div class="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label class="fsr-label">Effect Type</label>
            <select v-model="power.effectType" class="fsr-select text-sm">
              <option value="none">None</option>
              <option value="damage">Deals Damage</option>
              <option value="heal-health">Heals Health</option>
              <option value="heal-armor">Heals Body Armor</option>
            </select>
          </div>
          <div>
            <label class="fsr-label"
              >Requires Defense Roll
              <span class="fsr-help-text">(contested)</span></label
            >
            <select v-model="power.attackType" class="fsr-select text-sm">
              <option value="none">No / Automatic</option>
              <option value="melee">vs Fighting</option>
              <option value="ranged">vs Agility</option>
              <option value="psyche">vs Psyche</option>
            </select>
          </div>
        </div>

        <!-- Multi-Hit checkbox (for AoE/multi-target attacks) -->
        <div
          v-if="power.attackType && power.attackType !== 'none'"
          class="mb-2"
        >
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="power.multiHit"
              type="checkbox"
              class="w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-2 focus:ring-blue-500"
            />
            <span class="fsr-label mb-0"
              >Multi-Hit (AoE)
              <span class="fsr-help-text"
                >(one roll for all targets, no combo penalty)</span
              ></span
            >
          </label>
        </div>

        <!-- Damage Type, Resistance Type, and Vulnerability Type -->
        <div
          class="grid gap-2 mb-2"
          :class="
            power.effectType === 'damage' ||
            power.resistanceType ||
            power.vulnerabilityType
              ? 'grid-cols-2'
              : 'grid-cols-1'
          "
        >
          <div v-if="power.effectType === 'damage'">
            <label class="fsr-label">Damage Type</label>
            <select v-model="power.damageType" class="fsr-select text-sm">
              <option value="none">Normal/Physical</option>
              <option value="fire">Fire</option>
              <option value="cold">Cold</option>
              <option value="electricity">Electricity</option>
              <option value="energy">Energy</option>
              <option value="radiation">Radiation</option>
              <option value="sonic">Sonic</option>
              <option value="acid">Acid</option>
              <option value="poison">Poison</option>
              <option value="mental">Mental/Psychic</option>
              <option value="magic">Magic</option>
              <option value="force">Force</option>
            </select>
          </div>
          <div v-if="power.effectType !== 'damage' && !power.vulnerabilityType">
            <label class="fsr-label">Resistance Type</label>
            <select v-model="power.resistanceType" class="fsr-select text-sm">
              <option :value="undefined">Not a Resistance</option>
              <option value="fire">Fire Resistance</option>
              <option value="cold">Cold Resistance</option>
              <option value="electricity">Electricity Resistance</option>
              <option value="energy">Energy Resistance</option>
              <option value="radiation">Radiation Resistance</option>
              <option value="sonic">Sonic Resistance</option>
              <option value="acid">Acid Resistance</option>
              <option value="poison">Poison Resistance</option>
              <option value="mental">Mental Resistance</option>
              <option value="magic">Magic Resistance</option>
              <option value="force">Force Resistance</option>
            </select>
          </div>
          <div v-if="power.effectType !== 'damage' && !power.resistanceType">
            <label class="fsr-label">Vulnerability Type</label>
            <select
              v-model="power.vulnerabilityType"
              class="fsr-select text-sm"
            >
              <option :value="undefined">Not a Vulnerability</option>
              <option value="fire">Fire Vulnerability</option>
              <option value="cold">Cold Vulnerability</option>
              <option value="electricity">Electricity Vulnerability</option>
              <option value="energy">Energy Vulnerability</option>
              <option value="radiation">Radiation Vulnerability</option>
              <option value="sonic">Sonic Vulnerability</option>
              <option value="acid">Acid Vulnerability</option>
              <option value="poison">Poison Vulnerability</option>
              <option value="mental">Mental Vulnerability</option>
              <option value="magic">Magic Vulnerability</option>
              <option value="force">Force Vulnerability</option>
            </select>
          </div>
        </div>

        <!-- Body Armor value display and repair (when degrading armor is enabled) -->
        <div
          v-if="degradingEnabled && isBodyArmor(power)"
          class="mb-2 p-2 bg-blue-900/20 border border-blue-700 rounded"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-300">Armor Protection:</span>
              <span class="text-lg font-bold text-blue-300"
                >{{ power.value }}/{{ power.maxValue || power.value }}</span
              >
            </div>
            <button
              v-if="power.value < (power.maxValue || power.value)"
              @click="repairPower(power)"
              class="text-blue-400 hover:text-blue-300 text-sm"
              :title="'Repair to full'"
            >
              🔧 Repair
            </button>
            <span
              v-else
              class="text-green-400 text-sm"
              :title="'Body Armor at full strength'"
            >
              ✓ Full
            </span>
          </div>
        </div>

        <!-- Skip dialogs toggle -->
        <label
          class="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 mb-2"
          :title="'When checked, this power rolls immediately without talent or combo dialogs'"
        >
          <input
            type="checkbox"
            v-model="power.skipDialogs"
            class="form-checkbox"
          />
          Quick roll (skip talent &amp; combo dialogs)
        </label>

        <div
          v-if="power.description"
          class="mb-2 text-sm text-gray-300 p-2 bg-gray-800 rounded"
        >
          {{ power.description }}
        </div>
      </div>

      <div v-if="powers.length === 0" class="text-center text-gray-400 py-8">
        No powers yet. Click "Add Power" to create one.
      </div>
    </div>
  </div>
</template>
