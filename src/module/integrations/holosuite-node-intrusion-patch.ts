import { Rank, RollResult } from "../enums";
import {
  rollFaseripHackCheck,
  meetsRequiredColor,
  ROLL_COLOR_RANK,
  type FaseripHackContext,
  type HackTargetInfo
} from "./holosuite-roll-adapter";
import {
  isPvpTurn,
  recordAttackerCapture,
  unleashDefender,
  attemptRecapture,
  attemptScan,
  finishPvpRun,
  getDefenderPosition,
  setDefenderPosition,
  resolvePvpActor,
  initializePvpOwnership,
  registerPvpApp,
  unregisterPvpApp,
  buildPvpSnapshot,
  registerPvpActionHandler,
  NODE_OWNER_ATTACKER,
  type FaseripPvpConfig
} from "./holosuite-pvp-intrusion";
import { broadcastPvpState, openPvpDefenderView } from "../socket/faserip-socket";

// Registered once at module load - lets a remote defender action (arriving
// via faserip-socket.ts, on the attacker's client) reach this file's own
// move/recapture/scan logic without faserip-socket needing to import this
// file directly (see holosuite-pvp-intrusion.ts's registerPvpActionHandler).
/** Pushes a fresh snapshot to the defender's cross-client view, if one is
 * open for this run - a thin null-safe wrapper since buildPvpSnapshot can
 * return null for a non-pvp app (never actually happens at these call
 * sites, but keeps TypeScript honest). */
function syncPvp(app: any, pvp: FaseripPvpConfig): void {
  const snapshot = buildPvpSnapshot(app);
  if (snapshot) broadcastPvpState(pvp, snapshot);
}

registerPvpActionHandler(async (app, pvp, action) => {
  if (action.type === "move") {
    await handlePvpDefenderNodeClick(app, pvp, action.nodeId);
  } else {
    await handlePvpScan(app, pvp);
  }
});

declare const ui: any;
declare const ChatMessage: any;
declare const game: any;

declare const globalThis: any;

const FASERIP_MODULE_ID = "faserip";
const NODE_APP_GLOBAL_KEY = "__fsrHoloSuiteNodeIntrusionAppCtor";

export type { FaseripHackContext };

/**
 * Mirrors HoloSuite Hacking's own edgeKey() helper
 * (src/minigames/node-intrusion/node-intrusion-generator.ts):
 * `[leftId, rightId].sort().join("--")`. That function isn't exported
 * through their public API, so this is a local, order-independent
 * reimplementation kept in sync with their (trivial, stable) format.
 */
function edgeKey(leftId: string, rightId: string) {
  return [leftId, rightId].sort().join("--");
}

/** Node difficulty 1-3 -> the color the node-attempt roll must reach (or
 * beat) to avoid tripping detection at that node. */
const DIFFICULTY_REQUIRED_COLOR: Record<number, RollResult> = {
  1: RollResult.Green,
  2: RollResult.Yellow,
  3: RollResult.Red
};

/** Point-mode trace cost per node difficulty - harder nodes cost more
 * trace progress (out of 100) when a hack attempt trips detection. */
const DIFFICULTY_TRACE_POINTS: Record<number, number> = {
  1: 10,
  2: 20,
  3: 35
};

function getTraceMode(): "time" | "points" {
  return game.settings.get(FASERIP_MODULE_ID, "hackTraceMode") === "points"
    ? "points"
    : "time";
}

/**
 * Point-mode trace progress: unlike addTracePenalty(seconds), which converts
 * a duration into a percentage via getTraceDuration(), this adds a flat
 * percentage directly - point mode has no running clock to convert against.
 * Mirrors the clamping/completion behavior of HoloSuite's own
 * addTracePenalty (still calls finish() itself at 100%, same as stock).
 */
/**
 * HoloSuite's own firewall/decoy hazard handling (inside completeNodeClaim)
 * posts its own "trace accelerated by Xs" notification directly, before
 * addTracePenalty even runs - so it can't be reworded from our
 * addTracePenalty patch. In points mode that wording is misleading (no
 * clock is actually running), so for the duration of wrapped()'s call this
 * temporarily substitutes ui.notifications.warn with one that rewrites just
 * that specific message into the equivalent percentage - using the exact
 * same seconds/getTraceDuration()*100 conversion the base addTracePenalty
 * itself applies, so the number matches what actually lands in
 * state.traceProgress. Restored unconditionally afterwards.
 */
function callWithPointsModeHazardWording(
  app: any,
  wrapped: (...args: any[]) => any,
  args: any[]
): any {
  const originalWarn = ui.notifications?.warn;
  if (typeof originalWarn !== "function") return wrapped(...args);

  const duration = Number(app.getTraceDuration?.()) || 1;
  ui.notifications.warn = (message: string, ...rest: any[]) => {
    const match = /trace accelerated by ([\d.]+)s/i.exec(message);
    if (match) {
      const points = Math.round((Number(match[1]) / duration) * 100);
      message = message.replace(
        /trace accelerated by [\d.]+s/i,
        `trace increased by ${points}%`
      );
    }
    return originalWarn.call(ui.notifications, message, ...rest);
  };
  try {
    return wrapped(...args);
  } finally {
    ui.notifications.warn = originalWarn;
  }
}

function addTracePoints(app: any, points: number): void {
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  app.state.tracePenaltyProgress = clamp(
    app.state.tracePenaltyProgress + points
  );
  app.state.traceProgress = clamp(app.state.traceProgress + points);
  app.syncDom();
  if (app.state.traceProgress >= 100) {
    app.finish("failure", "Trace complete");
    return;
  }
  app.render(false);
  app.publishLiveState?.(true);
}

/**
 * Assigns (once, lazily) and returns a node's detection difficulty, 1-3,
 * weighted so difficulty 3 (Red-or-better required to stay unnoticed) is
 * rare - HoloSuite's own generated nodes carry no such rating, so this
 * stamps one on first use and reuses it for every later attempt against the
 * same node.
 */
function getNodeDifficulty(node: any): number {
  if (!node.faseripDifficulty) {
    const roll = Math.random();
    node.faseripDifficulty = roll < 0.6 ? 1 : roll < 0.9 ? 2 : 3;
  }
  return node.faseripDifficulty;
}

const DIFFICULTY_BADGE_CLASS = "faserip-node-difficulty-badge";
// Mirrors the Universal Table colors each difficulty's threshold maps to
// (1 = Green-or-better, 2 = Yellow-or-better, 3 = Red-or-better).
const DIFFICULTY_BADGE_COLORS = ["#2ecc71", "#f1c40f", "#e74c3c"];
const DATASTORE_COLOR = "#e67e22";
const TRACE_HINT_CLASS = "faserip-node-trace-hint";

