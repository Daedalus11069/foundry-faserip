<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from "vue";
import type { Talent, Form } from "../../types";
import {
  isHoloSuiteActive,
  presentHackToActor
} from "../../integrations/holosuite-hacking";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor;

const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);
const forms = computed<Form[]>(() => reactiveActor.system.forms || []);

// "Hacking" talent (case-insensitive) unlocks a shortcut to the HoloSuite
// hack-presentation flow directly from this actor's sheet, without needing
// the Token Controls scene-control button.
const hasHackingTalent = computed(() =>
  talents.value.some(t => t.name?.trim().toLowerCase() === "hacking")
);

// game.user.targets isn't reactive on its own - track its size via the
// targetToken hook so the button label updates live as targets change.
const targetCount = ref(((game as any).user?.targets?.size as number) ?? 0);
function refreshTargetCount() {
  targetCount.value = (game as any).user?.targets?.size ?? 0;
}

onMounted(() => {
  Hooks.on("targetToken", refreshTargetCount);
});
onUnmounted(() => {
  Hooks.off("targetToken", refreshTargetCount);
});

const hackButtonLabel = computed(() =>
  targetCount.value > 1
    ? `🖥️ Hack ${targetCount.value} Targets`
    : "🖥️ Hack Target"
);

function presentHack() {
  presentHackToActor(actor as any);
}

// Form filter: '' = show all forms
const filterFormId = ref("");

const filteredTalents = computed<Talent[]>(() => {
  const all = talents.value;
  if (!filterFormId.value) return all;
  return all.filter(
    t =>
      !t.formIds ||
      t.formIds.length === 0 ||
      t.formIds.includes(filterFormId.value)
  );
});

const expandedFormPanel = ref<string | null>(null);

function toggleFormPanel(talentId: string) {
  expandedFormPanel.value =
    expandedFormPanel.value === talentId ? null : talentId;
}

function toggleTalentForm(talent: Talent, formId: string) {
  if (!talent.formIds) talent.formIds = [];
  const idx = talent.formIds.indexOf(formId);
  if (idx === -1) {
    talent.formIds.push(formId);
  } else {
    talent.formIds.splice(idx, 1);
  }
}

function addTalent() {
  if (!reactiveActor.system.talents) {
    reactiveActor.system.talents = [];
  }

  const newTalent: Talent = {
    id: crypto.randomUUID(),
    name: "New Talent",
    bonus: 0,
    formIds: []
  };
  reactiveActor.system.talents.push(newTalent);
}

