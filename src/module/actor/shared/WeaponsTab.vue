<script setup lang="ts">
import { inject, computed } from "vue";
import {
  Rank,
  RANK_ORDER,
  formatRankDisplay,
  applyChartShift
} from "../../enums";
import { getRankValue, stringToRank } from "../../utils";
import { executeCombatAttack } from "../../combat/combat-flow";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor<"pc" | "npc">;

// Get current form for strength attribute
const currentForm = computed(() => {
  const system = reactiveActor.system;
  return (
    system.forms?.find((f: any) => f.id === system.currentFormId) ||
    system.forms?.[0]
  );
});

interface Weapon {
  id: string;
  name: string;
  type: "melee" | "ranged";
  damage: string | number; // CS number for melee (+X), Rank string for ranged
  stat: "fighting" | "agility";
  applicableTalent?: string;
  description?: string;
  equipped?: boolean;
}

const weapons = computed<Weapon[]>(() => reactiveActor.system.weapons || []);

// Ranks available for weapons
const weaponRanks = RANK_ORDER.filter(
  r => r !== Rank.Shift0 && r !== Rank.Feeble
);

function addWeapon() {
  if (!reactiveActor.system.weapons) reactiveActor.system.weapons = [];
  const newWeapon: Weapon = {
    id: crypto.randomUUID(),
    name: "New Weapon",
    type: "melee",
    damage: 0, // CS for melee weapons
    stat: "fighting",
    applicableTalent: "",
    description: ""
  };
  reactiveActor.system.weapons.push(newWeapon);
}

