import {
  parseRankFromCharman,
  nanoid,
  valueToRank,
  getRankValue
} from "./utils";
import { Rank } from "./enums";

/**
 * Configuration for Charman API
 */
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
}

export interface CharmanForm {
  name: string;
  description?: string;
  tokenImage?: string; // Token image path for this form
  tokenWidth?: number; // Token width in grid squares (default: 1)
  tokenHeight?: number; // Token height in grid squares (default: 1)
  tokenScale?: number; // Token scale multiplier (default: 1)
  fighting: any;
  agility: any;
  strength: any;
  endurance: any;
  reasoning: any;
  intuition: any;
  psyche: any;
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
  damageType?: string; // Type of damage dealt (fire, cold, etc.)
  resistanceType?: string; // Type of damage this power resists (for resistance powers)
  vulnerabilityType?: string; // Type of damage this power is weak to (for vulnerability/weakness powers)
}

export interface CharmanTalent {
  name: string;
  bonus: number;
  description?: string;
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
}

export interface CharmanWeapon {
  name: string;
  type: "ranged" | "melee"; // Weapon type determines which stat is used for to-hit
  damage: string | number | null | undefined; // Damage rank string (e.g., "Typical"), numeric score (e.g., 30), or null/undefined (will default based on type)
  stat: "agility" | "fighting"; // Stat used for to-hit rolls
  applicableTalent?: string; // Name of talent that applies to this weapon
  description?: string;
  equipped?: boolean;
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
      // Re-throw the error so it can be caught by importCharacter
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
      console.error("Error listing characters from Charman:", error);
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
      console.error("Error uploading remote image:", error);
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
      armorsLoaded: 0
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
                    console.log(
                      `Uploaded token image for form "${form.name}" to Foundry`
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
                  console.log(`Uploaded base form token image to Foundry`);
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
        for (const [formName, rankValue] of formRanks) {
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
        damageType: power.damageType || "none",
        resistanceType: power.resistanceType,
        vulnerabilityType: power.vulnerabilityType,
        value: power.value || getRankValue(rankName),
        maxValue: power.maxValue || getRankValue(rankName)
      };
    });

    // Convert talents
    const talents = (charmanChar.talents || []).map(
      (talent: CharmanTalent) => ({
        id: nanoid(),
        name: talent.name,
        bonus: Number(talent.bonus) || 0,
        description: talent.description || ""
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
        powers,
        talents,
        armors: (charmanChar.armors || []).map((armor: CharmanArmor) => ({
          id: nanoid(),
          name: armor.name,
          rank: armor.rank,
          value: armor.value,
          maxValue: armor.maxValue,
          equipped: armor.equipped,
          description: armor.description || ""
        })),
        weapons: (charmanChar.weapons || []).map((weapon: CharmanWeapon) => {
          let damage: string | number;

          if (weapon.type === "melee") {
            // Melee weapons: damage should be CS (number)
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
            stat: weapon.stat,
            applicableTalent: weapon.applicableTalent || "",
            description: weapon.description || "",
            equipped: weapon.equipped || false
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
        "system.armors": actorData.system.armors,
        "system.weapons": actorData.system.weapons,
        "system.charman": actorData.system.charman
      };

      await existingActor.update(updateData);

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
      return existingActor;
    } else {
      // Create new actor
      const actor = await Actor.create(actorData);

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

      // @ts-expect-error - Foundry's ui.notifications may not be typed
      ui.notifications?.success(messageParts.join(" "));
      return actor as Actor;
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
    try {
      const apiPath = this.config.apiPath || "/charman/api/foundry";
      const url = `${this.config.baseUrl}${apiPath}/character/karma`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        },
        body: JSON.stringify({
          username,
          callname: characterName,
          karma: newKarmaValue
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to update karma: ${response.statusText}`);
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error("Error updating karma in Charman:", error);
      // Don't show error notification to user - this is a background sync
      return false;
    }
  }

  /**
   * Update character Mental Points in Charman (called when MP is spent)
   */
  async updateMP(
    username: string,
    characterName: string,
    newMPValue: number
  ): Promise<boolean> {
    try {
      const apiPath = this.config.apiPath || "/charman/api/foundry";
      const url = `${this.config.baseUrl}${apiPath}/character/mentalpoints`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        },
        body: JSON.stringify({
          username,
          callname: characterName,
          mentalpoints: newMPValue
        })
      });

      if (!response.ok) {
        throw new Error(
          `Failed to update Mental Points: ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error("Error updating Mental Points in Charman:", error);
      // Don't show error notification to user - this is a background sync
      return false;
    }
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
    try {
      const apiPath = this.config.apiPath || "/charman/api/foundry";
      const url = `${this.config.baseUrl}${apiPath}/character/armor`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        },
        body: JSON.stringify({
          username,
          callname: characterName,
          armor_name: armorName,
          value: newValue
        })
      });

      if (!response.ok) {
        throw new Error(
          `Failed to update equipment armor: ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error("Error updating equipment armor in Charman:", error);
      // Don't show error notification to user - this is a background sync
      return false;
    }
  }

  /**
   * Update Body Armor power value in Charman (called when power takes damage or is repaired)
   */
  async updateBodyArmorPower(
    username: string,
    characterName: string,
    newValue: number
  ): Promise<boolean> {
    try {
      const apiPath = this.config.apiPath || "/charman/api/foundry";
      const url = `${this.config.baseUrl}${apiPath}/character/bodyarmor`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(this.config.apiKey && {
            Authorization: `Bearer ${this.config.apiKey}`
          })
        },
        body: JSON.stringify({
          username,
          callname: characterName,
          value: newValue
        })
      });

      if (!response.ok) {
        throw new Error(
          `Failed to update Body Armor power: ${response.statusText}`
        );
      }

      const data = await response.json();
      return data.success;
    } catch (error) {
      console.error("Error updating Body Armor power in Charman:", error);
      // Don't show error notification to user - this is a background sync
      return false;
    }
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
