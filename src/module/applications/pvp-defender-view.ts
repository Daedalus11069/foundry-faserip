import type { PvpSnapshot, PvpDefenderAction } from "../integrations/holosuite-pvp-intrusion";

declare const foundry: any;

const NODE_LABELS: Record<string, string> = {
  start: "Entry Point",
  target: "Your Entry Point",
  normal: "Relay",
  firewall: "Firewall",
  decoy: "Decoy",
  datastore: "Datastore"
};

const NODE_TYPE_COLOR: Record<string, string> = {
  start: "#5dade2",
  target: "#f4d03f",
  normal: "#7f8c8d",
  firewall: "#e74c3c",
  decoy: "#9b59b6",
  datastore: "#e67e22"
};

const PVP_OWNER_COLOR = "#7b241c";

/**
 * A lightweight, non-Vue ApplicationV2 shown on the defending player's own
 * client for a PvP-managed HoloSuite Node Intrusion. It never touches the
 * real minigame app or its graph directly - the actual app instance and all
 * of HoloSuite's own rendering stay on the attacker's client. This view is
 * driven entirely by PvpSnapshot updates pushed over the socket
 * (pvpStateUpdate) and only ever sends plain action requests back
 * (pvpDefenderAction) - see faserip-socket.ts for both directions.
 *
 * Renders an actual node/edge map using the same x/y percentage layout
 * HoloSuite's own template uses (forwarded through PvpSnapshot) - not a
 * substitute text list. The defender sees the whole network at all times
 * (they own it), except the attacker's own position, which stays hidden
 * until a successful Scan reveals it at snapshot.revealNodeId.
 */
export class PvpDefenderView extends (foundry.applications.api
  .ApplicationV2 as any) {
  static DEFAULT_OPTIONS = {
    id: "faserip-pvp-defender-view",
    classes: ["faserip-pvp-defender-view"],
    window: {
      title: "Intrusion Defense",
      icon: "fa-solid fa-shield-halved",
      minimizable: true,
      resizable: true
    },
    position: { width: 460, height: "auto" }
  };

  snapshot: PvpSnapshot;
  onAction: (action: PvpDefenderAction) => void;

  constructor(
    snapshot: PvpSnapshot,
    onAction: (action: PvpDefenderAction) => void,
    options: Record<string, unknown> = {}
  ) {
    super(options);
    this.snapshot = snapshot;
    this.onAction = onAction;
  }

  /** Called from faserip-socket.ts whenever a fresh pvpStateUpdate arrives
   * for this session, instead of tearing down and recreating the view. */
  applySnapshot(snapshot: PvpSnapshot): void {
    this.snapshot = snapshot;
    if (this.rendered) this.render(false);
  }

  async _renderHTML(): Promise<{ html: string }> {
    return { html: this.#buildHtml() };
  }

  _replaceHTML(result: { html: string }, content: HTMLElement): void {
    content.innerHTML = result.html;
    this.#bindActions(content);
  }

  #buildHtml(): string {
    const snap = this.snapshot;
    if (snap.ended) {
      const won = snap.winner === "defender";
      return `<div style="padding:10px;font-size:13px;line-height:1.5;">
        <p><strong>${won ? "Intrusion repelled!" : "Intrusion successful."}</strong></p>
        <p>${won ? "You reached the attacker's entry point first." : "The attacker reached their goal before you could stop them."}</p>
      </div>`;
    }

    if (!snap.unleashed) {
      return `<div style="padding:10px;font-size:13px;line-height:1.5;">
        <p>No intrusion detected yet - you can't act until the attacker trips detection somewhere in the network.</p>
      </div>`;
    }

    const isMyTurn = snap.turn === "defender";
    const byId = new Map(snap.nodes.map(n => [n.id, n]));
    const current = byId.get(snap.defenderNodeId ?? "");
    const reachable = new Set(current?.connected ?? []);

    const edgesSvg = snap.nodes
      .flatMap(node =>
        node.connected
          .filter(id => id > node.id) // draw each edge once
          .map(id => {
            const other = byId.get(id);
            if (!other) return "";
            return `<line x1="${node.x}" y1="${node.y}" x2="${other.x}" y2="${other.y}" stroke="rgba(255,255,255,0.25)" stroke-width="0.5" />`;
          })
      )
      .join("");

    const nodeButtons = snap.nodes
      .map(node => {
        const owned = node.owner === "attacker";
        const color = owned ? PVP_OWNER_COLOR : NODE_TYPE_COLOR[node.type] ?? "#7f8c8d";
        const isCurrent = node.id === snap.defenderNodeId;
        const isRevealedAttacker = node.id === snap.revealNodeId;
        const isReachable = reachable.has(node.id) && isMyTurn;
        const label = NODE_LABELS[node.type] ?? node.type;
        const title = owned
          ? `${label} - held by attacker (recapture needs ${node.capturedColor ?? "?"})`
          : label;

        return `<button
          type="button"
          class="faserip-pvp-map-node"
          data-node-id="${node.id}"
          title="${title}"
          ${isReachable ? "" : "disabled"}
          style="
            position:absolute;
            left:${node.x}%;
            top:${node.y}%;
            transform:translate(-50%, -50%);
            width:22px;
            height:22px;
            border-radius:50%;
            background:${color};
            border:2px solid ${isCurrent ? "#fff" : isReachable ? "#2ecc71" : "rgba(255,255,255,0.3)"};
            box-shadow:${isRevealedAttacker ? "0 0 0 3px #f1c40f" : "none"};
            cursor:${isReachable ? "pointer" : "default"};
            padding:0;
          "
        >${isRevealedAttacker ? '<i class="fa-solid fa-crosshairs" style="font-size:10px;color:#fff;"></i>' : ""}</button>`;
      })
      .join("");

    // Fixed pixel height on the map div rather than height:100%/flex - that
    // depends on the ApplicationV2 content wrapper actually resolving a
    // concrete height, which isn't guaranteed and left the whole map
    // silently collapsed to 0px tall (confirmed live as "nothing appears").
    return `<div style="padding:6px 8px;font-size:12px;">
      <div>Current turn: <strong>${snap.turn === "attacker" ? "Attacker" : "Your turn"}</strong></div>
      <div>Your position: <strong>${NODE_LABELS[current?.type ?? ""] ?? "Unknown"}</strong></div>
      <div style="position:relative;width:100%;height:380px;margin-top:6px;background:rgba(0,0,0,0.35);border-radius:4px;overflow:hidden;">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">${edgesSvg}</svg>
        ${nodeButtons}
      </div>
      <button type="button" class="faserip-pvp-scan-btn" ${isMyTurn ? "" : "disabled"} style="width:100%;margin-top:6px;">Scan (uses your turn)</button>
    </div>`;
  }

  #bindActions(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>(".faserip-pvp-map-node").forEach(btn => {
      btn.addEventListener("click", () => {
        const nodeId = btn.dataset.nodeId;
        if (nodeId) this.onAction({ type: "move", nodeId });
      });
    });
    root.querySelector<HTMLButtonElement>(".faserip-pvp-scan-btn")?.addEventListener(
      "click",
      () => this.onAction({ type: "scan" })
    );
  }
}
