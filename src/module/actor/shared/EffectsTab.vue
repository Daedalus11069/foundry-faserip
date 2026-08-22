

<template>
  <div>
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-2xl font-bold text-white">Effects</h2>
      <div class="text-sm text-gray-400">
        {{ activeEffects.length }} active effect{{ activeEffects.length === 1 ? '' : 's' }}
      </div>
    </div>

    <div v-if="canManageEffects" class="flex gap-2 mb-4">
      <button
        @click="showAddStatModifier = !showAddStatModifier"
        class="fsr-btn fsr-btn-sm bg-indigo-900 hover:bg-indigo-950 text-white"
      >
        + Add Stat Modifier
      </button>
      <button
        @click="showAddDamageModifier = !showAddDamageModifier"
        class="fsr-btn fsr-btn-sm bg-purple-900 hover:bg-purple-950 text-white"
      >
        + Add Damage Modifier
      </button>
      <button
        @click="showAddIncomingModifier = !showAddIncomingModifier"
        class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white"
      >
        + Add Incoming Attack Modifier
      </button>
    </div>

    <div
      v-if="showAddStatModifier"
      class="mb-4 p-3 bg-gray-900/50 rounded-lg border border-indigo-800 space-y-2"
    >
      <h3 class="text-sm font-semibold text-indigo-300">New Stat Modifier</h3>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="fsr-label">Attribute</label>
          <select v-model="newStatModifier.attribute" class="fsr-select text-sm">
            <option v-for="option in attributeChoices" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div>
          <label class="fsr-label">Source Name</label>
          <input v-model="newStatModifier.sourceName" type="text" class="fsr-input" />
        </div>
        <div>
          <label class="fsr-label">Chart Shift</label>
          <input
            v-model.number="newStatModifier.chartShift"
            type="number"
            class="fsr-input"
            placeholder="-1"
          />
        </div>
        <div>
          <label class="fsr-label">Rounds Remaining</label>
          <input
            v-model.number="newStatModifier.roundsRemaining"
            type="number"
            min="1"
            class="fsr-input"
          />
        </div>
        <div>
          <label class="fsr-label">Trigger</label>
          <select v-model="newStatModifier.trigger" class="fsr-select text-sm">
            <option v-for="option in triggerChoices" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div v-if="newStatModifier.trigger">
          <label class="fsr-label">Number of Actions</label>
          <input
            v-model.number="newStatModifier.usesRemaining"
            type="number"
            min="1"
            class="fsr-input"
          />
        </div>
      </div>
      <div class="text-xs text-gray-400">
        Positive values buff, negative values debuff. A trigger consumes the modifier the
        first time a matching roll happens instead of lasting the full duration. With a
        trigger set, "Number of Actions" lets it survive multiple matching rolls (e.g. 2
        buffed attacks) before it falls off.
      </div>
      <div class="flex gap-2">
        <button
          @click="addStatModifier"
          class="fsr-btn fsr-btn-sm bg-indigo-700 hover:bg-indigo-800 text-white"
        >
          Add
        </button>
        <button
          @click="showAddStatModifier = false"
          class="fsr-btn fsr-btn-sm bg-gray-700 hover:bg-gray-800 text-white"
        >
          Cancel
        </button>
      </div>
    </div>

    <div
      v-if="showAddDamageModifier"
      class="mb-4 p-3 bg-gray-900/50 rounded-lg border border-purple-800 space-y-2"
    >
      <h3 class="text-sm font-semibold text-purple-300">New Damage Modifier</h3>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="fsr-label">Source Name</label>
          <input v-model="newDamageModifier.sourceName" type="text" class="fsr-input" />
        </div>
        <div>
          <label class="fsr-label">Chart Shift</label>
          <input
            v-model.number="newDamageModifier.chartShift"
            type="number"
            class="fsr-input"
            placeholder="-1"
          />
        </div>
        <div>
          <label class="fsr-label">Rounds Remaining</label>
          <input
            v-model.number="newDamageModifier.roundsRemaining"
            type="number"
            min="1"
            class="fsr-input"
          />
        </div>
        <div>
          <label class="fsr-label">Trigger</label>
          <select v-model="newDamageModifier.trigger" class="fsr-select text-sm">
            <option v-for="option in triggerChoices" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>
        <div v-if="newDamageModifier.trigger">
          <label class="fsr-label">Number of Actions</label>
          <input
            v-model.number="newDamageModifier.usesRemaining"
            type="number"
            min="1"
            class="fsr-input"
          />
        </div>
      </div>
      <div class="text-xs text-gray-400">
        Positive values buff damage, negative values debuff damage. A trigger consumes the
        modifier the first time a matching roll happens instead of lasting the full duration.
        With a trigger set, "Number of Actions" lets it survive multiple matching rolls
        before it falls off.
      </div>
      <div class="flex gap-2">
        <button
          @click="addDamageModifier"
          class="fsr-btn fsr-btn-sm bg-purple-700 hover:bg-purple-800 text-white"
        >
          Add
        </button>
        <button
          @click="showAddDamageModifier = false"
          class="fsr-btn fsr-btn-sm bg-gray-700 hover:bg-gray-800 text-white"
        >
          Cancel
        </button>
      </div>
    </div>

    <div
      v-if="showAddIncomingModifier"
      class="mb-4 p-3 bg-gray-900/50 rounded-lg border border-red-800 space-y-2"
    >
      <h3 class="text-sm font-semibold text-red-300">New Incoming Attack Modifier</h3>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="fsr-label">Source Name</label>
          <input v-model="newIncomingModifier.sourceName" type="text" class="fsr-input" />
        </div>
        <div>
          <label class="fsr-label">Chart Shift</label>
          <input
            v-model.number="newIncomingModifier.chartShift"
            type="number"
            class="fsr-input"
            placeholder="2"
          />
        </div>
        <div>
          <label class="fsr-label">Rounds Remaining</label>
          <input
            v-model.number="newIncomingModifier.roundsRemaining"
            type="number"
            min="1"
            class="fsr-input"
          />
        </div>
        <div>
          <label class="fsr-label">Number of Attacks</label>
          <input
            v-model.number="newIncomingModifier.usesRemaining"
            type="number"
            min="1"
            class="fsr-input"
          />
        </div>
      </div>
      <div class="text-xs text-gray-400">
        Shifts any foe's attack roll against this actor. Positive values make foes more
        likely to hit (debuff on this actor); negative values make foes less likely to hit
        (buff). "Number of Attacks" consumes the modifier after that many attacks land
        against this actor, whichever comes first with Rounds Remaining.
      </div>
      <div class="flex gap-2">
        <button
          @click="addIncomingModifier"
          class="fsr-btn fsr-btn-sm bg-red-700 hover:bg-red-800 text-white"
        >
          Add
        </button>
        <button
          @click="showAddIncomingModifier = false"
          class="fsr-btn fsr-btn-sm bg-gray-700 hover:bg-gray-800 text-white"
        >
          Cancel
        </button>
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
                <span v-if="modifier.triggerLabel" class="ml-1 px-1.5 py-0.5 rounded bg-indigo-800 text-indigo-200 text-xs">
                  {{ modifier.triggerLabel }}
                </span>
                <span v-if="modifier.usesRemaining" class="ml-1 px-1.5 py-0.5 rounded bg-indigo-800 text-indigo-200 text-xs">
                  {{ modifier.usesRemaining }} action{{ modifier.usesRemaining === 1 ? '' : 's' }} left
                </span>
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
                <span v-if="modifier.triggerLabel" class="ml-1 px-1.5 py-0.5 rounded bg-purple-800 text-purple-200 text-xs">
                  {{ modifier.triggerLabel }}
                </span>
                <span v-if="modifier.usesRemaining" class="ml-1 px-1.5 py-0.5 rounded bg-purple-800 text-purple-200 text-xs">
                  {{ modifier.usesRemaining }} action{{ modifier.usesRemaining === 1 ? '' : 's' }} left
                </span>
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
        v-if="dotEffects.length > 0"
        class="bg-gray-900/50 rounded-lg p-4 border border-green-900"
      >
        <h3 class="text-lg font-semibold text-green-300 mb-3">
          Damage Over Time
        </h3>
        <div class="space-y-2">
          <div
            v-for="modifier in dotEffects"
            :key="modifier.id"
            class="flex items-center justify-between gap-3 bg-gray-800/80 rounded p-3"
          >
            <div>
              <div class="font-medium text-white">
                {{ modifier.sourcePowerName || 'Damage Over Time' }}
              </div>
              <div class="text-sm text-gray-300">
                {{ modifier.dotRank }} damage
                <span v-if="modifier.armorPiercing" class="ml-1 px-1.5 py-0.5 rounded bg-green-800 text-green-200 text-xs">
                  {{ modifier.armorPiercing }} AP
                </span>
              </div>
            </div>
            <div class="text-sm text-green-300">
              {{ modifier.roundsRemaining }} round{{ modifier.roundsRemaining === 1 ? '' : 's' }}
            </div>
            <button
              @click="removeDotEffect(modifier.id)"
              class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2 shrink-0"
              :title="'Remove damage-over-time effect'"
            >
              ✕
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="incomingAttackModifiers.length > 0"
        class="bg-gray-900/50 rounded-lg p-4 border border-red-900"
      >
        <h3 class="text-lg font-semibold text-red-300 mb-3">
          Incoming Attack Modifiers
        </h3>
        <div class="space-y-2">
          <div
            v-for="modifier in incomingAttackModifiers"
            :key="modifier.id"
            class="flex items-center justify-between gap-3 bg-gray-800/80 rounded p-3"
          >
            <div>
              <div class="font-medium text-white">
                {{ modifier.sourcePowerName || 'Incoming Attack Modifier' }}
              </div>
              <div class="text-sm text-gray-300">
                Foes {{ modifier.chartShift > 0 ? '+' : '' }}{{ modifier.chartShift }} CS to hit
                <span v-if="modifier.usesRemaining" class="ml-1 px-1.5 py-0.5 rounded bg-red-800 text-red-200 text-xs">
                  {{ modifier.usesRemaining }} attack{{ modifier.usesRemaining === 1 ? '' : 's' }} left
                </span>
              </div>
            </div>
            <div class="text-sm text-red-300">
              {{ modifier.roundsRemaining }} round{{ modifier.roundsRemaining === 1 ? '' : 's' }}
            </div>
            <button
              v-if="canManageEffects"
              @click="removeIncomingModifier(modifier.id)"
              class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2 shrink-0"
              :title="'Remove incoming attack modifier'"
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

