import { parseRankFromCharman, stringToRank, valueToRank } from "./utils";
import { RANK_VALUES } from "./enums";

/**
 * Diffing for the Foundry -> Charman push. Both sides are reduced to the same
 * canonical field set so the GM only sees differences that matter, then the
 * GM's per-entry choices are turned into a partial sync payload.
 */

export type SyncSection = "forms" | "powers" | "talents" | "armors" | "weapons";

export const SYNC_SECTIONS: { section: SyncSection; label: string }[] = [
  { section: "forms", label: "Forms & Stats" },
  { section: "powers", label: "Powers" },
  { section: "talents", label: "Talents" },
  { section: "armors", label: "Armor" },
  { section: "weapons", label: "Weapons" }
];

export type SyncEntryKind = "added" | "changed" | "removed";

export interface SyncFieldChange {
  field: string;
  charman: string;
  foundry: string;
}

export interface SyncEntry {
  /** Unique id, `${section}:${key}` - also the key into the decisions map */
  id: string;
  section: SyncSection;
  /** Lowercase name, "#n" suffixed for repeats (same scheme as Charman) */
  key: string;
  name: string;
  /**
   * added:   only in Foundry   - apply = create it in Charman
   * changed: in both, differs  - apply = overwrite Charman with Foundry's
   * removed: only in Charman   - apply = delete it from Charman
   */
  kind: SyncEntryKind;
  changes: SyncFieldChange[];
}

export type SyncScalarField = "karma" | "mentalpoints" | "weaponSlots";

export interface SyncScalarChange {
  id: string;
  field: SyncScalarField;
  label: string;
  charman: string;
  foundry: string;
}

export interface SyncDiff {
  entries: SyncEntry[];
  scalars: SyncScalarChange[];
}

/** Entry/scalar id -> whether the GM wants Foundry's side applied */
export type SyncDecisions = Record<string, boolean>;

/**
 * Keys for a list of named entries: lowercase (ASCII only, to match PHP's
 * strtolower) name, numbered from the second repeat ("claw", "claw#2").
 */
export function itemKeys(items: { name?: string }[]): string[] {
  const seen: Record<string, number> = {};
  return items.map(item => {
    const base = String(item.name ?? "").replace(/[A-Z]/g, c =>
      c.toLowerCase()
    );
    seen[base] = (seen[base] ?? 0) + 1;
    return seen[base] > 1 ? `${base}#${seen[base]}` : base;
  });
}

const STATS = [
  "fighting",
  "agility",
  "strength",
  "endurance",
  "reasoning",
  "intuition",
  "psyche"
];

const BUFF_DEFAULTS: Record<string, Record<string, any>> = {
  statDebuffs: {
    enabled: false,
    attribute: "intuition",
    greenShift: 0,
    yellowShift: 0,
    redShift: 0,
    durationFormula: ""
  },
  damageBuffs: {
    enabled: false,
    greenShift: 0,
    yellowShift: 0,
    redShift: 0,
    durationFormula: ""
  },
  dots: {
    enabled: false,
    rank: null,
    armorPiercing: null,
    durationFormula: ""
  },
  statusEffects: { enabled: false, statusId: "", durationFormula: "" }
};

const AOE_DEFAULTS = {
  enabled: false,
  shape: "circle",
  size: 10,
  width: 5,
  angle: 53,
  color: "#ff0000",
  durationRounds: "",
  remotePlaced: false,
  instant: false,
  maxRangeFeet: 0
};

/**
 * Damage types of a Charman power/weapon: its damageTypes list, or the legacy
 * single damageType ("none" means no type) for records saved before the list
 * existed. Never contains "none" or duplicates.
 */
export function normalizeDamageTypes(raw: any): string[] {
  const listed: unknown[] = Array.isArray(raw?.damageTypes)
    ? raw.damageTypes
    : [];
  const types: unknown[] = listed.length ? listed : [raw?.damageType];
  return [
    ...new Set(
      types.filter((t): t is string => typeof t === "string" && !!t && t !== "none")
    )
  ];
}

