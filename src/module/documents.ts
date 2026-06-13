import { markRaw, toRaw } from "vue";
import { ActorType } from "./enums";
import { Rank } from "./enums";
import { calculateHealth, calculateMentalPoints, stringToRank } from "./utils";

declare module "fvtt-types/configuration" {
  interface DocumentClassConfig {
    Actor: typeof FaseripActor<Actor.SubType>;
  }
  interface ConfiguredActor<SubType extends Actor.SubType> {
    document: FaseripActor<SubType>;
  }
}

function getDefaultMovementByRank(): Record<Rank, number> {
  // Base defaults convert area movement to squares using 1 area = 1 square.
  return {
    [Rank.Shift0]: 0,
    [Rank.Feeble]: 0,
    [Rank.Poor]: 1,
    [Rank.Typical]: 2,
    [Rank.Good]: 4,
    [Rank.Excellent]: 6,
    [Rank.Remarkable]: 8,
    [Rank.Incredible]: 10,
    [Rank.Amazing]: 20,
    [Rank.Monstrous]: 40,
    [Rank.Unearthly]: 60,
    [Rank.ShiftX]: 80,
    [Rank.ShiftY]: 160,
    [Rank.ShiftZ]: 400,
    [Rank.Class1000]: 50,
    [Rank.Class3000]: 5000,
    [Rank.Class5000]: 500000,
    [Rank.Beyond]: 499999999
  };
}

function getConfiguredMovementByRank(): Record<Rank, number> {
  const defaults = getDefaultMovementByRank();

  const raw = game.settings.get("faserip", "movementSquaresByRank") as
    | string
    | undefined;
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged: Record<Rank, number> = { ...defaults };

    for (const rank of Object.values(Rank)) {
      const candidate = parsed[rank];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        merged[rank] = Math.max(0, Math.floor(candidate));
      }
    }

    return merged;
  } catch (_error) {
    return defaults;
  }
}

/**
 * Custom Actor document for FASERIP
 */
export class FaseripActor<
  SubType extends Actor.SubType = Actor.SubType
