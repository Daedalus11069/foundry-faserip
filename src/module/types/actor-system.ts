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

export interface VisionSourceData {
  id: string;
  type: string; // "sight:<visionModeKey>" | "detect:<detectionModeKey>"
  rangeSource: "flat" | "intuition" | "power";
  flatRange?: number;
  powerId?: string;
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

  // Token vision - any number of simultaneous vision methods (e.g. Basic
  // Sight + Tremorsense). "type" is "sight:<visionModeKey>" or
  // "detect:<detectionModeKey>" (see FaseripActor#syncVisionToTokens).
  visionSources?: VisionSourceData[];

  weaponSlots?: number; // Per-form override for weapon-bearing arms; falls back to system.weaponSlots

  attributes: FormAttributeSet;
}

export interface PowerStatDebuffData {
  enabled: boolean;
  attribute:
    | "fighting"
    | "agility"
    | "strength"
    | "endurance"
    | "reasoning"
    | "intuition"
    | "psyche";
  greenShift: number;
  yellowShift: number;
  redShift: number;
  durationFormula: string;
}

export interface PowerDamageDebuffData {
  enabled: boolean;
  greenShift: number;
  yellowShift: number;
  redShift: number;
  durationFormula: string;
}

export interface TemporaryStatModifierData {
  id: string;
  attribute: PowerStatDebuffData["attribute"];
  chartShift: number;
  roundsRemaining: number;
  sourcePowerId?: string;
  sourcePowerName?: string;
  durationFormula?: string;
  combatId?: string | null;
}

export interface TemporaryDamageModifierData {
  id: string;
  chartShift: number;
  roundsRemaining: number;
  sourcePowerId?: string;
  sourcePowerName?: string;
  sourceWeaponId?: string;
  sourceWeaponName?: string;
  durationFormula?: string;
  combatId?: string | null;
}

export interface PowerDotData {
  enabled: boolean;
  rank: string; // Rank the DoT ticks at each round; blank uses the power/weapon's own rank
  armorPiercing?: string; // Armor-piercing rank applied on every tick
  durationFormula: string;
}

export interface PowerStatusEffectData {
  enabled: boolean;
  statusId: string; // Foundry CONFIG.statusEffects id (e.g. "sleep", "stun", "prone")
  durationFormula: string; // Dice formula for rounds, or "indefinite"
}

export interface WeaponAreaOfEffectData {
  enabled: boolean;
  shape: "circle" | "cone" | "ray" | "rect";
  size: number; // Radius (circle), length (cone/ray), or length (rect), in scene distance units
  width: number; // Width, in scene distance units - only used for ray/rect shapes
  angle: number; // Angle in degrees - only used for cone shape
  color: string; // Template border/fill color
  durationRounds: string; // Rounds before the template auto-deletes - a flat number or a dice formula (e.g. "1d3"); blank/"0" = stays until removed manually
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
  /** @deprecated use damageTypes */
  damageType?: string; // Damage type (fire, cold, energy, etc.)
  damageTypes?: string[]; // Damage type(s) dealt - each receives the power's full damage amount
  physicalValue?: number | null; // Per-type armor soak (Body Armor-style powers). null = fall back to value/maxValue
  magicValue?: number;
  magicMaxValue?: number;
  mentalValue?: number;
  mentalMaxValue?: number;
  formIds?: string[]; // Form IDs this power is active in
  targetType?: "any" | "others" | "self"; // Who this power can target: others only, self only, or either
  skipDialogs?: boolean; // Roll directly without talent/combo dialogs
  multiHit?: boolean; // True for AoE/multi-target powers (one roll, no combo penalty)
  armorPiercing?: string | null; // Armor-piercing rank (for damage powers that pierce armor)
  leechPercent?: number; // Life-link/leech: % of health damage dealt to the target that heals the attacker (0-100)
  statDebuffs?: PowerStatDebuffData[];
  damageBuffs?: PowerDamageDebuffData[];
  dots?: PowerDotData[];
  statusEffects?: PowerStatusEffectData[]; // Foundry status conditions (sleep, stun, prone, etc.) to apply on hit
  isAura?: boolean; // Spawns a region attached to the owner's token that (de)buffs actors inside instead of applying on-hit
  auraDisposition?: "ally" | "enemy" | "any"; // Who the aura affects, relative to the owner token's disposition
  auraIncludeSelf?: boolean; // Whether the owner is affected by their own aura
  auraRange?: number; // Radius in scene distance units (e.g. feet); 0/unset falls back to the rank-based movement table
  blendIn?: boolean; // Lets the owner hide their token from other players' clients; spotting difficulty scales with distance based on this power's rank
  blendInDurationFormula?: string; // Blank/"indefinite" = stays active until manually toggled off; otherwise rolled once on activation and ticks down each combat round
  isLifeLink?: boolean; // Bonds the owner to whoever is in the aura region, redirecting a % of health damage between them
  lifeLinkPercent?: number; // % of health damage redirected by the life-link bond (0-100)
  lifeLinkDirection?: "protect" | "share"; // "protect": the owner soaks damage for others in range. "share": the owner offloads their own damage onto others in range
  autoHealEachRound?: boolean; // For heal-health/heal-armor powers: apply Rank value automatically at the start of every round
}

export interface TalentData {
  id: string;
  name: string;
  bonus: number;
  description?: string;
  grantsDualWield?: boolean; // Grants the ability to wield two weapons simultaneously
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
  applicableTalents?: string[]; // Names of talents that apply to this weapon
  description?: string;
  equipped?: boolean; // Whether weapon is equipped
  armorPiercing?: string | null; // Armor-piercing rank (for damage calculation)
  multiHit?: boolean; // True for AoE/multi-target weapons (one roll, no combo penalty)
  areaOfEffect?: WeaponAreaOfEffectData; // Region template placed centered on the target on hit
  statDebuffs?: PowerStatDebuffData[];
  damageBuffs?: PowerDamageDebuffData[];
  dots?: PowerDotData[];
  statusEffects?: PowerStatusEffectData[]; // Foundry status conditions (sleep, stun, prone, etc.) to apply on hit - e.g. tranq darts, net guns
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
  alias: string;
  biography: string;
  notes: string;
  publicNotes: string;
  gmNotes: string;
  weaponSlots: number; // Number of weapon-bearing arms (default 2 for a normal humanoid)
  powers: PowerData[];
  talents: TalentData[];
  armors: ArmorData[];
  weapons: WeaponData[];
  temporaryStatModifiers?: TemporaryStatModifierData[];
  temporaryDamageModifiers?: TemporaryDamageModifierData[];
  charman: CharmanData;
  actionsThisTurn: number; // Cumulative attacks taken this turn (drives combo penalty offset)
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
