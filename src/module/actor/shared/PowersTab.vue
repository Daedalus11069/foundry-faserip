<script setup lang="ts">
import { inject, computed, ref } from "vue";
import { formatRankDisplay, RANK_ORDER } from "../../enums";
import { FaseripRoll } from "../../rolling/FaseripRoll";
import { stringToRank } from "../../utils";
import { getCharmanService } from "../../charman-service";
import {
  showTalentSelectionDialog,
  showComboDialog
} from "../../applications/dialog-utils";
import type { Power, Form, Talent } from "../../types";

const reactiveActor = inject("reactiveActor") as any;
const actor = inject("actor") as Actor<"pc" | "npc">;

const powers = computed<Power[]>(() => reactiveActor.system.powers || []);
const forms = computed<Form[]>(() => reactiveActor.system.forms || []);
const talents = computed<Talent[]>(() => reactiveActor.system.talents || []);

// Form filter: '' = show all forms, otherwise show only matching
const filterFormId = ref("");

const filteredPowers = computed<Power[]>(() => {
  const all = powers.value;
  if (!filterFormId.value) return all;
  return all.filter(
    p =>
      !p.formIds ||
      p.formIds.length === 0 ||
      p.formIds.includes(filterFormId.value)
  );
});

// Which power has its form-assignment panel open
const expandedFormPanel = ref<string | null>(null);

function toggleFormPanel(powerId: string) {
  expandedFormPanel.value =
    expandedFormPanel.value === powerId ? null : powerId;
}

function isPowerInForm(power: Power, formId: string): boolean {
  return !power.formIds || power.formIds.length === 0
    ? true // universal — shown in all forms
    : power.formIds.includes(formId);
}

function togglePowerForm(power: Power, formId: string) {
  if (!power.formIds) power.formIds = [];
  const idx = power.formIds.indexOf(formId);
  if (idx === -1) {
    power.formIds.push(formId);
  } else {
    power.formIds.splice(idx, 1);
  }
}

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
    value: 6, // Typical rank value
    formIds: []
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

  let totalCS = 0;
  let talentNames: string[] = [];

  if (!power.skipDialogs) {
    // Talent selection
    if (talents.value.length > 0) {
      const selectedTalents = await showTalentSelectionDialog(
        talents.value,
        power.name
      );

      if (selectedTalents === null) {
        return;
      }

      if (selectedTalents.length > 0) {
        talentNames = selectedTalents.map(t => t.name);
        const talentCS = selectedTalents.reduce((sum, t) => sum + t.bonus, 0);
        totalCS += talentCS;
      }
    }
  }

  // Karma/chart shift dialog — shown for all power rolls
  const availableKarma = reactiveActor.system.resources?.karma?.value || 0;

  const comboResult = await showComboDialog(
    power.name,
    rank,
    availableKarma,
    talentNames,
    totalCS
  );

  if (comboResult === null) {
    return;
  }

  if (comboResult.comboCount > 1) {
    await FaseripRoll.rollComboAttack(
      power.name,
      rank,
      value,
      totalCS,
      comboResult.comboCount,
      actor,
      talentNames,
      undefined,
      comboResult.attackKarmaSettings,
      comboResult.manualChartShift ?? 0
    );
  } else {
    const firstAttackKarma = comboResult.attackKarmaSettings[0];
    await FaseripRoll.rollAttribute(
      power.name,
      rank,
      value,
      totalCS,
      actor,
      talentNames,
      undefined,
      firstAttackKarma?.columnShifts ?? 0,
      firstAttackKarma?.resultShift ?? 0,
      false,
      comboResult.manualChartShift ?? 0
    );
  }

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

    <!-- Form filter bar -->
    <div v-if="forms.length > 1" class="flex gap-1 flex-wrap mb-3">
      <button
        @click="filterFormId = ''"
        :class="[
          'fsr-btn fsr-btn-sm text-xs px-3 py-1',
          filterFormId === ''
            ? 'fsr-btn-primary'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        ]"
      >
        All Forms
      </button>
      <button
        v-for="form in forms"
        :key="form.id"
        @click="filterFormId = form.id"
        :class="[
          'fsr-btn fsr-btn-sm text-xs px-3 py-1',
          filterFormId === form.id
            ? 'fsr-btn-primary'
            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
        ]"
      >
        <span v-if="form.isPrimary" class="mr-1 text-yellow-400">★</span
        >{{ form.name }}
      </button>
    </div>

    <div class="fsr-list">
      <div
        v-for="(power, index) in filteredPowers"
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
            @click="removePower(powers.indexOf(power))"
            class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2"
          >
            ✕
          </button>
        </div>

        <!-- Form badges + assign button -->
        <div
          v-if="forms.length > 1"
          class="flex flex-wrap gap-1 mb-2 items-center"
        >
          <span class="text-xs text-gray-500">Forms:</span>
          <span
            v-if="!power.formIds || power.formIds.length === 0"
            class="text-xs bg-gray-700 text-gray-300 rounded px-2 py-0.5"
            >All</span
          >
          <span
            v-else
            v-for="fid in power.formIds"
            :key="fid"
            class="text-xs bg-yellow-900/60 text-yellow-300 rounded px-2 py-0.5"
            >{{ forms.find(f => f.id === fid)?.name ?? fid }}</span
          >
          <button
            @click="toggleFormPanel(power.id)"
            class="fsr-btn fsr-btn-sm text-xs bg-gray-600 hover:bg-gray-500 text-white px-2 py-0.5 ml-auto"
            :title="
              expandedFormPanel === power.id
                ? 'Close form assignment'
                : 'Assign to forms'
            "
          >
            {{ expandedFormPanel === power.id ? "▲ Forms" : "▼ Forms" }}
          </button>
        </div>

        <!-- Form assignment panel -->
        <div
          v-if="forms.length > 1 && expandedFormPanel === power.id"
          class="mb-2 p-2 bg-gray-800 rounded border border-gray-700"
        >
          <p class="text-xs text-gray-400 mb-2">
            Check forms this power applies to. Unchecking all means it applies
            to every form.
          </p>
          <div class="flex flex-col gap-1">
            <label
              v-for="form in forms"
              :key="form.id"
              class="flex items-center gap-2 text-sm cursor-pointer hover:text-white"
            >
              <input
                type="checkbox"
                :checked="!!power.formIds?.includes(form.id)"
                @change="togglePowerForm(power, form.id)"
                class="form-checkbox"
              />
              <span
                :class="form.isPrimary ? 'text-yellow-400' : 'text-gray-300'"
              >
                <span v-if="form.isPrimary" class="mr-1">★</span>{{ form.name }}
              </span>
            </label>
          </div>
        </div>

        <div
          :class="[
            'grid gap-2 mb-2',
            mpEnabled ? 'grid-cols-3' : 'grid-cols-2'
          ]"
        >
          <div>
            <label class="fsr-label">Rank</label>
            <select v-model="power.rank" class="fsr-select text-sm w-40">
              <option v-for="r in RANK_ORDER" :key="r" :value="r">
                {{ formatRankDisplay(r) }}
              </option>
            </select>
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

        <!-- Skip dialogs toggle -->
        <label
          class="flex items-center gap-2 text-xs text-gray-400 cursor-pointer hover:text-gray-200 mb-2"
          :title="'When checked, this power rolls immediately without talent or combo dialogs'"
        >
          <input
            type="checkbox"
            v-model="power.skipDialogs"
            class="form-checkbox"
          />
          Quick roll (skip talent &amp; combo dialogs)
        </label>

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