> extends Actor<SubType> {
  constructor(
    data: ConstructorParameters<typeof Actor>[0],
    context: ConstructorParameters<typeof Actor>[1]
  ) {
    super(data, context);
    markRaw(this.items);
    markRaw(this.effects);
  }
  /**
   * Pre-create hook to set default prototypeToken configuration and initialize data
   */
  protected override async _preCreate(
    data: any,
    options: any,
    user: any
  ): Promise<boolean | void> {
    // Set default prototypeToken configuration for PCs and NPCs
    if (
      (data.type === ActorType.Pc || data.type === ActorType.Npc) &&
      !data.prototypeToken
    ) {
      const tokenConfig: any = {
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        bar1: {
          attribute: "resources.health"
        },
        bar2: {
          attribute: "resources.armor"
        }
      };

      // Only PCs get vision enabled by default
      if (data.type === ActorType.Pc) {
        tokenConfig.sight = { enabled: true };
      }

      data.prototypeToken = tokenConfig;
    }

    // Initialize forms if not present
    if (!data.system?.forms || data.system.forms.length === 0) {
      if (!data.system) data.system = {};
      data.system.forms = [
        {
          id: "default",
          name: "Base Form",
          isPrimary: true,
          attributes: {
            fighting: { rank: Rank.Typical, value: 6 },
            agility: { rank: Rank.Typical, value: 6 },
            strength: { rank: Rank.Typical, value: 6 },
            endurance: { rank: Rank.Typical, value: 6 },
            reasoning: { rank: Rank.Typical, value: 6 },
            intuition: { rank: Rank.Typical, value: 6 },
            psyche: { rank: Rank.Typical, value: 6 }
          }
        }
      ];
      data.system.currentFormId = "default";
    }

    // Initialize healthByForm for default form
    if (
      !data.system?.healthByForm ||
      Object.keys(data.system.healthByForm).length === 0
    ) {
      const defaultForm = data.system.forms?.[0];
      if (defaultForm) {
        const calculatedHealth = calculateHealth(defaultForm);
        if (!data.system.healthByForm) data.system.healthByForm = {};
        data.system.healthByForm[defaultForm.id] = calculatedHealth;

        // Also initialize the health value
        if (!data.system.resources) data.system.resources = {};
        if (!data.system.resources.health) data.system.resources.health = {};
        data.system.resources.health.value = calculatedHealth;
        data.system.resources.health.max = calculatedHealth;
      }
    }

    return super._preCreate(data, options, user);
  }

  override prepareBaseData() {
    super.prepareBaseData();
  }

  override prepareDerivedData() {
    super.prepareDerivedData();

    const system = this.system as any;

    // Ensure we have at least one form
    if (!system.forms || system.forms.length === 0) {
      system.forms = [
        {
          id: "default",
          name: "Base Form",
          isPrimary: true,
          attributes: {
            fighting: { rank: "typical", value: 6 },
            agility: { rank: "typical", value: 6 },
            strength: { rank: "typical", value: 6 },
            endurance: { rank: "typical", value: 6 },
            reasoning: { rank: "typical", value: 6 },
            intuition: { rank: "typical", value: 6 },
            psyche: { rank: "typical", value: 6 }
          }
        }
      ];
      system.currentFormId = "default";
    }

    // Set currentFormId if not set
    if (!system.currentFormId && system.forms.length > 0) {
      const primaryForm = system.forms.find((f: any) => f.isPrimary);
      system.currentFormId = primaryForm ? primaryForm.id : system.forms[0].id;
    }

    // Initialize healthByForm if not present
    if (!system.healthByForm) {
      system.healthByForm = {};
    }

    // Get current form
    const currentForm = system.forms.find(
      (f: any) => f.id === system.currentFormId
    );

    if (currentForm) {
      // Calculate max health from FASE attributes (Fighting + Agility + Strength + Endurance)
      const calculatedHealth = calculateHealth(currentForm);

      // Always update max health when attributes change
      system.resources.health.max = calculatedHealth;

      // Initialize healthByForm for current form if not set
      if (system.healthByForm[system.currentFormId] === undefined) {
        system.healthByForm[system.currentFormId] = calculatedHealth;
      }

      // Load health from healthByForm for the current form
      const healthFromForm = system.healthByForm[system.currentFormId];
      system.resources.health.value = healthFromForm;

      // Clamp health (can go negative to -20)
      system.resources.health.value = Math.max(
        -20,
        Math.min(system.resources.health.value, system.resources.health.max)
      );

      // Clamp karma (no max, just ensure non-negative)
      system.resources.karma.value = Math.max(0, system.resources.karma.value);

      // Handle Mental Points (houserule: mental points enabled)
      const mpEnabled = game.settings.get("faserip", "mpEnabled") || false;

      if (mpEnabled) {
        // Initialize MP resources if not present
        if (!system.resources.mentalPoints) {
          system.resources.mentalPoints = { value: 0, max: 0 };
        }

        // Calculate max mental points from RIP attributes (Reasoning + Intuition + Psyche)
        const calculatedMP = calculateMentalPoints(currentForm);
        system.resources.mentalPoints.max = calculatedMP;

        // If MP was never set or is 0, initialize it to max
        if (
          !system.resources.mentalPoints.value ||
          system.resources.mentalPoints.value === 0
        ) {
          system.resources.mentalPoints.value = calculatedMP;
        }

        // Clamp MP
        system.resources.mentalPoints.value = Math.max(
          0,
          Math.min(
            system.resources.mentalPoints.value,
            system.resources.mentalPoints.max
          )
        );
      } else {
        // Ensure MP resources don't exist if disabled
        if (system.resources?.mentalPoints) {
          delete system.resources.mentalPoints;
        }
      }
    }

    // Calculate derived armor resource for token bar display
    const activeFormId = system.currentFormId;
    const bodyArmorPower = (system.powers || []).find(
      (p: any) =>
        p.name.toLowerCase().replace(/[\s_-]+/g, "") === "bodyarmor" &&
        (!p.formIds?.length || p.formIds.includes(activeFormId))
    );

    // Find equipped armor items (from actor.items collection)
    const equippedArmorItems = this.items.filter(
      (item: any) => item.type === "armor" && item.system.equipped
    );

    // Calculate current and max armor values
    let currentArmor = 0;
    let maxArmor = 0;

    if (bodyArmorPower) {
      currentArmor += bodyArmorPower.value;
      maxArmor += bodyArmorPower.maxValue || bodyArmorPower.value;
    }

    // Sum up all equipped armor items
    for (const armorItem of equippedArmorItems) {
      const armorSystem = armorItem.system as any;
      currentArmor += armorSystem.value || 0;
      maxArmor += armorSystem.maxValue || 0;
    }

    // Ensure armor resource exists (for backwards compatibility)
    if (!system.resources.armor) {
      system.resources.armor = { value: 0, max: 0 };
    }

    // Update armor resource (now stored in schema)
    system.resources.armor.value = currentArmor;
    system.resources.armor.max = maxArmor;
  }

  /**
   * Get the current active form
   */
  getCurrentForm(): any {
    const system = this.system as any;
    return system.forms?.find((f: any) => f.id === system.currentFormId);
  }

  /**
   * Derived movement distance from current form Endurance rank.
   * Returns distance in scene grid units (squares × grid.distance).
   */
  get movement(): number {
    const currentForm = this.getCurrentForm();
    const enduranceRank = stringToRank(
      currentForm?.attributes?.endurance?.rank || Rank.Typical
    );
    const configured = getConfiguredMovementByRank();
    const squares = configured[enduranceRank] ?? configured[Rank.Typical];

    // Multiply by grid distance to convert squares to actual distance units
    const gridDistance = canvas?.scene?.grid.distance ?? 1;
    return squares * gridDistance;
  }

  /**
   * Current form's endurance rank (used for movement calculation).
   * Property path: actor.currentEnduranceRank
   */
  get currentEnduranceRank(): string {
    const currentForm = this.getCurrentForm();
    return currentForm?.attributes?.endurance?.rank || Rank.Typical;
  }

  /**
   * Get the initiative formula for this actor
   * FASERIP uses Agility-based initiative: 1d[agility_value]
   */
  _getInitiativeFormula(): string {
    return (this.system as any).initiativeDice || "1d6";
  }

  /**
   * Switch to a different form
   */
  async switchForm(formId: string): Promise<void> {
    const system = this.system as any;
    const form = system.forms?.find((f: any) => f.id === formId);

    if (!form) {
      ui.notifications?.error(`Form ${formId} not found`);
      return;
    }

    // Initialize healthByForm if not present
    if (!system.healthByForm) {
      system.healthByForm = {};
    }

    // Clone the healthByForm object to modify it
    const updatedHealthByForm = { ...system.healthByForm };

    // Save current form's health value before switching
    const currentFormId = system.currentFormId;
    if (currentFormId) {
      updatedHealthByForm[currentFormId] = system.resources.health.value;
    }

    // Load target form's health (or initialize to max if not set)
    let targetHealth = updatedHealthByForm[formId];
    if (targetHealth === undefined) {
      // Calculate max health for target form
      targetHealth = calculateHealth(form);
      updatedHealthByForm[formId] = targetHealth;
    }

    const updateData: Record<string, any> = {
      "system.currentFormId": formId,
      "system.healthByForm": updatedHealthByForm,
      "system.resources.health.value": targetHealth
    };

    // Update token name to match actor name
    updateData["prototypeToken.name"] = this.name;

    // For PCs, always display name
    if (this.type === "pc") {
      updateData["prototypeToken.displayName"] =
        CONST.TOKEN_DISPLAY_MODES.ALWAYS;
    }

    // Apply token appearance if specified
    if (form.tokenImage) {
      updateData["prototypeToken.texture.src"] = form.tokenImage;
    }

    if (form.tokenWidth !== undefined && form.tokenWidth > 0) {
      updateData["prototypeToken.width"] = form.tokenWidth;
    }

    if (form.tokenHeight !== undefined && form.tokenHeight > 0) {
      updateData["prototypeToken.height"] = form.tokenHeight;
    }

    if (form.tokenScale !== undefined && form.tokenScale > 0) {
      updateData["prototypeToken.texture.scaleX"] = form.tokenScale;
      updateData["prototypeToken.texture.scaleY"] = form.tokenScale;
    }

    await this.update(updateData);

    // Update existing tokens on active scenes
    // @ts-expect-error - game.scenes type not fully recognized
    for (const scene of game.scenes!) {
      const tokens = scene.tokens.filter((t: any) => t.actor?.id === this.id);
      for (const token of tokens) {
        const tokenUpdate: Record<string, any> = {
          _id: token.id,
          name: this.name // Always update token name to match actor
        };

        // For PCs, always display name
        if (this.type === "pc") {
          tokenUpdate["displayName"] = CONST.TOKEN_DISPLAY_MODES.ALWAYS;
        }

        if (form.tokenImage) {
          tokenUpdate["texture.src"] = form.tokenImage;
        }

        if (form.tokenWidth !== undefined && form.tokenWidth > 0) {
          tokenUpdate["width"] = form.tokenWidth;
        }

        if (form.tokenHeight !== undefined && form.tokenHeight > 0) {
          tokenUpdate["height"] = form.tokenHeight;
        }

        if (form.tokenScale !== undefined && form.tokenScale > 0) {
          tokenUpdate["texture.scaleX"] = form.tokenScale;
          tokenUpdate["texture.scaleY"] = form.tokenScale;
        }

        await scene.updateEmbeddedDocuments("Token", [tokenUpdate]);
      }
    }
  }

  // Type guards
  is_pc(): this is FaseripPC {
    return this.type === ActorType.Pc;
  }

  is_npc(): this is FaseripNPC {
    return this.type === ActorType.Npc;
  }
}

// Type aliases for properly typed actor subtypes
export type FaseripPC = FaseripActor<ActorType.Pc>;
export type FaseripNPC = FaseripActor<ActorType.Npc>;

// Array of valid actor types
export const FASERIP_ACTOR_TYPES: ActorType[] = [ActorType.Pc, ActorType.Npc];

export function is_actor_type(type: any): type is ActorType {
  return FASERIP_ACTOR_TYPES.includes(type as ActorType);
}
