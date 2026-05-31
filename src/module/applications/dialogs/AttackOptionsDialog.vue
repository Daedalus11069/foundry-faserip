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
  attackerName: string;
  attackAttribute: string;
  attackRank: Rank;
  availableKarma: number;
  powerName?: string;
  talentCS?: number;
  dialog: VueDialog;
}

const props = defineProps<Props>();

// Karma spending
const karmaColumnShifts = ref(0);
const karmaResultShift = ref(0);

// Attack modifiers
const manualChartShift = ref(0);

const totalKarmaCost = computed(() => {
  let total = 0;

  // Pre-roll cost (column shifts)
  if (karmaColumnShifts.value > 0) {
    const currentValue = RANK_VALUES[props.attackRank] || 6;
    const shiftedRank = applyChartShift(
      props.attackRank,
      karmaColumnShifts.value
    );
    const shiftedValue = RANK_VALUES[shiftedRank] || 6;
    const scoreDiff = Math.abs(shiftedValue - currentValue);
    total += Math.max(10, scoreDiff);
  }

  // Post-roll cost (result shift)
  if (karmaResultShift.value > 0) {
    total += Math.max(10, karmaResultShift.value);
  }

  return total;
});

const canAfford = computed(() => totalKarmaCost.value <= props.availableKarma);

const effectiveRank = computed(() => {
  const totalShifts =
    karmaColumnShifts.value + manualChartShift.value + (props.talentCS || 0);
  return applyChartShift(props.attackRank, totalShifts);
});

const preRollCost = computed(() => {
  if (karmaColumnShifts.value === 0) return 0;
  const currentValue = RANK_VALUES[props.attackRank] || 6;
  const shiftedRank = applyChartShift(
    props.attackRank,
    karmaColumnShifts.value
  );
  const shiftedValue = RANK_VALUES[shiftedRank] || 6;
  const scoreDiff = Math.abs(shiftedValue - currentValue);
  return Math.max(10, scoreDiff);
});

const postRollCost = computed(() => {
  if (karmaResultShift.value === 0) return 0;
  return Math.max(10, karmaResultShift.value);
});

function handleSubmit() {
  if (!canAfford.value) {
    return;
  }

  props.dialog.submit({
    karmaColumnShifts: karmaColumnShifts.value,
    karmaResultShift: karmaResultShift.value,
    manualChartShift: manualChartShift.value
  });
}

function handleCancel() {
  props.dialog.submit(null);
}
</script>

<template>
  <div class="attack-options-dialog">
    <div class="mb-4 p-3 bg-blue-900/30 rounded">
      <div class="text-sm mb-2">
        <strong>{{ attackerName }}</strong> -
        {{ powerName || attackAttribute + " Attack" }}
      </div>
      <div class="text-sm">
        <strong>Attack Rank: </strong>
        <span v-if="effectiveRank !== attackRank">
          <span class="text-gray-400">{{ formatRankDisplay(attackRank) }}</span>
          <span class="text-green-400">
            → {{ formatRankDisplay(effectiveRank) }}</span
          >
        </span>
        <span v-else>{{ formatRankDisplay(attackRank) }}</span>
      </div>
      <div class="text-sm">
        <strong>Available Karma: </strong> {{ availableKarma }}
      </div>
    </div>

    <!-- Karma Spending Section -->
    <div class="mb-4 p-3 bg-purple-900/30 rounded border border-purple-700">
      <h4 class="font-semibold mb-3 text-purple-300">Karma Spending</h4>

      <!-- Pre-Roll Column Shifts -->
      <div class="f-group mb-3">
        <label class="font-semibold text-sm">Pre-Roll Column Shifts</label>
        <div class="text-xs text-gray-400 mb-2">
          Shift to a higher rank before rolling (cost: rank difference, min 10)
        </div>
        <div class="flex items-center gap-2">
          <input
            type="number"
            v-model.number="karmaColumnShifts"
            :min="0"
            :max="10"
            class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded"
            placeholder="0"
          />
          <div class="text-sm text-gray-300" style="min-width: 120px">
            Cost: {{ preRollCost }}
          </div>
        </div>
      </div>

      <!-- Post-Roll Result Shift -->
      <div class="f-group mb-3">
        <label class="font-semibold text-sm">Post-Roll Result Shift</label>
        <div class="text-xs text-gray-400 mb-2">
          Add to roll result after seeing it (cost: 1:1 karma per point, min 10)
        </div>
        <div class="flex items-center gap-2">
          <input
            type="number"
            v-model.number="karmaResultShift"
            :min="0"
            :max="100"
            class="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded"
            placeholder="0"
          />
          <div class="text-sm text-gray-300" style="min-width: 120px">
            Cost: {{ postRollCost }}
          </div>
        </div>
      </div>

      <!-- Total Karma Cost -->
      <div class="text-sm mt-2 pt-2 border-t border-purple-800">
        <strong>Total Karma Cost: </strong>
        <span :class="canAfford ? 'text-green-400' : 'text-red-400'">
          {{ totalKarmaCost }} / {{ availableKarma }}
        </span>
      </div>
    </div>

    <!-- Other Modifiers Section -->
    <div class="mb-4 p-3 bg-gray-800/50 rounded">
      <h4 class="font-semibold mb-3">Attack Modifiers</h4>

      <!-- Talent Bonus Display -->
      <div
        v-if="talentCS && talentCS !== 0"
        class="mb-3 p-2 bg-orange-900/30 rounded border border-orange-700"
      >
        <div class="text-sm text-orange-300">
          <strong>Talent Bonus:</strong>
          <span class="ml-2"
            >{{ talentCS > 0 ? "+" : "" }}{{ talentCS }} CS</span
          >
        </div>
      </div>

      <div class="f-group">
        <label class="font-semibold text-sm">Situational Chart Shift</label>
        <div class="text-xs text-gray-400 mb-2">
          Optional bonus or penalty (e.g., +2 for advantage, -2 for darkness)
        </div>
        <input
          type="number"
          v-model.number="manualChartShift"
          :min="-10"
          :max="10"
          class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
          placeholder="0"
        />
        <div
          v-if="manualChartShift !== 0"
          class="text-xs mt-1"
          :class="manualChartShift > 0 ? 'text-green-400' : 'text-red-400'"
        >
          {{ manualChartShift > 0 ? "+" : "" }}{{ manualChartShift }} rank shift
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="flex gap-2">
      <button
        @click="handleCancel"
        class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
      >
        Cancel
      </button>
      <button
        @click="handleSubmit"
        :disabled="!canAfford"
        :class="[
          'flex-1 px-4 py-2 rounded font-semibold',
          canAfford
            ? 'bg-blue-600 hover:bg-blue-500'
            : 'bg-gray-600 cursor-not-allowed opacity-50'
        ]"
      >
        Roll Attack
      </button>
    </div>
  </div>
</template>

<style scoped>
.attack-options-dialog {
  padding: 1rem;
  min-width: 500px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
}

.f-group {
  margin-bottom: 1rem;
}

.f-group label {
  display: block;
  margin-bottom: 0.25rem;
}

input[type="number"] {
  color: #fff;
}

input[type="number"]:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

button:disabled {
  cursor: not-allowed;
}
</style>
