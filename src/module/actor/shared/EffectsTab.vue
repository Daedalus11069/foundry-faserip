<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from "vue";
import type { FaseripActor } from "../../documents";
import type { ReactiveActorData } from "../../types/actor-system";

const actor = inject("actor") as FaseripActor;
const reactiveActor = inject("reactiveActor") as ReactiveActorData;

const effectsUpdateKey = ref(0);

const canManageEffects = computed(() => {
  // @ts-expect-error - Foundry game.user global
  return game.user?.isGM === true;
});

const activeEffects = computed(() => {
  void effectsUpdateKey.value;

  return Array.from(actor.effects || [])
    .filter((effect: any) => !effect.disabled)
    .map((effect: any) => ({
      id: effect.id,
      name: effect.name || "Unnamed Effect",
      img: effect.img || effect.icon || "icons/svg/aura.svg",
      description:
        effect.description || effect.flags?.core?.statusId || "Active effect",
      isTemporary: effect.isTemporary === true,
      statuses: Array.from(effect.statuses || [])
    }));
});

const activeStatuses = computed(() => {
  void effectsUpdateKey.value;

  return Array.from(actor.statuses || []);
});

const temporaryStatModifiers = computed(() => {
  void effectsUpdateKey.value;

  // Read from real actor, not reactive clone, so socket updates are visible
  return ((actor.system as any).temporaryStatModifiers || []).filter(
    (modifier: any) => Number(modifier.roundsRemaining || 0) > 0
  );
});

const temporaryDamageModifiers = computed(() => {
  void effectsUpdateKey.value;

  // Read from real actor, not reactive clone, so socket updates are visible
  return ((actor.system as any).temporaryDamageModifiers || []).filter(
    (modifier: any) => Number(modifier.roundsRemaining || 0) > 0
  );
});

const hasAnyEffects = computed(() => {
  return (
    activeEffects.value.length > 0 ||
    activeStatuses.value.length > 0 ||
    temporaryStatModifiers.value.length > 0 ||
    temporaryDamageModifiers.value.length > 0
  );
});

function refreshEffects() {
  effectsUpdateKey.value++;
}

