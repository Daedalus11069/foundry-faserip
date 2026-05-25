import { Rank, RANK_VALUES } from "./enums";

/**
 * Convert a rank string to its numerical value
 */
export function getRankValue(rank: Rank | string): number {
  return RANK_VALUES[rank as Rank] || 0;
}

/**
 * Convert a numerical value to the closest rank
 */
export function valueToRank(value: number): Rank {
  const entries = Object.entries(RANK_VALUES) as [Rank, number][];
  const sorted = entries.sort((a, b) => b[1] - a[1]); // Sort descending

  // Find the highest rank where value >= rank threshold
  for (let i = 0; i < sorted.length; i++) {
    if (value >= sorted[i][1]) {
      return sorted[i][0];
    }
  }

  // If value is below all ranks, return Shift0
  return Rank.Shift0;
}

/**
 * Get initiative die size based on rank
 * Initiative in FASERIP is rolled with 1d{rank value} instead of d100
 */
export function getInitiativeDie(rank: Rank | string): number {
  const value = getRankValue(rank);
  // Minimum 1d2 for Shift 0, cap at d100 for very high ranks
  return Math.min(Math.max(value, 2), 100);
}

/**
 * Calculate health based on configured house rule:
 * - "faseSum": Fighting + Agility + Strength + Endurance (default)
 * - "enduranceX2": Endurance × 2
 */
export function calculateHealth(form: any): number {
  if (!form || !form.attributes) return 24; // Default for 4x typical (6)

  // Get calculation method with proper fallback
  let method = "faseSum";
  try {
    if (game?.settings) {
      method =
        (game.settings.get("faserip", "healthCalculationMethod") as string) ||
        "faseSum";
    }
  } catch (e) {
    // Setting not registered yet, use default
    method = "faseSum";
  }

  const fighting = form.attributes.fighting?.value || 0;
  const agility = form.attributes.agility?.value || 0;
  const strength = form.attributes.strength?.value || 0;
  const endurance = form.attributes.endurance?.value || 0;

  if (method === "enduranceX2") {
    // House Rule: Health = Endurance × 2
    return endurance * 2;
  } else {
    // Default: Health = F + A + S + E
    return fighting + agility + strength + endurance;
  }
}

/**
 * Calculate mental points based on RIP attributes (Reasoning + Intuition + Psyche)
 */
export function calculateMentalPoints(form: any): number {
  if (!form || !form.attributes) return 18; // Default for 3x typical (6)

  const reasoning = form.attributes.reasoning?.value || 0;
  const intuition = form.attributes.intuition?.value || 0;
  const psyche = form.attributes.psyche?.value || 0;

  // Mental points are the sum of RIP attributes
  return reasoning + intuition + psyche;
}

/**
 * Convert string rank to Rank enum
 * Supports full names (e.g., "excellent"), internal format (e.g., "shift_x"),
 * and shorthand abbreviations (e.g., "ex", "x", "rm")
 */
export function stringToRank(rankStr: string): Rank {
  const rankMap: Record<string, Rank> = {
    // Full names
    shift_0: Rank.Shift0,
    shift0: Rank.Shift0,
    feeble: Rank.Feeble,
    poor: Rank.Poor,
    typical: Rank.Typical,
    good: Rank.Good,
    excellent: Rank.Excellent,
    remarkable: Rank.Remarkable,
    incredible: Rank.Incredible,
    amazing: Rank.Amazing,
    monstrous: Rank.Monstrous,
    unearthly: Rank.Unearthly,
    shift_x: Rank.ShiftX,
    shiftx: Rank.ShiftX,
    shift_y: Rank.ShiftY,
    shifty: Rank.ShiftY,
    shift_z: Rank.ShiftZ,
    shiftz: Rank.ShiftZ,
    class_1000: Rank.Class1000,
    class1000: Rank.Class1000,
    class_3000: Rank.Class3000,
    class3000: Rank.Class3000,
    class_5000: Rank.Class5000,
    class5000: Rank.Class5000,
    beyond: Rank.Beyond,
    // Shorthand abbreviations
    s0: Rank.Shift0,
    "0": Rank.Shift0,
    fe: Rank.Feeble,
    pr: Rank.Poor,
    ty: Rank.Typical,
    gd: Rank.Good,
    ex: Rank.Excellent,
    rm: Rank.Remarkable,
    in: Rank.Incredible,
    am: Rank.Amazing,
    mn: Rank.Monstrous,
    un: Rank.Unearthly,
    x: Rank.ShiftX,
    y: Rank.ShiftY,
    z: Rank.ShiftZ,
    "1000": Rank.Class1000,
    "3000": Rank.Class3000,
    "5000": Rank.Class5000,
    b: Rank.Beyond
  };
  return rankMap[rankStr.toLowerCase()] || Rank.Typical;
}

/**
 * Parse rank from charman data (could be rank name, number, or object)
 */
export function parseRankFromCharman(rankData: any): {
  rank: Rank;
  value: number;
  bonus: number;
} {
  // Handle object format from API: { rank: "unearthly", value: 100, bonus: 0 }
  if (typeof rankData === "object" && rankData !== null) {
    const bonus = rankData.bonus !== undefined ? Number(rankData.bonus) : 0;

    // If rank field is numeric, always use it (it's the actual stat value)
    if (rankData.rank !== undefined) {
      const rankStr = String(rankData.rank);
      if (!isNaN(Number(rankStr))) {
        // Rank is numeric - this is the stat value
        const value = Number(rankStr);
        return { rank: valueToRank(value), value, bonus };
      }
    }

    // If rank is a name and value exists, use value
    if (rankData.value !== undefined && !isNaN(Number(rankData.value))) {
      const value = Number(rankData.value);
      return { rank: valueToRank(value), value, bonus };
    }

    // Fall back to rank name
    if (rankData.rank !== undefined) {
      const rank = stringToRank(String(rankData.rank));
      return { rank, value: getRankValue(rank), bonus };
    }
  }

  if (typeof rankData === "string") {
    // Check if it's a numeric string
    if (!isNaN(Number(rankData))) {
      const value = Number(rankData);
      return { rank: valueToRank(value), value, bonus: 0 };
    }
    // It's a rank name
    const rank = stringToRank(rankData);
    return { rank, value: getRankValue(rank), bonus: 0 };
  } else if (typeof rankData === "number") {
    // It's a numerical value
    return { rank: valueToRank(rankData), value: rankData, bonus: 0 };
  }

  return { rank: Rank.Typical, value: 6, bonus: 0 };
}

/**
 * Generate nanoid for unique IDs
 */
export function nanoid(size: number = 21): string {
  const alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const randomValues = new Uint8Array(size);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < size; i++) {
    id += alphabet[randomValues[i] % alphabet.length];
  }
  return id;
}
