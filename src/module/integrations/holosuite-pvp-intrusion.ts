import { RollResult } from "../enums";
import { meetsRequiredColor } from "./holosuite-roll-adapter";

declare const game: any;
declare const ui: any;
declare const ChatMessage: any;

/**
 * Config for a PvP-managed Node Intrusion: an attacker trying to reach the
 * defender's start node before the defender reaches theirs. Turn order is
 * whatever Foundry's own combat tracker says - both sides must already be
 * Combatants in the active encounter. Chosen per-hack-attempt via a modal
 * shown before the node graph is generated, not a world setting, since a GM
 * may run the same target either managed (PvP) or classic (point/time trace)
 * depending on the situation - only a player-controlled defender forces
 * managed mode.
 */
export interface FaseripPvpConfig {
  attackerCombatantId: string;
  defenderCombatantId: string;
  /** The Universal Table color a Scan attempt must reach to reveal the
   * opponent's position - fixed once, from the attacker's initial hack roll
   * (before the graph even existed), not re-derived or re-rolled per scan
   * attempt. Populated right after that roll resolves, so it's absent only
   * in the brief window between combatant resolution and the roll landing. */
  scanRequiredColor?: RollResult;
  /** Identifies this specific run across sockets - the app registry, the
   * defender's client view, and every state-update/action message are all
   * keyed by this instead of anything derived from HoloSuite's own
   * (unrelated) live-session id. */
  sessionId: string;
  /** Foundry user id of whoever is running the attacker's client (the one
   * holding the real, authoritative Node Intrusion app instance). */
  attackerUserId: string;
  /** Foundry user id of the defender's owner (a PC's own player, or a GM
   * for an NPC) - null when no connected owner could be resolved, in which
   * case no cross-client defender view is opened (the GM plays both sides
   * from the single attacker-side instance, same as before). */
  defenderUserId: string | null;
}

const NODE_OWNER_ATTACKER = "attacker";
const NODE_OWNER_DEFENDER = "defender";

/** Whether it's currently the given side's turn in the active combat. */
export function isPvpTurn(pvp: FaseripPvpConfig, side: "attacker" | "defender"): boolean {
  const combatantId =
    side === "attacker" ? pvp.attackerCombatantId : pvp.defenderCombatantId;
  return game.combat?.combatant?.id === combatantId;
}

/**
 * Sets up initial node ownership and starting positions: the defender owns
 * every node except the attacker's own start node (which the attacker
 * "owns" by starting there), and starts standing on the graph's "target"
 * node - the opposite side of the map, which doubles as the attacker's own
 * goal (symmetric win conditions: attacker wins by reaching the defender's
 * start/entry point - the "start" node; defender wins by reaching the
 * attacker's entry point - the "target" node they themselves started on).
 * Called once, right after the graph is generated, before either side has
 * moved.
 */
export function initializePvpOwnership(app: any): void {
  const nodes: any[] = app.graph?.nodes ?? [];
  const attackerStart = nodes.find(n => n.type === "start");
  const defenderStart = nodes.find(n => n.type === "target");
  for (const node of nodes) {
    node.faseripOwner =
      node === attackerStart ? NODE_OWNER_ATTACKER : NODE_OWNER_DEFENDER;
  }
  app.__faseripDefenderUnleashed = false;
  app.__faseripPvpDefenderNodeId = defenderStart?.id ?? null;
}

export function getDefenderPosition(app: any): string | null {
  return app.__faseripPvpDefenderNodeId ?? null;
}

export function setDefenderPosition(app: any, nodeId: string): void {
  app.__faseripPvpDefenderNodeId = nodeId;
}

/** Resolves the actual FaseripActor standing in for a PvP side, via its
 * Combatant in the active combat - the same one isPvpTurn checks turn order
 * against. */
export function resolvePvpActor(pvp: FaseripPvpConfig, side: "attacker" | "defender"): any {
  const combatantId =
    side === "attacker" ? pvp.attackerCombatantId : pvp.defenderCombatantId;
  return game.combat?.combatants?.get?.(combatantId)?.actor ?? null;
}

