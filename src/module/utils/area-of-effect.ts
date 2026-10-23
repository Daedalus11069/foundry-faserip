import { Rank, RANK_VALUES, formatRankDisplay } from "../enums";
import type { PowerDotData, WeaponAreaOfEffectData } from "../types/actor-system";
import { aimDirection, getContainingRegionBehaviors } from "./region-effects";
import { requestDamageApplication, requestCreateEffectRegion } from "../socket/faserip-socket";
import type { AttributeKey } from "./stat-debuffs";

export interface ResolvedStatShift {
  attribute: string;
  chartShift: number;
  indefinite: boolean;
  roundsRemaining: number;
}

export interface ResolvedDamageShift {
  chartShift: number;
  indefinite: boolean;
  roundsRemaining: number;
}

/**
 * Rolls a duration formula ONCE - shared by the direct hit target's own
 * stat/damage debuff (applyHitStatDebuff/applyHitDamageBuff in
 * combat-flow.ts) and this same entry's copy on the area-of-effect region,
 * so both consumers agree on the exact same rolled number instead of each
 * independently re-rolling (which could - and did - produce two different
 * "duration remaining" values for what's conceptually one resolved debuff
 * instance). Callers resolve this ONCE per enabled entry per hit and reuse
 * the result everywhere it's needed. "indefinite" (trimmed) never expires.
 * Returns the underlying Roll (when not indefinite) so a caller can still
 * post its own "Duration Roll" chat card from it.
 */
export async function rollEntryDuration(
  durationFormula: string | undefined
): Promise<{ indefinite: boolean; roundsRemaining: number; roll?: Roll }> {
  const formula = (durationFormula || "1d3").trim();
  if (formula === "indefinite") {
    return { indefinite: true, roundsRemaining: 0 };
  }
  const roll = Roll.create(formula);
  await roll.evaluate();
  return {
    indefinite: false,
    roundsRemaining: Math.max(1, Math.floor(roll.total || 1)),
    roll
  };
}

/**
 * Renders dots/resolvedStatShifts/resolvedDamageShifts as one human-readable
 * line each, for the `summary` field - see WeaponAreaEffectRegionBehaviorType
 * for why this exists (Foundry's default RegionBehaviorConfig sheet can't
 * auto-render an ArrayField of SchemaFields, so the real tracking arrays are
 * otherwise invisible there).
 */
type RegionDot = {
  rank: string;
  armorPiercing?: string;
  indefinite?: boolean;
  roundsRemaining?: number;
};

function buildSummaryText(
  dots: RegionDot[],
  statShifts: Array<{
    attribute: string;
    chartShift: number;
    indefinite: boolean;
    roundsRemaining: number;
  }>,
  damageShifts: Array<{
    chartShift: number;
    indefinite: boolean;
    roundsRemaining: number;
  }>
): string {
  const parts: string[] = [];

  for (const d of dots) {
    const rankText = d.rank ? formatRankDisplay(d.rank as Rank) : "weapon's rank";
    const apText = d.armorPiercing
      ? ` (${formatRankDisplay(d.armorPiercing as Rank)} AP)`
      : "";
    const durationText = d.indefinite
      ? "indefinite"
      : `${d.roundsRemaining ?? 0} rd${d.roundsRemaining === 1 ? "" : "s"}`;
    parts.push(`DoT: ${rankText}${apText} (${durationText})`);
  }

  for (const s of statShifts) {
    const durationText = s.indefinite
      ? "indefinite"
      : `${s.roundsRemaining} rd${s.roundsRemaining === 1 ? "" : "s"}`;
    parts.push(
      `${s.attribute} ${s.chartShift > 0 ? "+" : ""}${s.chartShift}CS (${durationText})`
    );
  }

  for (const d of damageShifts) {
    const durationText = d.indefinite
      ? "indefinite"
      : `${d.roundsRemaining} rd${d.roundsRemaining === 1 ? "" : "s"}`;
    parts.push(
      `Damage ${d.chartShift > 0 ? "+" : ""}${d.chartShift}CS (${durationText})`
    );
  }

  return parts.join("; ") || "No active effects";
}

