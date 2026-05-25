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
import { showMovementSettingsDialog } from "./module/applications/dialog-utils";

// ─── Movement Settings Menu ─────────────────────────────────────────────────────

/**
 * Settings menu for configuring movement by rank
 */
class MovementSettingsMenu extends FormApplication {
  static override get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "Movement By Rank Settings",
      id: "movement-settings",
      template: "" // No template needed, we use Vue dialog
    });
  }

  override async _updateObject(_event: Event, _formData: any): Promise<void> {
    // Not used - dialog handles updates
  }

  override render(_force?: boolean, _options?: any): this {
    // Launch dialog asynchronously without awaiting
    this.#openDialog();
    return this;
  }

  async #openDialog(): Promise<void> {
    // Get current values
    const raw = game.settings.get("faserip", "movementSquaresByRank") as
      | string
      | undefined;
    let currentValues: Record<string, number> = {};

    try {
      currentValues = JSON.parse(raw || "{}");
    } catch {
      currentValues = {};
    }

    // Show Vue dialog
    const result = await showMovementSettingsDialog(currentValues);

    if (result) {
      // Save the result
      await game.settings.set(
        "faserip",
        "movementSquaresByRank",
        JSON.stringify(result)
      );
      ui.notifications?.info("Movement settings saved.");

      // Re-render all actor sheets to reflect changes
      for (const actor of game.actors ?? []) {
        actor.render();
      }
    }
  }
}

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

  // House Rules: Mental Points (MP) system
  game.settings.register("faserip", "mpEnabled", {
    name: "FASERIP.Settings.mpEnabled.name",
    hint: "FASERIP.Settings.mpEnabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      for (const actor of game.actors ?? []) {
        actor.render();
      }
    }
  });

  // House Rules: Armor / Equipment system
  game.settings.register("faserip", "armorEnabled", {
    name: "FASERIP.Settings.armorEnabled.name",
    hint: "FASERIP.Settings.armorEnabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      for (const actor of game.actors ?? []) {
        actor.render();
      }
    }
  });

  // House Rules: Health Calculation Method
  game.settings.register("faserip", "healthCalculationMethod", {
    name: "FASERIP.Settings.healthCalculationMethod.name",
    hint: "FASERIP.Settings.healthCalculationMethod.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      faseSum: "FASE Sum (F+A+S+E)",
      enduranceX2: "Endurance × 2"
    },
    default: "faseSum",
    onChange: () => {
      // Recalculate health for all actors
      for (const actor of game.actors ?? []) {
        actor.prepareData();
        actor.render();
      }
    }
  });

  // House Rules: Lock player stat editing
  game.settings.register("faserip", "lockPlayerStats", {
    name: "FASERIP.Settings.lockPlayerStats.name",
    hint: "FASERIP.Settings.lockPlayerStats.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      for (const actor of game.actors ?? []) {
        actor.render();
      }
    }
  });

  // Movement mapping by rank (numeric values, edited via menu dialog)
  game.settings.register("faserip", "movementSquaresByRank", {
    name: "Movement By Rank (Squares)",
    hint: "Configure movement distance in squares for each rank. Edited via the Movement Settings button below.",
    scope: "world",
    config: false, // Hidden from config, accessed via menu
    type: String,
    default: JSON.stringify({
      shift_0: 0,
      feeble: 0,
      poor: 1,
      typical: 2,
      good: 4,
      excellent: 6,
      remarkable: 8,
      incredible: 10,
      amazing: 20,
      monstrous: 40,
      unearthly: 60,
      shift_x: 80,
      shift_y: 160,
      shift_z: 400,
      class_1000: 50,
      class_3000: 5000,
      class_5000: 500000,
      beyond: 499999999
    })
  });

  // Register settings menu for movement configuration
  game.settings.registerMenu("faserip", "movementSettingsMenu", {
    name: "Movement Settings",
    label: "Configure Movement By Rank",
    hint: "Open a dialog to configure movement distance (squares) for each rank.",
    icon: "fas fa-person-running",
    type: MovementSettingsMenu,
    restricted: true
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

  // Hook: Ensure PC actors default to linked tokens
  Hooks.on(
    "preCreateActor",
    (document: Actor, _data: any, _options: any, _userId: string) => {
      if (document.type === ActorType.Pc) {
        // @ts-expect-error - TypeScript doesn't recognize the prototypeToken property on Actor
        document.updateSource({ "prototypeToken.actorLink": true });
      }
    }
  );

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

// Export for global access if needed
export { FaseripActor } from "./module/documents";
export { ActorType, Rank, Attribute } from "./module/enums";
export { getCharmanService } from "./module/charman-service";
export { FaseripRoll } from "./module/rolling/index";
