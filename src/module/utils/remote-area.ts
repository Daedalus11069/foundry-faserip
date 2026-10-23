/**
 * Remote-placed areas
 *
 * A weapon or power whose `areaOfEffect.remotePlaced` is on isn't aimed at a
 * target token. Its button is dragged onto the canvas instead and the area is
 * placed where it's dropped, even on an empty square - the grenade-at-a-spot
 * case. Dropping rolls the attack (the weapon's own stat, or the power's own
 * rank); anything but a white result lands exactly on the dropped spot, a
 * white scatters it. Whoever ends up inside the area (any disposition,
 * including the thrower) is then attacked through the normal combat flow with
 * that single roll, and the region stays behind to tick damage over time.
 *
 * The sheet starts a drag with startRemoteAreaDrag; the drop itself arrives
 * through the dropCanvasData hook registered by registerRemoteAreaHooks. The
 * drag payload lives in this module rather than in the DataTransfer so the
 * drop can re-run the sheet's own roll function (dialogs, karma, combos)
 * unchanged.
 */
import { getConfiguredMovementByRank, type FaseripActor } from "../documents";
import type { FaseripRoll } from "../rolling/FaseripRoll";
import { RollResult, type Rank } from "../enums";
import type {
  PowerDamageDebuffData,
  PowerDotData,
  PowerStatDebuffData,
  WeaponAreaOfEffectData
} from "../types/actor-system";
import {
  getDamageBuffShiftForResult,
  getStatDebuffShiftForResult
} from "./stat-debuffs";
import {
  placeAreaOfEffectAt,
  rollEntryDuration,
  type ResolvedDamageShift,
  type ResolvedStatShift
} from "./area-of-effect";
import {
  aimDirection,
  buildStaticRegionShapeData,
  rectanglePoints,
  getCoveredSpaceOutlines,
  getTokensInEffectShape,
  type EffectRegionShapeConfig
} from "./region-effects";

export const REMOTE_AREA_DRAG_TYPE = "faserip.remoteArea";

/** How far a white (missed) roll scatters the area off the dropped spot, in grid squares. */
const SCATTER_SQUARES_FORMULA = "1d6";

type Point = { x: number; y: number };

export interface RemoteAreaDrag {
  actor: FaseripActor;
  aoe: WeaponAreaOfEffectData;
  /** The weapon's/power's damage rank; sets how big a hand-drawn rectangle may get when no size is configured. */
  rank?: Rank;
  /** Runs the sheet's own roll flow for the dropped spot. */
  run: (point: Point) => Promise<void>;
}

let activeDrag: RemoteAreaDrag | null = null;
let preview: { shape: any; range: any } | null = null;

export function isRemotePlaced(
  thing: { areaOfEffect?: WeaponAreaOfEffectData } | null | undefined
): boolean {
  return !!(thing?.areaOfEffect?.enabled && thing.areaOfEffect.remotePlaced);
}

function shapeConfig(
  aoe: WeaponAreaOfEffectData,
  direction = 0
): EffectRegionShapeConfig {
  return {
    type: aoe.shape,
    size: aoe.size,
    width: aoe.width,
    angle: aoe.angle,
    direction
  };
}

function snapPoint(point: Point): Point {
  try {
    return (canvas as any).grid.getSnappedPoint(point, {
      mode: CONST.GRID_SNAPPING_MODES.CENTER
    });
  } catch {
    return point;
  }
}

function distanceFeet(a: Point, b: Point): number {
  return (canvas as any).grid.measurePath([a, b], {})?.distance ?? 0;
}

function getCasterToken(actor: FaseripActor): any | undefined {
  return actor.getActiveTokens(true)[0];
}

/** Why the spot is out of reach, or null when it's within the area's max range. */
function rangeError(drag: RemoteAreaDrag, point: Point): string | null {
  const max = Number(drag.aoe.maxRangeFeet) || 0;
  if (max <= 0) return null;
  const token = getCasterToken(drag.actor);
  if (!token) return null;
  const distance = distanceFeet(token.center, point);
  if (distance <= max) return null;
  const unit = (canvas as any).scene?.grid?.units || "ft";
  return `That spot is ${Math.round(distance)} ${unit} away - the most it can be placed is ${max} ${unit}.`;
}

