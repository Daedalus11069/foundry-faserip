/**
 * Region Behavior type: declares which actor types have their power-based
 * chart-shift rolls dampened by a configurable negative CS while a token
 * sits inside the region. The dampening CS itself is looked up live (see
 * getPowerDampeningShift in utils/power-negation.ts) at the moment a power
 * is rolled, mirroring how isPowersNegated() checks region containment live
 * rather than relying on stored per-actor state - but a resist EARNED via an
 * Endurance roll IS stored as a temporary ActiveEffect (see
 * grantDampeningResist), so tokenEnter clears that stored state on every
 * fresh entry to keep a resist from one visit/field silently carrying into
 * the next.
 */
import { clearDampeningResist } from "../utils/power-negation";

const { StringField, SetField, NumberField, BooleanField } =
  foundry.data.fields;

export class PowerDampeningRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static override LOCALIZATION_PREFIXES = ["FASERIP.BEHAVIOR.TYPES.powerDampening"];

  static override defineSchema() {
    return {
      events: this._createEventsField({
        events: ["tokenEnter", "tokenExit"],
        initial: ["tokenEnter"]
      }),
      actorTypes: new SetField(
        new StringField({
          required: true,
          choices: { pc: "FASERIP.ActorType.Pc", npc: "FASERIP.ActorType.Npc" }
        }),
        { initial: ["pc", "npc"] }
      ),
      chartShift: new NumberField({
        required: true,
        integer: true,
        initial: -1
      }),
      allowEnduranceResist: new BooleanField({ initial: false })
    };
  }

  static override events: Record<string, (this: any, event: any) => Promise<void>> = {
    async tokenEnter(this: PowerDampeningRegionBehaviorType, event: any) {
      if (!game.user?.isGM) return;

      const actor = event?.data?.token?.actor;
      if (!actor) return;

      const declaredTypes: string[] = Array.from(
        (this as any).actorTypes ?? []
      );
      if (declaredTypes.length && !declaredTypes.includes(actor.type)) return;

      await clearDampeningResist(actor);
    }
  };
}