/**
 * Places a one-shot area-of-effect Region centered on a target token's
 * current position when a weapon with `areaOfEffect` configured hits it.
 * Built on the same createEffectRegion helper power-aura.ts uses, but with
 * `follow` omitted - the region is anchored at the target's position at the
 * moment of the hit and does NOT track or follow the target afterward.
 *
 * The region can carry any combination of the weapon's enabled `dots`/
 * `statDebuffs`/`damageBuffs` entries - EACH becomes its own tracked entry on
 * the region (own rolled duration, own expiry), even though they all live on
 * this single region document:
 *
 * - dots: one entry per enabled `dots` entry, each ticked every round
 *   against anyone standing inside (see tickWeaponAreaEffectRegions).
 * - Stat/damage (de)buffs: `resolvedStatShifts`/`resolvedDamageShifts` are
 *   ALREADY resolved (chart shift + rolled duration) by the caller - see
 *   combat-flow.ts, which resolves each enabled entry exactly once per hit
 *   and reuses that same result both here and for the direct hit target's
 *   own stat/damage debuff (applyHitStatDebuff/applyHitDamageBuff), so the
 *   two don't independently re-roll and disagree on a duration for what's
 *   conceptually the same debuff instance. Live-summed at the moment of a
 *   roll via getWeaponAreaEffectStatShift/getWeaponAreaEffectDamageShift -
 *   exactly like a power aura's resolved shifts, just per-entry (one debuff
 *   expiring doesn't affect another) and without an owner/disposition filter
 *   (a blast doesn't care who it hits).
 *
 * Either way, this reuses config the GM already set up on the weapon rather
 * than adding a separate configuration surface just for the region.
 */
export async function placeAreaOfEffectOnHit(
  aoe: WeaponAreaOfEffectData | undefined,
  resolvedStatShifts: ResolvedStatShift[],
  resolvedDamageShifts: ResolvedDamageShift[],
  dots: PowerDotData[] | undefined,
  weaponName: string,
  targetToken: Token,
  defaultDotRank?: string,
  /** The attacker's token - the area is aimed away from it, through the target. */
  attackerToken?: Token
): Promise<void> {
  const scene = targetToken.document?.parent;
  if (!scene) return;

  const center = targetToken.center as { x: number; y: number } | undefined;
  if (!center) return;

  await placeAreaOfEffectAt(
    aoe,
    resolvedStatShifts,
    resolvedDamageShifts,
    dots,
    weaponName,
    scene,
    center,
    defaultDotRank,
    aimDirection(attackerToken?.center, center),
    targetToken.id ?? undefined
  );
}

/**
 * Same as placeAreaOfEffectOnHit, but centered on an arbitrary scene point
 * instead of a target token - used when the weapon/power is dragged onto the
 * canvas (see utils/remote-area.ts), where there may be nothing at the spot.
 */
export async function placeAreaOfEffectAt(
  aoe: WeaponAreaOfEffectData | undefined,
  resolvedStatShifts: ResolvedStatShift[],
  resolvedDamageShifts: ResolvedDamageShift[],
  dots: PowerDotData[] | undefined,
  weaponName: string,
  scene: any,
  center: { x: number; y: number },
  /** Rank for DoT entries with no rank of their own (they follow the power/weapon's rank). */
  defaultDotRank?: string,
  /** Degrees, 0 = east; see EffectRegionShapeConfig.direction. */
  direction?: number,
  /** Token already dealt this hit's DoT directly - not re-damaged by the region this round. */
  excludeTokenId?: string
): Promise<void> {
  if (!aoe?.enabled) return;
  // Instant areas only define who is hit - nothing is left on the map
  if (aoe.instant) return;

  // Each DoT rolls its own duration once, same as the (de)buff entries.
  const regionDots: RegionDot[] = [];
  for (const d of (dots ?? []).filter(d => d.enabled)) {
    const duration = await rollEntryDuration(d.durationFormula);
    regionDots.push({
      rank: d.rank?.trim() || defaultDotRank || "",
      armorPiercing: d.armorPiercing || "",
      indefinite: duration.indefinite,
      roundsRemaining: duration.roundsRemaining
    });
  }

  // The region's own lifetime: the area's Auto-Remove setting when given,
  // otherwise it lasts as long as its longest-lived effect (indefinite if any
  // effect is, or if it carries none).
  const durationFormula = String(aoe.durationRounds ?? "").trim();
  let indefinite: boolean;
  let roundsRemaining: number | undefined;
  if (durationFormula && durationFormula !== "0") {
    indefinite = false;
    const durationRoll = Roll.create(durationFormula);
    await durationRoll.evaluate();
    roundsRemaining = durationRoll.total || 0;
  } else {
    const entries: Array<{ indefinite?: boolean; roundsRemaining?: number }> = [
      ...regionDots,
      ...resolvedStatShifts,
      ...resolvedDamageShifts
    ];
    indefinite = entries.length === 0 || entries.some(e => e.indefinite);
    if (!indefinite) {
      roundsRemaining = Math.max(...entries.map(e => Number(e.roundsRemaining) || 0));
    }
  }

  const activeCombat = (game as any).combat?.started ? (game as any).combat : null;
  const roundKey = combatRoundKey();

  // Creating an embedded Region requires Scene Update permission, which a
  // player landing a hit doesn't have by default - relayed through
  // requestCreateEffectRegion (via socketlib, as the GM) rather than calling
  // createEffectRegion directly here.
  await requestCreateEffectRegion({
    sceneUuid: scene.uuid,
    name: `${weaponName} Area`,
    color: aoe.color,
    // Regions default to GM-only visibility - this one represents a visible
    // blast/hazard on the battlefield, so players should see it too.
    // @ts-expect-error - CONST.REGION_VISIBILITY isn't in fvtt-types yet
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    origin: center,
    shape: {
      type: aoe.shape,
      size: aoe.size,
      width: aoe.width,
      angle: aoe.angle,
      direction
    },
    behaviors: [
      {
        name: weaponName,
        type: "weaponAreaEffect",
        system: {
          dots: regionDots,
          resolvedStatShifts,
          resolvedDamageShifts,
          summary: buildSummaryText(regionDots, resolvedStatShifts, resolvedDamageShifts)
        },
        flags: {
          faserip: {
            sourceWeaponName: weaponName,
            indefinite,
            roundsRemaining,
            // DoTs tick at the start of the turn this field was created on
            // (see tickWeaponAreaEffectRegions); a token entering sooner takes
            // its tick on entry instead, tracked in damagedRounds.
            creatorCombatantId: activeCombat?.combatant?.id ?? null,
            damagedRounds:
              excludeTokenId && roundKey ? { [excludeTokenId]: roundKey } : {}
          }
        }
      }
    ]
  });
}

