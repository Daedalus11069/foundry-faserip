<script setup lang="ts">
import { inject, computed } from "vue";
import type { Talent } from "../../types";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor;

const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);

function addTalent() {
  if (!reactiveActor.system.talents) {
    reactiveActor.system.talents = [];
  }

  const newTalent: Talent = {
    id: crypto.randomUUID(),
    name: "New Talent",
    bonus: 0
  };
  reactiveActor.system.talents.push(newTalent);
}

function removeTalent(index: number) {
  reactiveActor.system.talents.splice(index, 1);
}

async function rollWithTalent(talent: Talent) {
  const roll = await Roll.create("1d100");
  await roll.evaluate();

  const total = (roll.total || 0) + talent.bonus;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<strong>${talent.name}</strong><br/>
      Roll: ${roll.total} + Bonus: ${talent.bonus} = ${total}`
  });
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

    <div class="fsr-list">
      <div
        v-for="(talent, index) in talents"
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
            @click="removeTalent(index)"
            class="fsr-btn fsr-btn-sm bg-red-700 hover:bg-red-800 text-white px-2"
          >
            ✕
          </button>
        </div>

        <div class="mb-2">
          <label class="fsr-label">Chart Shift Bonus</label>
          <input
            v-model.number="talent.bonus"
            type="number"
            class="fsr-input"
            placeholder="CS modifier (e.g., 1 for +1CS)"
          />
          <span v-if="talent.bonus !== 0" class="text-sm text-gray-400 ml-2">
            {{ talent.bonus > 0 ? "+" : "" }}{{ talent.bonus }} CS
          </span>
        </div>

        <div
          v-if="talent.description"
          class="mb-2 text-sm text-gray-300 p-2 bg-gray-800 rounded"
        >
          {{ talent.description }}
        </div>

        <button @click="rollWithTalent(talent)" class="fsr-roll-btn w-full">
          🎲 Roll with Talent
        </button>
      </div>

      <div v-if="talents.length === 0" class="text-center text-gray-400 py-8">
        No talents yet. Click "Add Talent" to create one.
      </div>
    </div>
  </div>
</template>