async function removeTalent(index: number) {
  // @ts-expect-error - DialogV2 path not fully typed
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Delete <strong>${reactiveActor.system.talents[index].name}</strong>? This cannot be undone.</p>`,
    modal: true
  });
  if (!confirmed) return;
  reactiveActor.system.talents.splice(index, 1);
}

const expandedItems = ref<string | null>(null);
function toggleItem(id: string) {
  expandedItems.value = expandedItems.value === id ? null : id;
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Talents</h2>
      <div class="flex gap-2">
        <button
          v-if="hasHackingTalent && isHoloSuiteActive()"
          @click="presentHack"
          class="fsr-btn fsr-btn-sm bg-cyan-700 hover:bg-cyan-600 text-white"
          title="Target a hackable actor (or none for an open attempt) and start a hacking check"
        >
          {{ hackButtonLabel }}
        </button>
        <button @click="addTalent" class="fsr-btn fsr-btn-primary fsr-btn-sm">
          + Add Talent
        </button>
      </div>
    </div>

    <!-- Form filter bar -->
    <div v-if="forms.length > 1" class="flex gap-1 flex-wrap mb-3">
      <button
        @click="filterFormId = ''"
        :class="[
          'fsr-btn fsr-btn-sm text-xs px-3 py-1',
          filterFormId === ''
            ? 'fsr-btn-primary'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        ]"
      >
        All Forms
      </button>
      <button
        v-for="form in forms"
        :key="form.id"
        @click="filterFormId = form.id"
        :class="[
          'fsr-btn fsr-btn-sm text-xs px-3 py-1',
          filterFormId === form.id
            ? 'fsr-btn-primary'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        ]"
      >
        <span v-if="form.isPrimary" class="mr-1 text-yellow-400">★</span
        >{{ form.name }}
      </button>
    </div>

    <div class="fsr-list">
      <div
        v-for="(talent, index) in filteredTalents"
        :key="talent.id"
        class="fsr-list-item"
      >
        <!-- Accordion header: always visible -->
        <div
          class="flex items-center gap-2 cursor-pointer select-none"
          @click="toggleItem(talent.id)"
        >
          <span class="text-gray-400 text-xs w-4 shrink-0">{{ expandedItems === talent.id ? '▼' : '▶' }}</span>
          <span class="font-semibold text-white flex-1 truncate">{{ talent.name || '(unnamed)' }}</span>
          <template v-if="forms.length > 1 && talent.formIds && talent.formIds.length > 0">
            <span
              v-for="fid in talent.formIds"
              :key="fid"
              class="text-xs bg-yellow-900/60 text-yellow-300 rounded px-1.5 py-0.5 shrink-0"
            >{{forms.find(f => f.id === fid)?.name ?? fid}}</span>
          </template>
          <span
            v-if="talent.bonus !== 0"
            class="text-xs px-2 py-0.5 rounded font-bold shrink-0"
            :class="talent.bonus > 0 ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'"
          >{{ talent.bonus > 0 ? '+' : '' }}{{ talent.bonus }} CS</span>
          <span
            v-if="talent.grantsDualWield"
            class="text-xs px-2 py-0.5 rounded bg-blue-900/60 text-blue-300 shrink-0"
          >Dual-Wield</span>
          <button
            @click.stop="removeTalent(talents.indexOf(talent))"
            class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2 shrink-0"
          >✕</button>
        </div>

        <!-- Accordion body: expanded form -->
        <div v-if="expandedItems === talent.id" class="mt-3 pt-3 border-t border-gray-700">
          <div class="fsr-list-item-header mb-2">
            <input
              v-model="talent.name"
              type="text"
              class="fsr-input flex-1 mr-2"
              placeholder="Talent Name"
            />
          </div>

          <!-- Form badges + assign button -->
          <div
            v-if="forms.length > 1"
            class="flex flex-wrap gap-1 mb-2 items-center"
          >
            <span class="text-xs text-gray-500">Forms:</span>
            <span
              v-if="!talent.formIds || talent.formIds.length === 0"
              class="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5"
              >All</span
            >
            <span
              v-else
              v-for="fid in talent.formIds"
              :key="fid"
              class="text-xs bg-yellow-900/60 text-yellow-300 rounded px-2 py-0.5"
              >{{forms.find(f => f.id === fid)?.name ?? fid}}</span
            >
            <button
              @click="toggleFormPanel(talent.id)"
              class="fsr-btn fsr-btn-sm text-xs bg-gray-600 hover:bg-gray-500 text-white px-2 py-0.5"
            >
              {{ expandedFormPanel === talent.id ? "▲ Forms" : "▼ Forms" }}
            </button>
          </div>

          <!-- Form assignment panel -->
          <div
            v-if="forms.length > 1 && expandedFormPanel === talent.id"
            class="mb-2 p-2 bg-gray-800 rounded border border-gray-700"
          >
            <p class="text-xs text-gray-400 mb-2">
              Check forms this talent applies to. Unchecking all means it applies
              to every form.
            </p>
            <div class="flex flex-col gap-1">
              <label
                v-for="form in forms"
                :key="form.id"
                class="flex items-center gap-2 text-sm cursor-pointer hover:text-white"
              >
                <input
                  type="checkbox"
                  :checked="!!talent.formIds?.includes(form.id)"
                  @change="toggleTalentForm(talent, form.id)"
                  class="form-checkbox"
                />
                <span
                  :class="form.isPrimary ? 'text-yellow-400' : 'text-gray-300'"
                >
                  <span v-if="form.isPrimary" class="mr-1">★</span>{{ form.name }}
                </span>
              </label>
            </div>
          </div>

          <div class="mb-2">
            <div class="text-sm text-gray-400 flex">
              <div class="flex flex-col">
                <label class="fsr-label align-middle">Chart Shift Bonus:</label>
              </div>
              <div class="ml-2">{{ talent.bonus > 0 ? "+" : "" }}</div>
              <div class="mx-2">
                <input
                  v-model.number="talent.bonus"
                  type="number"
                  class="fsr-input"
                  placeholder="CS modifier (e.g., 1 for +1CS)"
                />
              </div>
              <div>CS</div>
            </div>
          </div>

          <div class="mb-2 flex items-center gap-2">
            <input
              v-model="talent.grantsDualWield"
              type="checkbox"
              :id="`dual-wield-${talent.id}`"
              class="form-checkbox"
            />
            <label :for="`dual-wield-${talent.id}`" class="fsr-label cursor-pointer select-none">
              Grants Dual-Wield
              <span class="text-xs text-gray-400 ml-1">(fight with two weapons simultaneously)</span>
            </label>
          </div>

          <div class="mb-2">
            <label class="fsr-label">Description:</label>
            <textarea
              v-model="talent.description"
              class="fsr-textarea w-full p-2"
              rows="2"
              placeholder="Talent description or notes..."
            ></textarea>
          </div>
        </div>
      </div>

      <div v-if="talents.length === 0" class="text-center text-gray-400 py-8">
        No talents yet. Click "Add Talent" to create one.
      </div>
    </div>
  </div>
</template>
