/**
 * Recurring power healing: a power with effectType "heal-health" and
 * autoHealEachRound set (e.g. "Nanite Healing") restores its own Rank value
 * to its owner's health at the start of every combat round, with no roll -
 * this is the automatic counterpart to the existing roll-to-activate healing
 * flow in StatsTab.vue's rollPower (Green/Yellow/Red tiers), which remains
 * available for players who want to roll for a bigger effect instead.
 *
 * Scoped to heal-health only: heal-armor's manual flow lets the caster pick
 * which armor source to repair via a dialog when there's more than one, which
 * doesn't have a sane unattended equivalent to run automatically every round.
 */
export async function applyRecurringPowerHealing(combat: any): Promise<void> {
  for (const combatant of combat.combatants ?? []) {
    const actor = combatant.token?.actor || combatant.actor;
    if (!actor) continue;

    const system = actor.system as any;
    const healPowers = (system.powers ?? []).filter(
      (power: any) =>
        power.effectType === "heal-health" &&
        power.autoHealEachRound &&
        power.value > 0
    );
    if (healPowers.length === 0) continue;

    let currentFormId = system.currentFormId;
    if (!currentFormId && system.forms?.length > 0) {
      const primaryForm = system.forms.find((f: any) => f.isPrimary);
      currentFormId = primaryForm ? primaryForm.id : system.forms[0].id;
    }
    if (!currentFormId) currentFormId = "default";

    const healthMax = system.resources?.health?.max || 0;
    const healthByForm = system.healthByForm || {};
    const oldValue =
      healthByForm[currentFormId] ?? system.resources?.health?.value ?? 0;

    const totalHealAmount = healPowers.reduce(
      (sum: number, power: any) => sum + power.value,
      0
    );
    const newValue = Math.min(healthMax, oldValue + totalHealAmount);
    const actualHealing = newValue - oldValue;
    if (actualHealing <= 0) continue;

    await actor.update({
      "system.resources.health.value": newValue,
      [`system.healthByForm.${currentFormId}`]: newValue
    });

    const powerNames = healPowers.map((p: any) => p.name).join(", ");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<div style="background: rgba(34, 197, 94, 0.15); border-left: 3px solid rgb(34, 197, 94); padding: 0.5rem; border-radius: 4px;">
        <h4 style="color: rgb(34, 197, 94); margin: 0 0 0.25rem 0; font-size: 1em;">${actor.name} - Automatic Healing</h4>
        <p style="margin: 0.25rem 0;"><strong>${powerNames}</strong> healed <strong>${actualHealing}</strong> health at the start of the round.</p>
        <p style="margin: 0.25rem 0; font-size: 0.9em; opacity: 0.8;">Health: ${oldValue} → ${newValue} / ${healthMax}</p>
      </div>`
    });
  }
}
