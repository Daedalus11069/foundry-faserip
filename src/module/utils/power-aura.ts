/**
 * Power auras: a power marked isAura spawns an "emanation" Region natively
 * ATTACHED to its owner's token (RegionDocument.createTokenEmanation - core
 * Foundry handles all repositioning, including rotation/elevation, as the
 * token moves; there is no custom follow logic here at all), sized from the
 * movement-by-rank table keyed off the power's own rank (same table/
 * conversion as FaseripActor#movement in documents.ts). Like power negation/
 * dampening/enhancement (see utils/power-negation.ts), the actual chart-shift
 * effect on actors standing in the region is computed LIVE at the moment of a
 * roll rather than by creating/deleting stored ActiveEffects on Region
 * tokenEnter/tokenExit - this codebase deliberately avoids relying on those
 * events firing reliably (see power-negation.ts's header comment).
 *
 * Activating an aura rolls the power ONCE (by the activator, not by whoever
 * later enters the region) to pick which green/yellow/red tier of each
 * enabled statDebuffs/damageBuffs entry applies, and rolls ONE duration
 * (in rounds) for the whole aura from the first enabled entry's
 * durationFormula. Both are fixed for the aura's whole lifetime - entering/
 * leaving the region does not re-roll anything, it just turns the
 * already-resolved shift on/off for that actor. See activatePowerAura.
 */
import { Rank } from "../enums";
import { stringToRank } from "../utils";
import { getConfiguredMovementByRank } from "../documents";
import { FaseripRoll } from "../rolling/FaseripRoll";
import { getPowerChartShift } from "./power-negation";
import {
  getStatDebuffShiftForResult,
  getDamageBuffShiftForResult,
  type AttributeKey
} from "./stat-debuffs";

const AURA_FLAG_SCOPE = "faserip";
const AURA_FLAG_KEY = "activeAuraRegions";

function getAuraRegionMap(actor: any): Record<string, string> {
  return { ...(actor?.getFlag?.(AURA_FLAG_SCOPE, AURA_FLAG_KEY) ?? {}) };
}

/**
 * Ally/enemy relative to the owner token's disposition. Neutral/secret tokens
 * (or a missing disposition on either side) match neither "ally" nor "enemy" -
 * only an aura configured for "any" affects them.
 *
 * KNOWN LIMITATION: Foundry disposition is an absolute per-token value
 * (SECRET/HOSTILE/NEUTRAL/FRIENDLY), not a pairwise relationship, so two
 * rival NPC factions that are both HOSTILE (i.e. both hostile toward the
 * players) are indistinguishable here and will be treated as allies of each
 * other. This only supports the standard "PCs (friendly) vs. monsters
 * (hostile)" split, not multi-faction combat. Left as-is for now - would
 * need an explicit faction/grouping concept (e.g. keyed off actorTypes, a
 * folder, or a custom flag) to resolve.
 */
function resolveAuraRelation(
  ownerDisposition: number,
  targetDisposition: number
): "ally" | "enemy" | null {
  const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
  const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;

  if (ownerDisposition !== FRIENDLY && ownerDisposition !== HOSTILE) return null;
  if (targetDisposition !== FRIENDLY && targetDisposition !== HOSTILE) return null;

  return ownerDisposition === targetDisposition ? "ally" : "enemy";
}

/**
 * All powerAura region behaviors currently affecting this actor - i.e. one of
 * the actor's active tokens sits inside the behavior's region, the actor
 * isn't the aura's own owner (unless includeSelf), and the disposition filter
 * matches. Shared by getPowerAuraStatShift/getPowerAuraDamageShift.
 */
function getApplicableAuraBehaviors(actor: any): any[] {
  const tokens: any[] = actor?.getActiveTokens?.(true) ?? [];
  const results: any[] = [];

  for (const token of tokens) {
    const regions: Set<any> | null = token.document?.regions ?? null;
    if (!regions) continue;

    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (behavior.type !== "powerAura") continue;
        if (behavior.disabled) continue;

        const system = behavior.system ?? {};
        const ownerActorId = behavior.flags?.faserip?.ownerActorId;
        const isOwner = ownerActorId === actor.id;
        if (isOwner && !system.includeSelf) continue;

        if (!isOwner && system.disposition !== "any") {
          const ownerToken = game.actors
            ?.get(ownerActorId)
            ?.getActiveTokens?.(true)?.[0];
          const relation = resolveAuraRelation(
            ownerToken?.document?.disposition ?? token.document?.disposition,
            token.document?.disposition
          );
          if (relation !== system.disposition) continue;
        }

        results.push(behavior);
      }
    }
  }

  return results;
}

/** Live-computed aura stat chart shift affecting this actor's given attribute, for folding into getEffectiveAttributeData. */
export function getPowerAuraStatShift(
  actor: any,
  attribute: AttributeKey
): number {
  let total = 0;
  for (const behavior of getApplicableAuraBehaviors(actor)) {
    total += Number(behavior.system?.resolvedStatShifts?.[attribute] || 0);
  }
  return total;
}

