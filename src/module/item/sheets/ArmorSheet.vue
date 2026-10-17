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
        <label class="fsr-form-label"
          >Current Armor Value
          <span class="fsr-help-text"
            >(Physical soak, unless overridden below)</span
          ></label
        >
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

      <!-- Per-type armor soak (Physical / Magic / Mental) -->
      <div class="fsr-form-group">
        <label class="fsr-form-label"
          >Per-Type Armor
          <span class="fsr-help-text"
            >(optional - leave Physical blank to use the Current/Max Armor
            Value above; Magic and Mental default to 0)</span
          ></label
        >
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="text-xs text-gray-400">Physical</label>
            <input
              v-model.number="reactiveItem.system.physicalValue"
              type="number"
              min="0"
              class="fsr-input text-sm"
              placeholder="(uses value above)"
            />
            <input
              v-model.number="reactiveItem.system.physicalMaxValue"
              type="number"
              min="0"
              class="fsr-input text-sm mt-1"
              placeholder="Max"
            />
          </div>
          <div>
            <label class="text-xs text-gray-400">Magic</label>
            <input
              v-model.number="reactiveItem.system.magicValue"
              type="number"
              min="0"
              class="fsr-input text-sm"
            />
            <input
              v-model.number="reactiveItem.system.magicMaxValue"
              type="number"
              min="0"
              class="fsr-input text-sm mt-1"
              placeholder="Max"
            />
          </div>
          <div>
            <label class="text-xs text-gray-400">Mental/Psionic</label>
            <input
              v-model.number="reactiveItem.system.mentalValue"
              type="number"
              min="0"
              class="fsr-input text-sm"
            />
            <input
              v-model.number="reactiveItem.system.mentalMaxValue"
              type="number"
              min="0"
              class="fsr-input text-sm mt-1"
              placeholder="Max"
            />
          </div>
        </div>
      </div>

      <!-- Layer -->
      <div class="fsr-form-group">
        <label class="fsr-form-label"
          >Armor Layer
          <span class="fsr-help-text"
            >(1 = outermost. Damage passes through layers outer to inner; pieces
            in the same layer add together)</span
          ></label
        >
        <input
          v-model.number="reactiveItem.system.layer"
          type="number"
          min="1"
          class="fsr-input"
        />
      </div>

      <!-- Other damage types -->
      <div class="fsr-form-group">
        <label class="fsr-form-label"
          >Other Damage Types
          <span class="fsr-help-text"
            >(leave all untouched for legacy behavior: soaks these at the Current
            Armor Value. Once any is set, unlisted types soak 0 on this
            piece)</span
          ></label
        >
        <div class="grid grid-cols-3 gap-2">
          <div v-for="t in EXTRA_SOAK_TYPES" :key="t.key">
            <label class="text-xs text-gray-400">{{ t.label }}</label>
            <input
              :value="reactiveItem.system.typeValues?.[t.key]?.value ?? ''"
              @input="setTypeValue(t.key, 'value', $event)"
              type="number"
              min="0"
              class="fsr-input text-sm"
            />
            <input
              :value="reactiveItem.system.typeValues?.[t.key]?.max ?? ''"
              @input="setTypeValue(t.key, 'max', $event)"
              type="number"
              min="0"
              class="fsr-input text-sm mt-1"
              placeholder="Max"
            />
          </div>
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
// @ts-expect-error - Foundry Item type exists
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

const EXTRA_SOAK_TYPES = [
  { key: "energy", label: "Energy" },
  { key: "fire", label: "Fire" },
  { key: "cold", label: "Cold" },
  { key: "electricity", label: "Electricity" },
  { key: "radiation", label: "Radiation" },
  { key: "sonic", label: "Sonic" },
  { key: "acid", label: "Acid" },
  { key: "poison", label: "Poison" },
  { key: "force", label: "Force" }
];

// Blank counts as 0. Keys are never removed (item updates merge object
// fields), so a cleared type stays configured at 0. Max follows value upward
// so a piece never ends up with a current value above its max.
function setTypeValue(type: string, field: "value" | "max", event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  const entry = {
    value: 0,
    max: 0,
    ...(reactiveItem.system.typeValues?.[type] ?? {})
  };
  entry[field] = raw === "" ? 0 : Math.max(0, Number(raw));
  if (field === "value" && entry.max < entry.value) entry.max = entry.value;
  reactiveItem.system.typeValues = {
    ...(reactiveItem.system.typeValues ?? {}),
    [type]: entry
  };
}

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