async function removeWeapon(index: number) {
  const weapon = reactiveActor.system.weapons[index];
  // @ts-expect-error - DialogV2 path not fully typed
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Delete <strong>${weapon.name}</strong>? This cannot be undone.</p>`,
    modal: true
  });
  if (!confirmed) return;
  reactiveActor.system.weapons.splice(index, 1);
}

function onRankChange(weapon: Weapon, rank: string) {
  weapon.damage = rank;
}

function onTypeChange(weapon: Weapon, type: "melee" | "ranged") {
  weapon.type = type;
  // Auto-update stat based on type
  weapon.stat = type === "melee" ? "fighting" : "agility";
  // Change damage format based on type
  if (type === "melee") {
    weapon.damage = 0; // CS for melee
  } else {
    weapon.damage = Rank.Typical; // Rank for ranged
  }
}

async function attackWithWeapon(weapon: Weapon) {
  if (!currentForm.value) return;

  const attackAttribute = weapon.stat;
  const attackType = weapon.type;
  let damageRank: Rank;

  // Calculate damage based on weapon type
  if (weapon.type === "melee") {
    // Melee: Strength + weapon CS
    const strengthRank = stringToRank(
      currentForm.value.attributes.strength.rank
    );
    const weaponCS =
      typeof weapon.damage === "number"
        ? weapon.damage
        : Number(weapon.damage) || 0;
    damageRank = applyChartShift(strengthRank, weaponCS);
  } else {
    // Ranged: Fixed damage rank
    damageRank = stringToRank(
      typeof weapon.damage === "string" ? weapon.damage : Rank.Typical
    );
  }

  // Use combat flow system
  await executeCombatAttack({
    attacker: actor as any,
    attackAttribute,
    attackType,
    powerName: weapon.name,
    powerRank: damageRank,
    damageType: undefined
  });
}

async function toggleEquip(weapon: Weapon) {
  if (!reactiveActor.system.weapons) return;

  const weaponIndex = reactiveActor.system.weapons.findIndex(
    (w: Weapon) => w.id === weapon.id
  );
  if (weaponIndex === -1) return;

  const newEquippedState = !weapon.equipped;

  // If equipping, unequip any other weapon of the same type
  if (newEquippedState) {
    reactiveActor.system.weapons.forEach((w: Weapon, idx: number) => {
      if (idx !== weaponIndex && w.type === weapon.type && w.equipped) {
        w.equipped = false;
      }
    });
  }

  // Toggle this weapon's equipped state
  reactiveActor.system.weapons[weaponIndex].equipped = newEquippedState;

  // Persist to actor
  // await actor.update({
  //   "system.weapons": JSON.parse(JSON.stringify(reactiveActor.system.weapons))
  // });
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Weapons</h2>
      <button @click="addWeapon" class="fsr-btn fsr-btn-primary fsr-btn-sm">
        + Add Weapon
      </button>
    </div>

    <!-- Weapons list -->
    <div
      v-if="weapons.length === 0"
      class="text-gray-500 italic text-center py-8"
    >
      No weapons. Click "+ Add Weapon" to add one.
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="(weapon, index) in weapons"
        :key="weapon.id"
        class="fsr-card p-3"
      >
        <!-- Row 1: name + type + equip + attack + delete -->
        <div class="flex items-center gap-2 mb-2">
          <input
            v-model="weapon.name"
            type="text"
            class="basis-1/3 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white"
            placeholder="Weapon name"
          />

          <select
            :value="weapon.type"
            @change="
              e =>
                onTypeChange(
                  weapon,
                  (e.target as HTMLSelectElement).value as 'melee' | 'ranged'
                )
            "
            class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
          >
            <option value="melee">⚔️ Melee</option>
            <option value="ranged">🏹 Ranged</option>
          </select>

          <button
            @click="toggleEquip(weapon)"
            class="text-xs px-2 py-1 rounded"
            :class="[
              weapon.equipped
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-600 hover:bg-gray-500 text-gray-300'
            ]"
            :title="weapon.equipped ? 'Equipped' : 'Equip'"
          >
            {{ weapon.equipped ? "✓" : "○" }}
          </button>

          <button
            @click="removeWeapon(index)"
            class="text-red-400 hover:text-red-300 px-2"
            title="Delete weapon"
          >
            <i class="fas fa-trash"></i>
          </button>
        </div>

        <!-- Row 2: damage (CS for melee, rank for ranged) + stat + attack button -->
        <div class="flex items-center gap-2 mb-2">
          <!-- Melee weapons: CS input -->
          <div v-if="weapon.type === 'melee'" class="flex items-center gap-1">
            <span class="text-sm text-gray-400">Damage CS:</span>
            <input
              v-model.number="weapon.damage"
              type="number"
              min="-10"
              max="10"
              class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm w-20"
              placeholder="0"
            />
            <span class="text-xs text-gray-500">
              ({{
                currentForm?.attributes?.strength?.rank
                  ? formatRankDisplay(
                      applyChartShift(
                        stringToRank(currentForm.attributes.strength.rank),
                        typeof weapon.damage === "number"
                          ? weapon.damage
                          : Number(weapon.damage) || 0
                      )
                    )
                  : "Str " +
                    ((typeof weapon.damage === "number"
                      ? weapon.damage
                      : Number(weapon.damage) || 0) > 0
                      ? "+"
                      : "") +
                    (typeof weapon.damage === "number"
                      ? weapon.damage
                      : Number(weapon.damage) || 0) +
                    " CS"
              }})
            </span>
          </div>

          <!-- Ranged weapons: Rank selector -->
          <div v-else class="flex items-center gap-1">
            <span class="text-sm text-gray-400">Damage:</span>
            <select
              :value="weapon.damage"
              @change="
                e => (weapon.damage = (e.target as HTMLSelectElement).value)
              "
              class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
            >
              <option v-for="rank in weaponRanks" :key="rank" :value="rank">
                {{ formatRankDisplay(rank) }}
              </option>
            </select>
          </div>

          <div class="flex items-center gap-1">
            <span class="text-sm text-gray-400">Stat:</span>
            <select
              v-model="weapon.stat"
              class="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
            >
              <option value="fighting">Fighting</option>
              <option value="agility">Agility</option>
            </select>
          </div>
        </div>

        <!-- Row 3: applicable talent -->
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm text-gray-400">Talent:</span>
          <input
            v-model="weapon.applicableTalent"
            type="text"
            class="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
            placeholder="Applicable talent (optional)"
          />
        </div>

        <!-- Row 4: description -->
        <div v-if="weapon.description || weapon.description === ''">
          <textarea
            v-model="weapon.description"
            class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm"
            rows="2"
            placeholder="Description (optional)"
          />
        </div>
        <button
          v-else
          @click="weapon.description = ''"
          class="text-xs text-gray-500 hover:text-gray-400"
        >
          + Add description
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Weapon card styling inherited from global fsr-card class */
</style>