<script setup lang="ts">
import { inject, computed, ref, onMounted, onUnmounted } from "vue";
import type { FaseripActor } from "../../documents";
import type { ReactiveActorData } from "../../types/actor-system";
import { applyTemporaryModifier } from "../../utils/temp-effects";
import { requestDotRemoval } from "../../socket/faserip-socket";

const actor = inject("actor") as FaseripActor;
const reactiveActor = inject("reactiveActor") as ReactiveActorData;

const effectsUpdateKey = ref(0);

const canManageEffects = computed(() => {
  // @ts-expect-error - Foundry game.user global
  return game.user?.isGM === true;
});

const attributeChoices = [
  { value: "fighting", label: "Fighting" },
  { value: "agility", label: "Agility" },
  { value: "strength", label: "Strength" },
  { value: "endurance", label: "Endurance" },
  { value: "reasoning", label: "Reasoning" },
  { value: "intuition", label: "Intuition" },
  { value: "psyche", label: "Psyche" }
];

const triggerChoices = [
  { value: "", label: "None (passive)" },
  { value: "nextAttack", label: "Next Attack" },
  { value: "nextDodge", label: "Next Defense" },
  { value: "nextAction", label: "Next Action" }
];

const showAddStatModifier = ref(false);
const newStatModifier = ref({
  attribute: "fighting",
  chartShift: 0,
  roundsRemaining: 3,
  sourceName: "GM Applied",
  trigger: "",
  usesRemaining: 1
});