/**
 * Injects a one-line explainer into the standby panel's node legend, once
 * per app render, so players don't have to be told the detection rule out
 * of band. Only added the first time this app's legend element is seen
 * (idempotent per-node check via TRACE_HINT_CLASS) since activateListeners
 * fires on every render and would otherwise duplicate it.
 */
function renderTraceHint(root: any): void {
  const legend = root.querySelector?.(".node-intrusion-legend");
  if (!legend || root.querySelector(`.${TRACE_HINT_CLASS}`)) return;

  const hint = globalThis.document.createElement("div");
  hint.className = TRACE_HINT_CLASS;
  hint.textContent =
    "Every node roll is checked twice: once to hack the node itself, and once " +
    "against the node's own badge to avoid detection there. Clearing the hack " +
    "doesn't excuse a roll that falls short of the badge's color - a Green " +
    "against a Red-badge node still trips the trace even though it claims the node.";
  Object.assign(hint.style, {
    marginTop: "8px",
    padding: "6px 8px",
    background: "rgba(0, 0, 0, 0.35)",
    borderRadius: "4px",
    fontSize: "11px",
    lineHeight: "1.4",
    opacity: "0.85",
    whiteSpace: "normal"
  });
  legend.insertAdjacentElement("afterend", hint);
}

/**
 * Assigns (once, lazily, per app instance) a handful of the graph's plain
 * "normal" nodes as "datastore" nodes - an orange-flagged node type with no
 * mechanical difference from a normal relay node, tracked only so a breach
 * of one can be reported (see reportDatastoreBreach). Excludes nodes
 * directly adjacent to the start node, same restriction
 * setupMultiTargetNodeIntrusion uses for its extra finish nodes, so the very
 * first move can't land on one. Count scales lightly with graph size so
 * small puzzles don't get flooded with them.
 */
function assignDatastoreNodes(app: any): void {
  if (app.__faseripDatastoreAssigned) return;
  app.__faseripDatastoreAssigned = true;

  const nodes: any[] = app.graph?.nodes ?? [];
  const startNode = nodes.find(n => n.type === "start");
  const startAdjacent: Set<string> = new Set(startNode?.connected ?? []);

  const candidates = nodes.filter(
    n => n.type === "normal" && !startAdjacent.has(n.id)
  );
  if (!candidates.length) return;

  const count = Math.min(
    candidates.length,
    nodes.length >= 14 ? 3 : nodes.length >= 8 ? 2 : 1
  );
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  for (const node of candidates.slice(0, count)) {
    node.type = "datastore";
  }
}

/**
 * Stamps a small numbered badge (1-3, color-graded to the Universal Table
 * color it demands) onto every hackable node's button showing its detection
 * difficulty, so players can see a node's risk before attempting it. Also
 * flags datastore nodes with an orange ring and a FontAwesome database icon.
 * Applied directly as inline styles rather than a stylesheet rule, since
 * this is injected into a third-party module's template rather than our
 * own markup - built fresh each render since HoloSuite's own render()
 * replaces the node buttons wholesale.
 */
/**
 * One-time PvP setup, run from activateListeners (like assignDatastoreNodes)
 * rather than right after startHack() returns - app.graph doesn't exist yet
 * at that point, since HoloSuite generates the node graph asynchronously
 * during its own first render, not synchronously in the constructor.
 * Calling initializePvpOwnership before the graph exists silently no-ops
 * (empty nodes array), leaving the defender with no start position and an
 * empty snapshot ever broadcast - confirmed live as "GM has no starting
 * node, nothing appears" - hence running this here instead, guarded so it
 * only actually does anything the first render after the graph is real.
 */
function ensurePvpInitialized(app: any): void {
  const pvp: FaseripPvpConfig | undefined = app.__faseripHackContext?.pvp;
  if (!pvp || app.__faseripPvpInitialized) return;
  const nodes: any[] = app.graph?.nodes ?? [];
  // Wait for both landmark nodes to actually be typed, not just for the
  // node list to be non-empty - defends against the graph being built in
  // stages (raw nodes first, start/target roles assigned after) even though
  // that hasn't been directly confirmed; retries on the next render either
  // way since this only sets the one-time init flag once both exist.
  if (!nodes.some(n => n.type === "start") || !nodes.some(n => n.type === "target")) {
    return;
  }
  app.__faseripPvpInitialized = true;

  initializePvpOwnership(app);
  registerPvpApp(pvp.sessionId, app);
  // Deliberately does NOT open the defender's cross-client view yet - they
  // can't act (or see anything) until detection first trips (see
  // checkDetection below), so popping the window up this early just shows
  // an empty "no intrusion detected yet" dialog with nothing to do,
  // confirmed as unwanted live. The view opens itself the moment
  // unleashDefender actually flips.
}

function renderDifficultyBadges(app: any, html?: any): void {
  ensurePvpInitialized(app);
  assignDatastoreNodes(app);

  const root: any = html?.[0] ?? html ?? app.element?.[0] ?? app.element;
  if (!root?.querySelectorAll) return;

  renderTraceHint(root);
  renderPvpControls(app, root);

  const buttons: NodeListOf<HTMLElement> = root.querySelectorAll(
    ".node-intrusion-node[data-node-id]"
  );
  buttons.forEach(btn => {
    const nodeId = (btn as HTMLElement).dataset.nodeId;
    const node = app.graph?.nodes?.find((n: any) => n.id === nodeId);
    if (!node || node.type === "start") return;

    const difficulty = getNodeDifficulty(node);
    const badge = globalThis.document.createElement("span");
    badge.className = DIFFICULTY_BADGE_CLASS;
    badge.textContent = String(difficulty);
    Object.assign(badge.style, {
      position: "absolute",
      top: "-6px",
      right: "-6px",
      width: "16px",
      height: "16px",
      lineHeight: "16px",
      borderRadius: "50%",
      textAlign: "center",
      fontSize: "10px",
      fontWeight: "bold",
      color: "#fff",
      background: DIFFICULTY_BADGE_COLORS[difficulty - 1],
      boxShadow: "0 0 2px rgba(0,0,0,0.8)",
      pointerEvents: "none",
      zIndex: "5"
    });
    btn.appendChild(badge);

    if (node.type === "datastore") {
      Object.assign((btn as HTMLElement).style, {
        boxShadow: `0 0 0 2px ${DATASTORE_COLOR} inset`
      });
      const icon = globalThis.document.createElement("i");
      icon.className = "fa-solid fa-database faserip-node-datastore-icon";
      Object.assign(icon.style, {
        position: "absolute",
        bottom: "-6px",
        left: "-6px",
        fontSize: "10px",
        color: DATASTORE_COLOR,
        textShadow: "0 0 2px rgba(0,0,0,0.9)",
        pointerEvents: "none",
        zIndex: "5"
      });
      btn.appendChild(icon);
    }
  });

  renderPvpNodeStyling(app, root);
}

