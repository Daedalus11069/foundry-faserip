/**
 * Type definitions for FASERIP Actor system data
 * These interfaces match the schema defined in ActorDataModels.ts
 */

export interface CharmanData {
  characterId?: number;
  username?: string;
  characterName?: string;
  lastSync?: number;
  autoSync?: boolean;
}

export interface AttributeData {
  rank: string;
  value: number;
}

export interface ResourceData {
  value: number;
  max: number;
}

export interface KarmaData {
  value: number;
}

export interface MentalPointsData {
  value: number;
  max: number;
}

export interface ResourcesData {
  health: ResourceData;
  karma: KarmaData;
  mentalPoints?: MentalPointsData;
  armor?: ResourceData; // Derived - calculated from Body Armor power + equipped armor
}

export interface FormAttributeSet {
  fighting: AttributeData;
  agility: AttributeData;
  strength: AttributeData;
  endurance: AttributeData;
  reasoning: AttributeData;
  intuition: AttributeData;
  psyche: AttributeData;
  [key: string]: AttributeData; // Index signature for dynamic access
}

export interface FormData {
  id: string;
  name: string;
  description?: string;
  isPrimary: boolean; // Required to match Form interface

  // Token appearance
  tokenImage?: string;
  tokenWidth?: number;
  tokenHeight?: number;
  tokenScale?: number;

  attributes: FormAttributeSet;
}

export interface PowerData {
  id: string;
  name: string;
  rank: string;
  category?: string;
  value: number;
  maxValue: number; // Required to match Power interface (used for degrading powers like Body Armor)
  description?: string;
  mpCost?: number;
  resistanceType?: string; // For resistance powers
  vulnerabilityType?: string; // For vulnerability/weakness powers
  effectType?: "none" | "damage" | "heal-health" | "heal-armor"; // For damage/healing powers
  attackType?: "none" | "melee" | "ranged" | "psyche"; // Attack type for defense attribute selection
  damageType?: string; // Damage type (fire, cold, energy, etc.)
  formIds?: string[]; // Form IDs this power is active in
  skipDialogs?: boolean; // Roll directly without talent/combo dialogs
  multiHit?: boolean; // True for AoE/multi-target powers (one roll, no combo penalty)
  armorPiercing?: string | null; // Armor-piercing rank (for damage powers that pierce armor)
}

export interface TalentData {
  id: string;
  name: string;
  bonus: number;
  description?: string;
}

export interface ArmorData {
  id: string;
  name: string;
  rank: string;
  value: number; // Current armor value (damage reduction)
  maxValue: number; // Maximum armor value (used when degrading enabled)
  equipped: boolean;
  description?: string;
}

export interface WeaponData {
  id: string;
  name: string;
  type: "melee" | "ranged" | "thrown"; // Weapon type determines which stat is used for to-hit
  damage: string; // Damage rank (e.g., "Typical", "Good", "Excellent")
  stat: "fighting" | "agility"; // Stat used for to-hit rolls
  applicableTalent?: string; // Name of talent that applies to this weapon
  description?: string;
  equipped?: boolean; // Whether weapon is equipped
  armorPiercing?: string | null; // Armor-piercing rank (for damage calculation)
  multiHit?: boolean; // True for AoE/multi-target weapons (one roll, no combo penalty)
}

/**
 * Base actor system data shared across all actor types
 */
export interface BaseActorSystemData {
  currentFormId: string;
  forms: FormData[];
  resources: ResourcesData;
  healthByForm: Record<string, number>; // Stores HP per form ID
  callname: string;
  biography: string;
  notes: string;
  publicNotes: string;
  gmNotes: string;
  powers: PowerData[];
  talents: TalentData[];
  armors: ArmorData[];
  weapons: WeaponData[];
  charman: CharmanData;
}

/**
 * PC-specific system data
 */
export interface PcActorSystemData extends BaseActorSystemData {
  // PC-specific properties can be added here
}

/**
 * NPC-specific system data
 */
export interface NpcActorSystemData extends BaseActorSystemData {
  // NPC-specific properties can be added here
}

/**
 * Type for reactive actor clones used in Vue components
 * This represents the serialized actor data structure
 */
export interface ReactiveActorData {
  _id: string;
  name: string;
  img: string | null;
  system: BaseActorSystemData;
}

/**
 * Type-safe reactive actor for PC actors
 */
export interface ReactivePcData extends ReactiveActorData {
  system: PcActorSystemData;
}

/**
 * Type-safe reactive actor for NPC actors
 */
export interface ReactiveNpcData extends ReactiveActorData {
  system: NpcActorSystemData;
}
