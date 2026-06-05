<script setup lang="ts">
import { inject, computed, ref, watch, onMounted, onUnmounted } from "vue";
import {
  formatRankDisplay,
  applyChartShift,
  type Rank,
  RollResult
} from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { stringToRank } from "../../utils";
import { getCharmanService } from "../../charman-service";
import {
  showTalentSelectionDialog,
  showAttackOptionsDialog
} from "../../applications/dialog-utils";
import type { Talent } from "../../types";
import {
  executeCombatAttack,
  applyPendingDamages,
  type PendingDamage
} from "../../combat/combat-flow";
import type { ReactiveActorData, PowerData } from "../../types/actor-system";
import type { FaseripActor } from "../../documents";
import { VueDialog } from "../../applications/vue-dialog";
import ArmorSelectionDialog from "../../applications/dialogs/ArmorSelectionDialog.vue";
import { isWeaponItem, type WeaponItem } from "../../types/items";

interface Weapon {
  id: string;
  name: string;
  type: "melee" | "ranged" | "thrown"; // Weapon type determines which stat is used for to-hit
  damage: string | number; // CS number for melee (+X), Rank string for ranged
  stat: "fighting" | "agility";
  applicableTalents?: string[];
  description?: string;
  equipped?: boolean;
  armorPiercing?: string | null; // Armor-piercing rank (optional)
  multiHit?: boolean; // True for AoE/multi-target weapons (one roll, no combo penalty)
}

const reactiveActor = inject("reactiveActor") as ReactiveActorData;
const actor = inject("actor") as FaseripActor;

const forms = computed(() => reactiveActor.system.forms || []);

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

const currentForm = computed(
  () => forms.value.find(f => f.id === viewFormId.value) ?? forms.value[0]
);

// Reactive key to force computed updates when items change
const itemsUpdateKey = ref(0);

const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);

// Weapons: Merge system.weapons with weapon items from actor.items
const weapons = computed<Weapon[]>(() => {
  void itemsUpdateKey.value; // Force reactivity

  // Get weapons from actor.system (old format)
  const systemWeapons = (reactiveActor.system.weapons || []) as Weapon[];

  // Get weapon items and convert to Weapon format
  const weaponItems = actor.items.filter(isWeaponItem) as WeaponItem[];
  const convertedItems: Weapon[] = weaponItems.map(item => ({
    id: item._id!,
    name: item.name || "Unnamed Weapon",
    type: item.system.weaponType as "melee" | "ranged" | "thrown",
    damage:
      item.system.weaponType === "melee" || item.system.weaponType === "thrown"
        ? item.system.damage // CS number for melee/thrown
        : item.system.damageRank, // Rank string for ranged
    stat: item.system.weaponType === "melee" ? "fighting" : "agility",
    description: item.system.description || "",
    equipped: item.system.equipped,
    applicableTalents: item.system.talents || [],
    armorPiercing: item.system.armorPiercing || "" // Add armor piercing
  }));

  // Merge both sources
  return [...systemWeapons, ...convertedItems];
});

const allPowers = computed(() =>
  (reactiveActor.system.powers || []).filter(
    (p: PowerData) => !p.formIds?.length || p.formIds.includes(viewFormId.value)
  )
);

// Separate resistance and vulnerability powers from regular powers
const resistancePowers = computed(() =>
  allPowers.value.filter((p: PowerData) => p.resistanceType)
);

const vulnerabilityPowers = computed(() =>
  allPowers.value.filter((p: PowerData) => p.vulnerabilityType)
);

const powers = computed(() =>
  allPowers.value.filter(
    (p: PowerData) => !p.resistanceType && !p.vulnerabilityType
  )
);

const weaponsEnabled = computed(
  () => game.settings.get("faserip", "weaponsEnabled") ?? false
);

// Check if MP (Mental Points) system is enabled
const mpEnabled = computed(
  () => game.settings.get("faserip", "mpEnabled") ?? false
);

// Get vulnerability damage increase percentage from settings
const vulnerabilityPercent = computed(
  () => game.settings.get("faserip", "vulnerabilityDamageIncrease") ?? 25
);

// Hook handlers for item updates
const handleItemCreate = (item: Item) => {
  if (item.parent?._id === actor._id) {
    itemsUpdateKey.value++;
  }
};

const handleItemUpdate = (item: Item) => {
  if (item.parent?._id === actor._id) {
    itemsUpdateKey.value++;
  }
};

const handleItemDelete = (item: Item) => {
  if (item.parent?._id === actor._id) {
    itemsUpdateKey.value++;
  }
};

onMounted(() => {
  Hooks.on("createItem", handleItemCreate);
  Hooks.on("updateItem", handleItemUpdate);
  Hooks.on("deleteItem", handleItemDelete);
});

onUnmounted(() => {
  Hooks.off("createItem", handleItemCreate);
  Hooks.off("updateItem", handleItemUpdate);
  Hooks.off("deleteItem", handleItemDelete);
});

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

/**
 * Get all available armor options for a target actor (equipped armors + Body Armor power)
 */
