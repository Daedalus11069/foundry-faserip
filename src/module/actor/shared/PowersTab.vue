<script setup lang="ts">
import { getCharmanItemError } from "../../charman-errors";
import { inject, computed, ref } from "vue";
import { formatRankDisplay, RANK_VALUES, DamageType } from "../../enums";

const DAMAGE_TYPE_LABELS: Record<string, string> = {
  [DamageType.None]: "Normal/Physical (legacy)",
  [DamageType.Physical]: "Physical",
  [DamageType.Fire]: "Fire",
  [DamageType.Cold]: "Cold",
  [DamageType.Electricity]: "Electricity",
  [DamageType.Energy]: "Energy",
  [DamageType.Radiation]: "Radiation",
  [DamageType.Sonic]: "Sonic",
  [DamageType.Acid]: "Acid",
  [DamageType.Poison]: "Poison",
  [DamageType.Mental]: "Mental/Psionic",
  [DamageType.Magic]: "Magic",
  [DamageType.Force]: "Force"
};
const DAMAGE_TYPE_OPTIONS = Object.values(DamageType).filter(
  t => t !== DamageType.None
);

function toggleDamageType(power: any, type: string, checked: boolean) {
  const current: string[] = Array.isArray(power.damageTypes)
    ? [...power.damageTypes]
    : [];
  if (checked) {
    if (!current.includes(type)) current.push(type);
  } else {
    const idx = current.indexOf(type);
    if (idx !== -1) current.splice(idx, 1);
  }
  power.damageTypes = current;
}
import { getRankValue, stringToRank } from "../../utils";
import { getCharmanService } from "../../charman-service";
import { isPowerAuraActive } from "../../utils/power-aura";
import { activateBlendIn, deactivateBlendIn, getBlendInFlag, getBlendBaseRange } from "../../utils/blend-in";
import { useActorField } from "./use-actor-field";
import type {
  ReactiveActorData,
  PowerData,
  WeaponAreaOfEffectData
} from "../../types/actor-system";
import type { FaseripActor } from "../../documents";

const reactiveActor = inject("reactiveActor") as ReactiveActorData;
const actor = inject("actor") as FaseripActor;
const { setField } = useActorField(() => reactiveActor);

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

function newStatDebuff() {
  return {
    enabled: true,
    attribute: "intuition" as const,
    greenShift: 0,
    yellowShift: 0,
    redShift: 0,
    durationFormula: "1d3"
  };
}

function newDamageBuff() {
  return {
    enabled: true,
    greenShift: 0,
    yellowShift: 0,
    redShift: 0,
    durationFormula: "1d3"
  };
}

function newDot() {
  return {
    enabled: true,
    rank: "",
    armorPiercing: "",
    durationFormula: "1d3"
  };
}

function newStatusEffect() {
  return {
    enabled: true,
    statusId: "",
    durationFormula: "1d3"
  };
}