const PAN_ZOOM_WRAPPER_CLASS = "faserip-pan-zoom-wrapper";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

/**
 * Lets the player pan (click-drag) and zoom (scroll wheel) the node map.
 * HoloSuite's own template positions every node/edge with plain percentages
 * against `.node-intrusion-map`'s own box, so rather than touching any of
 * that, this moves the map's existing children (the SVG edge layer + node
 * buttons) into a single absolutely-positioned wrapper div and transforms
 * that wrapper - the percentage layout inside it is completely unaffected,
 * only where/how large that whole layout appears within the now
 * `overflow: hidden` map viewport.
 *
 * The map element itself is rebuilt from scratch on every full render (this
 * runs from the activateListeners patch, alongside the badges), so the
 * wrapper and its event listeners are recreated each time too - only the
 * pan/zoom state itself (app.__faseripMapZoom) persists across renders.
 */
function setupMapPanZoom(app: any, html: any): void {
  const root: any = html?.[0] ?? html ?? app.element?.[0] ?? app.element;
  const map: HTMLElement | null = root?.querySelector?.(".node-intrusion-map");
  if (!map) return;

  if (!app.__faseripMapZoom) {
    app.__faseripMapZoom = { scale: 1, x: 0, y: 0 };
  }
  const zoom = app.__faseripMapZoom;

  const wrapper = globalThis.document.createElement("div");
  wrapper.className = PAN_ZOOM_WRAPPER_CLASS;
  Object.assign(wrapper.style, {
    position: "absolute",
    inset: "0",
    transformOrigin: "0 0"
  });
  while (map.firstChild) wrapper.appendChild(map.firstChild);
  map.appendChild(wrapper);

  Object.assign(map.style, {
    overflow: "hidden",
    cursor: "grab",
    touchAction: "none"
  });

  const applyTransform = () => {
    wrapper.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  };
  applyTransform();

  map.addEventListener(
    "wheel",
    (event: WheelEvent) => {
      event.preventDefault();
      const rect = map.getBoundingClientRect();
      const originX = event.clientX - rect.left;
      const originY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nextScale = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, zoom.scale * factor)
      );
      // Keep the point under the cursor fixed while the scale changes.
      zoom.x = originX - ((originX - zoom.x) * nextScale) / zoom.scale;
      zoom.y = originY - ((originY - zoom.y) * nextScale) / zoom.scale;
      zoom.scale = nextScale;
      applyTransform();
    },
    { passive: false }
  );

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  map.addEventListener("pointerdown", (event: PointerEvent) => {
    if ((event.target as HTMLElement)?.closest?.(".node-intrusion-node")) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    map.style.cursor = "grabbing";
    map.setPointerCapture(event.pointerId);
  });
  map.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return;
    zoom.x += event.clientX - lastX;
    zoom.y += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    applyTransform();
  });
  const stopDrag = () => {
    dragging = false;
    map.style.cursor = "grab";
  };
  map.addEventListener("pointerup", stopDrag);
  map.addEventListener("pointercancel", stopDrag);

  // Double-click resets the view - the only way back to a known-good state
  // once panned/zoomed away, since there's no dedicated reset control.
  map.addEventListener("dblclick", () => {
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    applyTransform();
  });
}

/**
 * The standby/aside panel (specs, legend, actions) can end up taller than
 * the window once the trace-hint block and datastore/difficulty legend are
 * added, especially in a smaller popped-out window - so it scrolls
 * internally instead of overflowing or clipping. Reapplied every render
 * alongside the other DOM patches since the panel is rebuilt from scratch
 * each time.
 */
function makeSidebarScrollable(root: any): void {
  const panel: HTMLElement | null = root?.querySelector?.(
    ".node-intrusion-panel"
  );
  if (!panel) return;
  Object.assign(panel.style, {
    overflowY: "auto",
    overflowX: "hidden",
    maxHeight: "100%"
  });
}

/**
 * Posts a chat message (visible to the GM and everyone else, same audience
 * as the roll chat cards rollFaseripHackCheck already posts) the first time
 * a datastore node is claimed, so the table knows the hacker pulled data out
 * of the network. Guarded by node.faseripDatastoreReported so a node already
 * claimed earlier in the run (e.g. revisited as a waypoint) doesn't report
 * twice.
 */
function reportDatastoreBreach(app: any, node: any): void {
  const actorName = app.actorName ?? "Hacker";
  try {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: `<p><i class="fa-solid fa-database"></i> <strong>${actorName}</strong> found and extracted a datastore during the intrusion.</p>`
    });
  } catch (err) {
    console.warn("faserip | Failed to post datastore breach chat message", err);
  }
  ui.notifications?.info?.(`${actorName} breached a datastore node!`);
}

/**
 * Checks the node-attempt roll that's already been made against this node's
 * own difficulty threshold (see DIFFICULTY_REQUIRED_COLOR) - no separate
 * roll: a difficulty-1 node only trips on White, a difficulty-3 node trips
 * on anything short of Red, even a roll that otherwise succeeded the move.
 *
 * Consequence depends on the "hackTraceMode" world setting:
 * - time mode: the first trip starts the trace clock running (see the
 *   addTracePenalty patch below); later trips accelerate it with a flat
 *   decoy-style seconds penalty.
 * - points mode: the trace clock never runs on its own - every trip adds a
 *   flat chunk of trace progress directly, scaled by node difficulty
 *   (DIFFICULTY_TRACE_POINTS), so harder nodes cost more per failure.
 */
function checkDetection(app: any, node: any, rollResult: RollResult): void {
  const difficulty = getNodeDifficulty(node);
  const requiredColor = DIFFICULTY_REQUIRED_COLOR[difficulty];
  if (meetsRequiredColor(rollResult, requiredColor)) return;

  // PvP managed intrusions: the defender can't act at all until the first
  // time detection trips, regardless of trace mode - and their cross-client
  // view only opens at that same moment, not the instant the hack starts
  // (see ensurePvpInitialized), so they aren't staring at an empty "no
  // intrusion detected yet" window with nothing to do in the meantime.
  const pvp: FaseripPvpConfig | undefined = app.__faseripHackContext?.pvp;
  if (pvp) {
    const wasUnleashed = !!app.__faseripDefenderUnleashed;
    unleashDefender(app);
    if (!wasUnleashed && app.__faseripDefenderUnleashed) {
      const snapshot = buildPvpSnapshot(app);
      if (snapshot) openPvpDefenderView(pvp, snapshot);
    }
  }

  if (getTraceMode() === "points") {
    const points = DIFFICULTY_TRACE_POINTS[difficulty];
    app.__faseripTraceDetected = true;
    ui.notifications?.warn?.(
      `Intrusion detected (node difficulty ${difficulty})! Trace +${points}%.`
    );
    addTracePoints(app, points);
    return;
  }

  const wasAlreadyTraced = !!app.__faseripTraceDetected;
  const penalty = wasAlreadyTraced
    ? Number(
        app.profile.decoyPenaltySeconds ?? app.profile.nodeIntrusion?.decoyPenaltySeconds
      ) || 4
    : 0;

  ui.notifications?.warn?.(
    wasAlreadyTraced
      ? `Trace accelerated by ${penalty}s.`
      : `Intrusion detected (node difficulty ${difficulty})! Trace initiated.`
  );
  app.addTracePenalty(penalty);
  app.render(false);
  app.publishLiveState?.(true);
}