function getArmorOptions(targetActor: any) {
  const options: Array<{
    id: string;
    name: string;
    type: string;
    value: number;
    maxValue: number;
    rank: string;
    isEquippedArmor: boolean;
    armorIndex?: number;
    powerIndex?: number;
  }> = [];

  const targetSystem = targetActor.system;

  // Find equipped armor
  const equippedArmor = (targetSystem.armors || []).find(
    (a: any) => a.equipped
  );
  if (equippedArmor) {
    const armorIndex = targetSystem.armors.findIndex(
      (a: any) => a.id === equippedArmor.id
    );
    options.push({
      id: `equipped-${equippedArmor.id}`,
      name: equippedArmor.name,
      type: "Equipped Armor",
      value: equippedArmor.value,
      maxValue: equippedArmor.maxValue,
      rank: formatRankDisplay(equippedArmor.rank),
      isEquippedArmor: true,
      armorIndex
    });
  }

  // Find Body Armor power
  const bodyArmorPower = (targetSystem.powers || []).find(
    (p: any) =>
      p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
      (!p.formIds?.length || p.formIds.includes(targetSystem.currentFormId))
  );
  if (bodyArmorPower) {
    const powerIndex = targetSystem.powers.findIndex(
      (p: any) => p.id === bodyArmorPower.id
    );
    options.push({
      id: `power-${bodyArmorPower.id}`,
      name: "Body Armor",
      type: "Body Armor Power",
      value: bodyArmorPower.value,
      maxValue: bodyArmorPower.maxValue || bodyArmorPower.value,
      rank: formatRankDisplay(bodyArmorPower.rank),
      isEquippedArmor: false,
      powerIndex
    });
  }

  return options;
}

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

      // Show attack options dialog for unarmed strike
      const fightingRank = stringToRank(
        currentForm.value.attributes.fighting.rank
      );
      const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

      const comboResult = await showAttackOptionsDialog(
        actor.name || "Unknown",
        "Fighting",
        fightingRank,
        availableKarma,
        "Unarmed Strike",
        talentCS
      );

      if (comboResult === null) {
        return; // User cancelled
      }

      // Handle combo attacks
      if (comboResult.comboCount > 1) {
        // Execute multiple attacks with distributed karma
        const allPendingDamages: PendingDamage[] = [];
        let comboFailed = false;
        let comboBotchCount = 0; // Track botches within this combo

        for (let i = 0; i < comboResult.comboCount; i++) {
          const attackKarma = comboResult.attackKarmaSettings[i];

          const result = await executeCombatAttack({
            attacker: actor as any,
            attackAttribute: "fighting",
            attackType: "melee",
            effectType: "damage",
            powerName: "Unarmed Strike",
            powerRank: strengthRank,
            damageType: undefined,
            talentNames: talentNames.length > 0 ? talentNames : undefined,
            talentCS: talentCS > 0 ? talentCS : undefined,
            karmaColumnShifts: attackKarma?.columnShifts ?? 0,
            karmaResultShift: attackKarma?.resultShift ?? 0,
            manualChartShift: comboResult.manualChartShift ?? 0,
            comboIndex: i + 1,
            comboTotal: comboResult.comboCount,
            deferDamageApplication: true, // Defer damage for cumulative application
            comboBotchCount // Pass current botch count
          });

          // Check for botch (1-5) or cancellation - break combo immediately
          console.log("[StatsTab Combo] Attack roll result:", {
            attackRollTotal: result?.attackRollTotal,
            attackIndex: i + 1,
            totalAttacks: comboResult.comboCount,
            isBotch:
              result?.attackRollTotal !== null &&
              result?.attackRollTotal !== undefined &&
              result.attackRollTotal <= 5
          });

          if (result === null || result.attackRollTotal === null) {
            console.log(
              "[StatsTab Combo] Breaking combo - attack cancelled or failed"
            );
            comboFailed = true;
            break;
          }

          // Update botch count from result
          comboBotchCount = result.comboBotchCount;

          if (result.attackRollTotal <= 5) {
            console.log(
              "[StatsTab Combo] Breaking combo - botch detected:",
              result.attackRollTotal
            );
            // Show message about combo break
            await ChatMessage.create({
              speaker: ChatMessage.getSpeaker({ actor }),
              content: `<div class="fsr-combat-message" style="background: #991b1b; color: #fca5a5; padding: 0.5rem; border-radius: 4px;">
                <strong>Botch! Combo Broken!</strong>
                <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${actor.name}'s attack botched on attack ${i + 1} of ${comboResult.comboCount}. Remaining attacks cancelled.</p>
              </div>`
            });
            comboFailed = true;
            break;
          }

          // Accumulate pending damages
          if (result.pendingDamages && result.pendingDamages.length > 0) {
            allPendingDamages.push(...result.pendingDamages);
          }

          // Brief delay between attacks for readability
          if (i < comboResult.comboCount - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        // Apply all accumulated damage at the end (if combo completed)
        if (!comboFailed && allPendingDamages.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
          await applyPendingDamages(actor as any, allPendingDamages);
        }

        // Show exhaustion warning if combo reached Poor or below
        if (comboResult.hasExhaustion) {
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="fsr-combat-message" style="background: #991b1b; color: #fca5a5; padding: 0.5rem; border-radius: 4px;">
              <strong>⚠️ Exhausted!</strong>
              <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${actor.name} reached Poor rank or below during this combo and cannot dodge for the rest of this round!</p>
            </div>`
          });
        }
      } else {
        // Single attack
        const firstAttackKarma = comboResult.attackKarmaSettings[0];

        await executeCombatAttack({
          attacker: actor as any,
          attackAttribute: "fighting",
          attackType: "melee",
          effectType: "damage",
          powerName: "Unarmed Strike",
          powerRank: strengthRank,
          damageType: undefined,
          talentNames: talentNames.length > 0 ? talentNames : undefined,
          talentCS: talentCS > 0 ? talentCS : undefined,
          karmaColumnShifts: firstAttackKarma?.columnShifts ?? 0,
          karmaResultShift: firstAttackKarma?.resultShift ?? 0,
          manualChartShift: comboResult.manualChartShift ?? 0
        });
      }
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

  // All stats go through the attack options dialog
  const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

  const comboResult = await showAttackOptionsDialog(
    actor.name || "Unknown",
    attrLabel,
    rank,
    availableKarma,
    undefined,
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

    // Show exhaustion warning if combo reached Poor or below
    if (comboResult.hasExhaustion) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="fsr-combat-message" style="background: #991b1b; color: #fca5a5; padding: 0.5rem; border-radius: 4px;">
          <strong>⚠️ Exhausted!</strong>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${actor.name} reached Poor rank or below during this combo and cannot dodge for the rest of this round!</p>
        </div>`
      });
    }
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

  // Only equipped weapons may be attacked with
  if (!weapon.equipped) {
    ui.notifications?.warn(
      `${weapon.name} must be equipped to attack with it.`
    );
    return;
  }

  const attackAttribute = weapon.stat;
  const attackType = weapon.type;
  let damageRank: Rank;

  // Calculate damage based on weapon type
  if (weapon.type === "melee" || weapon.type === "thrown") {
    // Melee/Thrown: Strength + weapon CS
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

  // Find applicable talents for bonuses
  const talentNames: string[] = [];
  let talentCS = 0;
  if (weapon.applicableTalents && weapon.applicableTalents.length > 0) {
    for (const talentName of weapon.applicableTalents) {
      const talent = talents.value.find(
        t =>
          t.name.toLowerCase().replace(/[\s_-]+/g, "") ===
          talentName.toLowerCase().replace(/[\s_-]+/g, "")
      );
      if (talent) {
        talentNames.push(talent.name);
        talentCS += talent.bonus || 0;
      }
    }
  }

  // Show attack options dialog
  const attackRank = stringToRank(
    currentForm.value.attributes[attackAttribute].rank
  );
  const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

  const comboResult = await showAttackOptionsDialog(
    actor.name || "Unknown",
    attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1),
    attackRank,
    availableKarma,
    weapon.name,
    talentCS
  );

  if (comboResult === null) {
    return; // User cancelled
  }

  // Handle combo attacks
  if (comboResult.comboCount > 1) {
    // Execute multiple attacks with distributed karma
    const allPendingDamages: PendingDamage[] = [];
    let comboFailed = false;
    let comboBotchCount = 0; // Track botches within this combo

    for (let i = 0; i < comboResult.comboCount; i++) {
      const attackKarma = comboResult.attackKarmaSettings[i];

      const result = await executeCombatAttack({
        attacker: actor as any,
        attackAttribute,
        attackType,
        effectType: "damage",
        powerName: weapon.name,
        powerRank: damageRank,
        damageType: undefined,
        armorPiercing: weapon.armorPiercing, // Add armor piercing
        talentNames: talentNames.length > 0 ? talentNames : undefined,
        talentCS: talentCS > 0 ? talentCS : undefined,
        karmaColumnShifts: attackKarma?.columnShifts ?? 0,
        karmaResultShift: attackKarma?.resultShift ?? 0,
        manualChartShift: comboResult.manualChartShift ?? 0,
        comboIndex: i + 1,
        comboTotal: comboResult.comboCount,
        multiHit: weapon.multiHit || false, // Add multiHit flag for AoE weapons
        deferDamageApplication: true, // Defer damage for cumulative application
        comboBotchCount // Pass current botch count
      });

      // Check for botch (1-5) or cancellation - break combo immediately
      if (result === null || result.attackRollTotal === null) {
        comboFailed = true;
        break;
      }

      // Update botch count from result
      comboBotchCount = result.comboBotchCount;

      if (result.attackRollTotal <= 5) {
        // Show message about combo break
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="fsr-combat-message" style="background: #991b1b; color: #fca5a5; padding: 0.5rem; border-radius: 4px;">
            <strong>Botch! Combo Broken!</strong>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${actor.name}'s attack botched on attack ${i + 1} of ${comboResult.comboCount}. Remaining attacks cancelled.</p>
          </div>`
        });
        comboFailed = true;
        break;
      }

      // Accumulate pending damages
      if (result.pendingDamages && result.pendingDamages.length > 0) {
        allPendingDamages.push(...result.pendingDamages);
      }

      // Brief delay between attacks for readability
      if (i < comboResult.comboCount - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Apply all accumulated damage at the end (if combo completed)
    if (!comboFailed && allPendingDamages.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 500));
      await applyPendingDamages(actor as any, allPendingDamages);
    }

    // Show exhaustion warning if combo reached Poor or below
    if (comboResult.hasExhaustion) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="fsr-combat-message" style="background: #991b1b; color: #fca5a5; padding: 0.5rem; border-radius: 4px;">
          <strong>⚠️ Exhausted!</strong>
          <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${actor.name} reached Poor rank or below during this combo and cannot dodge for the rest of this round!</p>
        </div>`
      });
    }
  } else {
    // Single attack
    const firstAttackKarma = comboResult.attackKarmaSettings[0];

    await executeCombatAttack({
      attacker: actor as any,
      attackAttribute,
      attackType,
      effectType: "damage",
      powerName: weapon.name,
      powerRank: damageRank,
      damageType: undefined,
      armorPiercing: weapon.armorPiercing, // Add armor piercing
      talentNames: talentNames.length > 0 ? talentNames : undefined,
      talentCS: talentCS > 0 ? talentCS : undefined,
      karmaColumnShifts: firstAttackKarma?.columnShifts ?? 0,
      karmaResultShift: firstAttackKarma?.resultShift ?? 0,
      manualChartShift: comboResult.manualChartShift ?? 0,
      multiHit: weapon.multiHit || false // Add multiHit flag for AoE weapons
    });
  }
}

