/**
 * Shared TypeScript interfaces for the FASERIP system
 */

/**
 * Represents a character talent with bonuses and descriptions
 */
export interface Talent {
  id: string;
  name: string;
  bonus: number;
  description?: string;
}

/**
 * Represents a selected talent in dialogs
 */
export interface SelectedTalent {
  name: string;
  bonus: number;
}

/**
 * Represents a character power with rank and description
 */
export interface Power {
  id: string;
  name: string;
  rank: string;
  category?: string;
  value: number;
  description?: string;
}

/**
 * Represents a character attribute with rank and value
 */
export interface AttributeData {
  rank: string;
  value: number;
  bonus?: number;
}

/**
 * Represents a character form/alternate identity
 */
export interface Form {
  id: string;
  name: string;
  isPrimary: boolean;
  attributes: {
    fighting: AttributeData;
    agility: AttributeData;
    strength: AttributeData;
    endurance: AttributeData;
    reasoning: AttributeData;
    intuition: AttributeData;
    psyche: AttributeData;
    [key: string]: AttributeData; // Index signature for dynamic access
  };
}
