import "./faserip.css";

// System imports
import { FaseripActor } from "./module/documents";
import { ActorType, ItemType } from "./module/enums";
import {
  PcDataModel,
  NpcDataModel,
  PowerDataModel,
  TalentDataModel,
  EquipmentDataModel,
  ContactDataModel,
  ArmorDataModel,
  WeaponDataModel
} from "./module/data-models/index";
import { PcSheet, NpcSheet } from "./module/actor/ActorSheets";
import {
  ArmorSheet,
  WeaponSheet,
  GenericItemSheet
} from "./module/item/ItemSheets";
import { initCharmanService } from "./module/charman-service";
import { registerChatCommands } from "./module/chat-commands";
import { rollIntuitionCheck } from "./module/utils/token-hud";
import {
  showIntuitionOverlay,
  removeIntuitionOverlay,
  cleanupAllIntuitionOverlays,
  initIntuitionHoverListener
} from "./module/utils/intuition-overlay";
import {
  migrateEmbeddedItemsToDocuments,
  forceMigrateItems
} from "./module/utils/migrate-items";
import { showMovementSettingsDialog } from "./module/applications/dialog-utils";
import { initializeSocket } from "./module/socket/faserip-socket";

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

  // House Rules: Degrading Armor
  game.settings.register("faserip", "degradingArmor", {
    name: "FASERIP.Settings.degradingArmor.name",
    hint: "FASERIP.Settings.degradingArmor.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "None (No Degradation)",
      full: "Full (Reduced by Damage Soaked)",
      "per-hit": "Per-Hit (Reduced by 1 per Penetrating Hit)"
    },
    default: "none",
    requiresReload: true,
    onChange: () => {
      for (const actor of game.actors ?? []) {
        actor.render();
      }
    }
  });

  // House Rules: Vulnerability Powers
  game.settings.register("faserip", "vulnerabilityPowers", {
    name: "FASERIP.Settings.vulnerabilityPowers.name",
    hint: "FASERIP.Settings.vulnerabilityPowers.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
    onChange: () => {
      for (const actor of game.actors ?? []) {
        actor.render();
      }
    }
  });

  // House Rules: Vulnerability Damage Increase Percentage
  game.settings.register("faserip", "vulnerabilityDamageIncrease", {
    name: "FASERIP.Settings.vulnerabilityDamageIncrease.name",
    hint: "FASERIP.Settings.vulnerabilityDamageIncrease.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 25,
    range: {
      min: 0,
      max: 100,
      step: 5
    }
  });

  // House Rules: Weapons System
  game.settings.register("faserip", "weaponsEnabled", {
    name: "FASERIP.Settings.weaponsEnabled.name",
    hint: "FASERIP.Settings.weaponsEnabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    requiresReload: true,
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

  // Migration flag for converting embedded armors/weapons to Item documents
  game.settings.register("faserip", "itemsMigrationCompleted", {
    name: "Items Migration Completed",
    hint: "Internal flag tracking whether embedded armors/weapons have been migrated to Item documents.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  // Register the custom Actor document class
  CONFIG.Actor.documentClass = FaseripActor;

  // Configure FASERIP-specific settings
  // @ts-expect-error - Custom CONFIG property
  CONFIG.FASERIP = {
    ranks: {
      shift_0: "Shift 0",
      feeble: "Feeble",
      poor: "Poor",
      typical: "Typical",
      good: "Good",
      excellent: "Excellent",
      remarkable: "Remarkable",
      incredible: "Incredible",
      amazing: "Amazing",
      monstrous: "Monstrous",
      unearthly: "Unearthly",
      shift_x: "Shift X",
      shift_y: "Shift Y",
      shift_z: "Shift Z",
      class_1000: "Class 1000",
      class_3000: "Class 3000",
      class_5000: "Class 5000",
      beyond: "Beyond"
    }
  };

  // Register Handlebars helpers for templates
  Handlebars.registerHelper("gt", (a: number, b: number) => a > b);
  Handlebars.registerHelper("subtract", (a: number, b: number) => a - b);
  Handlebars.registerHelper("eq", (a: any, b: any) => a === b);
  Handlebars.registerHelper("checked", (value: boolean) =>
    value ? "checked" : ""
  );

  // Register data models for each actor type
  CONFIG.Actor.dataModels[ActorType.Pc] = PcDataModel;
  CONFIG.Actor.dataModels[ActorType.Npc] = NpcDataModel;

  // Register data models for each item type
  CONFIG.Item.dataModels[ItemType.Power] = PowerDataModel;
  CONFIG.Item.dataModels[ItemType.Talent] = TalentDataModel;
  CONFIG.Item.dataModels[ItemType.Equipment] = EquipmentDataModel;
  CONFIG.Item.dataModels[ItemType.Contact] = ContactDataModel;
  CONFIG.Item.dataModels[ItemType.Armor] = ArmorDataModel;
  CONFIG.Item.dataModels[ItemType.Weapon] = WeaponDataModel;

  // Log registered item types for debugging
  console.log(
    "FASERIP | Registered Item Types:",
    Object.keys(CONFIG.Item.dataModels)
  );

  // Configure trackable attributes for tokens
  CONFIG.Actor.trackableAttributes = {
    pc: {
      bar: ["resources.health", "resources.armor"],
      value: ["resources.karma"]
    },
    npc: {
      bar: ["resources.health", "resources.armor"],
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

  // Register item sheets
  foundry.documents.collections.Items.unregisterSheet(
    "core",
    // @ts-expect-error - Type definitions don't match Foundry v13 runtime
    foundry.applications.sheets.ItemSheetV2
  );

  // @ts-expect-error - Type definitions don't match Foundry v13 runtime
  foundry.documents.collections.Items.registerSheet("faserip", ArmorSheet, {
    types: [ItemType.Armor],
    makeDefault: true,
    label: "FASERIP.ItemType.armor"
  });

  // @ts-expect-error - Type definitions don't match Foundry v13 runtime
  foundry.documents.collections.Items.registerSheet("faserip", WeaponSheet, {
    types: [ItemType.Weapon],
    makeDefault: true,
    label: "FASERIP.ItemType.weapon"
  });

  foundry.documents.collections.Items.registerSheet(
    "faserip",
    // @ts-expect-error - Type definitions don't match Foundry v13 runtime
    GenericItemSheet,
    {
      types: [
        ItemType.Power,
        ItemType.Talent,
        ItemType.Equipment,
        ItemType.Contact
      ],
      makeDefault: true,
      label: "FASERIP.ItemType.generic"
    }
  );

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

      // PC actors: bar1 for health, bar2 for armor, bars always visible
      if (actor?.type === ActorType.Pc) {
        // Always set bar1 for health
        data.bar1 = { attribute: "resources.health" };

        // Always set bar2 for armor
        data.bar2 = { attribute: "resources.armor" };

        // Always set displayBars to ALWAYS (visible to everyone)
        actor.prototypeToken.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS
        });
        tokenDocument.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS
        });

        // Always set displayName to ALWAYS
        actor.prototypeToken.updateSource({
          displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS
        });
        tokenDocument.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS
        });
      }
      // NPC actors: bar2 for armor, bars visible to owner only
      else if (actor?.type === ActorType.Npc) {
        // Set bar2 for armor
        data.bar2 = { attribute: "resources.armor" };

        // Set displayBars to OWNER (visible to owner only)
        actor.prototypeToken.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER
        });
        tokenDocument.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER
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

