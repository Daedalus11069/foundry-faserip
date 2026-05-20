<script setup lang="ts">
import { inject, computed } from "vue";
import { formatRankDisplay } from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { stringToRank } from "../../utils";
import { getCharmanService } from "../../charman-service";
import type { Power } from "../../types";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor<"pc" | "npc">;

const powers = computed<Power[]>(() => reactiveActor.system.powers || []);

// Check if MP (Mental Points) system is enabled
const mpEnabled = computed(
  () => game.settings.get("faserip", "mpEnabled") ?? false
);

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

  // Check MP cost if enabled
  const mpCost = mpEnabled.value && power.mpCost ? power.mpCost : 0;
  if (mpCost > 0) {
    const currentMP = reactiveActor.system.resources?.mentalPoints?.value ?? 0;
    if (currentMP < mpCost) {
      ui.notifications?.error(
        `Not enough Mental Points. Required: ${mpCost}, Available: ${currentMP}`
      );
      return;
    }
  }

  // Roll the power
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

  // Deduct MP after successful roll
  if (mpCost > 0) {
    const currentMP = reactiveActor.system.resources.mentalPoints.value;
    reactiveActor.system.resources.mentalPoints.value = Math.max(
      0,
      currentMP - mpCost
    );

    // Persist to actor
    await actor.update({
      system: {
        resources: {
          mentalPoints: {
            value: reactiveActor.system.resources.mentalPoints!.value
          }
        }
      }
    });

    // Sync MP with Charman if character is linked
    const charmanData = actor.system.charman;
    if (charmanData?.username && charmanData?.characterName) {
      try {
        const service = getCharmanService();
        await service.updateMP(
          charmanData.username,
          charmanData.characterName,
          reactiveActor.system.resources.mentalPoints.value
        );
      } catch (error) {
        // Service not initialized or sync failed - ignore silently
        console.warn("Could not sync MP to Charman:", error);
      }
    }
  }
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

        <div
          :class="[
            'grid gap-2 mb-2',
            mpEnabled ? 'grid-cols-3' : 'grid-cols-2'
          ]"
        >
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
          <div v-if="mpEnabled">
            <label class="fsr-label">MP Cost</label>
            <input
              v-model.number="power.mpCost"
              type="number"
              class="fsr-input"
              placeholder="0"
              min="0"
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
