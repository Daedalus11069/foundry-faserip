<script setup lang="ts">
import { ref, computed, watch } from "vue";
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

interface AttackKarma {
  columnShifts: number;
  resultShift: number;
}

const props = defineProps<Props>();

// Combo attack settings
const comboCount = ref(1);
const manualChartShift = ref(0);
const attackKarmaSettings = ref<AttackKarma[]>([
  { columnShifts: 0, resultShift: 0 }
]);

// Watch combo count and adjust karma settings array
watch(comboCount, (newCount, oldCount) => {
  if (newCount > oldCount) {
    // Add new entries
    for (let i = oldCount; i < newCount; i++) {
      attackKarmaSettings.value.push({ columnShifts: 0, resultShift: 0 });
    }
  } else if (newCount < oldCount) {
    // Remove excess entries
    attackKarmaSettings.value = attackKarmaSettings.value.slice(0, newCount);
  }
});

// Check if first attack is using karma
const firstAttackUsesKarma = computed(() => {
  const firstAttack = attackKarmaSettings.value[0];
  return (
    firstAttack && (firstAttack.columnShifts > 0 || firstAttack.resultShift > 0)
  );
});

// Watch first attack karma usage and clear subsequent attacks if it becomes 0
watch(firstAttackUsesKarma, usesKarma => {
  if (!usesKarma) {
    // Clear karma from all subsequent attacks
    for (let i = 1; i < attackKarmaSettings.value.length; i++) {
      attackKarmaSettings.value[i].columnShifts = 0;
      attackKarmaSettings.value[i].resultShift = 0;
    }
  }
});

const totalKarmaCost = computed(() => {
  let total = 0;

  attackKarmaSettings.value.forEach((attack, index) => {
    // Pre-roll cost (column shifts)
    if (attack.columnShifts > 0) {
      const comboPenalty = getAttackPenalty(index);
      const effectiveRank = applyChartShift(props.attackRank, comboPenalty);
      const totalShifts = attack.columnShifts + (props.talentCS || 0);
      const shiftedRank = applyChartShift(effectiveRank, totalShifts);
      const shiftedValue = RANK_VALUES[shiftedRank] || 6;
      const effectiveValue = RANK_VALUES[effectiveRank] || 6;
      const scoreDiff = Math.abs(shiftedValue - effectiveValue);
      total += Math.max(10, scoreDiff);
    }

    // Post-roll cost (result shift)
    if (attack.resultShift > 0) {
      total += Math.max(10, attack.resultShift);
    }
  });

  return total;
});

const canAfford = computed(() => totalKarmaCost.value <= props.availableKarma);

// Display rank with manual chart shift and talent bonuses applied
const displayedAttackRank = computed(() => {
  const totalShifts = manualChartShift.value + (props.talentCS || 0);
  if (totalShifts === 0) {
    return formatRankDisplay(props.attackRank);
  }
  const effectiveRank = applyChartShift(props.attackRank, totalShifts);
  return formatRankDisplay(effectiveRank);
});

// Check if rank has been modified from base
const rankIsModified = computed(() => {
  return (
    manualChartShift.value !== 0 || (props.talentCS && props.talentCS !== 0)
  );
});

function getAttackPenalty(attackIndex: number): number {
  // Only apply penalty if there's more than 1 attack
  if (comboCount.value === 1) return 0;
  return -(attackIndex + 1);
}

function getEffectiveRank(attackIndex: number, columnShifts: number = 0): Rank {
  const comboPenalty = getAttackPenalty(attackIndex);
  const baseRank = applyChartShift(props.attackRank, comboPenalty);
  const totalShifts =
    columnShifts + (props.talentCS || 0) + manualChartShift.value;
  return applyChartShift(baseRank, totalShifts);
}

function getPreRollCost(attackIndex: number, columnShifts: number): number {
  const totalShifts = columnShifts + (props.talentCS || 0);
  if (totalShifts === 0) return 0;

  const comboPenalty = getAttackPenalty(attackIndex);
  const effectiveRank = applyChartShift(props.attackRank, comboPenalty);
  const shiftedRank = applyChartShift(effectiveRank, totalShifts);

  const effectiveValue = RANK_VALUES[effectiveRank] || 6;
  const shiftedValue = RANK_VALUES[shiftedRank] || 6;
  const scoreDiff = Math.abs(shiftedValue - effectiveValue);

  return Math.max(10, scoreDiff);
}

function getPostRollCost(resultShift: number): number {
  if (resultShift === 0) return 0;
  return Math.max(10, resultShift);
}