async function toggleEquip(weapon: Weapon) {
  // Check if this is a weapon Item or a system weapon
  const weaponItem = actor.items.find(
    (item: any) => item.type === "weapon" && item._id === weapon.id
  );

  if (weaponItem) {
    // Toggle Item weapon - also unequip other weapons of the same type
    const otherWeaponsOfType = actor.items.filter(
      (item: any) =>
        item.type === "weapon" &&
        item._id !== weapon.id &&
        // @ts-expect-error - system properties are dynamic
        item.system.weaponType === weaponItem.system.weaponType &&
        item.system.equipped
    );

    // Unequip other weapons of the same type
    for (const otherWeapon of otherWeaponsOfType) {
      // @ts-expect-error - system properties are dynamic
      await otherWeapon.update({ "system.equipped": false });
    }

    // Toggle this weapon
    await weaponItem.update({
      // @ts-expect-error - system properties are dynamic
      "system.equipped": !weaponItem.system.equipped
    });
  } else if (reactiveActor.system.weapons) {
    // Legacy system weapon (shouldn't happen after sync, but keep for compatibility)
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
    await actor.update({
      // @ts-expect-error - system properties are dynamic
      "system.weapons": JSON.parse(JSON.stringify(reactiveActor.system.weapons))
    });
  }
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
    // Check for targeted tokens
    // @ts-expect-error - game.user.targets is a Set
    const targets = Array.from(game.user?.targets || []);
    const hasTargets = targets.length > 0;

    console.log("[StatsTab] Power data for healing/repair:", {
      powerName: power.name,
      armorPiercing: power.armorPiercing,
      fullPower: power
    });

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

    // Apply healing to targets or self
    if (hasTargets) {
      // Apply to each targeted token
      let healingResultsHtml = "";

      for (const token of targets) {
        // @ts-expect-error - token.actor can be null
        const targetActor = token.actor;
        if (!targetActor) continue;

        const targetSystem = (targetActor as any).system;
        let targetResult = "";

        if (power.effectType === "heal-health" && amount > 0) {
          const healthMax = targetSystem.resources?.health?.max || 100;
          const oldValue = targetSystem.resources?.health?.value || 0;
          const newValue = Math.min(healthMax, oldValue + amount);
          const actualHealing = newValue - oldValue;

          if (actualHealing > 0) {
            await targetActor.update({
              "system.resources.health.value": newValue
            });
            targetResult = `<div style="background: rgba(34, 197, 94, 0.15); border-left: 3px solid rgb(34, 197, 94); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
              <h4 style="color: rgb(34, 197, 94); margin: 0 0 0.25rem 0; font-size: 1em;">${targetActor.name} - Health Restored</h4>
              <p style="margin: 0.25rem 0;">Healed <strong>${actualHealing}</strong> health.</p>
              <p style="margin: 0.25rem 0; font-size: 0.9em; opacity: 0.8;">Health: ${oldValue} → ${newValue} / ${healthMax}</p>
            </div>`;
            ui.notifications?.info(
              `${power.name}: Healed ${targetActor.name} for ${actualHealing} health.`
            );
          } else {
            targetResult = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
              <h4 style="color: rgb(217, 119, 6); margin: 0 0 0.25rem 0; font-size: 1em;">${targetActor.name} - Already Healthy</h4>
              <p style="margin: 0.25rem 0;">Already at full health (${healthMax}).</p>
            </div>`;
          }
        } else if (power.effectType === "heal-armor" && amount > 0) {
          // Get all available armor options (equipped armor + Body Armor power)
          const armorOptions = getArmorOptions(targetActor);

          if (armorOptions.length === 0) {
            targetResult = `<div style="background: rgba(239, 68, 68, 0.15); border-left: 3px solid rgb(239, 68, 68); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
              <h4 style="color: rgb(239, 68, 68); margin: 0 0 0.25rem 0; font-size: 1em;">${targetActor.name} - No Armor Found</h4>
              <p style="margin: 0.25rem 0;">No equipped armor or Body Armor power found to repair.</p>
            </div>`;
          } else {
            // Select which armor to repair
            let selectedArmor;
            if (armorOptions.length === 1) {
              // Only one option, use it automatically
              selectedArmor = armorOptions[0];
            } else {
              // Multiple options, show selection dialog
              const result = (await VueDialog.show(
                ArmorSelectionDialog,
                {
                  targetName: targetActor.name,
                  armorOptions: armorOptions.map(a => ({
                    id: a.id,
                    name: a.name,
                    type: a.type,
                    value: a.value,
                    maxValue: a.maxValue,
                    rank: a.rank
                  }))
                },
                {
                  window: { title: "Select Armor to Repair" },
                  position: { width: 500 }
                }
              )) as { armorId: string } | null;

              if (!result) {
                // User cancelled
                targetResult = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
                  <h4 style="color: rgb(217, 119, 6); margin: 0 0 0.25rem 0; font-size: 1em;">${targetActor.name} - Repair Cancelled</h4>
                  <p style="margin: 0.25rem 0;">Armor repair cancelled.</p>
                </div>`;
                continue;
              }

              selectedArmor = armorOptions.find(a => a.id === result.armorId);
              if (!selectedArmor) continue;
            }

            // Apply repair to selected armor
            const maxValue = selectedArmor.maxValue;
            const oldValue = selectedArmor.value;
            const newValue = Math.min(maxValue, oldValue + amount);
            const actualRepair = newValue - oldValue;

            if (actualRepair > 0) {
              // Update the armor - Clone array, modify, then update entire array
              if (
                selectedArmor.isEquippedArmor &&
                selectedArmor.armorIndex !== undefined
              ) {
                const clampedValue = Math.min(maxValue, newValue);
                // Clone the array, update the specific value, then overwrite
                const newArmors = [...targetActor.system.armors];
                newArmors[selectedArmor.armorIndex].value = clampedValue;
                await targetActor.update({
                  "system.armors": newArmors
                });
              } else if (
                !selectedArmor.isEquippedArmor &&
                selectedArmor.powerIndex !== undefined
              ) {
                const clampedValue = Math.min(maxValue, newValue);
                // Clone the array, update the specific value, then overwrite
                const newPowers = [...targetActor.system.powers];
                newPowers[selectedArmor.powerIndex].value = clampedValue;
                await targetActor.update({
                  "system.powers": newPowers
                });
              }

              targetResult = `<div style="background: rgba(59, 130, 246, 0.15); border-left: 3px solid rgb(59, 130, 246); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
                <h4 style="color: rgb(59, 130, 246); margin: 0 0 0.25rem 0; font-size: 1em;">${targetActor.name} - ${selectedArmor.name} Repaired</h4>
                <p style="margin: 0.25rem 0;">Repaired <strong>${actualRepair}</strong> armor.</p>
                <p style="margin: 0.25rem 0; font-size: 0.9em; opacity: 0.8;">${selectedArmor.name}: ${oldValue} → ${newValue} / ${maxValue}</p>
              </div>`;
              ui.notifications?.info(
                `${power.name}: Repaired ${targetActor.name}'s ${selectedArmor.name} by ${actualRepair}.`
              );
            } else {
              targetResult = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
                <h4 style="color: rgb(217, 119, 6); margin: 0 0 0.25rem 0; font-size: 1em;">${targetActor.name} - Armor Already Full</h4>
                <p style="margin: 0.25rem 0;">${selectedArmor.name} already at maximum (${maxValue}).</p>
              </div>`;
            }
          }
        }

        healingResultsHtml += targetResult;
      }

      // Create combined chat message
      const combinedContent = `<div>${rollCardContent}${healingResultsHtml}</div>`;
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combinedContent,
        rolls: [faseripRoll.roll]
      });
    } else {
      // Apply to self (original behavior)
      let healingResultHtml = "";
      let healthToApply = 0;
      let armorToApply = 0;
      let bodyArmorPowerToUpdate: any = null;
      let actualHealingAmount = 0;
      let actualRepairAmount = 0;

      // Calculate healing/repair (but don't apply yet)
      if (power.effectType === "heal-health" && amount > 0) {
        const healthMax = reactiveActor.system.resources.health.max;
        const oldValue = reactiveActor.system.resources.health.value;
        const newValue = Math.min(healthMax, oldValue + amount);
        const actualHealing = newValue - oldValue;

        if (actualHealing > 0) {
          healthToApply = newValue;
          actualHealingAmount = actualHealing;
          healingResultHtml = `<div style="background: rgba(34, 197, 94, 0.15); border-left: 3px solid rgb(34, 197, 94); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
            <h4 style="color: rgb(34, 197, 94); margin: 0 0 0.25rem 0; font-size: 1em;">Health Restored</h4>
            <p style="margin: 0.25rem 0;">Healed <strong>${actualHealing}</strong> health.</p>
            <p style="margin: 0.25rem 0; font-size: 0.9em; opacity: 0.8;">Health: ${oldValue} → ${newValue} / ${healthMax}</p>
          </div>`;
        } else {
          healingResultHtml = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
            <h4 style="color: rgb(217, 119, 6); margin: 0 0 0.25rem 0; font-size: 1em;">Already Healthy</h4>
            <p style="margin: 0.25rem 0;">Already at full health (${healthMax}).</p>
          </div>`;
        }
      } else if (power.effectType === "heal-armor" && amount > 0) {
        // Get all available armor options (equipped armor + Body Armor power)
        const armorOptions = getArmorOptions(actor);

        if (armorOptions.length === 0) {
          healingResultHtml = `<div style="background: rgba(239, 68, 68, 0.15); border-left: 3px solid rgb(239, 68, 68); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
            <h4 style="color: rgb(239, 68, 68); margin: 0 0 0.25rem 0; font-size: 1em;">No Armor Found</h4>
            <p style="margin: 0.25rem 0;">No equipped armor or Body Armor power found to repair.</p>
          </div>`;
        } else {
          // Select which armor to repair
          let selectedArmor;
          if (armorOptions.length === 1) {
            // Only one option, use it automatically
            selectedArmor = armorOptions[0];
          } else {
            // Multiple options, show selection dialog
            const result = (await VueDialog.show(
              ArmorSelectionDialog,
              {
                targetName: actor.name,
                armorOptions: armorOptions.map(a => ({
                  id: a.id,
                  name: a.name,
                  type: a.type,
                  value: a.value,
                  maxValue: a.maxValue,
                  rank: a.rank
                }))
              },
              {
                window: { title: "Select Armor to Repair" },
                position: { width: 500 }
              }
            )) as { armorId: string } | null;

            if (!result) {
              // User cancelled
              healingResultHtml = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
                <h4 style="color: rgb(217, 119, 6); margin: 0 0 0.25rem 0; font-size: 1em;">Repair Cancelled</h4>
                <p style="margin: 0.25rem 0;">Armor repair cancelled.</p>
              </div>`;
            } else {
              selectedArmor = armorOptions.find(a => a.id === result.armorId);
            }
          }

          if (selectedArmor) {
            // Calculate repair (but don't apply yet)
            const maxValue = selectedArmor.maxValue;
            const oldValue = selectedArmor.value;
            const newValue = Math.min(maxValue, oldValue + amount);
            const actualRepair = newValue - oldValue;

            if (actualRepair > 0) {
              armorToApply = newValue;
              actualRepairAmount = actualRepair;
              bodyArmorPowerToUpdate = selectedArmor; // Store selected armor info
              healingResultHtml = `<div style="background: rgba(59, 130, 246, 0.15); border-left: 3px solid rgb(59, 130, 246); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
                <h4 style="color: rgb(59, 130, 246); margin: 0 0 0.25rem 0; font-size: 1em;">${selectedArmor.name} Repaired</h4>
                <p style="margin: 0.25rem 0;">Repaired <strong>${actualRepair}</strong> armor.</p>
                <p style="margin: 0.25rem 0; font-size: 0.9em; opacity: 0.8;">${selectedArmor.name}: ${oldValue} → ${newValue} / ${maxValue}</p>
              </div>`;
            } else {
              healingResultHtml = `<div style="background: rgba(251, 191, 36, 0.15); border-left: 3px solid rgb(251, 191, 36); padding: 0.5rem; margin-top: 0.5rem; border-radius: 4px;">
                <h4 style="color: rgb(217, 119, 6); margin: 0 0 0.25rem 0; font-size: 1em;">Armor Already Full</h4>
                <p style="margin: 0.25rem 0;">${selectedArmor.name} already at maximum (${maxValue}).</p>
              </div>`;
            }
          }
        }
      }

      // Create combined chat message with roll + healing result
      const combinedContent = `<div>${rollCardContent}${healingResultHtml}</div>`;

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: combinedContent,
        rolls: [faseripRoll.roll]
      });

      // NOW apply the healing/repair after chat message is posted
      if (healthToApply > 0) {
        reactiveActor.system.resources.health.value = healthToApply;
        ui.notifications?.info(
          `${power.name}: Healed ${actualHealingAmount} health.`
        );
      } else if (armorToApply > 0 && bodyArmorPowerToUpdate) {
        // Apply repair to either equipped armor or Body Armor power
        if (
          bodyArmorPowerToUpdate.isEquippedArmor &&
          bodyArmorPowerToUpdate.armorIndex !== undefined
        ) {
          // Update equipped armor through reactive actor (clamp to maxValue)
          const targetArmor =
            reactiveActor.system.armors[bodyArmorPowerToUpdate.armorIndex];
          targetArmor.value = Math.min(targetArmor.maxValue, armorToApply);
          ui.notifications?.info(
            `${power.name}: Repaired ${actualRepairAmount} ${bodyArmorPowerToUpdate.name}.`
          );
        } else if (
          !bodyArmorPowerToUpdate.isEquippedArmor &&
          bodyArmorPowerToUpdate.powerIndex !== undefined
        ) {
          // Update Body Armor power through reactive actor (clamp to maxValue)
          const targetPower =
            reactiveActor.system.powers[bodyArmorPowerToUpdate.powerIndex];
          const powerMaxValue = targetPower.maxValue || targetPower.value;
          targetPower.value = Math.min(powerMaxValue, armorToApply);
          ui.notifications?.info(
            `${power.name}: Repaired ${actualRepairAmount} Body Armor.`
          );

          // Sync with Charman if character is linked (Body Armor power only)
          // @ts-expect-error - charman property exists on system
          const charmanData = actor.system.charman;
          if (charmanData?.username && charmanData?.characterName) {
            try {
              const service = getCharmanService();
              await service.updateBodyArmorPower(
                charmanData.username,
                charmanData.characterName,
                armorToApply
              );
            } catch (error) {
              // Service not initialized or sync failed - ignore silently
            }
          }
        }
      } else if (
        power.effectType === "heal-health" ||
        power.effectType === "heal-armor"
      ) {
        // Show appropriate warning for failed healing
        if (power.effectType === "heal-health") {
          ui.notifications?.warn(`${power.name}: Already at full health.`);
        } else {
          ui.notifications?.warn(
            `${power.name}: Body Armor already at full or not found.`
          );
        }
      }
    }

    // Deduct MP
    if (mpCost > 0 && reactiveActor.system.resources.mentalPoints) {
      const mentalPoints = reactiveActor.system.resources.mentalPoints;
      mentalPoints.value = Math.max(0, mentalPoints.value - mpCost);
    }

    return;
  }

  // Route ALL damage powers through combat flow
  if (power.effectType === "damage") {
    // Determine attack attribute and type based on power settings
    let attackAttribute: "fighting" | "agility" | "psyche";
    let attackType: "melee" | "ranged" | "psyche";

    if (power.attackType === "melee") {
      attackAttribute = "fighting";
      attackType = "melee";
    } else if (power.attackType === "psyche") {
      attackAttribute = "psyche";
      attackType = "psyche";
    } else {
      // Default to ranged for all other damage types (blast, area, etc.)
      attackAttribute = "agility";
      attackType = "ranged";
    }

    // Show attack options dialog for damage powers (allows combo attacks with karma distribution)
    const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

    const comboResult = await showAttackOptionsDialog(
      actor.name || "Unknown",
      attackAttribute.charAt(0).toUpperCase() + attackAttribute.slice(1),
      rank,
      availableKarma,
      power.name,
      totalCS
    );

    if (comboResult === null) {
      return; // User cancelled
    }

    // Handle combo attacks (multiple targets with same power)
    if (comboResult.comboCount > 1) {
      // Execute multiple attacks with distributed karma
      const allPendingDamages: PendingDamage[] = [];
      let comboFailed = false;
      let comboBotchCount = 0; // Track botches within this combo

      for (let i = 0; i < comboResult.comboCount; i++) {
        const attackKarma = comboResult.attackKarmaSettings[i];

        const result = await executeCombatAttack({
          attacker: actor as any,
          attackAttribute,
          attackType,
          effectType: power.effectType || "none",
          powerName: power.name,
          powerRank: rank,
          damageRoll: `1d${rankValue}`,
          damageType:
            power.damageType !== "none" ? power.damageType : undefined,
          talentNames: talentNames.length > 0 ? talentNames : undefined,
          talentCS: totalCS > 0 ? totalCS : undefined,
          // Pass karma settings from combo dialog
          karmaColumnShifts: attackKarma?.columnShifts ?? 0,
          karmaResultShift: attackKarma?.resultShift ?? 0,
          manualChartShift: comboResult.manualChartShift ?? 0,
          comboIndex: i + 1,
          comboTotal: comboResult.comboCount,
          multiHit: power.multiHit || false,
          armorPiercing: power.armorPiercing, // Add armor piercing
          deferDamageApplication: true, // Defer damage for cumulative application
          comboBotchCount // Pass current botch count
        });

        // Check for botch (1-5) or cancellation - break combo immediately
        if (result === null || result.attackRollTotal === null) {
          comboFailed = true;
          break;
        }

        // Update botch count from result
        comboBotchCount = result.comboBotchCount;

        if (result.attackRollTotal <= 5) {
          // Show message about combo break
          await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="fsr-combat-message" style="background: #991b1b; color: #fca5a5; padding: 0.5rem; border-radius: 4px;">
              <strong>Botch! Combo Broken!</strong>
              <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${actor.name}'s attack botched on attack ${i + 1} of ${comboResult.comboCount}. Remaining attacks cancelled.</p>
            </div>`
          });
          comboFailed = true;
          break;
        }

        // Accumulate pending damages
        if (result.pendingDamages && result.pendingDamages.length > 0) {
          allPendingDamages.push(...result.pendingDamages);
        }

        // Brief delay between attacks for readability
        if (i < comboResult.comboCount - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Apply all accumulated damage at the end (if combo completed)
      if (!comboFailed && allPendingDamages.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        await applyPendingDamages(actor as any, allPendingDamages);
      }
    } else {
      // Single attack with karma from combo dialog
      const firstAttackKarma = comboResult.attackKarmaSettings[0];

      await executeCombatAttack({
        attacker: actor as any,
        attackAttribute,
        attackType,
        effectType: power.effectType || "none",
        powerName: power.name,
        powerRank: rank,
        damageRoll: `1d${rankValue}`,
        damageType: power.damageType !== "none" ? power.damageType : undefined,
        talentNames: talentNames.length > 0 ? talentNames : undefined,
        talentCS: totalCS > 0 ? totalCS : undefined,
        // Pass karma settings from combo dialog
        karmaColumnShifts: firstAttackKarma?.columnShifts ?? 0,
        karmaResultShift: firstAttackKarma?.resultShift ?? 0,
        manualChartShift: comboResult.manualChartShift ?? 0,
        multiHit: power.multiHit || false,
        armorPiercing: power.armorPiercing // Add armor piercing
      });
    }

    // Deduct MP after successful attack
    if (mpCost > 0 && reactiveActor.system.resources.mentalPoints) {
      const mentalPoints = reactiveActor.system.resources.mentalPoints;
      mentalPoints.value = Math.max(0, mentalPoints.value - mpCost);

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

  const comboResult = await showAttackOptionsDialog(
    actor.name || "Unknown",
    power.name,
    rank,
    availableKarma,
    power.name,
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
  if (mpCost > 0 && reactiveActor.system.resources.mentalPoints) {
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
    // @ts-expect-error - charman property exists on system
    const charmanData = actor.system.charman;
    if (charmanData?.username && charmanData?.characterName) {
      try {
        const service = getCharmanService();
        await service.updateMP(
          charmanData.username,
          charmanData.characterName,
          reactiveActor.system.resources.mentalPoints!.value
        );
      } catch (error) {
        // Service not initialized or sync failed - ignore silently
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

        <!-- RESISTANCES & VULNERABILITIES Group -->
        <div
          v-if="resistancePowers.length > 0 || vulnerabilityPowers.length > 0"
          class="mb-3"
        >
          <div class="flex gap-2">
            <!-- Resistances Column -->
            <div class="basis-1/2 flex flex-col gap-1">
              <h3
                class="text-sm font-bold text-purple-400 mb-2 uppercase tracking-wider"
              >
                RESISTANCES
              </h3>
              <div
                v-for="power in resistancePowers"
                :key="power.id"
                class="p-2 bg-gray-800 rounded border border-gray-700"
              >
                <div class="flex items-center gap-2">
                  <span class="text-green-400">🛡️</span>
                  <div class="flex-1">
                    <div class="text-sm font-semibold text-gray-200">
                      {{ power.name }}
                    </div>
                    <div class="text-xs text-gray-400">
                      {{ formatRankDisplay(power.rank) }}: {{ power.value }}
                      <span class="text-green-400 ml-1">
                        vs {{ power.resistanceType }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="resistancePowers.length === 0"
                class="text-xs text-gray-500 italic p-2"
              >
                None
              </div>
            </div>
            <!-- Vulnerabilities Column -->
            <div class="basis-1/2 flex flex-col gap-1">
              <h3
                class="text-sm font-bold text-purple-400 mb-2 uppercase tracking-wider"
              >
                WEAKNESSES
              </h3>
              <div
                v-for="power in vulnerabilityPowers"
                :key="power.id"
                class="p-2 bg-gray-800 rounded border border-red-700"
              >
                <div class="flex items-center gap-2">
                  <span class="text-red-400">⚠️</span>
                  <div class="flex-1">
                    <div class="text-sm font-semibold text-gray-200">
                      {{ power.name }}
                    </div>
                    <div class="text-xs text-gray-400">
                      <span class="text-red-400">
                        +{{ vulnerabilityPercent }}% damage from
                        {{ power.vulnerabilityType }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="vulnerabilityPowers.length === 0"
                class="text-xs text-gray-500 italic p-2"
              >
                None
              </div>
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
                :disabled="!weapon.equipped"
                :class="[
                  'fsr-btn text-xs px-3 py-1 text-left flex-1',
                  weapon.equipped
                    ? 'fsr-btn-secondary'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed opacity-60'
                ]"
                :title="
                  weapon.equipped
                    ? `${weapon.name} (${formatWeaponDamage(weapon)}) - ${weapon.stat.toUpperCase()}${
                        (weapon.applicableTalents?.length || 0) > 0
                          ? ` + ${(weapon.applicableTalents || []).join(", ")}`
                          : ''
                      }${
                        weapon.armorPiercing
                          ? ` | AP: ${formatRankDisplay(weapon.armorPiercing)}`
                          : ''
                      }`
                    : 'Weapon must be equipped to attack'
                "
              >
                {{ weapon.type === "melee" ? "⚔️" : "🏹" }} {{ weapon.name }}
                <span class="ml-1 fsr-rank-badge text-xs">{{
                  formatWeaponDamage(weapon)
                }}</span>
                <span
                  v-if="weapon.armorPiercing"
                  class="ml-1 text-red-400"
                  :title="`Armor Piercing: ${formatRankDisplay(weapon.armorPiercing)}`"
                >
                  <i class="fas fa-shield-slash"></i>
                </span>
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
