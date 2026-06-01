<script setup lang="ts">
import { inject, ref, computed, watch } from "vue";
import StatsTab from "./StatsTab.vue";
import EditTab from "./EditTab.vue";
import PowersTab from "./PowersTab.vue";
import TalentsTab from "./TalentsTab.vue";
import BiographyTab from "./BiographyTab.vue";
import ArmorTab from "./ArmorTab.vue";
import WeaponsTab from "./WeaponsTab.vue";
import { calculateHealth, stringToRank } from "../../utils";
import { Rank } from "../../enums";
import { getCharmanService } from "../../charman-service";
import type { ReactiveActorData } from "../../types/actor-system";
import type { FaseripActor } from "../../documents";

const reactiveActor = inject("reactiveActor") as ReactiveActorData;
const actor = inject("actor") as FaseripActor;

const activeTab = ref<string>(
  (actor.getFlag("faserip", "activeTab") as string | undefined) ?? "edit"
);
watch(activeTab, tab => {
  actor.setFlag("faserip", "activeTab", tab);
});

const armorEnabled = computed(
  () => game.settings.get("faserip", "armorEnabled") ?? false
);

const weaponsEnabled = computed(
  () => game.settings.get("faserip", "weaponsEnabled") ?? false
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
  ...(weaponsEnabled.value ? [{ id: "weapons", label: "Weapons" }] : []),
  ...(armorEnabled.value ? [{ id: "armor", label: "Armor" }] : []),
  { id: "biography", label: "Notes" },
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

// Computed armor list for compact display
const armorList = computed(() => {
  const armors: Array<{ icon: string; name: string; title: string }> = [];

  if (bodyArmorPower.value) {
    const absorbs = degradingEnabled.value
      ? `absorbs ${bodyArmorPower.value.value}/${bodyArmorPower.value.maxValue || bodyArmorPower.value.value}`
      : `absorbs ${bodyArmorPower.value.value}`;
    armors.push({
      icon: "🦾",
      name: bodyArmorPower.value.name,
      title: `${bodyArmorPower.value.rank}, ${absorbs}`
    });
  }

  if (equippedArmor.value) {
    const absorbs = degradingEnabled.value
      ? `absorbs ${equippedArmor.value.value}/${equippedArmor.value.maxValue || equippedArmor.value.value}`
      : `absorbs ${equippedArmor.value.value}`;
    armors.push({
      icon: "🛡️",
      name: equippedArmor.value.name,
      title: `${equippedArmor.value.rank}, ${absorbs}`
    });
  }

  return armors;
});

async function switchForm(formId: string) {
  // Call the actor's switchForm method which handles token transformation
  await actor.switchForm(formId);
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

// Damage/Healing
const damageAmount = ref(0);

async function applyDamage() {
  if (damageAmount.value === 0) return;

  let incoming = damageAmount.value;
  const soakSources: string[] = [];
  let equipmentArmorDamaged = false;
  let bodyArmorPowerDamaged = false;

  // Equipped armor soaks first (house rule setting)
  if (equippedArmor.value) {
    const armorSoak = Math.min(incoming, equippedArmor.value.value);
    if (armorSoak > 0) {
      soakSources.push(`${equippedArmor.value.name} –${armorSoak}`);
      incoming = Math.max(0, incoming - armorSoak);

      // Degrade armor if the setting is enabled
      const degradingEnabled =
        game.settings.get("faserip", "degradingArmor") ?? false;
      if (degradingEnabled) {
        equippedArmor.value.value = Math.max(
          0,
          equippedArmor.value.value - armorSoak
        );
        equipmentArmorDamaged = true;
        if (equippedArmor.value.value === 0) {
          ui.notifications?.warn(`${equippedArmor.value.name} is destroyed!`);
        }
      }
    }
  }

  // Body Armor power soaks remainder (always active)
  if (bodyArmorPower.value && incoming > 0) {
    const powerSoak = Math.min(incoming, bodyArmorPower.value.value);
    if (powerSoak > 0) {
      soakSources.push(`${bodyArmorPower.value.name} –${powerSoak}`);
      incoming = Math.max(0, incoming - powerSoak);

      // Degrade Body Armor power if the setting is enabled
      const degradingEnabled =
        game.settings.get("faserip", "degradingArmor") ?? false;
      if (degradingEnabled) {
        bodyArmorPower.value.value = Math.max(
          0,
          bodyArmorPower.value.value - powerSoak
        );
        bodyArmorPowerDamaged = true;
        if (bodyArmorPower.value.value === 0) {
          ui.notifications?.warn(`${bodyArmorPower.value.name} is destroyed!`);
        }
      }
    }
  }

  reactiveActor.system.resources.health.value = Math.max(
    -20,
    healthValue.value - incoming
  );

  // Sync armor changes with Charman if character is linked
  // @ts-expect-error - charman is a custom property
  const charmanData = actor.system.charman;
  if (charmanData?.username && charmanData?.characterName) {
    try {
      const service = getCharmanService();

      // Sync equipment armor if damaged
      if (equipmentArmorDamaged && equippedArmor.value) {
        await service.updateEquipmentArmor(
          charmanData.username,
          charmanData.characterName,
          equippedArmor.value.name,
          equippedArmor.value.value
        );
      }

      // Sync Body Armor power if damaged
      if (bodyArmorPowerDamaged && bodyArmorPower.value) {
        await service.updateBodyArmorPower(
          charmanData.username,
          charmanData.characterName,
          bodyArmorPower.value.value
        );
      }
    } catch (error) {
      // Service not initialized or sync failed - ignore silently
    }
  }

  damageAmount.value = 0;
}

async function applyHealing() {
  if (damageAmount.value === 0) return;

  const newValue = Math.min(
    healthMax.value,
    healthValue.value + damageAmount.value
  );

  // Update reactive actor (base sheet class handles syncing to Foundry actor)
  reactiveActor.system.resources.health.value = newValue;

  damageAmount.value = 0;
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
            :src="reactiveActor.img ?? ''"
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

          <!-- Health Management -->
          <div class="mt-3 p-2 bg-gray-800 rounded border border-gray-700">
            <!-- Equipped armor / body armor power indicator -->
            <div
              v-if="armorList.length > 0"
              class="mb-2 text-xs text-green-400"
            >
              <span
                v-for="(armor, index) in armorList"
                :key="armor.name"
                :title="armor.title"
                class="cursor-help"
              >
                <template v-if="index > 0">, </template>{{ armor.icon }}
                {{ armor.name }}</span
              >
            </div>
            <div class="flex gap-2 items-center">
              <input
                type="number"
                v-model.number="damageAmount"
                :min="0"
                class="flex-1 px-2 py-1 bg-gray-900 border border-gray-600 rounded text-white text-sm"
                placeholder="Amount"
              />
              <button
                @click="applyDamage"
                :disabled="damageAmount <= 0"
                class="fsr-btn fsr-btn-danger px-3 py-1 text-sm"
                :class="{ 'opacity-50 cursor-not-allowed': damageAmount <= 0 }"
              >
                💔 Damage
              </button>
              <button
                @click="applyHealing"
                :disabled="damageAmount <= 0"
                class="fsr-btn fsr-btn-success px-3 py-1 text-sm"
                :class="{ 'opacity-50 cursor-not-allowed': damageAmount <= 0 }"
              >
                💚 Heal
              </button>
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
      <WeaponsTab v-if="activeTab === 'weapons'" />
      <ArmorTab v-if="activeTab === 'armor'" />
      <BiographyTab v-if="activeTab === 'biography'" />
      <EditTab v-if="activeTab === 'edit'" />
    </div>
  </div>
</template>
