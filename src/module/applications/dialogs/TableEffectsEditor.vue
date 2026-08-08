<template>
  <div class="table-effects-editor">
    <div class="mb-3 p-3 bg-blue-900/20 rounded border border-blue-800">
      <p class="text-sm text-gray-300">
        Attach a stat or damage chart-shift modifier to a RollTable result, so
        drawing it (e.g. from a Critical Success/Failure table) automatically
        applies the effect to the acting actor. Rows left unconfigured just
        post as flavor text, same as today.
      </p>
    </div>

    <div class="mb-3">
      <label class="text-sm font-semibold text-gray-200 mr-2">Table:</label>
      <select
        v-model="selectedTableId"
        class="px-2 py-1 bg-gray-900 border border-gray-600 rounded text-white"
      >
        <option v-for="table in tables" :key="table.id" :value="table.id">
          {{ table.name }}
        </option>
      </select>
    </div>

    <div v-if="!selectedTable" class="text-center text-gray-400 py-8">
      No RollTables found in this world.
    </div>

    <div v-else class="space-y-2 max-h-125 overflow-y-auto pr-2">
      <div
        v-for="row in rows"
        :key="row.id"
        class="p-3 bg-gray-900/50 rounded border border-gray-700"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="text-xs text-gray-400">
              {{ row.range[0] }}&ndash;{{ row.range[1] }}
            </div>
            <div class="text-sm text-gray-200" v-html="row.description" />
          </div>
          <button
            @click="row.expanded = !row.expanded"
            class="fsr-btn fsr-btn-sm shrink-0"
            :class="row.enabled ? 'bg-indigo-700 hover:bg-indigo-800' : 'bg-gray-700 hover:bg-gray-600'"
            :title="row.enabled ? 'Effect configured' : 'No effect configured'"
          >
            {{ row.enabled ? "⚡ Effect" : "+ Effect" }}
          </button>
        </div>

        <div
          v-if="row.expanded"
          class="mt-3 pt-3 border-t border-gray-700 grid grid-cols-2 gap-2"
        >
          <label class="flex items-center gap-2 col-span-2 text-sm text-gray-300">
            <input type="checkbox" v-model="row.enabled" />
            Apply an effect when this result is drawn
          </label>

          <template v-if="row.enabled">
            <div>
              <label class="fsr-label">Kind</label>
              <select v-model="row.kind" class="fsr-select text-sm w-full">
                <option value="stat">Stat Modifier</option>
                <option value="damage">Damage Modifier</option>
              </select>
            </div>
            <div v-if="row.kind === 'stat'">
              <label class="fsr-label">Attribute</label>
              <select v-model="row.attribute" class="fsr-select text-sm w-full">
                <option v-for="attr in attributeChoices" :key="attr.value" :value="attr.value">
                  {{ attr.label }}
                </option>
              </select>
            </div>
            <div>
              <label class="fsr-label">Chart Shift</label>
              <input
                v-model.number="row.chartShift"
                type="number"
                class="fsr-input"
                placeholder="-1"
              />
            </div>
            <div>
              <label class="fsr-label">Trigger</label>
              <select v-model="row.trigger" class="fsr-select text-sm w-full">
                <option value="">Round-based (use rounds below)</option>
                <option value="nextAction">Consumed on next roll</option>
                <option value="nextAttack">Consumed on next attack roll</option>
                <option value="nextDodge">Consumed on next defense roll</option>
              </select>
            </div>
            <div v-if="!row.trigger">
              <label class="fsr-label">Rounds</label>
              <input
                v-model.number="row.roundsRemaining"
                type="number"
                min="1"
                class="fsr-input"
              />
            </div>
            <div v-else class="text-xs text-gray-400 col-span-2">
              Applies once, consumed the next time a matching roll happens.
              Falls off after {{ row.roundsRemaining }} round(s) if never used.
            </div>
          </template>
        </div>
      </div>
    </div>

    <div
      class="dialog-buttons flex gap-2 justify-end mt-4 pt-3 border-t border-gray-700"
    >
      <button
        @click="handleClose"
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
      >
        Close
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
import { ref, computed, watch } from "vue";
import type { VueDialog } from "../vue-dialog";
import type { TemporaryModifierTrigger } from "../../utils/temp-effects";

interface Props {
  dialog: VueDialog;
}

const props = defineProps<Props>();

const attributeChoices = [
  { value: "fighting", label: "Fighting" },
  { value: "agility", label: "Agility" },
  { value: "strength", label: "Strength" },
  { value: "endurance", label: "Endurance" },
  { value: "reasoning", label: "Reasoning" },
  { value: "intuition", label: "Intuition" },
  { value: "psyche", label: "Psyche" }
];

interface RowState {
  id: string;
  range: [number, number];
  description: string;
  expanded: boolean;
  enabled: boolean;
  kind: "stat" | "damage";
  attribute: string;
  chartShift: number;
  roundsRemaining: number;
  trigger: TemporaryModifierTrigger | "";
}

// @ts-expect-error - Foundry game.tables global
const tables = computed(() => Array.from(game.tables?.contents ?? []));

const selectedTableId = ref<string>(tables.value[0]?.id ?? "");

// @ts-expect-error - Foundry game.tables global
const selectedTable = computed(() =>
  game.tables?.get(selectedTableId.value)
);

const rows = ref<RowState[]>([]);

function buildRows() {
  const table = selectedTable.value;
  if (!table) {
    rows.value = [];
    return;
  }

  rows.value = Array.from(table.results ?? []).map((result: any) => {
    const flags = result.flags?.faserip;
    return {
      id: result.id,
      range: result.range ?? [0, 0],
      description: result.description || result.text || "",
      expanded: false,
      enabled: !!flags,
      kind: flags?.kind ?? "stat",
      attribute: flags?.attribute ?? "fighting",
      chartShift: flags?.chartShift ?? -1,
      roundsRemaining: flags?.roundsRemaining ?? 1,
      trigger: flags?.trigger ?? ""
    };
  });
}

watch(selectedTableId, buildRows, { immediate: true });

async function handleSave() {
  const table = selectedTable.value;
  if (!table) return;

  const updates = rows.value.map(row => ({
    _id: row.id,
    "flags.faserip": row.enabled
      ? {
          kind: row.kind,
          attribute: row.kind === "stat" ? row.attribute : undefined,
          chartShift: Number(row.chartShift) || 0,
          roundsRemaining: Math.max(1, Math.floor(Number(row.roundsRemaining) || 1)),
          trigger: row.trigger || undefined
        }
      : null
  }));

  await table.updateEmbeddedDocuments("TableResult", updates);

  // @ts-expect-error - Foundry ui global
  ui.notifications?.info(`Saved table effects for ${table.name}`);
}

function handleClose() {
  props.dialog.submit(null);
}
</script>

<style scoped>
.table-effects-editor {
  padding: 1rem;
  min-width: 650px;
  max-width: 750px;
}

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
