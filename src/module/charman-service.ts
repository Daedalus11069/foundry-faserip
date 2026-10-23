import {
  parseRankFromCharman,
  nanoid,
  valueToRank,
  stringToRank,
  getRankValue
} from "./utils";
import { Rank } from "./enums";
import {
  buildSelectivePayload,
  buildSyncDiff,
  normalizeDamageTypes,
  type SyncDecisions,
  type SyncDiff
} from "./charman-sync-diff";
import {
  clearCharmanItemErrors,
  setCharmanItemError,
  type CharmanErrorSection
} from "./charman-errors";

/**
 * Configuration for Charman API
 */
/**
 * Charman stores ranks as a short code ("in") or a numeric score (40); Foundry
 * needs the Rank enum value. Blank becomes null.
 */
function toRankKey(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isNaN(Number(value))) return valueToRank(Number(value));
  return stringToRank(String(value));
}

export interface CharmanMassEffect {
  enabled: boolean;
  scope: "area" | "targets";
  baseRangeFeet: number;
  falloffFeet: number;
  includeSelf: boolean;
  resistAttribute: string;
  resistResult: "green" | "yellow" | "red";
}

function normalizeMassEffect(raw: any): CharmanMassEffect {
  return {
    enabled: !!raw?.enabled,
    scope: raw?.scope === "targets" ? "targets" : "area",
    baseRangeFeet: Math.max(0, Math.round(Number(raw?.baseRangeFeet ?? 20))),
    falloffFeet: Math.max(0, Math.round(Number(raw?.falloffFeet ?? 20))),
    includeSelf: !!raw?.includeSelf,
    resistAttribute: raw?.resistAttribute || "",
    resistResult: ["yellow", "red"].includes(raw?.resistResult)
      ? raw.resistResult
      : "green"
  };
}

/** A Charman weapon's types for a Foundry weapon item, where an empty list means Physical. */
function weaponDamageTypes(raw: any): string[] {
  const types = normalizeDamageTypes(raw);
  return types.length ? types : ["physical"];
}

function normalizeAreaOfEffect(raw: any): CharmanWeaponAreaOfEffect {
  return {
    enabled: raw?.enabled ?? false,
    shape: raw?.shape ?? "circle",
    size: raw?.size ?? 10,
    width: raw?.width ?? 5,
    angle: raw?.angle ?? 53,
    color: raw?.color ?? "#ff0000",
    durationRounds: raw?.durationRounds ?? "",
    remotePlaced: raw?.remotePlaced ?? false,
    instant: raw?.instant ?? false,
    maxRangeFeet: Math.max(0, Number(raw?.maxRangeFeet) || 0)
  };
}

/** Rank-normalize a Charman DoT list (damage rank and armor piercing). */
function normalizeDots(dots: any[] | undefined): any[] {
  return (dots || []).map(d => ({
    ...d,
    rank: toRankKey(d.rank) ?? "",
    armorPiercing: toRankKey(d.armorPiercing) ?? ""
  }));
}

/**
 * Turn an HTTP failure into a readable message, preferring Charman's own
 * `message` and field-level validation errors when it supplied them.
 */
export function describeHttpFailure(status: number, data: any): string {
  if (status === 401 || status === 403) {
    return "Authentication failed - check the Charman API key";
  }
  if (status === 422 && data?.errors) {
    const details = Object.entries(data.errors)
      .slice(0, 5)
      .map(([field, msgs]) => `${field}: ${([] as string[]).concat(msgs as any).join(" ")}`)
      .join("<br>");
    return `Charman rejected the data<br>${details}`;
  }
  if (data?.message && String(data.message).trim()) return data.message;
  if (status >= 500) return `Charman server error (${status})`;
  return status ? `Request failed (${status})` : "";
}

/**
 * Normalise a thrown value into a message. A bare fetch TypeError
 * ("Failed to fetch") says nothing useful, so explain the likely causes.
 */
export function describeCharmanError(error: unknown, baseUrl?: string): string {
  if (error instanceof TypeError) {
    return `Could not reach Charman${baseUrl ? ` at ${baseUrl}` : ""} - check the API URL setting, that the server is running, and that it allows requests from Foundry (CORS)`;
  }
  return error instanceof Error ? error.message : String(error);
}

const recentErrors = new Map<string, number>();

/**
 * Log and show a persistent error notification. Identical messages within a
 * few seconds are collapsed so a burst of failing background syncs does not
 * stack a wall of toasts.
 */
export function notifyCharmanError(
  context: string,
  error: unknown,
  baseUrl?: string
): void {
  const message = `${context}: ${describeCharmanError(error, baseUrl)}`;
  console.error(`[Charman] ${context}`, error);
  const now = Date.now();
  if (now - (recentErrors.get(message) ?? 0) < 5000) return;
  recentErrors.set(message, now);
  ui.notifications?.error(message, { permanent: true });
}

export interface CharmanConfig {
  baseUrl: string;
  apiPath?: string;
  apiKey?: string;
}

/**
 * Charman character data structure (matches the Laravel model)
 */
export interface CharmanCharacter {
  id: number;
  owner_id: number;
  name: string;
  callname: string;
  image?: string;
  tokenImage?: string; // Token image (if no forms present, applies to base form)
  tokenWidth?: number; // Token width in grid squares (default: 1)
  tokenHeight?: number; // Token height in grid squares (default: 1)
  tokenScale?: number; // Token scale multiplier (default: 1)
  visionSources?: CharmanVisionSource[]; // Vision methods (base form's, used when no per-form forms array)
  forms: CharmanForm[];
  fighting: any;
  agility: any;
  strength: any;
  endurance: any;
  reasoning: any;
  intuition: any;
  psyche: any;
  powers: CharmanPower[];
  talents: CharmanTalent[];
  equipment: CharmanEquipment[];
  armors: CharmanArmor[]; // Equippable armor items
  weapons: CharmanWeapon[]; // Weapon definitions with damage and stats
  contacts: CharmanContact[];
  biography?: string;
  notes?: string;
  karma?: number;
  mentalpoints?: number; // Mental Points for psionics, etc.
  weaponSlots?: number; // Number of weapon-bearing arms (default: 2)
}

export interface CharmanVisionSource {
  type?: string; // "sight:<visionModeKey>" | "detect:<detectionModeKey>", default "sight:basic"
  rangeSource?: "flat" | "intuition" | "power"; // default "flat"
  flatRange?: number; // used when rangeSource is "flat"
  powerName?: string; // name of the power to derive range from, used when rangeSource is "power"
}

export interface CharmanForm {
  name: string;
  description?: string;
  tokenImage?: string; // Token image path for this form
  tokenWidth?: number; // Token width in grid squares (default: 1)
  tokenHeight?: number; // Token height in grid squares (default: 1)
  tokenScale?: number; // Token scale multiplier (default: 1)
  visionSources?: CharmanVisionSource[]; // Vision methods for this form (e.g. Basic Sight + Tremorsense)
  fighting: any;
  agility: any;
  strength: any;
  endurance: any;
  reasoning: any;
  intuition: any;
  psyche: any;
}

