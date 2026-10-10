<template>
  <div class="fsr-charman-sync-dialog">
    <div class="mb-3 p-3 bg-blue-900/30 rounded text-sm">
      <div>
        Review what pushing <strong>{{ characterLabel }}</strong> to Charman
        would change. Tick what you want applied; anything unticked is left
        exactly as it is in Charman.
      </div>
      <div class="mt-2 flex gap-2">
        <button
          class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
          @click="setAll(true)"
        >
          Apply all
        </button>
        <button
          class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
          @click="resetDefaults"
        >
          Reset to defaults
        </button>
        <button
          class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
          @click="setAll(false)"
        >
          Apply none
        </button>
      </div>
    </div>

    <div class="sync-scroll space-y-4">
      <section v-if="diff.scalars.length > 0">
        <h4 class="text-sm font-bold text-yellow-400 mb-1">Resources</h4>
        <label
          v-for="scalar in diff.scalars"
          :key="scalar.id"
          class="sync-row"
        >
          <input v-model="decisions[scalar.id]" type="checkbox" />
          <div class="flex-1">
            <div class="text-sm">
              <strong>{{ scalar.label }}</strong>
              <span class="badge badge-changed">Different</span>
            </div>
            <div class="text-xs text-gray-400">
              Charman {{ scalar.charman }} → Foundry {{ scalar.foundry }}
              <span v-if="decisions[scalar.id]">
                (Charman will be set to {{ scalar.foundry }})</span
              >
            </div>
          </div>
        </label>
      </section>

      <section v-for="group in groups" :key="group.section">
        <h4 class="text-sm font-bold text-yellow-400 mb-1">
          {{ group.label }}
        </h4>
        <label v-for="entry in group.entries" :key="entry.id" class="sync-row">
          <input v-model="decisions[entry.id]" type="checkbox" />
          <div class="flex-1">
            <div class="text-sm">
              <strong>{{ entry.name }}</strong>
              <span :class="['badge', `badge-${entry.kind}`]">{{
                kindLabel[entry.kind]
              }}</span>
            </div>
            <div class="text-xs text-gray-400">
              {{ actionText(entry) }}
            </div>
            <ul v-if="entry.changes.length > 0" class="mt-1 text-xs">
              <li v-for="change in entry.changes" :key="change.field">
                <span class="text-gray-300">{{ change.field }}:</span>
                <span class="text-red-300"> {{ change.charman }}</span>
                →
                <span class="text-green-300">{{ change.foundry }}</span>
              </li>
            </ul>
          </div>
        </label>
      </section>
    </div>

    <div class="dialog-buttons flex gap-2 justify-between items-center mt-4">
      <div class="text-xs text-gray-400">
        {{ selectedCount }} of {{ totalCount }} selected
      </div>
      <div class="flex gap-2">
        <button
          class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
          @click="dialog.submit(null)"
        >
          Cancel
        </button>
        <button
          :disabled="selectedCount === 0"
          :class="[
            'px-4 py-2 rounded',
            selectedCount === 0
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500'
          ]"
          @click="confirm"
        >
          Push {{ selectedCount }} change{{ selectedCount === 1 ? "" : "s" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import type { VueDialog } from "../vue-dialog";
import {
  SYNC_SECTIONS,
  defaultDecisions,
  type SyncDecisions,
  type SyncDiff,
  type SyncEntry
} from "../../charman-sync-diff";

interface Props {
  diff: SyncDiff;
  characterLabel: string;
  dialog: VueDialog;
}

const props = defineProps<Props>();

const decisions = reactive<SyncDecisions>(defaultDecisions(props.diff));

const kindLabel = {
  added: "New in Foundry",
  changed: "Changed",
  removed: "Only in Charman"
};

const groups = computed(() =>
  SYNC_SECTIONS.map(({ section, label }) => ({
    section,
    label,
    entries: props.diff.entries.filter(entry => entry.section === section)
  })).filter(group => group.entries.length > 0)
);

const allIds = computed(() => [
  ...props.diff.entries.map(entry => entry.id),
  ...props.diff.scalars.map(scalar => scalar.id)
]);

const totalCount = computed(() => allIds.value.length);
const selectedCount = computed(
  () => allIds.value.filter(id => decisions[id]).length
);

function actionText(entry: SyncEntry): string {
  const ticked = decisions[entry.id];
  switch (entry.kind) {
    case "added":
      return ticked ? "Will be added to Charman" : "Will not be added";
    case "changed":
      return ticked
        ? "Charman will be overwritten with the Foundry version"
        : "Charman's version is kept";
    case "removed":
      return ticked
        ? "Will be DELETED from Charman"
        : "Kept in Charman (not in Foundry)";
  }
}

function setAll(value: boolean) {
  for (const id of allIds.value) decisions[id] = value;
}

function resetDefaults() {
  Object.assign(decisions, defaultDecisions(props.diff));
}

function confirm() {
  props.dialog.submit({ ...decisions });
}
</script>

<style scoped>
.fsr-charman-sync-dialog {
  padding: 1rem;
  min-width: 520px;
}
.sync-scroll {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 0.25rem;
}
.sync-row {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.4rem 0.5rem;
  border-radius: 0.25rem;
  cursor: pointer;
}
.sync-row:hover {
  background: rgba(255, 255, 255, 0.05);
}
.badge {
  margin-left: 0.4rem;
  padding: 0 0.4rem;
  font-size: 0.65rem;
  border-radius: 0.25rem;
}
.badge-added {
  background: rgba(34, 197, 94, 0.25);
  color: #86efac;
}
.badge-changed {
  background: rgba(234, 179, 8, 0.25);
  color: #fde047;
}
.badge-removed {
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}
</style>
