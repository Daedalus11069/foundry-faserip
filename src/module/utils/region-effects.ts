/**
 * Shared low-level Region creation, used by both power auras (utils/power-aura.ts)
 * and weapon on-hit area effects (utils/area-of-effect.ts). The two differ only
 * in whether the resulting Region follows a token around or sits still:
 *
 * - `follow: true` creates a core RegionDocument.createTokenEmanation attached
 *   to `token` - core handles all repositioning (including rotation/elevation)
 *   as the token moves. This is the pre-existing aura behavior and is
 *   unchanged by this refactor.
 * - `follow: false` (or omitted) creates a static Region shape anchored at
 *   `origin` (scene pixel coordinates) that never moves once placed - used
 *   for a weapon's on-hit blast/region, which is centered on the target at
 *   the moment of the hit but must NOT track the target afterward.
 */

export interface EffectRegionShapeConfig {
  type: "circle" | "cone" | "ray" | "rect";
  /** Distance units (not pixels): radius for circle, length for cone/ray/rect. */
  size: number;
  /** Distance units - only used for ray/rect. */
  width?: number;
  /** Degrees - only used for cone. */
  angle?: number;
  /** Degrees, 0 = east - only used for cone/ray/rect facing. Defaults to 0. */
  direction?: number;
}

export interface CreateEffectRegionOptions {
  scene: any;
  name: string;
  behaviors: any[];
  color?: string;
  /** true = attach a token-following emanation; false/omitted = static shape at `origin`. */
  follow?: boolean;
  /** Required when follow is true. */
  token?: any; // TokenDocument
  /** Required when follow is false/omitted - scene pixel coordinates. */
  origin?: { x: number; y: number };
  shape: EffectRegionShapeConfig;
  /**
   * Core's CONST.REGION_VISIBILITY value. Regions default to GM-only
   * visibility (CONST.REGION_VISIBILITY.LAYER - only shown while the Region
   * layer is active), so anything players should actually see on the canvas
   * (e.g. a weapon's blast region) needs this explicitly set to
   * CONST.REGION_VISIBILITY.ALWAYS. Omitted = core's default.
   */
  visibility?: number;
}

function toPixels(scene: any, units: number): number {
  const gridDistance = scene.grid?.distance ?? 1;
  const gridSize = scene.grid?.size ?? 100;
  return (units / gridDistance) * gridSize;
}

function buildStaticRegionShapeData(
  scene: any,
  shape: EffectRegionShapeConfig,
  origin: { x: number; y: number }
): any {
  const direction = shape.direction ?? 0;
  const directionRad = (direction * Math.PI) / 180;

  switch (shape.type) {
    case "circle":
      return {
        type: "circle",
        x: origin.x,
        y: origin.y,
        radius: toPixels(scene, shape.size)
      };
    case "rect":
    case "ray": {
      const length = toPixels(scene, shape.size);
      const width = toPixels(
        scene,
        shape.width ?? (shape.type === "ray" ? Math.max(1, shape.size * 0.1) : shape.size)
      );
      // Extends outward from the origin along `direction` (default east) -
      // there is no meaningful "facing" to inherit from a hit, so this is a
      // reasonable default rather than a rotated rectangle.
      return {
        type: "rectangle",
        x: origin.x,
        y: origin.y - width / 2,
        width: length,
        height: width,
        rotation: direction
      };
    }
    case "cone": {
      const length = toPixels(scene, shape.size);
      const halfAngle = ((shape.angle ?? 53) * Math.PI) / 360;
      const p2x = origin.x + length * Math.cos(directionRad - halfAngle);
      const p2y = origin.y + length * Math.sin(directionRad - halfAngle);
      const p3x = origin.x + length * Math.cos(directionRad + halfAngle);
      const p3y = origin.y + length * Math.sin(directionRad + halfAngle);
      return {
        type: "polygon",
        points: [origin.x, origin.y, p2x, p2y, p3x, p3y]
      };
    }
  }
}

/**
 * All non-disabled region behaviors of the given type(s) whose region
 * currently contains one of the actor's active tokens - core Foundry
 * maintains `TokenDocument#regions` for us, so this is just a lookup, not a
 * geometry check. Shared by power-aura.ts (powerAura) and
 * area-of-effect.ts (weaponAreaEffect) so both can live-compute a chart
 * shift from "am I standing in one of these regions right now" rather than
 * relying on tokenEnter/tokenExit events firing reliably.
 */
export function getContainingRegionBehaviors(
  actor: any,
  types: string[]
): any[] {
  const tokens: any[] = actor?.getActiveTokens?.(true) ?? [];
  const results: any[] = [];

  for (const token of tokens) {
    const regions: Set<any> | null = token.document?.regions ?? null;
    if (!regions) continue;

    for (const region of regions) {
      for (const behavior of region.behaviors ?? []) {
        if (!types.includes(behavior.type)) continue;
        if (behavior.disabled) continue;
        results.push(behavior);
      }
    }
  }

  return results;
}

/**
 * Creates a Region embedded document carrying the given behaviors, either
 * following a token (`follow: true`) or sitting static at `origin`
 * (`follow` false/omitted). See file header for why this boolean exists.
 */
export async function createEffectRegion(
  opts: CreateEffectRegionOptions
): Promise<any | null> {
  const RegionDocumentClass = CONFIG.Region.documentClass as any;

  if (opts.follow) {
    if (!opts.token) {
      throw new Error("createEffectRegion: `token` is required when follow is true");
    }
    return RegionDocumentClass.createTokenEmanation(opts.token, opts.shape.size, {
      name: opts.name,
      color: opts.color,
      visibility: opts.visibility,
      behaviors: opts.behaviors
    });
  }

  if (!opts.origin) {
    throw new Error("createEffectRegion: `origin` is required when follow is false");
  }

  const shapeData = buildStaticRegionShapeData(opts.scene, opts.shape, opts.origin);
  const [region] = await opts.scene.createEmbeddedDocuments("Region", [
    {
      name: opts.name,
      color: opts.color,
      visibility: opts.visibility,
      shapes: [shapeData],
      behaviors: opts.behaviors
    }
  ]);
  return region ?? null;
}