const showAddDamageModifier = ref(false);
const newDamageModifier = ref({
  chartShift: 0,
  roundsRemaining: 3,
  sourceName: "GM Applied",
  trigger: "",
  usesRemaining: 1
});

const showAddIncomingModifier = ref(false);
const newIncomingModifier = ref({
  chartShift: 2,
  roundsRemaining: 3,
  sourceName: "GM Applied",
  usesRemaining: 1
});

async function addStatModifier() {
  if (!canManageEffects.value) return;

  await applyTemporaryModifier(actor, {
    kind: "stat",
    attribute: newStatModifier.value.attribute as any,
    chartShift: Number(newStatModifier.value.chartShift) || 0,
    roundsRemaining: Number(newStatModifier.value.roundsRemaining) || 1,
    sourceName: newStatModifier.value.sourceName,
    trigger: (newStatModifier.value.trigger || undefined) as any,
    usesRemaining: Number(newStatModifier.value.usesRemaining) || 1
  });

  showAddStatModifier.value = false;
  newStatModifier.value = {
    attribute: "intuition",
    chartShift: -1,
    roundsRemaining: 3,
    sourceName: "GM Applied",
    trigger: "",
    usesRemaining: 1
  };
}

async function addDamageModifier() {
  if (!canManageEffects.value) return;

  await applyTemporaryModifier(actor, {
    kind: "damage",
    chartShift: Number(newDamageModifier.value.chartShift) || 0,
    roundsRemaining: Number(newDamageModifier.value.roundsRemaining) || 1,
    sourceName: newDamageModifier.value.sourceName,
    trigger: (newDamageModifier.value.trigger || undefined) as any,
    usesRemaining: Number(newDamageModifier.value.usesRemaining) || 1
  });

  showAddDamageModifier.value = false;
  newDamageModifier.value = {
    chartShift: -1,
    roundsRemaining: 3,
    sourceName: "GM Applied",
    trigger: "",
    usesRemaining: 1
  };
}

