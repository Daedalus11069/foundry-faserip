<script setup lang="ts">
/**
 * Editor for the effects system shared by powers and weapons (stat/damage
 * (de)buffs, damage over time, status conditions and the area of effect).
 *
 * Stateless: it renders `effects` and reports every edit as a whole-field
 * `update` so the parent decides how to persist it - assign onto a reactive
 * actor power, or `item.update()` a weapon item.
 */
import { computed } from "vue";
import type {
  EffectsData,
  WeaponAreaOfEffectData
} from "../types/actor-system";
import {
  EFFECT_ATTRIBUTE_CHOICES,
  NEW_EFFECT_ENTRY,
  defaultAreaOfEffect,
  getStatusEffectChoices,
  type EffectListField
} from "../utils/effects";
import { RANK_VALUES } from "../enums";
import { stringToRank } from "../utils";

const props = defineProps<{
  effects: EffectsData;
  owner: "power" | "weapon";
}>();

const emit = defineEmits<{
  (e: "update", field: keyof EffectsData, value: unknown): void;
}>();

const ownerNoun = computed(() => (props.owner === "power" ? "Power" : "Weapon"));

const statusEffectChoices = computed(getStatusEffectChoices);

const rankChoicesWithValues = computed(() => {
  // @ts-expect-error - CONFIG.FASERIP added by system
  const ranks: Record<string, string> = CONFIG.FASERIP?.ranks || {};
  return Object.entries(ranks).map(([key, label]) => [
    key,
    `${label} (${RANK_VALUES[stringToRank(key)]})`
  ]) as Array<[string, string]>;
});

const aoe = computed<WeaponAreaOfEffectData>(
  () => props.effects.areaOfEffect ?? defaultAreaOfEffect()
);

function clone<T>(value: T): T {
  return foundry.utils.deepClone(value);
}

function entries(field: EffectListField): any[] {
  return (props.effects[field] as any[] | undefined) ?? [];
}

function addEntry(field: EffectListField) {
  emit("update", field, [...clone(entries(field)), NEW_EFFECT_ENTRY[field]()]);
}

async function removeEntry(field: EffectListField, idx: number, label: string) {
  // @ts-expect-error - DialogV2 path not fully typed
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    content: `<p>Remove this ${label}?</p>`,
    rejectClose: false,
    modal: true
  });
  if (!confirmed) return;

  const next = clone(entries(field));
  next.splice(idx, 1);
  emit("update", field, next);
}

function setEntry(
  field: EffectListField,
  idx: number,
  key: string,
  value: boolean | number | string
) {
  const next = clone(entries(field));
  if (!next[idx]) return;
  next[idx][key] = value;
  emit("update", field, next);
}

function setIndefinite(field: EffectListField, idx: number, checked: boolean) {
  setEntry(field, idx, "durationFormula", checked ? "indefinite" : "1d3");
}

function setAoe(key: keyof WeaponAreaOfEffectData, value: boolean | number | string) {
  emit("update", "areaOfEffect", { ...clone(aoe.value), [key]: value });
}

const inputValue = (e: Event) => (e.target as HTMLInputElement).value;
const inputNumber = (e: Event) => Number(inputValue(e));
const inputChecked = (e: Event) => (e.target as HTMLInputElement).checked;

/**
 * Per list field: its heading, the noun used in the remove prompt, and the
 * literal Tailwind classes for its colour scheme (kept literal so the JIT
 * sees them).
 */
const LISTS: Array<{
  field: EffectListField;
  title: string;
  noun: string;
  box: string;
  card: string;
  add: string;
  check: string;
}> = [
  {
    field: "statDebuffs",
    title: "Temporary Stat (De)buffs",
    noun: "stat debuff",
    box: "bg-indigo-950/30 border-indigo-800",
    card: "border-indigo-700",
    add: "bg-indigo-600 hover:bg-indigo-700",
    check: "text-indigo-500 focus:ring-indigo-500"
  },
  {
    field: "damageBuffs",
    title: "Temporary Damage (De)buffs",
    noun: "damage buff",
    box: "bg-purple-950/30 border-purple-800",
    card: "border-purple-700",
    add: "bg-purple-600 hover:bg-purple-700",
    check: "text-purple-500 focus:ring-purple-500"
  },
  {
    field: "dots",
    title: "Damage Over Time",
    noun: "damage-over-time effect",
    box: "bg-green-950/30 border-green-800",
    card: "border-green-700",
    add: "bg-green-600 hover:bg-green-700",
    check: "text-green-500 focus:ring-green-500"
  },
  {
    field: "statusEffects",
    title: "Status Effects",
    noun: "status effect",
    box: "bg-indigo-950/30 border-indigo-800",
    card: "border-indigo-700",
    add: "bg-indigo-600 hover:bg-indigo-700",
    check: "text-indigo-500 focus:ring-indigo-500"
  }
];
</script>

