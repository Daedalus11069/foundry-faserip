<template>
  <div class="movement-settings-dialog">
    <div class="mb-3 p-3 bg-blue-900/20 rounded border border-blue-800">
      <p class="text-sm text-gray-300">
        Configure movement distance (in squares) for each rank based on
        Endurance. Base rule: 1 area = 1 square.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3 max-h-125 overflow-y-auto pr-2">
      <div
        v-for="rank in ranks"
        :key="rank.value"
        class="flex items-center gap-2"
      >
        <label class="text-sm font-semibold text-gray-200 w-32">
          {{ rank.label }}:
        </label>
        <input
          type="number"
          v-model.number="movementValues[rank.value]"
          min="0"
          step="1"
          class="flex-1 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-white"
        />
      </div>
    </div>

    <div
      class="dialog-buttons flex gap-2 justify-end mt-4 pt-3 border-t border-gray-700"
    >
      <button
        @click="handleReset"
        class="px-4 py-2 bg-yellow-700 hover:bg-yellow-600 rounded text-white"
      >
        Reset to Defaults
      </button>
      <button
        @click="handleCancel"
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
      >
        Cancel
      </button>
      <button
        @click="handleSave"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white"
      >
        Save Changes
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Rank, formatRankDisplay } from "../../enums";
import type { VueDialog } from "../vue-dialog";

interface Props {
  currentValues: Record<string, number>;
  dialog: VueDialog;
}

const props = defineProps<Props>();

const ranks = Object.values(Rank).map(rank => ({
  value: rank,
  label: formatRankDisplay(rank)
}));

const movementValues = ref<Record<string, number>>({ ...props.currentValues });

const defaultValues: Record<string, number> = {
  [Rank.Shift0]: 0,
  [Rank.Feeble]: 0,
  [Rank.Poor]: 1,
  [Rank.Typical]: 2,
  [Rank.Good]: 4,
  [Rank.Excellent]: 6,
  [Rank.Remarkable]: 8,
  [Rank.Incredible]: 10,
  [Rank.Amazing]: 20,
  [Rank.Monstrous]: 40,
  [Rank.Unearthly]: 60,
  [Rank.ShiftX]: 80,
  [Rank.ShiftY]: 160,
  [Rank.ShiftZ]: 400,
  [Rank.Class1000]: 50,
  [Rank.Class3000]: 5000,
  [Rank.Class5000]: 500000,
  [Rank.Beyond]: 499999999
};

function handleReset() {
  movementValues.value = { ...defaultValues };
}

function handleSave() {
  // Ensure all values are valid numbers
  const cleaned: Record<string, number> = {};
  for (const rank of Object.values(Rank)) {
    const value = movementValues.value[rank];
    cleaned[rank] =
      typeof value === "number" && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : defaultValues[rank];
  }

  props.dialog.submit(cleaned);
}

function handleCancel() {
  props.dialog.submit(null);
}
</script>

<style scoped>
.movement-settings-dialog {
  padding: 1rem;
  min-width: 600px;
  max-width: 700px;
}

/* Custom scrollbar for the grid */
.overflow-y-auto::-webkit-scrollbar {
  width: 8px;
}

.overflow-y-auto::-webkit-scrollbar-track {
  background: #1f2937;
  border-radius: 4px;
}

.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #4b5563;
  border-radius: 4px;
}

.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #6b7280;
}
</style>
