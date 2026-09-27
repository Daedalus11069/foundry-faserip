<template>
  <div class="fsr-sheet">
    <!-- Header -->
    <div class="fsr-header">
      <div class="flex items-center gap-4">
        <!-- Avatar -->
        <div class="cursor-pointer" @click="openImagePicker">
          <img
            :src="reactiveItem.img || 'icons/svg/chest.svg'"
            :alt="reactiveItem.name"
            class="fsr-avatar"
          />
        </div>

        <!-- Name and Type -->
        <div class="flex-1">
          <input
            v-model="reactiveItem.name"
            type="text"
            class="fsr-title bg-transparent border-b-2 border-red-500 focus:border-red-300 outline-none w-full"
            placeholder="Equipment Name"
          />
          <div class="text-sm text-red-300 mt-1 font-semibold">🎒 Equipment</div>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="fsr-content p-6 space-y-4">
      <!-- Quantity -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Quantity</label>
        <input
          v-model.number="reactiveItem.system.quantity"
          type="number"
          min="0"
          class="fsr-input"
        />
      </div>

      <!-- Node Hacker integration -->
      <div class="fsr-form-group border border-cyan-800 rounded p-4 bg-cyan-950/20 space-y-3">
        <div class="flex items-center justify-between">
          <span class="fsr-form-label mb-0">
            Node Hacker Lock
            <i
              class="fas fa-terminal text-xs text-cyan-400 ml-1"
              :title="'Requires the Node Hacker module'"
            ></i>
          </span>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="reactiveItem.system.hack.enabled"
              type="checkbox"
              class="w-4 h-4 rounded border-gray-600 text-cyan-500 focus:ring-2 focus:ring-cyan-500"
            />
            <span class="fsr-form-label mb-0">Enabled</span>
          </label>
        </div>

        <div v-if="!nodeHackerActive" class="text-xs text-yellow-400">
          ⚠️ The Node Hacker module is not active in this world.
        </div>

        <template v-if="reactiveItem.system.hack.enabled">
          <div>
            <label class="fsr-form-label">
              Check Attribute
              <i
                class="fas fa-circle-info text-xs text-cyan-400 ml-1"
                :title="'FASERIP resolves each node capture attempt with a normal attribute roll against the Universal Table; the node\'s difficulty chart-shifts the check.'"
              ></i>
            </label>
            <select v-model="reactiveItem.system.hack.attribute" class="fsr-select">
              <option v-for="option in attributeChoices" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <div>
            <label class="fsr-form-label">
              Difficulty
              <i
                class="fas fa-circle-info text-xs text-cyan-400 ml-1"
                :title="'Chart-shifts the check toward this rank\'s column on the Universal Table. Passing only ever requires a Green result (or better) on that column, never Yellow/Red - a harder difficulty just moves where Green starts.'"
              ></i>
            </label>
            <select v-model="reactiveItem.system.hack.difficultyRank" class="fsr-select">
              <option value="">Actor's Own Rank</option>
              <option v-for="[key, label] in rankChoicesWithValues" :key="key" :value="key">
                {{ label }}
              </option>
            </select>
          </div>

          <div>
            <label class="fsr-form-label">
              Node Graph
              <i
                class="fas fa-circle-info text-xs text-cyan-400 ml-1"
                :title="'Optional: pick a graph built in Node Hacker\'s Node Designer. Leave blank to roll the opening hack check first and generate a network sized off its result - a bare pass generates a larger, harder network, an exceptional roll a small one.'"
              ></i>
            </label>
            <select v-model="reactiveItem.system.hack.graphName" class="fsr-select">
              <option value="">(generate from opening roll)</option>
              <option v-for="name in nodeGraphNames" :key="name" :value="name">{{ name }}</option>
            </select>
          </div>

          <label class="flex items-center gap-2 cursor-pointer my-2">
            <input
              v-model="reactiveItem.system.locked"
              type="checkbox"
              class="w-4 h-4 rounded border-gray-600 text-cyan-500 focus:ring-2 focus:ring-cyan-500"
            />
            <span class="fsr-form-label mb-0">Currently Locked</span>
          </label>

          <button
            v-if="isOwned"
            @click="attemptHack"
            :disabled="!nodeHackerActive || !reactiveItem.system.locked || hackInProgress"
            class="w-full px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-semibold"
          >
            {{ hackInProgress ? "Hacking…" : "Attempt Hack" }}
          </button>
          <div v-else class="text-xs text-gray-400">
            Owning actor required to attempt this hack from the sheet.
          </div>
        </template>
      </div>

      <!-- Description -->
      <div class="fsr-form-group">
        <label class="fsr-form-label">Description</label>
        <textarea
          v-model="reactiveItem.system.description"
          rows="8"
          class="fsr-input resize-y"
          placeholder="Enter equipment description..."
        ></textarea>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject, computed, onMounted, ref } from "vue";
