/**
 * Region Behavior type: declares which actor types have their Powers
 * negated while a token sits inside the region. The actual gate
 * (isPowersNegated in utils/power-negation.ts) checks token/region
 * containment live via TokenDocument#regions rather than relying on this
 * behavior's tokenEnter/tokenExit events - so this behavior only needs to
 * exist and carry its `actorTypes` config; it also best-effort maintains a
 * cosmetic "Powers Negated" status effect on enter/exit for visibility.
 */
import {
  setPowersNegatedIndicator,
  clearNegationResist
} from "../utils/power-negation";

const { StringField, SetField, BooleanField } = foundry.data.fields;

export class PowerNegationRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static override LOCALIZATION_PREFIXES = ["FASERIP.BEHAVIOR.TYPES.powerNegation"];

  static override defineSchema() {
    return {
      events: this._createEventsField({
        events: ["tokenEnter", "tokenExit"],
        initial: ["tokenEnter", "tokenExit"]
      }),
      actorTypes: new SetField(
        new StringField({
          required: true,
          choices: { pc: "FASERIP.ActorType.Pc", npc: "FASERIP.ActorType.Npc" }
        }),
        { initial: ["pc", "npc"] }
      ),
      allowEnduranceResist: new BooleanField({ initial: false })
    };
  }

  static override events: Record<string, (this: any, event: any) => Promise<void>> = {
    async tokenEnter(this: PowerNegationRegionBehaviorType, event: any) {
      await this._setIndicator(event, true);
      await this._clearResist(event);
    },
    async tokenExit(this: PowerNegationRegionBehaviorType, event: any) {
      await this._setIndicator(event, false);
    }
  };

  private async _setIndicator(event: any, negated: boolean): Promise<void> {
    if (!game.user?.isGM) return;

    const actor = event?.data?.token?.actor;
    if (!actor) return;

    const declaredTypes: string[] = Array.from(
      (this as any).actorTypes ?? []
    );
    if (declaredTypes.length && !declaredTypes.includes(actor.type)) return;

    await setPowersNegatedIndicator(actor, negated);
  }

  /**
   * Reset any lingering "resisting this negation" state the moment the
   * actor (re-)enters the field, so a resist earned on a prior visit - or in
   * a different negation region - never silently carries forward.
   */
  private async _clearResist(event: any): Promise<void> {
    if (!game.user?.isGM) return;

    const actor = event?.data?.token?.actor;
    if (!actor) return;

    const declaredTypes: string[] = Array.from(
      (this as any).actorTypes ?? []
    );
    if (declaredTypes.length && !declaredTypes.includes(actor.type)) return;

    await clearNegationResist(actor);
  }
}
