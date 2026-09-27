import { Rank } from "../enums";
import type {
  PowerStatDebuffData,
  PowerDamageDebuffData,
  PowerDotData,
  PowerStatusEffectData,
  WeaponAreaOfEffectData
} from "../types/actor-system";

const { ArrayField, BooleanField, NumberField, SchemaField, StringField } =
  foundry.data.fields;

/**
 * Shared schema for a single stat-debuff entry, reused by PowerDataModel and
 * by PowerAuraRegionBehaviorType so aura regions can snapshot the same shape.
 */
export function buildStatDebuffFieldSchema() {
  return new SchemaField({
    enabled: new BooleanField({ required: false, initial: false }),
    attribute: new StringField({
      required: false,
      initial: "intuition",
      choices: [
        "fighting",
        "agility",
        "strength",
        "endurance",
        "reasoning",
        "intuition",
        "psyche"
      ]
    }),
    greenShift: new NumberField({ required: false, integer: true, initial: 0 }),
    yellowShift: new NumberField({ required: false, integer: true, initial: 0 }),
    redShift: new NumberField({ required: false, integer: true, initial: 0 }),
    durationFormula: new StringField({ required: false, initial: "1d3" })
  });
}

/**
 * Shared schema for a single damage-buff entry, reused by PowerDataModel and
 * by PowerAuraRegionBehaviorType so aura regions can snapshot the same shape.
 */
export function buildDamageBuffFieldSchema() {
  return new SchemaField({
    enabled: new BooleanField({ required: false, initial: false }),
    greenShift: new NumberField({ required: false, integer: true, initial: 0 }),
    yellowShift: new NumberField({ required: false, integer: true, initial: 0 }),
    redShift: new NumberField({ required: false, integer: true, initial: 0 }),
    durationFormula: new StringField({ required: false, initial: "1d3" })
  });
}

/**
 * Shared schema for a single status-effect entry, reused by PowerDataModel
 * and WeaponDataModel. statusId is a Foundry CONFIG.statusEffects id (e.g.
 * "sleep", "stun", "prone") rather than a system-defined enum, so the
 * selectable list always mirrors whatever statuses Foundry/core/modules
 * register instead of a hand-maintained duplicate.
 */
export function buildStatusEffectFieldSchema() {
  return new SchemaField({
    enabled: new BooleanField({ required: false, initial: false }),
    statusId: new StringField({ required: false, blank: true, initial: "" }),
    durationFormula: new StringField({ required: false, initial: "1d3" })
  });
}

/**
 * Shared schema for a weapon's on-hit area-of-effect template. Placed
 * centered on the target's position at the moment of a hit - it does not
 * follow the target afterward.
 */
export function buildAreaOfEffectFieldSchema() {
  return new SchemaField({
    enabled: new BooleanField({ required: false, initial: false }),
    shape: new StringField({
      required: false,
      initial: "circle",
      choices: ["circle", "cone", "ray", "rect"]
    }),
    size: new NumberField({ required: false, initial: 10, min: 0 }),
    width: new NumberField({ required: false, initial: 5, min: 0 }),
    angle: new NumberField({
      required: false,
      initial: 53,
      min: 0,
      max: 360
    }),
    color: new StringField({ required: false, initial: "#ff0000" }),
    durationRounds: new StringField({ required: false, blank: true, initial: "" })
  });
}

function migrateBuffDebuffArrayFields(source: any): any {
  const renames: Array<[string, string]> = [
    ["statDebuff", "statDebuffs"],
    ["damageBuff", "damageBuffs"],
    ["dot", "dots"]
  ];
  for (const [oldKey, newKey] of renames) {
    if (source[oldKey] && !Array.isArray(source[newKey])) {
      source[newKey] = [source[oldKey]];
    }
    delete source[oldKey];
  }
  return source;
}

const { TypeDataModel } = foundry.abstract;

/**
 * Base item data model - shared by all item types
 */
export class ItemDataModel extends TypeDataModel<
  foundry.data.fields.DataSchema,
  // @ts-expect-error - Document.Any namespace issue
  Document.Any
