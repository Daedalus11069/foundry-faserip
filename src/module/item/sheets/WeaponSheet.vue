<template>
  <div class="fsr-sheet">
    <!-- Header -->
    <div class="fsr-header">
      <div class="flex items-center gap-4">
        <!-- Avatar -->
        <div class="cursor-pointer" @click="openImagePicker">
          <img
            :src="reactiveItem.img || 'icons/svg/sword.svg'"
            :alt="reactiveItem.name"
            class="fsr-avatar"
          />
        </div>

        <!-- Name and Type -->
        <div class="flex-1">
          <input
            v-model="reactiveItem.name"
            type="text"
            class="fsr-title bg-transparent border-b-2 border-red-500 focus:border-red-300 outline-none w-full"
            placeholder="Weapon Name"
          />
          <div class="text-sm text-red-300 mt-1 font-semibold">⚔️ Weapon</div>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="fsr-content p-6 space-y-4">
      <!-- Weapon Type -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Weapon Type</label>
        <select v-model="reactiveItem.system.weaponType" class="fsr-select">
          <option value="melee">⚔️ Melee</option>
          <option value="ranged">🏹 Ranged</option>
          <option value="thrown">🪃 Thrown</option>
        </select>
      </div>

      <!-- Damage -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Damage</label>
        <input
          v-model="reactiveItem.system.damage"
          type="text"
          class="fsr-input"
          placeholder="e.g., 1d6, 2d8+2, etc."
        />
      </div>

      <!-- Damage Rank -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Damage Rank</label>
        <select v-model="reactiveItem.system.damageRank" class="fsr-select">
          <option
            v-for="[key, label] in rankChoicesWithValues"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </div>

      <!-- Armor Piercing -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">
          Armor Piercing
          <i
            class="fas fa-shield-slash text-xs text-red-400 ml-1"
            :title="'Reduces target armor effectiveness'"
          ></i>
        </label>
        <select v-model="reactiveItem.system.armorPiercing" class="fsr-select">
          <option value="">None</option>
          <option
            v-for="[key, label] in rankChoicesWithValues"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
        <div class="text-xs text-gray-400 mt-1">
          Higher ranks reduce armor more effectively (flat reduction +
          percentage bypass)
        </div>
      </div>

      <!-- Talents -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">
          Applicable Talents
          <i
            class="fas fa-star text-xs text-yellow-400 ml-1"
            :title="'Talents that provide bonuses when using this weapon'"
          ></i>
        </label>
        <div class="space-y-2">
          <div
            v-for="(talent, index) in reactiveItem.system.talents"
            :key="index"
            class="flex gap-2 items-center"
          >
            <input
              v-model="reactiveItem.system.talents[index]"
              type="text"
              class="fsr-input flex-1"
              placeholder="Talent name..."
            />
            <button
              @click="removeTalent(index)"
              class="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
              :title="'Remove talent'"
            >
              ✕
            </button>
          </div>
          <button
            @click="addTalent"
            class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-sm"
          >
            + Add Talent
          </button>
        </div>
        <div class="text-xs text-gray-400 mt-1">
          Specify talent names that apply bonuses to this weapon (e.g., "Weapon
          Master", "Marksman")
        </div>
      </div>

      <!-- Multi-Hit (AoE) Checkbox -->
      <div class="fsr-form-group">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            v-model="reactiveItem.system.multiHit"
            type="checkbox"
            class="w-4 h-4 rounded border-gray-600 text-red-500 focus:ring-2 focus:ring-red-500"
          />
          <span class="fsr-form-label mb-0">
            Multi-Hit (AoE)
            <i
              class="fas fa-burst text-xs text-yellow-400 ml-1"
              :title="'Area of effect - one roll for all targets, no combo penalty'"
            ></i>
          </span>
        </label>
        <div class="text-xs text-gray-400 mt-1">
          For grenades, explosives, and other area-effect weapons. One attack
          roll applies to all targets without combo penalty.
        </div>
      </div>

      <!-- Equipped Checkbox -->
      <div class="fsr-form-group">
        <label
          class="flex items-center gap-2"
          :class="isOwned ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
        >
          <input
            v-model="reactiveItem.system.equipped"
            type="checkbox"
            :disabled="!isOwned"
            class="w-4 h-4 rounded border-gray-600 text-red-500 focus:ring-2 focus:ring-red-500"
          />
          <span class="fsr-form-label mb-0">Equipped</span>
        </label>
        <div v-if="!isOwned" class="text-xs text-yellow-400 mt-1">
          ⚠️ Cannot equip - item must be owned by an actor
        </div>
      </div>

      <!-- Description -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Description</label>
        <textarea
          v-model="reactiveItem.system.description"
          rows="8"
          class="fsr-input resize-y"
          placeholder="Enter weapon description..."
        ></textarea>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, computed, watch } from "vue";
import { Rank, RANK_VALUES, formatRankDisplay } from "../../enums";
import { stringToRank } from "../../utils";
import type { Item } from "@league-of-foundry-developers/foundry-vtt-types/src/foundry/client/data/documents/item";

const reactiveItem = inject("reactiveItem") as any;
const item = inject("item") as Item;
const sheet = inject("sheet") as any;

// Check if item is owned by an actor
const isOwned = computed(() => {
  return item.parent !== null && item.parent !== undefined;
});

const rankChoices = computed(() => {
  // @ts-expect-error - CONFIG.FASERIP added by system
  return CONFIG.FASERIP?.ranks || {};
});

const rankChoicesWithValues = computed(() => {
  const choices: Array<[string, string]> = [];
  Object.entries(rankChoices.value).forEach(([key, label]) => {
    const rank = stringToRank(key);
    const value = RANK_VALUES[rank];
    choices.push([key, `${label} (${value})`]);
  });
  return choices;
});

// Watch for damage rank changes and auto-update to reflect new value
watch(
  () => reactiveItem.system.damageRank,
  newRank => {
    // Damage rank is informational for weapons, but we can keep the pattern
    // for future enhancements (e.g., auto-calculating damage dice)
  }
);

function openImagePicker() {
  // @ts-expect-error - FilePicker.implementation exists
  const fp = new foundry.applications.apps.FilePicker.implementation({
    type: "image",
    current: item.img,
    callback: async (path: string) => {
      reactiveItem.img = path;
      await item.update({ img: path });
    }
  });
  fp.browse();
}

function addTalent() {
  if (!reactiveItem.system.talents) {
    reactiveItem.system.talents = [];
  }
  reactiveItem.system.talents.push("");
}

function removeTalent(index: number) {
  reactiveItem.system.talents.splice(index, 1);
}
</script>
