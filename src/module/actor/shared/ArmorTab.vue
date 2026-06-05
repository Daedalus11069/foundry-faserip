<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from "vue";
import { Rank, formatRankDisplay, ItemType, RANK_VALUES } from "../../enums";
import { stringToRank } from "../../utils";
import type { FaseripActor } from "../../documents";
import type { ArmorItem } from "../../types/items";
import { isArmorItem } from "../../types/items";

const actor = inject("actor") as FaseripActor;

// Reactive key to force computed updates when items change
const itemsUpdateKey = ref(0);

// Get armor items from actor.items
const armorItems = computed((): ArmorItem[] => {
  void itemsUpdateKey.value; // Force reactivity
  return actor.items.filter(isArmorItem);
});

const equippedArmor = computed((): ArmorItem | undefined => {
  void itemsUpdateKey.value; // Force reactivity
  return armorItems.value.find(item => item.system.equipped);
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

const degradingEnabled = computed(
  () => game.settings.get("faserip", "degradingArmor") ?? false
);

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

async function createArmor() {
  await actor.createEmbeddedDocuments("Item", [
    {
      name: "New Armor",
      type: ItemType.Armor,
      system: {
        rank: Rank.Typical,
        value: 6,
        maxValue: 6,
        equipped: false,
        description: ""
      }
    } as any
  ]);
}

async function deleteArmor(itemId: string) {
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

async function equipArmor(itemId: string) {
  // Unequip all armor first
  const updates = armorItems.value
    .filter(item => item.system.equipped && item.id !== itemId)
    .map(item => ({
      _id: item.id,
      "system.equipped": false
    }));

  if (updates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", updates);
  }

  // Equip the selected armor
  const targetItem = actor.items.get(itemId);
  if (targetItem) {
    await targetItem.update({ "system.equipped": true } as Record<
      string,
      unknown
    >);
  }
}

async function unequipArmor(itemId: string) {
  const item = actor.items.get(itemId);
  if (item) {
    await item.update({ "system.equipped": false } as Record<string, unknown>);
  }
}

function editArmor(itemId: string) {
  const item = actor.items.get(itemId);
  if (item?.sheet) {
    item.sheet.render(true);
  }
}

async function updateArmorName(itemId: string, newName: string) {
  const item = actor.items.get(itemId);
  if (item && newName.trim()) {
    await item.update({ name: newName.trim() });
  }
}

async function updateArmorRank(itemId: string, newRank: string) {
  const item = actor.items.get(itemId);
  if (item) {
    // Get the new armor value based on the rank
    const rank = stringToRank(newRank);
    const newValue = RANK_VALUES[rank];

    // Update rank, current value, and max value all at once
    await item.update({
      "system.rank": newRank,
      "system.value": newValue,
      "system.maxValue": newValue
    } as Record<string, unknown>);
  }
}

async function updateArmorValue(itemId: string, newValue: number) {
  const item = actor.items.get(itemId);
  if (item) {
    await item.update({ "system.value": Math.max(0, newValue) } as Record<
      string,
      unknown
    >);
  }
}

async function updateArmorMaxValue(itemId: string, newMaxValue: number) {
  const item = actor.items.get(itemId);
  if (item) {
    await item.update({ "system.maxValue": Math.max(1, newMaxValue) } as Record<
      string,
      unknown
    >);
  }
}

async function repairArmor(item: ArmorItem) {
  const maxValue = item.system.maxValue || item.system.value;
  const currentDamage = maxValue - item.system.value;

  if (currentDamage <= 0) return;

  // @ts-expect-error - DialogV2 path not fully typed
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Repair ${item.name}` },
    content: `
      <form>
        <div class="form-group">
          <label>Repair Amount (Current: ${item.system.value}/${maxValue}, Damage: ${currentDamage})</label>
          <input type="number" name="amount" value="${currentDamage}" min="1" max="${currentDamage}" autofocus />
        </div>
      </form>
    `,
    modal: true,
    rejectClose: false,
    ok: {
      label: "Repair",
      callback: (_event: unknown, button: { form: HTMLFormElement }) => {
        const form = button.form;
        // @ts-expect-error - FormDataExtended exists
        return new foundry.applications.ux.FormDataExtended(form).object;
      }
    }
  });

  if (result && result.amount) {
    const repairAmount = Math.min(
      Math.max(1, Number(result.amount)),
      currentDamage
    );
    await item.update({
      "system.value": Math.min(maxValue, item.system.value + repairAmount)
    } as Record<string, unknown>);
  }
}

async function updateArmorDescription(itemId: string, newDescription: string) {
  const item = actor.items.get(itemId);
  if (item) {
    await item.update({ "system.description": newDescription } as Record<
      string,
      unknown
    >);
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Armor</h2>
      <button @click="createArmor" class="fsr-btn fsr-btn-primary fsr-btn-sm">
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
          formatRankDisplay(equippedArmor.system.rank)
        }}</span>
        <span v-if="degradingEnabled" class="text-green-400 font-bold"
          >{{ equippedArmor.system.value }}/{{
            equippedArmor.system.maxValue || equippedArmor.system.value
          }}
          armor</span
        >
        <span v-else class="text-green-400 font-bold"
          >–{{ equippedArmor.system.value }} dmg</span
        >
        <button
          v-if="equippedArmor.id"
          @click="unequipArmor(equippedArmor.id)"
          class="ml-auto text-xs text-gray-400 hover:text-red-400"
          :title="'Unequip'"
        >
          ✕ unequip
        </button>
      </div>
      <div v-else class="text-gray-500 italic text-sm">None</div>
    </div>

    <!-- Armor list -->
    <div
      v-if="armorItems.length === 0"
      class="text-gray-500 italic text-center py-8"
    >
      No armor. Click "+ Add Armor" to add a piece.
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="item in armorItems"
        :key="item.id!"
        class="fsr-card p-3"
        :class="item.system.equipped ? 'border border-green-600' : ''"
      >
        <!-- Row 1: equip radio + name + rank + edit -->
        <div class="flex items-center gap-2">
          <!-- Equip toggle -->
          <button
            @click="
              item.system.equipped
                ? unequipArmor(item.id!)
                : equipArmor(item.id!)
            "
            :title="item.system.equipped ? 'Unequip' : 'Equip'"
            class="w-5 h-5 rounded-full border-2 shrink-0 transition-colors"
            :class="
              item.system.equipped
                ? 'bg-green-500 border-green-400'
                : 'bg-transparent border-gray-500 hover:border-green-500'
            "
          >
            <span
              v-if="item.system.equipped"
              class="text-white text-xs leading-none"
              >✓</span
            >
          </button>

          <!-- Name (inline editable) -->
          <input
            type="text"
            :value="item.name"
            @blur="
              e =>
                updateArmorName(item.id!, (e.target as HTMLInputElement).value)
            "
            @keyup.enter="e => (e.target as HTMLInputElement).blur()"
            class="basis-1/2 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-sm font-semibold hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            placeholder="Armor name"
          />

          <!-- Rank selector (inline editable) -->
          <select
            :value="item.system.rank"
            @change="
              e =>
                updateArmorRank(item.id!, (e.target as HTMLSelectElement).value)
            "
            class="basis-auto bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white text-xs font-semibold hover:border-blue-500 focus:border-blue-500 focus:outline-none"
          >
            <option
              v-for="(label, value) in rankChoicesWithValues"
              :key="value"
              :value="value"
            >
              {{ label }}
            </option>
          </select>

          <!-- Old rank badge for reference -->
          <span v-if="false" class="fsr-rank-badge">{{
            formatRankDisplay(item.system.rank)
          }}</span>

          <!-- Edit button -->
          <button
            @click="editArmor(item.id!)"
            class="text-xs text-blue-400 hover:text-blue-300 px-2"
            :title="'Edit armor'"
          >
            <i class="fas fa-edit"></i>
          </button>

          <!-- Delete button -->
          <button
            @click="deleteArmor(item.id!)"
            class="text-xs text-red-400 hover:text-red-300"
            :title="'Delete armor'"
          >
            <i class="fas fa-trash"></i>
          </button>
        </div>

        <!-- Row 2: armor value inputs + repair button -->
        <div class="flex items-center gap-2 mt-2">
          <div class="flex items-center gap-2">
            <label class="text-xs text-gray-400">Current:</label>
            <input
              type="number"
              :value="item.system.value"
              @blur="
                e =>
                  updateArmorValue(
                    item.id!,
                    Number((e.target as HTMLInputElement).value)
                  )
              "
              @keyup.enter="e => (e.target as HTMLInputElement).blur()"
              :min="0"
              :max="item.system.maxValue"
              class="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-white text-sm hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <span v-if="degradingEnabled" class="text-xs text-gray-400">/</span>
            <input
              v-if="degradingEnabled"
              type="number"
              :value="item.system.maxValue"
              @blur="
                e =>
                  updateArmorMaxValue(
                    item.id!,
                    Number((e.target as HTMLInputElement).value)
                  )
              "
              @keyup.enter="e => (e.target as HTMLInputElement).blur()"
              :min="1"
              class="w-16 bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-white text-sm hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            />
            <span class="text-xs text-gray-400">{{
              degradingEnabled ? "armor" : "armor value"
            }}</span>
          </div>

          <button
            v-if="degradingEnabled && item.system.value < item.system.maxValue"
            @click="repairArmor(item)"
            class="ml-auto text-xs fsr-btn fsr-btn-primary py-0.5 px-2"
          >
            🔧 Repair
          </button>
        </div>

        <!-- Description -->
        <div class="mt-2">
          <label class="text-xs text-gray-400 block mb-1">Description</label>
          <textarea
            :value="item.system.description || ''"
            @blur="
              e =>
                updateArmorDescription(
                  item.id!,
                  (e.target as HTMLTextAreaElement).value
                )
            "
            class="w-full bg-gray-800 border border-gray-600 rounded px-2 p-2 text-white text-xs hover:border-blue-500 focus:border-blue-500 focus:outline-none"
            rows="2"
            placeholder="Armor description or notes..."
          ></textarea>
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