/**
 * Fills the grid spaces the shape covers, drawn into a Graphics positioned at
 * `graphicsAt` (shape data is local to `at`, the scene point it's placed on).
 */
function drawCoveredSquares(
  g: any,
  data: any,
  at: Point,
  graphicsAt: Point,
  color: number
) {
  g.lineStyle(1, color, 0.6);
  g.beginFill(color, 0.2);
  for (const ring of getCoveredSpaceOutlines(data, at)) {
    g.drawPolygon(
      ring.map((value, i) => value - (i % 2 === 0 ? graphicsAt.x : graphicsAt.y))
    );
  }
  g.endFill();
}

function drawPreview(point: Point, inRange: boolean) {
  if (!preview || !activeDrag) return;
  const { aoe } = activeDrag;
  const color = inRange ? Color.from(aoe.color || "#ff0000").valueOf() : 0x888888;
  const data = buildStaticRegionShapeData(
    (canvas as any).scene,
    shapeConfig(aoe, aimDirection(getCasterToken(activeDrag.actor)?.center, point)),
    { x: 0, y: 0 }
  );

  const g = preview.shape;
  g.clear();
  drawCoveredSquares(g, data, point, point, color);
  g.lineStyle(2, color, 0.9);
  g.beginFill(color, 0.25);
  if (data.type === "circle") g.drawCircle(data.x, data.y, data.radius);
  else if (data.type === "rectangle") g.drawPolygon(rectanglePoints(data));
  else if (data.type === "polygon") g.drawPolygon(data.points);
  g.endFill();
  g.position.set(point.x, point.y);
}

function onBoardDragOver(event: DragEvent) {
  if (!activeDrag) return;
  lastDragCtrl = event.ctrlKey;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  const raw = (canvas as any).canvasCoordinatesFromClient({
    x: event.clientX,
    y: event.clientY
  });
  const point = snapPoint(raw);
  drawPreview(point, rangeError(activeDrag, point) === null);
}

function attachPreview(drag: RemoteAreaDrag) {
  const board = document.getElementById("board");
  const layer = (canvas as any)?.interface;
  if (!board || !layer) return;

  const shape = new PIXI.Graphics();
  const range = new PIXI.Graphics();
  layer.addChild(range);
  layer.addChild(shape);
  preview = { shape, range };

  // A ring around the thrower showing how far the area can be placed
  const max = Number(drag.aoe.maxRangeFeet) || 0;
  const token = getCasterToken(drag.actor);
  if (max > 0 && token) {
    const scene = (canvas as any).scene;
    const radius = (max / (scene.grid.distance || 1)) * scene.grid.size;
    range.lineStyle(2, 0xffffff, 0.5);
    range.drawCircle(token.center.x, token.center.y, radius);
  }

  board.addEventListener("dragover", onBoardDragOver);
}

function detachPreview() {
  document.getElementById("board")?.removeEventListener("dragover", onBoardDragOver);
  if (preview) {
    preview.shape.destroy();
    preview.range.destroy();
    preview = null;
  }
}


/** A hand-drawn rectangle (Ctrl-drop), in scene distance units, consumed by landRemoteArea. */
interface ManualRect {
  center: Point;
  length: number;
  width: number;
  /** Direction value buildStaticRegionShapeData expects (the wall runs across it). */
  direction: number;
}

let manualShape: ManualRect | null = null;
let lastDragCtrl = false;

interface ManualSession {
  drag: RemoteAreaDrag;
  anchor: Point | null;
  /** Set by the second click; until then the wheel rotates the rectangle about its corner. */
  rotationLocked: boolean;
  cursor: Point;
  rotation: number; // degrees; the length axis
  maxLengthPx: number;
  maxWidthPx: number;
  gfx: any;
  range: any;
  label: any;
  hint: any;
  stop: () => void;
}

let manualSession: ManualSession | null = null;