/** Live-computed aura damage chart shift affecting this actor's own damage rolls. */
export function getPowerAuraDamageShift(actor: any): number {
  let total = 0;
  for (const behavior of getApplicableAuraBehaviors(actor)) {
    total += Number(behavior.system?.resolvedDamageShift || 0);
  }
  return total;
}

/**
 * Aura range in scene DISTANCE units (e.g. feet) - createTokenEmanation
 * converts this to pixels internally via the scene's distancePixels, so this
 * must NOT be pre-converted to pixels (unlike a plain RegionShape circle,
 * which does take a raw pixel radius).
 */
function auraRangeDistance(power: any): number {
  const rank = stringToRank(power.rank || Rank.Typical);
  const configured = getConfiguredMovementByRank();
  const squares = configured[rank] ?? configured[Rank.Typical];
  const gridDistance = canvas?.scene?.grid.distance ?? 1;
  return squares * gridDistance;
}

function findAuraRegion(regionId: string): any {
  for (const scene of game.scenes ?? []) {
    const region = scene.regions?.get(regionId);
    if (region) return region;
  }
  return null;
}

/**
 * Whether the given power currently has an active aura region for this
 * actor. Verifies the region the flag points at actually still exists - a
 * flag left over from a failed/interrupted activation (or a region deleted
 * out-of-band) would otherwise make this report "active" forever, silently
 * turning every future toggle into a no-op deactivate.
 */
export function isPowerAuraActive(actor: any, power: any): boolean {
  const regionId = getAuraRegionMap(actor)[power.id];
  if (!regionId) return false;
  return !!findAuraRegion(regionId);
}

/**
 * Roll the power once (by the activator), resolve each enabled statDebuffs/
 * damageBuffs entry's green/yellow/red shift against that single roll's
 * result, roll one duration for the whole aura, then spawn a circular Region
 * on the owner token's current scene carrying those RESOLVED shifts. Nothing
 * is rolled again when someone enters/leaves the region - see the file
 * header comment.
 */
