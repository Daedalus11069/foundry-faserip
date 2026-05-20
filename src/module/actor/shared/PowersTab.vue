<script setup lang="ts">
import { inject, computed } from "vue";
import { Rank, formatRankDisplay } from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { stringToRank } from "../../utils";
import type { Power } from "../../types";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor;

const powers = computed<Power[]>(() => reactiveActor.system.powers || []);

function addPower() {
  if (!reactiveActor.system.powers) {
    reactiveActor.system.powers = [];
  }

  const newPower: Power = {
    id: crypto.randomUUID(),
    name: "New Power",
    rank: "typical",
    category: "general",
    value: 6 // Typical rank value
  };
  reactiveActor.system.powers.push(newPower);
}

function removePower(index: number) {
  reactiveActor.system.powers.splice(index, 1);
}

async function rollPower(power: Power) {
  const rank = stringToRank(power.rank);
  const value = power.value || 6;

  await FaseripRoll.rollAttribute(
    power.name,
    rank,
    value,
    0,
    actor,
    undefined,
    undefined,
    undefined,
    undefined
  );
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Powers</h2>
      <button @click="addPower" class="fsr-btn fsr-btn-primary fsr-btn-sm">
        + Add Power
      </button>
    </div>

    <div class="fsr-list">
      <div
        v-for="(power, index) in powers"
        :key="power.id"
        class="fsr-list-item"
        :title="`${power.name} - ${formatRankDisplay(power.rank)}`"
      >
        <div class="fsr-list-item-header mb-2">
          <input
            v-model="power.name"
            type="text"
            class="fsr-input flex-1 mr-2"
            placeholder="Power Name"
          />
          <button
            @click="removePower(index)"
            class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2"
          >
            ✕
          </button>
        </div>

        <div class="grid grid-cols-2 gap-2 mb-2">
          <div>
            <label class="fsr-label">Rank</label>
            <input
              v-model="power.rank"
              type="text"
              class="fsr-input"
              placeholder="e.g. Remarkable"
            />
          </div>
          <div>
            <label class="fsr-label">Category</label>
            <input
              v-model="power.category"
              type="text"
              class="fsr-input"
              placeholder="e.g. Fighting"
            />
          </div>
        </div>

        <div
          v-if="power.description"
          class="mb-2 text-sm text-gray-300 p-2 bg-gray-800 rounded"
        >
          {{ power.description }}
        </div>

        <button
          @click="rollPower(power)"
          class="fsr-roll-btn w-full"
          :title="`Roll ${power.name} (${formatRankDisplay(power.rank)})`"
        >
          🎲 Use Power
        </button>
      </div>

      <div v-if="powers.length === 0" class="text-center text-gray-400 py-8">
        No powers yet. Click "Add Power" to create one.
      </div>
    </div>
  </div>
</template>