/** Live-computed weapon-area-effect chart shift affecting this actor's given attribute. */
export function getWeaponAreaEffectStatShift(
  actor: any,
  attribute: AttributeKey
): number {
  let total = 0;
  for (const behavior of getContainingRegionBehaviors(actor, [
    "weaponAreaEffect"
  ])) {
    for (const entry of behavior.system?.resolvedStatShifts ?? []) {
      if (entry.attribute !== attribute) continue;
      if (!entry.indefinite && Number(entry.roundsRemaining) <= 0) continue;
      total += Number(entry.chartShift || 0);
    }
  }
  return total;
}

/** Live-computed weapon-area-effect chart shift affecting this actor's own damage rolls. */
export function getWeaponAreaEffectDamageShift(actor: any): number {
  let total = 0;
  for (const behavior of getContainingRegionBehaviors(actor, [
    "weaponAreaEffect"
  ])) {
    for (const entry of behavior.system?.resolvedDamageShifts ?? []) {
      if (!entry.indefinite && Number(entry.roundsRemaining) <= 0) continue;
      total += Number(entry.chartShift || 0);
    }
  }
  return total;
}

/** Identifies the current combat round, or null when no combat is running. */
function combatRoundKey(): string | null {
  const combat = (game as any).combat;
  return combat?.started ? `${combat.id}:${combat.round}` : null;
}

function activeDotEntries(behavior: any): RegionDot[] {
  return ((behavior.system?.dots ?? []) as RegionDot[]).filter(
    entry => entry.indefinite || Number(entry.roundsRemaining) > 0
  );
}

/**
 * Applies one tick of every active DoT on the region to a token, unless that
 * token was already damaged by this region this combat round (entry tick vs.
 * the creation-turn tick must never both land in one round). Records the tick
 * so the other path skips it.
 */
async function damageTokenFromRegion(
  region: any,
  behavior: any,
  token: any,
  dotEntries: RegionDot[]
): Promise<void> {
  if (!token?.actor || dotEntries.length === 0) return;

  const roundKey = combatRoundKey();
  const damagedRounds: Record<string, string> =
    behavior.flags?.faserip?.damagedRounds ?? {};
  if (roundKey && damagedRounds[token.id] === roundKey) return;

  for (const dotEntry of dotEntries) {
    const damage = RANK_VALUES[dotEntry.rank as Rank] ?? 0;
    if (damage <= 0) continue;

    try {
      await requestDamageApplication(
        token.actor,
        damage,
        "dot",
        region.name || "Area Effect",
        token.id,
        dotEntry.armorPiercing || null,
        undefined,
        1
      );
    } catch (err) {
      console.error(
        `faserip | failed to apply weapon area effect DoT tick to ${token.actor?.name}`,
        err
      );
    }
  }

  if (roundKey) {
    try {
      // Keep only this round's entries so the map doesn't grow unbounded.
      const kept = Object.fromEntries(
        Object.entries(damagedRounds).filter(([, key]) => key === roundKey)
      );
      kept[token.id] = roundKey;
      await behavior.update({ "flags.faserip.damagedRounds": kept });
    } catch (err) {
      console.error("faserip | failed to record weapon area effect DoT tick", err);
    }
  }
}