export async function activatePowerAura(actor: any, power: any): Promise<void> {
  if (isPowerAuraActive(actor, power)) return;

  // Clear any stale flag entry (pointing at a region that no longer exists)
  // before creating a fresh one, so it doesn't linger as an orphaned key.
  const staleRegionId = getAuraRegionMap(actor)[power.id];
  if (staleRegionId) {
    const staleMap = getAuraRegionMap(actor);
    delete staleMap[power.id];
    await actor.setFlag(AURA_FLAG_SCOPE, AURA_FLAG_KEY, staleMap);
  }

  const token = actor?.getActiveTokens?.(true)?.[0];
  if (!token) {
    ui.notifications?.warn(
      `${power.name} needs a token on the current scene to activate its aura.`
    );
    return;
  }

  const rank = stringToRank(power.rank || Rank.Typical);
  const rankValue = power.value || 6;
  const totalCS = getPowerChartShift(actor);

  const faseripRoll = await FaseripRoll.rollAttribute(
    power.name,
    rank,
    rankValue,
    totalCS,
    actor
  );
  if (!faseripRoll) return;

  const rollTotal = faseripRoll.roll.total || 0;

  const resolvedStatShifts: Record<string, number> = {};
  for (const entry of power.statDebuffs ?? []) {
    if (!entry.enabled) continue;
    const shift = getStatDebuffShiftForResult(entry, faseripRoll.result, rollTotal);
    if (!shift) continue;
    resolvedStatShifts[entry.attribute] =
      (resolvedStatShifts[entry.attribute] ?? 0) + shift;
  }

  let resolvedDamageShift = 0;
  for (const entry of power.damageBuffs ?? []) {
    if (!entry.enabled) continue;
    resolvedDamageShift += getDamageBuffShiftForResult(
      entry,
      faseripRoll.result,
      rollTotal
    );
  }

  const durationFormula =
    (power.statDebuffs ?? []).find((e: any) => e.enabled)?.durationFormula ||
    (power.damageBuffs ?? []).find((e: any) => e.enabled)?.durationFormula ||
    "1d3";
  const indefinite = durationFormula.trim() === "indefinite";
  let roundsRemaining = 0;
  let durationRoll: Roll | undefined;
  if (!indefinite) {
    durationRoll = Roll.create(durationFormula);
    await durationRoll.evaluate();
    roundsRemaining = Math.max(1, Math.floor(durationRoll.total || 1));
  }

  const range = auraRangeDistance(power);

  // createTokenEmanation isn't in fvtt-types yet (a newer core Foundry API);
  // cast to any to call it.
  const RegionDocumentClass = CONFIG.Region.documentClass as any;
  const region = await RegionDocumentClass.createTokenEmanation(
    token.document,
    range,
    {
      name: `${power.name} Aura`,
      behaviors: [
        {
          name: power.name,
          type: "powerAura",
          system: {
            disposition: power.auraDisposition ?? "any",
            includeSelf: !!power.auraIncludeSelf,
            resolvedStatShifts,
            resolvedDamageShift
          },
          flags: {
            faserip: {
              ownerTokenId: token.id,
              ownerActorId: actor.id,
              sourcePowerId: power.id,
              indefinite,
              roundsRemaining
            }
          }
        }
      ]
    }
  );

  if (!region) {
    ui.notifications?.error(
      `Failed to create the aura region for ${power.name} - see console for details.`
    );
    return;
  }

  const regionMap = getAuraRegionMap(actor);
  regionMap[power.id] = region.id;
  await actor.setFlag(AURA_FLAG_SCOPE, AURA_FLAG_KEY, regionMap);

  const statText = Object.entries(resolvedStatShifts)
    .map(([attr, shift]) => `${attr} ${shift > 0 ? "+" : ""}${shift}CS`)
    .join(", ");
  const damageText =
    resolvedDamageShift !== 0
      ? `Damage ${resolvedDamageShift > 0 ? "+" : ""}${resolvedDamageShift}CS`
      : "";
  const effectText = [statText, damageText].filter(Boolean).join(" | ") || "no effect configured";

  const durationText = indefinite
    ? "until removed"
    : `for <strong>${roundsRemaining}</strong> rounds (${durationFormula})`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${power.name} - Aura Activated`,
    content: `<div class="fsr-combat-message" style="background: #4c1d95; color: #ede9fe; padding: 0.5rem; border-radius: 4px;">
      <strong>${power.name} Aura</strong> (${faseripRoll.getResultText()})
      <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${effectText} ${durationText}.</p>
    </div>`,
    rolls: durationRoll ? [durationRoll] : []
  });

  ui.notifications?.info(`${power.name} aura activated.`);
}

/** Remove the power's active aura region, if any. */
export async function deactivatePowerAura(actor: any, power: any): Promise<void> {
  const regionMap = getAuraRegionMap(actor);
  const regionId = regionMap[power.id];
  if (!regionId) return;

  delete regionMap[power.id];
  await actor.setFlag(AURA_FLAG_SCOPE, AURA_FLAG_KEY, regionMap);
  ui.notifications?.info(`${power.name} aura deactivated.`);

  // The region may already be gone (e.g. a GM deleted it manually, or the
  // owner's scene was deleted) - deleteEmbeddedDocuments on a missing id
  // throws, so look it up across every scene the actor's tokens might be on.
  for (const scene of game.scenes ?? []) {
    const region = scene.regions?.get(regionId);
    if (region) {
      await scene.deleteEmbeddedDocuments("Region", [regionId]);
      break;
    }
  }
}

/** Toggle a power's aura on/off - the entry point wired into rollPower. */
export async function togglePowerAura(actor: any, power: any): Promise<void> {
  if (isPowerAuraActive(actor, power)) {
    await deactivatePowerAura(actor, power);
  } else {
    await activatePowerAura(actor, power);
  }
}

/**
 * Delete an aura region whose flags.faserip.roundsRemaining just hit 0, and
 * clear the matching entry from its owner actor's activeAuraRegions flag so
 * isPowerAuraActive/togglePowerAura don't treat it as still active.
 */
async function expireAuraRegion(region: any, flags: any): Promise<void> {
  const ownerActor = flags.ownerActorId
    ? game.actors?.get(flags.ownerActorId)
    : null;

  if (ownerActor && flags.sourcePowerId) {
    const regionMap = getAuraRegionMap(ownerActor);
    if (regionMap[flags.sourcePowerId] === region.id) {
      delete regionMap[flags.sourcePowerId];
      await ownerActor.setFlag(AURA_FLAG_SCOPE, AURA_FLAG_KEY, regionMap);
    }
  }

  await region.parent?.deleteEmbeddedDocuments("Region", [region.id]);
  ui.notifications?.info(`${region.name} has expired.`);
}

/**
 * Decrement flags.faserip.roundsRemaining on every powerAura behavior across
 * every scene by one, deleting the region (and clearing its owner's flag)
 * once it hits zero. Call once per combat round from the same updateCombat
 * hook that ticks temp-effects.ts's other round-based modifiers, so an aura's
 * rolled duration counts down in real rounds just like an on-hit debuff's
 * does - unlike those, though, an aura outside combat simply never ticks
 * down (matching how temp-effects.ts's own roundsRemaining behaves outside
 * combat) rather than expiring on a real-time clock.
 */
export async function tickPowerAuraRegions(): Promise<void> {
  for (const scene of game.scenes ?? []) {
    for (const region of Array.from(scene.regions ?? [])) {
      for (const behavior of Array.from((region as any).behaviors ?? [])) {
        if ((behavior as any).type !== "powerAura") continue;

        const flags = (behavior as any).flags?.faserip;
        if (!flags || flags.indefinite || flags.roundsRemaining === undefined) {
          continue;
        }

        const next = Number(flags.roundsRemaining) - 1;
        try {
          if (next <= 0) {
            await expireAuraRegion(region, flags);
          } else {
            await (behavior as any).update({
              "flags.faserip.roundsRemaining": next
            });
          }
        } catch (err) {
          console.error(
            `faserip | failed to tick power aura region "${(region as any).name}"`,
            err
          );
        }
      }
    }
  }
}