/**
 * Biggest the hand-drawn rectangle may get, in scene distance units: the
 * area's configured Length/Width where set, otherwise the distance its damage
 * rank covers (the same movement-by-rank table auras use).
 */
function maxManualSize(drag: RemoteAreaDrag): { length: number; width: number } {
  const gridDistance = (canvas as any).scene?.grid?.distance || 1;
  let rankFeet = 0;
  if (drag.rank) {
    const squares = getConfiguredMovementByRank()[drag.rank] ?? 0;
    rankFeet = squares * gridDistance;
  }
  const configuredLength = Number(drag.aoe.size) || 0;
  const configuredWidth = Number(drag.aoe.width) || 0;
  const length = configuredLength > 0 ? configuredLength : rankFeet || gridDistance;
  const width = configuredWidth > 0 ? configuredWidth : length;
  return { length, width };
}

function manualRect(s: ManualSession) {
  const gridSize = (canvas as any).scene.grid.size;
  const rad = (s.rotation * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  const v = { x: -Math.sin(rad), y: Math.cos(rad) };

  const previewLength = Math.min(s.maxLengthPx, gridSize * 2);
  const previewWidth = Math.min(s.maxWidthPx, gridSize);

  if (!s.anchor) {
    // Marker for where the corner will go
    return { center: s.cursor, length: previewWidth, width: previewWidth };
  }
  if (!s.rotationLocked) {
    // Corner fixed, rotating about it
    return {
      center: {
        x: s.anchor.x + u.x * (previewLength / 2) + v.x * (previewWidth / 2),
        y: s.anchor.y + u.y * (previewLength / 2) + v.y * (previewWidth / 2)
      },
      length: previewLength,
      width: previewWidth
    };
  }

  const dx = s.cursor.x - s.anchor.x;
  const dy = s.cursor.y - s.anchor.y;
  const l = dx * u.x + dy * u.y;
  const w = dx * v.x + dy * v.y;
  const minPx = gridSize / 2;
  const length = Math.min(s.maxLengthPx, Math.max(minPx, Math.abs(l)));
  const width = Math.min(s.maxWidthPx, Math.max(minPx, Math.abs(w)));
  const sl = (l < 0 ? -1 : 1) * (length / 2);
  const sw = (w < 0 ? -1 : 1) * (width / 2);
  return {
    center: {
      x: s.anchor.x + u.x * sl + v.x * sw,
      y: s.anchor.y + u.y * sl + v.y * sw
    },
    length,
    width
  };
}

function drawManual(s: ManualSession) {
  const scene = (canvas as any).scene;
  const rect = manualRect(s);
  const color = Color.from(s.drag.aoe.color || "#ff0000").valueOf();
  const rectData = {
    type: "rectangle",
    x: rect.center.x - rect.length / 2,
    y: rect.center.y - rect.width / 2,
    width: rect.length,
    height: rect.width,
    rotation: s.rotation
  };
  s.gfx.clear();
  drawCoveredSquares(s.gfx, rectData, { x: 0, y: 0 }, { x: 0, y: 0 }, color);
  s.gfx.lineStyle(2, color, 0.9);
  s.gfx.beginFill(color, 0.25);
  s.gfx.drawPolygon(rectanglePoints(rectData));
  s.gfx.endFill();

  const perUnit = scene.grid.distance / scene.grid.size;
  s.label.text = `${Math.round(rect.length * perUnit)} x ${Math.round(rect.width * perUnit)} ${scene.grid.units || "ft"}`;
  s.hint.text = !s.anchor
    ? "Click to set a corner (Esc / right-click cancels)"
    : !s.rotationLocked
      ? "Mouse wheel to rotate (Shift = fine), click to lock"
      : "Move to size, click to place";

  // Keep the text a constant on-screen size whatever the canvas zoom
  const scale = 1 / ((canvas as any).stage?.scale?.x || 1);
  for (const text of [s.label, s.hint]) text.scale.set(scale);
  s.label.position.set(s.cursor.x + 12 * scale, s.cursor.y + 12 * scale);
  s.hint.position.set(s.cursor.x + 12 * scale, s.cursor.y + 32 * scale);
}

/** A cone/ray aimed by hand, in scene distance units, consumed by landRemoteArea. */
interface ManualRadial {
  length: number;
  direction: number;
}

let manualRadial: ManualRadial | null = null;
let radialStop: (() => void) | null = null;

export function cancelManualPlacement() {
  manualSession?.stop();
  radialStop?.();
}

/**
 * Drop of a cone or ray: the dropped spot is its origin; the player then moves
 * the cursor to aim it and set how far it extends (capped by the area's Length,
 * or the damage rank's reach when none is set) and clicks to place it. The
 * cone's spread comes from the area's configured Angle, the ray's thickness
 * from its Width. Esc or right-click cancels.
 */
function startRadialPlacement(drag: RemoteAreaDrag, origin: Point) {
  cancelManualPlacement();
  const board = document.getElementById("board");
  const layer = (canvas as any)?.interface;
  const scene = (canvas as any)?.scene;
  if (!board || !layer || !scene) return;

  const perUnit = scene.grid.distance / scene.grid.size;
  const maxLengthPx = maxManualSize(drag).length / perUnit;
  const minPx = scene.grid.size / 2;
  const casterCenter = getCasterToken(drag.actor)?.center;

  const gfx = new PIXI.Graphics();
  const range = new PIXI.Graphics();
  const label = new PIXI.Text("", {
    fontSize: 14,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 3
  });
  const hint = new PIXI.Text("Move to aim and size, click to place (Esc / right-click cancels)", {
    fontSize: 12,
    fill: 0xffee99,
    stroke: 0x000000,
    strokeThickness: 3
  });
  layer.addChild(range);
  layer.addChild(gfx);
  layer.addChild(label);
  layer.addChild(hint);

  const maxRange = Number(drag.aoe.maxRangeFeet) || 0;
  if (maxRange > 0 && casterCenter) {
    range.lineStyle(2, 0xffffff, 0.5);
    range.drawCircle(casterCenter.x, casterCenter.y, maxRange / perUnit);
  }

  let cursor: Point = origin;
  // Until the cursor moves, aim away from the caster at the shortest length
  const aim = () => {
    const moved = cursor.x !== origin.x || cursor.y !== origin.y;
    const direction = moved
      ? aimDirection(origin, cursor)
      : aimDirection(casterCenter, origin);
    const reach = moved ? Math.hypot(cursor.x - origin.x, cursor.y - origin.y) : minPx;
    const lengthPx = Math.min(maxLengthPx, Math.max(minPx, reach));
    return { direction, lengthPx };
  };

  const draw = () => {
    const { direction, lengthPx } = aim();
    const color = Color.from(drag.aoe.color || "#ff0000").valueOf();
    const data = buildStaticRegionShapeData(
      scene,
      shapeConfig({ ...drag.aoe, size: lengthPx * perUnit }, direction),
      { x: 0, y: 0 }
    );
    gfx.clear();
    drawCoveredSquares(gfx, data, origin, origin, color);
    gfx.lineStyle(2, color, 0.9);
    gfx.beginFill(color, 0.25);
    if (data.type === "rectangle") gfx.drawPolygon(rectanglePoints(data));
    else if (data.type === "polygon") gfx.drawPolygon(data.points);
    gfx.endFill();
    gfx.position.set(origin.x, origin.y);

    label.text = `${Math.round(lengthPx * perUnit)} ${scene.grid.units || "ft"}`;
    const scale = 1 / ((canvas as any).stage?.scale?.x || 1);
    for (const text of [label, hint]) text.scale.set(scale);
    label.position.set(cursor.x + 12 * scale, cursor.y + 12 * scale);
    hint.position.set(cursor.x + 12 * scale, cursor.y + 32 * scale);
  };

  const toScene = (event: MouseEvent): Point =>
    (canvas as any).canvasCoordinatesFromClient({
      x: event.clientX,
      y: event.clientY
    });
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onMove = (event: PointerEvent) => {
    cursor = toScene(event);
    draw();
  };
  const onDown = (event: PointerEvent) => {
    swallow(event);
    if (event.button === 2) return stop();
    if (event.button !== 0) return;

    cursor = toScene(event);
    const { direction, lengthPx } = aim();
    stop();
    manualRadial = { length: lengthPx * perUnit, direction };
    drag.run(origin).catch(err => {
      manualRadial = null;
      console.error("faserip | remote area placement failed", err);
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    stop();
  };
  const onContext = (event: Event) => swallow(event);

  board.addEventListener("pointermove", onMove, true);
  board.addEventListener("pointerdown", onDown, true);
  board.addEventListener("contextmenu", onContext, true);
  window.addEventListener("keydown", onKey, true);

  const stop = () => {
    board.removeEventListener("pointermove", onMove, true);
    board.removeEventListener("pointerdown", onDown, true);
    board.removeEventListener("contextmenu", onContext, true);
    window.removeEventListener("keydown", onKey, true);
    gfx.destroy();
    range.destroy();
    label.destroy();
    hint.destroy();
    if (radialStop === stop) radialStop = null;
  };
  radialStop = stop;

  draw();
}

/**
 * Ctrl-drop of a rectangle: instead of landing at the dropped spot, the
 * player clicks to fix one corner, rotates the rectangle about it with the
 * mouse wheel (Shift = fine) and clicks, then moves the cursor to size it
 * (capped by maxManualSize) and clicks again to place it. Esc or right-click
 * cancels.
 */
function startManualPlacement(drag: RemoteAreaDrag, start: Point) {
  cancelManualPlacement();
  const board = document.getElementById("board");
  const layer = (canvas as any)?.interface;
  const scene = (canvas as any)?.scene;
  if (!board || !layer || !scene) return;

  const max = maxManualSize(drag);
  const toPx = (units: number) => (units / (scene.grid.distance || 1)) * scene.grid.size;
  const casterCenter = getCasterToken(drag.actor)?.center;

  const gfx = new PIXI.Graphics();
  const range = new PIXI.Graphics();
  const label = new PIXI.Text("", {
    fontSize: 14,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 3
  });
  const hint = new PIXI.Text("", {
    fontSize: 12,
    fill: 0xffee99,
    stroke: 0x000000,
    strokeThickness: 3
  });
  layer.addChild(range);
  layer.addChild(gfx);
  layer.addChild(label);
  layer.addChild(hint);

  const maxRange = Number(drag.aoe.maxRangeFeet) || 0;
  if (maxRange > 0 && casterCenter) {
    range.lineStyle(2, 0xffffff, 0.5);
    range.drawCircle(casterCenter.x, casterCenter.y, toPx(maxRange));
  }

  // Hand-drawn placement is free-form: no grid snapping, so a rotated
  // rectangle can be sized along its own axes.
  const cursor = start;
  const s: ManualSession = {
    drag,
    anchor: null,
    rotationLocked: false,
    cursor,
    rotation: aimDirection(casterCenter, cursor) + 90,
    maxLengthPx: toPx(max.length),
    maxWidthPx: toPx(max.width),
    gfx,
    range,
    label,
    hint,
    stop: () => {}
  };

  const toScene = (event: MouseEvent): Point =>
    (canvas as any).canvasCoordinatesFromClient({
      x: event.clientX,
      y: event.clientY
    });

  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onMove = (event: PointerEvent) => {
    s.cursor = toScene(event);
    drawManual(s);
  };
  const onWheel = (event: WheelEvent) => {
    swallow(event);
    if (s.rotationLocked) return;
    const step = event.shiftKey ? 1 : 15;
    s.rotation += (event.deltaY < 0 ? 1 : -1) * step;
    drawManual(s);
  };
  const onDown = (event: PointerEvent) => {
    swallow(event);
    if (event.button === 2) return s.stop();
    if (event.button !== 0) return;

    s.cursor = toScene(event);
    if (!s.anchor) {
      const error = rangeError(drag, s.cursor);
      if (error) {
        ui.notifications?.warn(error);
        return;
      }
      s.anchor = s.cursor;
      drawManual(s);
      return;
    }
    if (!s.rotationLocked) {
      s.rotationLocked = true;
      drawManual(s);
      return;
    }

    const rect = manualRect(s);
    const perUnit = scene.grid.distance / scene.grid.size;
    s.stop();
    manualShape = {
      center: rect.center,
      length: rect.length * perUnit,
      width: rect.width * perUnit,
      direction: s.rotation - 90
    };
    drag.run(rect.center).catch(err => {
      manualShape = null;
      console.error("faserip | remote area placement failed", err);
    });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    s.stop();
  };
  const onContext = (event: Event) => swallow(event);

  board.addEventListener("pointermove", onMove, true);
  board.addEventListener("wheel", onWheel, { capture: true, passive: false });
  board.addEventListener("pointerdown", onDown, true);
  board.addEventListener("contextmenu", onContext, true);
  window.addEventListener("keydown", onKey, true);

  s.stop = () => {
    board.removeEventListener("pointermove", onMove, true);
    board.removeEventListener("wheel", onWheel, true);
    board.removeEventListener("pointerdown", onDown, true);
    board.removeEventListener("contextmenu", onContext, true);
    window.removeEventListener("keydown", onKey, true);
    gfx.destroy();
    range.destroy();
    label.destroy();
    hint.destroy();
    if (manualSession === s) manualSession = null;
  };
  manualSession = s;

  drawManual(s);
}

/** Begin dragging a remote-placed weapon/power button; pair with endRemoteAreaDrag on dragend. */
export function startRemoteAreaDrag(event: DragEvent, drag: RemoteAreaDrag) {
  endRemoteAreaDrag();
  manualShape = null;
  manualRadial = null;
  lastDragCtrl = false;
  activeDrag = drag;
  if (event.dataTransfer) {
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({ type: REMOTE_AREA_DRAG_TYPE })
    );
    event.dataTransfer.effectAllowed = "copy";
  }
  attachPreview(drag);
}

export function endRemoteAreaDrag() {
  activeDrag = null;
  detachPreview();
}

export function registerRemoteAreaHooks() {
  Hooks.on("dropCanvasData", (_canvas: any, data: any) => {
    if (data?.type !== REMOTE_AREA_DRAG_TYPE) return;

    const drag = activeDrag;
    endRemoteAreaDrag();
    if (!drag) return false;

    const point = snapPoint({ x: data.x, y: data.y });
    const ctrl = lastDragCtrl;
    lastDragCtrl = false;
    if (ctrl && drag.aoe.shape === "rect") {
      startManualPlacement(drag, { x: data.x, y: data.y });
      return false;
    }
    const error = rangeError(drag, point);
    if (error) {
      ui.notifications?.warn(error);
      return false;
    }
    if (drag.aoe.shape === "cone" || drag.aoe.shape === "ray") {
      startRadialPlacement(drag, point);
      return false;
    }

    drag.run(point).catch(err => {
      console.error("faserip | remote area placement failed", err);
    });
    return false; // handled - don't let core try to interpret the drop
  });
}

interface RemoteAreaOptions {
  attacker: FaseripActor;
  origin: Point;
  aoe: WeaponAreaOfEffectData;
  name: string;
  dots?: PowerDotData[];
  /** Rank for DoT entries that don't set their own. */
  dotRank?: string;
  statDebuffs?: PowerStatDebuffData[];
  damageBuffs?: PowerDamageDebuffData[];
}

/**
 * Extra executeCombatAttack arguments for a remote-placed area: the attack
 * rolls with no targets, then lands the area (see landRemoteArea) and attacks
 * whoever is inside it with that one roll.
 */
export function remoteAttackExtras(opts: RemoteAreaOptions) {
  return {
    multiHit: true as const, // one roll for everyone in the area, no combo penalty
    resolveTargetsAfterRoll: (roll: FaseripRoll) => landRemoteArea(opts, roll)
  };
}

/** Scatter the spot in a random direction by 1d6 squares, kept on the scene. */
async function scatter(origin: Point): Promise<{ point: Point; squares: number }> {
  const scene = (canvas as any).scene;
  const roll = Roll.create(SCATTER_SQUARES_FORMULA);
  await roll.evaluate();
  const squares = Math.max(1, Math.floor(roll.total || 1));
  const angle = CONFIG.Dice.randomUniform() * Math.PI * 2;
  const pixels = squares * scene.grid.size;

  const rect = (canvas as any).dimensions.sceneRect;
  const point = {
    x: Math.min(rect.right, Math.max(rect.left, origin.x + Math.cos(angle) * pixels)),
    y: Math.min(rect.bottom, Math.max(rect.top, origin.y + Math.sin(angle) * pixels))
  };
  return { point: snapPoint(point), squares };
}

async function landRemoteArea(
  opts: RemoteAreaOptions,
  roll: FaseripRoll
): Promise<Token[]> {
  const scene = (canvas as any).scene;
  if (!scene) return [];

  // A hand-drawn (Ctrl) rectangle carries its own size and rotation
  const manual = manualShape;
  manualShape = null;
  const radial = manualRadial;
  manualRadial = null;
  const aoe: WeaponAreaOfEffectData = manual
    ? { ...opts.aoe, shape: "rect", size: manual.length, width: manual.width }
    : radial
      ? { ...opts.aoe, size: radial.length }
      : opts.aoe;

  let origin = opts.origin;
  const rollTotal = roll.roll.total || 0;
  // Only circles scatter; rays, cones and rectangles are aimed and never go off target
  const offTarget = aoe.shape === "circle" && roll.result === RollResult.White;
  let scatterNote = "";
  if (offTarget) {
    const scattered = await scatter(origin);
    origin = scattered.point;
    const feet = Math.round(scattered.squares * (scene.grid.distance || 0));
    scatterNote = `Off target! It lands ${scattered.squares} square${scattered.squares === 1 ? "" : "s"} (${feet} ${scene.grid.units || "ft"}) away.`;
  }

  // Resolve each enabled (de)buff against the same roll, once, so the region
  // and any direct application agree - same as the on-hit path in combat-flow.
  const statShifts: ResolvedStatShift[] = [];
  for (const entry of opts.statDebuffs ?? []) {
    if (!entry.enabled) continue;
    const chartShift = getStatDebuffShiftForResult(entry, roll.result, rollTotal);
    if (!chartShift) continue;
    const duration = await rollEntryDuration(entry.durationFormula);
    statShifts.push({
      attribute: entry.attribute,
      chartShift,
      indefinite: duration.indefinite,
      roundsRemaining: duration.roundsRemaining
    });
  }
  const damageShifts: ResolvedDamageShift[] = [];
  for (const entry of opts.damageBuffs ?? []) {
    if (!entry.enabled) continue;
    const chartShift = getDamageBuffShiftForResult(entry, roll.result, rollTotal);
    if (!chartShift) continue;
    const duration = await rollEntryDuration(entry.durationFormula);
    damageShifts.push({
      chartShift,
      indefinite: duration.indefinite,
      roundsRemaining: duration.roundsRemaining
    });
  }

  const direction =
    manual?.direction ??
    radial?.direction ??
    aimDirection(getCasterToken(opts.attacker)?.center, origin);

  await placeAreaOfEffectAt(
    aoe,
    statShifts,
    damageShifts,
    opts.dots,
    opts.name,
    scene,
    origin,
    opts.dotRank,
    direction
  );

  const tokens = getTokensInEffectShape(scene, shapeConfig(aoe, direction), origin)
    .filter(doc => doc.actor)
    .map(doc => doc.object as Token)
    .filter(Boolean);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: opts.attacker }),
    content: `<div class="fsr-combat-message" style="padding: 0.5rem; border-radius: 4px;">
      <strong>${opts.attacker.name} launches ${opts.name}</strong>
      ${scatterNote ? `<p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;">${scatterNote}</p>` : ""}
      <p style="margin: 0.25rem 0 0 0; font-size: 0.9rem;"><strong>Caught in the area:</strong> ${tokens.length ? tokens.map(t => t.name).join(", ") : "nobody"}</p>
    </div>`
  });

  return tokens;
}
