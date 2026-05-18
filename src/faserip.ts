import "./faserip.css";

// System imports
import { FaseripActor } from "./module/documents";
import { ActorType } from "./module/enums";
import { PcDataModel, NpcDataModel } from "./module/data-models/index";
import { PcSheet, NpcSheet } from "./module/actor/ActorSheets";
import { initCharmanService } from "./module/charman-service";
import { registerChatCommands } from "./module/chat-commands";
import { rollIntuitionCheck } from "./module/utils/token-hud";
import {
  showIntuitionOverlay,
  removeIntuitionOverlay,
  cleanupAllIntuitionOverlays,
  initIntuitionHoverListener
} from "./module/utils/intuition-overlay";

// ─── Custom Token HUD: Add Intuition Button ────────────────────────────────────

/**
 * Custom TokenHUD that extends the base TokenHUD to add intuition roll functionality
 */
// @ts-expect-error - TypeScript doesn't recognize custom TokenHUD subclass
class FsrTokenHUD extends foundry.applications.hud.TokenHUD {
  constructor(options = {}) {
    super(options);
  }

  /** @override */
  static DEFAULT_OPTIONS = foundry.utils.mergeObject(
    super.DEFAULT_OPTIONS,
    {
      actions: {
        intuition: FsrTokenHUD.#onSelectIntuition
      }
    },
    { inplace: false }
  );

  /**
   * Handle intuition button click
   */
  static async #onSelectIntuition(
    this: FsrTokenHUD,
    _event: PointerEvent,
    _target: HTMLElement
  ): Promise<void> {
    // Roll for all selected tokens
    const controlledTokens = (canvas as any)?.tokens?.controlled || [];

    if (controlledTokens.length === 0) {
      // Fallback to the HUD's token if none are selected
      // @ts-expect-error - TypeScript doesn't recognize the token property on TokenHUD
      const actor = this.document?.actor as FaseripActor;
      if (actor) {
        await rollIntuitionCheck(actor);
      }
    } else {
      // Roll for each selected token
      for (const token of controlledTokens) {
        const actor = token.actor as FaseripActor;
        if (actor) {
          await rollIntuitionCheck(actor);
        }
      }
    }
  }
}

// ─── System Initialization ──────────────────────────────────────────────────────

