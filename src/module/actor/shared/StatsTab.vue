<script setup lang="ts">
import { inject, computed, ref, watch } from "vue";
import { formatRankDisplay } from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { stringToRank, calculateHealth } from "../../utils";
import { getCharmanService } from "../../charman-service";
import {
  showTalentSelectionDialog,
  showComboDialog
} from "../../applications/dialog-utils";
import type { Talent, Power, Form } from "../../types";

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
const powers = computed<Power[]>(() =>
  (reactiveActor.system.powers || []).filter(
    (p: Power) => !p.formIds?.length || p.formIds.includes(viewFormId.value)
  )
);

// Check if MP (Mental Points) system is enabled
const mpEnabled = computed(
  () => game.settings.get("faserip", "mpEnabled") ?? false
);

const armorEnabled = computed(
  () => game.settings.get("faserip", "armorEnabled") ?? false
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

  // Body Armor power soaks first (always active)
  if (bodyArmorPower.value) {
    const powerSoak = Math.min(incoming, bodyArmorPower.value.value);
    if (powerSoak > 0) {
      soakSources.push(`${bodyArmorPower.value.name} –${powerSoak}`);
      incoming = Math.max(0, incoming - powerSoak);
    }
  }

  // Equipped armor soaks remainder (house rule setting)
  if (equippedArmor.value && incoming > 0) {
    const armorSoak = Math.min(incoming, equippedArmor.value.value);
    if (armorSoak > 0) {
      soakSources.push(`${equippedArmor.value.name} –${armorSoak}`);
      incoming = Math.max(0, incoming - armorSoak);
    }
  }

  reactiveActor.system.resources.health.value = Math.max(
    -20,
    healthValue.value - incoming
  );

  if (soakSources.length > 0) {
    ui.notifications?.info(
      `Absorbed: ${soakSources.join(", ")}. ${incoming} damage applied.`
    );
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
          <span>absorbs {{ bodyArmorPower.value }}</span>
        </span>
        <span v-if="equippedArmor" class="flex items-center gap-1">
          🛡️ <span>{{ equippedArmor.name }}</span>
          <span class="fsr-rank-badge">{{ equippedArmor.rank }}</span>
          <span>absorbs {{ equippedArmor.value }}</span>
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

    <!-- PHYSICAL Group -->
    <div class="mb-3">
      <h3 class="text-sm font-bold text-red-400 mb-2 uppercase tracking-wider">
        PHYSICAL
      </h3>
      <div class="fsr-grid fsr-grid-2">
        <div v-for="attr in faseAttributes" :key="attr.key" class="fsr-stat">
          <div class="flex justify-between items-start mb-1">
            <div>
              <div class="fsr-stat-name">{{ attr.icon }} {{ attr.label }}</div>
              <div class="fsr-stat-rank">
                {{ formatRankDisplay(currentForm.attributes[attr.key].rank) }}
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
      <h3 class="text-sm font-bold text-blue-400 mb-2 uppercase tracking-wider">
        MENTAL
      </h3>
      <div class="fsr-grid fsr-grid-3">
        <div v-for="attr in ripAttributes" :key="attr.key" class="fsr-stat">
          <div class="flex justify-between items-start mb-1">
            <div>
              <div class="fsr-stat-name">{{ attr.icon }} {{ attr.label }}</div>
              <div class="fsr-stat-rank">
                {{ formatRankDisplay(currentForm.attributes[attr.key].rank) }}
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

    <!-- POWERS Quick-Roll Section -->
    <div v-if="powers.length > 0" class="mb-3">
      <h3
        class="text-sm font-bold text-purple-400 mb-2 uppercase tracking-wider"
      >
        POWERS
      </h3>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="power in powers"
          :key="power.id"
          @click="rollPower(power)"
          class="fsr-btn fsr-btn-secondary text-xs px-3 py-1"
          :title="`${power.name} (${formatRankDisplay(power.rank)})${
            mpEnabled && power.mpCost ? ` - MP Cost: ${power.mpCost}` : ''
          }`"
        >
          ⚡ {{ power.name }}
          <span v-if="mpEnabled && power.mpCost" class="ml-1 text-yellow-400">
            ({{ power.mpCost }} MP)
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