> {
  declare description: string;

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      description: new StringField({ required: false, initial: "" })
    };
  }
}

/**
 * Power item data model
 */
export class PowerDataModel extends ItemDataModel {
  declare rank: string;
  declare category: string;
  declare armorPiercing?: string;
  declare statDebuffs?: PowerStatDebuffData[];
  declare damageBuffs?: PowerDamageDebuffData[];
  declare dots?: PowerDotData[];
  declare statusEffects?: PowerStatusEffectData[];
  declare isAura?: boolean;
  declare auraDisposition?: string;
  declare auraIncludeSelf?: boolean;
  declare blendIn?: boolean;
  declare blendInDurationFormula?: string;

  static override migrateData(source: any): any {
    source = super.migrateData(source);
    return migrateBuffDebuffArrayFields(source);
  }

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      rank: new StringField({ required: false, initial: "" }),
      category: new StringField({ required: false, initial: "" }),
      armorPiercing: new StringField({
        required: false,
        blank: true,
        initial: "",
        choices: ["", ...Object.values(Rank)]
      }),
      isAura: new BooleanField({ required: false, initial: false }),
      auraDisposition: new StringField({
        required: false,
        initial: "any",
        choices: ["ally", "enemy", "any"]
      }),
      auraIncludeSelf: new BooleanField({ required: false, initial: false }),
      blendIn: new BooleanField({ required: false, initial: false }),
      blendInDurationFormula: new StringField({ required: false, blank: true, initial: "" }),
      statDebuffs: new ArrayField(buildStatDebuffFieldSchema(), {
        required: false,
        initial: []
      }),
      damageBuffs: new ArrayField(buildDamageBuffFieldSchema(), {
        required: false,
        initial: []
      }),
      dots: new ArrayField(
        new SchemaField({
          enabled: new BooleanField({
            required: false,
            initial: false
          }),
          rank: new StringField({
            required: false,
            blank: true,
            initial: "",
            choices: ["", ...Object.values(Rank)]
          }),
          armorPiercing: new StringField({
            required: false,
            blank: true,
            initial: "",
            choices: ["", ...Object.values(Rank)]
          }),
          durationFormula: new StringField({
            required: false,
            initial: "1d3"
          })
        }),
        { required: false, initial: [] }
      ),
      statusEffects: new ArrayField(buildStatusEffectFieldSchema(), {
        required: false,
        initial: []
      })
    };
  }
}

/**
 * Talent item data model
 */
export class TalentDataModel extends ItemDataModel {
  declare bonus: number;

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      bonus: new NumberField({ integer: true, initial: 0 })
    };
  }
}

/**
 * Equipment item data model
 */
export class EquipmentDataModel extends ItemDataModel {
  declare quantity: number;
  declare locked: boolean;
  declare hack: {
    enabled: boolean;
    attribute: string;
    difficultyRank: string;
    /** Name of a Node Hacker graph (built with its Node Designer) to hack against instead of
     * a network generated from the opening hack roll's result. Blank = generate one. */
    graphName: string;
  };

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      quantity: new NumberField({ integer: true, initial: 1, min: 0 }),
      locked: new BooleanField({ required: false, initial: false }),
      hack: new SchemaField({
        enabled: new BooleanField({ required: false, initial: false }),
        attribute: new StringField({
          required: false,
          initial: "reasoning",
          choices: [
            "fighting",
            "agility",
            "strength",
            "endurance",
            "reasoning",
            "intuition",
            "psyche"
          ]
        }),
        difficultyRank: new StringField({
          required: false,
          blank: true,
          initial: "",
          choices: ["", ...Object.values(Rank)]
        }),
        graphName: new StringField({ required: false, blank: true, initial: "" })
      })
    };
  }
}

/**
 * Contact item data model
 */
export class ContactDataModel extends ItemDataModel {
  declare relationship: string;

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      relationship: new StringField({ required: false, initial: "" })
    };
  }
}

/**
 * Armor item data model
 */
