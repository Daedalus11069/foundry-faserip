import { createApp, reactive, type App, type Component } from "vue";
import { watchIgnorable } from "@vueuse/core";

// @ts-expect-error - TypeScript doesn't recognize custom Item subclass
const ItemSheetV2 = foundry.applications.sheets.ItemSheetV2;

/**
 * Base sheet class for FASERIP item sheets.
 * Mounts a single Vue application into the sheet body and keeps a reactive
 * clone of item.system in sync with Foundry's document model.
 */
export abstract class FsrItemBaseSheet extends ItemSheetV2 {
  static SHADOWROOT = false;

  /** The Vue component rendered by this sheet. Override in subclasses. */
  abstract get vueComponent(): Component;

  #vueApp: App | null = null;
  #reactiveItem: any = null;
  #stopWatcher: (() => void) | null = null;
  #ignoreUpdates: ((cb: () => void) => void) | null = null;
  #isUpdating: boolean = false;
  #updateItemCallback:
    | ((
        item: Item,
        _changed: unknown,
        _options: unknown,
        _userId: string
      ) => void)
    | null = null;

  /** Expose the reactive item for components that need the sheet ref. */
  get reactiveItem() {
    return this.#reactiveItem;
  }

  // ─── ApplicationV2 lifecycle ──────────────────────────────────────────────

  async _renderHTML(
    _context: unknown,
    _options: unknown
  ): Promise<Record<string, HTMLElement>> {
    // Create the reactive item clone once.
    if (!this.#reactiveItem) {
      // @ts-expect-error - item property exists on ItemSheetV2
      this.#reactiveItem = reactive(JSON.parse(JSON.stringify(this.item)));
    }

    const container = document.createElement("div");
    container.className = "fsr-sheet-root";

    if (!this.#vueApp) {
      const app = createApp(this.vueComponent);
      // Provide reactive item (for modifications)
      app.provide("reactiveItem", this.#reactiveItem);
      // Also provide as "reactiveSystem" for backwards compatibility
      app.provide("reactiveSystem", this.#reactiveItem.system);
      // Provide the real item for calling methods
      // @ts-expect-error - TypeScript doesn't recognize the item property on ItemSheetV2
      app.provide("item", this.item);
      app.provide("sheet", this);
      app.mount(container);
      this.#vueApp = app;

      // Set up watchIgnorable for automatic syncing
      const { ignoreUpdates, stop } = watchIgnorable(
        this.#reactiveItem,
        async () => {
          // Prevent redundant updates if we're already in the middle of one
          if (this.#isUpdating) {
            return;
          }

          // Store ignoreUpdates for use in syncReactiveItem()
          if (!this.#ignoreUpdates) {
            this.#ignoreUpdates = ignoreUpdates;
          }

          // Skip updates if the sheet is not editable
          // @ts-expect-error - isEditable property exists on ItemSheetV2
          if (!this.isEditable) {
            return;
          }

          // Extract reactive values before serialization
          const newItemData = {
            _id: this.#reactiveItem!._id,
            name: this.#reactiveItem!.name,
            img: this.#reactiveItem!.img,
            system: { ...this.#reactiveItem!.system }
          };

          // Calculate diff between old and new data
          // @ts-expect-error - item property exists on ItemSheetV2
          const oldItemPlain = JSON.parse(JSON.stringify(this.item));
          const newItemPlain = JSON.parse(JSON.stringify(newItemData));

          const diff = foundry.utils.diffObject(oldItemPlain, newItemPlain, {
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

          // Skip if no real changes after flattening
          if (Object.keys(updateData).length === 0) {
            return;
          }

          // Set flag to prevent redundant watcher firing during update
          this.#isUpdating = true;

          try {
            // Update the real item
            // @ts-expect-error - item property exists on ItemSheetV2
            await this.item.update(updateData);
          } finally {
            // Clear flag after update completes
            this.#isUpdating = false;
          }
        },
        { deep: true }
      );

      this.#stopWatcher = stop;

      // Listen to external updates from Foundry
      this.#updateItemCallback = (
        item: Item,
        _changed: unknown,
        _options: unknown,
        _userId: string
      ) => {
        // @ts-expect-error - item property exists on ItemSheetV2
        if (item.id === this.item.id) {
          this.#syncReactiveItem();
        }
      };

      Hooks.on("updateItem", this.#updateItemCallback);
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

    // Clear reactive item reference
    this.#reactiveItem = null;

    // Stop watcher
    if (this.#stopWatcher) {
      this.#stopWatcher();
      this.#stopWatcher = null;
    }

    // Clear flags
    this.#ignoreUpdates = null;
    this.#isUpdating = false;

    // Unregister hook
    if (this.#updateItemCallback) {
      Hooks.off("updateItem", this.#updateItemCallback);
      this.#updateItemCallback = null;
    }

    return super.close(options) as Promise<this>;
  }

  /**
   * Sync the reactive item with external changes
   */
  #syncReactiveItem(): void {
    if (!this.#reactiveItem) {
      return;
    }

    const doSync = () => {
      // @ts-expect-error - item property exists on ItemSheetV2
      const sourceItem = this.item;

      // Update top-level properties
      this.#reactiveItem!.name = sourceItem.name;
      this.#reactiveItem!.img = sourceItem.img;

      // Deep update system data
      const freshSystem = JSON.parse(
        JSON.stringify(sourceItem.system)
      ) as Record<string, unknown>;

      for (const key of Object.keys(freshSystem)) {
        (this.#reactiveItem!.system as Record<string, unknown>)[key] =
          freshSystem[key];
      }
    };

    // Use ignoreUpdates if available to prevent watcher from firing
    if (this.#ignoreUpdates) {
      this.#ignoreUpdates(doSync);
    } else {
      doSync();
    }
  }
}
