<script setup lang="ts">
import { inject, computed, ref } from "vue";
import { formatRankDisplay, RANK_VALUES } from "../../enums";
import { getRankValue, stringToRank } from "../../utils";
import { getCharmanService } from "../../charman-service";
import { applyHitStatDebuff, applyHitDamageBuff } from "../../combat/combat-flow";
import type { ReactiveActorData, PowerData } from "../../types/actor-system";
import type { FaseripActor } from "../../documents";

const reactiveActor = inject("reactiveActor") as ReactiveActorData;
const actor = inject("actor") as FaseripActor;

const powers = computed(() => reactiveActor.system.powers || []);
const forms = computed(() => reactiveActor.system.forms || []);

// Form filter: '' = show all forms, otherwise show only matching
const filterFormId = ref("");

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

const attributeChoices = [
  { value: "fighting", label: "Fighting" },
  { value: "agility", label: "Agility" },
  { value: "strength", label: "Strength" },
  { value: "endurance", label: "Endurance" },
  { value: "reasoning", label: "Reasoning" },
  { value: "intuition", label: "Intuition" },
  { value: "psyche", label: "Psyche" }
];

function ensureStatDebuff(power: PowerData) {
  if (!power.statDebuff) {
    power.statDebuff = {
      enabled: false,
      attribute: "intuition",
      greenShift: 0,
      yellowShift: 0,
      redShift: 0,
      durationFormula: "1d3"
    };
  }

  return power.statDebuff;
}

function ensureDamageBuff(power: PowerData) {
  if (!power.damageBuff) {
    power.damageBuff = {
      enabled: false,
      greenShift: 0,
      yellowShift: 0,
      redShift: 0,
      durationFormula: "1d3"
    };
  }

  return power.damageBuff;
}

const filteredPowers = computed(() => {
  const all = powers.value.map(power => {
    // Ensure powers without armor piercing have it set to null for consistency
    if (!power.armorPiercing) {
      power.armorPiercing = null;
    }
    ensureStatDebuff(power);
    return power;
  });
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

function togglePowerForm(power: PowerData, formId: string) {
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

// Check if degrading armor is enabled
const degradingEnabled = computed(
  () => game.settings.get("faserip", "degradingArmor") ?? false
);

function addPower() {
  if (!reactiveActor.system.powers) {
    reactiveActor.system.powers = [];
  }

  const newPower: PowerData = {
    id: crypto.randomUUID(),
    name: "New Power",
    rank: "typical",
    category: "general",
    value: 6, // Typical rank value
    maxValue: 6, // Initialize maxValue
    formIds: [],
    effectType: "none",
    attackType: "none",
    targetType: "any",
    damageType: "none",
    resistanceType: undefined,
    vulnerabilityType: undefined,
    armorPiercing: null,
    statDebuff: {
      enabled: false,
      attribute: "intuition",
      greenShift: 0,
      yellowShift: 0,
      redShift: 0,
      durationFormula: "1d3"
    }
  };
  reactiveActor.system.powers.push(newPower);
}

async function removePower(index: number) {
  // @ts-expect-error - DialogV2 path not fully typed
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Delete <strong>${reactiveActor.system.powers[index].name}</strong>? This cannot be undone.</p>`,
    modal: true
  });

  if (!confirmed) return;
  reactiveActor.system.powers.splice(index, 1);
}

function isBodyArmor(power: PowerData): boolean {
  return power.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor";
}

async function repairPower(power: PowerData) {
  const maxValue = power.maxValue || power.value;
  const currentDamage = maxValue - power.value;

  if (currentDamage <= 0) return;

  // @ts-expect-error - DialogV2 path not fully typed
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Repair ${power.name}` },
    content: `
      <form>
        <div class="form-group">
          <label>Repair Amount (Current: ${power.value}/${maxValue}, Damage: ${currentDamage})</label>
          <input type="number" name="amount" value="${currentDamage}" min="1" max="${currentDamage}" autofocus />
        </div>
      </form>
    `,
    modal: true,
    rejectClose: false,
    ok: {
      label: "Repair",
      callback: (_event: any, button: any, _dialog: any) => {
        const form = button.form;
        return new FormDataExtended(form).object;
      }
    }
  });

  if (result && result.amount) {
    const repairAmount = Math.min(
      Math.max(1, Number(result.amount)),
      currentDamage
    );
    power.value = Math.min(maxValue, power.value + repairAmount);

    // Sync Body Armor power repair with Charman if character is linked and this is Body Armor
    if (isBodyArmor(power)) {
      // @ts-expect-error - charman property exists on system
      const charmanData = actor.system.charman;
      if (charmanData?.username && charmanData?.characterName) {
        try {
          const service = getCharmanService();
          await service.updateBodyArmorPower(
            charmanData.username,
            charmanData.characterName,
            power.value
          );
        } catch (error) {
          // Service not initialized or sync failed - ignore silently
          console.warn("Could not sync Body Armor repair to Charman:", error);
        }
      }
    }
  }
}