/**
 * Ratchets the minigame's radar/hint visibility up based on the best
 * per-node roll seen so far this run - it never gets worse mid-run even if
 * a later roll is poor. Yellow-or-better reveals radar (adjacent danger
 * signals); Red additionally reveals full node-type hints, matching the
 * extra detail the "Critical Success" difficulty profile normally grants.
 * Mutates the same `profile` object HoloSuite's own (unpatched) getData()
 * reads every render, so no separate getData patch is needed - just a
 * re-render to pick the change up.
 */
function applyRadarFromRoll(app: any, result: RollResult) {
  const rank = ROLL_COLOR_RANK[result] ?? 0;
  const bestRank = app.__faseripBestRollRank ?? -1;
  if (rank <= bestRank) return;
  app.__faseripBestRollRank = rank;

  if (rank >= ROLL_COLOR_RANK[RollResult.Yellow]) {
    app.profile.radarEnabled = true;
    if (app.profile.nodeIntrusion) app.profile.nodeIntrusion.radarEnabled = true;
  }
  if (rank >= ROLL_COLOR_RANK[RollResult.Red]) {
    app.profile.hintsEnabled = true;
  }
  app.render(false);
}

/**
 * Pauses the trace clock while a FASERIP roll (dice animation, karma-spend
 * dialogs) is resolving, and resumes it exactly where it left off.
 * Trace progress is computed from wall-clock elapsed time since
 * `this.startedAt` (see getTraceDuration/startTimer), so just stopping the
 * setInterval isn't enough - the moment it restarts it would recompute
 * elapsed time across the whole paused gap and jump forward. Shifting
 * `startedAt` forward by the paused duration on resume cancels that out.
 */
function pauseTrace(app: any) {
  if (!app.timer) return; // not running (already stopped, or hack not started)
  app.__faseripTracePausedAt = performance.now();
  app.stopTimer();
}

function resumeTrace(app: any) {
  const pausedAt = app.__faseripTracePausedAt;
  if (pausedAt == null) return;
  app.__faseripTracePausedAt = null;
  if (app.startedAt != null) {
    app.startedAt += performance.now() - pausedAt;
  }
  if (app.state.hasStarted && app.state.isRunning && !app.state.result) {
    app.startTimer();
  }
}

/**
 * True only when the same physical user is meant to be controlling both
 * sides from this one app instance (no distinct connected defender owner,
 * or the defender's owner happens to be this same user) - the only case
 * where it's legitimate for THIS window (always the attacker's own) to also
 * dispatch defender moves/recaptures/scans. Once a real, distinct defender
 * user is connected, they get their own cross-client PvpDefenderView (see
 * pvp-defender-view.ts) and this window must never let the attacker act on
 * the defender's behalf just by clicking around during the defender's turn
 * - confirmed live as "the attacker's GUI has the defender's GUI".
 */
function pvpSameUserControlsBothSides(pvp: FaseripPvpConfig): boolean {
  return !pvp.defenderUserId || pvp.defenderUserId === pvp.attackerUserId;
}

/**
 * A defender/attacker acting-side check for recapture or scan attempts isn't
 * an attribute the hack's own FaseripHackContext carries (that's the
 * attacker's node-hack check) - both sides roll their own Reasoning
 * instead, mirroring how lock-picking/hacking checks elsewhere in this
 * integration fall back to Reasoning when no dedicated skill applies.
 */
async function rollPvpActionCheck(actor: any, label: string) {
  if (!actor) {
    ui.notifications?.warn?.("Could not resolve an actor for that side - check both Combatants are still in the encounter.");
    return null;
  }
  const rank: Rank =
    actor.getCurrentForm?.()?.attributes?.reasoning?.rank ?? Rank.Typical;
  return rollFaseripHackCheck({
    actor,
    attributeName: `${actor.name} ${label}`,
    attributeRank: rank
  });
}

/**
 * Defender's turn: clicking a node adjacent to their current position moves
 * them there for free, unless the attacker currently holds it - then it
 * costs a recapture roll (against the color the attacker actually rolled
 * when they took it, not the node's own difficulty), win or lose the turn.
 * Reaching the attacker's own start node ends the run immediately as a
 * defender win. Frozen entirely until the first detection trip (see
 * checkDetection's unleashDefender call).
 */
export async function handlePvpDefenderNodeClick(
  app: any,
  pvp: FaseripPvpConfig,
  nodeId: string
): Promise<void> {
  if (!app.__faseripDefenderUnleashed) {
    ui.notifications?.warn?.("The defender hasn't detected the intrusion yet.");
    return;
  }

  const nodes: any[] = app.graph?.nodes ?? [];
  const currentId = getDefenderPosition(app);
  const current = nodes.find(n => n.id === currentId);
  const node = nodes.find(n => n.id === nodeId);
  if (!current || !node || !current.connected?.includes(nodeId)) return;

  if (node.faseripOwner === NODE_OWNER_ATTACKER) {
    const roll = await rollPvpActionCheck(
      resolvePvpActor(pvp, "defender"),
      "Recapture Attempt"
    );
    if (!roll) return;
    const success = attemptRecapture(node, roll.result);
    if (!success) {
      ui.notifications?.warn?.("Recapture failed - turn wasted.");
      app.render(false);
      syncPvp(app, pvp);
      return;
    }
    ui.notifications?.info?.("Node recaptured.");
  }

  setDefenderPosition(app, nodeId);
  if (node.type === "start") {
    finishPvpRun(app, "defender", "Reached the attacker's entry point");
    syncPvp(app, pvp);
    return;
  }
  app.render(false);
  syncPvp(app, pvp);
}

/**
 * Scan action: costs the acting side's whole turn instead of moving or
 * recapturing, only reveals the opponent's position within 2 graph-hops,
 * and rolls against a color fixed back at the attacker's initial hack roll
 * (see FaseripPvpConfig.scanRequiredColor) rather than anything re-derived
 * here.
 */
