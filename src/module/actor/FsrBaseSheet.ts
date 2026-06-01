import { createApp, reactive, type App, type Component } from "vue";
import { watchIgnorable } from "@vueuse/core";
import { getRankValue } from "../utils";

// @ts-expect-error - TypeScript doesn't recognize custom Actor subclass
const ActorSheetV2 = foundry.applications.sheets.ActorSheetV2;

// @ts-expect-error - SystemActor type for potential future use
type SystemActor = Actor & { system: Record<string, unknown> };

/**
 * Base sheet class for the FASERIP system.
 * Mounts a single Vue application into the sheet body and keeps a reactive
 * clone of actor.system in sync with Foundry's document model.
 */
export abstract class FsrBaseSheet extends ActorSheetV2 {
  static SHADOWROOT = false;

  /** The Vue component rendered by this sheet. Override in subclasses. */
  abstract get vueComponent(): Component;

  #vueApp: App | null = null;
  #reactiveActor: any = null;
  #stopWatcher: (() => void) | null = null;
  #ignoreUpdates: ((cb: () => void) => void) | null = null;
  #isUpdating: boolean = false;
  #updateActorCallback:
    | ((
        actor: Actor,
        _changed: unknown,
        _options: unknown,
        _userId: string
      ) => void)
    | null = null;
  #updateTokenCallback:
    | ((
        token: TokenDocument,
        _changed: unknown,
        _options: unknown,
        _userId: string
      ) => void)
    | null = null;

  /** Expose the reactive actor for components that need the sheet ref. */
  get reactiveActor() {
    return this.#reactiveActor;
  }

  // ─── ApplicationV2 lifecycle ──────────────────────────────────────────────