function isBlank(value: any): boolean {
  return value === undefined || value === null || value === "";
}

/** Rank enum for a rank name, short, or numeric score; null when empty */
function rankKey(value: any): string | null {
  if (isBlank(value)) return null;
  if (!isNaN(Number(value))) return valueToRank(Number(value));
  return stringToRank(String(value));
}

function highestRank(ranks: any[]): string | null {
  const values = RANK_VALUES as Record<string, number>;
  let best: string | null = null;
  for (const rank of ranks) {
    const key = rankKey(rank);
    if (key && (!best || values[key] > values[best])) best = key;
  }
  return best;
}

function normBuffs(kind: string, list: any): any[] {
  const defaults = BUFF_DEFAULTS[kind];
  return (list ?? []).map((entry: any) => {
    const out: Record<string, any> = {};
    for (const field of Object.keys(defaults)) {
      const value = entry?.[field] ?? defaults[field];
      out[field] =
        field === "rank" || field === "armorPiercing" ? rankKey(value) : value;
    }
    return out;
  });
}

function normBuffFields(raw: any): Record<string, any> {
  return {
    statDebuffs: normBuffs("statDebuffs", raw.statDebuffs),
    damageBuffs: normBuffs("damageBuffs", raw.damageBuffs),
    dots: normBuffs("dots", raw.dots),
    statusEffects: normBuffs("statusEffects", raw.statusEffects)
  };
}

const sortedNames = (names: any): string[] =>
  [...(names ?? [])].map(String).sort();

/**
 * Reduce a form/power/talent/armor/weapon - either in the sync payload shape
 * (Foundry) or as returned by Charman's GET endpoint - to the canonical
 * fields that get compared and displayed.
 */
