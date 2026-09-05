<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from "vue";
import { ItemType } from "../../enums";
import { isEquipmentItem } from "../../types/items";
import type { FaseripActor } from "../../documents";
import type { ReactiveActorData } from "../../types/actor-system";

const actor = inject("actor") as FaseripActor;
const reactiveActor = inject("reactiveActor") as ReactiveActorData;

// Reactive key to force recomputation when items change
const itemsUpdateKey = ref(0);
void reactiveActor;

const equipmentItems = computed(() => {
  void itemsUpdateKey.value;
  return actor.items
    .filter(isEquipmentItem)
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
});

const handleItemCreate = (item: Item) => {
  if (item.parent?._id === actor._id) itemsUpdateKey.value++;
};
const handleItemUpdate = (item: Item) => {
  if (item.parent?._id === actor._id) itemsUpdateKey.value++;
};
const handleItemDelete = (item: Item) => {
  if (item.parent?._id === actor._id) itemsUpdateKey.value++;
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

async function createEquipment() {
  await actor.createEmbeddedDocuments("Item", [
    {
      name: "New Equipment",
      type: ItemType.Equipment,
      system: {
        quantity: 1,
        description: ""
      }
    } as any
  ]);
}

function openEquipment(itemId: string) {
  const item = actor.items.get(itemId);
  if (item?.sheet) {
    item.sheet.render(true);
  }
}

async function deleteEquipment(itemId: string) {
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
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Equipment</h2>
      <button
        @click="createEquipment"
        class="fsr-btn fsr-btn-primary fsr-btn-sm"
      >
        + Add Equipment
      </button>
    </div>

    <div
      v-if="equipmentItems.length === 0"
      class="text-gray-500 italic text-center py-8"
    >
      No equipment. Click "+ Add Equipment" to add one.
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="item in equipmentItems"
        :key="item.id"
        class="fsr-card p-3 flex items-center gap-2 cursor-pointer select-none"
        @click="openEquipment(item.id!)"
      >
        <img
          :src="item.img || 'icons/svg/chest.svg'"
          :alt="item.name ?? ''"
          class="w-8 h-8 rounded object-cover shrink-0"
        />
        <span class="font-semibold text-white flex-1 truncate">{{
          item.name
        }}</span>
        <span
          v-if="item.system.hack?.enabled"
          class="text-xs px-2 py-0.5 rounded shrink-0"
          :class="
            item.system.locked
              ? 'bg-cyan-900/60 text-cyan-300'
              : 'bg-green-900/60 text-green-300'
          "
          :title="
            item.system.locked
              ? 'HoloSuite hack lock: locked'
              : 'HoloSuite hack lock: unlocked'
          "
        >
          <i class="fas fa-terminal"></i>
          {{ item.system.locked ? "Locked" : "Unlocked" }}
        </span>
        <span class="text-xs text-gray-400 shrink-0">
          Qty: {{ item.system.quantity }}
        </span>
        <button
          @click.stop="deleteEquipment(item.id!)"
          class="text-xs text-red-400 hover:text-red-300 shrink-0"
          :title="'Delete equipment'"
        >
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  </div>
</template>