const initHandler = () => {
  console.log("FASERIP | Initializing system");

  // Register system settings
  game.settings.register("faserip", "charmanApiUrl", {
    name: "FASERIP.Settings.charmanApiUrl.name",
    hint: "FASERIP.Settings.charmanApiUrl.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: (value: any) => {
      // Reinitialize Charman service with new URL
      if (value) {
        initCharmanService({
          baseUrl: value,
          apiPath: game.settings.get("faserip", "charmanApiPath") as
            | string
            | undefined,
          apiKey: game.settings.get("faserip", "charmanApiKey") as
            | string
            | undefined
        });
      }
    }
  });

  game.settings.register("faserip", "charmanApiKey", {
    name: "FASERIP.Settings.charmanApiKey.name",
    hint: "FASERIP.Settings.charmanApiKey.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: (value: any) => {
      // Reinitialize Charman service with new key
      const apiUrl = game.settings.get("faserip", "charmanApiUrl") as string;
      const apiPath = game.settings.get("faserip", "charmanApiPath") as string;
      if (apiUrl) {
        initCharmanService({
          baseUrl: apiUrl,
          apiPath: apiPath || undefined,
          apiKey: value || undefined
        });
      }
    }
  });

  game.settings.register("faserip", "charmanApiPath", {
    name: "FASERIP.Settings.charmanApiPath.name",
    hint: "FASERIP.Settings.charmanApiPath.hint",
    scope: "world",
    config: true,
    type: String,
    default: "/charman/api/foundry",
    onChange: (value: any) => {
      // Reinitialize Charman service with new path
      const apiUrl = game.settings.get("faserip", "charmanApiUrl") as string;
      const apiKey = game.settings.get("faserip", "charmanApiKey") as string;
      if (apiUrl) {
        initCharmanService({
          baseUrl: apiUrl,
          apiPath: value || undefined,
          apiKey: apiKey || undefined
        });
      }
    }
  });

  // Register the custom Actor document class
  // @ts-expect-error - TypeScript doesn't recognize custom Actor subclass
  CONFIG.Actor.documentClass = FaseripActor;

  // Register data models for each actor type
  CONFIG.Actor.dataModels[ActorType.Pc] = PcDataModel;
  CONFIG.Actor.dataModels[ActorType.Npc] = NpcDataModel;

  // Configure trackable attributes for tokens
  CONFIG.Actor.trackableAttributes = {
    pc: {
      bar: ["resources.health"],
      value: ["resources.karma"]
    },
    npc: {
      bar: ["resources.health"],
      value: ["resources.karma"]
    }
  };

  // Register actor sheets
  foundry.documents.collections.Actors.unregisterSheet(
    "core",
    // @ts-expect-error - Type definitions for unregisterSheet don't match Foundry v13 runtime
    foundry.applications.sheets.ActorSheetV2
  );

  // @ts-expect-error - Type definitions for registerSheet don't match Foundry v13 runtime
  foundry.documents.collections.Actors.registerSheet("faserip", PcSheet, {
    types: [ActorType.Pc],
    makeDefault: true,
    label: "FASERIP.ActorType.pc"
  });

  // @ts-expect-error - Type definitions for registerSheet don't match Foundry v13 runtime
  foundry.documents.collections.Actors.registerSheet("faserip", NpcSheet, {
    types: [ActorType.Npc],
    makeDefault: true,
    label: "FASERIP.ActorType.npc"
  });

  // Initialize Charman service from settings
  const charmanApiUrl = game.settings.get("faserip", "charmanApiUrl") as string;
  const charmanApiKey = game.settings.get("faserip", "charmanApiKey") as string;
  const charmanApiPath = game.settings.get(
    "faserip",
    "charmanApiPath"
  ) as string;

  if (charmanApiUrl) {
    initCharmanService({
      baseUrl: charmanApiUrl,
      apiPath: charmanApiPath || undefined,
      apiKey: charmanApiKey || undefined
    });
  }

  // Register chat commands
  registerChatCommands();

  // Hook: Ensure tokens have proper bar configuration when created
  Hooks.on(
    "preCreateToken",
    (
      tokenDocument: TokenDocument,
      data: any,
      _options: any,
      _userId: string
    ) => {
      const actor = tokenDocument.actor;

      // Only for PC actors
      if (actor?.type === ActorType.Pc) {
        // Always set bar1 for health
        data.bar1 = { attribute: "resources.health" };

        // Always set displayBars to OWNER
        actor.prototypeToken.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER
        });
        tokenDocument.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER
        });

        // Always set displayName to ALWAYS
        actor.prototypeToken.updateSource({
          displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS
        });
        tokenDocument.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS
        });
      }
    }
  );
};

// Call initHandler and register TokenHUD - in dev mode run immediately
if (import.meta.env.DEV) {
  initHandler();
  // @ts-expect-error - TypeScript doesn't recognize custom TokenHUD subclass
  CONFIG.Token.hudClass = FsrTokenHUD;
} else {
  Hooks.once("init", () => {
    initHandler();
    // @ts-expect-error - TypeScript doesn't recognize custom TokenHUD subclass
    CONFIG.Token.hudClass = FsrTokenHUD;
  });
}

// ─── Token HUD: Inject Intuition Button ────────────────────────────────────────

Hooks.on("renderTokenHUD", (_hud: any, html: HTMLElement, _data: any) => {
  // Get actor from the HUD instance, not from data
  const actor = _hud.document?.actor;
  if (!actor) {
    console.warn("FASERIP | No actor found in token HUD");
    return;
  }

  // Only show for supported actor types
  const supportedTypes = [ActorType.Pc, ActorType.Npc];
  if (!supportedTypes.includes(actor.type)) {
    return;
  }

  // Add intuition button to left column
  const leftCol = html.querySelector(".col.left");
  if (!leftCol) {
    console.warn("FASERIP | No left column found in token HUD");
    return;
  }

  // Create intuition button
  const intuitionBtn = document.createElement("button");
  intuitionBtn.type = "button";
  intuitionBtn.classList.add("control-icon");
  intuitionBtn.dataset.action = "intuition";
  intuitionBtn.dataset.tooltip = "Roll Intuition Check";
  intuitionBtn.innerHTML = `<i class="fas fa-eye"></i>`;
  leftCol.appendChild(intuitionBtn);
});

