<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from "vue";
import { Rank, ItemType, RANK_VALUES } from "../../enums";
import { stringToRank } from "../../utils";
import type { FaseripActor } from "../../documents";
import type { WeaponItem } from "../../types/items";
import { isWeaponItem } from "../../types/items";
import type { ReactiveActorData } from "../../types/actor-system";

interface DisplayWeapon {
  id: string;
  name: string;
  weaponType: "melee" | "ranged" | "thrown";
  damageRank: string;
  damage: number;
  equipped: boolean;
  description?: string;
  isItem: boolean; // True if this is a weapon Item (can edit), false if from system.weapons (read-only)
  itemRef?: WeaponItem; // Reference to the actual Item if isItem is true
}

const actor = inject("actor") as FaseripActor;
const reactiveActor = inject("reactiveActor") as ReactiveActorData;

// Reactive key to force computed updates when items change
const itemsUpdateKey = ref(0);

// Get weapon items from actor.items AND system.weapons, merge into DisplayWeapon format
const weaponItems = computed((): DisplayWeapon[] => {
  void itemsUpdateKey.value; // Force reactivity

  const displayWeapons: DisplayWeapon[] = [];

  // Add weapon Items (editable)
  const items = actor.items.filter(isWeaponItem) as WeaponItem[];
  items.forEach(item => {
    displayWeapons.push({
      id: item._id!,
      name: item.name || "Unnamed Weapon",
      weaponType: item.system.weaponType as "melee" | "ranged" | "thrown",
      damageRank: item.system.damageRank,
      damage: item.system.damage,
      equipped: item.system.equipped,
      description: item.system.description,
      isItem: true,
      itemRef: item
    });
  });

  // Add system.weapons (read-only from charman sync)
  const systemWeapons = reactiveActor.system.weapons || [];
  systemWeapons.forEach((weapon: any) => {
    // Convert old format to DisplayWeapon
    const weaponType =
      weapon.type === "ranged" || weapon.type === "thrown" ? "ranged" : "melee";

    // Convert damage to rank string if needed
    let damageRank: string;
    if (typeof weapon.damage === "string") {
      damageRank = weapon.damage;
    } else if (typeof weapon.damage === "number") {
      // For melee, damage is CS (column shift), convert to rank for display
      // For now, show as "typical" + CS modifier
      damageRank =
        weapon.type === "melee"
          ? `${Rank.Typical}+${weapon.damage}`
          : Rank.Typical;
    } else {
      damageRank = Rank.Typical;
    }

    displayWeapons.push({
      id: weapon.id || `weapon-${Math.random()}`,
      name: weapon.name,
      weaponType,
      damageRank,
      damage: typeof weapon.damage === "number" ? weapon.damage : 0,
      equipped: weapon.equipped || false,
      description: weapon.description,
      isItem: false
    });
  });

  return displayWeapons;
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

const handleActorUpdate = (updatedActor: any) => {
  if (updatedActor._id === actor._id) {
    itemsUpdateKey.value++;
  }
};

onMounted(() => {
  Hooks.on("createItem", handleItemCreate);
  Hooks.on("updateItem", handleItemUpdate);
  Hooks.on("deleteItem", handleItemDelete);
  Hooks.on("updateActor", handleActorUpdate);
});

onUnmounted(() => {
  Hooks.off("createItem", handleItemCreate);
  Hooks.off("updateItem", handleItemUpdate);
  Hooks.off("deleteItem", handleItemDelete);
  Hooks.off("updateActor", handleActorUpdate);
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

async function deleteWeapon(weaponId: string, isItem: boolean) {
  if (isItem) {
    // Delete Item weapon
    const item = actor.items.get(weaponId);
    if (!item) return;

    // @ts-expect-error - DialogV2 path not fully typed
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: `<p>Delete <strong>${item.name}</strong>? This cannot be undone.</p>`,
      modal: true
    });

    if (confirmed) {
      await item.delete();
    }
  } else {
    // Delete synced weapon from system.weapons
    const systemWeapons = [...(reactiveActor.system.weapons || [])];
    const weaponIndex = systemWeapons.findIndex((w: any) => w.id === weaponId);

    if (weaponIndex === -1) return;

    const weapon = systemWeapons[weaponIndex];

    // @ts-expect-error - DialogV2 path not fully typed
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      content: `<p>Delete <strong>${weapon.name}</strong>? This cannot be undone.</p>`,
      modal: true
    });

    if (confirmed) {
      systemWeapons.splice(weaponIndex, 1);
      await actor.update({
        // @ts-expect-error - system.weapons not fully typed
        "system.weapons": systemWeapons
      });
    }
  }
}

