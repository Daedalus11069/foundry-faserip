/**
 * Region Behavior type: declares which actor types have their power-based
 * chart-shift rolls boosted by a configurable positive CS while a token sits
 * inside the region. The opposite of PowerNegationRegionBehaviorType/
 * PowerDampeningRegionBehaviorType - no Endurance-resist checkbox, since
 * there's nothing to resist. The bonus CS is looked up live (see
 * getPowerEnhancementShift in utils/power-negation.ts) at the moment a power
 * is rolled, mirroring how isPowersNegated() checks region containment live
 * rather than relying on stored per-actor state.
 */
const { StringField, SetField, NumberField } = foundry.data.fields;

export class PowerEnhancementRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static override LOCALIZATION_PREFIXES = ["FASERIP.BEHAVIOR.TYPES.powerEnhancement"];

  static override defineSchema() {
    return {
      events: this._createEventsField({
        events: ["tokenEnter", "tokenExit"],
        initial: []
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
        initial: 1
      })
    };
  }
}
