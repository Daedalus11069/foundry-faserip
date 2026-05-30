<script setup lang="ts">
import { inject, ref, computed, watch } from "vue";
import StatsTab from "./StatsTab.vue";
import EditTab from "./EditTab.vue";
import PowersTab from "./PowersTab.vue";
import TalentsTab from "./TalentsTab.vue";
import BiographyTab from "./BiographyTab.vue";
import ArmorTab from "./ArmorTab.vue";
import { calculateHealth, stringToRank } from "../../utils";
import { Rank } from "../../enums";

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

// Reactive movement calculation based on current form's endurance
const movementSquares = computed(() => {
  const form = currentForm.value;
  if (!form) return 0;

  const enduranceRank = stringToRank(
    form.attributes.endurance?.rank || Rank.Typical
  );

  // Get movement squares from settings (same logic as documents.ts)
  const raw = game.settings.get("faserip", "movementSquaresByRank") as
    | string
    | undefined;
  let squares = 2; // Default for typical

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, number>;
      squares = parsed[enduranceRank] ?? 2;
    } catch {
      // Use defaults
      const defaults: Record<string, number> = {
        shift_0: 0,
        feeble: 0,
        poor: 1,
        typical: 2,
        good: 4,
        excellent: 6,
        remarkable: 8,
        incredible: 10,
        amazing: 20,
        monstrous: 40,
        unearthly: 60,
        shift_x: 80,
        shift_y: 160,
        shift_z: 400,
        class_1000: 50,
        class_3000: 5000,
        class_5000: 500000,
        beyond: 499999999
      };
      squares = defaults[enduranceRank] ?? 2;
    }
  }

  const gridDistance = canvas?.scene?.grid.distance ?? 1;
  return squares * gridDistance;
});

const gridUnits = computed(() => canvas?.scene?.grid.units || "ft");

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

// Computed property to recalculate health max based on current form
// This ensures the display is always accurate even if reactive sync lags
const healthMax = computed(() => {
  const form = currentForm.value;
  if (!form) return reactiveActor.system.resources.health.max || 0;
  return calculateHealth(form);
});

const healthValue = computed(
  () => reactiveActor.system.resources.health.value ?? 0
);

const healthPercent = computed(() => {
  const max = healthMax.value;
  const val = healthValue.value;
  if (max === 0) return 0;
  // Clamp bar percentage to 0-100%, but allow negative health values in display
  return Math.min(100, Math.max(0, (val / max) * 100));
});

// Combined armor (Body Armor power + equipped armor)
const bodyArmorPower = computed(() => {
  const activeFormId = reactiveActor.system.currentFormId;
  return (
    (reactiveActor.system.powers || []).find(
      (p: any) =>
        p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
        (!p.formIds?.length || p.formIds.includes(activeFormId))
    ) ?? null
  );
});

const equippedArmor = computed(() => {
  if (!armorEnabled.value) return null;
  return (
    (reactiveActor.system.armors || []).find((a: any) => a.equipped) ?? null
  );
});

const degradingEnabled = computed(
  () => game.settings.get("faserip", "degradingArmor") ?? false
);

const armorValue = computed(() => {
  let total = 0;
  if (bodyArmorPower.value) total += bodyArmorPower.value.value;
  if (equippedArmor.value) total += equippedArmor.value.value;
  return total;
});

const armorMax = computed(() => {
  let total = 0;
  if (bodyArmorPower.value) {
    total += bodyArmorPower.value.maxValue || bodyArmorPower.value.value;
  }
  if (equippedArmor.value) {
    total += equippedArmor.value.maxValue || equippedArmor.value.value;
  }
  return total;
});

const armorPercent = computed(() => {
  const max = armorMax.value;
  if (max === 0) return 0;
  return Math.min(100, Math.max(0, (armorValue.value / max) * 100));
});

const forms = computed(() => reactiveActor.system.forms || []);

async function switchForm(formId: string) {
  // Call the actor's switchForm method which handles token transformation
  // @ts-expect-error - switchForm is a custom method on FaseripActor
  await actor.switchForm(formId);
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

function copyMovementPath() {
  const path = "actor.movement";

  navigator.clipboard
    .writeText(path)
    .then(() => {
      ui.notifications?.info(`Copied to clipboard: ${path}`);
    })
    .catch(() => {
      ui.notifications?.error("Failed to copy to clipboard");
    });
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
          <div
            class="text-sm font-semibold text-cyan-300 mt-1 cursor-pointer hover:text-cyan-200 transition-colors"
            @click="copyMovementPath"
            :title="'Click to copy property path to clipboard'"
          >
            Movement: {{ movementSquares.toLocaleString() }} {{ gridUnits }}
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
                :class="[
                  'fsr-resource-fill',
                  healthValue < 0 ? 'bg-gray-600' : 'fsr-resource-health'
                ]"
                :style="{
                  width: `${healthPercent}%`
                }"
              ></div>
              <div class="fsr-resource-label">
                <span :class="healthValue < 0 ? 'text-red-400 font-bold' : ''">
                  Health: {{ healthValue }} / {{ healthMax }}
                </span>
              </div>
            </div>
          </div>

          <!-- Combined Armor Bar (when armor system is enabled) -->
          <div v-if="armorEnabled && armorMax > 0" class="fsr-resource mt-2">
            <div class="fsr-resource-bar">
              <div
                class="fsr-resource-fill bg-blue-500"
                :style="{
                  width: `${armorPercent}%`
                }"
              ></div>
              <div class="fsr-resource-label">
                <span v-if="degradingEnabled">
                  Armor: {{ armorValue }} / {{ armorMax }}
                </span>
                <span v-else> Armor: {{ armorValue }} </span>
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
