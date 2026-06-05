import { Rank } from "../enums";

const { BooleanField, NumberField, StringField } = foundry.data.fields;

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

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      quantity: new NumberField({ integer: true, initial: 1, min: 0 })
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
      equipped: new BooleanField({ required: true, initial: false })
    };
  }
}

/**
 * Weapon item data model
 */
export class WeaponDataModel extends ItemDataModel {
  declare weaponType: string;
  declare damage: number;
  declare damageRank: string;
  declare equipped: boolean;
  declare talent?: string;
  declare armorPiercing?: string;
  declare multiHit?: boolean;

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      weaponType: new StringField({
        required: true,
        initial: "melee",
        choices: ["melee", "ranged", "thrown"]
      }),
      damage: new NumberField({
        required: true,
        integer: true,
        initial: 0
      }),
      damageRank: new StringField({
        required: true,
        initial: Rank.Typical,
        choices: Object.values(Rank)
      }),
      equipped: new BooleanField({ required: true, initial: false }),
      talent: new StringField({ required: false, initial: "" }),
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
      })
    };
  }
}
