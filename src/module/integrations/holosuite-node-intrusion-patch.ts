import { RollResult } from "../enums";
import {
  rollFaseripHackCheck,
  meetsRequiredColor,
  ROLL_COLOR_RANK,
  type FaseripHackContext
} from "./holosuite-roll-adapter";

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

        this.__faseripRollPending = true;
        pauseTrace(this);
        try {
          const faseripRoll = await rollFaseripHackCheck(
            context,
            "Node Attempt"
          );

          resumeTrace(this);
          applyRadarFromRoll(this, faseripRoll.result);

          if (!meetsRequiredColor(faseripRoll.result, context.requiredColor)) {
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