async function handlePvpScan(
  app: any,
  pvp: FaseripPvpConfig,
  restrictToSide?: "attacker" | "defender"
): Promise<void> {
  const side: "attacker" | "defender" | null = restrictToSide
    ? isPvpTurn(pvp, restrictToSide)
      ? restrictToSide
      : null
    : isPvpTurn(pvp, "attacker")
      ? "attacker"
      : isPvpTurn(pvp, "defender")
        ? "defender"
        : null;
  if (!side) {
    ui.notifications?.warn?.("Not your turn.");
    return;
  }

  const nodes: any[] = app.graph?.nodes ?? [];
  const scannerNodeId = side === "attacker" ? app.state.currentNodeId : getDefenderPosition(app);
  const opponentNodeId = side === "attacker" ? getDefenderPosition(app) : app.state.currentNodeId;
  if (!scannerNodeId || !opponentNodeId) return;

  const roll = await rollPvpActionCheck(resolvePvpActor(pvp, side), "Scan Attempt");
  if (!roll) return;

  const { inRange, success } = attemptScan(
    nodes,
    scannerNodeId,
    opponentNodeId,
    pvp.scanRequiredColor ?? RollResult.Green,
    roll.result
  );

  if (!inRange) {
    ui.notifications?.warn?.("Too far from the opponent to scan (must be within 2 nodes).");
    return;
  }

  if (success) {
    app.__faseripPvpRevealNodeId = opponentNodeId;
    ui.notifications?.info?.("Scan successful - opponent's position revealed.");
  } else {
    ui.notifications?.warn?.("Scan failed to pin down the opponent's position.");
  }
  app.render(false);
  syncPvp(app, pvp);
}

const PVP_OWNER_COLOR = "#7b241c";
const PVP_CONTROLS_CLASS = "faserip-pvp-controls";

/**
 * Marks every attacker-owned/captured node with a full red fill (a
 * different, darker shade than the existing radar-danger red, so the two
 * aren't confused) plus a FontAwesome arrows-to-dot icon, and outlines
 * whichever node a successful Scan most recently revealed. Reapplied every
 * render alongside the difficulty badges, since node buttons are rebuilt
 * from scratch each time.
 */
function renderPvpNodeStyling(app: any, root: any): void {
  const pvp: FaseripPvpConfig | undefined = app.__faseripHackContext?.pvp;
  if (!pvp) return;

  const buttons: NodeListOf<HTMLElement> = root.querySelectorAll(
    ".node-intrusion-node[data-node-id]"
  );
  buttons.forEach(btn => {
    const nodeId = (btn as HTMLElement).dataset.nodeId;
    const node = app.graph?.nodes?.find((n: any) => n.id === nodeId);
    if (!node) return;

    if (node.faseripOwner === NODE_OWNER_ATTACKER) {
      Object.assign((btn as HTMLElement).style, {
        background: PVP_OWNER_COLOR,
        boxShadow: "0 0 0 2px #922b21 inset"
      });
      const icon = globalThis.document.createElement("i");
      icon.className = "fa-solid fa-arrows-to-dot faserip-pvp-owner-icon";
      Object.assign(icon.style, {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        fontSize: "10px",
        color: "#fff",
        textShadow: "0 0 2px rgba(0,0,0,0.9)",
        pointerEvents: "none",
        zIndex: "6"
      });
      btn.appendChild(icon);
    }

    if (nodeId === app.__faseripPvpRevealNodeId) {
      (btn as HTMLElement).style.outline = "2px dashed #f1c40f";
    }
  });
}

/**
 * Injects a small standby-panel block for PvP intrusions: whose turn it
 * currently is, and a Scan button available to either side on their own
 * turn (mutually exclusive with moving/recapturing - clicking it spends
 * the turn instead). Rebuilt (not just re-labelled) every render since the
 * panel it lives in is rebuilt wholesale each time too.
 */
function renderPvpControls(app: any, root: any): void {
  const pvp: FaseripPvpConfig | undefined = app.__faseripHackContext?.pvp;
  if (!pvp) return;

  const anchor =
    root.querySelector(`.${TRACE_HINT_CLASS}`) ??
    root.querySelector(".node-intrusion-legend");
  if (!anchor) return;
  root.querySelector(`.${PVP_CONTROLS_CLASS}`)?.remove();

  const panel = globalThis.document.createElement("div");
  panel.className = PVP_CONTROLS_CLASS;
  Object.assign(panel.style, {
    marginTop: "8px",
    padding: "6px 8px",
    background: "rgba(0, 0, 0, 0.35)",
    borderRadius: "4px",
    fontSize: "11px",
    display: "flex",
    flexDirection: "column",
    gap: "4px"
  });

  const sameUser = pvpSameUserControlsBothSides(pvp);
  const turnLabel = isPvpTurn(pvp, "attacker")
    ? "Attacker"
    : isPvpTurn(pvp, "defender")
      ? "Defender"
      : "Waiting on combat turn order";
  const status = globalThis.document.createElement("div");
  status.textContent = `PvP Intrusion - current turn: ${turnLabel}`;
  panel.appendChild(status);

  // A distinct, real defender has their own separate window (see
  // pvp-defender-view.ts) - this button (the attacker's own) must never act
  // on their behalf, only ever as the attacker, and only on the attacker's
  // own turn. Only when nobody else is connected to play the defender
  // (sameUser) does it fall back to acting as whichever side's turn it is.
  const scanBtn = globalThis.document.createElement("button");
  scanBtn.type = "button";
  scanBtn.textContent = "Scan (uses your turn)";
  scanBtn.style.fontSize = "11px";
  if (!sameUser && !isPvpTurn(pvp, "attacker")) {
    scanBtn.disabled = true;
  }
  scanBtn.addEventListener("click", () =>
    handlePvpScan(app, pvp, sameUser ? undefined : "attacker")
  );
  panel.appendChild(scanBtn);

  anchor.insertAdjacentElement("afterend", panel);
}

let registered = false;
let warnedNoLibWrapper = false;

/**
 * Patches HoloSuite Hacking's Node Intrusion minigame, via libWrapper, so
 * every node-claim attempt rolls a FASERIP attribute check instead of
 * always succeeding into its claim timer. A failed check (White result)
 * blocks the claim and applies a trace penalty, the same way the minigame
 * already handles brushing a firewall/decoy. The best roll quality seen so
 * far also progressively unveils radar (Yellow+) and full node-type hints
 * (Red) - see applyRadarFromRoll.
 *
 * HoloSuite exposes no public hook for this - Node Intrusion's node-claim
 * logic (handleNodeClick) is a private method on an internal Application
 * class, not part of game.modules.get("holosuite-hacking").api, and their
 * shipped bundle minifies that class's name (verified against dist/main.js:
 * it contains zero occurrences of "NodeIntrusionApp"), so a name-based
 * `render${this.constructor.name}` Hooks listener can never fire against
 * the real module - it would silently never patch anything.
 *
 * Instead, this is called with the actual app instance HoloSuite's own
 * startHack()/startMinigame() already hands back to runFaseripHack() when
 * *we* launch a node-intrusion hack. That gives us `app.constructor`
 * directly, with no reliance on its name. The patch itself only ever goes
 * through libWrapper (never a raw prototype overwrite), lands on the
 * class's prototype (so it applies to every future instance, not just this
 * one), and only changes behavior for hacks tagged with
 * __faseripHackContext by our own adapter - a hack started any other way
 * (Quick Hack, HoloSuite's own launcher) is left completely untouched.
 */
