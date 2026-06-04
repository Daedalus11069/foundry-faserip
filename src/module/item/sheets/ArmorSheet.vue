<template>
  <div class="fsr-sheet">
    <!-- Header -->
    <div class="fsr-header">
      <div class="flex items-center gap-4">
        <!-- Avatar -->
        <div class="cursor-pointer" @click="openImagePicker">
          <img
            :src="reactiveItem.img || 'icons/svg/item-bag.svg'"
            :alt="reactiveItem.name"
            class="fsr-avatar"
          />
        </div>

        <!-- Name and Type -->
        <div class="flex-1">
          <input
            v-model="reactiveItem.name"
            type="text"
            class="fsr-title bg-transparent border-b-2 border-blue-500 focus:border-blue-300 outline-none w-full"
            placeholder="Armor Name"
          />
          <div class="text-sm text-blue-300 mt-1 font-semibold">🛡️ Armor</div>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="fsr-content p-6 space-y-4">
      <!-- Rank -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Rank</label>
        <select
          :value="reactiveItem.system.rank"
          @change="handleRankChange"
          class="fsr-select"
        >
          <option
            v-for="[key, label] in rankChoicesWithValues"
            :key="key"
            :value="key"
          >
            {{ label }}
          </option>
        </select>
      </div>

      <!-- Current Value -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Current Armor Value</label>
        <input
          v-model.number="reactiveItem.system.value"
          type="number"
          min="0"
          class="fsr-input"
        />
      </div>

      <!-- Max Value -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Max Armor Value</label>
        <input
          v-model.number="reactiveItem.system.maxValue"
          type="number"
          min="1"
          class="fsr-input"
        />
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
            class="w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-2 focus:ring-blue-500"
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
          placeholder="Enter armor description..."
        ></textarea>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, computed } from "vue";
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

// Handle rank change - update all three values atomically
function handleRankChange(event: Event) {
  const newRank = (event.target as HTMLSelectElement).value;
  const rank = stringToRank(newRank);
  const newValue = RANK_VALUES[rank];

  // Update all three properties at once to avoid timing issues with watchIgnorable
  reactiveItem.system.rank = newRank;
  reactiveItem.system.value = newValue;
  reactiveItem.system.maxValue = newValue;
}

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
</script>