function canonicalFields(
  section: SyncSection,
  raw: any
): Record<string, any> {
  switch (section) {
    case "forms": {
      const attributes = raw.attributes ?? raw;
      const fields: Record<string, any> = {
        primary: !!raw.isPrimary,
        tokenWidth: Number(raw.tokenWidth) || 1,
        tokenHeight: Number(raw.tokenHeight) || 1,
        tokenScale: Number(raw.tokenScale) || 1,
        weaponSlots: isBlank(raw.weaponSlots) ? null : Number(raw.weaponSlots),
        vision: (raw.visionSources ?? []).map((vs: any) => ({
          type: vs.type || "sight:basic",
          rangeSource: vs.rangeSource || "flat",
          flatRange: Number(vs.flatRange) || 0,
          powerName: vs.powerName || ""
        }))
      };
      for (const stat of STATS) {
        fields[stat] = parseRankFromCharman(attributes[stat]).value;
      }
      return fields;
    }
    case "powers": {
      const perForm =
        typeof raw.rank === "object" && raw.rank !== null && !Array.isArray(raw.rank);
      return {
        rank: perForm ? highestRank(Object.values(raw.rank)) : rankKey(raw.rank),
        forms: perForm ? sortedNames(Object.keys(raw.rank)) : sortedNames(raw.formNames),
        description: raw.description ?? "",
        mpCost: Number(raw.mpCost) || 0,
        effectType: raw.effectType || "none",
        attackType: raw.attackType || "none",
        damageTypes: normalizeDamageTypes(raw),
        skipDialogs: !!raw.skipDialogs,
        resistanceType: raw.resistanceType || null,
        vulnerabilityType: raw.vulnerabilityType || null,
        multiHit: !!raw.multiHit,
        armorPiercing: rankKey(raw.armorPiercing),
        leechPercent: Number(raw.leechPercent) || 0,
        targetType: raw.targetType || "any",
        ...normBuffFields(raw),
        isAura: !!raw.isAura,
        auraDisposition: raw.auraDisposition || "any",
        auraIncludeSelf: !!raw.auraIncludeSelf,
        auraRange: Number(raw.auraRange) || 0,
        massEffect: {
          enabled: !!raw.massEffect?.enabled,
          scope: raw.massEffect?.scope === "targets" ? "targets" : "area",
          baseRangeFeet: Number(raw.massEffect?.baseRangeFeet ?? 20),
          falloffFeet: Number(raw.massEffect?.falloffFeet ?? 20),
          includeSelf: !!raw.massEffect?.includeSelf,
          resistAttribute: raw.massEffect?.resistAttribute || "",
          resistResult: raw.massEffect?.resistResult || "green"
        },
        areaOfEffect: { ...AOE_DEFAULTS, ...(raw.areaOfEffect ?? {}) },
        grantsArmor: !!raw.grantsArmor,
        armorTypes: Array.isArray(raw.armorTypes) ? raw.armorTypes : [],
        armorLayer: Number(raw.armorLayer ?? 1),
        armorToggle: !!raw.armorToggle,
        armorBlocksAttacks: !!raw.armorBlocksAttacks,
        blendIn: !!raw.blendIn,
        blendInDurationFormula: raw.blendInDurationFormula || "",
        isLifeLink: !!raw.isLifeLink,
        lifeLinkPercent: Number(raw.lifeLinkPercent) || 0,
        lifeLinkDirection: raw.lifeLinkDirection || "protect",
        autoHealEachRound: !!raw.autoHealEachRound
      };
    }
    case "talents":
      return {
        bonus: Number(raw.bonus) || 0,
        description: raw.description ?? "",
        grantsDualWield: !!raw.grantsDualWield
      };
    case "armors":
      return {
        rank: rankKey(raw.rank),
        value: Number(raw.value) || 0,
        maxValue: Number(raw.maxValue) || 0,
        equipped: !!raw.equipped,
        description: raw.description ?? "",
        forms: sortedNames(raw.formNames)
      };
    case "weapons": {
      const melee = raw.type === "melee" || raw.type === "thrown";
      return {
        type: raw.type,
        damage: melee ? Number(raw.damage) || 0 : rankKey(raw.damage),
        applicableTalent: raw.applicableTalent || null,
        // Empty means Physical on the Foundry side, so compare it that way
        damageTypes: normalizeDamageTypes(raw).length
          ? normalizeDamageTypes(raw)
          : ["physical"],
        armorPiercing: rankKey(raw.armorPiercing),
        description: raw.description ?? "",
        multiHit: !!raw.multiHit,
        ...normBuffFields(raw),
        areaOfEffect: { ...AOE_DEFAULTS, ...(raw.areaOfEffect ?? {}) }
      };
    }
  }
}

function sameValue(a: any, b: any): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function formatValue(value: any): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") {
    if (Array.isArray(value) && value.length === 0) return "none";
    const json = JSON.stringify(value);
    return json.length > 70 ? `${json.slice(0, 67)}...` : json;
  }
  return String(value);
}

function diffFields(
  section: SyncSection,
  charmanRaw: any,
  foundryRaw: any
): SyncFieldChange[] {
  const charman = canonicalFields(section, charmanRaw);
  const foundry = canonicalFields(section, foundryRaw);
  const changes: SyncFieldChange[] = [];
  for (const field of Object.keys(foundry)) {
    if (!sameValue(charman[field], foundry[field])) {
      changes.push({
        field,
        charman: formatValue(charman[field]),
        foundry: formatValue(foundry[field])
      });
    }
  }
  return changes;
}

/**
 * Compare the full Foundry sync payload (see CharmanService.buildSyncPayload)
 * against the character currently stored in Charman.
 */
