/**
 * Region Behavior type: forces a token's next roll (any roll) to be an
 * automatic Critical or Failure the moment it enters the region, by
 * attaching the same flags.faserip.kind "forcedResult" temp effect the GM
 * can apply manually from the actor sheet's Effects tab or via the
 * "Force Next Roll" token-HUD statuses (see faserip.ts, EffectsTab.vue).
 * Unlike PowerNegationRegionBehaviorType/PowerDampeningRegionBehaviorType,
 * this is a one-shot application on entry rather than a live "while inside"
 * gate, since the effect itself is already self-consuming (usesRemaining: 1).
 */
import { applyTemporaryModifier } from "../utils/temp-effects";

const { StringField, SetField } = foundry.data.fields;

export class ForceNextRollRegionBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static override LOCALIZATION_PREFIXES = [
    "FASERIP.BEHAVIOR.TYPES.forceNextRoll"
  ];

  static override defineSchema() {
    return {
      events: this._createEventsField({
        events: ["tokenEnter"],
        initial: ["tokenEnter"]
      }),
      actorTypes: new SetField(
        new StringField({
          required: true,
          choices: { pc: "FASERIP.ActorType.Pc", npc: "FASERIP.ActorType.Npc" }
        }),
        { initial: ["pc", "npc"] }
      ),
      outcome: new StringField({
        required: true,
        initial: "critical",
        choices: {
          critical: "FASERIP.BEHAVIOR.TYPES.forceNextRoll.OutcomeCritical",
          failure: "FASERIP.BEHAVIOR.TYPES.forceNextRoll.OutcomeFailure"
        }
      })
    };
  }

  static override events: Record<
    string,
    (this: any, event: any) => Promise<void>
  > = {
    async tokenEnter(this: ForceNextRollRegionBehaviorType, event: any) {
      if (!game.user?.isGM) return;

      const actor = event?.data?.token?.actor;
      if (!actor) return;

      const declaredTypes: string[] = Array.from(
        (this as any).actorTypes ?? []
      );
      if (declaredTypes.length && !declaredTypes.includes(actor.type)) return;

      const outcome = (this as any).outcome === "failure" ? "failure" : "critical";

      await applyTemporaryModifier(actor, {
        kind: "forcedResult",
        chartShift: 0,
        roundsRemaining: 0,
        indefinite: true,
        trigger: "nextAction",
        usesRemaining: 1,
        forcedOutcome: outcome,
        sourceName: (this.parent as any)?.name || "Region Effect"
      });
    }
  };
}
