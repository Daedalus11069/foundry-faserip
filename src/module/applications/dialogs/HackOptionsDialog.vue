<template>
  <div class="fsr-hack-options-dialog">
    <div class="space-y-3">
      <div class="space-y-2">
        <label class="font-semibold text-sm">Minigame</label>
        <select v-model="minigameType" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded">
          <option value="node-intrusion">Node Intrusion</option>
          <option value="signal-alignment">Signal Alignment</option>
          <option value="packet-switchboard">Packet Switchboard</option>
          <option value="prism-lock">Prism Lock</option>
        </select>
      </div>

      <div class="space-y-2">
        <label class="font-semibold text-sm">Check Attribute</label>
        <select v-model="attribute" class="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded">
          <option v-for="option in attributeChoices" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
    </div>

    <div class="dialog-buttons flex gap-2 justify-end mt-4">
      <button
        @click="handleCancel"
        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
      >
        Cancel
      </button>
      <button
        @click="handleConfirm"
        class="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500"
      >
        Present Hack
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { VueDialog } from "../vue-dialog";

interface Props {
  dialog: VueDialog;
}

const props = defineProps<Props>();

const minigameType = ref("node-intrusion");
const attribute = ref("reasoning");

const attributeChoices = [
  { value: "fighting", label: "Fighting" },
  { value: "agility", label: "Agility" },
  { value: "strength", label: "Strength" },
  { value: "endurance", label: "Endurance" },
  { value: "reasoning", label: "Reasoning" },
  { value: "intuition", label: "Intuition" },
  { value: "psyche", label: "Psyche" }
];

function handleConfirm() {
  props.dialog.submit({
    minigameType: minigameType.value,
    attribute: attribute.value
  });
}

function handleCancel() {
  props.dialog.submit(null);
}
</script>
