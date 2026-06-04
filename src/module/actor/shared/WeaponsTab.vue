<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from "vue";
import { Rank, ItemType, RANK_VALUES } from "../../enums";
import { stringToRank } from "../../utils";
import type { FaseripActor } from "../../documents";
import type { WeaponItem } from "../../types/items";
import { isWeaponItem } from "../../types/items";

const actor = inject("actor") as FaseripActor;

// Reactive key to force computed updates when items change
const itemsUpdateKey = ref(0);

// Get weapon items from actor.items
const weaponItems = computed((): WeaponItem[] => {
  void itemsUpdateKey.value; // Force reactivity
  return actor.items.filter(isWeaponItem);
});

// Hook callbacks
const handleItemCreate = (item: Item) => {
  if (item.parent?._id === actor._id) {
    itemsUpdateKey.value++;
  }
};

const handleItemUpdate = (item: Item) => {
  if (item.parent?._id === actor._id) {
    itemsUpdateKey.value++;
  }
};

const handleItemDelete = (item: Item) => {
  if (item.parent?._id === actor._id) {
    itemsUpdateKey.value++;
  }
};

onMounted(() => {
  Hooks.on("createItem", handleItemCreate);
  Hooks.on("updateItem", handleItemUpdate);
  Hooks.on("deleteItem", handleItemDelete);
});

onUnmounted(() => {
  Hooks.off("createItem", handleItemCreate);
  Hooks.off("updateItem", handleItemUpdate);
  Hooks.off("deleteItem", handleItemDelete);
});

const rankChoices = computed(() => {
  // @ts-expect-error - CONFIG.FASERIP added by system
  return CONFIG.FASERIP?.ranks || {};
});

const rankChoicesWithValues = computed(() => {
  const choices: Record<string, string> = {};
  Object.entries(rankChoices.value).forEach(([key, label]) => {
    const rank = stringToRank(key);
    const value = RANK_VALUES[rank];
    choices[key] = `${label} (${value})`;
  });
  return choices;
});

async function createWeapon() {
  await actor.createEmbeddedDocuments("Item", [
    {
      name: "New Weapon",
      type: ItemType.Weapon,
      system: {
        weaponType: "melee",
        damage: 0,
        damageRank: Rank.Typical,
        equipped: false,
        description: ""
      }
    } as any
  ]);
}

