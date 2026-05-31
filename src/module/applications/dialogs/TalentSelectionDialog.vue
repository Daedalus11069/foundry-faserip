<script setup lang="ts">
import { ref, computed } from "vue";
import type { VueDialog } from "../vue-dialog";

interface Props {
  talents: Array<{
    id: string;
    name: string;
    bonus: number;
    description?: string;
  }>;
  attributeName: string;
  dialog: VueDialog;
}

const props = defineProps<Props>();

const selectedTalentIds = ref<string[]>([]);

const totalCS = computed(() => {
  let total = 0;
  selectedTalentIds.value.forEach(id => {
    const talent = props.talents.find(t => t.id === id);
    if (talent) {
      total += talent.bonus;
    }
  });
  return total;
});

const selectedTalent = computed(() => {
  if (selectedTalentIds.value.length === 0) return null;
  return props.talents.find(t => t.id === selectedTalentIds.value[0]);
});

function confirm() {
  const selected = props.talents
    .filter(t => selectedTalentIds.value.includes(t.id))
    .map(t => ({ name: t.name, bonus: t.bonus }));
  props.dialog.submit(selected);
}

function cancel() {
  props.dialog.submit(null);
}
</script>

<template>
  <div class="fsr-talent-dialog">
    <h2 class="text-xl font-bold mb-4 text-white">
      Apply Talents to {{ attributeName }}
    </h2>

    <div v-if="talents.length === 0" class="text-gray-400 text-center py-4">
      No talents available
    </div>

    <div v-else class="mb-4">
      <label class="fsr-label mb-2">Select Talents</label>
      <select
        v-model="selectedTalentIds"
        multiple
        size="8"
        class="fsr-input w-full"
        style="--input-height: 200px"
      >
        <option
          v-for="talent in talents"
          :key="talent.id"
          :value="talent.id"
          class="py-2"
        >
          {{ talent.name }}
          <span v-if="talent.bonus !== 0">
            ({{ talent.bonus > 0 ? "+" : "" }}{{ talent.bonus }} CS)
          </span>
        </option>
      </select>
      <p class="text-xs text-gray-400 mt-1">
        Hold Ctrl/Cmd to select multiple talents
      </p>

      <div
        v-if="selectedTalent && selectedTalent.description"
        class="mt-3 p-3 bg-gray-800 rounded text-sm text-gray-300"
      >
        <div class="font-semibold text-white mb-1">
          {{ selectedTalent.name }}
        </div>
        {{ selectedTalent.description }}
      </div>
    </div>

    <div
      v-if="totalCS !== 0"
      class="mb-4 p-3 rounded bg-blue-900 text-blue-200 text-center font-semibold"
    >
      Total Chart Shift: {{ totalCS > 0 ? "+" : "" }}{{ totalCS }} CS
    </div>

    <div class="flex gap-2 justify-end">
      <button @click="cancel" class="fsr-btn fsr-btn-secondary">Cancel</button>
      <button @click="confirm" class="fsr-btn fsr-btn-primary">Roll</button>
    </div>
  </div>
</template>

<style scoped>
.fsr-talent-dialog {
  padding: 1rem;
  min-width: 400px;
  max-width: 600px;
}

select.fsr-input option {
  padding: 0.5rem;
}
</style>