async function addIncomingModifier() {
  if (!canManageEffects.value) return;

  await applyTemporaryModifier(actor, {
    kind: "incoming",
    chartShift: Number(newIncomingModifier.value.chartShift) || 0,
    roundsRemaining: Number(newIncomingModifier.value.roundsRemaining) || 1,
    sourceName: newIncomingModifier.value.sourceName,
    usesRemaining: Number(newIncomingModifier.value.usesRemaining) || 1
  });

  showAddIncomingModifier.value = false;
  newIncomingModifier.value = {
    chartShift: 2,
    roundsRemaining: 3,
    sourceName: "GM Applied",
    usesRemaining: 1
  };
}

const activeEffects = computed(() => {
  void effectsUpdateKey.value;

  return Array.from(actor.effects || [])
    .filter((effect: any) => !effect.disabled && !effect.flags?.faserip)
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

const triggerLabels: Record<string, string> = {
  nextAttack: "Next Attack",
  nextDodge: "Next Defense",
  nextAction: "Next Action"
};

const temporaryStatModifiers = computed(() => {
  void effectsUpdateKey.value;

  return Array.from(actor.effects || [])
    .filter((effect: any) => !effect.disabled && effect.flags?.faserip?.kind === "stat")
    .map((effect: any) => ({
      id: effect.id,
      attribute: effect.flags.faserip.attribute,
      chartShift: effect.flags.faserip.chartShift,
      roundsRemaining: effect.flags.faserip.roundsRemaining ?? 0,
      sourcePowerName: effect.flags.faserip.sourcePowerName || effect.name,
      triggerLabel: triggerLabels[effect.flags.faserip.trigger] || null,
      usesRemaining: effect.flags.faserip.usesRemaining ?? null
    }));
});

const temporaryDamageModifiers = computed(() => {
  void effectsUpdateKey.value;

  return Array.from(actor.effects || [])
    .filter((effect: any) => !effect.disabled && effect.flags?.faserip?.kind === "damage")
    .map((effect: any) => ({
      id: effect.id,
      chartShift: effect.flags.faserip.chartShift,
      roundsRemaining: effect.flags.faserip.roundsRemaining ?? 0,
      sourcePowerName: effect.flags.faserip.sourcePowerName || effect.name,
      triggerLabel: triggerLabels[effect.flags.faserip.trigger] || null,
      usesRemaining: effect.flags.faserip.usesRemaining ?? null
    }));
});

const dotEffects = computed(() => {
  void effectsUpdateKey.value;

  return Array.from(actor.effects || [])
    .filter((effect: any) => !effect.disabled && effect.flags?.faserip?.kind === "dot")
    .map((effect: any) => ({
      id: effect.id,
      dotRank: effect.flags.faserip.dotRank,
      armorPiercing: effect.flags.faserip.dotArmorPiercing || null,
      roundsRemaining: effect.flags.faserip.roundsRemaining ?? 0,
      sourcePowerName: effect.flags.faserip.sourcePowerName || effect.name
    }));
});

const incomingAttackModifiers = computed(() => {
  void effectsUpdateKey.value;

  return Array.from(actor.effects || [])
    .filter((effect: any) => !effect.disabled && effect.flags?.faserip?.kind === "incoming")
    .map((effect: any) => ({
      id: effect.id,
      chartShift: effect.flags.faserip.chartShift,
      roundsRemaining: effect.flags.faserip.roundsRemaining ?? 0,
      sourcePowerName: effect.flags.faserip.sourcePowerName || effect.name,
      usesRemaining: effect.flags.faserip.usesRemaining ?? null
    }));
});

const hasAnyEffects = computed(() => {
  return (
    activeEffects.value.length > 0 ||
    activeStatuses.value.length > 0 ||
    temporaryStatModifiers.value.length > 0 ||
    temporaryDamageModifiers.value.length > 0 ||
    dotEffects.value.length > 0 ||
    incomingAttackModifiers.value.length > 0
  );
});

function refreshEffects() {
  effectsUpdateKey.value++;
}

async function removeTemporaryModifier(modifierId: string) {
  if (!canManageEffects.value) return;

  const effect = actor.effects.get(modifierId);
  if (!effect) return;

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove stat modifier from <strong>${effect.flags?.faserip?.sourcePowerName || effect.name || 'Unknown Source'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  // The effect may have already expired (round-tick deletion) while the
  // confirm dialog was open - re-check before deleting to avoid a
  // double-delete "id does not exist" server error.
  if (!actor.effects.get(modifierId)) return;

  await effect.delete();
}

async function removeTemporaryDamageModifier(modifierId: string) {
  if (!canManageEffects.value) return;

  const effect = actor.effects.get(modifierId);
  if (!effect) return;

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove damage modifier from <strong>${effect.flags?.faserip?.sourcePowerName || effect.name || 'Unknown Source'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  if (!actor.effects.get(modifierId)) return;

  await effect.delete();
}

async function removeDotEffect(modifierId: string) {
  // DoT is intentionally curable by anyone (e.g. an ally's healing power),
  // not just the GM or the afflicted actor's owner - see requestDotRemoval.
  const effect = actor.effects.get(modifierId);

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove damage-over-time effect from <strong>${effect?.flags?.faserip?.sourcePowerName || effect?.name || 'Unknown Source'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  await requestDotRemoval(actor, modifierId);
}

async function removeIncomingModifier(modifierId: string) {
  if (!canManageEffects.value) return;

  const effect = actor.effects.get(modifierId);
  if (!effect) return;

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove incoming attack modifier from <strong>${effect.flags?.faserip?.sourcePowerName || effect.name || 'Unknown Source'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  if (!actor.effects.get(modifierId)) return;

  await effect.delete();
}

async function removeStatus(statusId: string) {
  if (!canManageEffects.value) return;

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
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

  // @ts-expect-error - Foundry DialogV2 is not typed in the current version
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove effect <strong>${effect.name || 'Unnamed Effect'}</strong>?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;

  if (!actor.effects.get(effectId)) return;

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