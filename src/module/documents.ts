import { ActorType } from "./enums";
import { calculateHealth, getRankValue } from "./utils";

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
            fighting: { rank: "typical", value: 6, bonus: 0 },
            agility: { rank: "typical", value: 6, bonus: 0 },
            strength: { rank: "typical", value: 6, bonus: 0 },
            endurance: { rank: "typical", value: 6, bonus: 0 },
            reasoning: { rank: "typical", value: 6, bonus: 0 },
            intuition: { rank: "typical", value: 6, bonus: 0 },
            psyche: { rank: "typical", value: 6, bonus: 0 }
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

    // Initialize bonus field for all attributes (but don't override values)
    if (system.forms) {
      for (const form of system.forms) {
        if (form.attributes) {
          for (const attrKey of Object.keys(form.attributes)) {
            const attr = form.attributes[attrKey];
            if (attr && attr.bonus === undefined) {
              // Ensure bonus field exists
              attr.bonus = 0;
            }
          }
        }
      }
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
