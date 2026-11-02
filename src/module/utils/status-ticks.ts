/**
 * Turn-start processing for status conditions (see status-mechanics.ts for the
 * passive rules): each time an afflicted actor's turn begins,
 *
 * - burning / corrode / bleeding / degen deal damage (burning as fire,
 *   corrode as acid - both soaked by armor and resistances; bleeding and degen
 *   as straight health loss that ignores armor)
 * - poison / disease call for an Endurance test: a failure takes health loss,
 *   a Red result shakes the condition off
 * - bleeding then calls for a removal test: Endurance Yellow or better stops it
 * - regen restores health
 * - restrain / frozen allow a Strength escape roll: Yellow or better frees them
 *
 * Amounts come from the effect's own payload when it has one (see
 * getTickAmount) and fall back to a default rank otherwise.
 */
import { RANK_SHORTS, RollResult, UNIVERSAL_TABLE, Rank } from "../enums";
import { requestDamageApplication } from "../socket/faserip-socket";
import { getEffectiveAttributeData, type AttributeKey } from "./stat-debuffs";
import {
  getStatusEffects,
  getStatusLabel,
  getTickAmount,
  hasStatus
} from "./status-mechanics";

/** Armor-piercing rank high enough to ignore any armor: damage goes straight to health. */
const IGNORE_ARMOR = Rank.Beyond;

interface DamageTick {
  statusId: string;
  damageType: string;
  ignoreArmor: boolean;
}

const DAMAGE_TICKS: DamageTick[] = [
  { statusId: "burning", damageType: "fire", ignoreArmor: false },
  { statusId: "corrode", damageType: "acid", ignoreArmor: false },
  { statusId: "bleeding", damageType: "dot", ignoreArmor: true },
  { statusId: "degen", damageType: "dot", ignoreArmor: true }
];

/** Statuses that call for an Endurance test each turn; a failure costs health. */
const ENDURANCE_TEST_STATUSES = ["poison", "disease"];

/** Statuses the afflicted actor can try to escape with a Strength roll each turn. */
const ESCAPE_STATUSES = ["restrain", "frozen"];

async function rollColor(
  actor: any,
  attribute: AttributeKey
): Promise<{ color: RollResult; total: number } | null> {
  const attr = getEffectiveAttributeData(actor, attribute);
  if (!attr) return null;

  const ranges = UNIVERSAL_TABLE[RANK_SHORTS[attr.rank] ?? "ty"];
  if (!ranges) return null;

  const roll = await Roll.create("1d100");
  await roll.evaluate();
  const total = roll.total ?? 0;

  const [greenStart, yellowStart, redStart] = ranges;
  const color =
    total >= redStart
      ? RollResult.Red
      : total >= yellowStart
        ? RollResult.Yellow
        : total >= greenStart
          ? RollResult.Green
          : RollResult.White;

  return { color, total };
}

function isYellowOrBetter(color: RollResult): boolean {
  return color === RollResult.Yellow || color === RollResult.Red;
}

