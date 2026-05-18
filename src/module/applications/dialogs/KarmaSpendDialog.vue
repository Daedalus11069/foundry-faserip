<template>
  <div class="fsr-karma-dialog">
    <div class="mb-4 p-3 bg-blue-900/30 rounded">
      <div class="text-sm mb-2">
        <strong>Available Karma:</strong> {{ availableKarma }}
      </div>
      <div class="text-xs text-gray-400">
        <div>
          • Pre-roll: Column Shift cost based on rank difference (min 10)
        </div>
        <div>• Post-roll: 1:1 karma per die point (min 10)</div>
      </div>
    </div>

    <div class="space-y-3">
      <div v-if="phase === 'pre-roll'" class="space-y-2">
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
            <strong>Karma Cost:</strong> {{ preRollKarmaCost }}
          </div>
          <div class="text-gray-400 text-xs">
            {{ formatRankDisplay(currentRank || "") }} →
            {{ getShiftedRankName(columnShifts) }}
          </div>
        </div>
      </div>

      <div v-if="phase === 'post-roll'" class="space-y-2">
        <div class="text-sm mb-2">
          <strong>Current Roll:</strong> {{ currentRoll }}
        </div>
        <label class="font-semibold text-sm">Points to Add to Roll</label>
        <input
          type="number"
          v-model.number="dieModifier"
          :min="0"
          :max="maxDieModifier"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
          placeholder="Enter die modifier"
        />
        <div v-if="dieModifier > 0" class="text-sm space-y-1">
          <div class="text-blue-400">
            New Roll: +{{ (currentRoll || 0) + dieModifier }}
          </div>
          <div class="text-yellow-400">
            <strong>Karma Cost:</strong> {{ postRollKarmaCost }}
          </div>
        </div>
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
        Spend Karma
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
  phase: "pre-roll" | "post-roll";
  currentRoll?: number;
  currentRank?: string;
  dialog: VueDialog;
}

const props = defineProps<Props>();

// Separate inputs for pre-roll (column shifts) and post-roll (die modifier)
const columnShifts = ref(0);
const dieModifier = ref(0);

// Calculate karma cost for pre-roll (based on rank score difference)
const preRollKarmaCost = computed(() => {
  if (
    props.phase !== "pre-roll" ||
    columnShifts.value === 0 ||
    !props.currentRank
  ) {
    return 0;
  }

  const currentRankValue = RANK_VALUES[props.currentRank as Rank] || 6;
  const newRank = applyChartShift(
    props.currentRank as Rank,
    columnShifts.value
  );
  const newRankValue = RANK_VALUES[newRank] || 6;
  const scoreDiff = newRankValue - currentRankValue;

  return Math.max(10, scoreDiff);
});

// Calculate karma cost for post-roll (1:1 with minimum 10)
const postRollKarmaCost = computed(() => {
  if (props.phase !== "post-roll" || dieModifier.value === 0) {
    return 0;
  }

  return Math.max(10, dieModifier.value);
});

// Max column shifts based on available karma (approximation)
const maxColumnShifts = computed(() => {
  if (props.phase !== "pre-roll") return 0;

  // Try to find max affordable shifts (limit to 5 for safety)
  let maxShifts = 0;
  for (let i = 1; i <= 5; i++) {
    const testRank = applyChartShift(props.currentRank as Rank, i);
    const testValue = RANK_VALUES[testRank] || 6;
    const currentValue = RANK_VALUES[props.currentRank as Rank] || 6;
    const cost = Math.max(10, testValue - currentValue);

    if (cost <= props.availableKarma) {
      maxShifts = i;
    } else {
      break;
    }
  }

  return maxShifts;
});

// Max die modifier based on available karma and roll cap
const maxDieModifier = computed(() => {
  if (props.phase !== "post-roll" || !props.currentRoll) return 0;

  // Can't go over 100
  const maxByRoll = 100 - props.currentRoll;

  // Can spend up to available karma (1:1 ratio, but cost min 10)
  const maxByKarma = props.availableKarma;

  return Math.min(maxByRoll, maxByKarma);
});

// Helper to get shifted rank name for display
function getShiftedRankName(shifts: number): string {
  if (!props.currentRank) return "";
  const newRank = applyChartShift(props.currentRank as Rank, shifts);
  return formatRankDisplay(newRank);
}

// Check if can confirm
const canConfirm = computed(() => {
  if (props.phase === "pre-roll") {
    return (
      columnShifts.value > 0 && preRollKarmaCost.value <= props.availableKarma
    );
  } else {
    return (
      dieModifier.value > 0 && postRollKarmaCost.value <= props.availableKarma
    );
  }
});

function handleConfirm() {
  if (props.phase === "pre-roll" && columnShifts.value > 0) {
    props.dialog.submit({
      karmaSpent: preRollKarmaCost.value,
      columnShifts: columnShifts.value
    });
  } else if (props.phase === "post-roll" && dieModifier.value > 0) {
    props.dialog.submit({
      karmaSpent: postRollKarmaCost.value,
      dieModifier: dieModifier.value
    });
  }
}

function handleSkip() {
  props.dialog.submit(null);
}
</script>

<style scoped>
.fsr-karma-dialog {
  padding: 1rem;
  min-width: 400px;
}
</style>