/** Entry tick: a token moving into a weapon area effect takes its DoTs immediately. */
export async function applyWeaponAreaEffectEntryDots(
  behavior: any,
  token: any
): Promise<void> {
  if (behavior.disabled) return;
  await damageTokenFromRegion(behavior.parent, behavior, token, activeDotEntries(behavior));
}

/**
 * Decrements roundsRemaining on every weaponAreaEffect behavior across every
 * scene by one, deleting the region once it hits zero (mirrors
 * tickPowerAuraRegions) - this governs the region's OVERALL lifetime,
 * regardless of individual effect entries. Then, for surviving regions:
 * decrements each resolvedStatShifts/resolvedDamageShifts entry's own
 * roundsRemaining independently, dropping only the ones that expire (one
 * debuff wearing off doesn't touch another); and applies one DoT tick per
 * `dots` entry to every actor whose token is currently inside.
 * Call once per combat round from the same updateCombat hook that ticks the
 * other round-based modifiers/auras.
 */
export async function tickWeaponAreaEffectRegions(
  combatantIds?: string[]
): Promise<void> {
  const combat = (game as any).combat;
  for (const scene of game.scenes ?? []) {
    for (const region of Array.from(scene.regions ?? [])) {
      for (const behavior of Array.from((region as any).behaviors ?? [])) {
        if ((behavior as any).type !== "weaponAreaEffect") continue;
        if ((behavior as any).disabled) continue;

        const flags = (behavior as any).flags?.faserip;

        // Each field ticks once per round, at the start of the turn it was
        // created on. Called with the combatants whose turn is starting; with
        // none (round change) it picks up fields with no usable creator turn
        // (made outside combat, or the creator has left the combat).
        const creatorId: string | null = flags?.creatorCombatantId ?? null;
        const creatorPresent = !!creatorId && !!combat?.combatants?.has(creatorId);
        if (combatantIds) {
          if (!creatorId || !combatantIds.includes(creatorId)) continue;
        } else if (creatorPresent) {
          continue;
        }

        if (flags && !flags.indefinite && flags.roundsRemaining !== undefined) {
          const next = Number(flags.roundsRemaining) - 1;
          try {
            if (next <= 0) {
              await scene.deleteEmbeddedDocuments("Region", [(region as any).id]);
              continue;
            } else {
              await (behavior as any).update({
                "flags.faserip.roundsRemaining": next
              });
            }
          } catch (err) {
            console.error(
              `faserip | failed to tick weapon area effect region "${(region as any).name}"`,
              err
            );
            continue;
          }
        }

        // Tick down each (de)buff entry's own duration independently.
        const statShifts = ((behavior as any).system?.resolvedStatShifts ?? [])
          .map((entry: any) =>
            entry.indefinite
              ? entry
              : { ...entry, roundsRemaining: Number(entry.roundsRemaining) - 1 }
          )
          .filter((entry: any) => entry.indefinite || entry.roundsRemaining > 0);
        const damageShifts = ((behavior as any).system?.resolvedDamageShifts ?? [])
          .map((entry: any) =>
            entry.indefinite
              ? entry
              : { ...entry, roundsRemaining: Number(entry.roundsRemaining) - 1 }
          )
          .filter((entry: any) => entry.indefinite || entry.roundsRemaining > 0);

        // DoTs tick this round at full effect, then lose a round of their own
        // duration; one wearing off doesn't touch another.
        const dotEntriesForSummary: RegionDot[] =
          (behavior as any).system?.dots ?? [];
        const remainingDots = dotEntriesForSummary
          .map(entry =>
            entry.indefinite
              ? entry
              : { ...entry, roundsRemaining: Number(entry.roundsRemaining) - 1 }
          )
          .filter(entry => entry.indefinite || Number(entry.roundsRemaining) > 0);

        try {
          await (behavior as any).update({
            "system.dots": remainingDots,
            "system.resolvedStatShifts": statShifts,
            "system.resolvedDamageShifts": damageShifts,
            "system.summary": buildSummaryText(
              remainingDots,
              statShifts,
              damageShifts
            )
          });
        } catch (err) {
          console.error(
            `faserip | failed to tick weapon area effect (de)buffs on "${(region as any).name}"`,
            err
          );
        }

        if (dotEntriesForSummary.length === 0) continue;

        const activeDots = dotEntriesForSummary.filter(
          entry => entry.indefinite || Number(entry.roundsRemaining) > 0
        );
        for (const token of scene.tokens ?? []) {
          // @ts-expect-error - TokenDocument#regions is a Set maintained by core
          if (!token.regions?.has(region)) continue;
          await damageTokenFromRegion(region, behavior, token, activeDots);
        }
      }
    }
  }
}