/**
 * Marks a node captured by the attacker, stamping the roll result the
 * attacker actually achieved (not just the threshold it needed to clear) -
 * that stored color, not the node's static difficulty, is what the defender
 * must beat to recapture it later, so an overkill roll leaves a harder node
 * to take back than a bare pass.
 */
export function recordAttackerCapture(node: any, rollResult: RollResult): void {
  node.faseripOwner = NODE_OWNER_ATTACKER;
  node.faseripCapturedColor = rollResult;
}

/** Call once, the first time detection trips (see checkDetection in the
 * single-player patch) - the defender can't act at all until this happens. */
export function unleashDefender(app: any): void {
  if (app.__faseripDefenderUnleashed) return;
  app.__faseripDefenderUnleashed = true;
  ui.notifications?.info?.("Defender detected the intrusion and is now moving.");
}

/**
 * The defender's recapture check: they must match or beat the color the
 * attacker actually rolled when they took the node, not the node's own
 * difficulty threshold. Success flips ownership back to the defender but
 * does NOT touch the attacker's position, visited/traversed state, or any
 * edges - the attacker keeps whatever progress they made through/past this
 * node. Failure just burns the defender's turn (no other cost, no retry
 * lockout - they can try again next turn).
 */
export function attemptRecapture(node: any, defenderRollResult: RollResult): boolean {
  const requiredColor: RollResult = node.faseripCapturedColor ?? RollResult.Green;
  const success = meetsRequiredColor(defenderRollResult, requiredColor);
  if (success) {
    node.faseripOwner = NODE_OWNER_DEFENDER;
    delete node.faseripCapturedColor;
  }
  return success;
}

/**
 * Graph-hop distance (not physical/pixel distance) between two nodes, via
 * plain BFS over `connected` - used to gate the Scan action to "within 2
 * nodes of each other."
 */
export function hopDistance(nodes: any[], fromId: string, toId: string): number {
  if (fromId === toId) return 0;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set([fromId]);
  let frontier = [fromId];
  let distance = 0;
  while (frontier.length) {
    distance += 1;
    const next: string[] = [];
    for (const id of frontier) {
      const node = byId.get(id);
      for (const neighborId of node?.connected ?? []) {
        if (visited.has(neighborId)) continue;
        if (neighborId === toId) return distance;
        visited.add(neighborId);
        next.push(neighborId);
      }
    }
    frontier = next;
  }
  return Infinity;
}

/**
 * Scan action: costs the acting side's whole turn (mutually exclusive with
 * moving or recapturing), only usable within 2 graph-hops of the opponent's
 * current node. Its required color is fixed at map-generation time from the
 * attacker's initial hack roll (before the graph existed) - not re-rolled or
 * re-derived per attempt - so store that threshold on the pvp config once,
 * at setup, and just compare against it here.
 */
export function attemptScan(
  nodes: any[],
  scannerNodeId: string,
  targetNodeId: string,
  scanRequiredColor: RollResult,
  scanRollResult: RollResult
): { inRange: boolean; success: boolean } {
  const inRange = hopDistance(nodes, scannerNodeId, targetNodeId) <= 2;
  if (!inRange) return { inRange: false, success: false };
  return { inRange: true, success: meetsRequiredColor(scanRollResult, scanRequiredColor) };
}

/** Ends a PvP run immediately and reports the outcome to chat. */
export function finishPvpRun(
  app: any,
  winner: "attacker" | "defender",
  reason: string
): void {
  app.__faseripPvpResult = winner;
  const message =
    winner === "attacker"
      ? `Intrusion successful - attacker reached the goal. (${reason})`
      : `Intrusion repelled - defender reached the attacker's entry point. (${reason})`;
  try {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: `<p><i class="fa-solid fa-arrows-to-dot"></i> <strong>${message}</strong></p>`
    });
  } catch (err) {
    console.warn("faserip | Failed to post PvP intrusion result chat message", err);
  }
  app.stopTimer?.();
  app.finish?.(winner === "attacker" ? "success" : "failure", message);
}