async function removeTemporaryModifier(modifierId: string) {
  if (!canManageEffects.value) return;

  const modifier = ((actor.system as any).temporaryStatModifiers || []).find(
    (m: any) => m.id === modifierId
  );

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove stat modifier from <strong>${modifier?.sourcePowerName || 'Unknown Source'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  const updatedModifiers = ((actor.system as any).temporaryStatModifiers || []).filter(
    (modifier: any) => modifier.id !== modifierId
  );

  await actor.update({
    "system.temporaryStatModifiers": updatedModifiers
  } as Record<string, unknown>);
}

async function removeTemporaryDamageModifier(modifierId: string) {
  if (!canManageEffects.value) return;

  const modifier = ((actor.system as any).temporaryDamageModifiers || []).find(
    (m: any) => m.id === modifierId
  );

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove damage modifier from <strong>${modifier?.sourcePowerName || 'Unknown Source'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  const updatedModifiers = ((actor.system as any).temporaryDamageModifiers || []).filter(
    (modifier: any) => modifier.id !== modifierId
  );

  await actor.update({
    "system.temporaryDamageModifiers": updatedModifiers
  } as Record<string, unknown>);
}

async function removeStatus(statusId: string) {
  if (!canManageEffects.value) return;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove status <strong>${statusId}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  await actor.toggleStatusEffect(statusId, { active: false });
}

async function removeActiveEffect(effectId: string) {
  if (!canManageEffects.value) return;

  const effect = actor.effects.get(effectId);
  if (!effect) return;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove effect <strong>${effect.name || 'Unnamed Effect'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  await effect.delete();
}

const handleActorUpdate = (updatedActor: Actor) => {
  if (updatedActor._id === actor._id) {
    refreshEffects();
  }
};

const handleActiveEffectCreate = (effect: ActiveEffect) => {
  if (effect.parent?._id === actor._id) {
    refreshEffects();
  }
};

const handleActiveEffectUpdate = (effect: ActiveEffect) => {
  if (effect.parent?._id === actor._id) {
    refreshEffects();
  }
};

const handleActiveEffectDelete = (effect: ActiveEffect) => {
  if (effect.parent?._id === actor._id) {
    refreshEffects();
  }
};

onMounted(() => {
  Hooks.on("updateActor", handleActorUpdate);
  Hooks.on("createActiveEffect", handleActiveEffectCreate);
  Hooks.on("updateActiveEffect", handleActiveEffectUpdate);
  Hooks.on("deleteActiveEffect", handleActiveEffectDelete);
});

onUnmounted(() => {
  Hooks.off("updateActor", handleActorUpdate);
  Hooks.off("createActiveEffect", handleActiveEffectCreate);
  Hooks.off("updateActiveEffect", handleActiveEffectUpdate);
  Hooks.off("deleteActiveEffect", handleActiveEffectDelete);
});
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Effects</h2>
      <div class="text-sm text-gray-400">
        {{ activeEffects.length }} active effect{{ activeEffects.length === 1 ? '' : 's' }}
      </div>
    </div>

    <div v-if="!hasAnyEffects" class="text-center text-gray-400 py-8">
      No active statuses or effects.
    </div>

    <div v-else class="space-y-4">
      <div
        v-if="temporaryStatModifiers.length > 0"
        class="bg-gray-900/50 rounded-lg p-4 border border-indigo-900"
      >
        <h3 class="text-lg font-semibold text-indigo-300 mb-3">
          Temporary Stat Modifiers
        </h3>
        <div class="space-y-2">
          <div
            v-for="modifier in temporaryStatModifiers"
            :key="modifier.id"
            class="flex items-center justify-between gap-3 bg-gray-800/80 rounded p-3"
          >
            <div>
              <div class="font-medium text-white">
                {{ modifier.sourcePowerName || 'Stat Modifier' }}
              </div>
              <div class="text-sm text-gray-300">
                {{ modifier.chartShift > 0 ? '+' : '' }}{{ modifier.chartShift }} CS
                {{ modifier.attribute }}
              </div>
            </div>
            <div class="text-sm text-indigo-300">
              {{ modifier.roundsRemaining }} round{{ modifier.roundsRemaining === 1 ? '' : 's' }}
            </div>
            <button
              v-if="canManageEffects"
              @click="removeTemporaryModifier(modifier.id)"
              class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2 shrink-0"
              :title="'Remove temporary stat modifier'"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="temporaryDamageModifiers.length > 0"
        class="bg-gray-900/50 rounded-lg p-4 border border-purple-900"
      >
        <h3 class="text-lg font-semibold text-purple-300 mb-3">
          Temporary Damage Modifiers
        </h3>
        <div class="space-y-2">
          <div
            v-for="modifier in temporaryDamageModifiers"
            :key="modifier.id"
            class="flex items-center justify-between gap-3 bg-gray-800/80 rounded p-3"
          >
            <div>
              <div class="font-medium text-white">
                {{ modifier.sourcePowerName || 'Damage Modifier' }}
              </div>
              <div class="text-sm text-gray-300">
                {{ modifier.chartShift > 0 ? '+' : '' }}{{ modifier.chartShift }} CS Damage
              </div>
            </div>
            <div class="text-sm text-purple-300">
              {{ modifier.roundsRemaining }} round{{ modifier.roundsRemaining === 1 ? '' : 's' }}
            </div>
            <button
              v-if="canManageEffects"
              @click="removeTemporaryDamageModifier(modifier.id)"
              class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2 shrink-0"
              :title="'Remove temporary damage modifier'"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="activeStatuses.length > 0"
        class="bg-gray-900/50 rounded-lg p-4 border border-gray-700"
      >
        <h3 class="text-lg font-semibold text-yellow-300 mb-3">Statuses</h3>
        <div class="flex flex-wrap gap-2">
          <div
            v-for="status in activeStatuses"
            :key="status"
            class="flex items-center gap-2 px-3 py-1 rounded bg-yellow-900/50 text-yellow-200 text-sm"
          >
            {{ status }}
            <button
              v-if="canManageEffects"
              @click="removeStatus(status)"
              class="text-yellow-100 hover:text-white text-xs"
              :title="'Remove status'"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="activeEffects.length > 0"
        class="bg-gray-900/50 rounded-lg p-4 border border-gray-700"
      >
        <h3 class="text-lg font-semibold text-green-300 mb-3">Active Effects</h3>
        <div class="space-y-2">
          <div
            v-for="effect in activeEffects"
            :key="effect.id"
            class="flex items-center gap-3 bg-gray-800/80 rounded p-3"
          >
            <img
              :src="effect.img"
              :alt="effect.name"
              class="w-10 h-10 rounded object-cover bg-gray-900"
            />
            <div class="flex-1 min-w-0">
              <div class="font-medium text-white truncate">{{ effect.name }}</div>
              <div class="text-sm text-gray-400 truncate">{{ effect.description }}</div>
            </div>
            <div class="text-xs text-gray-500 text-right">
              <div v-if="effect.isTemporary">Temporary</div>
              <div v-if="effect.statuses.length > 0">{{ effect.statuses.join(', ') }}</div>
            </div>
            <button
              v-if="canManageEffects"
              @click="removeActiveEffect(effect.id)"
              class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2 shrink-0"
              :title="'Remove active effect'"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>