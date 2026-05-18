<script setup lang="ts">
import { inject, computed, ref } from "vue";
import { formatRankDisplay } from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { stringToRank } from "../../utils";
import {
  showTalentSelectionDialog,
  showComboDialog
} from "../../applications/dialog-utils";
import type { Talent, Power, Form } from "../../types";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor;

const currentForm = computed<Form | undefined>(() => {
  const forms = reactiveActor.system.forms || [];
  return (
    forms.find((f: Form) => f.id === reactiveActor.system.currentFormId) ||
    forms[0]
  );
});

const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);
const powers = computed<Power[]>(() => reactiveActor.system.powers || []);

// Damage/Healing
const damageAmount = ref(0);

async function applyDamage() {
  if (damageAmount.value === 0) return;

  const health = reactiveActor.system.resources.health;
  const newValue = Math.max(0, health.value - damageAmount.value);

  // Update reactive actor (base sheet class handles syncing to Foundry actor)
  reactiveActor.system.resources.health.value = newValue;

  damageAmount.value = 0;
}

async function applyHealing() {
  if (damageAmount.value === 0) return;

  const health = reactiveActor.system.resources.health;
  const newValue = Math.min(health.max, health.value + damageAmount.value);

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
  let totalCS = attr.bonus || 0;
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

  // Check if this is an attack stat (Fighting or Agility)
  const isAttackStat = attrKey === "fighting" || attrKey === "agility";

  if (isAttackStat) {
    // Get available karma
    const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

    // Prompt for combo attack with karma options
    const comboResult = await showComboDialog(attrLabel, rank, availableKarma);

    if (comboResult === null) {
      // User cancelled
      return;
    }

    if (comboResult.comboCount > 1) {
      // Execute combo attack with karma settings
      await FaseripRoll.rollComboAttack(
        attrLabel,
        rank,
        attr.value,
        totalCS,
        comboResult.comboCount,
        actor,
        talentNames,
        undefined,
        comboResult.attackKarmaSettings
      );
    } else {
      // Single attack - use karma settings from first attack if any
      const firstAttackKarma = comboResult.attackKarmaSettings[0];
      await FaseripRoll.rollAttribute(
        attrLabel,
        rank,
        attr.value,
        totalCS,
        actor,
        talentNames,
        undefined,
        firstAttackKarma?.columnShifts || undefined,
        firstAttackKarma?.resultShift || undefined
      );
    }
  } else {
    // Non-attack stat - regular roll
    await FaseripRoll.rollAttribute(
      attrLabel,
      rank,
      attr.value,
      totalCS,
      actor,
      talentNames,
      undefined,
      undefined,
      undefined
    );
  }
}

async function rollPower(power: any) {
  if (!currentForm.value) return;

  const rank = stringToRank(power.rank);
  const rankValue = currentForm.value.attributes.psyche.value; // Use psyche value as base

  // Show talent selection dialog if talents are available
  let totalCS = 0;
  let talentNames: string[] = [];

  if (talents.value.length > 0) {
    const selectedTalents = await showTalentSelectionDialog(
      talents.value,
      power.name
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

  await FaseripRoll.rollAttribute(
    power.name,
    rank,
    rankValue,
    totalCS,
    actor,
    talentNames,
    undefined,
    undefined,
    undefined
  );
}
</script>

<template>
  <div v-if="currentForm">
    <!-- Damage/Healing Section -->
    <div class="mb-4 p-3 bg-gray-800 rounded border border-gray-700">
      <h3 class="text-sm font-bold text-gray-300 mb-2 uppercase tracking-wider">
        Health Management
      </h3>
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
      <div class="mt-2 text-xs text-gray-400">
        Current Health: {{ reactiveActor.system.resources.health.value }} /
        {{ reactiveActor.system.resources.health.max }}
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
              <span
                v-if="
                  currentForm.attributes[attr.key].bonus &&
                  currentForm.attributes[attr.key].bonus !== 0
                "
                class="text-xs"
              >
                {{ currentForm.attributes[attr.key].bonus! >= 0 ? "+" : ""
                }}{{ currentForm.attributes[attr.key].bonus }}
              </span>
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
              <span
                v-if="
                  currentForm.attributes[attr.key].bonus &&
                  currentForm.attributes[attr.key].bonus !== 0
                "
                class="text-xs"
              >
                {{ currentForm.attributes[attr.key].bonus! >= 0 ? "+" : ""
                }}{{ currentForm.attributes[attr.key].bonus }}
              </span>
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
          :title="`${power.name} (${formatRankDisplay(power.rank)})`"
        >
          ⚡ {{ power.name }}
        </button>
      </div>
    </div>
  </div>
</template>
