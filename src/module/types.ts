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
  formIds?: string[]; // Form IDs this talent applies to; empty = all forms
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
  mpCost?: number; // Mental Points cost (houserule: MP system)
  formIds?: string[]; // Form IDs this power applies to; empty = all forms
  skipDialogs?: boolean; // Roll directly without talent/combo dialogs
}

/**
 * Represents a character attribute with rank and value
 */
export interface AttributeData {
  rank: string;
  value: number;
}

/**
 * Represents a piece of armor that can be equipped
 */
export interface ArmorItem {
  id: string;
  name: string;
  rank: string; // FASERIP rank string
  value: number; // Numeric rank value — used for damage reduction
  equipped: boolean;
  description?: string;
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