<template>
  <div class="space-y-2">
    <!-- Area of Effect (region on hit, or dragged onto the map) -->
    <div class="p-2 bg-orange-950/30 border border-orange-800 rounded space-y-2">
      <label class="flex items-center gap-2 cursor-pointer mb-0">
        <input
          :checked="aoe.enabled"
          @change="setAoe('enabled', inputChecked($event))"
          type="checkbox"
          class="w-4 h-4 rounded border-gray-600 text-orange-500"
        />
        <span
          class="fsr-label mb-0"
          :title="`leaves a region centered on the target on hit (it does not follow them afterward) that damages / debuffs anyone inside, using this ${owner}'s Stat/Damage (De)buffs and DoT. Or drag the ${owner}'s button onto the map when ${owner === 'power' ? 'Project' : 'Propel'} Remotely is on`"
          >Area of Effect <span class="fsr-help-text cursor-help">&#9432;</span></span
        >
      </label>

      <div v-if="aoe.enabled" class="grid grid-cols-2 gap-2">
        <div>
          <label class="fsr-label">Shape</label>
          <select
            :value="aoe.shape"
            @change="setAoe('shape', inputValue($event))"
            class="fsr-select text-sm"
          >
            <option value="circle">Circle</option>
            <option value="cone">Cone</option>
            <option value="ray">Ray (Line)</option>
            <option value="rect">Rectangle</option>
          </select>
        </div>
        <div>
          <label class="fsr-label">
            {{ aoe.shape === "circle" ? "Radius" : "Length" }} (scene units)
          </label>
          <input
            :value="aoe.size"
            @change="setAoe('size', inputNumber($event))"
            type="number"
            min="0"
            class="fsr-input text-sm"
          />
        </div>
        <div v-if="['ray', 'rect'].includes(aoe.shape)">
          <label class="fsr-label">Width (scene units)</label>
          <input
            :value="aoe.width"
            @change="setAoe('width', inputNumber($event))"
            type="number"
            min="0"
            class="fsr-input text-sm"
          />
        </div>
        <div v-if="aoe.shape === 'cone'">
          <label class="fsr-label">Angle (degrees)</label>
          <input
            :value="aoe.angle"
            @change="setAoe('angle', inputNumber($event))"
            type="number"
            min="0"
            max="360"
            class="fsr-input text-sm"
          />
        </div>
        <div>
          <label class="fsr-label">Color</label>
          <input
            :value="aoe.color"
            @change="setAoe('color', inputValue($event))"
            type="color"
            class="fsr-input h-10 p-1"
          />
        </div>
        <div>
          <label class="fsr-label">Auto-Remove After (rounds)</label>
          <input
            :value="aoe.durationRounds"
            @change="setAoe('durationRounds', inputValue($event))"
            type="text"
            class="fsr-input text-sm"
            placeholder="e.g. 3 or 1d3; blank = stays"
          />
        </div>
        <label class="flex items-center gap-2 cursor-pointer col-span-2">
          <input
            :checked="!!aoe.instant"
            @change="setAoe('instant', inputChecked($event))"
            type="checkbox"
            class="w-4 h-4 rounded border-gray-600 text-orange-500"
          />
          <span
            class="fsr-label mb-0"
            title="the shape only decides who is hit, like a ray of disintegration or a cone of flame. No region stays on the map, so lingering DoTs and (de)buffs from the region are not applied."
            >Instant (leaves no region) <span class="fsr-help-text cursor-help">&#9432;</span></span
          >
        </label>
        <label class="flex items-center gap-2 cursor-pointer col-span-2">
          <input
            :checked="!!aoe.remotePlaced"
            @change="setAoe('remotePlaced', inputChecked($event))"
            type="checkbox"
            class="w-4 h-4 rounded border-gray-600 text-orange-500"
          />
          <span
            class="fsr-label mb-0"
            :title="`drag this ${owner}'s button onto the map instead of targeting. The ${owner} rolls its own ${owner === 'power' ? 'rank' : 'stat'} to land: any result but white lands on the spot, a white scatters it (circles only; rays, cones and rectangles never go off target). Everyone inside, including the user, is then attacked`"
            >{{ owner === "power" ? "Project" : "Propel" }} Remotely
            <span class="fsr-help-text cursor-help">&#9432;</span></span
          >
        </label>
        <div v-if="aoe.remotePlaced" class="col-span-2">
          <label class="fsr-label"
            >Max range (scene units from the user's token; 0 = unlimited)</label
          >
          <input
            :value="aoe.maxRangeFeet ?? 0"
            @change="setAoe('maxRangeFeet', inputNumber($event) || 0)"
            type="number"
            min="0"
            class="fsr-input text-sm"
          />
        </div>
        <div class="col-span-2 text-xs text-gray-400">
          Anyone else standing inside picks up whichever of this {{ owner }}'s
          Temporary Stat/Damage (De)buffs and Damage Over Time entries are listed
          below, for as long as they remain inside (or, for DoT, each round until
          the region expires).
        </div>
      </div>
    </div>

    <!-- Stat / damage buffs, damage over time, status conditions -->
    <div
      v-for="list in LISTS"
      :key="list.field"
      class="p-2 border rounded space-y-2"
      :class="list.box"
    >
      <div class="flex items-center justify-between">
        <span class="fsr-label mb-0">{{ list.title }}</span>
        <button
          @click="addEntry(list.field)"
          class="px-2 py-1 text-white rounded text-xs"
          :class="list.add"
        >
          + Add
        </button>
      </div>

      <div
        v-for="(entry, idx) in entries(list.field)"
        :key="idx"
        class="border rounded p-2 space-y-2"
        :class="list.card"
      >
        <div class="flex items-center justify-end">
          <button
            @click="removeEntry(list.field, idx, list.noun)"
            class="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
            title="Remove"
          >
            ✕
          </button>
        </div>

        <!-- Stat debuff: which attribute -->
        <div v-if="list.field === 'statDebuffs'">
          <label class="fsr-label">Target Attribute</label>
          <select
            :value="entry.attribute"
            @change="setEntry(list.field, idx, 'attribute', inputValue($event))"
            class="fsr-select text-sm"
          >
            <option
              v-for="option in EFFECT_ATTRIBUTE_CHOICES"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
        </div>

        <!-- Stat / damage buff: chart shifts per result colour -->
        <template v-if="list.field === 'statDebuffs' || list.field === 'damageBuffs'">
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="fsr-label">Half Success</label>
              <input
                :value="entry.greenShift"
                @change="setEntry(list.field, idx, 'greenShift', inputNumber($event))"
                type="number"
                class="fsr-input"
                placeholder="-1"
              />
            </div>
            <div>
              <label class="fsr-label">Yellow</label>
              <input
                :value="entry.yellowShift"
                @change="setEntry(list.field, idx, 'yellowShift', inputNumber($event))"
                type="number"
                class="fsr-input"
                placeholder="-2"
              />
            </div>
            <div>
              <label class="fsr-label">Red</label>
              <input
                :value="entry.redShift"
                @change="setEntry(list.field, idx, 'redShift', inputNumber($event))"
                type="number"
                class="fsr-input"
                placeholder="-3"
              />
            </div>
          </div>
          <div class="text-xs text-gray-400">
            <template v-if="list.field === 'statDebuffs'">
              Positive values apply a buff. Negative values apply a debuff.
            </template>
            <template v-else>
              Affects target's damage output. Positive values buff damage, negative values debuff damage.
            </template>
          </div>
        </template>

        <!-- Damage over time: rank + armor piercing -->
        <template v-if="list.field === 'dots'">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="fsr-label">Rank</label>
              <select
                :value="entry.rank || ''"
                @change="setEntry(list.field, idx, 'rank', inputValue($event))"
                class="fsr-select text-sm"
              >
                <option value="">
                  Use {{ ownerNoun }}'s {{ owner === "weapon" ? "Damage " : "" }}Rank
                </option>
                <option
                  v-for="[key, label] in rankChoicesWithValues"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </select>
            </div>
            <div>
              <label class="fsr-label">Armor Piercing</label>
              <select
                :value="entry.armorPiercing || ''"
                @change="setEntry(list.field, idx, 'armorPiercing', inputValue($event))"
                class="fsr-select text-sm"
              >
                <option value="">None</option>
                <option
                  v-for="[key, label] in rankChoicesWithValues"
                  :key="key"
                  :value="key"
                >
                  {{ label }}
                </option>
              </select>
            </div>
          </div>
          <div class="text-xs text-gray-400">
            Deals damage at this rank to the target at the start of each of their rounds, using the same armor-piercing rules as a normal hit, until it is removed or its duration expires.
          </div>
        </template>

        <!-- Status condition: which one -->
        <template v-if="list.field === 'statusEffects'">
          <div>
            <label class="fsr-label">Status</label>
            <select
              :value="entry.statusId"
              @change="setEntry(list.field, idx, 'statusId', inputValue($event))"
              class="fsr-select text-sm"
            >
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
            Applies this Foundry status condition (sleep, stun, prone, etc.) to the target on a successful hit<template v-if="owner === 'weapon'"> - e.g. tranq darts or a net gun</template>.
          </div>
        </template>

        <!-- Duration, common to every effect -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            :checked="entry.durationFormula === 'indefinite'"
            @change="setIndefinite(list.field, idx, inputChecked($event))"
            class="w-4 h-4 rounded border-gray-600 focus:ring-2"
            :class="list.check"
          />
          <span class="fsr-label mb-0">Until Removed (no duration limit)</span>
        </label>

        <div v-if="entry.durationFormula !== 'indefinite'">
          <label class="fsr-label">Duration Formula</label>
          <input
            :value="entry.durationFormula"
            @change="setEntry(list.field, idx, 'durationFormula', inputValue($event))"
            type="text"
            class="fsr-input"
            placeholder="1d3"
          />
          <div class="text-xs text-gray-400 mt-1">
            Rolled when the effect lands, in rounds.
            <template v-if="owner === 'power' && list.field !== 'dots' && list.field !== 'statusEffects'">
              For an Aura power, this is rolled once when the aura is activated - not per entrant.
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
