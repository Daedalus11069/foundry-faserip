import { ActorType } from "./enums";
import { calculateHealth, calculateMentalPoints, getRankValue } from "./utils";

/**
 * Custom Actor document for FASERIP
 */
export class FaseripActor extends Actor {
  /**
   * Pre-create hook to set default prototypeToken configuration
   */
  protected override async _preCreate(
    data: any,
    options: any,
    user: any
  ): Promise<boolean | void> {
    // Set default prototypeToken configuration for PCs only before calling super
    if (data.type === ActorType.Pc && !data.prototypeToken) {
      data.prototypeToken = {
        sight: {
          enabled: true
        },
        displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
        displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER,
        bar1: {
          attribute: "resources.health"
        }
      };
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

    // Get current form
    const currentForm = system.forms.find(
      (f: any) => f.id === system.currentFormId
    );

    if (currentForm) {
      // Calculate max health from FASE attributes (Fighting + Agility + Strength + Endurance)
      const calculatedHealth = calculateHealth(currentForm);

      // Always update max health when attributes change
      system.resources.health.max = calculatedHealth;

      // If health was never set or is 0, initialize it to max
      if (
        !system.resources.health.value ||
        system.resources.health.value === 0
      ) {
        system.resources.health.value = calculatedHealth;
      }

      // Clamp health
      system.resources.health.value = Math.max(
        0,
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
  }

  /**
   * Get the current active form
   */
  getCurrentForm(): any {
    const system = this.system as any;
    return system.forms?.find((f: any) => f.id === system.currentFormId);
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

    // @ts-expect-error - TypeScript doesn't recognize the update method on Actor
    await this.update({ "system.currentFormId": formId });
    ui.notifications?.info(`Switched to ${form.name}`);
  }
}