export function ensureNodeIntrusionPerNodeRollPatched(app: any) {
  if (registered) return;

  if (typeof globalThis.libWrapper === "undefined") {
    if (!warnedNoLibWrapper) {
      warnedNoLibWrapper = true;
      console.warn(
        "faserip | libWrapper is not active - per-node HoloSuite hack rolls are disabled. Install and enable the libWrapper module to use this feature."
      );
    }
    return;
  }

  registered = true;

  // libWrapper resolves its target by a global dotted path, and
  // NodeIntrusionApp's constructor isn't reachable by any global path of
  // its own. Stashing the actual constructor reference here (once, from a
  // live instance we already hold) gives libWrapper a path to patch; the
  // patch itself lands on the shared prototype, so it applies to every
  // future instance too, not just this one.
  globalThis[NODE_APP_GLOBAL_KEY] = app.constructor;

  // Hacks start fully undetected: let HoloSuite's own startRun() do its
  // normal bookkeeping (hasStarted/isRunning/render/publishLiveState), then
  // immediately stop the trace clock it just started and zero out its
  // progress. The clock only actually starts once something detects the
  // hack (see the addTracePenalty patch below), instead of running from the
  // moment the hack begins. Only applies to FASERIP-launched hacks.
  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.startRun`,
    function (this: any, wrapped: (...args: any[]) => any, ...args: any[]) {
      const result = wrapped(...args);
      if (this.__faseripHackContext) {
        this.stopTimer();
        this.startedAt = null;
        this.state.traceProgress = 0;
        this.state.tracePenaltyProgress = 0;
        this.__faseripTraceDetected = false;
        this.render(false);
      }
      return result;
    },
    "MIXED"
  );

  // Central "the hack has just been detected" trigger: the first time
  // addTracePenalty is called for a FASERIP-launched hack that hasn't been
  // detected yet (either our own handleDetectionRoll on a White, or
  // HoloSuite's own firewall/decoy hazard penalties), this starts the trace
  // clock fresh from now instead of leaving it stopped at 0%. Once
  // detected, later calls just add their penalty on top of the
  // already-running clock, same as stock behavior.
  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.addTracePenalty`,
    function (this: any, wrapped: (...args: any[]) => any, seconds: number) {
      // In points mode, HoloSuite's own hazard penalties (stepping a
      // firewall, tripping a decoy) still add trace progress directly via
      // wrapped(seconds) below, same as time mode - they just never trigger
      // the ambient clock (that only starts in time mode, guarded below).
      if (
        this.__faseripHackContext &&
        getTraceMode() === "time" &&
        !this.__faseripTraceDetected &&
        this.state.hasStarted &&
        !this.state.result
      ) {
        this.__faseripTraceDetected = true;
        this.startedAt = performance.now();
        this.startTimer();
      }
      return wrapped(seconds);
    },
    "MIXED"
  );

  // Stamps difficulty badges onto every node button after each of
  // HoloSuite's own renders (which rebuild the node buttons wholesale, so
  // this has to reapply every time rather than once). Piggybacks on
  // activateListeners rather than render() itself - that's the hook
  // HoloSuite's own code uses to bind click handlers to the freshly
  // rendered content (`html`), so it's guaranteed to see the live DOM;
  // render()'s own returned promise wasn't a reliable point to grab it
  // from (confirmed live: no badges ever appeared, no console errors).
  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.activateListeners`,
    function (this: any, wrapped: (...args: any[]) => any, html: any) {
      const result = wrapped(html);
      if (this.__faseripHackContext) {
        renderDifficultyBadges(this, html);
        setupMapPanZoom(this, html);
        const root: any = html?.[0] ?? html ?? this.element?.[0] ?? this.element;
        makeSidebarScrollable(root);
      }
      return result;
    },
    "WRAPPER"
  );

  // Reports the first time each datastore node is actually claimed - after
  // wrapped() so this only fires once the base game has finished its own
  // claim bookkeeping (node.visited, etc.), not on the initial click.
  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.completeNodeClaim`,
    function (
      this: any,
      wrapped: (...args: any[]) => any,
      fromNodeId: string,
      nodeId: string
    ) {
      const result =
        this.__faseripHackContext && getTraceMode() === "points"
          ? callWithPointsModeHazardWording(this, wrapped, [
              fromNodeId,
              nodeId
            ])
          : wrapped(fromNodeId, nodeId);
      if (this.__faseripHackContext) {
        const node = this.graph?.nodes?.find((n: any) => n.id === nodeId);
        if (node?.type === "datastore" && !node.faseripDatastoreReported) {
          node.faseripDatastoreReported = true;
          reportDatastoreBreach(this, node);
        }
      }
      return result;
    },
    "WRAPPER"
  );

  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.handleNodeClick`,
    async function (
      this: any,
      wrapped: (...args: any[]) => any,
      nodeId: string
    ) {
        const context: FaseripHackContext | undefined =
          this.__faseripHackContext;

        // Not a FASERIP-launched hack (Quick Hack, HoloSuite's own launcher,
        // a system-skill/custom/sheet roll) - leave normal behavior alone.
        if (!context) return wrapped(nodeId);

        // Mirror handleNodeClick's own early-exit guards so invalid clicks
        // (not running, mid-claim, unconnected, already blocked) fall
        // through to its normal handling without spending a roll.
        if (!this.state.hasStarted || !this.state.isRunning) {
          return wrapped(nodeId);
        }
        if (this.state.claimingNodeId || this.__faseripRollPending) return;

        // PvP managed intrusion: this window is always the attacker's own.
        // It only doubles as the defender's controls too when nobody else
        // is actually connected to play the defender (see
        // pvpSameUserControlsBothSides) - otherwise the real defender has
        // their own separate cross-client view, and a click here during
        // their turn must be refused rather than silently acting for them.
        if (context.pvp) {
          if (isPvpTurn(context.pvp, "defender")) {
            if (pvpSameUserControlsBothSides(context.pvp)) {
              await handlePvpDefenderNodeClick(this, context.pvp, nodeId);
            } else {
              ui.notifications?.warn?.(
                "It's the defender's turn - they act from their own window."
              );
            }
            return;
          }
          if (!isPvpTurn(context.pvp, "attacker")) {
            ui.notifications?.warn?.("Not your turn.");
            return;
          }
        }

        const current = this.getCurrentNode();
        const node = this.graph.nodes.find(
          (candidate: any) => candidate.id === nodeId
        );
        if (!node || !current.connected.includes(nodeId)) {
          return wrapped(nodeId);
        }

        const routeKey = edgeKey(current.id, nodeId);
        if (
          this.state.blockedEdgeIds.has(routeKey) ||
          this.state.deadNodeIds.has(nodeId)
        ) {
          return wrapped(nodeId);
        }

        // Already-claimed nodes (visited earlier this run) don't cost
        // another roll to re-traverse - only the first claim of a node is
        // gated by a FASERIP check.
        if (node.visited) return wrapped(nodeId);

        this.__faseripRollPending = true;
        pauseTrace(this);
        try {
          const faseripRoll = await rollFaseripHackCheck(
            context,
            "Node Attempt"
          );

          resumeTrace(this);
          applyRadarFromRoll(this, faseripRoll.result);

          // A multi-target finish node uses that specific target's own
          // required color instead of the attempt's general one - resolved
          // via the token id stashed directly on the node.
          const requiredColor =
            (node.faseripTargetTokenId &&
              this.__faseripTargetTokenMap?.get(node.faseripTargetTokenId)
                ?.requiredColor) ??
            context.requiredColor;

          // Detection is its own, entirely independent check from the
          // move's own success/failure - a node's difficulty badge is the
          // color needed to evade detection there, full stop, regardless of
          // whether that same roll happened to be good enough to also clear
          // the attempt's own (possibly lower) required color. A Green
          // roll against a level-3 (Red-to-evade) node still trips
          // detection even though it successfully claims the node.
          checkDetection(this, node, faseripRoll.result);

          const moveSucceeded = meetsRequiredColor(
            faseripRoll.result,
            requiredColor
          );

          if (!moveSucceeded) {
            if (context.pvp) syncPvp(this, context.pvp);

            // Reuse the minigame's own invalid-pulse feedback.
            const shell = this.element?.find?.(".node-intrusion-shell");
            shell?.addClass("invalid-pulse");
            globalThis.window?.setTimeout(
              () => shell?.removeClass("invalid-pulse"),
              280
            );
            return;
          }

          if (context.pvp) {
            // Stamps the color actually rolled, not just requiredColor - a
            // recapture later must match/beat this, not the node's static
            // difficulty threshold.
            recordAttackerCapture(node, faseripRoll.result);
            syncPvp(this, context.pvp);
          }

          return wrapped(nodeId);
        } finally {
          // Idempotent (no-op if already resumed above) - also covers the
          // roll throwing (e.g. a cancelled manual roll entry), so the
          // trace never gets stuck paused.
          resumeTrace(this);
          this.__faseripRollPending = false;
        }
    },
    "MIXED"
  );

  // PvP cleanup/reporting - covers both ways a managed run can end: the
  // stock success path (attacker reaches the "target" node, handled
  // entirely by HoloSuite's own code, never touched above) and
  // finishPvpRun's own explicit failure call (defender reaches "start").
  // Unrelated to the multi-target finish patch below (mutually exclusive
  // modes - pvp is single-target only), both layer fine on the same method.
  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.finish`,
    function (
      this: any,
      wrapped: (...args: any[]) => any,
      result: string,
      message: string,
      options?: any
    ) {
      const pvp: FaseripPvpConfig | undefined = this.__faseripHackContext?.pvp;
      if (pvp && !this.__faseripPvpResult) {
        this.__faseripPvpResult = result === "success" ? "attacker" : "defender";
      }
      const returnValue = wrapped(result, message, options);
      if (pvp) {
        syncPvp(this, pvp);
        unregisterPvpApp(pvp.sessionId);
      }
      return returnValue;
    },
    "MIXED"
  );
}

