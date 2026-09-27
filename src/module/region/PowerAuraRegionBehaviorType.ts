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
 * Bookkeeping (ownerTokenId/ownerActorId/sourcePowerId/roundsRemaining/
 * lifeLinkTargetActorId/lifeLinkTargetName) deliberately lives in
 * flags.faserip, NOT this schema - Foundry's stock RegionBehavior config
 * sheet auto-renders every schema field with no way to hide one, so putting
 * internal-only linkage data here would expose raw, meaningless-to-edit ID
 * strings in the GM-facing form alongside the fields (disposition/
 * includeSelf/lifeLinkPercent/lifeLinkDirection) a GM might actually want to
 * tweak by hand.
 *
 * Life-link exception to the "don't rely on tokenEnter/tokenExit" rule above:
 * a life-link bond MUST end (not just go dormant) the instant its bound
 * target leaves the region's range - see activatePowerAura/
 * getActiveLifeLinkRedirect in utils/power-aura.ts. tokenExit cancels it
 * immediately for responsiveness; tickPowerAuraRegions independently
 * double-checks bound-target containment every round as a fallback for
 * missed events, so a dropped event only delays the cancellation by at most
 * one round rather than leaving a dead bond active indefinitely.
 */
import { setLifeLinkIndicator, deactivatePowerAura } from "../utils/power-aura";

const { StringField, BooleanField, NumberField, ObjectField } =
  foundry.data.fields;

export class PowerAuraRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static override LOCALIZATION_PREFIXES = ["FASERIP.BEHAVIOR.TYPES.powerAura"];

  static override defineSchema() {
    return {
      events: this._createEventsField({
        events: ["tokenEnter", "tokenExit"],
        initial: ["tokenEnter", "tokenExit"]
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
      }),
      // Life-link: the real redirect (getActiveLifeLinkRedirect in
      // utils/power-aura.ts) is computed live from these two fields, same as
      // resolvedStatShifts/resolvedDamageShift above - lifeLinkPercent === 0
      // means this aura isn't a life-link at all. The tokenEnter/tokenExit
      // handlers below only maintain a best-effort cosmetic status icon (see
      // PowerNegationRegionBehaviorType for the same pattern/caveat).
      lifeLinkPercent: new NumberField({
        required: false,
        integer: true,
        min: 0,
        max: 100,
        initial: 0
      }),
      lifeLinkDirection: new StringField({
        required: false,
        initial: "protect",
        choices: ["protect", "share"]
      })
    };
  }

  static override events: Record<string, (this: any, event: any) => Promise<void>> = {
    async tokenEnter(this: PowerAuraRegionBehaviorType, event: any) {
      await this._setLifeLinkIndicator(event, true);
    },
    async tokenExit(this: PowerAuraRegionBehaviorType, event: any) {
      await this._setLifeLinkIndicator(event, false);
      await this._cancelLifeLinkIfBoundTargetLeft(event);
    }
  };

  private async _setLifeLinkIndicator(event: any, linked: boolean): Promise<void> {
    if (!game.user?.isGM) return;
    if (!((this as any).lifeLinkPercent > 0)) return;

    const actor = event?.data?.token?.actor;
    if (!actor) return;

    // Only the SPECIFIC actor this life-link was bound to at cast time gets
    // the indicator - a bystander of matching disposition merely passing
    // through the region is not part of the bond (see activatePowerAura).
    const boundTargetActorId = (this as any).parent?.flags?.faserip
      ?.lifeLinkTargetActorId;
    if (!boundTargetActorId || actor.id !== boundTargetActorId) return;

    await setLifeLinkIndicator(actor, linked);
  }

  /**
   * Cancel the power outright the moment its bound target steps out of the
   * region's range - a life-link isn't allowed to just go dormant while out
   * of range, it ends. This is the immediate, event-driven path;
   * tickPowerAuraRegions (power-aura.ts) is the once-per-round fallback for
   * when this event doesn't fire (see that function's comment).
   */
  private async _cancelLifeLinkIfBoundTargetLeft(event: any): Promise<void> {
    if (!game.user?.isGM) return;
    if (!((this as any).lifeLinkPercent > 0)) return;

    const actor = event?.data?.token?.actor;
    if (!actor) return;

    const flags = (this as any).parent?.flags?.faserip;
    const boundTargetActorId = flags?.lifeLinkTargetActorId;
    if (!boundTargetActorId || actor.id !== boundTargetActorId) return;

    const ownerActor = flags?.ownerActorId
      ? game.actors?.get(flags.ownerActorId)
      : null;
    if (!ownerActor || !flags?.sourcePowerId) return;

    const powerName = (this as any).parent?.name ?? "Life-Link";
    const targetLabel = flags.lifeLinkTargetName ?? actor.name;

    // Deliberately NOT awaited, and deferred a tick - deactivatePowerAura
    // deletes this behavior's own parent Region, which must not happen while
    // Foundry is still mid-dispatch of the tokenExit event this region just
    // raised.
    setTimeout(() => {
      void (async () => {
        await deactivatePowerAura(ownerActor, {
          id: flags.sourcePowerId,
          name: powerName
        });

        await ChatMessage.create({
          content: `<div class="fsr-combat-message" style="background: #7f1d1d; color: #fecaca; padding: 0.5rem; border-radius: 4px;">
            <strong>Life-Link Broken</strong>
            <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${targetLabel} moved out of range - the bond has been cancelled.</p>
          </div>`
        });
      })();
    }, 0);
  }
}