export function buildSyncDiff(
  foundryPayload: Record<string, any>,
  charmanChar: Record<string, any>
): SyncDiff {
  const entries: SyncEntry[] = [];

  for (const { section } of SYNC_SECTIONS) {
    const foundryItems: any[] = foundryPayload[section] ?? [];
    const charmanItems: any[] = charmanChar[section] ?? [];
    const charmanKeys = itemKeys(charmanItems);
    const charmanByKey = new Map<string, any>(
      charmanItems.map((item, i) => [charmanKeys[i], item])
    );
    const foundryKeys = itemKeys(foundryItems);
    const seen = new Set<string>();

    foundryItems.forEach((item, i) => {
      const key = foundryKeys[i];
      seen.add(key);
      const match = charmanByKey.get(key);

      if (!match) {
        entries.push({
          id: `${section}:${key}`,
          section,
          key,
          name: item.name,
          kind: "added",
          changes: []
        });
        return;
      }

      const changes = diffFields(section, match, item);
      if (changes.length > 0) {
        entries.push({
          id: `${section}:${key}`,
          section,
          key,
          name: item.name,
          kind: "changed",
          changes
        });
      }
    });

    charmanItems.forEach((item, i) => {
      const key = charmanKeys[i];
      if (seen.has(key)) return;
      entries.push({
        id: `${section}:${key}`,
        section,
        key,
        name: item.name,
        kind: "removed",
        changes: []
      });
    });
  }

  const scalars: SyncScalarChange[] = [];
  const addScalar = (
    field: SyncScalarField,
    label: string,
    charman: any,
    foundry: any
  ) => {
    if (foundry === undefined || foundry === null) return;
    if (Number(charman) === Number(foundry)) return;
    scalars.push({
      id: `scalar:${field}`,
      field,
      label,
      charman: formatValue(charman),
      foundry: formatValue(foundry)
    });
  };
  addScalar("karma", "Karma", charmanChar.karma ?? 0, foundryPayload.karma);
  addScalar(
    "mentalpoints",
    "Mental Points",
    charmanChar.mentalpoints ?? 0,
    foundryPayload.mentalpoints
  );
  addScalar(
    "weaponSlots",
    "Default weapon slots",
    charmanChar.weaponSlots ?? 2,
    foundryPayload.weaponSlots
  );

  return { entries, scalars };
}

/**
 * Starting selection for the review dialog: new and changed entries default
 * to pushing Foundry's version, entries only in Charman default to being
 * kept, and resource totals (which Charman may have changed independently,
 * e.g. a GM karma award) default to untouched.
 */
export function defaultDecisions(diff: SyncDiff): SyncDecisions {
  const decisions: SyncDecisions = {};
  for (const entry of diff.entries) {
    decisions[entry.id] = entry.kind !== "removed";
  }
  for (const scalar of diff.scalars) {
    decisions[scalar.id] = false;
  }
  return decisions;
}

export function hasChosenChanges(
  diff: SyncDiff,
  decisions: SyncDecisions
): boolean {
  return (
    diff.entries.some(entry => decisions[entry.id]) ||
    diff.scalars.some(scalar => decisions[scalar.id])
  );
}

/**
 * Turn the GM's decisions into the partial payload for the sync endpoint:
 * chosen added/changed entries are upserted (carrying their `key`), chosen
 * removals go under `remove`, and everything unchosen is left out so Charman
 * keeps it as-is.
 */
export function buildSelectivePayload(
  foundryPayload: Record<string, any>,
  diff: SyncDiff,
  decisions: SyncDecisions
): Record<string, any> {
  const payload: Record<string, any> = {
    username: foundryPayload.username,
    callname: foundryPayload.callname
  };
  const remove: Record<string, string[]> = {};

  for (const { section } of SYNC_SECTIONS) {
    const items: any[] = foundryPayload[section] ?? [];
    const keys = itemKeys(items);
    const byKey = new Map<string, any>(
      items.map((item, i) => [keys[i], { ...item, key: keys[i] }])
    );

    for (const entry of diff.entries) {
      if (entry.section !== section || !decisions[entry.id]) continue;

      if (entry.kind === "removed") {
        (remove[section] ??= []).push(entry.key);
      } else {
        const item = byKey.get(entry.key);
        if (item) (payload[section] ??= []).push(item);
      }
    }
  }

  if (Object.keys(remove).length > 0) payload.remove = remove;

  for (const scalar of diff.scalars) {
    if (decisions[scalar.id]) payload[scalar.field] = foundryPayload[scalar.field];
  }

  return payload;
}