/**
 * Turns 2+ targeted hackable actors into that many "finish" nodes in a
 * Node Intrusion run: the original generated target node becomes target #1,
 * and additional "normal" (relay) nodes are relabeled as targets for the
 * rest - HoloSuite's generator (node-intrusion-generator.ts) isn't part of
 * its public API, so this reclassifies nodes on the already-built graph
 * rather than regenerating one, the same way their own code relabels
 * "normal" nodes into firewalls.
 *
 * Reaching any one of these no longer ends the run (see the
 * completeNodeClaim patch below) - the puzzle keeps going until the trace
 * timer completes or the player aborts, and having hacked at least one
 * target counts as an overall success (see the finish patch below).
 */
export function setupMultiTargetNodeIntrusion(
  app: any,
  targets: HackTargetInfo[],
  onTargetHacked?: (target: HackTargetInfo) => void | Promise<void>
): void {
  if (!app?.graph?.nodes || targets.length < 2) return;

  const nodes: any[] = app.graph.nodes;
  // Keyed by TOKEN id, not actor id - two different targeted tokens can
  // share the same base Actor (duplicate NPCs), and actor-id keying would
  // collapse them into a single target. The node itself also carries its
  // target's token id directly (faseripTargetTokenId), so the graph data is
  // the source of truth for which token a given node breaches; this map is
  // only for resolving that id back to a display name/requiredColor.
  const targetTokenMap = new Map<string, HackTargetInfo>();

  function assignTarget(node: any, target: HackTargetInfo) {
    node.faseripTargetTokenId = target.tokenId;
    node.faseripTargetActorName = target.actorName;
    targetTokenMap.set(target.tokenId, target);
  }

  const originalTarget = nodes.find(node => node.type === "target");
  let nextTargetIndex = 0;
  if (originalTarget) {
    assignTarget(originalTarget, targets[nextTargetIndex]);
    nextTargetIndex += 1;
  }

  // Exclude nodes directly reachable from the start node - an extra finish
  // node shouldn't be hackable as the very first move. Also require a leaf
  // (single connection) so the extra target is a dead-end branch, not a
  // waypoint that would force traffic through it.
  const startNode = nodes.find(node => node.type === "start");
  const startAdjacent: Set<string> = new Set(startNode?.connected ?? []);

  const extraNeeded = targets.length - nextTargetIndex;
  const leafCandidates = nodes.filter(
    node =>
      node.type === "normal" &&
      !startAdjacent.has(node.id) &&
      (node.connected?.length ?? 0) === 1
  );
  const fallbackCandidates = nodes.filter(
    node => node.type === "normal" && !startAdjacent.has(node.id)
  );
  const candidates =
    leafCandidates.length >= extraNeeded ? leafCandidates : fallbackCandidates;
  for (const node of candidates.slice(0, extraNeeded)) {
    node.type = "target";
    assignTarget(node, targets[nextTargetIndex]);
    nextTargetIndex += 1;
  }

  if (nextTargetIndex < targets.length) {
    console.warn(
      `faserip | Node Intrusion graph didn't have enough spare nodes for all ${targets.length} hacking targets - only ${nextTargetIndex} finish node(s) were placed.`
    );
  }

  app.__faseripMultiTargetMode = true;
  app.__faseripTargetTokenMap = targetTokenMap;
  // Set of hacked TOKEN ids (not actor ids, not node ids) - a node's
  // faseripTargetTokenId is the sole source of truth for which specific
  // token gets debuffed, even when several targeted tokens share an Actor.
  app.__faseripHackedTargets = new Set<string>();
  app.__faseripOnTargetHacked = onTargetHacked;

  ensureMultiTargetNodeIntrusionPatched();
}

