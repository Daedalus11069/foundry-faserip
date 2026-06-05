<script setup lang="ts">
import { inject, computed, ref } from "vue";
import type { Talent, Form } from "../../types";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor;

const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);
const forms = computed<Form[]>(() => reactiveActor.system.forms || []);

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

function removeTalent(index: number) {
  reactiveActor.system.talents.splice(index, 1);
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Talents</h2>
      <button @click="addTalent" class="fsr-btn fsr-btn-primary fsr-btn-sm">
        + Add Talent
      </button>
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
        <div class="fsr-list-item-header mb-2">
          <input
            v-model="talent.name"
            type="text"
            class="fsr-input flex-1 mr-2"
            placeholder="Talent Name"
          />
          <button
            @click="removeTalent(talents.indexOf(talent))"
            class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2"
          >
            ✕
          </button>
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
            >{{ forms.find(f => f.id === fid)?.name ?? fid }}</span
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

      <div v-if="talents.length === 0" class="text-center text-gray-400 py-8">
        No talents yet. Click "Add Talent" to create one.
      </div>
    </div>
  </div>
</template>
