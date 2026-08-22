<template>
  <div class="fsr-intuition-dialog">
    <div class="mb-4 p-3 bg-blue-900/30 rounded">
      <div class="text-sm mb-2">
        <strong>Available Karma:</strong> {{ availableKarma }}
      </div>
      <div class="text-xs text-gray-400">
        <div>
          • Column Shifts: Karma cost based on rank difference (min 10)
        </div>
        <div>• Result Shift: 1:1 karma per point added to the roll (min 10)</div>
      </div>
    </div>

    <div class="space-y-3">
      <div class="space-y-2">
        <label class="font-semibold text-sm"
          >Manual Chart Shift (Optional)</label
        >
        <div class="text-xs text-gray-400 mb-1">
          Bonus or penalty to the roll (e.g., +2 or -1)
        </div>
        <input
          type="number"
          v-model.number="manualChartShift"
          :min="-10"
          :max="10"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
          placeholder="0"
        />
      </div>

      <div class="space-y-2">
        <label class="font-semibold text-sm">Column Shifts to Apply</label>
        <input
          type="number"
          v-model.number="columnShifts"
          :min="0"
          :max="maxColumnShifts"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
          placeholder="Enter column shifts"
        />
        <div v-if="columnShifts > 0" class="text-sm space-y-1">
          <div class="text-blue-400">
            +{{ columnShifts }} Column Shift{{ columnShifts !== 1 ? "s" : "" }}
          </div>
          <div class="text-yellow-400">
            <strong>Karma Cost:</strong> {{ columnShiftKarmaCost }}
          </div>
          <div class="text-gray-400 text-xs">
            {{ formatRankDisplay(currentRank || "") }} →
            {{ getShiftedRankName(columnShifts) }}
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <label class="font-semibold text-sm">Result Shift</label>
        <div class="text-xs text-gray-400 mb-1">
          Points to add directly to the final roll total
        </div>
        <input
          type="number"
          v-model.number="resultShift"
          :min="0"
          :max="maxResultShift"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
          placeholder="Enter result shift"
        />
        <div v-if="resultShift > 0" class="text-sm space-y-1">
          <div class="text-blue-400">+{{ resultShift }} to Roll Total</div>
          <div class="text-yellow-400">
            <strong>Karma Cost:</strong> {{ resultShiftKarmaCost }}
          </div>
        </div>
      </div>

      <div
        class="text-sm font-semibold p-2 rounded bg-gray-800/60"
        :class="totalKarmaCost > availableKarma ? 'text-red-400' : ''"
      >
        Total Karma Cost: {{ totalKarmaCost }} / {{ availableKarma }}
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
        :disabled="!canConfirm"
        :class="[
          'px-4 py-2 rounded',
          !canConfirm
            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-500'
        ]"
      >
        Roll
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import type { VueDialog } from "../vue-dialog";
import {
  Rank,
  RANK_VALUES,
  applyChartShift,
  formatRankDisplay
} from "../../enums";

interface Props {
  availableKarma: number;
  currentRank?: string;
  dialog: VueDialog;
}

const props = defineProps<Props>();

const manualChartShift = ref(0);
const columnShifts = ref(0);
const resultShift = ref(0);

const columnShiftKarmaCost = computed(() => {
  if (columnShifts.value === 0 || !props.currentRank) return 0;

  const currentRankValue = RANK_VALUES[props.currentRank as Rank] || 6;
  const newRank = applyChartShift(
    props.currentRank as Rank,
    columnShifts.value
  );
  const newRankValue = RANK_VALUES[newRank] || 6;
  const scoreDiff = newRankValue - currentRankValue;

  return Math.max(10, scoreDiff);
});

const resultShiftKarmaCost = computed(() => {
  if (resultShift.value === 0) return 0;
  return Math.max(10, resultShift.value);
});

const totalKarmaCost = computed(
  () => columnShiftKarmaCost.value + resultShiftKarmaCost.value
);

const maxColumnShifts = computed(() => {
  let maxShifts = 0;
  for (let i = 1; i <= 5; i++) {
    const testRank = applyChartShift(props.currentRank as Rank, i);
    const testValue = RANK_VALUES[testRank] || 6;
    const currentValue = RANK_VALUES[props.currentRank as Rank] || 6;
    const cost = Math.max(10, testValue - currentValue);

    if (cost + resultShiftKarmaCost.value <= props.availableKarma) {
      maxShifts = i;
    } else {
      break;
    }
  }
  return maxShifts;
});

const maxResultShift = computed(() => {
  const remaining = props.availableKarma - columnShiftKarmaCost.value;
  return Math.max(0, remaining);
});

function getShiftedRankName(shifts: number): string {
  if (!props.currentRank) return "";
  const newRank = applyChartShift(props.currentRank as Rank, shifts);
  return formatRankDisplay(newRank);
}

const canConfirm = computed(() => {
  return (
    (columnShifts.value > 0 || resultShift.value > 0) &&
    totalKarmaCost.value <= props.availableKarma
  );
});

function handleConfirm() {
  props.dialog.submit({
    karmaSpent: totalKarmaCost.value,
    columnShifts: columnShifts.value,
    resultShift: resultShift.value,
    manualChartShift: manualChartShift.value
  });
}

function handleSkip() {
  if (manualChartShift.value !== 0) {
    props.dialog.submit({
      karmaSpent: 0,
      manualChartShift: manualChartShift.value
    });
  } else {
    props.dialog.submit(null);
  }
}
</script>

<style scoped>
.fsr-intuition-dialog {
  padding: 1rem;
  min-width: 400px;
}
</style>
