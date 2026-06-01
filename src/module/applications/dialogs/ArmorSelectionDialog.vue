<template>
  <div class="armor-selection-dialog p-4">
    <p class="mb-4 text-sm">
      Select which armor to repair for <strong>{{ targetName }}</strong
      >:
    </p>

    <div class="flex flex-col gap-2">
      <button
        v-for="armor in armorOptions"
        :key="armor.id"
        class="armor-option p-3 border border-gray-600 rounded hover:border-blue-500 hover:bg-blue-900/20 transition-colors text-left"
        @click="selectArmor(armor.id)"
      >
        <div class="flex justify-between items-center">
          <div>
            <div class="font-semibold text-white">{{ armor.name }}</div>
            <div class="text-sm text-gray-400">{{ armor.type }}</div>
          </div>
          <div class="text-right">
            <div class="text-white font-bold">
              {{ armor.value }}/{{ armor.maxValue }}
            </div>
            <div class="text-xs text-gray-400">{{ armor.rank }}</div>
          </div>
        </div>
      </button>
    </div>

    <div class="flex gap-2 justify-end mt-4">
      <button
        class="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded text-white"
        @click="handleCancel"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { VueDialog } from "../vue-dialog";

interface ArmorOption {
  id: string;
  name: string;
  type: string; // "Equipped Armor" or "Body Armor Power"
  value: number;
  maxValue: number;
  rank: string;
}

interface Props {
  targetName: string;
  armorOptions: ArmorOption[];
  dialog: VueDialog;
}

const props = defineProps<Props>();

function selectArmor(armorId: string) {
  props.dialog.submit({ armorId });
}

function handleCancel() {
  props.dialog.submit(null);
}
</script>

<style scoped>
.armor-selection-dialog {
  min-width: 400px;
}

.armor-option:focus {
  outline: 2px solid rgb(59, 130, 246);
  outline-offset: 2px;
}
</style>
