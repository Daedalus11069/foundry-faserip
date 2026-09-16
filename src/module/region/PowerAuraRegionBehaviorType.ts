/**
 * Region Behavior type: carries the RESOLVED stat/damage chart shift (already
 * picked from the activating power's green/yellow/red tiers, based on the
 * single roll made when the aura was activated - see activatePowerAura in
 * utils/power-aura.ts) plus who they apply to (disposition relative to the
 * owner token, and whether the owner is affected by their own aura). Like
 * PowerDampeningRegionBehaviorType/PowerEnhancementRegionBehaviorType, the
 * shift is looked up live (see getPowerAuraStatShift/getPowerAuraDamageShift
 * in utils/power-aura.ts) at the moment an attribute or damage roll happens,
 * rather than relying on tokenEnter/tokenExit to create/delete stored
 * ActiveEffects - see power-negation.ts's header comment for why this
 * codebase avoids depending on those events firing reliably. The region
 * itself still expires after its rolled duration, via a round-tick (see
 * tickPowerAuraRegions), not via tokenExit.
 *
 * This behavior's region is created/repositioned/destroyed entirely by
 * utils/power-aura.ts (activatePowerAura/deactivatePowerAura/token-follow
 * hook/tickPowerAuraRegions) - a GM never hand-authors one of these in the
 * scene.
 *
 * Bookkeeping (ownerTokenId/ownerActorId/sourcePowerId/roundsRemaining)
 * deliberately lives in flags.faserip, NOT this schema - Foundry's stock
 * RegionBehavior config sheet auto-renders every schema field with no way to
 * hide one, so putting internal-only linkage data here would expose raw,
 * meaningless-to-edit ID strings in the GM-facing form alongside the two
 * fields (disposition/includeSelf) a GM might actually want to tweak by hand.
 */
const { StringField, BooleanField, NumberField, ObjectField } =
  foundry.data.fields;

export class PowerAuraRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static override LOCALIZATION_PREFIXES = ["FASERIP.BEHAVIOR.TYPES.powerAura"];

  static override defineSchema() {
    return {
      events: this._createEventsField({
        events: ["tokenEnter", "tokenExit"],
        initial: []
      }),
      disposition: new StringField({
        required: false,
        initial: "any",
        choices: {
          any: "FASERIP.BEHAVIOR.TYPES.powerAura.FIELDS.disposition.choices.any",
          ally: "FASERIP.BEHAVIOR.TYPES.powerAura.FIELDS.disposition.choices.ally",
          enemy: "FASERIP.BEHAVIOR.TYPES.powerAura.FIELDS.disposition.choices.enemy"
        }
      }),
      includeSelf: new BooleanField({ required: false, initial: false }),
      resolvedStatShifts: new ObjectField({ required: false, initial: {} }),
      resolvedDamageShift: new NumberField({
        required: false,
        integer: true,
        initial: 0
      })
    };
  }
}