// ─── Actor Update Hook: Sync health changes to healthByForm ────────────────────

Hooks.on("preUpdateActor", (actor: any, changes: any, _options: any) => {
  // Don't sync health if we're switching forms - switchForm() handles that
  if (changes.system?.currentFormId !== undefined) {
    return;
  }

  // If health value is being updated, also update the healthByForm for current form
  if (changes.system?.resources?.health?.value !== undefined) {
    const currentFormId = actor.system.currentFormId;
    if (currentFormId) {
      // Clone the existing healthByForm and update it
      const updatedHealthByForm = {
        ...(actor.system.healthByForm || {}),
        [currentFormId]: changes.system.resources.health.value
      };
      changes.system.healthByForm = updatedHealthByForm;
    }
  }
});

// ─── Actor Update Hook: Sync name changes to PC tokens ──────────────────────────

Hooks.on("updateActor", async (actor: any, changes: any, _options: any) => {
  // Only handle name changes for PC actors
  if (actor.type !== ActorType.Pc || changes.name === undefined) {
    return;
  }

  const newName = changes.name;

  // Update prototype token and all linked tokens
  actor.prototypeToken.updateSource({ name: newName });

  // Update all existing linked tokens on active scenes
  // @ts-expect-error - game.scenes type not fully recognized
  for (const scene of game.scenes!) {
    const tokens = scene.tokens.filter(
      (t: any) => t.actorId === actor.id && t.actorLink
    );

    if (tokens.length > 0) {
      const updates = tokens.map((token: any) => ({
        _id: token.id,
        name: newName
      }));

      await scene.updateEmbeddedDocuments("Token", updates);
    }
  }
});