async function postStatusMessage(
  actor: any,
  title: string,
  body: string,
  tone: "bad" | "good" | "neutral" = "neutral"
): Promise<void> {
  const accent =
    tone === "bad" ? "239, 68, 68" : tone === "good" ? "34, 197, 94" : "148, 163, 184";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div style="background: rgba(${accent}, 0.15); border-left: 3px solid rgb(${accent}); padding: 0.5rem; border-radius: 4px;">
      <h4 style="margin: 0 0 0.25rem 0; font-size: 1em;">${actor.name} - ${title}</h4>
      <p style="margin: 0.25rem 0;">${body}</p>
    </div>`
  });
}

async function removeStatusEffects(actor: any, statusId: string): Promise<void> {
  const ids = getStatusEffects(actor, statusId)
    .map(effect => effect.id)
    .filter(id => actor.effects.get(id));
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

async function dealHealthDamage(
  actor: any,
  tokenId: string | undefined,
  amount: number,
  damageType: string,
  ignoreArmor: boolean,
  sourceName: string
): Promise<string> {
  const result = await requestDamageApplication(
    actor,
    amount,
    damageType,
    sourceName,
    tokenId,
    ignoreArmor ? IGNORE_ARMOR : null,
    undefined,
    1
  );
  if (!result) return `${amount} damage`;
  return result.armorDamage > 0
    ? `${amount} damage (${result.armorDamage} absorbed by armor, ${result.healthDamage} to health)`
    : `${amount} damage (${result.healthDamage} to health)`;
}

async function applyRegen(actor: any, effect: any): Promise<void> {
  const system = actor.system as any;
  const { amount } = getTickAmount(effect);

  let currentFormId = system.currentFormId;
  if (!currentFormId && system.forms?.length > 0) {
    const primaryForm = system.forms.find((f: any) => f.isPrimary);
    currentFormId = primaryForm ? primaryForm.id : system.forms[0].id;
  }
  if (!currentFormId) currentFormId = "default";

  const healthMax = system.resources?.health?.max || 0;
  const oldValue =
    system.healthByForm?.[currentFormId] ??
    system.resources?.health?.value ??
    0;
  const newValue = Math.min(healthMax, oldValue + amount);
  if (newValue <= oldValue) return;

  await actor.update({
    "system.resources.health.value": newValue,
    [`system.healthByForm.${currentFormId}`]: newValue
  });
  await postStatusMessage(
    actor,
    getStatusLabel("regen"),
    `${actor.name} regenerates ${newValue - oldValue} health (${oldValue} → ${newValue} / ${healthMax}).`,
    "good"
  );
}

async function tickActor(actor: any, tokenId: string | undefined): Promise<void> {
  // Damage-over-time statuses
  for (const tick of DAMAGE_TICKS) {
    for (const effect of getStatusEffects(actor, tick.statusId)) {
      const { amount } = getTickAmount(effect);
      if (amount <= 0) continue;
      const label = getStatusLabel(tick.statusId);
      const outcome = await dealHealthDamage(
        actor,
        tokenId,
        amount,
        tick.damageType,
        tick.ignoreArmor,
        label
      );
      await postStatusMessage(actor, label, `${actor.name} takes ${outcome}.`, "bad");
    }
  }

  // Bleeding removal test (after the tick, so the turn it stops still costs health)
  if (hasStatus(actor, "bleeding")) {
    const test = await rollColor(actor, "endurance");
    if (test && isYellowOrBetter(test.color)) {
      await removeStatusEffects(actor, "bleeding");
      await postStatusMessage(
        actor,
        getStatusLabel("bleeding"),
        `${actor.name} passes an Endurance test (${test.total}, ${test.color}) and the bleeding stops.`,
        "good"
      );
    } else if (test) {
      await postStatusMessage(
        actor,
        getStatusLabel("bleeding"),
        `${actor.name} fails the Endurance test to stop the bleeding (${test.total}, ${test.color}).`,
        "bad"
      );
    }
  }

  // Poison / disease: Endurance test, failure costs health, Red clears it
  for (const statusId of ENDURANCE_TEST_STATUSES) {
    for (const effect of getStatusEffects(actor, statusId)) {
      const label = getStatusLabel(statusId);
      const test = await rollColor(actor, "endurance");
      if (!test) continue;

      if (test.color === RollResult.Red) {
        if (actor.effects.get(effect.id)) {
          await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
        }
        await postStatusMessage(
          actor,
          label,
          `${actor.name} shakes off the ${label.toLowerCase()} (Endurance ${test.total}, ${test.color}).`,
          "good"
        );
      } else if (test.color === RollResult.White) {
        const { amount } = getTickAmount(effect);
        const outcome = await dealHealthDamage(
          actor,
          tokenId,
          amount,
          "dot",
          true,
          label
        );
        await postStatusMessage(
          actor,
          label,
          `${actor.name} fails the Endurance test (${test.total}, ${test.color}) and takes ${outcome}.`,
          "bad"
        );
      } else {
        await postStatusMessage(
          actor,
          label,
          `${actor.name} resists the ${label.toLowerCase()} this turn (Endurance ${test.total}, ${test.color}).`
        );
      }
    }
  }

  // Regeneration
  for (const effect of getStatusEffects(actor, "regen")) {
    await applyRegen(actor, effect);
  }

  // Escape attempts
  for (const statusId of ESCAPE_STATUSES) {
    if (!hasStatus(actor, statusId)) continue;
    const label = getStatusLabel(statusId);
    const test = await rollColor(actor, "strength");
    if (!test) continue;

    if (isYellowOrBetter(test.color)) {
      await removeStatusEffects(actor, statusId);
      await postStatusMessage(
        actor,
        label,
        `${actor.name} breaks free (Strength ${test.total}, ${test.color}).`,
        "good"
      );
    } else {
      await postStatusMessage(
        actor,
        label,
        `${actor.name} fails to break free (Strength ${test.total}, ${test.color}).`,
        "bad"
      );
    }
  }
}

/**
 * Run turn-start status processing for each combatant whose turn just began.
 * Called from the updateCombat hook in faserip.ts (active GM only).
 */
export async function tickStatusEffectsForCombatants(
  combatants: any[]
): Promise<void> {
  const processed = new Set<string>();

  for (const combatant of combatants) {
    const actor = combatant.token?.actor || combatant.actor;
    if (!actor) continue;

    const key = actor.uuid || actor.id || combatant.id;
    if (processed.has(key)) continue;
    processed.add(key);

    try {
      await tickActor(actor, combatant.token?.id);
    } catch (err) {
      console.error(
        `faserip | failed to process status effects for ${actor.name}`,
        err
      );
    }
  }
}