export interface CharmanPowerStatDebuff {
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

export interface CharmanPowerDamageBuff {
  enabled: boolean;
  greenShift: number;
  yellowShift: number;
  redShift: number;
  durationFormula: string;
}

export interface CharmanPowerDot {
  enabled: boolean;
  rank: string;
  armorPiercing?: string;
  durationFormula: string;
}

export interface CharmanPowerStatusEffect {
  enabled: boolean;
  statusId: string;
  durationFormula: string;
}

export interface CharmanPower {
  name: string;
  rank: string | number | Record<string, string | number>; // Can be simple rank, numeric value, or form-specific ranks
  description?: string;
  category?: string;
  mpCost?: string | number; // Mental Points cost
  value?: number; // Current armor value (for Body Armor power when degrading enabled)
  maxValue?: number; // Maximum armor value (for Body Armor power when degrading enabled)
  effectType?: "none" | "damage" | "heal-health" | "heal-armor"; // What effect this power has (uses power's rank)
  attackType?: "none" | "melee" | "ranged" | "psyche"; // Attack type for defense attribute selection
  damageType?: string; // Legacy single type; Charman keeps it equal to damageTypes[0]
  damageTypes?: string[]; // Every type of damage dealt (fire, cold, etc.) - each receives the full amount
  skipDialogs?: boolean; // Roll directly without the talent/combo dialogs
  resistanceType?: string; // Type of damage this power resists (for resistance powers)
  vulnerabilityType?: string; // Type of damage this power is weak to (for vulnerability/weakness powers)
  multiHit?: boolean; // True for AoE/multi-target powers (one roll, no combo penalty)
  armorPiercing?: string | null; // Armor-piercing rank (optional)
  leechPercent?: number; // Life-link/leech: % of health damage dealt that heals the attacker (0-100)
  targetType?: "any" | "others" | "self"; // Who this power can target
  statDebuffs?: CharmanPowerStatDebuff[]; // Temporary stat debuffs applied on hit
  damageBuffs?: CharmanPowerDamageBuff[]; // Temporary damage buffs/debuffs applied on hit
  dots?: CharmanPowerDot[]; // Damage-over-time effects applied on hit
  statusEffects?: CharmanPowerStatusEffect[]; // Foundry status conditions (sleep, stun, prone, etc.) applied on hit
  isAura?: boolean; // Spawns a region attached to the owner's token that (de)buffs actors inside instead of applying on-hit
  auraDisposition?: "ally" | "enemy" | "any"; // Who the aura affects, relative to the owner token's disposition
  auraIncludeSelf?: boolean; // Whether the owner is affected by their own aura
  auraRange?: number; // Radius in scene distance units (e.g. feet); 0/unset falls back to the rank-based movement table
  massEffect?: CharmanMassEffect; // Affects everyone in range / all targets with a resist roll
  areaOfEffect?: CharmanWeaponAreaOfEffect; // Region placed on hit, or dragged onto the canvas when remotePlaced
  grantsArmor?: boolean; // Grants an armor layer soaking armorTypes at the power's value
  armorTypes?: string[];
  armorLayer?: number;
  armorToggle?: boolean; // Layer only applies while switched on in Foundry
  armorBlocksAttacks?: boolean; // Owner can't attack while the layer is active
  blendIn?: boolean; // Lets the owner hide their token from other players' clients; spotting difficulty scales with distance based on this power's rank
  blendInDurationFormula?: string; // Blank/"indefinite" = stays active until manually toggled off; otherwise rolled once on activation and ticks down each combat round
  isLifeLink?: boolean; // Bonds the owner to a target selected on cast, redirecting a % of health damage between them while the target stays within the aura's range
  lifeLinkPercent?: number; // % of health damage redirected by the life-link bond (0-100)
  lifeLinkDirection?: "protect" | "share"; // "protect": owner soaks damage for the target. "share": owner offloads their own damage onto the target
}

export interface CharmanTalent {
  name: string;
  bonus: number;
  description?: string;
  grantsDualWield?: boolean; // Grants the ability to wield two weapons simultaneously
}

export interface CharmanEquipment {
  name: string;
  description?: string;
  quantity?: number;
}

export interface CharmanArmor {
  name: string;
  rank: string; // FASERIP rank string
  value: number; // Current armor value (damage reduction)
  maxValue: number; // Maximum armor value (used when degrading enabled)
  equipped: boolean;
  description?: string;
  formNames?: string[]; // Form names this armor is active in; empty = all forms
}

export interface CharmanWeapon {
  name: string;
  type: "ranged" | "melee" | "thrown"; // Weapon type determines which stat is used for to-hit
  damage: string | number | null | undefined; // Damage rank string (e.g., "Typical"), numeric score (e.g., 30), or null/undefined (will default based on type)
  stat: "agility" | "fighting"; // Stat used for to-hit rolls
  applicableTalent?: string; // Name of talent that applies to this weapon
  damageTypes?: string[]; // Every type of damage dealt - each receives the full amount; empty = Physical
  description?: string;
  equipped?: boolean;
  multiHit?: boolean; // True for AoE/multi-target weapons (one roll, no combo penalty)
  statDebuffs?: CharmanPowerStatDebuff[]; // Temporary stat debuffs applied on hit
  damageBuffs?: CharmanPowerDamageBuff[]; // Temporary damage buffs/debuffs applied on hit
  armorPiercing?: string | number | null; // Armor-piercing rank (short code or score)
  dots?: CharmanPowerDot[]; // Damage-over-time effects applied on hit
  statusEffects?: CharmanPowerStatusEffect[]; // Foundry status conditions (sleep, stun, prone, etc.) applied on hit
  areaOfEffect?: CharmanWeaponAreaOfEffect; // Region template placed centered on the target on hit
}

export interface CharmanWeaponAreaOfEffect {
  enabled: boolean;
  shape: "circle" | "cone" | "ray" | "rect";
  size: number;
  width: number;
  angle: number;
  color: string;
  durationRounds: string;
  remotePlaced?: boolean; // Dragged onto the canvas instead of centered on a hit target
  instant?: boolean; // Leaves no region behind; the shape only decides who is hit
  maxRangeFeet?: number; // Remote placement only; 0 = unlimited
}

export interface CharmanContact {
  name: string;
  relationship?: string;
  description?: string;
}

/**
 * Sync details for consolidated notifications
 */
interface SyncDetails {
  imagesUploaded: number;
  formsProcessed: number;
  powersLoaded: number;
  talentsLoaded: number;
  weaponsLoaded: number;
  armorsLoaded: number;
  warnings: string[];
}

/**
 * Service for interacting with Charman API
 */
export class CharmanService {
  private config: CharmanConfig;

  constructor(config: CharmanConfig) {
    this.config = config;
  }

  /**
   * Fetch a character by username and character name
   */
  async fetchCharacter(
    username: string,
    characterName: string
  ): Promise<CharmanCharacter | null> {
    try {
      // Build the API URL for Foundry-specific endpoint
      const apiPath = this.config.apiPath || "/charman/api/foundry";
      const url = `${this.config.baseUrl}${apiPath}/character?username=${encodeURIComponent(username)}&callname=${encodeURIComponent(characterName)}`;

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        }
      });