// ─── Token Update Hook: Sync delta name changes to token name (unlinked) ────────

Hooks.on("updateToken", async (token: any, changes: any, _options: any) => {
  // Only handle delta name changes for PC unlinked tokens
  if (!token.actor || token.actor.type !== ActorType.Pc || token.actorLink) {
    return;
  }

  // If the actor's name changed in the delta, update the token's name to match
  if (changes.delta?.name !== undefined) {
    await token.update({ name: changes.delta.name }, { diff: false });
  }
});

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

// Hook: Ensure bars are present when tokens are updated
Hooks.on(
  "preUpdateToken",
  (tokenDoc: TokenDocument, changes: any, _options: any, _userId: string) => {
    const actor = tokenDoc.actor;
    if (!actor) return;

    // If this update doesn't touch bar config, check if we need to add it
    if (!changes.bar1 && !changes.bar2 && !changes.displayBars) {
      // PC actors: bar1 for health, bar2 for armor, bars always visible
      if (actor.type === ActorType.Pc) {
        const needsBar1 =
          !tokenDoc.bar1?.attribute ||
          tokenDoc.bar1.attribute !== "resources.health";
        const needsBar2 =
          !tokenDoc.bar2?.attribute ||
          tokenDoc.bar2.attribute !== "resources.armor";
        const needsDisplayBars =
          tokenDoc.displayBars !== CONST.TOKEN_DISPLAY_MODES.ALWAYS;

        if (needsBar1) {
          changes.bar1 = { attribute: "resources.health" };
        }
        if (needsBar2) {
          changes.bar2 = { attribute: "resources.armor" };
        }
        if (needsDisplayBars) {
          changes.displayBars = CONST.TOKEN_DISPLAY_MODES.ALWAYS;
        }
      }
      // NPC actors: bar2 for armor, bars visible to owner only
      else if (actor.type === ActorType.Npc) {
        const needsBar2 =
          !tokenDoc.bar2?.attribute ||
          tokenDoc.bar2.attribute !== "resources.armor";
        const needsDisplayBars =
          tokenDoc.displayBars !== CONST.TOKEN_DISPLAY_MODES.OWNER;

        if (needsBar2) {
          changes.bar2 = { attribute: "resources.armor" };
        }
        if (needsDisplayBars) {
          changes.displayBars = CONST.TOKEN_DISPLAY_MODES.OWNER;
        }
      }
    }
  }
);

// Ready hook
Hooks.once("ready", async () => {
  console.log("FASERIP | System ready");

  // Diagnostic: Log valid item types recognized by Foundry
  // @ts-expect-error - TypeScript doesn't recognize documentTypes on game
  const itemTypes = game.documentTypes?.Item || [];

  // Initialize socket system for multiplayer combat interactions
  initializeSocket();

  // Run migration to convert embedded armors/weapons to Item documents
  // This only runs once per world and is safe to call repeatedly
  // @ts-expect-error - TypeScript doesn't recognize game.user.isGM
  if (game.user?.isGM) {
    await migrateEmbeddedItemsToDocuments();
  }

  // Set up game.faserip namespace for console access
  game.faserip = {
    forceMigrateItems
  };
});

// Export for global access if needed
export { FaseripActor } from "./module/documents";
export { ActorType, Rank, Attribute } from "./module/enums";
export { getCharmanService } from "./module/charman-service";
export { FaseripRoll } from "./module/rolling/index";
export { forceMigrateItems } from "./module/utils/migrate-items";
