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
import {
  handleCharacterRollCommand,
  handleRollCommand,
  parseRankExpression
} from "./module/chat-commands";
import { rollIntuitionCheck } from "./module/utils/token-hud";
import {
  tickTemporaryModifiers,
  tickDotEffectsForCombatant
} from "./module/utils/temp-effects";
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
import {
  migratePowerArrayFields,
  forceMigratePowerArrayFields
} from "./module/utils/migrate-power-arrays";
import {
  showMovementSettingsDialog,
  showTableEffectsEditor
} from "./module/applications/dialog-utils";
import { initializeSocket } from "./module/socket/faserip-socket";
import {
  initTurnActionsTracker,
  clearExhaustionStuns,
  resetActionsThisTurnForCombatants
} from "./module/utils/turn-actions-tracker";
import { PowerNegationRegionBehaviorType } from "./module/region/PowerNegationRegionBehaviorType";
import { PowerDampeningRegionBehaviorType } from "./module/region/PowerDampeningRegionBehaviorType";
import { PowerEnhancementRegionBehaviorType } from "./module/region/PowerEnhancementRegionBehaviorType";
import { ForceNextRollRegionBehaviorType } from "./module/region/ForceNextRollRegionBehaviorType";

// ─── Movement Settings Menu ─────────────────────────────────────────────────────

/**
 * Settings menu for configuring movement by rank
 */
