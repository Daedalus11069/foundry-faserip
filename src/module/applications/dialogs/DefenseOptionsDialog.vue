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
  defenderName: string;
  defenseAttribute: string;
  defenseRank: Rank;
  availableKarma: number;
  attackerName: string;
  attackRankDisplay?: string;
  attackRoll?: number;
  attackResult?: string;
  powerName?: string;
  talentCS?: number;
  dialog: VueDialog;
}

const props = defineProps<Props>();

// Attack result class for styling
const attackResultClass = computed(() => {
  if (!props.attackResult) return "";
  const result = props.attackResult.toLowerCase();
  if (result.includes("ultimate")) return "fsr-roll-red";
  if (result.includes("critical")) return "fsr-roll-red";
  if (result.includes("success") && !result.includes("half"))
    return "fsr-roll-yellow";
  if (result.includes("half")) return "fsr-roll-green";
  if (result.includes("failure")) return "fsr-roll-white";
  return "";
});

// Karma spending
const karmaColumnShifts = ref(0);
const karmaResultShift = ref(0);

// Defense modifiers
const manualChartShift = ref(0);

const totalKarmaCost = computed(() => {
  let total = 0;

  // Pre-roll cost (column shifts)
  if (karmaColumnShifts.value > 0) {
    const currentValue = RANK_VALUES[props.defenseRank] || 6;
    const shiftedRank = applyChartShift(
      props.defenseRank,
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
  return applyChartShift(props.defenseRank, totalShifts);
});

const preRollCost = computed(() => {
  if (karmaColumnShifts.value === 0) return 0;
  const currentValue = RANK_VALUES[props.defenseRank] || 6;
  const shiftedRank = applyChartShift(
    props.defenseRank,
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
  <div class="defense-options-dialog">
    <div class="mb-4 p-3 bg-red-900/30 rounded border border-red-700">
      <div class="text-sm mb-2 font-semibold text-red-300">
        <i class="fas fa-shield-halved"></i> Incoming Attack!
      </div>
      <div class="text-sm mb-1">
        <strong>Attacker: </strong> {{ attackerName }}
      </div>
      <div v-if="powerName" class="text-sm mb-1">
        <strong>Power: </strong> {{ powerName }}
      </div>
      <div v-if="attackRankDisplay" class="text-sm mb-1">
        <strong>Attack Rank: </strong> {{ attackRankDisplay }}
      </div>
      <div v-if="attackRoll" class="text-sm mb-1">
        <strong>Attack Roll: </strong>
        <span class="result-badge" :class="attackResultClass">{{
          attackRoll
        }}</span>
      </div>
      <div v-if="attackResult" class="text-sm mb-1">
        <strong>Result: </strong>
        <span class="result-badge" :class="attackResultClass">{{
          attackResult
        }}</span>
      </div>
    </div>

    <div class="mb-4 p-3 bg-blue-900/30 rounded">
      <div class="text-sm mb-2">
        <strong>{{ defenderName }}</strong> - {{ defenseAttribute }} Defense
      </div>
      <div class="text-sm">
        <strong>Defense Rank: </strong>
        <span
          v-if="karmaColumnShifts > 0 || manualChartShift !== 0"
          class="text-green-400"
        >
          {{ formatRankDisplay(defenseRank) }} →
          {{ formatRankDisplay(effectiveRank) }}
        </span>
        <span v-else>{{ formatRankDisplay(defenseRank) }}</span>
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
        <div v-if="karmaColumnShifts > 0" class="text-xs text-green-400 mt-1">
          Rank shift: {{ formatRankDisplay(defenseRank) }} →
          {{
            formatRankDisplay(applyChartShift(defenseRank, karmaColumnShifts))
          }}
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
        <strong>Total Karma Cost:</strong>
        <span :class="canAfford ? 'text-green-400' : 'text-red-400'">
          {{ totalKarmaCost }} / {{ availableKarma }}
        </span>
      </div>
    </div>

    <!-- Defense Modifiers Section -->
    <div class="mb-4 p-3 bg-gray-800/50 rounded">
      <h4 class="font-semibold mb-3">Defense Modifiers</h4>

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
          Optional bonus or penalty (e.g., +2 for cover, -2 for stunned)
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
          :class="[
            'text-xs mt-1',
            manualChartShift > 0 ? 'text-green-400' : 'text-red-400'
          ]"
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
        Take Hit
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
        Roll Defense
      </button>
    </div>
  </div>
</template>

<style scoped>
.defense-options-dialog {
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

.result-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 600;
  display: inline-block;
}

.fsr-roll-red {
  background-color: rgba(220, 38, 38, 0.3);
  color: #fca5a5;
  border: 1px solid #dc2626;
}

.fsr-roll-yellow {
  background-color: rgba(234, 179, 8, 0.3);
  color: #fde047;
  border: 1px solid #eab308;
}

.fsr-roll-green {
  background-color: rgba(34, 197, 94, 0.3);
  color: #86efac;
  border: 1px solid #22c55e;
}

.fsr-roll-white {
  background-color: rgba(156, 163, 175, 0.3);
  color: #d1d5db;
  border: 1px solid #9ca3af;
}
</style>
