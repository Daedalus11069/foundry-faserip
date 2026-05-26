import { parseRankFromCharman, nanoid, valueToRank } from "./utils";

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
  contacts: CharmanContact[];
  biography?: string;
  notes?: string;
  karma?: number;
}

export interface CharmanForm {
  name: string;
  description?: string;
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
  rank: string;
  description?: string;
  category?: string;
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

export interface CharmanContact {
  name: string;
  relationship?: string;
  description?: string;
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
        throw new Error(`Failed to fetch character: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching character from Charman:", error);
      ui.notifications?.error(
        `Failed to fetch character: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      return null;
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
          { notify: true }
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
  ): Promise<any> {
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
          ui.notifications?.info(`Uploaded character image to Foundry`);
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
        ? charmanChar.forms.map((form: any, index: number) => {
            // Handle both nested attributes object and flat structure
            const attrs = form.attributes || form;
            return {
              id: form.id || nanoid(),
              name: form.name || `Form ${index + 1}`,
              isPrimary:
                form.isPrimary !== undefined ? form.isPrimary : index === 0,
              tokenImage: form.tokenImage || "",
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
        : [
            {
              id: nanoid(),
              name: "Base Form",
              isPrimary: true,
              tokenImage: "",
              tokenWidth: 1,
              tokenHeight: 1,
              tokenScale: 1,
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

    // Convert powers
    const powers = (charmanChar.powers || []).map((power: CharmanPower) => {
      // Convert numeric rank strings to rank names
      let rankName = power.rank;
      if (!isNaN(Number(power.rank))) {
        rankName = valueToRank(Number(power.rank));
      }
      return {
        id: nanoid(),
        name: power.name,
        rank: rankName,
        category: power.category || "general",
        description: power.description || ""
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

    return {
      name: actorName,
      type: "pc",
      img: imageUrl,
      prototypeToken: {
        texture: {
          src: imageUrl
        },
        sight: {
          enabled: true
        },
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER,
        bar1: {
          attribute: "resources.health"
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
        charman: {
          characterId: charmanChar.id,
          username: "",
          characterName: charmanChar.callname || "",
          lastSync: Date.now(),
          autoSync: false
        }
      }
    };
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
    const actorData = await this.convertToActorData(
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
        "prototypeToken.texture.src": actorData.img,
        "system.currentFormId": actorData.system.currentFormId,
        "system.forms": actorData.system.forms,
        "system.callname": actorData.system.callname,
        "system.resources": actorData.system.resources,
        "system.biography": actorData.system.biography,
        "system.notes": actorData.system.notes,
        "system.powers": actorData.system.powers,
        "system.talents": actorData.system.talents,
        "system.charman": actorData.system.charman
      };

      await existingActor.update(updateData);
      ui.notifications?.info(`Updated ${actorData.name} from Charman`);
      return existingActor;
    } else {
      // Create new actor
      const actor = await Actor.create(actorData);
      // @ts-expect-error - Accessing system data for new actor
      ui.notifications?.success(`Imported ${actorData.name} from Charman`);
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