/** True once a PvP run has ended, however it ended - either finishPvpRun
 * (defender reached the entry point) or the stock success path (attacker
 * reached the target node, handled entirely by HoloSuite's own code). */
export function isPvpRunEnded(app: any): boolean {
  return !!app.__faseripPvpResult;
}

/**
 * Registry of live PvP-managed Node Intrusion app instances, keyed by
 * FaseripPvpConfig.sessionId - lets a socket message arriving on the
 * attacker's client (a remote action from the defender's own view) find the
 * one real, authoritative app instance to apply it to. Not persisted:
 * populated when a managed hack starts, removed when it ends.
 */
const pvpAppRegistry = new Map<string, any>();

export function registerPvpApp(sessionId: string, app: any): void {
  pvpAppRegistry.set(sessionId, app);
}

export function unregisterPvpApp(sessionId: string): void {
  pvpAppRegistry.delete(sessionId);
}

export function getPvpApp(sessionId: string): any {
  return pvpAppRegistry.get(sessionId) ?? null;
}

/**
 * A JSON-safe snapshot of everything the defender's cross-client view needs
 * to render itself and decide what actions are currently legal - sent over
 * the socket rather than the live app instance itself.
 */
export interface PvpSnapshot {
  sessionId: string;
  nodes: Array<{
    id: string;
    type: string;
    connected: string[];
    owner: "attacker" | "defender";
    capturedColor: RollResult | null;
  }>;
  attackerNodeId: string | null;
  defenderNodeId: string | null;
  unleashed: boolean;
  revealNodeId: string | null;
  turn: "attacker" | "defender" | "none";
  ended: boolean;
  winner: "attacker" | "defender" | null;
}

export function buildPvpSnapshot(app: any): PvpSnapshot | null {
  const pvp: FaseripPvpConfig | undefined = app.__faseripHackContext?.pvp;
  if (!pvp) return null;

  const nodes: any[] = app.graph?.nodes ?? [];
  return {
    sessionId: pvp.sessionId,
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type,
      connected: n.connected ?? [],
      owner: n.faseripOwner === NODE_OWNER_ATTACKER ? NODE_OWNER_ATTACKER : NODE_OWNER_DEFENDER,
      capturedColor: n.faseripCapturedColor ?? null
    })),
    attackerNodeId: app.state?.currentNodeId ?? null,
    defenderNodeId: getDefenderPosition(app),
    unleashed: !!app.__faseripDefenderUnleashed,
    revealNodeId: app.__faseripPvpRevealNodeId ?? null,
    turn: isPvpTurn(pvp, "attacker")
      ? "attacker"
      : isPvpTurn(pvp, "defender")
        ? "defender"
        : "none",
    ended: !!app.__faseripPvpResult,
    winner: app.__faseripPvpResult ?? null
  };
}

export type PvpDefenderAction =
  | { type: "move"; nodeId: string }
  | { type: "scan" };

type PvpActionHandler = (
  app: any,
  pvp: FaseripPvpConfig,
  action: PvpDefenderAction
) => Promise<void>;

// Set by holosuite-node-intrusion-patch.ts (which owns the actual
// move/recapture/scan logic and its FASERIP roll dependencies) so this
// module - and faserip-socket.ts, which calls dispatchPvpAction for a
// remote action - never needs to import that file directly. Avoids a
// faserip-socket <-> holosuite-node-intrusion-patch import cycle.
let pvpActionHandler: PvpActionHandler | null = null;

export function registerPvpActionHandler(handler: PvpActionHandler): void {
  pvpActionHandler = handler;
}

export async function dispatchPvpAction(
  sessionId: string,
  action: PvpDefenderAction
): Promise<PvpSnapshot | null> {
  const app = getPvpApp(sessionId);
  const pvp: FaseripPvpConfig | undefined = app?.__faseripHackContext?.pvp;
  if (!app || !pvp || !pvpActionHandler) return null;
  await pvpActionHandler(app, pvp, action);
  return buildPvpSnapshot(app);
}

export { NODE_OWNER_ATTACKER, NODE_OWNER_DEFENDER };