      if (!response.ok) {
        // Provide better default message based on status code
        let errorMessage = "Character not found";
        if (response.status === 404) {
          errorMessage = `Character "${characterName}" not found for user "${username}"`;
        } else if (response.status === 401 || response.status === 403) {
          errorMessage = "Authentication failed - check API key";
        } else if (response.status >= 500) {
          errorMessage = "Server error - please try again later";
        } else {
          errorMessage = `Request failed (${response.status})`;
        }

        let availableCharacters: string[] | undefined;

        try {
          const errorData = await response.json();
          // Only use API message if it's not empty and provides more info
          if (errorData.message && errorData.message.trim()) {
            errorMessage = errorData.message;
          }
          if (
            errorData.available_characters &&
            Array.isArray(errorData.available_characters)
          ) {
            availableCharacters = errorData.available_characters;
          }
        } catch {
          // Failed to parse error response, use default message
        }

        // Create error with available characters attached
        const error = new Error(errorMessage) as Error & {
          availableCharacters?: string[];
        };
        if (availableCharacters) {
          error.availableCharacters = availableCharacters;
        }
        throw error;
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching character from Charman:", error);
      // Re-throw (with a readable message for network failures) so callers can notify
      if (error instanceof TypeError) {
        throw new Error(describeCharmanError(error, this.config.baseUrl));
      }
      throw error;
    }
  }

  /**
   * List all characters for a user
   */
  async listCharacters(username: string): Promise<CharmanCharacter[]> {
    try {
      const apiPath = this.config.apiPath || "/charman/api/foundry";
      const url = `${this.config.baseUrl}${apiPath}/characters?username=${encodeURIComponent(username)}`;

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to list characters: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      notifyCharmanError(
        "Could not list Charman characters",
        error,
        this.config.baseUrl
      );
      return [];
    }
  }

  /**
   * Upload a remote image to Foundry's user data directory
   * @param imageUrl - URL of the remote image to upload
   * @param characterName - Character name for generating filename
   * @param existingImagePath - Optional existing image path to reuse filename (overwrites old file)
   */
  async uploadRemoteImage(
    imageUrl: string,
    characterName: string,
    existingImagePath?: string
  ): Promise<string | null> {
    try {
      // Fetch the remote image
      const response = await fetch(imageUrl, {
        headers: {
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      // Get the image as a blob
      const blob = await response.blob();

      // Extract file extension from URL or content type
      let extension = imageUrl.split(".").pop()?.split("?")[0] || "png";
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("jpeg") || contentType?.includes("jpg")) {
        extension = "jpg";
      } else if (contentType?.includes("png")) {
        extension = "png";
      } else if (contentType?.includes("webp")) {
        extension = "webp";
      }

      // Determine filename: reuse existing if provided, otherwise generate new
      let filename: string;
      if (
        existingImagePath &&
        !existingImagePath.startsWith("icons/") &&
        !existingImagePath.startsWith("http://") &&
        !existingImagePath.startsWith("https://")
      ) {
        // Extract filename from existing path (e.g., "worlds/xyz/actors/art_123.png" -> "art_123.png")
        filename =
          existingImagePath.split("/").pop() ||
          `${characterName}_${Date.now()}.${extension}`;
      } else {
        // Create a new filename based on character name
        const sanitizedName = characterName
          .replace(/[^a-z0-9]/gi, "_")
          .toLowerCase();
        filename = `${sanitizedName}_${Date.now()}.${extension}`;
      }

      // Create a File object from the blob
      const file = new File([blob], filename, { type: blob.type });

      // Ensure the actors directory exists
      const actorsPath = `worlds/${(game as any).world.id}/actors`;
      try {
        // Try to browse the directory to check if it exists
        // @ts-expect-error - FilePicker types may be incomplete
        await foundry.applications.apps.FilePicker.implementation.browse(
          "data",
          actorsPath
        );
      } catch (error) {
        // Directory doesn't exist, create it
        try {
          // @ts-expect-error - FilePicker types may be incomplete
          await foundry.applications.apps.FilePicker.implementation.createDirectory(
            "data",
            actorsPath,
            {}
          );
        } catch (createError) {
          console.error("Failed to create actors directory:", createError);
          throw new Error("Could not create upload directory");
        }
      }

      // Upload to Foundry's user data directory
      const uploadResult =
        // @ts-expect-error - FilePicker.implementation.upload is not in typings
        await foundry.applications.apps.FilePicker.implementation.upload(
          "data",
          actorsPath,
          file,
          {},
          { notify: false }
        );

      return uploadResult.path;
    } catch (error) {
      notifyCharmanError("Could not upload Charman image", error);
      return null;
    }
  }

  /**
   * Convert Charman character data to Foundry actor data
   * @param charmanChar - Character data from Charman API
   * @param existingImagePath - Optional existing image path to reuse filename
   */
  async convertToActorData(
    charmanChar: CharmanCharacter,
    existingImagePath?: string
  ): Promise<{ actorData: any; syncDetails: SyncDetails }> {
    const syncDetails: SyncDetails = {
      imagesUploaded: 0,
      formsProcessed: 0,
      powersLoaded: 0,
      talentsLoaded: 0,
      weaponsLoaded: 0,
      armorsLoaded: 0,
      warnings: []
    };

    // Upload remote image if present
    let imageUrl = "icons/svg/mystery-man.svg"; // Default fallback

    if (
      charmanChar.image &&
      (charmanChar.image.startsWith("http://") ||
        charmanChar.image.startsWith("https://"))
    ) {
      try {
        const uploadedPath = await this.uploadRemoteImage(
          charmanChar.image,
          charmanChar.callname,
          existingImagePath
        );
        if (uploadedPath) {
          imageUrl = uploadedPath;
          syncDetails.imagesUploaded++;
        } else {
          console.warn("Image upload returned null, using default icon");
          syncDetails.warnings.push(
            "Character image could not be uploaded; using the default icon"
          );
        }
      } catch (error) {
        console.warn(
          "Failed to upload remote image, using default icon:",
          error
        );
        // Use default mystery-man icon if upload fails
        // (Remote URLs without file extensions fail Foundry validation)
      }
    }

    // Convert forms
    const forms =
      charmanChar.forms && charmanChar.forms.length > 0
        ? await Promise.all(
            charmanChar.forms.map(async (form: any, index: number) => {
              // Handle both nested attributes object and flat structure
              const attrs = form.attributes || form;

              // Upload token image if it's a remote URL
              let tokenImagePath = form.tokenImage || "";
              if (
                tokenImagePath &&
                (tokenImagePath.startsWith("http://") ||
                  tokenImagePath.startsWith("https://"))
              ) {
                try {
                  const uploadedPath = await this.uploadRemoteImage(
                    tokenImagePath,
                    `${charmanChar.callname}_${form.name}_token`,
                    undefined
                  );
                  if (uploadedPath) {
                    tokenImagePath = uploadedPath;
                    syncDetails.imagesUploaded++;
                  } else {
                    syncDetails.warnings.push(
                      `Token image for form "${form.name}" could not be uploaded`
                    );
                  }
                } catch (error) {
                  console.warn(
                    `Failed to upload token image for form "${form.name}":`,
                    error
                  );
                  // Keep original URL if upload fails
                }
              }

              return {
                id: form.id || nanoid(),
                name: form.name || `Form ${index + 1}`,
                isPrimary:
                  form.isPrimary !== undefined ? form.isPrimary : index === 0,
                tokenImage: tokenImagePath,
                tokenWidth: form.tokenWidth || 1,
                tokenHeight: form.tokenHeight || 1,
                tokenScale: form.tokenScale || 1,
                weaponSlots: form.weaponSlots ?? undefined,
                visionSources: (form.visionSources || []).map((vs: CharmanVisionSource) => ({
                  id: nanoid(),
                  type: vs.type || "sight:basic",
                  rangeSource: vs.rangeSource || "flat",
                  flatRange: vs.flatRange || 0,
                  powerName: vs.powerName || ""
                })),
                attributes: {
                  fighting: parseRankFromCharman(attrs.fighting),
                  agility: parseRankFromCharman(attrs.agility),
                  strength: parseRankFromCharman(attrs.strength),
                  endurance: parseRankFromCharman(attrs.endurance),
                  reasoning: parseRankFromCharman(attrs.reasoning),
                  intuition: parseRankFromCharman(attrs.intuition),
                  psyche: parseRankFromCharman(attrs.psyche)
                }
              };
            })
          )
        : await (async () => {
            // Upload base form token image if it's a remote URL
            let baseTokenImagePath = charmanChar.tokenImage || "";
            if (
              baseTokenImagePath &&
              (baseTokenImagePath.startsWith("http://") ||
                baseTokenImagePath.startsWith("https://"))
            ) {
              try {
                const uploadedPath = await this.uploadRemoteImage(
                  baseTokenImagePath,
                  `${charmanChar.callname}_base_token`,
                  undefined
                );
                if (uploadedPath) {
                  baseTokenImagePath = uploadedPath;
                  syncDetails.imagesUploaded++;
                } else {
                  syncDetails.warnings.push(
                    "Base form token image could not be uploaded"
                  );
                }
              } catch (error) {
                console.warn(`Failed to upload base form token image:`, error);
                // Keep original URL if upload fails
              }
            }

            return [
              {
                id: nanoid(),
                name: "Base Form",
                isPrimary: true,
                tokenImage: baseTokenImagePath,
                tokenWidth: charmanChar.tokenWidth || 1,
                tokenHeight: charmanChar.tokenHeight || 1,
                tokenScale: charmanChar.tokenScale || 1,
                visionSources: (charmanChar.visionSources || []).map(vs => ({
                  id: nanoid(),
                  type: vs.type || "sight:basic",
                  rangeSource: vs.rangeSource || "flat",
                  flatRange: vs.flatRange || 0,
                  powerName: vs.powerName || ""
                })),
                attributes: {
                  fighting: parseRankFromCharman(charmanChar.fighting),
                  agility: parseRankFromCharman(charmanChar.agility),
                  strength: parseRankFromCharman(charmanChar.strength),
                  endurance: parseRankFromCharman(charmanChar.endurance),
                  reasoning: parseRankFromCharman(charmanChar.reasoning),
                  intuition: parseRankFromCharman(charmanChar.intuition),
                  psyche: parseRankFromCharman(charmanChar.psyche)
                }
              }
            ];
          })();

    // Convert powers
    const powers = (charmanChar.powers || []).map((power: CharmanPower) => {
      let rankName: string;
      let formIds: string[] = [];

      // Handle form-specific ranks (object format like {"Dragon": "50"})
      if (typeof power.rank === "object" && power.rank !== null) {
        // Get all form-specific rank values
        const formRanks = Object.entries(power.rank);

        // Find highest rank value to use as default
        let highestValue = 0;
        for (const [, rankValue] of formRanks) {
          const numValue = Number(rankValue);
          if (!isNaN(numValue) && numValue > highestValue) {
            highestValue = numValue;
          }
        }

        // Convert to rank name
        rankName = highestValue > 0 ? valueToRank(highestValue) : "typical";

        // Map form names to form IDs
        formIds = formRanks
          .map(([formName]) => {
            const form = forms.find(f => f.name === formName);
            return form?.id;
          })
          .filter((id): id is string => id !== undefined);
      } else {
        // Handle simple rank (string or number)
        if (!isNaN(Number(power.rank))) {
          rankName = valueToRank(Number(power.rank));
        } else {
          rankName = String(power.rank);
        }
        // No formIds means applies to all forms
        formIds = [];
      }

      return {
        id: nanoid(),
        name: power.name,
        rank: rankName,
        category: power.category || "general",
        description: power.description || "",
        formIds: formIds,
        mpCost: power.mpCost ? Number(power.mpCost) : 0,
        effectType: power.effectType || "none",
        attackType: power.attackType || "none",
        damageType: normalizeDamageTypes(power)[0] ?? "none",
        damageTypes: normalizeDamageTypes(power),
        skipDialogs: power.skipDialogs || false,
        resistanceType: power.resistanceType || undefined,
        vulnerabilityType: power.vulnerabilityType || undefined,
        multiHit: power.multiHit || false,
        armorPiercing: toRankKey(power.armorPiercing),
        leechPercent: power.leechPercent || 0,
        targetType: power.targetType || "any",
        statDebuffs: (power.statDebuffs || []).map(sd => ({
          enabled: sd.enabled ?? false,
          attribute: sd.attribute,
          greenShift: sd.greenShift ?? 0,
          yellowShift: sd.yellowShift ?? 0,
          redShift: sd.redShift ?? 0,
          durationFormula: sd.durationFormula ?? ""
        })),
        damageBuffs: (power.damageBuffs || []).map(db => ({
          enabled: db.enabled ?? false,
          greenShift: db.greenShift ?? 0,
          yellowShift: db.yellowShift ?? 0,
          redShift: db.redShift ?? 0,
          durationFormula: db.durationFormula ?? ""
        })),
        dots: (power.dots || []).map(d => ({
          enabled: d.enabled ?? false,
          rank: toRankKey(d.rank) ?? "",
          armorPiercing: toRankKey(d.armorPiercing) ?? "",
          durationFormula: d.durationFormula ?? ""
        })),
        statusEffects: (power.statusEffects || []).map(se => ({
          enabled: se.enabled ?? false,
          statusId: se.statusId ?? "",
          durationFormula: se.durationFormula ?? ""
        })),
        isAura: power.isAura || false,
        auraDisposition: power.auraDisposition || "any",
        auraIncludeSelf: power.auraIncludeSelf || false,
        auraRange: power.auraRange || 0,
        massEffect: normalizeMassEffect(power.massEffect),
        areaOfEffect: normalizeAreaOfEffect(power.areaOfEffect),
        grantsArmor: power.grantsArmor || false,
        armorTypes: Array.isArray(power.armorTypes) ? power.armorTypes : [],
        armorLayer: power.armorLayer ?? 1,
        armorToggle: power.armorToggle || false,
        armorBlocksAttacks: power.armorBlocksAttacks || false,
        blendIn: power.blendIn || false,
        blendInDurationFormula: power.blendInDurationFormula || "",
        isLifeLink: power.isLifeLink || false,
        lifeLinkPercent: power.lifeLinkPercent || 0,
        lifeLinkDirection: power.lifeLinkDirection || "protect",
        value: power.value || getRankValue(rankName),
        maxValue: power.maxValue || getRankValue(rankName)
      };
    });

    // Resolve each vision source's power reference (by name, since power IDs
    // are regenerated on every import) to the newly-created power's ID.
    for (const form of forms as any[]) {
      for (const vs of form.visionSources || []) {
        const powerName = vs.powerName as string;
        if (powerName) {
          const matchedPower = powers.find(
            p => p.name.trim().toLowerCase() === powerName.trim().toLowerCase()
          );
          vs.powerId = matchedPower?.id || "";
        } else {
          vs.powerId = "";
        }
        delete vs.powerName;
      }
    }

    // Convert talents
    const talents = (charmanChar.talents || []).map(
      (talent: CharmanTalent) => ({
        id: nanoid(),
        name: talent.name,
        bonus: Number(talent.bonus) || 0,
        description: talent.description || "",
        grantsDualWield: talent.grantsDualWield || false
      })
    );

    // Calculate initial health from first form's FASE attributes (Fighting + Agility + Strength + Endurance)
    const firstForm = forms[0];
    const initialHealth =
      firstForm.attributes.fighting.value +
      firstForm.attributes.agility.value +
      firstForm.attributes.strength.value +
      firstForm.attributes.endurance.value;

    // Name is the main character name (displayed as actor name)
    // Callname is the civilian/call name (displayed below as smaller text)
    const actorName = charmanChar.name || "Unknown Character";

    // Get primary form for token settings
    const primaryForm = forms.find(f => f.isPrimary) || forms[0];
    const tokenTextureSrc = primaryForm.tokenImage || imageUrl;
    const tokenWidth = primaryForm.tokenWidth || 1;
    const tokenHeight = primaryForm.tokenHeight || 1;
    const tokenScale = primaryForm.tokenScale || 1;

    // Track loaded data
    syncDetails.formsProcessed = forms.length;
    syncDetails.powersLoaded = powers.length;
    syncDetails.talentsLoaded = talents.length;
    syncDetails.weaponsLoaded = (charmanChar.weapons || []).length;
    syncDetails.armorsLoaded = (charmanChar.armors || []).length;

    const actorData = {
      name: actorName,
      type: "pc",
      img: imageUrl,
      prototypeToken: {
        texture: {
          src: tokenTextureSrc,
          scaleX: tokenScale,
          scaleY: tokenScale
        },
        width: tokenWidth,
        height: tokenHeight,
        sight: {
          enabled: true
        },
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        bar1: {
          attribute: "resources.health"
        },
        bar2: {
          attribute: "resources.armor"
        }
      },
      system: {
        currentFormId: forms[0].id,
        forms,
        callname: charmanChar.callname || "",
        resources: {
          health: {
            value: initialHealth,
            max: initialHealth
          },
          karma: {
            value: charmanChar.karma ?? 0
          }
        },
        biography: charmanChar.biography || "",
        notes: charmanChar.notes || "",
        publicNotes: "",
        gmNotes: "",
        weaponSlots: charmanChar.weaponSlots ?? 2,
        powers,
        talents,
        armors: (charmanChar.armors || []).map((armor: CharmanArmor) => ({
          id: nanoid(),
          name: armor.name,
          rank: armor.rank,
          value: armor.value,
          maxValue: armor.maxValue,
          equipped: armor.equipped,
          description: armor.description || "",
          formIds: (armor.formNames || [])
            .map(formName => {
              const form = forms.find(f => f.name === formName);
              return form?.id;
            })
            .filter((id): id is string => id !== undefined)
        })),
        weapons: (charmanChar.weapons || []).map((weapon: CharmanWeapon) => {
          let damage: string | number;

          if (weapon.type === "melee" || weapon.type === "thrown") {
            // Melee/thrown weapons: damage should be CS (number)
            if (weapon.damage === null || weapon.damage === undefined) {
              // Null/undefined - default to 0 CS
              damage = 0;
            } else if (typeof weapon.damage === "number") {
              // Already a number, treat as CS
              damage = weapon.damage;
            } else {
              // String rank from old format - parse to number or default to 0
              const parsed = parseInt(String(weapon.damage), 10);
              damage = isNaN(parsed) ? 0 : parsed;
            }
          } else {
            // Ranged weapons: damage should be rank string
            if (weapon.damage === null || weapon.damage === undefined) {
              // Null/undefined - default to Typical rank
              damage = Rank.Typical;
            } else if (typeof weapon.damage === "number") {
              // Numeric score - convert to rank
              damage = valueToRank(weapon.damage);
            } else {
              // Already a rank string
              damage = weapon.damage;
            }
          }

          return {
            id: nanoid(),
            name: weapon.name,
            type: weapon.type,
            damage,
            // Derive stat from type rather than trusting Charman's stored
            // stat, which can go stale if the type is changed without
            // updating the (redundant) stat dropdown - melee uses Fighting,
            // ranged/thrown use Agility.
            stat: weapon.type === "melee" ? "fighting" : "agility",
            applicableTalents: weapon.applicableTalent
              ? [weapon.applicableTalent]
              : [],
            damageTypes: weaponDamageTypes(weapon),
            description: weapon.description || "",
            equipped: weapon.equipped || false,
            multiHit: weapon.multiHit || false,
            armorPiercing: toRankKey(weapon.armorPiercing) ?? "",
            statDebuffs: (weapon.statDebuffs || []).map(sd => ({
              enabled: sd.enabled ?? false,
              attribute: sd.attribute,
              greenShift: sd.greenShift ?? 0,
              yellowShift: sd.yellowShift ?? 0,
              redShift: sd.redShift ?? 0,
              durationFormula: sd.durationFormula ?? ""
            })),
            damageBuffs: (weapon.damageBuffs || []).map(db => ({
              enabled: db.enabled ?? false,
              greenShift: db.greenShift ?? 0,
              yellowShift: db.yellowShift ?? 0,
              redShift: db.redShift ?? 0,
              durationFormula: db.durationFormula ?? ""
            })),
            dots: (weapon.dots || []).map(d => ({
              enabled: d.enabled ?? false,
              rank: toRankKey(d.rank) ?? "",
              armorPiercing: toRankKey(d.armorPiercing) ?? "",
              durationFormula: d.durationFormula ?? ""
            })),
            statusEffects: (weapon.statusEffects || []).map(se => ({
              enabled: se.enabled ?? false,
              statusId: se.statusId ?? "",
              durationFormula: se.durationFormula ?? ""
            })),
            areaOfEffect: weapon.areaOfEffect
              ? normalizeAreaOfEffect(weapon.areaOfEffect)
              : undefined
          };
        }),
        charman: {
          characterId: charmanChar.id,
          username: "",
          characterName: charmanChar.callname || "",
          lastSync: Date.now(),
          autoSync: false
        }
      }
    };

    return { actorData, syncDetails };
  }

  private reportWarnings(syncDetails: SyncDetails): void {
    if (!syncDetails.warnings.length) return;
    ui.notifications?.warn(
      `Charman import completed with problems:<br>${syncDetails.warnings.join("<br>")}`,
      { permanent: true }
    );
  }

  /**
   * Import a character from Charman and create/update Foundry actor
   */
  async importCharacter(
    username: string,
    characterName: string,
    existingActor?: Actor
  ): Promise<Actor | null> {
    const charmanChar = await this.fetchCharacter(username, characterName);

    if (!charmanChar) {
      return null;
    }

    // Pass existing image path so we can reuse the filename (overwrites instead of creating duplicates)
    const { actorData, syncDetails } = await this.convertToActorData(
      charmanChar,
      // @ts-expect-error - Accessing system data for existing actor
      existingActor?.img
    );
    actorData.system.charman.username = username;
    actorData.system.charman.characterName = characterName;

    if (existingActor) {
      // Note: If the old image path was reused, uploadRemoteImage() overwrote it
      // No deletion needed - the new image replaced the old one automatically

      // Update existing actor - need to flatten system updates with dot notation
      const updateData: Record<string, any> = {
        name: actorData.name,
        img: actorData.img,
        "prototypeToken.texture.src": actorData.prototypeToken.texture.src,
        "prototypeToken.texture.scaleX":
          actorData.prototypeToken.texture.scaleX,
        "prototypeToken.texture.scaleY":
          actorData.prototypeToken.texture.scaleY,
        "prototypeToken.width": actorData.prototypeToken.width,
        "prototypeToken.height": actorData.prototypeToken.height,
        "system.currentFormId": actorData.system.currentFormId,
        "system.forms": actorData.system.forms,
        "system.callname": actorData.system.callname,
        "system.resources": actorData.system.resources,
        "system.biography": actorData.system.biography,
        "system.notes": actorData.system.notes,
        "system.powers": actorData.system.powers,
        "system.talents": actorData.system.talents,
        "system.weaponSlots": actorData.system.weaponSlots,
        "system.charman": actorData.system.charman,
        "system.armors": [], // Clear old armors array - Items are created below
        "system.weapons": [] // Clear old weapons array - Items are created below
      };

      await existingActor.update(updateData);

      // Smart sync: Update existing items by name, create new ones, delete obsolete ones

      // --- ARMOR SYNC ---
      const existingArmorItems = existingActor.items.filter(
        (item: any) => item.type === "armor"
      );
      const charmanArmors = actorData.system.armors || [];

      // Track which armors to delete (not in Charman data)
      const armorNamesToKeep = new Set(charmanArmors.map((a: any) => a.name));
      const armorIdsToDelete = existingArmorItems
        .filter((item: any) => !armorNamesToKeep.has(item.name))
        .map((item: any) => item.id);

      // Update existing armors or create new ones
      const armorUpdates: any[] = [];
      const armorCreates: any[] = [];

      for (const charmanArmor of charmanArmors) {
        const existingItem = existingArmorItems.find(
          (item: any) => item.name === charmanArmor.name
        );

        if (existingItem) {
          // Update existing armor
          armorUpdates.push({
            _id: existingItem.id,
            system: {
              rank: charmanArmor.rank,
              value: charmanArmor.value,
              maxValue: charmanArmor.maxValue,
              equipped: charmanArmor.equipped,
              description: charmanArmor.description
            }
          });
        } else {
          // Create new armor
          armorCreates.push({
            name: charmanArmor.name,
            type: "armor",
            system: {
              rank: charmanArmor.rank,
              value: charmanArmor.value,
              maxValue: charmanArmor.maxValue,
              equipped: charmanArmor.equipped,
              description: charmanArmor.description
            }
          });
        }
      }

      if (armorIdsToDelete.length > 0) {
        await existingActor.deleteEmbeddedDocuments("Item", armorIdsToDelete);
      }
      if (armorUpdates.length > 0) {
        await existingActor.updateEmbeddedDocuments("Item", armorUpdates);
      }
      if (armorCreates.length > 0) {
        await existingActor.createEmbeddedDocuments("Item", armorCreates);
      }

      // --- WEAPON SYNC ---
      const existingWeaponItems = existingActor.items.filter(
        (item: any) => item.type === "weapon"
      );
      const charmanWeapons = actorData.system.weapons || [];

      // Update existing weapons or create new ones. Characters can carry
      // multiple identically-named weapons (e.g. one per arm on a multi-armed
      // character), so matching must consume each existing item at most once
      // rather than re-matching the same name to the first item every time -
      // otherwise all same-named entries collapse onto a single Item and the
      // rest are silently dropped instead of created.
      const weaponUpdates: any[] = [];
      const weaponCreates: any[] = [];
      const claimedExistingIds = new Set<string>();

      for (const charmanWeapon of charmanWeapons) {
        const weaponType =
          charmanWeapon.type === "ranged" || charmanWeapon.type === "thrown"
            ? charmanWeapon.type
            : "melee";
        const isRanged = weaponType === "ranged" || weaponType === "thrown";

        const weaponData = {
          weaponType,
          damage: isRanged
            ? "0"
            : typeof charmanWeapon.damage === "number"
              ? String(charmanWeapon.damage)
              : "0",
          damageRank: isRanged
            ? typeof charmanWeapon.damage === "string"
              ? charmanWeapon.damage
              : Rank.Typical
            : Rank.Typical,
          equipped: charmanWeapon.equipped,
          description: charmanWeapon.description || "",
          talents: charmanWeapon.applicableTalents || [],
          damageTypes: weaponDamageTypes(charmanWeapon),
          multiHit: charmanWeapon.multiHit || false,
          armorPiercing: toRankKey(charmanWeapon.armorPiercing) ?? "",
          statDebuffs: charmanWeapon.statDebuffs || [],
          damageBuffs: charmanWeapon.damageBuffs || [],
          dots: normalizeDots(charmanWeapon.dots),
          statusEffects: charmanWeapon.statusEffects || [],
          areaOfEffect: charmanWeapon.areaOfEffect
        };

        const existingItem = existingWeaponItems.find(
          (item: any) =>
            item.name === charmanWeapon.name && !claimedExistingIds.has(item.id)
        );

        if (existingItem) {
          claimedExistingIds.add(existingItem.id!);
          // Update existing weapon
          weaponUpdates.push({
            _id: existingItem.id,
            system: weaponData
          });
        } else {
          // Create new weapon
          weaponCreates.push({
            name: charmanWeapon.name,
            type: "weapon",
            system: weaponData
          });
        }
      }

      // Delete any existing weapon items that Charman no longer accounts for -
      // either the name is gone entirely, or there were more same-named items
      // than Charman now sends (leftover duplicates).
      const weaponIdsToDelete = existingWeaponItems
        .filter((item: any) => !claimedExistingIds.has(item.id))
        .map((item: any) => item.id);

      if (weaponIdsToDelete.length > 0) {
        await existingActor.deleteEmbeddedDocuments("Item", weaponIdsToDelete);
      }
      if (weaponUpdates.length > 0) {
        await existingActor.updateEmbeddedDocuments("Item", weaponUpdates);
      }
      if (weaponCreates.length > 0) {
        await existingActor.createEmbeddedDocuments("Item", weaponCreates);
      }

      // Build consolidated notification message
      const messageParts = [`Updated ${actorData.name} from Charman`];
      if (syncDetails.imagesUploaded > 0) {
        messageParts.push(
          `${syncDetails.imagesUploaded} image${syncDetails.imagesUploaded > 1 ? "s" : ""} uploaded`
        );
      }
      const dataParts = [];
      if (syncDetails.formsProcessed > 0)
        dataParts.push(
          `${syncDetails.formsProcessed} form${syncDetails.formsProcessed > 1 ? "s" : ""}`
        );
      if (syncDetails.powersLoaded > 0)
        dataParts.push(
          `${syncDetails.powersLoaded} power${syncDetails.powersLoaded > 1 ? "s" : ""}`
        );
      if (syncDetails.talentsLoaded > 0)
        dataParts.push(
          `${syncDetails.talentsLoaded} talent${syncDetails.talentsLoaded > 1 ? "s" : ""}`
        );
      if (syncDetails.weaponsLoaded > 0)
        dataParts.push(
          `${syncDetails.weaponsLoaded} weapon${syncDetails.weaponsLoaded > 1 ? "s" : ""}`
        );
      if (syncDetails.armorsLoaded > 0)
        dataParts.push(
          `${syncDetails.armorsLoaded} armor${syncDetails.armorsLoaded > 1 ? "s" : ""}`
        );
      if (dataParts.length > 0) {
        messageParts.push(`(${dataParts.join(", ")})`);
      }

      ui.notifications?.info(messageParts.join(" "));
      this.reportWarnings(syncDetails);
      return existingActor;
    } else {
      // Create new actor (without armors/weapons in system data)
      const actorDataForCreate = {
        ...actorData,
        system: {
          ...actorData.system,
          armors: [], // Don't create embedded arrays
          weapons: [] // Will be created as Item documents below
        }
      };

      const actor = await Actor.create(actorDataForCreate);

      if (!actor) {
        throw new Error("Failed to create actor");
      }

      // Create armor items from Charman data
      if (actorData.system.armors && actorData.system.armors.length > 0) {
        const armorItems = actorData.system.armors.map((armor: any) => ({
          name: armor.name,
          type: "armor",
          system: {
            rank: armor.rank,
            value: armor.value,
            maxValue: armor.maxValue,
            equipped: armor.equipped,
            description: armor.description
          }
        }));
        await actor.createEmbeddedDocuments("Item", armorItems);
      }

      // Create weapon items from Charman data
      if (actorData.system.weapons && actorData.system.weapons.length > 0) {
        const weaponItems = actorData.system.weapons.map((weapon: any) => {
          // Convert old weapon format to new format
          const weaponType =
            weapon.type === "ranged" || weapon.type === "thrown"
              ? weapon.type
              : "melee";
          const isRanged = weaponType === "ranged" || weaponType === "thrown";

          return {
            name: weapon.name,
            type: "weapon",
            system: {
              weaponType,
              damage: isRanged
                ? "0"
                : typeof weapon.damage === "number"
                  ? String(weapon.damage)
                  : "0",
              damageRank: isRanged
                ? typeof weapon.damage === "string"
                  ? weapon.damage
                  : Rank.Typical
                : Rank.Typical,
              equipped: weapon.equipped,
              description: weapon.description || "",
              talents: weapon.applicableTalents || [],
              damageTypes: weaponDamageTypes(weapon),
              multiHit: weapon.multiHit || false,
              armorPiercing: toRankKey(weapon.armorPiercing) ?? "",
              statDebuffs: weapon.statDebuffs || [],
              damageBuffs: weapon.damageBuffs || [],
              dots: normalizeDots(weapon.dots),
              statusEffects: weapon.statusEffects || [],
              areaOfEffect: weapon.areaOfEffect
            }
          };
        });
        await actor.createEmbeddedDocuments("Item", weaponItems);
      }

      // Build consolidated notification message
      const messageParts = [`Imported ${actorData.name} from Charman`];
      if (syncDetails.imagesUploaded > 0) {
        messageParts.push(
          `${syncDetails.imagesUploaded} image${syncDetails.imagesUploaded > 1 ? "s" : ""} uploaded`
        );
      }
      const dataParts = [];
      if (syncDetails.formsProcessed > 0)
        dataParts.push(
          `${syncDetails.formsProcessed} form${syncDetails.formsProcessed > 1 ? "s" : ""}`
        );
      if (syncDetails.powersLoaded > 0)
        dataParts.push(
          `${syncDetails.powersLoaded} power${syncDetails.powersLoaded > 1 ? "s" : ""}`
        );
      if (syncDetails.talentsLoaded > 0)
        dataParts.push(
          `${syncDetails.talentsLoaded} talent${syncDetails.talentsLoaded > 1 ? "s" : ""}`
        );
      if (syncDetails.weaponsLoaded > 0)
        dataParts.push(
          `${syncDetails.weaponsLoaded} weapon${syncDetails.weaponsLoaded > 1 ? "s" : ""}`
        );
      if (syncDetails.armorsLoaded > 0)
        dataParts.push(
          `${syncDetails.armorsLoaded} armor${syncDetails.armorsLoaded > 1 ? "s" : ""}`
        );
      if (dataParts.length > 0) {
        messageParts.push(`(${dataParts.join(", ")})`);
      }

      ui.notifications?.success(messageParts.join(" "));
      this.reportWarnings(syncDetails);
      return actor as Actor;
    }
  }

  /**
   * POST a background sync update to Charman. Failures are surfaced to the
   * user (persistent notification + console) rather than swallowed, since
   * the sheet otherwise looks fine while Charman has silently drifted.
   */
  private async postUpdate(
    path: string,
    body: Record<string, unknown>,
    label: string
  ): Promise<boolean> {
    try {
      const apiPath = this.config.apiPath || "/charman/api/foundry";
      const url = `${this.config.baseUrl}${apiPath}${path}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        },
        body: JSON.stringify(body)
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        // Non-JSON body - fall back to the status-based message
      }

      if (!response.ok || !data?.success) {
        throw new Error(
          describeHttpFailure(response.status, data) ||
            `Charman did not confirm the update (${response.status})`
        );
      }
      return true;
    } catch (error) {
      notifyCharmanError(
        `Could not sync ${label} to Charman`,
        error,
        this.config.baseUrl
      );
      return false;
    }
  }

  /**
   * Update character karma in Charman (called when karma is spent)
   */
  async updateKarma(
    username: string,
    characterName: string,
    newKarmaValue: number
  ): Promise<boolean> {
    return this.postUpdate(
      "/character/karma",
      { username, callname: characterName, karma: newKarmaValue },
      "karma"
    );
  }

  /**
   * Update character Mental Points in Charman (called when MP is spent)
   */
  async updateMP(
    username: string,
    characterName: string,
    newMPValue: number
  ): Promise<boolean> {
    return this.postUpdate(
      "/character/mentalpoints",
      { username, callname: characterName, mentalpoints: newMPValue },
      "Mental Points"
    );
  }

  /**
   * Update equipment armor value in Charman (called when armor takes damage or is repaired)
   */
  async updateEquipmentArmor(
    username: string,
    characterName: string,
    armorName: string,
    newValue: number
  ): Promise<boolean> {
    return this.postUpdate(
      "/character/armor",
      {
        username,
        callname: characterName,
        armor_name: armorName,
        value: newValue
      },
      `armor "${armorName}"`
    );
  }

  /**
   * Update Body Armor power value in Charman (called when power takes damage or is repaired)
   */
  async updateBodyArmorPower(
    username: string,
    characterName: string,
    newValue: number
  ): Promise<boolean> {
    return this.postUpdate(
      "/character/bodyarmor",
      { username, callname: characterName, value: newValue },
      "Body Armor"
    );
  }

  /**
   * Build the full-character payload for the Charman sync endpoint (the
   * reverse of convertToActorData). Ranks are sent as Foundry Rank enum
   * values; Charman normalizes them. Foundry-only data (images, categories,
   * equipment, contacts, notes) is intentionally not sent.
   */
  buildSyncPayload(actor: Actor): Record<string, any> {
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));
    const system = (actor as any).system;
    const forms: any[] = system.forms ?? [];
    const powers: any[] = system.powers ?? [];
    const charman = system.charman;

    const formNameById = new Map<string, string>(
      forms.map(f => [f.id, f.name])
    );
    const powerNameById = new Map<string, string>(
      powers.map(p => [p.id, p.name])
    );

    const buffFields = (entry: any) => ({
      statDebuffs: clone(entry.statDebuffs ?? []),
      damageBuffs: clone(entry.damageBuffs ?? []),
      dots: clone(entry.dots ?? []),
      statusEffects: clone(entry.statusEffects ?? [])
    });

    const items = (actor as any).items as any;

    return {
      username: charman.username,
      callname: charman.characterName,
      karma: system.resources?.karma?.value ?? 0,
      ...(system.resources?.mentalPoints && {
        mentalpoints: system.resources.mentalPoints.value
      }),
      weaponSlots: system.weaponSlots,
      forms: forms.map(form => ({
        name: form.name,
        isPrimary: !!form.isPrimary,
        tokenWidth: form.tokenWidth || 1,
        tokenHeight: form.tokenHeight || 1,
        tokenScale: form.tokenScale || 1,
        weaponSlots: form.weaponSlots ?? null,
        visionSources: (form.visionSources ?? []).map((vs: any) => ({
          type: vs.type || "sight:basic",
          rangeSource: vs.rangeSource || "flat",
          flatRange: vs.flatRange || 0,
          powerName: powerNameById.get(vs.powerId) ?? ""
        })),
        attributes: Object.fromEntries(
          [
            "fighting",
            "agility",
            "strength",
            "endurance",
            "reasoning",
            "intuition",
            "psyche"
          ].map(stat => [
            stat,
            {
              rank: form.attributes?.[stat]?.rank,
              value: form.attributes?.[stat]?.value
            }
          ])
        )
      })),
      powers: powers.map(power => ({
        name: power.name,
        rank: power.rank,
        formNames: (power.formIds ?? [])
          .map((id: string) => formNameById.get(id))
          .filter((name: string | undefined) => !!name),
        description: power.description ?? "",
        mpCost: Number(power.mpCost) || 0,
        effectType: power.effectType || "none",
        attackType: power.attackType || "none",
        // Legacy single type kept in step for older Charman readers
        damageType: normalizeDamageTypes(power)[0] ?? "none",
        damageTypes: normalizeDamageTypes(power),
        skipDialogs: !!power.skipDialogs,
        resistanceType: power.resistanceType || null,
        vulnerabilityType: power.vulnerabilityType || null,
        multiHit: !!power.multiHit,
        armorPiercing: power.armorPiercing || null,
        leechPercent: Number(power.leechPercent) || 0,
        targetType: power.targetType || "any",
        ...buffFields(power),
        isAura: !!power.isAura,
        auraDisposition: power.auraDisposition || "any",
        auraIncludeSelf: !!power.auraIncludeSelf,
        auraRange: Math.round(Number(power.auraRange)) || 0,
        massEffect: normalizeMassEffect(power.massEffect),
        areaOfEffect: normalizeAreaOfEffect(power.areaOfEffect),
        grantsArmor: !!power.grantsArmor,
        armorTypes: Array.isArray(power.armorTypes) ? power.armorTypes : [],
        armorLayer: Number(power.armorLayer ?? 1),
        armorToggle: !!power.armorToggle,
        armorBlocksAttacks: !!power.armorBlocksAttacks,
        blendIn: !!power.blendIn,
        blendInDurationFormula: power.blendInDurationFormula || "",
        isLifeLink: !!power.isLifeLink,
        lifeLinkPercent: Number(power.lifeLinkPercent) || 0,
        lifeLinkDirection: power.lifeLinkDirection || "protect",
        autoHealEachRound: !!power.autoHealEachRound
      })),
      talents: (system.talents ?? []).map((talent: any) => ({
        name: talent.name,
        bonus: Number(talent.bonus) || 0,
        description: talent.description ?? "",
        grantsDualWield: !!talent.grantsDualWield
      })),
      armors: items
        .filter((item: any) => item.type === "armor")
        .map((item: any) => ({
          name: item.name,
          rank: item.system.rank,
          value: item.system.value,
          maxValue: item.system.maxValue,
          equipped: !!item.system.equipped,
          description: item.system.description ?? "",
          formNames: (item.system.formIds ?? [])
            .map((id: string) => formNameById.get(id))
            .filter((name: string | undefined) => !!name)
        })),
      weapons: items
        .filter((item: any) => item.type === "weapon")
        .map((item: any) => {
          const weaponType = item.system.weaponType;
          const isMelee = weaponType === "melee" || weaponType === "thrown";
          return {
            name: item.name,
            type: weaponType,
            // Melee/thrown store a Column Shift, ranged a damage rank
            damage: isMelee
              ? parseInt(String(item.system.damage), 10) || 0
              : item.system.damageRank,
            stat: weaponType === "melee" ? "fighting" : "agility",
            applicableTalent: item.system.talents?.[0] ?? null,
            damageTypes: normalizeDamageTypes(item.system),
            armorPiercing: item.system.armorPiercing || null,
            description: item.system.description ?? "",
            multiHit: !!item.system.multiHit,
            ...buffFields(item.system),
            ...(item.system.areaOfEffect && {
              areaOfEffect: clone(item.system.areaOfEffect)
            })
          };
        })
    };
  }

  /**
   * Compare the actor against its linked Charman character so the GM can
   * review what a push would change. Returns the full Foundry payload too,
   * which pushSyncSelection() slices according to the GM's decisions.
   */
  async fetchSyncDiff(
    actor: Actor
  ): Promise<{ diff: SyncDiff; foundryPayload: Record<string, any> }> {
    const foundryPayload = this.buildSyncPayload(actor);
    if (!foundryPayload.username || !foundryPayload.callname) {
      throw new Error("Actor is not linked to a Charman character");
    }

    const charmanChar = await this.fetchCharacter(
      foundryPayload.username,
      foundryPayload.callname
    );
    if (!charmanChar) {
      throw new Error("Could not load the linked Charman character");
    }

    return {
      diff: buildSyncDiff(foundryPayload, charmanChar as any),
      foundryPayload
    };
  }

  /**
   * Map Laravel field errors ("powers.2.name") back to the item they came
   * from so the sheet can highlight its accordion titlebar.
   */
  private flagItemErrors(
    payload: Record<string, any>,
    errors: Record<string, string[]> | undefined
  ): void {
    clearCharmanItemErrors();
    for (const [field, msgs] of Object.entries(errors ?? {})) {
      const [section, index, ...rest] = field.split(".");
      const name = payload[section]?.[Number(index)]?.name;
      if (!name || !["powers", "talents", "weapons", "armors"].includes(section))
        continue;
      const text = ([] as string[]).concat(msgs as any).join(" ");
      setCharmanItemError(
        section as CharmanErrorSection,
        name,
        rest.length ? `${rest.join(".")}: ${text}` : text
      );
    }
  }

  /**
   * Push only the changes the GM chose in the review dialog (Foundry ->
   * Charman). Throws with a readable message on failure so the caller can
   * notify.
   */
  async pushSyncSelection(
    actor: Actor,
    foundryPayload: Record<string, any>,
    diff: SyncDiff,
    decisions: SyncDecisions
  ): Promise<{ success: boolean; synced: Record<string, number> }> {
    const payload = buildSelectivePayload(foundryPayload, diff, decisions);

    const apiPath = this.config.apiPath || "/charman/api/foundry";
    const url = `${this.config.baseUrl}${apiPath}/character/sync`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(this.config.apiKey && {
          Authorization: `Bearer ${this.config.apiKey}`
        })
      },
      body: JSON.stringify(payload)
    });

    let data: any = null;
    try {
      data = await response.json();
    } catch {
      // Non-JSON error body - fall through to the status-based message
    }

    if (!response.ok || !data?.success) {
      const message =
        response.status === 404
          ? `Character "${payload.callname}" not found for user "${payload.username}"`
          : describeHttpFailure(response.status, data) ||
            "Charman did not confirm the sync";
      this.flagItemErrors(payload, data?.errors);
      throw new Error(message);
    }
    clearCharmanItemErrors();

    await (actor as any).update({ "system.charman.lastSync": Date.now() });
    return { success: true, synced: data.synced ?? {} };
  }
}

/**
 * Global Charman service instance
 */
let charmanService: CharmanService | null = null;

/**
 * Initialize the Charman service
 */
export function initCharmanService(config: CharmanConfig): void {
  charmanService = new CharmanService(config);
}

/**
 * Get the global Charman service instance
 */
export function getCharmanService(): CharmanService {
  if (!charmanService) {
    throw new Error("Charman service not initialized");
  }
  return charmanService;
}
