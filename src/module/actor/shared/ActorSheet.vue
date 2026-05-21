<script setup lang="ts">
import { inject, ref, computed, watch } from "vue";
import StatsTab from "./StatsTab.vue";
import EditTab from "./EditTab.vue";
import PowersTab from "./PowersTab.vue";
import TalentsTab from "./TalentsTab.vue";
import BiographyTab from "./BiographyTab.vue";
import ArmorTab from "./ArmorTab.vue";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor;
const sheet = inject("sheet") as any;

const activeTab = ref<string>(
  (actor.getFlag("faserip", "activeTab") as string | undefined) ?? "edit"
);
watch(activeTab, tab => {
  actor.setFlag("faserip", "activeTab", tab);
});

const armorEnabled = computed(
  () => game.settings.get("faserip", "armorEnabled") ?? false
);

const tabs = computed(() => [
  { id: "stats", label: "Stats" },
  { id: "powers", label: "Powers" },
  { id: "talents", label: "Talents" },
  ...(armorEnabled.value ? [{ id: "armor", label: "Armor" }] : []),
  { id: "biography", label: "Biography" },
  { id: "edit", label: "Edit" }
]);

const currentForm = computed(() => {
  const forms = reactiveActor.system.forms || [];
  return (
    forms.find((f: any) => f.id === reactiveActor.system.currentFormId) ||
    forms[0]
  );
});

const forms = computed(() => reactiveActor.system.forms || []);

async function switchForm(formId: string) {
  reactiveActor.system.currentFormId = formId;
  // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
  await actor.update({ "system.currentFormId": formId });
}

async function updateAvatar(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    // Use Foundry's file picker or upload
    // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
    const fp = new foundry.applications.apps.FilePicker.implementation({
      type: "image",
      callback: async (path: string) => {
        reactiveActor.img = path;
        await actor.update({ img: path });
      }
    });
    fp.browse();
  }
}

function openImagePicker() {
  // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
  const fp = new foundry.applications.apps.FilePicker.implementation({
    type: "image",
    callback: async (path: string) => {
      // Update to new image (browsing existing files, no deletion needed)
      reactiveActor.img = path;
      await actor.update({ img: path });
    }
  });
  fp.browse();
}
</script>

<template>
  <div class="fsr-sheet">
    <!-- Header -->
    <div class="fsr-header">
      <div class="flex items-center gap-4">
        <!-- Avatar -->
        <div class="cursor-pointer" @click="openImagePicker">
          <img
            :src="reactiveActor.img"
            :alt="reactiveActor.name"
            class="fsr-avatar"
          />
        </div>

        <!-- Name and Form Selector -->
        <div class="flex-1">
          <input
            v-model="reactiveActor.name"
            type="text"
            class="fsr-title bg-transparent border-b-2 border-red-500 focus:border-red-300 outline-none w-full"
            placeholder="Character Name"
          />
          <div
            v-if="reactiveActor.system.callname"
            class="text-sm text-gray-200 mt-1"
          >
            {{ reactiveActor.system.callname }}
          </div>
          <div class="text-sm font-semibold text-yellow-500 mt-1">
            Karma: {{ reactiveActor.system.resources.karma.value }}
          </div>

          <!-- Form Selector (if multiple forms) -->
          <div v-if="forms.length > 1" class="mt-2">
            <select
              :value="reactiveActor.system.currentFormId"
              @change="(e: any) => switchForm(e.target.value)"
              class="fsr-select bg-red-800 border-red-600"
            >
              <option v-for="form in forms" :key="form.id" :value="form.id">
                {{ form.name }}{{ form.isPrimary ? " (Primary)" : "" }}
              </option>
            </select>
          </div>
        </div>

        <!-- Health Resource Bar -->
        <div class="flex-1">
          <div class="fsr-resource">
            <div class="fsr-resource-bar">
              <div
                class="fsr-resource-fill fsr-resource-health"
                :style="{
                  width: `${(reactiveActor.system.resources.health.value / reactiveActor.system.resources.health.max) * 100}%`
                }"
              ></div>
              <div class="fsr-resource-label">
                Health: {{ reactiveActor.system.resources.health.value }} /
                {{ reactiveActor.system.resources.health.max }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="fsr-tabs">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        :class="['fsr-tab', { active: activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </div>
    </div>

    <!-- Content -->
    <div class="fsr-content">
      <StatsTab v-if="activeTab === 'stats'" />
      <PowersTab v-if="activeTab === 'powers'" />
      <TalentsTab v-if="activeTab === 'talents'" />
      <ArmorTab v-if="activeTab === 'armor'" />
      <BiographyTab v-if="activeTab === 'biography'" />
      <EditTab v-if="activeTab === 'edit'" />
    </div>
  </div>
</template>