async function deleteWeapon(itemId: string) {
  const item = actor.items.get(itemId);
  if (!item) return;

  // @ts-expect-error - DialogV2 path not fully typed
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Delete <strong>${item.name}</strong>? This cannot be undone.</p>`,
    modal: true
  });

  if (confirmed) {
    await item.delete();
  }
}

async function toggleEquip(itemId: string) {
  const item = actor.items.get(itemId) as any;
  if (!item) return;

  await item.update({ "system.equipped": !item.system.equipped } as Record<
    string,
    unknown
  >);
}

function editWeapon(itemId: string) {
  const item = actor.items.get(itemId);
  if (item?.sheet) {
    item.sheet.render(true);
  }
}

async function updateWeaponName(itemId: string, newName: string) {
  const item = actor.items.get(itemId);
  if (item && newName.trim()) {
    await item.update({ name: newName.trim() });
  }
}

async function updateWeaponType(itemId: string, newType: string) {
  const item = actor.items.get(itemId);
  if (item) {
    await item.update({ "system.weaponType": newType } as Record<
      string,
      unknown
    >);
  }
}

async function updateWeaponDamage(itemId: string, newDamage: number) {
  const item = actor.items.get(itemId);
  if (item) {
    await item.update({ "system.damage": newDamage } as Record<
      string,
      unknown
    >);
  }
}

async function updateWeaponDamageRank(itemId: string, newRank: string) {
  const item = actor.items.get(itemId);
  if (item) {
    await item.update({ "system.damageRank": newRank } as Record<
      string,
      unknown
    >);
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Weapons</h2>
      <button @click="createWeapon" class="fsr-btn fsr-btn-primary fsr-btn-sm">
        + Add Weapon
      </button>
    </div>

    <!-- Weapons list -->
    <div
      v-if="weaponItems.length === 0"
      class="text-gray-500 italic text-center py-8"
    >
      No weapons. Click "+ Add Weapon" to add one.
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="item in weaponItems"
        :key="item.id!"
        class="fsr-card p-3"
        :class="item.system.equipped ? 'border border-yellow-600' : ''"
      >
        <!-- Row 1: name + type + equipped badge + edit -->
        <div class="flex items-center gap-2">
          <!-- Name (inline editable) -->
          <input
            type="text"
            :value="item.name"
            @blur="
              e =>
                updateWeaponName(item.id!, (e.target as HTMLInputElement).value)
            "
            @keyup.enter="e => (e.target as HTMLInputElement).blur()"
            class="basis-1/2 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm font-semibold hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            placeholder="Weapon name"
          />

          <!-- Weapon type selector (inline editable) -->
          <select
            :value="item.system.weaponType"
            @change="
              e =>
                updateWeaponType(
                  item.id!,
                  (e.target as HTMLSelectElement).value
                )
            "
            class="basis-auto bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs hover:border-blue-500 focus:border-blue-500 focus:outline-none"
          >
            <option value="melee">⚔️ Melee</option>
            <option value="ranged">🏹 Ranged</option>
            <option value="thrown">🎯 Thrown</option>
          </select>

          <!-- Old weapon type badge for reference -->
          <span
            v-if="false"
            class="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300"
          >
            <template v-if="item.system.weaponType === 'melee'">Melee</template>
            <template v-else-if="item.system.weaponType === 'ranged'"
              >Ranged</template
            >
            <template v-else>🎯 Thrown</template>
          </span>

          <!-- Equipped badge -->
          <button
            @click="toggleEquip(item.id!)"
            class="text-xs px-2 py-1 rounded"
            :class="[
              item.system.equipped
                ? 'bg-yellow-600 text-black font-bold'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            ]"
            :title="item.system.equipped ? 'Unequip' : 'Equip'"
          >
            {{ item.system.equipped ? "✓ Equipped" : "Equip" }}
          </button>

          <!-- Edit button -->
          <button
            @click="editWeapon(item.id!)"
            class="text-xs text-blue-400 hover:text-blue-300 px-2"
            :title="'Edit weapon'"
          >
            <i class="fas fa-edit"></i>
          </button>

          <!-- Delete button -->
          <button
            @click="deleteWeapon(item.id!)"
            class="text-xs text-red-400 hover:text-red-300"
            :title="'Delete weapon'"
          >
            <i class="fas fa-trash"></i>
          </button>
        </div>

        <!-- Row 2: damage inputs -->
        <div class="flex items-center gap-2 mt-2">
          <!-- Damage input (varies by weapon type) -->
          <template
            v-if="
              item.system.weaponType === 'melee' ||
              item.system.weaponType === 'thrown'
            "
          >
            <label class="text-xs text-gray-400">Damage:</label>
            <span class="text-xs text-gray-400">Strength</span>
            <input
              type="number"
              :value="item.system.damage"
              @blur="
                e =>
                  updateWeaponDamage(
                    item.id!,
                    Number((e.target as HTMLInputElement).value)
                  )
              "
              @keyup.enter="e => (e.target as HTMLInputElement).blur()"
              class="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-white text-sm hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <span class="text-xs text-gray-400">CS</span>
          </template>
          <template v-else>
            <label class="text-xs text-gray-400">Damage:</label>
            <select
              :value="item.system.damageRank"
              @change="
                e =>
                  updateWeaponDamageRank(
                    item.id!,
                    (e.target as HTMLSelectElement).value
                  )
              "
              class="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-white text-xs hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            >
              <option
                v-for="(label, value) in rankChoicesWithValues"
                :key="value"
                :value="value"
              >
                {{ label }}
              </option>
            </select>
          </template>
        </div>

        <!-- Description -->
        <div
          v-if="item.system.description"
          class="text-xs text-gray-400 mt-2 italic"
        >
          {{ item.system.description }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fsr-card {
  background-color: rgb(31 41 55);
  border-radius: 0.25rem;
  padding: 0.75rem;
  border: 1px solid rgb(55 65 81);
}

.fsr-rank-badge {
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 700;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  background-color: rgb(202 138 4);
  color: #000;
}
</style>
