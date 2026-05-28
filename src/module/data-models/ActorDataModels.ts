import { Rank } from "../enums";
import type {
  CharmanData,
  FormData,
  PowerData,
  TalentData,
  ResourcesData
} from "../types/actor-system";

const {
  ArrayField,
  BooleanField,
  NumberField,
  ObjectField,
  SchemaField,
  StringField
} = foundry.data.fields;

const { TypeDataModel } = foundry.abstract;

/**
 * Schema for a single FASERIP attribute (F.A.S.E.R.I.P.)
 */
export function defineAttributeSchema() {
  return new SchemaField({
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
    })
  });
}

/**
 * Schema for resources with max (Health)
 * Health can go negative to -20 (death threshold)
 */
export function defineResourceSchema() {
  return new SchemaField({
    value: new NumberField({
      required: true,
      integer: true,
      min: -20,
      initial: 0
    }),
    max: new NumberField({
      required: true,
      integer: true,
      min: 0,
      initial: 0
    })
  });
}

/**
 * Schema for karma (no max limit)
 */
export function defineKarmaSchema() {
  return new SchemaField({
    value: new NumberField({
      required: true,
      integer: true,
      min: 0,
      initial: 0
    })
  });
}

/**
 * Schema for an armor item
 */
export function defineArmorSchema() {
  return new SchemaField({
    id: new StringField({ required: true }),
    name: new StringField({ required: true, initial: "Armor" }),
    rank: new StringField({ required: true, initial: Rank.Typical }),
    value: new NumberField({
      required: true,
      integer: true,
      min: 0,
      initial: 6
    }),
    equipped: new BooleanField({ required: true, initial: false }),
    description: new StringField({ required: false, initial: "" })
  });
}

/**
 * Schema for a character form (alternate identities/forms)
 */
export function defineFormSchema() {
  return new SchemaField({
    id: new StringField({ required: true }),
    name: new StringField({ required: true, initial: "Base Form" }),
    isPrimary: new BooleanField({ required: true, initial: false }),

    // Token appearance
    tokenImage: new StringField({ required: false, initial: "" }),
    tokenWidth: new NumberField({
      required: false,
      integer: true,
      min: 1,
      initial: 1
    }),
    tokenHeight: new NumberField({
      required: false,
      integer: true,
      min: 1,
      initial: 1
    }),
    tokenScale: new NumberField({
      required: false,
      min: 0.1,
      max: 10,
      initial: 1
    }),

    attributes: new SchemaField({
      fighting: defineAttributeSchema(),
      agility: defineAttributeSchema(),
      strength: defineAttributeSchema(),
      endurance: defineAttributeSchema(),
      reasoning: defineAttributeSchema(),
      intuition: defineAttributeSchema(),
      psyche: defineAttributeSchema()
    })
  });
}

/**
 * Schema for power references (stores item IDs)
 */
export function definePowerRefSchema() {
  return new SchemaField({
    id: new StringField({ required: true }),
    name: new StringField({ required: true }),
    rank: new StringField({ required: true }),
    category: new StringField({ required: true }),
    value: new NumberField({
      required: false,
      integer: true,
      min: 0,
      initial: 6
    }),
    mpCost: new NumberField({
      required: false,
      integer: true,
      min: 0,
      initial: 0
    }),
    description: new StringField({ required: false, initial: "" }),
    formIds: new ArrayField(new StringField(), {
      required: false,
      initial: () => []
    })
  });
}

/**
 * Schema for talent references
 */
export function defineTalentRefSchema() {
  return new SchemaField({
    id: new StringField({ required: true }),
    name: new StringField({ required: true }),
    bonus: new NumberField({
      required: true,
      initial: 0,
      integer: true
      // Bonus represents Chart Shift (CS) modifier, not direct numerical addition
      // +1 = +1CS (shift result one column right on Universal Table)
      // -1 = -1CS (shift result one column left on Universal Table)
    }),
    description: new StringField({ required: false, initial: "" }),
    formIds: new ArrayField(new StringField(), {
      required: false,
      initial: () => []
    })
  });
}

/**
 * Base actor data model - shared by all actor types
 */
export class ActorDataModel extends TypeDataModel<
  foundry.data.fields.DataSchema,
  // @ts-expect-error - Document.Any namespace issue
  Document.Any
> {
  // Explicit property declarations matching defineSchema() so TypeScript knows about them
  declare currentFormId: string;
  declare forms: FormData[];
  declare resources: ResourcesData;
  declare healthByForm: Record<string, number>;
  declare callname: string;
  declare biography: string;
  declare notes: string;
  declare publicNotes: string;
  declare gmNotes: string;
  declare powers: PowerData[];
  declare talents: TalentData[];
  declare charman: CharmanData;
  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      // Current form (active form for characters with multiple forms)
      currentFormId: new StringField({ required: true, initial: "" }),

      // Character forms (at least one)
      forms: new ArrayField(defineFormSchema(), { required: true }),

      // Resources
      resources: new SchemaField({
        health: defineResourceSchema(),
        karma: defineKarmaSchema(),
        mentalPoints: new SchemaField(
          {
            value: new NumberField({
              required: true,
              integer: true,
              min: 0,
              initial: 0
            }),
            max: new NumberField({
              required: true,
              integer: true,
              min: 0,
              initial: 0
            })
          },
          { required: false }
        )
      }),

      // Health tracked per-form (key = formId, value = HP)
      healthByForm: new ObjectField({ initial: {} }),

      // Character callname (displayed under the main name)
      callname: new StringField({ initial: "" }),

      // Biography and notes
      biography: new StringField({ initial: "" }),
      notes: new StringField({ initial: "" }),

      // Public notes visible to players
      publicNotes: new StringField({ initial: "" }),

      // GM-only notes
      gmNotes: new StringField({ initial: "" }),

      // Powers (stored as references)
      powers: new ArrayField(definePowerRefSchema()),

      // Talents (stored as references)
      talents: new ArrayField(defineTalentRefSchema()),

      // Armor items (house rule: armorEnabled setting)
      armors: new ArrayField(defineArmorSchema(), {
        required: false,
        initial: () => []
      }),

      // Charman integration
      charman: new SchemaField({
        characterId: new NumberField({ integer: true }),
        username: new StringField(),
        characterName: new StringField(),
        lastSync: new NumberField(),
        autoSync: new BooleanField({ initial: false })
      })
    };
  }

  /**
   * Get the initiative dice formula based on Agility
   */
  get initiativeDice(): string {
    // Find current form
    const currentForm = (this as any).forms?.find(
      (f: any) => f.id === (this as any).currentFormId
    );

    if (!currentForm) {
      return "1d6"; // Default fallback
    }

    const agilityValue = currentForm.attributes?.agility?.value || 6;
    return `1d${agilityValue}`;
  }
}

/**
 * PC-specific data model
 */
export class PcDataModel extends ActorDataModel {
  declare popularity: number;

  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema(),
      // PCs might have additional fields like popularity, etc.
      popularity: new NumberField({ integer: true, initial: 0 })
    };
  }
}

/**
 * NPC-specific data model
 */
export class NpcDataModel extends ActorDataModel {
  static override defineSchema(): foundry.data.fields.DataSchema {
    return {
      ...super.defineSchema()
      // NPCs use the base schema
    };
  }
}
