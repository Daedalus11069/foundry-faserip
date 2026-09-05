import { RollResult } from "../enums";
import {
  rollFaseripHackCheck,
  meetsRequiredColor,
  ROLL_COLOR_RANK,
  type FaseripHackContext,
  type HackTargetInfo
} from "./holosuite-roll-adapter";

declare const ui: any;

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

          if (!meetsRequiredColor(faseripRoll.result, requiredColor)) {
            // Failed attempt (below the target's required color, e.g. a
            // hackable actor's DC): reuse the minigame's own invalid-pulse
            // feedback and firewall/decoy-style trace penalty.
            const shell = this.element?.find?.(".node-intrusion-shell");
            shell?.addClass("invalid-pulse");
            globalThis.window?.setTimeout(
              () => shell?.removeClass("invalid-pulse"),
              280
            );
            const penalty =
              Number(
                this.profile.decoyPenaltySeconds ??
                  this.profile.nodeIntrusion?.decoyPenaltySeconds
              ) || 4;
            this.addTracePenalty(penalty);
            return;
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
