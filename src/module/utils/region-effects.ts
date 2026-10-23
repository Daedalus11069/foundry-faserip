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
  /**
   * Degrees, 0 = east: the way the area is aimed, from the caster toward the
   * spot (see aimDirection). Rays and cones extend away along it; a rect is a
   * wall across it. Defaults to 0.
   */
  direction?: number;
}

/** Aim angle in degrees (0 = east) from one scene point toward another. */
export function aimDirection(
  from: { x: number; y: number } | undefined,
  to: { x: number; y: number }
): number {
  if (!from) return 0;
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** Corner points of a Region rectangle, which rotates around its own center. */
export function rectanglePoints(data: {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}): number[] {
  const cx = data.x + data.width / 2;
  const cy = data.y + data.height / 2;
  const rad = ((data.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const points: number[] = [];
  for (const [dx, dy] of [
    [-data.width / 2, -data.height / 2],
    [data.width / 2, -data.height / 2],
    [data.width / 2, data.height / 2],
    [-data.width / 2, data.height / 2]
  ]) {
    points.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
  }
  return points;
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

export function buildStaticRegionShapeData(
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
      if (shape.type === "rect") {
        // A wall centered on the spot, its length running across the aim so it
        // stands between the caster and whatever is beyond it.
        return {
          type: "rectangle",
          x: origin.x - length / 2,
          y: origin.y - width / 2,
          width: length,
          height: width,
          rotation: direction + 90
        };
      }
      // A ray starts at the spot and runs away from the caster along the aim.
      const cx = origin.x + (length / 2) * Math.cos(directionRad);
      const cy = origin.y + (length / 2) * Math.sin(directionRad);
      return {
        type: "rectangle",
        x: cx - length / 2,
        y: cy - width / 2,
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
 * Tokens on the scene whose center lies inside the static shape that
 * createEffectRegion would build for `shape` at `origin`. Computed from the
 * shape geometry instead of asking the freshly created Region, because a
 * player's Region is created by the GM and may not have reached this client
 * (or had `TokenDocument#regions` refreshed) by the time the caller needs the
 * answer.
 */
export function getTokensInEffectShape(
  scene: any,
  shape: EffectRegionShapeConfig,
  origin: { x: number; y: number }
): any[] {
  const data = buildStaticRegionShapeData(scene, shape, origin);
  const tokens: any[] = Array.from(scene.tokens ?? []);

  const contains = (p: { x: number; y: number }): boolean => {
    switch (data.type) {
      case "circle":
        return Math.hypot(p.x - data.x, p.y - data.y) <= data.radius;
      case "rectangle": {
        // Un-rotate the point around the rectangle's center, then test
        // against the axis-aligned box.
        const rad = (-(data.rotation ?? 0) * Math.PI) / 180;
        const dx = p.x - (data.x + data.width / 2);
        const dy = p.y - (data.y + data.height / 2);
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
        return Math.abs(lx) <= data.width / 2 && Math.abs(ly) <= data.height / 2;
      }
      case "polygon": {
        const pts: number[] = data.points;
        let inside = false;
        for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
          const xi = pts[i];
          const yi = pts[i + 1];
          const xj = pts[j];
          const yj = pts[j + 1];
          if (
            yi > p.y !== yj > p.y &&
            p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
          ) {
            inside = !inside;
          }
        }
        return inside;
      }
    }
    return false;
  };

  return tokens.filter(t => {
    const w = (t.width ?? 1) * (scene.grid?.size ?? 100);
    const h = (t.height ?? 1) * (scene.grid?.size ?? 100);
    return contains({ x: t.x + w / 2, y: t.y + h / 2 });
  });
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