class MovementSettingsMenu extends foundry.appv1.api.FormApplication {
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

// ─── Table Effects Editor Menu ──────────────────────────────────────────────────

/**
 * Settings menu for attaching stat/damage modifiers to RollTable results
 * (e.g. critical success/failure tables).
 */
class TableEffectsMenu extends foundry.appv1.api.FormApplication {
  static override get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title: "FASERIP Table Effects",
      id: "faserip-table-effects",
      template: "" // No template needed, we use Vue dialog
    });
  }

  override async _updateObject(_event: Event, _formData: any): Promise<void> {
    // Not used - dialog handles updates
  }

  override render(_force?: boolean, _options?: any): this {
    // Launch dialog asynchronously without awaiting
    showTableEffectsEditor();
    return this;
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

  // Botch and Crit tables
  game.settings.register("faserip", "criticalBotchTable", {
    name: "FASERIP.Settings.criticalBotchTable.name",
    hint: "FASERIP.Settings.criticalBotchTable.hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register("faserip", "criticalSuccessTable", {
    name: "FASERIP.Settings.criticalSuccessTable.name",
    hint: "FASERIP.Settings.criticalSuccessTable.hint",
    scope: "world",
    config: true,
    type: String,
    default: ""
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

  // Manual Roll Entry (per-player setting)
  game.settings.register("faserip", "manualRollEntry", {
    name: "Manual Roll Entry",
    hint: "When enabled, clicking roll buttons will prompt you to enter the result of your physical dice roll instead of rolling automatically in Foundry. Perfect for players who prefer rolling real dice!",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
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

  // Register settings menu for RollTable effects (e.g. critical success/failure tables)
  game.settings.registerMenu("faserip", "tableEffectsMenu", {
    name: "Table Effects",
    label: "Configure Table Effects",
    hint: "Attach stat/damage chart-shift modifiers to RollTable results so drawing them applies the effect automatically.",
    icon: "fas fa-dice-d20",
    type: TableEffectsMenu,
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

  // Migration flag for converting legacy statDebuff/damageBuff/dot fields
  // on plain-data actor powers/weapons to arrays
  game.settings.register("faserip", "powerArrayFieldsMigrationCompleted", {
    name: "Power Array Fields Migration Completed",
    hint: "Internal flag tracking whether legacy statDebuff/damageBuff/dot fields have been migrated to arrays.",
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

  // Register region behavior types
  // @ts-expect-error - TypeScript doesn't recognize custom CONFIG property
  CONFIG.RegionBehavior.dataModels.powerNegation =
    PowerNegationRegionBehaviorType;
  CONFIG.RegionBehavior.typeIcons.powerNegation = "icons/svg/blind.svg";
  // @ts-expect-error - TypeScript doesn't recognize custom CONFIG property
  CONFIG.RegionBehavior.dataModels.powerDampening =
    PowerDampeningRegionBehaviorType;
  CONFIG.RegionBehavior.typeIcons.powerDampening = "icons/svg/downgrade.svg";
  // @ts-expect-error - TypeScript doesn't recognize custom CONFIG property
  CONFIG.RegionBehavior.dataModels.powerEnhancement =
    PowerEnhancementRegionBehaviorType;
  CONFIG.RegionBehavior.typeIcons.powerEnhancement = "icons/svg/upgrade.svg";
  // @ts-expect-error - TypeScript doesn't recognize custom CONFIG property
  CONFIG.RegionBehavior.dataModels.forceNextRoll =
    ForceNextRollRegionBehaviorType;
  CONFIG.RegionBehavior.typeIcons.forceNextRoll = "icons/svg/upgrade.svg";

  // Register the "Powers Negated" status so it shows a labeled icon on tokens
  CONFIG.statusEffects.push({
    id: "faseripPowersNegated",
    name: "Powers Negated",
    img: "icons/svg/blind.svg"
  });

  // Register "Force Next Roll: Critical/Failure" statuses - toggling them via
  // the token HUD applies the same flags.faserip.kind "forcedResult" temp
  // effect data as the Effects tab buttons (see EffectsTab.vue), so
  // consumeForcedResult (temp-effects.ts) picks them up identically.
  CONFIG.statusEffects.push({
    id: "faseripForceNextRollCritical",
    name: "Force Next Roll: Critical",
    img: "icons/svg/upgrade.svg",
    flags: {
      faserip: {
        kind: "forcedResult",
        chartShift: 0,
        roundsRemaining: 0,
        indefinite: true,
        trigger: "nextAction",
        usesRemaining: 1,
        forcedOutcome: "critical"
      }
    }
  });
  CONFIG.statusEffects.push({
    id: "faseripForceNextRollFailure",
    name: "Force Next Roll: Failure",
    img: "icons/svg/downgrade.svg",
    flags: {
      faserip: {
        kind: "forcedResult",
        chartShift: 0,
        roundsRemaining: 0,
        indefinite: true,
        trigger: "nextAction",
        usesRemaining: 1,
        forcedOutcome: "failure"
      }
    }
  });

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
        // Always set displayBars to ALWAYS (visible to everyone)
        actor.prototypeToken.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
          displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS
        });
        tokenDocument.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
          displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS,
          bar1: { attribute: "resources.health" },
          bar2: { attribute: "resources.armor" }
        });
      }
      // NPC actors: bar2 for armor, bars visible to owner only
      else if (actor?.type === ActorType.Npc) {
        // Set displayBars to OWNER (visible to owner only)
        actor.prototypeToken.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER
        });
        tokenDocument.updateSource({
          displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER,
          bar1: { attribute: "resources.health" },
          bar2: { attribute: "resources.armor" }
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

  const currentFormId = actor.system.currentFormId;
  if (!currentFormId) {
    return;
  }

  // If health value is being updated, also update the healthByForm for current form
  if (changes.system?.resources?.health?.value !== undefined) {
    // Clone the existing healthByForm and update it
    const updatedHealthByForm = {
      ...(actor.system.healthByForm || {}),
      [currentFormId]: changes.system.resources.health.value
    };
    changes.system.healthByForm = updatedHealthByForm;
  } else if (changes.system?.healthByForm?.[currentFormId] !== undefined) {
    // healthByForm was updated directly (e.g. damage application) without
    // touching health.value - some consumers of preUpdateActor (third-party
    // modules) key off resources.health.value, so mirror it back in.
    changes.system.resources ??= {};
    changes.system.resources.health ??= {};
    changes.system.resources.health.value =
      changes.system.healthByForm[currentFormId];
  }
});

function refreshTokenBarsForActor(actor: any): void {
  const activeTokens = actor?.getActiveTokens?.() || [];
  for (const token of activeTokens) {
    token.drawBars();
  }
}

// ─── Actor Update Hook: Sync name changes to PC tokens ──────────────────────────

Hooks.on("updateActor", async (actor: any, changes: any, _options: any) => {
  // Keep token bars in sync when actor resources/health form data change.
  const resourcesChanged =
    changes.system?.resources?.health !== undefined ||
    changes.system?.resources?.armor !== undefined ||
    changes.system?.healthByForm !== undefined;

  if (resourcesChanged) {
    refreshTokenBarsForActor(actor);
  }

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
  // Redraw bars for token delta resource updates (important for unlinked tokens).
  // Token updates may arrive as nested objects OR dotted paths.
  const hasProperty = foundry.utils.hasProperty;
  const dottedResourceChange = Object.keys(changes).some(
    key =>
      key.startsWith("delta.system.resources.health") ||
      key.startsWith("delta.system.resources.armor") ||
      key.startsWith("delta.system.healthByForm")
  );

  const deltaResourcesChanged =
    dottedResourceChange ||
    hasProperty(changes, "delta.system.resources.health") ||
    hasProperty(changes, "delta.system.resources.armor") ||
    hasProperty(changes, "delta.system.healthByForm");

  if (deltaResourcesChanged) {
    // Safety net drawBars in case Foundry doesn't automatically refresh bars
    // from delta resource changes on this client.
    (token.object as any)?.drawBars?.();
  }

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
    // console.warn("FASERIP | No left column found in token HUD");
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
    return;
  }

  const tokenId: string | undefined = message.flags?.faserip?.tokenId;

  if (!tokenId) {
    return;
  }

  const rolls: any[] = message.rolls ?? [];
  if (!rolls.length) {
    return;
  }
  const total: number = rolls[0]?.total ?? 0;

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

// Snapshot (round, turn) before every combat update so the updateCombat
// handler below can tell which combatants' turns were skipped over by a
// "Next Round"/"Previous Round" jump (which sets turn straight to 0/last
// without visiting every combatant in between) rather than a normal
// turn-by-turn advance.
let lastCombatPosition: { round: number; turn: number } | null = null;

Hooks.on("preUpdateCombat", (combat: any) => {
  lastCombatPosition = {
    round: combat.round ?? 0,
    turn: combat.turn ?? 0
  };
});

// Temporary stat/damage modifiers live as ActiveEffects (not combat-linked -
// see temp-effects.ts) with their own roundsRemaining counter in
// flags.faserip. Tick it down explicitly each round and delete effects that
// hit zero. Only the active GM (first GM in turn order, or first connected
// GM if only one) runs this - if every GM client ran it, a table with two GMs
// online would tick/delete each effect twice per round.
Hooks.on("updateCombat", async (combat: any, changes: any) => {
  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM || !game.users?.activeGM?.isSelf) {
    return;
  }

  if (changes.round !== undefined) {
    await tickTemporaryModifiers(combat);
    await clearExhaustionStuns(combat);
  }

  if (changes.turn !== undefined || changes.round !== undefined) {
    const skipped = getSkippedCombatants(combat, lastCombatPosition);
    const activeCombatant = combat.combatant;

    const combatantsToTick = [...skipped];
    if (
      activeCombatant &&
      !combatantsToTick.some(c => c.id === activeCombatant.id)
    ) {
      combatantsToTick.push(activeCombatant);
    }

    if (combatantsToTick.length > 0) {
      await tickDotEffectsForCombatant(combat, combatantsToTick);
      await resetActionsThisTurnForCombatants(combatantsToTick);
    }
  }

  lastCombatPosition = { round: combat.round ?? 0, turn: combat.turn ?? 0 };
});

/**
 * Combatants whose turn fell strictly between the previous (round, turn) and
 * the combat's current position, in turn order - i.e. whoever a "Next Round"
 * (or multi-round) jump skipped past without visiting. Returns [] for a
 * normal single-turn advance (nothing was skipped) or if there's no prior
 * position to compare against (e.g. combat just started).
 */
function getSkippedCombatants(
  combat: any,
  previous: { round: number; turn: number } | null
): any[] {
  if (!previous) return [];

  const turns = combat.turns ?? combat.combatants?.contents ?? [];
  if (!turns.length) return [];

  const currentRound = combat.round ?? 0;
  const currentTurn = combat.turn ?? 0;

  // Absolute turn index = round * turns.length + turn, so the skipped range
  // is just every index strictly between previous and current.
  const toAbsolute = (round: number, turn: number) =>
    round * turns.length + turn;

  const previousAbsolute = toAbsolute(previous.round, previous.turn);
  const currentAbsolute = toAbsolute(currentRound, currentTurn);

  if (currentAbsolute <= previousAbsolute + 1) {
    // Normal forward advance (or no movement) - nothing skipped.
    return [];
  }

  const skipped: any[] = [];
  for (let abs = previousAbsolute + 1; abs < currentAbsolute; abs++) {
    const turnIndex = ((abs % turns.length) + turns.length) % turns.length;
    const combatant = turns[turnIndex];
    if (combatant) skipped.push(combatant);
  }
  return skipped;
}

// Hook: Ensure bars are present when tokens are updated
Hooks.on(
  "preUpdateToken",
  (tokenDoc: TokenDocument, changes: any, _options: any, _userId: string) => {
    const actor = tokenDoc.actor;
    if (!actor) return;

    // If this update doesn't touch bar config, check if we need to add it
    if (!changes.bar1 && !changes.bar2 && !changes.displayBars) {
      // PC actors: bar1 for health, bar2 for armor, bars always visible
      const needsBar1 =
        !tokenDoc.bar1?.attribute ||
        tokenDoc.bar1.attribute !== "resources.health";
      const needsBar2 =
        !tokenDoc.bar2?.attribute ||
        tokenDoc.bar2.attribute !== "resources.armor";

      if (needsBar1) {
        changes.bar1 = { attribute: "resources.health" };
      }
      if (needsBar2) {
        changes.bar2 = { attribute: "resources.armor" };
      }
      if (actor.type === ActorType.Pc) {
        const needsDisplayBars =
          tokenDoc.displayBars !== CONST.TOKEN_DISPLAY_MODES.ALWAYS;
        if (needsDisplayBars) {
          changes.displayBars = CONST.TOKEN_DISPLAY_MODES.ALWAYS;
        }
      }
      // NPC actors: bar2 for armor, bars visible to owner only
      else if (actor.type === ActorType.Npc) {
        const needsDisplayBars =
          tokenDoc.displayBars !== CONST.TOKEN_DISPLAY_MODES.OWNER;

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

  // Suppress Foundry's core "you do not have permission to update/delete
  // this document" warnings for non-GM clients. These fire on every
  // connected client (not just the one acting) when a GM-driven update to a
  // GM-owned actor is broadcast over the socket and a player's client tries
  // to locally apply it - the write already succeeded, so the warning is
  // just noise for players. GMs still see real permission errors.
  // @ts-expect-error - Foundry game.user global
  if (!game.user?.isGM && ui.notifications) {
    const originalWarn = ui.notifications.warn.bind(ui.notifications);
    const originalError = ui.notifications.error.bind(ui.notifications);
    const isOwnershipNoise = (message: unknown) =>
      typeof message === "string" &&
      /do not have (permission|the required permissions)/i.test(message) &&
      /(update|delete|modify)/i.test(message);

    ui.notifications.warn = (message: unknown, options?: unknown) => {
      if (isOwnershipNoise(message)) return undefined as any;
      return originalWarn(message as any, options as any);
    };
    ui.notifications.error = (message: unknown, options?: unknown) => {
      if (isOwnershipNoise(message)) return undefined as any;
      return originalError(message as any, options as any);
    };
  }

  // Diagnostic: Log valid item types recognized by Foundry
  // @ts-expect-error - TypeScript doesn't recognize documentTypes on game
  const itemTypes = game.documentTypes?.Item || [];

  // Initialize socket system for multiplayer combat interactions
  initializeSocket();

  // Initialize per-turn action tracker (resets combo penalty offset each turn)
  initTurnActionsTracker();

  // Run migration to convert embedded armors/weapons to Item documents
  // This only runs once per world and is safe to call repeatedly
  // @ts-expect-error - TypeScript doesn't recognize game.user.isGM
  if (game.user?.isGM) {
    await migrateEmbeddedItemsToDocuments();
    await migratePowerArrayFields();
  }

  // Set up game.faserip namespace for console access
  game.faserip = {
    forceMigrateItems,
    forceMigratePowerArrayFields
  };
});

Hooks.on("chatMessage", (_chatLog: any, message: string, _chatData: any) => {
  // Split message into lines and process each separately
  const lines = message.split(/\r?\n/).filter(line => line.trim());

  // Check if ANY line is our command or needs processing
  let hasOurCommand = false;
  const commandLines: string[] = [];
  const diceLines: string[] = [];

  for (const line of lines) {
    const div = document.createElement("div");
    div.innerHTML = line;
    const trimmed = div.textContent?.trim() || "";

    // Check if it's a character roll command
    if (trimmed.match(/^\/cr(?:oll)?\s+(.+)$/)) {
      hasOurCommand = true;
      commandLines.push(trimmed);
      continue;
    }

    // Check if it's a rank roll command
    if (trimmed.startsWith("/r ") || trimmed.startsWith("/roll ")) {
      let slice = 3;
      if (trimmed.startsWith("/roll ")) {
        slice = 6;
      }

      const expressions = trimmed.slice(slice).trim().split(/\s+/);

      if (expressions.length === 0 || expressions[0] === "") {
        hasOurCommand = true;
        commandLines.push(trimmed);
        continue;
      }

      // Check if it's a dice formula
      let hasDiceFormula = false;
      for (const expr of expressions) {
        try {
          if (Roll.validate(expr)) {
            hasDiceFormula = true;
            break;
          }
        } catch {
          // Not a valid dice formula
        }
      }

      if (hasDiceFormula) {
        // It's a dice formula - collect it to roll manually
        diceLines.push(trimmed.slice(slice).trim()); // Remove "/r " or "/roll " prefix
      } else {
        // Try to parse as rank
        const parsed = expressions
          .map(expr => parseRankExpression(expr))
          .filter(p => p !== null);

        if (parsed.length > 0) {
          hasOurCommand = true;
          commandLines.push(trimmed);
        }
      }
    }
  }

  // If we have commands or dice to process
  if (hasOurCommand || diceLines.length > 0) {
    // Process our custom commands
    for (const commandLine of commandLines) {
      const trimmed = commandLine.trim();

      // Process character roll
      if (trimmed.match(/^\/cr(?:oll)?\s+(.+)$/)) {
        handleCharacterRollCommand(commandLine).catch(err => {
          console.error("Error handling character roll command:", err);
        });
        continue;
      }

      // Process rank roll
      if (trimmed.startsWith("/r ") || trimmed.startsWith("/roll ")) {
        handleRollCommand(commandLine).catch(err => {
          console.error("Error handling rank roll command:", err);
        });
      }
    }

    // If there are dice formulas, roll and post them directly. We can't
    // route these back through chatLog.processMessage("/roll ...") because
    // that re-invokes this same "chatMessage" hook, which would classify
    // the reconstructed "/roll xdy" message as a dice formula again and
    // return false again - an infinite defer loop that silently never
    // creates a roll.
    for (const line of diceLines) {
      const roll = Roll.create(line);
      try {
        roll
          .evaluate()
          .then(async () => {
            await roll.toMessage({
              speaker: ChatMessage.getSpeaker()
            });
          })
          .catch((err: any) => {
            console.error("Error processing dice formula:", line, err);
          });
      } catch (err: any) {
        console.error("Error creating dice roll:", line, err);
      }
    }

    return false; // Prevent Foundry from processing original message
  }

  // Not our command, let Foundry handle it
  return true;
});

// Export for global access if needed
export { FaseripActor } from "./module/documents";
export { ActorType, Rank, Attribute } from "./module/enums";
export { getCharmanService } from "./module/charman-service";
export { FaseripRoll } from "./module/rolling/index";
export { forceMigrateItems } from "./module/utils/migrate-items";
export { forceMigratePowerArrayFields } from "./module/utils/migrate-power-arrays";