// Mirrors Foundry's own registered status conditions (sleep, stun, prone,
// etc.) instead of a hand-maintained list, so any core/module-added status
// shows up here automatically.
const statusEffectChoices = computed(() => {
  return ((CONFIG.statusEffects as any[]) || [])
    .map(s => ({
      value: s.id,
      // @ts-expect-error - Foundry game.i18n global
      label: typeof s.name === "string" ? game.i18n.localize(s.name) : s.id
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

function ensureStatDebuffs(power: PowerData) {
  if (!power.statDebuffs) {
    power.statDebuffs = [];
  }

  return power.statDebuffs;
}

function ensureDamageBuffs(power: PowerData) {
  if (!power.damageBuffs) {
    power.damageBuffs = [];
  }

  return power.damageBuffs;
}

function ensureDots(power: PowerData) {
  if (!power.dots) {
    power.dots = [];
  }

  return power.dots;
}

function ensureStatusEffects(power: PowerData) {
  if (!power.statusEffects) {
    power.statusEffects = [];
  }

  return power.statusEffects;
}

const filteredPowers = computed(() => {
  const all = powers.value.map(power => {
    // Ensure powers without armor piercing have it set to null for consistency
    if (!power.armorPiercing) {
      power.armorPiercing = null;
    }
    if (power.leechPercent === undefined) {
      power.leechPercent = 0;
    }
    if (power.lifeLinkPercent === undefined) {
      power.lifeLinkPercent = 0;
    }
    if (!power.lifeLinkDirection) {
      power.lifeLinkDirection = "protect";
    }
    ensureStatDebuffs(power);
    ensureDamageBuffs(power);
    ensureDots(power);
    ensureStatusEffects(power);
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
    setField("system.powers", []);
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
    leechPercent: 0,
    statDebuffs: [],
    damageBuffs: [],
    dots: [],
    statusEffects: [],
    isAura: false,
    auraDisposition: "any",
    auraIncludeSelf: false,
    auraRange: 0,
    massEffect: {
      enabled: false,
      scope: "area",
      baseRangeFeet: 20,
      falloffFeet: 20,
      includeSelf: false,
      resistAttribute: "",
      resistResult: "green"
    },
    areaOfEffect: {
      enabled: false,
      shape: "circle",
      size: 10,
      width: 5,
      angle: 53,
      color: "#ff0000",
      durationRounds: "",
      remotePlaced: false,
      maxRangeFeet: 0
    },
    grantsArmor: false,
    armorTypes: [],
    armorLayer: 1,
    armorToggle: false,
    armorActive: false,
    armorBlocksAttacks: false,
    blendIn: false,
    blendInDurationFormula: "",
    autoHealEachRound: false,
    isLifeLink: false,
    lifeLinkPercent: 0,
    lifeLinkDirection: "protect"
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

async function removePowerEntry(list: unknown[], idx: number, label: string) {
  // @ts-expect-error - DialogV2 path not fully typed
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove this ${label}?</p>`,
    rejectClose: false,
    modal: true
  });

  if (!confirmed) return;
  list.splice(idx, 1);
}

const ARMOR_DAMAGE_TYPES = [
  { key: "physical", label: "Physical / Ballistic" },
  { key: "energy", label: "Energy" },
  { key: "fire", label: "Fire" },
  { key: "cold", label: "Cold" },
  { key: "electricity", label: "Electricity" },
  { key: "radiation", label: "Radiation" },
  { key: "sonic", label: "Sonic" },
  { key: "acid", label: "Acid" },
  { key: "poison", label: "Poison" },
  { key: "force", label: "Force" },
  { key: "magic", label: "Magic" },
  { key: "mental", label: "Mental" }
];

function setMassEffect(power: PowerData, patch: Record<string, unknown>) {
  power.massEffect = {
    enabled: false,
    scope: "area",
    baseRangeFeet: 20,
    falloffFeet: 20,
    includeSelf: false,
    resistAttribute: "",
    resistResult: "green",
    ...(power.massEffect ?? {}),
    ...patch
  } as PowerData["massEffect"];
}

function ensureAreaOfEffect(power: PowerData): WeaponAreaOfEffectData {
  if (!power.areaOfEffect) {
    power.areaOfEffect = {
      enabled: false,
      shape: "circle",
      size: 10,
      width: 5,
      angle: 53,
      color: "#ff0000",
      durationRounds: "",
      remotePlaced: false,
      maxRangeFeet: 0
    };
  }
  return power.areaOfEffect;
}

function toggleArmorType(power: PowerData, type: string) {
  const current = [...(power.armorTypes ?? [])];
  const idx = current.indexOf(type);
  if (idx === -1) current.push(type);
  else current.splice(idx, 1);
  power.armorTypes = current;
}

function getOwnerToken(): TokenDocument | null {
  const tokens = actor.getActiveTokens(true);
  return (tokens[0]?.document as unknown as TokenDocument) || null;
}

function isBlendInActive(power: PowerData): boolean {
  const tokenDoc = getOwnerToken();
  if (!tokenDoc) return false;
  const flag = getBlendInFlag(tokenDoc);
  return Boolean(flag?.active && flag.sourceItemId === power.id);
}

function blendInStatusLabel(power: PowerData): string {
  const tokenDoc = getOwnerToken();
  const flag = tokenDoc ? getBlendInFlag(tokenDoc) : null;
  if (!flag?.active || flag.sourceItemId !== power.id) {
    return `Blend In (${getBlendBaseRange(power.rank)} ft)`;
  }
  const duration = flag.indefinite ? "" : ` - ${flag.roundsRemaining} rd${flag.roundsRemaining === 1 ? "" : "s"} left`;
  return `Blending In (${flag.rangeFt} ft${duration})`;
}

async function toggleBlendIn(power: PowerData) {
  const tokenDoc = getOwnerToken();
  if (!tokenDoc) {
    ui.notifications?.warn("This actor has no token on the active scene.");
    return;
  }

  if (isBlendInActive(power)) {
    await deactivateBlendIn(tokenDoc);
  } else {
    await activateBlendIn(tokenDoc, actor, power);
  }
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
          :class="{ 'fsr-accordion-error': getCharmanItemError('powers', power.name) }"
          :title="getCharmanItemError('powers', power.name) || undefined"
          @click="toggleItem(power.id)"
        >
          <span v-if="getCharmanItemError('powers', power.name)" class="text-red-400 shrink-0">⚠</span>
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
            vs {{ power.attackType === 'melee' ? 'Fighting' : power.attackType === 'ranged' ? 'Agility' : power.attackType === 'strength' ? 'Strength' : 'Psyche' }}
          </span>
          <span v-if="power.armorPiercing" class="text-xs px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 shrink-0">AP</span>
          <span v-if="power.leechPercent" class="text-xs px-2 py-0.5 rounded bg-red-900/60 text-red-300 shrink-0">Leech {{ power.leechPercent }}%</span>
          <span v-if="power.isLifeLink" class="text-xs px-2 py-0.5 rounded bg-pink-900/60 text-pink-300 shrink-0">Life-Link {{ power.lifeLinkPercent }}% ({{ power.lifeLinkDirection }})</span>
          <span v-if="power.isAura" class="text-xs px-2 py-0.5 rounded shrink-0" :class="isPowerAuraActive(actor, power) ? 'bg-purple-600 text-white' : 'bg-purple-900/60 text-purple-300'">
            {{ isPowerAuraActive(actor, power) ? 'Aura Active' : 'Aura' }}
          </span>
          <button
            v-if="power.grantsArmor && power.armorToggle"
            @click.stop="power.armorActive = !power.armorActive"
            class="text-xs px-2 py-0.5 rounded shrink-0"
            :class="power.armorActive ? 'bg-yellow-500 text-black' : 'bg-yellow-900/60 text-yellow-300'"
            :title="power.armorActive ? 'Armor layer on - click to turn it off' : 'Click to turn this armor layer on'"
          >
            {{ power.armorActive ? 'Armor On' : 'Armor Off' }}
          </button>
          <span
            v-else-if="power.grantsArmor"
            class="text-xs px-2 py-0.5 rounded bg-yellow-900/60 text-yellow-300 shrink-0"
          >Armor Layer {{ power.armorLayer ?? 1 }}</span>
          <button
            v-if="power.blendIn"
            @click.stop="toggleBlendIn(power)"
            class="text-xs px-2 py-0.5 rounded shrink-0"
            :class="isBlendInActive(power) ? 'bg-teal-600 text-white' : 'bg-teal-900/60 text-teal-300'"
          >
            {{ blendInStatusLabel(power) }}
          </button>
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
                <option value="strength">vs Strength</option>
              </select>
            </div>
          </div>

          <!-- Auto-heal each round -->
          <div v-if="power.effectType === 'heal-health'" class="mb-2">
            <label class="flex items-center gap-2 cursor-pointer mb-0">
              <input
                v-model="power.autoHealEachRound"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-green-500 focus:ring-2 focus:ring-green-500"
              />
              <span class="fsr-label mb-0"
                >Auto-heal each round <span class="fsr-help-text">(automatically heals the owner for this power's Rank value at the start of every combat round, with no roll needed)</span></span
              >
            </label>
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

          <!-- Feature toggles: collapsed ones share a row, enabled ones expand full width -->
          <div class="flex flex-wrap items-start gap-2 mb-2">
          <!-- Aura -->
          <div
            class="px-2 py-1.5 bg-purple-950/30 border border-purple-800 rounded space-y-2"
            :class="{ 'w-full': power.isAura }"
          >
            <label class="flex items-center gap-2 cursor-pointer mb-0">
              <input
                v-model="power.isAura"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-2 focus:ring-purple-500"
              />
              <span class="fsr-label mb-0" title="spawns a region attached to the owner that follows them, applying the stat/damage (de)buffs below to actors inside instead of on-hit"
                >Aura <span class="fsr-help-text cursor-help">&#9432;</span></span
              >
            </label>

            <div v-if="power.isAura" class="grid grid-cols-2 gap-2">
              <div>
                <label class="fsr-label">Affects</label>
                <select v-model="power.auraDisposition" class="fsr-select text-sm">
                  <option value="any">Anyone</option>
                  <option value="ally">Allies Only</option>
                  <option value="enemy">Enemies Only</option>
                </select>
              </div>
              <div class="flex items-end">
                <label class="flex items-center gap-2 cursor-pointer mb-0">
                  <input
                    v-model="power.auraIncludeSelf"
                    type="checkbox"
                    class="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-2 focus:ring-purple-500"
                  />
                  <span class="fsr-label mb-0">Include Self</span>
                </label>
              </div>
              <div>
                <label class="fsr-label"
                  >Range (ft) <span class="fsr-help-text">(0 = use Rank's movement)</span></label
                >
                <input
                  v-model.number="power.auraRange"
                  type="number"
                  min="0"
                  class="fsr-input text-sm"
                  placeholder="0"
                />
              </div>
            </div>

            <div v-if="power.isAura" class="pt-2 border-t border-purple-800/60">
              <label class="flex items-center gap-2 cursor-pointer mb-0">
                <input
                  v-model="power.isLifeLink"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-2 focus:ring-purple-500"
                />
                <span class="fsr-label mb-0"
                  >Life-Link <span class="fsr-help-text">(bonds the owner to a SPECIFIC target selected when activated, redirecting a % of health damage between them - the aura region is only a range check, the target must stay within it for the bond to work)</span></span
                >
              </label>

              <div v-if="power.isLifeLink" class="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label class="fsr-label">Direction</label>
                  <select v-model="power.lifeLinkDirection" class="fsr-select text-sm">
                    <option value="protect">Owner protects others (owner takes the damage)</option>
                    <option value="share">Owner shares own damage (others take the damage)</option>
                  </select>
                </div>
                <div>
                  <label class="fsr-label">Redirect %</label>
                  <input
                    type="number"
                    v-model.number="power.lifeLinkPercent"
                    min="0"
                    max="100"
                    class="fsr-input text-sm"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Mass Effect (area / multi-target, resisted) -->
          <div
            class="px-2 py-1.5 bg-fuchsia-950/30 border border-fuchsia-800 rounded space-y-2"
            :class="{ 'w-full': power.massEffect?.enabled }"
          >
            <label class="flex items-center gap-2 cursor-pointer mb-0">
              <input
                type="checkbox"
                :checked="power.massEffect?.enabled"
                @change="setMassEffect(power, { enabled: ($event.target as HTMLInputElement).checked })"
                class="w-4 h-4 rounded border-gray-600 text-fuchsia-500"
              />
              <span class="fsr-label mb-0" title="using the power affects everyone in range, or all targeted tokens, instead of one attack roll. Each affected actor rolls to resist; those who fail get this power's Status Effects"
                >Mass Effect <span class="fsr-help-text cursor-help">&#9432;</span></span
              >
            </label>
            <div v-if="power.massEffect?.enabled" class="grid grid-cols-2 gap-2">
              <div>
                <label class="fsr-label">Affects</label>
                <select
                  :value="power.massEffect.scope"
                  @change="setMassEffect(power, { scope: ($event.target as HTMLSelectElement).value })"
                  class="fsr-select text-sm"
                >
                  <option value="area">Everyone in range</option>
                  <option value="targets">Targeted tokens</option>
                </select>
              </div>
              <div>
                <label class="fsr-label">Resist with</label>
                <select
                  :value="power.massEffect.resistAttribute"
                  @change="setMassEffect(power, { resistAttribute: ($event.target as HTMLSelectElement).value })"
                  class="fsr-select text-sm"
                >
                  <option value="">No resist roll</option>
                  <option value="fighting">Fighting</option>
                  <option value="agility">Agility</option>
                  <option value="strength">Strength</option>
                  <option value="endurance">Endurance</option>
                  <option value="reasoning">Reasoning</option>
                  <option value="intuition">Intuition</option>
                  <option value="psyche">Psyche</option>
                </select>
              </div>
              <div v-if="power.massEffect.resistAttribute">
                <label class="fsr-label">Result needed to resist</label>
                <select
                  :value="power.massEffect.resistResult"
                  @change="setMassEffect(power, { resistResult: ($event.target as HTMLSelectElement).value })"
                  class="fsr-select text-sm"
                >
                  <option value="green">Green</option>
                  <option value="yellow">Yellow</option>
                  <option value="red">Red</option>
                </select>
              </div>
              <label class="flex items-center gap-2 cursor-pointer self-end">
                <input
                  type="checkbox"
                  :checked="power.massEffect.includeSelf"
                  @change="setMassEffect(power, { includeSelf: ($event.target as HTMLInputElement).checked })"
                  class="w-4 h-4 rounded border-gray-600"
                />
                <span class="fsr-label mb-0">Affects the user too</span>
              </label>
              <template v-if="power.massEffect.scope === 'area'">
                <div>
                  <label class="fsr-label">Full strength within (ft)</label>
                  <input
                    type="number"
                    min="0"
                    :value="power.massEffect.baseRangeFeet"
                    @input="setMassEffect(power, { baseRangeFeet: Number(($event.target as HTMLInputElement).value) })"
                    class="fsr-input text-sm"
                  />
                </div>
                <div>
                  <label class="fsr-label">Weakens one step per (ft)</label>
                  <input
                    type="number"
                    min="0"
                    :value="power.massEffect.falloffFeet"
                    @input="setMassEffect(power, { falloffFeet: Number(($event.target as HTMLInputElement).value) })"
                    class="fsr-input text-sm"
                  />
                </div>
                <div class="col-span-2 fsr-help-text">
                  Each step lowers the result a target needs to resist by one tier, so distant targets resist more easily. 0 = nothing beyond the full-strength range.
                </div>
              </template>
            </div>
          </div>

          <!-- Area of Effect (region on hit, or dragged onto the map) -->
          <div
            class="px-2 py-1.5 bg-orange-950/30 border border-orange-800 rounded space-y-2"
            :class="{ 'w-full': power.areaOfEffect?.enabled }"
          >
            <label class="flex items-center gap-2 cursor-pointer mb-0">
              <input
                v-model="ensureAreaOfEffect(power).enabled"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-orange-500"
              />
              <span class="fsr-label mb-0" title="leaves a region that damages / debuffs anyone inside, using this power's Stat/Damage (De)buffs and DoT. Placed centered on the target on hit, or dragged onto the map when Project Remotely is on"
                >Area of Effect <span class="fsr-help-text cursor-help">&#9432;</span></span
              >
            </label>
            <div v-if="power.areaOfEffect?.enabled" class="grid grid-cols-2 gap-2">
              <div>
                <label class="fsr-label">Shape</label>
                <select v-model="power.areaOfEffect.shape" class="fsr-select text-sm">
                  <option value="circle">Circle</option>
                  <option value="cone">Cone</option>
                  <option value="ray">Ray (Line)</option>
                  <option value="rect">Rectangle</option>
                </select>
              </div>
              <div>
                <label class="fsr-label">
                  {{ power.areaOfEffect.shape === "circle" ? "Radius" : "Length" }} (scene units)
                </label>
                <input
                  v-model.number="power.areaOfEffect.size"
                  type="number"
                  min="0"
                  class="fsr-input text-sm"
                />
              </div>
              <div v-if="['ray', 'rect'].includes(power.areaOfEffect.shape)">
                <label class="fsr-label">Width (scene units)</label>
                <input
                  v-model.number="power.areaOfEffect.width"
                  type="number"
                  min="0"
                  class="fsr-input text-sm"
                />
              </div>
              <div v-if="power.areaOfEffect.shape === 'cone'">
                <label class="fsr-label">Angle (degrees)</label>
                <input
                  v-model.number="power.areaOfEffect.angle"
                  type="number"
                  min="0"
                  max="360"
                  class="fsr-input text-sm"
                />
              </div>
              <div>
                <label class="fsr-label">Color</label>
                <input
                  v-model="power.areaOfEffect.color"
                  type="color"
                  class="fsr-input h-10 p-1"
                />
              </div>
              <div>
                <label class="fsr-label">Auto-Remove After (rounds)</label>
                <input
                  v-model="power.areaOfEffect.durationRounds"
                  type="text"
                  class="fsr-input text-sm"
                  placeholder="e.g. 3 or 1d3; blank = stays"
                />
              </div>
              <label class="flex items-center gap-2 cursor-pointer col-span-2">
                <input
                  v-model="power.areaOfEffect.instant"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-600 text-orange-500"
                />
                <span class="fsr-label mb-0" title="the shape only decides who is hit, like a ray of disintegration or a cone of flame. No region stays on the map."
                  >Instant (leaves no region) <span class="fsr-help-text cursor-help">&#9432;</span></span
                >
              </label>
              <label class="flex items-center gap-2 cursor-pointer col-span-2">
                <input
                  v-model="power.areaOfEffect.remotePlaced"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-600 text-orange-500"
                />
                <span class="fsr-label mb-0" title="drag this power's button onto the map instead of targeting. The power rolls its own rank to land: any result but white lands on the spot, a white scatters it. Everyone inside, including the user, is then attacked"
                  >Project Remotely <span class="fsr-help-text cursor-help">&#9432;</span></span
                >
              </label>
              <div v-if="power.areaOfEffect.remotePlaced" class="col-span-2">
                <label class="fsr-label">Max projection range (scene units from the user's token; 0 = unlimited)</label>
                <input
                  v-model.number="power.areaOfEffect.maxRangeFeet"
                  type="number"
                  min="0"
                  class="fsr-input text-sm"
                />
              </div>
            </div>
          </div>

          <!-- Armor layer (e.g. Light-Shield) -->
          <div
            class="px-2 py-1.5 bg-yellow-950/30 border border-yellow-800 rounded space-y-2"
            :class="{ 'w-full': power.grantsArmor }"
          >
            <label class="flex items-center gap-2 cursor-pointer mb-0">
              <input
                v-model="power.grantsArmor"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-yellow-500 focus:ring-2 focus:ring-yellow-500"
              />
              <span class="fsr-label mb-0" title="soaks the chosen damage types up to this power's Rank value, in the chosen layer alongside worn armor"
                >Grants Armor Layer <span class="fsr-help-text cursor-help">&#9432;</span></span
              >
            </label>
            <template v-if="power.grantsArmor">
              <div class="flex flex-wrap gap-3">
                <label
                  v-for="t in ARMOR_DAMAGE_TYPES"
                  :key="t.key"
                  class="flex items-center gap-1 text-xs cursor-pointer"
                >
                  <input
                    type="checkbox"
                    :checked="power.armorTypes?.includes(t.key)"
                    @change="toggleArmorType(power, t.key)"
                    class="accent-yellow-500"
                  />
                  {{ t.label }}
                </label>
              </div>
              <div class="flex items-center gap-2">
                <label class="fsr-label mb-0">Layer</label>
                <input
                  v-model.number="power.armorLayer"
                  type="number"
                  min="0"
                  class="fsr-input text-sm w-20"
                />
                <span class="fsr-help-text">(0-1 = outermost; same numbering as armor items)</span>
              </div>
              <label class="flex items-center gap-2 cursor-pointer mb-0">
                <input
                  v-model="power.armorToggle"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-600 text-yellow-500"
                />
                <span class="fsr-label mb-0" title="otherwise always active; toggle with the badge above"
                  >Must be turned on <span class="fsr-help-text cursor-help">&#9432;</span></span
                >
              </label>
              <label class="flex items-center gap-2 cursor-pointer mb-0">
                <input
                  v-model="power.armorBlocksAttacks"
                  type="checkbox"
                  class="w-4 h-4 rounded border-gray-600 text-yellow-500"
                />
                <span class="fsr-label mb-0"
                  >Owner cannot attack while active</span
                >
              </label>
            </template>
          </div>

          <!-- Blend In (stealth) -->
          <div
            class="px-2 py-1.5 bg-teal-950/30 border border-teal-800 rounded space-y-2"
            :class="{ 'w-full': power.blendIn }"
          >
            <label class="flex items-center gap-2 cursor-pointer mb-0">
              <input
                v-model="power.blendIn"
                type="checkbox"
                class="w-4 h-4 rounded border-gray-600 text-teal-500 focus:ring-2 focus:ring-teal-500"
              />
              <span class="fsr-label mb-0" title="hides the owner's token from other players' clients while active; observers must beat an Intuition FEAT check that gets harder with distance to spot them - a higher Rank means a smaller, harder-to-spot base radius; use the &quot;Blend In&quot; badge above to toggle it on/off"
                >Blend In <span class="fsr-help-text cursor-help">&#9432;</span></span
              >
            </label>
            <div v-if="power.blendIn" class="fsr-help-text">
              Base range: <strong>{{ getBlendBaseRange(power.rank) }} ft</strong> (Green at this range, Yellow at 2x, Red at 4x, automatic beyond 8x)
            </div>
            <div v-if="power.blendIn">
              <label class="fsr-label mb-0">Duration formula</label>
              <input
                v-model="power.blendInDurationFormula"
                type="text"
                placeholder="blank = until toggled off"
                class="fsr-input text-sm"
              />
              <div class="fsr-help-text">
                Rolled once on activation and ticks down each combat round. Leave blank (or "indefinite") to stay active until manually toggled off.
              </div>
            </div>
          </div>

          </div>

          <div
            class="mb-2 p-2 bg-indigo-950/30 border border-indigo-800 rounded space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="fsr-label mb-0">Temporary Stat (De)buffs</span>
              <button
                @click="ensureStatDebuffs(power).push(newStatDebuff())"
                class="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs"
              >
                + Add
              </button>
            </div>

            <div
              v-for="(entry, idx) in ensureStatDebuffs(power)"
              :key="idx"
              class="border border-indigo-700 rounded p-2 space-y-2"
            >
              <div class="flex items-center justify-end">
                <button
                  @click="removePowerEntry(ensureStatDebuffs(power), idx, 'stat debuff')"
                  class="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
                  title="Remove"
                >
                  ✕
                </button>
              </div>

              <div class="space-y-2">
                <div>
                  <label class="fsr-label">Target Attribute</label>
                  <select v-model="entry.attribute" class="fsr-select text-sm">
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
                      v-model.number="entry.greenShift"
                      type="number"
                      class="fsr-input"
                      placeholder="-1"
                    />
                  </div>
                  <div>
                    <label class="fsr-label">Yellow</label>
                    <input
                      v-model.number="entry.yellowShift"
                      type="number"
                      class="fsr-input"
                      placeholder="-2"
                    />
                  </div>
                  <div>
                    <label class="fsr-label">Red</label>
                    <input
                      v-model.number="entry.redShift"
                      type="number"
                      class="fsr-input"
                      placeholder="-3"
                    />
                  </div>
                </div>

                <div class="text-xs text-gray-400">
                  Positive values apply a buff. Negative values apply a debuff.
                </div>

                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="entry.durationFormula === 'indefinite'"
                    @change="
                      e =>
                        (entry.durationFormula = (e.target as HTMLInputElement).checked
                          ? 'indefinite'
                          : '1d3')
                    "
                    class="w-4 h-4 rounded border-gray-600 text-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  />
                  <span class="fsr-label mb-0">Until Removed (no duration limit)</span>
                </label>

                <div v-if="entry.durationFormula !== 'indefinite'">
                  <label class="fsr-label">Duration Formula</label>
                  <input
                    v-model="entry.durationFormula"
                    type="text"
                    class="fsr-input"
                    placeholder="1d3"
                  />
                  <div class="text-xs text-gray-400 mt-1">
                    Rolled when the effect lands, in rounds. For an Aura power, this is rolled once when the aura is activated - not per entrant.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            class="px-2 py-1.5 bg-purple-950/30 border border-purple-800 rounded space-y-2"
            :class="{ 'w-full': power.isAura }"
          >
            <div class="flex items-center justify-between">
              <span class="fsr-label mb-0">Temporary Damage (De)buffs</span>
              <button
                @click="ensureDamageBuffs(power).push(newDamageBuff())"
                class="px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs"
              >
                + Add
              </button>
            </div>

            <div
              v-for="(entry, idx) in ensureDamageBuffs(power)"
              :key="idx"
              class="border border-purple-700 rounded p-2 space-y-2"
            >
              <div class="flex items-center justify-end">
                <button
                  @click="removePowerEntry(ensureDamageBuffs(power), idx, 'damage buff')"
                  class="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
                  title="Remove"
                >
                  ✕
                </button>
              </div>

              <div class="space-y-2">
                <div class="grid grid-cols-3 gap-2">
                  <div>
                    <label class="fsr-label">Half Success</label>
                    <input
                      v-model.number="entry.greenShift"
                      type="number"
                      class="fsr-input"
                      placeholder="-1"
                    />
                  </div>
                  <div>
                    <label class="fsr-label">Yellow</label>
                    <input
                      v-model.number="entry.yellowShift"
                      type="number"
                      class="fsr-input"
                      placeholder="-2"
                    />
                  </div>
                  <div>
                    <label class="fsr-label">Red</label>
                    <input
                      v-model.number="entry.redShift"
                      type="number"
                      class="fsr-input"
                      placeholder="-3"
                    />
                  </div>
                </div>

                <div class="text-xs text-gray-400">
                  Affects target's damage output. Positive values buff damage, negative values debuff damage.
                </div>

                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="entry.durationFormula === 'indefinite'"
                    @change="
                      e =>
                        (entry.durationFormula = (e.target as HTMLInputElement).checked
                          ? 'indefinite'
                          : '1d3')
                    "
                    class="w-4 h-4 rounded border-gray-600 text-purple-500 focus:ring-2 focus:ring-purple-500"
                  />
                  <span class="fsr-label mb-0">Until Removed (no duration limit)</span>
                </label>

                <div v-if="entry.durationFormula !== 'indefinite'">
                  <label class="fsr-label">Duration Formula</label>
                  <input
                    v-model="entry.durationFormula"
                    type="text"
                    class="fsr-input"
                    placeholder="1d3"
                  />
                  <div class="text-xs text-gray-400 mt-1">
                    Rolled when the effect lands, in rounds. For an Aura power, this is rolled once when the aura is activated - not per entrant.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            class="mb-2 p-2 bg-green-950/30 border border-green-800 rounded space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="fsr-label mb-0">Damage Over Time</span>
              <button
                @click="ensureDots(power).push(newDot())"
                class="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs"
              >
                + Add
              </button>
            </div>

            <div
              v-for="(entry, idx) in ensureDots(power)"
              :key="idx"
              class="border border-green-700 rounded p-2 space-y-2"
            >
              <div class="flex items-center justify-end">
                <button
                  @click="removePowerEntry(ensureDots(power), idx, 'damage-over-time effect')"
                  class="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
                  title="Remove"
                >
                  ✕
                </button>
              </div>

              <div class="space-y-2">
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="fsr-label">Rank</label>
                    <select v-model="entry.rank" class="fsr-select text-sm">
                      <option value="">Use Power's Rank</option>
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
                    <label class="fsr-label">Armor Piercing</label>
                    <select
                      v-model="entry.armorPiercing"
                      class="fsr-select text-sm"
                    >
                      <option value="">None</option>
                      <option
                        v-for="(label, value) in rankChoicesWithValues"
                        :key="value"
                        :value="value"
                      >
                        {{ label }}
                      </option>
                    </select>
                  </div>
                </div>

                <div class="text-xs text-gray-400">
                  Deals damage at this rank to the target at the start of each of their rounds, using the same armor-piercing rules as a normal hit, until it is removed or its duration expires.
                </div>

                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="entry.durationFormula === 'indefinite'"
                    @change="
                      e =>
                        (entry.durationFormula = (e.target as HTMLInputElement).checked
                          ? 'indefinite'
                          : '1d3')
                    "
                    class="w-4 h-4 rounded border-gray-600 text-green-500 focus:ring-2 focus:ring-green-500"
                  />
                  <span class="fsr-label mb-0">Until Removed (no duration limit)</span>
                </label>

                <div v-if="entry.durationFormula !== 'indefinite'">
                  <label class="fsr-label">Duration Formula</label>
                  <input
                    v-model="entry.durationFormula"
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
          </div>

          <div
            class="mb-2 p-2 bg-indigo-950/30 border border-indigo-800 rounded space-y-2"
          >
            <div class="flex items-center justify-between">
              <span class="fsr-label mb-0">Status Effects</span>
              <button
                @click="ensureStatusEffects(power).push(newStatusEffect())"
                class="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs"
              >
                + Add
              </button>
            </div>

            <div
              v-for="(entry, idx) in ensureStatusEffects(power)"
              :key="idx"
              class="border border-indigo-700 rounded p-2 space-y-2"
            >
              <div class="flex items-center justify-end">
                <button
                  @click="removePowerEntry(ensureStatusEffects(power), idx, 'status effect')"
                  class="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
                  title="Remove"
                >
                  ✕
                </button>
              </div>

              <div class="space-y-2">
                <div>
                  <label class="fsr-label">Status</label>
                  <select v-model="entry.statusId" class="fsr-select text-sm">
                    <option value="">Select a status...</option>
                    <option
                      v-for="choice in statusEffectChoices"
                      :key="choice.value"
                      :value="choice.value"
                    >
                      {{ choice.label }}
                    </option>
                  </select>
                </div>

                <div class="text-xs text-gray-400">
                  Applies this Foundry status condition (sleep, stun, prone, etc.) to the target on a successful hit.
                </div>

                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    :checked="entry.durationFormula === 'indefinite'"
                    @change="
                      e =>
                        (entry.durationFormula = (e.target as HTMLInputElement).checked
                          ? 'indefinite'
                          : '1d3')
                    "
                    class="w-4 h-4 rounded border-gray-600 text-indigo-500 focus:ring-2 focus:ring-indigo-500"
                  />
                  <span class="fsr-label mb-0">Until Removed (no duration limit)</span>
                </label>

                <div v-if="entry.durationFormula !== 'indefinite'">
                  <label class="fsr-label">Duration Formula</label>
                  <input
                    v-model="entry.durationFormula"
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
            <div v-if="power.effectType === 'damage'" class="col-span-2">
              <label class="fsr-label"
                >Damage Type(s)
                <span class="fsr-help-text"
                  >(select one or more - each deals the power's full damage,
                  soaked independently by matching armor)</span
                ></label
              >
              <div class="flex flex-wrap gap-2">
                <label
                  v-for="type in DAMAGE_TYPE_OPTIONS"
                  :key="type"
                  class="flex items-center gap-1 cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    class="w-4 h-4 rounded border-gray-600 text-blue-500 focus:ring-2 focus:ring-blue-500"
                    :checked="(power.damageTypes ?? []).includes(type)"
                    @change="
                      toggleDamageType(
                        power,
                        type,
                        ($event.target as HTMLInputElement).checked
                      )
                    "
                  />
                  {{ DAMAGE_TYPE_LABELS[type] }}
                </label>
              </div>
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
            <div v-if="power.effectType === 'damage'">
              <label class="fsr-label">Leech / Life-Link %</label>
              <input
                type="number"
                v-model.number="power.leechPercent"
                min="0"
                max="100"
                class="fsr-input text-sm"
                placeholder="0"
              />
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