export class ArmorDataModel extends ItemDataModel {
  declare rank: string;
  declare value: number;
  declare maxValue: number;
  declare equipped: boolean;
  declare formIds: string[];

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      rank: new StringField({
        required: true,
        initial: Rank.Typical,
        choices: Object.values(Rank)
      }),
      value: new NumberField({
        required: true,
        integer: true,
        min: 0,
        initial: 6
      }),
      maxValue: new NumberField({
        required: true,
        integer: true,
        min: 0,
        initial: 6
      }),
      equipped: new BooleanField({ required: true, initial: false }),
      formIds: new ArrayField(new StringField(), {
        required: false,
        initial: []
      })
    };
  }
}

/**
 * Weapon item data model
 */
export class WeaponDataModel extends ItemDataModel {
  declare weaponType: string;
  declare damage: string;
  declare damageRank: string;
  declare equipped: boolean;
  declare talents?: string[];
  declare armorPiercing?: string;
  declare multiHit?: boolean;
  declare statDebuffs?: PowerStatDebuffData[];
  declare damageBuffs?: PowerDamageDebuffData[];
  declare dots?: PowerDotData[];
  declare statusEffects?: PowerStatusEffectData[];
  declare areaOfEffect?: WeaponAreaOfEffectData;

  static override migrateData(source: any): any {
    source = super.migrateData(source);
    return migrateBuffDebuffArrayFields(source);
  }

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      weaponType: new StringField({
        required: true,
        initial: "melee",
        choices: ["melee", "ranged", "thrown"]
      }),
      damage: new StringField({
        required: true,
        blank: true,
        initial: ""
      }),
      damageRank: new StringField({
        required: true,
        initial: Rank.Typical,
        choices: Object.values(Rank)
      }),
      equipped: new BooleanField({ required: true, initial: false }),
      talents: new ArrayField(new StringField(), {
        required: false,
        initial: []
      }),
      armorPiercing: new StringField({
        required: false,
        blank: true,
        initial: "",
        choices: ["", ...Object.values(Rank)]
      }),
      multiHit: new BooleanField({
        required: false,
        initial: false,
        label: "Multi-Hit (AoE)"
      }),
      statDebuffs: new ArrayField(
        new SchemaField({
          enabled: new BooleanField({
            required: false,
            initial: false
          }),
          attribute: new StringField({
            required: false,
            initial: "intuition",
            choices: [
              "fighting",
              "agility",
              "strength",
              "endurance",
              "reasoning",
              "intuition",
              "psyche"
            ]
          }),
          greenShift: new NumberField({
            required: false,
            integer: true,
            initial: 0
          }),
          yellowShift: new NumberField({
            required: false,
            integer: true,
            initial: 0
          }),
          redShift: new NumberField({
            required: false,
            integer: true,
            initial: 0
          }),
          durationFormula: new StringField({
            required: false,
            initial: "1d3"
          })
        }),
        { required: false, initial: [] }
      ),
      damageBuffs: new ArrayField(
        new SchemaField({
          enabled: new BooleanField({
            required: false,
            initial: false
          }),
          greenShift: new NumberField({
            required: false,
            integer: true,
            initial: 0
          }),
          yellowShift: new NumberField({
            required: false,
            integer: true,
            initial: 0
          }),
          redShift: new NumberField({
            required: false,
            integer: true,
            initial: 0
          }),
          durationFormula: new StringField({
            required: false,
            initial: "1d3"
          })
        }),
        { required: false, initial: [] }
      ),
      dots: new ArrayField(
        new SchemaField({
          enabled: new BooleanField({
            required: false,
            initial: false
          }),
          rank: new StringField({
            required: false,
            blank: true,
            initial: "",
            choices: ["", ...Object.values(Rank)]
          }),
          armorPiercing: new StringField({
            required: false,
            blank: true,
            initial: "",
            choices: ["", ...Object.values(Rank)]
          }),
          durationFormula: new StringField({
            required: false,
            initial: "1d3"
          })
        }),
        { required: false, initial: [] }
      ),
      statusEffects: new ArrayField(buildStatusEffectFieldSchema(), {
        required: false,
        initial: []
      }),
      areaOfEffect: buildAreaOfEffectFieldSchema()
    };
  }
}