function handleSubmit() {
  if (!canAfford.value) {
    return;
  }

  props.dialog.submit({
    comboCount: comboCount.value,
    attackKarmaSettings: attackKarmaSettings.value,
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
        <span v-if="!rankIsModified">
          {{ displayedAttackRank }}
        </span>
        <span v-else>
          <span class="text-gray-400 line-through">{{
            formatRankDisplay(attackRank)
          }}</span>
          →
          <span
            :class="
              manualChartShift > 0 || (talentCS && talentCS > 0)
                ? 'text-green-400 font-semibold'
                : 'text-red-400 font-semibold'
            "
          >
            {{ displayedAttackRank }}
          </span>
        </span>
      </div>
      <div class="text-sm">
        <strong>Available Karma: </strong> {{ availableKarma }}
      </div>
      <div class="text-xs text-gray-400 mt-2">
        <div>
          • Pre-roll: Column Shift cost based on rank difference (min 10)
        </div>
        <div>• Post-roll: 1:1 karma per die point (min 10)</div>
      </div>
    </div>

    <!-- Display applied talents -->
    <div
      v-if="talentCS && talentCS !== 0"
      class="mb-4 p-3 bg-orange-900/30 rounded border border-orange-700"
    >
      <div class="text-sm text-orange-300">
        <strong>Talent Bonus:</strong>
        <span class="ml-2">{{ talentCS > 0 ? "+" : "" }}{{ talentCS }} CS</span>
      </div>
    </div>

    <!-- Combo Count -->
    <div class="f-group mb-4">
      <label class="font-semibold text-sm">Number of Attacks in Combo</label>
      <input
        type="number"
        v-model.number="comboCount"
        :min="1"
        :max="10"
        class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded"
        placeholder="1"
      />
    </div>

    <!-- Manual Chart Shift -->
    <div class="f-group mb-4">
      <label class="font-semibold text-sm">Manual Chart Shift</label>
      <div class="text-xs text-gray-400 mb-2">
        Optional bonus or penalty to all rolls (e.g., +2 or -1)
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
        class="text-sm mt-2 p-2 rounded"
        :class="
          manualChartShift > 0
            ? 'bg-green-900/30 text-green-300'
            : 'bg-red-900/30 text-red-300'
        "
      >
        {{ manualChartShift > 0 ? "+" : "" }}{{ manualChartShift }} Chart Shift
      </div>
    </div>

    <!-- Attack-by-attack karma settings -->
    <div class="mb-4 space-y-3 max-h-96 overflow-y-auto">
      <div
        v-for="(attack, index) in attackKarmaSettings"
        :key="index"
        class="p-3 bg-gray-800 rounded border border-gray-700"
      >
        <div class="flex justify-between items-center mb-2">
          <div class="font-semibold text-sm text-yellow-400">
            Attack {{ index + 1
            }}<span v-if="getAttackPenalty(index) !== 0">
              ({{ getAttackPenalty(index) }} CS penalty)</span
            >
          </div>
          <div class="text-xs text-gray-400">
            <span v-if="talentCS && talentCS !== 0">
              Rank with Talents:
              {{ formatRankDisplay(getEffectiveRank(index, 0)) }}
            </span>
            <span v-else>
              Base Rank: {{ formatRankDisplay(getEffectiveRank(index, 0)) }}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <!-- Pre-roll: Column Shifts -->
          <div>
            <label class="text-xs text-gray-400 block mb-1">Pre-roll CS</label>
            <input
              type="number"
              v-model.number="attack.columnShifts"
              :min="0"
              :max="5"
              :disabled="index > 0 && !firstAttackUsesKarma"
              class="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="0"
            />
            <div v-if="attack.columnShifts > 0" class="text-xs mt-1">
              <div class="text-blue-400">
                →
                {{
                  formatRankDisplay(
                    getEffectiveRank(index, attack.columnShifts)
                  )
                }}
              </div>
              <div class="text-yellow-500">
                Cost: {{ getPreRollCost(index, attack.columnShifts) }} karma
              </div>
            </div>
            <div
              v-if="index > 0 && !firstAttackUsesKarma"
              class="text-xs text-gray-500 mt-1 italic"
            >
              Enable karma on Attack 1 first
            </div>
          </div>

          <!-- Post-roll: Result Shift -->
          <div>
            <label class="text-xs text-gray-400 block mb-1"
              >Post-roll +dice</label
            >
            <input
              type="number"
              v-model.number="attack.resultShift"
              :min="0"
              :max="100"
              :disabled="index > 0 && !firstAttackUsesKarma"
              class="w-full px-2 py-1 bg-gray-900 border border-gray-600 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="0"
            />
            <div v-if="attack.resultShift > 0" class="text-xs mt-1">
              <div class="text-green-400">
                +{{ attack.resultShift }} to roll
              </div>
              <div class="text-yellow-500">
                Cost: {{ getPostRollCost(attack.resultShift) }} karma
              </div>
            </div>
            <div
              v-if="index > 0 && !firstAttackUsesKarma"
              class="text-xs text-gray-500 mt-1 italic"
            >
              Enable karma on Attack 1 first
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Total karma cost display -->
    <div
      class="mb-4 p-3 rounded border"
      :class="
        canAfford
          ? 'bg-green-900/20 border-green-700'
          : 'bg-red-900/20 border-red-700'
      "
    >
      <div class="flex justify-between items-center">
        <span class="text-sm font-semibold">Total Karma Cost:</span>
        <span
          class="text-lg font-bold"
          :class="canAfford ? 'text-green-400' : 'text-red-400'"
        >
          {{ totalKarmaCost }} / {{ availableKarma }}
        </span>
      </div>
      <div v-if="!canAfford" class="text-xs text-red-400 mt-1">
        Insufficient karma! Reduce karma spending.
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
        {{ comboCount > 1 ? "Execute Combo" : "Roll Attack" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.attack-options-dialog {
  padding: 1rem;
  min-width: 600px;
  max-width: 700px;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  color: #fff;
}

.f-group {
  margin-bottom: 1rem;
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