import { Rank, RANK_ORDER, RANK_VALUES } from "../../enums";
import { stringToRank } from "../../utils";
import {
  isNodeHackerActive,
  attemptFaseripNodeHack,
  listNodeHackerGraphNames
} from "../../integrations/node-hacker-hacking";
import { requestNodeHackMode } from "../../socket/faserip-socket";
import { showTalentSelectionDialog } from "../../applications/dialog-utils";
import type { Talent } from "../../types";

const reactiveItem = inject("reactiveItem") as any;
const item = inject("item") as Item;

const nodeGraphNames = ref<string[]>([]);
onMounted(async () => {
  nodeGraphNames.value = await listNodeHackerGraphNames();
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

const isOwned = computed(() => {
  return item.parent !== null && item.parent !== undefined;
});

const nodeHackerActive = computed(() => isNodeHackerActive());

const hackInProgress = ref(false);

const rankChoices = computed(() => {
  // @ts-expect-error - CONFIG.FASERIP added by system
  return CONFIG.FASERIP?.ranks || {};
});

const rankChoicesWithValues = computed(() => {
  const choices: Array<[string, string]> = [];
  Object.entries(rankChoices.value).forEach(([key, label]) => {
    const rank = stringToRank(key);
    const value = RANK_VALUES[rank];
    choices.push([key, `${label} (${value})`]);
  });
  return choices;
});

if (!reactiveItem.system.hack) {
  reactiveItem.system.hack = {
    enabled: false,
    attribute: "reasoning",
    difficultyRank: "",
    graphName: ""
  };
}

function openImagePicker() {
  // @ts-expect-error - FilePicker.implementation exists
  const fp = new foundry.applications.apps.FilePicker.implementation({
    type: "image",
    current: item.img,
    callback: async (path: string) => {
      reactiveItem.img = path;
      await item.update({ img: path });
    }
  });
  fp.browse();
}

async function attemptHack() {
  const actor = item.parent;
  if (!actor) return;

  const actorRank: Rank = reactiveItem.system.hack.attribute
    ? (actor.getCurrentForm?.()?.attributes?.[reactiveItem.system.hack.attribute]?.rank ?? Rank.Typical)
    : Rank.Typical;

  // Chart-shifts the check toward the configured difficulty rank's column
  // on the Universal Table. Passing still only ever requires a Green result
  // (or better) - a harder difficulty just moves where that Green zone
  // starts, it never demands Yellow/Red.
  const difficultyRank = reactiveItem.system.hack.difficultyRank;
  let chartShift = difficultyRank
    ? RANK_ORDER.indexOf(difficultyRank as Rank) - RANK_ORDER.indexOf(actorRank)
    : 0;

  // Let the player apply any relevant talents to the initial roll, the same
  // way a normal FASERIP attribute check does. The chosen talents (and
  // their combined chart shift) carry through to every subsequent per-node
  // roll too, via the check context attemptFaseripNodeHack registers for
  // this actor - they're only picked once, not re-prompted per node.
  const talents: Talent[] = (actor as any).system?.talents ?? [];
  let talentNames: string[] | undefined;
  if (talents.length > 0) {
    const attributeLabel =
      attributeChoices.find(a => a.value === reactiveItem.system.hack.attribute)
        ?.label ?? "Hacking";
    const selectedTalents = await showTalentSelectionDialog(
      talents,
      attributeLabel
    );
    if (selectedTalents === null) return; // Cancelled

    if (selectedTalents.length > 0) {
      talentNames = selectedTalents.map(t => t.name);
      chartShift += selectedTalents.reduce((sum, t) => sum + t.bonus, 0);
    }
  }

  hackInProgress.value = true;
  try {
    const graphName = reactiveItem.system.hack.graphName?.trim() || undefined;
    // A lock has no defending actor, so Managed is never on the table here - the GM still
    // picks which of the two passive trace flavors runs (see requestNodeHackMode).
    const mode = await requestNodeHackMode({
      attackerName: actor.name ?? "Hacker",
      targetName: item.name,
      canManage: false
    });
    const traceUnit = mode === "auto-time" ? "time" : "points";

    await attemptFaseripNodeHack({
      actor,
      attributeName: `${item.name} Hack Attempt`,
      attributeRank: actorRank,
      chartShift,
      talentNames,
      label: item.name,
      graphName,
      traceUnit,
      onSuccess: async () => {
        reactiveItem.system.locked = false;
        // @ts-expect-error - system.locked is a boolean, but TS thinks it's a string
        await item.update({ "system.locked": false });
      },
      onFailure: () => { }
    });
  } finally {
    hackInProgress.value = false;
  }
}
</script>