async function toggleEquip(weaponId: string, isItem: boolean) {
  if (isItem) {
    // Toggle Item weapon
    const item = actor.items.get(weaponId) as any;
    if (!item) return;

    await item.update({ "system.equipped": !item.system.equipped } as Record<
      string,
      unknown
    >);
  } else {
    // Toggle synced weapon in system.weapons
    const systemWeapons = [...(reactiveActor.system.weapons || [])];
    const weaponIndex = systemWeapons.findIndex((w: any) => w.id === weaponId);

    if (weaponIndex === -1) return;

    systemWeapons[weaponIndex] = {
      ...systemWeapons[weaponIndex],
      equipped: !systemWeapons[weaponIndex].equipped
    };

    await actor.update({
      // @ts-expect-error - system.weapons not fully typed
      "system.weapons": systemWeapons
    });
  }
}

function editWeapon(weaponId: string, isItem: boolean) {
  if (!isItem) {
    ui.notifications?.info(
      "Synced weapons can be edited inline. Use Charman to change additional properties."
    );
    return;
  }

  const item = actor.items.get(weaponId);
  if (item?.sheet) {
    item.sheet.render(true);
  }
}

async function updateWeaponName(
  weaponId: string,
  newName: string,
  isItem: boolean
) {
  if (isItem) {
    const item = actor.items.get(weaponId);
    if (item && newName.trim()) {
      await item.update({ name: newName.trim() });
    }
  } else {
    // Update synced weapon name
    if (!newName.trim()) return;

    const systemWeapons = [...(reactiveActor.system.weapons || [])];
    const weaponIndex = systemWeapons.findIndex((w: any) => w.id === weaponId);

    if (weaponIndex === -1) return;

    systemWeapons[weaponIndex] = {
      ...systemWeapons[weaponIndex],
      name: newName.trim()
    };

    await actor.update({
      // @ts-expect-error - system.weapons not fully typed
      "system.weapons": systemWeapons
    });
  }
}

async function updateWeaponType(
  weaponId: string,
  newType: string,
  isItem: boolean
) {
  if (isItem) {
    const item = actor.items.get(weaponId);
    if (item) {
      await item.update({ "system.weaponType": newType } as Record<
        string,
        unknown
      >);
    }
  } else {
    // Update synced weapon type
    const systemWeapons = [...(reactiveActor.system.weapons || [])];
    const weaponIndex = systemWeapons.findIndex((w: any) => w.id === weaponId);

    if (weaponIndex === -1) return;

    systemWeapons[weaponIndex] = {
      ...systemWeapons[weaponIndex],
      type: (newType === "thrown" ? "ranged" : newType) as
        | "melee"
        | "ranged"
        | "thrown"
    };

    await actor.update({
      // @ts-expect-error - system.weapons not fully typed
      "system.weapons": systemWeapons
    });
  }
}

async function updateWeaponDamage(
  weaponId: string,
  newDamage: number,
  isItem: boolean
) {
  if (isItem) {
    const item = actor.items.get(weaponId);
    if (item) {
      await item.update({ "system.damage": newDamage } as Record<
        string,
        unknown
      >);
    }
  } else {
    // Update synced weapon damage
    const systemWeapons = [...(reactiveActor.system.weapons || [])];
    const weaponIndex = systemWeapons.findIndex((w: any) => w.id === weaponId);

    if (weaponIndex === -1) return;

    systemWeapons[weaponIndex] = {
      ...systemWeapons[weaponIndex],
      damage: newDamage.toString() // Store as string for compatibility with rank-based damage
    };

    await actor.update({
      // @ts-expect-error - system.weapons not fully typed
      "system.weapons": systemWeapons
    });
  }
}

