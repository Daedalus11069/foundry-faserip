import { createApp, reactive, type App, type Component } from "vue";
import { watchIgnorable } from "@vueuse/core";

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
  #updateActorCallback:
    | ((
        actor: Actor,
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
      // @ts-expect-error - actor property exists on ActorSheetV2
      this.#reactiveActor = reactive(this.actor.clone());
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

          // Update the real actor
          // @ts-expect-error - actor property exists on ActorSheetV2
          await this.actor.update(updateData);
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

    // Clear ignoreUpdates
    this.#ignoreUpdates = null;

    // Unregister hook
    if (this.#updateActorCallback) {
      Hooks.off("updateActor", this.#updateActorCallback);
      this.#updateActorCallback = null;
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
      // Update top-level properties
      // @ts-expect-error - actor property exists on ActorSheetV2
      this.#reactiveActor!.name = this.actor.name;
      // @ts-expect-error - actor property exists on ActorSheetV2
      this.#reactiveActor!.img = this.actor.img;

      // Deep update system data
      const freshSystem = JSON.parse(
        // @ts-expect-error - actor property exists on ActorSheetV2
        JSON.stringify(this.actor.system)
      ) as Record<string, unknown>;
      for (const key of Object.keys(freshSystem)) {
        (this.#reactiveActor!.system as Record<string, unknown>)[key] =
          freshSystem[key];
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
