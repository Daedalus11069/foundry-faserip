<template>
  <div class="fsr-hack-debuff-dialog">
    <p class="text-sm text-gray-300 mb-3">
      <strong>{{ targetName }}</strong> has been breached. Apply a debuff via
      an ActiveEffect, or skip.
    </p>

    <div class="space-y-3">
      <div class="space-y-2">
        <label class="font-semibold text-sm">Debuff Type</label>
        <select v-model="kind" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded">
          <option value="stat">Attribute Chart Shift</option>
          <option value="damage">Damage Chart Shift</option>
          <option value="incoming">Incoming Attack Modifier (foes hit easier)</option>
          <option value="forcedResult">Force Next Roll to Fail</option>
        </select>
      </div>

      <div v-if="kind === 'stat'" class="space-y-2">
        <label class="font-semibold text-sm">Attribute</label>
        <select v-model="attribute" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded">
          <option v-for="option in attributeChoices" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>

      <div v-if="kind === 'stat' || kind === 'damage' || kind === 'incoming'" class="space-y-2">
        <label class="font-semibold text-sm">Chart Shift</label>
        <input
          v-model.number="chartShift"
          type="number"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
        />
        <p class="text-xs text-gray-400">Negative shifts debuff; positive shifts on Incoming Attack Modifier make foes more likely to hit.</p>
      </div>

      <div v-if="kind === 'stat' || kind === 'damage' || kind === 'incoming'" class="space-y-2">
        <label class="font-semibold text-sm">Rounds Remaining</label>
        <input
          v-model.number="roundsRemaining"
          type="number"
          min="1"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
        />
      </div>

      <div class="space-y-2">
        <label class="font-semibold text-sm">Source Name</label>
        <input
          v-model="sourceName"
          type="text"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
        />
      </div>
    </div>

    <div class="dialog-buttons flex gap-2 justify-end mt-4">
      <button
        @click="handleSkip"
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
      >
        Skip
      </button>
      <button
        @click="handleConfirm"
        class="px-4 py-2 rounded bg-red-700 hover:bg-red-600"
      >
        Apply Debuff
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { VueDialog } from "../vue-dialog";

interface Props {
  dialog: VueDialog;
  targetName: string;
}

const props = defineProps<Props>();

const kind = ref<"stat" | "damage" | "incoming" | "forcedResult">("stat");
const attribute = ref("reasoning");
const chartShift = ref(-1);
const roundsRemaining = ref(3);
const sourceName = ref("Hacked");

const attributeChoices = [
  { value: "fighting", label: "Fighting" },
  { value: "agility", label: "Agility" },
  { value: "strength", label: "Strength" },
  { value: "endurance", label: "Endurance" },
  { value: "reasoning", label: "Reasoning" },
  { value: "intuition", label: "Intuition" },
  { value: "psyche", label: "Psyche" }
];

function handleConfirm() {
  props.dialog.submit({
    kind: kind.value,
    attribute: attribute.value,
    chartShift: Number(chartShift.value) || 0,
    roundsRemaining: Number(roundsRemaining.value) || 1,
    sourceName: sourceName.value
  });
}

function handleSkip() {
  props.dialog.submit(null);
}
</script>