function onPowerRankChange(power: PowerData, rank: string) {
  power.rank = rank;
  const newValue = getRankValue(rank);
  power.value = newValue;
  power.maxValue = newValue;
}

const expandedItems = ref<string | null>(null);
function toggleItem(id: string) {
  expandedItems.value = expandedItems.value === id ? null : id;
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
        v-for="power in filteredPowers"
        :key="power.id"
        class="fsr-list-item"
      >
        <!-- Accordion header: always visible -->
        <div
          class="flex items-center gap-2 cursor-pointer select-none flex-wrap"
          @click="toggleItem(power.id)"
        >
          <span class="text-gray-400 text-xs w-4 shrink-0">{{ expandedItems === power.id ? '▼' : '▶' }}</span>
          <span class="font-semibold text-white flex-1 truncate">{{ power.name || '(unnamed)' }}</span>
          <template v-if="forms.length > 1 && power.formIds && power.formIds.length > 0">
            <span
              v-for="fid in power.formIds"
              :key="fid"
              class="text-xs bg-yellow-900/60 text-yellow-300 rounded px-1.5 py-0.5 shrink-0"
            >{{forms.find(f => f.id === fid)?.name ?? fid}}</span>
          </template>
          <span class="fsr-rank-badge shrink-0">{{ formatRankDisplay(power.rank) }}</span>
          <span v-if="power.category" class="text-xs text-gray-400 shrink-0">{{ power.category }}</span>
          <span v-if="power.effectType && power.effectType !== 'none'" class="text-xs px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-300 shrink-0">
            {{ power.effectType === 'damage' ? 'Damage' : power.effectType === 'heal-health' ? 'Heal HP' : 'Heal Armor' }}
          </span>
          <span v-if="power.attackType && power.attackType !== 'none'" class="text-xs px-2 py-0.5 rounded bg-orange-900/60 text-orange-300 shrink-0">
            vs {{ power.attackType === 'melee' ? 'Fighting' : power.attackType === 'ranged' ? 'Agility' : 'Psyche' }}
          </span>
          <span v-if="power.armorPiercing" class="text-xs px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 shrink-0">AP</span>
          <span v-if="degradingEnabled && isBodyArmor(power)" class="text-xs shrink-0"
            :class="power.value < (power.maxValue || power.value) ? 'text-yellow-400' : 'text-blue-300'">
            {{ power.value }}/{{ power.maxValue || power.value }} armor
          </span>
          <button
            @click.stop="removePower(powers.indexOf(power))"
            class="fsr-btn fsr-btn-sm bg-red-900 hover:bg-red-950 text-white px-2 shrink-0"
          >✕</button>
        </div>

        <!-- Accordion body: expanded form -->
        <div v-if="expandedItems === power.id" class="mt-3 pt-3 border-t border-gray-700">
          <div class="fsr-list-item-header mb-2">
            <input
              v-model="power.name"
              type="text"
              class="fsr-input flex-1 mr-2"
              placeholder="Power Name"
            />
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
              >{{forms.find(f => f.id === fid)?.name ?? fid}}</span
            >
            <button
              @click="toggleFormPanel(power.id)"
              class="fsr-btn fsr-btn-sm text-xs bg-gray-600 hover:bg-gray-500 text-white px-2 py-0.5 ml-auto"
              :title="expandedFormPanel === power.id
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
              <select
                :value="power.rank"
                @change="(e: any) => onPowerRankChange(power, e.target.value)"
                class="fsr-select text-sm w-40"
              >
                <option
                  v-for="(label, value) in rankChoicesWithValues"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
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

          <!-- Effect Type and Attack Type -->
          <div class="grid grid-cols-2 gap-2 mb-2">
            <div>
              <label class="fsr-label">Effect Type</label>
              <select v-model="power.effectType" class="fsr-select text-sm">
                <option value="none">None</option>
                <option value="damage">Deals Damage</option>
                <option value="heal-health">Heals Health</option>
                <option value="heal-armor">Heals Body Armor</option>
              </select>
            </div>
            <div>
              <label class="fsr-label"
                >Requires Defense Roll
                <span class="fsr-help-text">(contested)</span></label
              >
              <select v-model="power.attackType" class="fsr-select text-sm">
                <option value="none">No / Automatic</option>
                <option value="melee">vs Fighting</option>
                <option value="ranged">vs Agility</option>
                <option value="psyche">vs Psyche</option>
              </select>
            </div>
          </div>

          <!-- Target Type -->
          <div class="mb-2">
            <label class="fsr-label">Targets</label>
            <select v-model="power.targetType" class="fsr-select text-sm">
              <option value="any">Self or Others</option>
              <option value="others">Others Only</option>
              <option value="self">Self Only</option>
            </select>
          </div>

          <div
            class="mb-2 p-2 bg-indigo-950/30 border border-indigo-800 rounded"
          >
            <label class="flex items-center gap-2 cursor-pointer mb-2">
              <input
                v-model="ensureStatDebuff(power).enabled"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-indigo-500 focus:ring-2 focus:ring-indigo-500"
              />
              <span class="fsr-label mb-0">Temporary Stat (De)buff</span>
            </label>

            <div v-if="ensureStatDebuff(power).enabled" class="space-y-2">
              <div>
                <label class="fsr-label">Target Attribute</label>
                <select
                  v-model="ensureStatDebuff(power).attribute"
                  class="fsr-select text-sm"
                >
                  <option
                    v-for="option in attributeChoices"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </div>

              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="fsr-label">Half Success</label>
                  <input
                    v-model.number="ensureStatDebuff(power).greenShift"
                    type="number"
                    class="fsr-input"
                    placeholder="-1"
                  />
                </div>
                <div>
                  <label class="fsr-label">Yellow</label>
                  <input
                    v-model.number="ensureStatDebuff(power).yellowShift"
                    type="number"
                    class="fsr-input"
                    placeholder="-2"
                  />
                </div>
                <div>
                  <label class="fsr-label">Red</label>
                  <input
                    v-model.number="ensureStatDebuff(power).redShift"
                    type="number"
                    class="fsr-input"
                    placeholder="-3"
                  />
                </div>
              </div>

              <div class="text-xs text-gray-400">
                Positive values apply a buff. Negative values apply a debuff.
              </div>

              <div>
                <label class="fsr-label">Duration Formula</label>
                <input
                  v-model="ensureStatDebuff(power).durationFormula"
                  type="text"
                  class="fsr-input"
                  placeholder="1d3"
                />
                <div class="text-xs text-gray-400 mt-1">
                  Rolled when the effect lands, in rounds.
                </div>
              </div>
            </div>
          </div>

          <div
            class="mb-2 p-2 bg-purple-950/30 border border-purple-800 rounded"
          >
            <label class="flex items-center gap-2 cursor-pointer mb-2">
              <input
                v-model="ensureDamageBuff(power).enabled"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-2 focus:ring-purple-500"
              />
              <span class="fsr-label mb-0">Temporary Damage (De)buff</span>
            </label>

            <div v-if="ensureDamageBuff(power).enabled" class="space-y-2">
              <div class="grid grid-cols-3 gap-2">
                <div>
                  <label class="fsr-label">Half Success</label>
                  <input
                    v-model.number="ensureDamageBuff(power).greenShift"
                    type="number"
                    class="fsr-input"
                    placeholder="-1"
                  />
                </div>
                <div>
                  <label class="fsr-label">Yellow</label>
                  <input
                    v-model.number="ensureDamageBuff(power).yellowShift"
                    type="number"
                    class="fsr-input"
                    placeholder="-2"
                  />
                </div>
                <div>
                  <label class="fsr-label">Red</label>
                  <input
                    v-model.number="ensureDamageBuff(power).redShift"
                    type="number"
                    class="fsr-input"
                    placeholder="-3"
                  />
                </div>
              </div>

              <div class="text-xs text-gray-400">
                Affects target's damage output. Positive values buff damage, negative values debuff damage.
              </div>

              <div>
                <label class="fsr-label">Duration Formula</label>
                <input
                  v-model="ensureDamageBuff(power).durationFormula"
                  type="text"
                  class="fsr-input"
                  placeholder="1d3"
                />
                <div class="text-xs text-gray-400 mt-1">
                  Rolled when the effect lands, in rounds.
                </div>
              </div>
            </div>
          </div>

          <!-- Multi-Hit checkbox (for AoE/multi-target attacks) -->
          <div
            v-if="power.attackType && power.attackType !== 'none'"
            class="mb-2"
          >
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                v-model="power.multiHit"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-2 focus:ring-blue-500"
              />
              <span class="fsr-label mb-0"
                >Multi-Hit (AoE)
                <span class="fsr-help-text"
                  >(one roll for all targets, no combo penalty)</span
                ></span
              >
            </label>
          </div>

          <!-- Damage Type, Armor Piercing, Resistance Type, and Vulnerability Type -->
          <div class="grid grid-cols-2 gap-2 mb-2">
            <div v-if="power.effectType === 'damage'">
              <label class="fsr-label">Damage Type</label>
              <select v-model="power.damageType" class="fsr-select text-sm">
                <option value="none">Normal/Physical</option>
                <option value="fire">Fire</option>
                <option value="cold">Cold</option>
                <option value="electricity">Electricity</option>
                <option value="energy">Energy</option>
                <option value="radiation">Radiation</option>
                <option value="sonic">Sonic</option>
                <option value="acid">Acid</option>
                <option value="poison">Poison</option>
                <option value="mental">Mental/Psychic</option>
                <option value="magic">Magic</option>
                <option value="force">Force</option>
              </select>
            </div>
            <div v-if="power.effectType === 'damage'">
              <label class="fsr-label">Armor Piercing</label>
              <select v-model="power.armorPiercing" class="fsr-select text-sm">
                <option :value="null">None</option>
                <option
                  v-for="(label, value) in rankChoicesWithValues"
                  :key="value"
                  :value="value"
                >
                  {{ label }}
                </option>
              </select>
            </div>
            <div v-if="power.effectType === 'none'">
              <label class="fsr-label">Resistance Type</label>
              <select v-model="power.resistanceType" class="fsr-select text-sm">
                <option :value="undefined">Not a Resistance</option>
                <option value="fire">Fire Resistance</option>
                <option value="cold">Cold Resistance</option>
                <option value="electricity">Electricity Resistance</option>
                <option value="energy">Energy Resistance</option>
                <option value="radiation">Radiation Resistance</option>
                <option value="sonic">Sonic Resistance</option>
                <option value="acid">Acid Resistance</option>
                <option value="poison">Poison Resistance</option>
                <option value="mental">Mental Resistance</option>
                <option value="magic">Magic Resistance</option>
                <option value="force">Force Resistance</option>
              </select>
            </div>
            <div v-if="power.effectType === 'none'">
              <label class="fsr-label">Vulnerability Type</label>
              <select
                v-model="power.vulnerabilityType"
                class="fsr-select text-sm"
              >
                <option :value="undefined">Not a Vulnerability</option>
                <option value="fire">Fire Vulnerability</option>
                <option value="cold">Cold Vulnerability</option>
                <option value="electricity">Electricity Vulnerability</option>
                <option value="energy">Energy Vulnerability</option>
                <option value="radiation">Radiation Vulnerability</option>
                <option value="sonic">Sonic Vulnerability</option>
                <option value="acid">Acid Vulnerability</option>
                <option value="poison">Poison Vulnerability</option>
                <option value="mental">Mental Vulnerability</option>
                <option value="magic">Magic Vulnerability</option>
                <option value="force">Force Vulnerability</option>
              </select>
            </div>
          </div>

          <!-- Body Armor value display and repair (when degrading armor is enabled) -->
          <div
            v-if="degradingEnabled && isBodyArmor(power)"
            class="mb-2 p-2 bg-blue-900/20 border border-blue-700 rounded"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-sm text-gray-300">Armor Protection:</span>
                <span class="text-lg font-bold text-blue-300"
                  >{{ power.value }}/{{ power.maxValue || power.value }}</span
                >
              </div>
              <button
                v-if="power.value < (power.maxValue || power.value)"
                @click="repairPower(power)"
                class="text-blue-400 hover:text-blue-300 text-sm"
                :title="'Repair to full'"
              >
                🔧 Repair
              </button>
              <span
                v-else
                class="text-green-400 text-sm"
                :title="'Body Armor at full strength'"
              >
                ✓ Full
              </span>
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

          <div class="mb-2">
            <label class="fsr-label">Description:</label>
            <textarea
              v-model="power.description"
              class="fsr-textarea w-full p-2"
              rows="2"
              placeholder="Power description or notes..."
            ></textarea>
          </div>
        </div>
      </div>

      <div v-if="powers.length === 0" class="text-center text-gray-400 py-8">
        No powers yet. Click "Add Power" to create one.
      </div>
    </div>
  </div>
</template>
