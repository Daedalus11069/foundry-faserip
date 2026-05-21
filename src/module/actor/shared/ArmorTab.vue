<script setup lang="ts">
import { inject, computed } from "vue";
import { Rank, RANK_ORDER, RANK_VALUES, formatRankDisplay } from "../../enums";
import { getRankValue } from "../../utils";
import type { ArmorItem } from "../../types";

const reactiveActor = inject("reactiveActor") as any;

const armors = computed<ArmorItem[]>(() => reactiveActor.system.armors || []);

const equippedArmor = computed<ArmorItem | undefined>(() =>
  armors.value.find(a => a.equipped)
);

// Ranks available as armor (Typical and above — Shift 0/Feeble/Poor rarely used for armor)
const armorRanks = RANK_ORDER.filter(
  r => r !== Rank.Shift0 && r !== Rank.Feeble && r !== Rank.Poor
);

function addArmor() {
  if (!reactiveActor.system.armors) reactiveActor.system.armors = [];
  const newArmor: ArmorItem = {
    id: crypto.randomUUID(),
    name: "New Armor",
    rank: Rank.Typical,
    value: RANK_VALUES[Rank.Typical],
    equipped: false,
    description: ""
  };
  reactiveActor.system.armors.push(newArmor);
}

async function removeArmor(index: number) {
  const armor = reactiveActor.system.armors[index];
  // @ts-expect-error - DialogV2 path not fully typed
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Delete <strong>${armor.name}</strong>? This cannot be undone.</p>`,
    modal: true
  });
  if (!confirmed) return;
  reactiveActor.system.armors.splice(index, 1);
}

function onRankChange(armor: ArmorItem, rank: string) {
  armor.rank = rank;
  armor.value = getRankValue(rank);
}

function equipArmor(armorId: string) {
  // Only one piece can be equipped at a time
  for (const a of reactiveActor.system.armors) {
    a.equipped = a.id === armorId;
  }
}

function unequipAll() {
  for (const a of reactiveActor.system.armors) {
    a.equipped = false;
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Armor</h2>
      <button @click="addArmor" class="fsr-btn fsr-btn-primary fsr-btn-sm">
        + Add Armor
      </button>
    </div>

    <!-- Equipped summary -->
    <div
      class="mb-4 p-3 rounded"
      :class="
        equippedArmor
          ? 'bg-green-900/40 border border-green-600'
          : 'bg-gray-800/40 border border-gray-600'
      "
    >
      <div class="text-sm font-semibold text-gray-300 mb-1">
        Equipped Protection
      </div>
      <div v-if="equippedArmor" class="flex items-center gap-3">
        <span class="text-white font-bold">{{ equippedArmor.name }}</span>
        <span class="fsr-rank-badge">{{
          formatRankDisplay(equippedArmor.rank)
        }}</span>
        <span class="text-green-400 font-bold"
          >–{{ equippedArmor.value }} dmg</span
        >
        <button
          @click="unequipAll"
          class="ml-auto text-xs text-gray-400 hover:text-red-400"
          title="Unequip"
        >
          ✕ unequip
        </button>
      </div>
      <div v-else class="text-gray-500 italic text-sm">None</div>
    </div>

    <!-- Armor list -->
    <div
      v-if="armors.length === 0"
      class="text-gray-500 italic text-center py-8"
    >
      No armor. Click "+ Add Armor" to add a piece.
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="(armor, index) in armors"
        :key="armor.id"
        class="fsr-card p-3"
        :class="armor.equipped ? 'border border-green-600' : ''"
      >
        <!-- Row 1: equip radio + name + rank + delete -->
        <div class="flex items-center gap-2">
          <!-- Equip toggle -->
          <button
            @click="armor.equipped ? unequipAll() : equipArmor(armor.id)"
            :title="armor.equipped ? 'Unequip' : 'Equip'"
            class="w-5 h-5 rounded-full border-2 shrink-0 transition-colors"
            :class="
              armor.equipped
                ? 'bg-green-500 border-green-400'
                : 'bg-transparent border-gray-500 hover:border-green-500'
            "
          />

          <!-- Name -->
          <input
            v-model="armor.name"
            type="text"
            class="fsr-input basis-1/4 text-sm"
            placeholder="Armor name"
          />

          <!-- Rank selector -->
          <select
            :value="armor.rank"
            @change="(e: any) => onRankChange(armor, e.target.value)"
            class="fsr-select text-sm w-40"
          >
            <option v-for="r in armorRanks" :key="r" :value="r">
              {{ formatRankDisplay(r) }} ({{ RANK_VALUES[r as Rank] }})
            </option>
          </select>

          <!-- Value badge -->
          <span class="text-gray-400 text-sm w-14 text-right"
            >–{{ armor.value }}</span
          >

          <!-- Delete -->
          <button
            @click="removeArmor(index)"
            class="text-gray-500 hover:text-red-400 ml-1 shrink-0"
            title="Delete"
          >
            ✕
          </button>
        </div>

        <!-- Row 2: description -->
        <div class="mt-2">
          <input
            v-model="armor.description"
            type="text"
            class="fsr-input w-full text-xs text-gray-400"
            placeholder="Description (optional)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