// ─── Chat Message: Show Intuition Overlay ───────────────────────────────────────

Hooks.on("createChatMessage", (message: any) => {
  if (!message.flags?.faserip?.intuitionCheck) {
    console.log("FASERIP | Not an intuition check message");
    return;
  }

  console.log("FASERIP | This is an intuition check!");

  const tokenId: string | undefined = message.flags?.faserip?.tokenId;

  console.log("FASERIP | tokenId:", tokenId);

  if (!tokenId) {
    console.warn("FASERIP | Missing tokenId");
    return;
  }

  const rolls: any[] = message.rolls ?? [];
  if (!rolls.length) {
    console.warn("FASERIP | No rolls in message");
    return;
  }
  const total: number = rolls[0]?.total ?? 0;

  console.log("FASERIP | Roll total:", total);

  // Calculate color class from roll total
  let colorClass = "white";
  if (total === 1) {
    colorClass = "ultimate-botch";
  } else if (total >= 2 && total <= 5) {
    colorClass = "botch";
  } else if (total === 100) {
    colorClass = "perfect";
  } else {
    // Get the result class from the message content
    const content = message.content || "";
    if (content.includes("fsr-roll-red")) {
      colorClass = "red";
    } else if (content.includes("fsr-roll-yellow")) {
      colorClass = "yellow";
    } else if (content.includes("fsr-roll-green")) {
      colorClass = "green";
    }
  }

  const durationMs = 8000; // 8 seconds

  // Handle Dice So Nice integration if present
  const hasDSN = !!(game as any).dice3d;
  console.log("FASERIP | Dice So Nice present:", hasDSN);

  if (hasDSN) {
    let shown = false;

    const dsnCallback = (completedMessageId: string) => {
      if (completedMessageId !== message.id) return;
      shown = true;
      console.log("FASERIP | DSN animation complete, showing overlay");
      // @ts-expect-error - Dice So Nice hook not in core types
      Hooks.off("diceSoNiceRollComplete", dsnCallback);
      showIntuitionOverlay(tokenId, total, colorClass, durationMs);
    };
    // @ts-expect-error - Dice So Nice hook not in core types
    Hooks.on("diceSoNiceRollComplete", dsnCallback);

    // Safety fallback: if DSN never fires, show after 4 seconds
    setTimeout(() => {
      // @ts-expect-error - Dice So Nice hook not in core types
      Hooks.off("diceSoNiceRollComplete", dsnCallback);
      if (!shown) {
        console.log("FASERIP | DSN timeout, showing overlay anyway");
        showIntuitionOverlay(tokenId, total, colorClass, durationMs);
      }
    }, 4000);
  } else {
    console.log("FASERIP | No DSN, showing overlay immediately");
    showIntuitionOverlay(tokenId, total, colorClass, durationMs);
  }
});

// ─── Canvas Lifecycle: Manage Overlays ──────────────────────────────────────────

Hooks.on("canvasReady", () => {
  cleanupAllIntuitionOverlays();
  initIntuitionHoverListener();
});

Hooks.on("deleteToken", (_scene: any, tokenDoc: any) => {
  if (tokenDoc?.id) removeIntuitionOverlay(tokenDoc.id);
});

// Ready hook
Hooks.once("ready", () => {
  console.log("FASERIP | System ready");
});

// Add custom CSS to chat messages for better formatting
Hooks.on("renderChatMessageHTML", (_app: ChatMessage, html: HTMLElement) => {
  // Add custom styling for FASERIP roll cards
  const rollCard = html.querySelector(".fsr-roll-card") as HTMLElement;
  if (rollCard) {
    rollCard.style.padding = "12px";
    rollCard.style.backgroundColor = "#1f2937";
    rollCard.style.borderRadius = "8px";
    rollCard.style.marginTop = "8px";
  }
});

// Export for global access if needed
export { FaseripActor } from "./module/documents";
export { ActorType, Rank, Attribute } from "./module/enums";
export { getCharmanService } from "./module/charman-service";
export { FaseripRoll } from "./module/rolling/index";
