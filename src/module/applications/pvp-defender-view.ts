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

/**
 * A lightweight, non-Vue ApplicationV2 shown on the defending player's own
 * client for a PvP-managed HoloSuite Node Intrusion. It never touches the
 * real minigame app or its graph directly - the actual app instance and all
 * of HoloSuite's own rendering stay on the attacker's client. This view is
 * driven entirely by PvpSnapshot updates pushed over the socket
 * (pvpStateUpdate) and only ever sends plain action requests back
 * (pvpDefenderAction) - see faserip-socket.ts for both directions.
 *
 * Deliberately plain innerHTML/DOM (like the rest of this integration's
 * HoloSuite patches) rather than a Vue component or Handlebars template,
 * since the whole view is just a short adjacency list plus two buttons and
 * doesn't need either's overhead.
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
    position: { width: 360, height: "auto" }
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

    const byId = new Map(snap.nodes.map(n => [n.id, n]));
    const current = byId.get(snap.defenderNodeId ?? "");
    const isMyTurn = snap.turn === "defender";

    const neighborRows = (current?.connected ?? [])
      .map(id => byId.get(id))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map(node => {
        const owned = node.owner === "attacker";
        const label = NODE_LABELS[node.type] ?? node.type;
        const actionLabel = owned
          ? `Recapture ${label} (needs ${node.capturedColor ?? "?"})`
          : `Move to ${label}`;
        return `<button type="button" class="faserip-pvp-move-btn" data-node-id="${node.id}" ${isMyTurn ? "" : "disabled"} style="width:100%;text-align:left;margin-bottom:4px;">${actionLabel}</button>`;
      })
      .join("");

    return `<div style="padding:10px;font-size:13px;line-height:1.5;">
      <p>Current turn: <strong>${snap.turn === "attacker" ? "Attacker" : snap.turn === "defender" ? "Your turn" : "Waiting on combat order"}</strong></p>
      <p>Your position: <strong>${NODE_LABELS[current?.type ?? ""] ?? "Unknown"}</strong></p>
      ${snap.revealNodeId ? `<p>Last scan located the attacker near a revealed node.</p>` : ""}
      <div>${neighborRows || "<p>No adjacent nodes.</p>"}</div>
      <button type="button" class="faserip-pvp-scan-btn" ${isMyTurn ? "" : "disabled"} style="width:100%;margin-top:6px;">Scan (uses your turn)</button>
    </div>`;
  }

  #bindActions(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>(".faserip-pvp-move-btn").forEach(btn => {
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