  async _renderHTML(
    _context: unknown,
    _options: unknown
  ): Promise<Record<string, HTMLElement>> {
    // Create the reactive actor clone once.
    if (!this.#reactiveActor) {
      // For unlinked token sheets, this.actor is already the synthetic actor (base + delta)
      // @ts-expect-error - actor property exists on ActorSheetV2
      this.#reactiveActor = reactive(JSON.parse(JSON.stringify(this.actor)));
    }

    const container = document.createElement("div");
    container.className = "fsr-sheet-root";

    if (!this.#vueApp) {
      const app = createApp(this.vueComponent);
      // Provide reactive actor (for modifications)
      app.provide("reactiveActor", this.#reactiveActor);
      // Also provide as "reactiveSystem" for backwards compatibility
      app.provide("reactiveSystem", this.#reactiveActor.system);
      // Provide the real actor for calling methods, accessing collections, etc.
      // @ts-expect-error - TypeScript doesn't recognize the actor property on ActorSheetV2
      app.provide("actor", this.actor);
      app.provide("sheet", this);
      app.mount(container);
      this.#vueApp = app;

      // Set up watchIgnorable for automatic syncing
      const { ignoreUpdates, stop } = watchIgnorable(
        this.#reactiveActor,
        async () => {
          // Prevent redundant updates if we're already in the middle of one
          if (this.#isUpdating) {
            return;
          }

          // Store ignoreUpdates for use in syncReactiveActor()
          if (!this.#ignoreUpdates) {
            this.#ignoreUpdates = ignoreUpdates;
          }

          // Skip updates if the sheet is not editable
          // @ts-expect-error - isEditable property exists on ActorSheetV2
          if (!this.isEditable) {
            return;
          }

          // Extract reactive values before serialization
          const newActorData = {
            _id: this.#reactiveActor!._id,
            name: this.#reactiveActor!.name,
            img: this.#reactiveActor!.img,
            system: { ...this.#reactiveActor!.system }
          };

          // Calculate diff between old and new data
          // @ts-expect-error - actor property exists on ActorSheetV2
          const oldActorPlain = JSON.parse(JSON.stringify(this.actor));
          const newActorPlain = JSON.parse(JSON.stringify(newActorData));

          const diff = foundry.utils.diffObject(oldActorPlain, newActorPlain, {
            deletionKeys: true
          }) as any;

          // Remove _id from diff (never update the ID)
          const { _id, ...cleanDiff } = diff;

          // Skip if no real changes
          if (Object.keys(cleanDiff).length === 0) {
            return;
          }

          // Flatten to dot notation for reliable nested updates
          const updateData = foundry.utils.flattenObject(cleanDiff);

          // CRITICAL: Filter out derived data paths that are calculated by prepareDerivedData
          // These should NEVER be stored in actor/token data
          const derivedPaths = [
            /^system\.resources\.health\./,
            /^system\.resources\.armor\./,
            /^system\.resources\.mp\.max$/
          ];

          const filteredUpdateData: Record<string, any> = {};
          for (const [key, value] of Object.entries(updateData)) {
            const isDerived = derivedPaths.some(pattern => pattern.test(key));
            if (!isDerived) {
              filteredUpdateData[key] = value;
            }
          }

          // Skip if no real changes after filtering
          if (Object.keys(filteredUpdateData).length === 0) {
            return;
          }

          // Set flag to prevent redundant watcher firing during update
          this.#isUpdating = true;

          try {
            // Update the real actor or token
            // @ts-expect-error - actor and token properties exist on ActorSheetV2
            const actor = this.actor;
            // @ts-expect-error - token property exists on ActorSheetV2
            const token = this.token;

            // Check if this is an unlinked token by checking actor.isToken
            const isUnlinkedToken = actor.isToken && token && !token.actorLink;

            if (isUnlinkedToken) {
              // Prefix all keys with "delta." for token delta updates
              const tokenUpdates: Record<string, any> = {};
              for (const [key, value] of Object.entries(filteredUpdateData)) {
                tokenUpdates[`delta.${key}`] = value;
              }

              await token.update(tokenUpdates);

              // CRITICAL: After delta update, explicitly refresh bar values AND max
              // The token bars cache values and need to be told to recalculate from actor resources
              const updatedActor = token.actor; // Get fresh synthetic actor (base + delta)
              if (updatedActor && token.object) {
                const healthResource = (updatedActor.system as any).resources
                  ?.health;
                const armorResource = (updatedActor.system as any).resources
                  ?.armor;

                // Update bar value and max cache directly
                if (healthResource !== undefined) {
                  token.bar1.value = healthResource.value;
                  token.bar1.max = healthResource.max;
                }
                if (armorResource !== undefined) {
                  token.bar2.value = armorResource.value;
                  token.bar2.max = armorResource.max;
                }

                // Trigger visual refresh
                token.object.drawBars();
              }
            } else {
              // For linked actors or base actors, update normally
              await actor.update(filteredUpdateData);
            }
          } finally {
            // Clear flag after update completes
            this.#isUpdating = false;
          }
        },
        { deep: true }
      );

      this.#stopWatcher = stop;

      // Listen to external updates from Foundry
      this.#updateActorCallback = (
        actor: Actor,
        _changed: unknown,
        _options: unknown,
        _userId: string
      ) => {
        // @ts-expect-error - actor property exists on ActorSheetV2
        if (actor.id === this.actor.id) {
          this.#syncReactiveActor();
        }
      };

      Hooks.on("updateActor", this.#updateActorCallback);

      // For unlinked token sheets, also listen to token updates
      // @ts-expect-error - token property exists on ActorSheetV2
      if (this.token && !this.token.actorLink) {
        this.#updateTokenCallback = (
          token: TokenDocument,
          _changed: unknown,
          _options: unknown,
          _userId: string
        ) => {
          // @ts-expect-error - token property exists on ActorSheetV2
          if (token.id === this.token?.id) {
            this.#syncReactiveActor();
          }
        };

        Hooks.on("updateToken", this.#updateTokenCallback);
      }
    }

    return { main: container };
  }

  _replaceHTML(
    result: Record<string, HTMLElement>,
    content: HTMLElement,
    _options: unknown
  ): void {
    // Only append once; Vue handles DOM updates thereafter
    if (!content.querySelector(".fsr-sheet-root")) {
      content.innerHTML = "";
      content.append(result.main);
    }
  }

  // @ts-expect-error - override modifier works at runtime
  override async close(options?: unknown): Promise<this> {
    // Unmount Vue app
    if (this.#vueApp) {
      this.#vueApp.unmount();
      this.#vueApp = null;
    }

    // Clear reactive actor reference
    this.#reactiveActor = null;

    // Stop watcher
    if (this.#stopWatcher) {
      this.#stopWatcher();
      this.#stopWatcher = null;
    }

    // Clear flags
    this.#ignoreUpdates = null;
    this.#isUpdating = false;

    // Unregister hook
    if (this.#updateActorCallback) {
      Hooks.off("updateActor", this.#updateActorCallback);
      this.#updateActorCallback = null;
    }

    // Unregister token hook if registered
    if (this.#updateTokenCallback) {
      Hooks.off("updateToken", this.#updateTokenCallback);
      this.#updateTokenCallback = null;
    }

    return super.close(options) as Promise<this>;
  }

  /**
   * Sync the reactive actor with external changes
   */
  #syncReactiveActor(): void {
    if (!this.#reactiveActor) {
      return;
    }

    const doSync = () => {
      // CRITICAL: For unlinked token sheets, get data from token's synthetic actor, not base actor
      // For unlinked tokens, this.actor is actually the synthetic actor (base + delta)
      // We should check if this.actor.isToken is true
      // @ts-expect-error - isToken property exists on synthetic actors
      const isUnlinkedToken =
        // @ts-expect-error - token and actor properties exist on ActorSheetV2
        (this.actor as any).isToken && this.token && !this.token.actorLink;
      // @ts-expect-error - token and actor properties exist on ActorSheetV2
      const sourceActor = this.actor; // Always use this.actor (it's already the synthetic actor for token sheets)

      // Update top-level properties
      this.#reactiveActor!.name = sourceActor.name;
      this.#reactiveActor!.img = sourceActor.img;

      // Deep update system data - but preserve derived resources
      const freshSystem = JSON.parse(
        JSON.stringify(sourceActor.system)
      ) as Record<string, unknown>;

      // CRITICAL: Don't overwrite derived resources - these are calculated by prepareDerivedData
      // Store current derived values
      const currentResources = (this.#reactiveActor!.system as any).resources;

      for (const key of Object.keys(freshSystem)) {
        if (key === "resources") {
          // Skip resources - keep current derived values
          continue;
        }
        (this.#reactiveActor!.system as Record<string, unknown>)[key] =
          freshSystem[key];
      }

      // Manually update resources from freshSystem but preserve derived fields
      if (freshSystem.resources) {
        const freshResources = freshSystem.resources as any;
        const reactiveResources = (this.#reactiveActor!.system as any)
          .resources;

        // Copy non-derived resource fields (karma, mentalPoints, etc.)
        for (const resourceKey of Object.keys(freshResources)) {
          if (resourceKey !== "health" && resourceKey !== "armor") {
            reactiveResources[resourceKey] = freshResources[resourceKey];
          }
        }

        // For health and armor, keep their max values but recalculate value from source data
        // Health value should be recalculated from healthByForm
        const systemData = this.#reactiveActor!.system as any;
        let currentFormId = systemData.currentFormId;
        if (!currentFormId && systemData.forms?.length > 0) {
          const primaryForm = systemData.forms.find((f: any) => f.isPrimary);
          currentFormId = primaryForm ? primaryForm.id : systemData.forms[0].id;
        }

        if (
          currentFormId &&
          systemData.healthByForm?.[currentFormId] !== undefined
        ) {
          reactiveResources.health = {
            value: systemData.healthByForm[currentFormId],
            max:
              freshResources.health?.max ?? reactiveResources.health?.max ?? 0
          };
        } else {
          reactiveResources.health = freshResources.health;
        }

        // Armor value is derived from armors + body armor power
        // For now, use the freshSystem value but this will be recalculated on next access
        if (freshResources.armor) {
          reactiveResources.armor = freshResources.armor;
        }
      }

      // Ensure armor values match their ranks
      const systemData = this.#reactiveActor!.system as any;
      if (systemData.armors && Array.isArray(systemData.armors)) {
        for (const armor of systemData.armors) {
          const correctValue = getRankValue(armor.rank);
          // Initialize maxValue if missing
          if (armor.maxValue === undefined || armor.maxValue === null) {
            armor.maxValue = correctValue;
          }
          // Fix value if it's incorrect (only if not intentionally degraded)
          if (
            armor.value === 6 &&
            correctValue !== 6 &&
            armor.maxValue === armor.value
          ) {
            armor.value = correctValue;
            armor.maxValue = correctValue;
          }
        }
      }

      // Ensure power values match their ranks
      if (systemData.powers && Array.isArray(systemData.powers)) {
        for (const power of systemData.powers) {
          const correctValue = getRankValue(power.rank);
          // Initialize maxValue if missing
          if (power.maxValue === undefined || power.maxValue === null) {
            power.maxValue = correctValue;
          }
          // Fix value if it's incorrect (only if not intentionally degraded)
          if (
            power.value === 6 &&
            correctValue !== 6 &&
            power.maxValue === power.value
          ) {
            power.value = correctValue;
            power.maxValue = correctValue;
          }
        }
      }
    };

    if (this.#ignoreUpdates) {
      this.#ignoreUpdates(doSync);
    } else {
      doSync();
    }
  }

  /**
   * Helper to save system data (auto-prefixes with "system.")
   */
  async saveSystem(data: Record<string, unknown>): Promise<void> {
    const prefixed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      prefixed[`system.${key}`] = value;
    }
    // @ts-expect-error - actor property exists on ActorSheetV2
    await this.actor.update(prefixed);
  }
}
