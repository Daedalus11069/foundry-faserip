/**
 * Actor types in the FASERIP system
 */
export enum ActorType {
  Pc = "pc",
  Npc = "npc"
}

/**
 * FASERIP primary attributes (the seven abilities)
 */
export enum Attribute {
  Fighting = "fighting",
  Agility = "agility",
  Strength = "strength",
  Endurance = "endurance",
  Reasoning = "reasoning",
  Intuition = "intuition",
  Psyche = "psyche"
}

/**
 * FASERIP rank system
 * Each rank has a numerical value used for rolls and calculations
 */
export enum Rank {
  Shift0 = "shift_0",
  Feeble = "feeble",
  Poor = "poor",
  Typical = "typical",
  Good = "good",
  Excellent = "excellent",
  Remarkable = "remarkable",
  Incredible = "incredible",
  Amazing = "amazing",
  Monstrous = "monstrous",
  Unearthly = "unearthly",
  ShiftX = "shift_x",
  ShiftY = "shift_y",
  ShiftZ = "shift_z",
  Class1000 = "class_1000",
  Class3000 = "class_3000",
  Class5000 = "class_5000",
  Beyond = "beyond"
}

/**
 * Ordered array of ranks for Chart Shift calculations
 */
export const RANK_ORDER: Rank[] = [
  Rank.Shift0,
  Rank.Feeble,
  Rank.Poor,
  Rank.Typical,
  Rank.Good,
  Rank.Excellent,
  Rank.Remarkable,
  Rank.Incredible,
  Rank.Amazing,
  Rank.Monstrous,
  Rank.Unearthly,
  Rank.ShiftX,
  Rank.ShiftY,
  Rank.ShiftZ,
  Rank.Class1000,
  Rank.Class3000,
  Rank.Class5000,
  Rank.Beyond
];

/**
 * Apply Chart Shift to a rank
 * +1 CS shifts up one rank (e.g., Excellent → Remarkable)
 * -1 CS shifts down one rank (e.g., Excellent → Good)
 */
export function applyChartShift(baseRank: Rank, cs: number): Rank {
  const currentIndex = RANK_ORDER.indexOf(baseRank);
  if (currentIndex === -1) return baseRank;

  const newIndex = Math.max(
    0,
    Math.min(RANK_ORDER.length - 1, currentIndex + cs)
  );
  return RANK_ORDER[newIndex];
}

/**
 * Format a rank for display (removes underscores, converts to title case)
 */
export function formatRankDisplay(rank: Rank | string): string {
  return rank
    .toString()
    .replace(/_/g, " ")
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Rank values for rolls and calculations
 */
export const RANK_VALUES: Record<Rank, number> = {
  [Rank.Shift0]: 0,
  [Rank.Feeble]: 2,
  [Rank.Poor]: 4,
  [Rank.Typical]: 6,
  [Rank.Good]: 10,
  [Rank.Excellent]: 20,
  [Rank.Remarkable]: 30,
  [Rank.Incredible]: 40,
  [Rank.Amazing]: 50,
  [Rank.Monstrous]: 75,
  [Rank.Unearthly]: 100,
  [Rank.ShiftX]: 150,
  [Rank.ShiftY]: 200,
  [Rank.ShiftZ]: 500,
  [Rank.Class1000]: 1000,
  [Rank.Class3000]: 3000,
  [Rank.Class5000]: 5000,
  [Rank.Beyond]: 10000
};

/**
 * Universal Table results for FASERIP d100 rolls
 */
export enum RollResult {
  White = "white", // Miss/Failure
  Green = "green", // Typical success
  Yellow = "yellow", // Good success
  Red = "red" // Amazing success
}

/**
 * Damage types for powers and resistances
 */
export enum DamageType {
  None = "none", // Normal/untyped damage (physical weapons, etc.)
  Fire = "fire",
  Cold = "cold",
  Electricity = "electricity",
  Energy = "energy", // Generic energy (beams, blasts)
  Radiation = "radiation",
  Sonic = "sonic",
  Acid = "acid",
  Poison = "poison",
  Mental = "mental", // Psychic/psionic damage
  Magic = "magic",
  Force = "force" // Force fields, telekinesis
}

/**
 * Rank short codes for Universal Table lookup
 */
export const RANK_SHORTS: Record<Rank, string> = {
  [Rank.Shift0]: "s0",
  [Rank.Feeble]: "fe",
  [Rank.Poor]: "pr",
  [Rank.Typical]: "ty",
  [Rank.Good]: "gd",
  [Rank.Excellent]: "ex",
  [Rank.Remarkable]: "rm",
  [Rank.Incredible]: "in",
  [Rank.Amazing]: "am",
  [Rank.Monstrous]: "mn",
  [Rank.Unearthly]: "un",
  [Rank.ShiftX]: "x",
  [Rank.ShiftY]: "y",
  [Rank.ShiftZ]: "z",
  [Rank.Class1000]: "1000",
  [Rank.Class3000]: "3000",
  [Rank.Class5000]: "5000",
  [Rank.Beyond]: "b"
};

/**
 * Universal Table color ranges for each rank
 * Format: [greenStart, yellowStart, redStart]
 * White: 1 to (greenStart - 1)
 * Green: greenStart to (yellowStart - 1)
 * Yellow: yellowStart to (redStart - 1)
 * Red: redStart to 100
 */
export const UNIVERSAL_TABLE: Record<string, [number, number, number]> = {
  s0: [66, 95, 100], // Shift 0
  fe: [61, 91, 100], // Feeble
  pr: [56, 86, 100], // Poor
  ty: [51, 81, 98], // Typical
  gd: [46, 76, 98], // Good
  ex: [40, 71, 96], // Excellent
  rm: [36, 66, 95], // Remarkable
  in: [31, 61, 91], // Incredible
  am: [26, 56, 91], // Amazing
  mn: [21, 51, 86], // Monstrous
  un: [16, 46, 86], // Unearthly
  x: [11, 41, 81], // Shift X
  y: [7, 41, 81], // Shift Y
  z: [4, 36, 75], // Shift Z
  "1000": [2, 36, 75], // Class 1000
  "3000": [2, 31, 71], // Class 3000
  "5000": [2, 26, 66], // Class 5000
  b: [2, 21, 61] // Beyond
};

/**
 * Power categories
 */
export enum PowerCategory {
  Fighting = "fighting",
  Agility = "agility",
  Strength = "strength",
  Endurance = "endurance",
  Reasoning = "reasoning",
  Intuition = "intuition",
  Psyche = "psyche",
  General = "general"
}

/**
 * Item types
 */
export enum ItemType {
  Power = "power",
  Talent = "talent",
  Equipment = "equipment",
  Contact = "contact",
  Armor = "armor",
  Weapon = "weapon"
}
