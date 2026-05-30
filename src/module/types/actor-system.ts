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
}

export interface FormData {
  id: string;
  name: string;
  description?: string;

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
  description?: string;
  mpCost?: number;
}

export interface TalentData {
  id: string;
  name: string;
  bonus: number;
  description?: string;
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