let multiTargetRegistered = false;

/**
 * Patches completeNodeClaim (skip the normal target-reached finish, mark it
 * hacked, keep the run going) and finish (a "Trace complete" failure
 * becomes a success if at least one target was hacked). Both are no-ops for
 * any app instance that isn't in multi-target mode, so single/no-target
 * hacks (including HoloSuite's own launcher and Quick Hack) are unaffected.
 * Relies on globalThis[NODE_APP_GLOBAL_KEY] already being set by
 * ensureNodeIntrusionPerNodeRollPatched, which setupMultiTargetNodeIntrusion's
 * caller (attemptFaseripHack) always invokes first.
 */
function ensureMultiTargetNodeIntrusionPatched() {
  if (multiTargetRegistered) return;
  if (typeof globalThis.libWrapper === "undefined") return; // Already warned in the per-node-roll patch.
  multiTargetRegistered = true;

  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.completeNodeClaim`,
    function (
      this: any,
      wrapped: (...args: any[]) => any,
      fromNodeId: string,
      nodeId: string
    ) {
      const node = this.graph.nodes.find(
        (candidate: any) => candidate.id === nodeId
      );
      // The node's own data is the sole source of truth for which token (if
      // any) it breaches - not a lookup keyed by node id, and specifically
      // the token id rather than actor id, since multiple targeted tokens
      // can share a base Actor.
      const targetTokenId = this.__faseripMultiTargetMode
        ? node?.faseripTargetTokenId
        : null;
      if (!targetTokenId) return wrapped(fromNodeId, nodeId);

      const targetInfo = this.__faseripTargetTokenMap?.get(targetTokenId);
      if (!targetInfo) return wrapped(fromNodeId, nodeId);

      // Mirrors handleNodeClick's own guard - if the run ended while this
      // claim's timer was pending, do nothing.
      if (!this.state.hasStarted || !this.state.isRunning) return;

      const current = this.graph.nodes.find(
        (candidate: any) => candidate.id === fromNodeId
      );
      if (!current || !node) return;

      // Same bookkeeping as a normal successful move (see
      // completeNodeClaim's own non-hazard branch) - just without the
      // finish("success", ...) call a single-target hit would normally make.
      const routeKey = edgeKey(current.id, nodeId);
      this.state.claimingNodeId = null;
      this.state.visitedNodeIds.add(nodeId);
      this.state.traversedEdgeIds.add(routeKey);
      node.visited = true;
      node.revealed = true;
      this.state.currentNodeId = nodeId;

      const totalTargets = this.__faseripTargetTokenMap.size;
      if (!this.__faseripHackedTargets.has(targetTokenId)) {
        this.__faseripHackedTargets.add(targetTokenId);
        ui.notifications?.info?.(
          `${targetInfo.actorName} breached! (${this.__faseripHackedTargets.size}/${totalTargets} targets hacked)`
        );
        // Debuffs are prompted once the run actually ends (timer completes,
        // every reachable target is hacked, or the player aborts with at
        // least one target hacked) - not per-breach - see the finish patch.
      }

      // Every reachable target has been hacked - nothing left to do, so end
      // the run as a success now instead of waiting out the trace timer.
      if (this.__faseripHackedTargets.size >= totalTargets) {
        this.stopTimer();
        this.finish(
          "success",
          `All targets hacked (${this.__faseripHackedTargets.size}/${totalTargets})`
        );
        return;
      }

      this.render(false);
      this.publishLiveState(true);
    },
    "MIXED"
  );

  globalThis.libWrapper.register(
    FASERIP_MODULE_ID,
    `globalThis.${NODE_APP_GLOBAL_KEY}.prototype.finish`,
    function (
      this: any,
      wrapped: (...args: any[]) => any,
      result: string,
      message: string,
      options?: any
    ) {
      // Snapshot which targets were actually hacked *before* calling the
      // real finish() - its own end-of-run cleanup (revealing the full map,
      // resolving remaining paths for the summary screen, etc.) may itself
      // call completeNodeClaim for nodes the player never really reached,
      // which would otherwise get misread as additional hacked targets if
      // we read __faseripHackedTargets only after wrapped() has run.
      const hackedSnapshot = new Set<string>(this.__faseripHackedTargets ?? []);
      const hackedCount = hackedSnapshot.size;
      const total = this.__faseripTargetTokenMap?.size ?? hackedCount;

      // Any way a multi-target run ends without every target hacked - the
      // trace timer completing, or the player aborting - still counts as an
      // overall success as long as at least one target was hacked. (Reaching
      // every reachable target ends the run early as "success" already, via
      // the completeNodeClaim patch below, so this only ever converts a
      // "failure" outcome.)
      let finalResult = result;
      let finalMessage = message;
      if (this.__faseripMultiTargetMode && result === "failure" && hackedCount > 0) {
        finalResult = "success";
        finalMessage = `${message} - ${hackedCount}/${total} targets hacked`;
      }

      const returnValue = wrapped(finalResult, finalMessage, options);

      // Prompt for a debuff per hacked target now that the run has actually
      // ended - once only, regardless of how finish() ends up being invoked
      // (trace timeout, all-targets-hacked shortcut, or abort), and strictly
      // limited to the pre-wrapped() snapshot above.
      if (
        this.__faseripMultiTargetMode &&
        finalResult === "success" &&
        hackedCount > 0 &&
        !this.__faseripDebuffsPrompted
      ) {
        this.__faseripDebuffsPrompted = true;
        void promptDebuffsForHackedTargets(this, hackedSnapshot);
      }

      return returnValue;
    },
    "MIXED"
  );
}

/**
 * Sequentially prompts (and applies) a debuff for every target hacked this
 * run, once the run has ended. Sequential rather than parallel so dialogs
 * don't stack on top of each other when multiple targets were breached.
 */
async function promptDebuffsForHackedTargets(
  app: any,
  hackedTokenIds: Set<string>
): Promise<void> {
  const callback = app.__faseripOnTargetHacked;
  if (!callback) return;

  const targetTokenMap: Map<string, HackTargetInfo> | undefined =
    app.__faseripTargetTokenMap;

  for (const tokenId of hackedTokenIds) {
    const targetInfo = targetTokenMap?.get(tokenId);
    if (!targetInfo) continue;
    await callback(targetInfo);
  }
}