async function updateWeaponDamageRank(
  weaponId: string,
  newRank: string,
  isItem: boolean
) {
  if (isItem) {
    const item = actor.items.get(weaponId);
    if (item) {
      await item.update({ "system.damageRank": newRank } as Record<
        string,
        unknown
      >);
    }
  } else {
    // Update synced weapon damage rank
    const systemWeapons = [...(reactiveActor.system.weapons || [])];
    const weaponIndex = systemWeapons.findIndex((w: any) => w.id === weaponId);

    if (weaponIndex === -1) return;

    systemWeapons[weaponIndex] = {
      ...systemWeapons[weaponIndex],
      damage: newRank
    };

    await actor.update({
      // @ts-expect-error - system.weapons not fully typed
      "system.weapons": systemWeapons
    });
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
        v-for="weapon in weaponItems"
        :key="weapon.id"
        class="fsr-card p-3"
        :class="weapon.equipped ? 'border border-yellow-600' : ''"
      >
        <!-- Row 1: name + type + equipped badge + sync badge + edit -->
        <div class="flex items-center gap-2">
          <!-- Name (inline editable) -->
          <input
            type="text"
            :value="weapon.name"
            @blur="
              e =>
                updateWeaponName(
                  weapon.id,
                  (e.target as HTMLInputElement).value,
                  weapon.isItem
                )
            "
            @keyup.enter="e => (e.target as HTMLInputElement).blur()"
            class="basis-1/2 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm font-semibold hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            placeholder="Weapon name"
          />

          <!-- Weapon type selector (inline editable) -->
          <select
            :value="weapon.weaponType"
            @change="
              e =>
                updateWeaponType(
                  weapon.id,
                  (e.target as HTMLSelectElement).value,
                  weapon.isItem
                )
            "
            class="basis-auto bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs hover:border-blue-500 focus:border-blue-500 focus:outline-none"
          >
            <option value="melee">⚔️ Melee</option>
            <option value="ranged">🏹 Ranged</option>
            <option value="thrown">🎯 Thrown</option>
          </select>

          <!-- Synced from Charman badge -->
          <span
            v-if="!weapon.isItem"
            class="text-xs px-2 py-0.5 rounded bg-blue-900/60 text-blue-300"
            title="This weapon was synced from Charman (editable here, will be overwritten on next sync)"
          >
            Synced
          </span>

          <!-- Equipped badge -->
          <button
            @click="toggleEquip(weapon.id, weapon.isItem)"
            class="text-xs px-2 py-1 rounded"
            :class="[
              weapon.equipped
                ? 'bg-yellow-600 text-black font-bold'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            ]"
            :title="weapon.equipped ? 'Unequip' : 'Equip'"
          >
            {{ weapon.equipped ? "Equipped" : "Equip" }}
          </button>

          <!-- Edit button (Items only) -->
          <button
            v-if="weapon.isItem"
            @click="editWeapon(weapon.id, weapon.isItem)"
            class="text-xs text-blue-400 hover:text-blue-300 px-2"
            :title="'Edit weapon'"
          >
            <i class="fas fa-edit"></i>
          </button>

          <!-- Delete button -->
          <button
            @click="deleteWeapon(weapon.id, weapon.isItem)"
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
              weapon.weaponType === 'melee' || weapon.weaponType === 'thrown'
            "
          >
            <label class="text-xs text-gray-400">Damage:</label>
            <span class="text-xs text-gray-400">Strength</span>
            <input
              type="number"
              :value="weapon.damage"
              @blur="
                e =>
                  updateWeaponDamage(
                    weapon.id,
                    Number((e.target as HTMLInputElement).value),
                    weapon.isItem
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
              :value="weapon.damageRank"
              @change="
                e =>
                  updateWeaponDamageRank(
                    weapon.id,
                    (e.target as HTMLSelectElement).value,
                    weapon.isItem
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
          v-if="weapon.description"
          class="text-xs text-gray-400 mt-2 italic"
        >
          {{ weapon.description }}
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
