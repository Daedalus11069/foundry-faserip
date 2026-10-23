import {
  createApp,
  reactive,
  type App,
  type Component,
  type Reactive
} from "vue";
import { nextTick, toRaw } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { assignIfChanged } from "./shared/assign-if-changed";
import { deepEqual, mergeThreeWay } from "./shared/merge-data";
import { getRankValue } from "../utils";
import type { FaseripActor } from "../documents";

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
  declare actor: FaseripActor;
  static SHADOWROOT = false;

  /** The Vue component rendered by this sheet. Override in subclasses. */
  abstract get vueComponent(): Component;

  #vueApp: App | null = null;
  #reactiveActor: Reactive<FaseripActor> | null = null;
  #isUpdating: boolean = false;
  /** True while Foundry data is being synced into the reactive actor. */
  #syncing: boolean = false;
  #syncAfterFlush: boolean = false;
  /**
   * Snapshot of the document's data as of the last sync. It is the "base" for
   * three-way merging subtrees that must be sent whole, so another user's
   * edits to the same array/object aren't overwritten.
   */
  #baseline: Record<string, any> = {};
  /** Document paths written via setActorField that await persistence. */
  #pendingFieldPaths = new Set<string>();
  #flushChain: Promise<void> = Promise.resolve();
  #scheduleFieldFlush = useDebounceFn(() => this.flushActorFields(), 50);
  #scheduleAudit = useDebounceFn(() => this.auditUnpersistedFields(), 800);
  #updateActorCallback:
    | ((
        actor: Actor,
        _changed: unknown,
        _options: unknown,
        _userId: string
      ) => void)
    | null = null;
  #updateItemCallback:
    | ((
        item: Item,
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
      const clone = this.actor.clone() as FaseripActor;
      // For unlinked token sheets, this.actor is already the synthetic actor (base + delta)
      const reactiveClone = reactive(clone);
      this.#reactiveActor = reactiveClone;
      this.#baseline = JSON.parse(
        JSON.stringify({ system: this.actor.system })
      );
    }

    const container = document.createElement("div");
    container.className = "fsr-sheet-root";

    if (!this.#vueApp) {
      const app = createApp(this.vueComponent);
      // Provide reactive actor (for modifications)
      app.provide("reactiveActor", this.#reactiveActor);
      // Also provide as "reactiveSystem" for backwards compatibility
      app.provide("reactiveSystem", this.#reactiveActor!.system);
      // Provide the real actor for calling methods, accessing collections, etc.
      app.provide("actor", this.actor);
      app.provide("sheet", this);
      app.mount(container);
      this.#vueApp = app;

      // Persistence is path-based (see setActorField); there is no deep
      // watcher. Optionally audit for writes that bypassed setActorField.
      if (this.#auditEnabled()) {
        container.addEventListener("focusout", () => this.#scheduleAudit());
      }


      // Listen to external updates from Foundry
      this.#updateActorCallback = (
        actor: Actor,
        changed: unknown,
        _options: unknown,
        userId: string
      ) => {
        if (actor.id === this.actor.id) {
          this.#syncReactiveActor(changed as Record<string, any>, userId);
        }
      };

      Hooks.on("updateActor", this.#updateActorCallback);

      // Listen to item updates (for armor items being damaged)
      this.#updateItemCallback = (
        item: Item,
        _changed: unknown,
        _options: unknown,
        _userId: string
      ) => {
        if (item.parent?.id === this.actor.id) {
          this.#syncReactiveActor();
        }
      };

      Hooks.on("updateItem", this.#updateItemCallback);
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
    // Let scoped watchers (persistDeep) queue their writes, then persist
    // everything still inside the debounce window before tearing down.
    await nextTick();
    await this.flushActorFields();
    if (this.#auditEnabled()) await this.auditUnpersistedFields();

    // Unmount Vue app
    if (this.#vueApp) {
      this.#vueApp.unmount();
      this.#vueApp = null;
    }

    // Clear reactive actor reference
    this.#reactiveActor = null;

    // Clear flags
    this.#isUpdating = false;
    this.#syncing = false;
    this.#syncAfterFlush = false;
    this.#pendingFieldPaths.clear();

    // Unregister hook
    if (this.#updateActorCallback) {
      Hooks.off("updateActor", this.#updateActorCallback);
      this.#updateActorCallback = null;
    }

    // Unregister item update hook
    if (this.#updateItemCallback) {
      Hooks.off("updateItem", this.#updateItemCallback);
      this.#updateItemCallback = null;
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
  #syncReactiveActor(
    changed?: Record<string, any>,
    userId?: string
  ): void {
    if (!this.#reactiveActor) {
      return;
    }

    // CRITICAL: Don't sync while we're in the middle of pushing changes to the database
    // The updateActor hook will fire during our own update(), but we should ignore it
    // and let our update complete before syncing back
    // Anything NOT from our own update (another user, an item change) must be
    // replayed once the update finishes, or this clone stays stale.
    if (this.#isUpdating) {
      if (userId !== (game as any).user?.id) this.#syncAfterFlush = true;
      return;
    }

    // Unflushed local writes would be clobbered by the (older) document data;
    // run the sync once they have been persisted.
    if (this.#pendingFieldPaths.size > 0) {
      this.#syncAfterFlush = true;
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
      const sourceActor = this.actor; // Always use this.actor (it's already the synthetic actor for token sheets)

      // Update top-level properties
      assignIfChanged(this.#reactiveActor as any, {
        name: sourceActor.name,
        img: sourceActor.img
      });

      // Deep update system data - but preserve derived resources
      const freshSystem = JSON.parse(
        JSON.stringify(sourceActor.system)
      ) as Record<string, unknown>;

      // CRITICAL: Don't overwrite derived resources - these are calculated by prepareDerivedData
      const systemUpdates: Record<string, unknown> = {};
      for (const key of Object.keys(freshSystem)) {
        if (key === "resources") {
          // Skip resources - keep current derived values
          continue;
        }
        // Only sync actionsThisTurn when it was explicitly part of this update.
        // Other actor updates (karma, health, etc.) fire this sync before the
        // actionsThisTurn save completes, which would reset it back to 0.
        if (key === "actionsThisTurn") {
          const explicitlyChanged =
            changed?.system?.actionsThisTurn !== undefined ||
            changed?.["system.actionsThisTurn"] !== undefined;
          if (!explicitlyChanged) continue;
        }
        systemUpdates[key] = freshSystem[key];
      }
      assignIfChanged(this.#reactiveActor!.system as any, systemUpdates);
      // Must be an independent copy: freshSystem's arrays/objects were just
      // assigned into the reactive actor by reference, so sharing them would
      // make local edits mutate the baseline and look like "no change".
      this.#baseline = { system: JSON.parse(JSON.stringify(freshSystem)) };

      // Manually update resources from freshSystem but preserve derived fields
      if (freshSystem.resources) {
        const freshResources = freshSystem.resources as any;
        const reactiveResources = (this.#reactiveActor!.system as any)
          .resources;

        // Copy non-derived resource fields (karma, mentalPoints, etc.)
        const nonDerivedResources: Record<string, unknown> = {};
        for (const resourceKey of Object.keys(freshResources)) {
          if (resourceKey !== "health" && resourceKey !== "armor") {
            nonDerivedResources[resourceKey] = freshResources[resourceKey];
          }
        }
        assignIfChanged(reactiveResources, nonDerivedResources);

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
          assignIfChanged(reactiveResources, {
            health: {
              value: systemData.healthByForm[currentFormId],
              max:
                freshResources.health?.max ??
                reactiveResources.health?.max ??
                0
            }
          });
        } else {
          assignIfChanged(reactiveResources, { health: freshResources.health });
        }

        // Armor value is derived from armors + body armor power
        // For now, use the freshSystem value but this will be recalculated on next access
        if (freshResources.armor) {
          assignIfChanged(reactiveResources, { armor: freshResources.armor });
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

    // Scoped persistDeep watchers fire after this tick; keep their callbacks
    // from writing the freshly synced data straight back.
    this.#syncing = true;
    try {
      doSync();
    } finally {
      void nextTick(() => {
        this.#syncing = false;
      });
    }
  }

  // ─── Path-based persistence ───────────────────────────────────────────────

  /**
   * Paths computed by prepareDerivedData. These must NEVER be written back to
   * actor/token data, so a stray write is dropped at flush time.
   */
  #isDerivedPath(path: string): boolean {
    return (
      /^system\.resources\.health\./.test(path) ||
      /^system\.resources\.armor\./.test(path) ||
      /^system\.resources\.mp\.max$/.test(path) ||
      path === "_id" ||
      path.endsWith("._id")
    );
  }

  /**
   * Foundry replaces arrays wholesale on update and indices go stale, so a
   * write through an array (system.powers.3.name) is persisted as the array
   * itself (system.powers).
   */
  #persistPath(path: string): string {
    const parts = path.split(".");
    let cursor: any = this.#reactiveActor;
    for (let i = 0; i < parts.length - 1; i++) {
      cursor = cursor?.[parts[i]];
      if (Array.isArray(cursor)) return parts.slice(0, i + 1).join(".");
      if (cursor === null || cursor === undefined) break;
    }
    return path;
  }

  /**
   * Write `value` at document `path`: updates the reactive actor immediately
   * (in place, so held proxies and toRefs stay valid) and queues exactly that
   * path for a debounced actor.update().
   */
  setActorField(path: string, value: unknown): void {
    if (!this.#reactiveActor || this.#syncing) return;
    // @ts-expect-error - isEditable property exists on ActorSheetV2
    if (!this.isEditable) return;
    foundry.utils.setProperty(this.#reactiveActor, path, value);
    this.#pendingFieldPaths.add(this.#persistPath(path));
    void this.#scheduleFieldFlush();
  }

  /** Persist all queued setActorField writes now. */
  flushActorFields(): Promise<void> {
    this.#flushChain = this.#flushChain.then(() => this.#flushNow());
    return this.#flushChain;
  }

  async #flushNow(): Promise<void> {
    if (!this.#reactiveActor || this.#pendingFieldPaths.size === 0) {
      return;
    }

    const paths = [...this.#pendingFieldPaths];
    this.#pendingFieldPaths.clear();

    // Drop paths already covered by a pending ancestor
    const pathSet = new Set(paths);
    const roots = paths.filter(path => {
      const parts = path.split(".");
      for (let i = 1; i < parts.length; i++) {
        if (pathSet.has(parts.slice(0, i).join("."))) return false;
      }
      return true;
    });

    const updateData: Record<string, any> = {};
    for (const path of roots) {
      if (this.#isDerivedPath(path)) continue;
      const value = foundry.utils.getProperty(this.#reactiveActor, path);
      if (value === undefined) continue;
      if (value === null || typeof value !== "object") {
        updateData[path] = value;
        continue;
      }
      const local = JSON.parse(JSON.stringify(value));
      // Subtrees are sent whole (Foundry replaces arrays), so apply only what
      // this client changed on top of the document's current value; otherwise
      // another user's edits to a different item would be overwritten.
      const base = foundry.utils.getProperty(this.#baseline, path);
      const current = foundry.utils.getProperty(this.actor, path);
      if (base !== undefined && current !== undefined) {
        const remote = JSON.parse(JSON.stringify(current));
        const merged = mergeThreeWay(base, local, remote);
        if (!deepEqual(merged, local)) this.#syncAfterFlush = true;
        updateData[path] = merged;
      } else {
        updateData[path] = local;
      }
    }

    // Third-party modules (e.g. tokenmagic-automatic-wounds) key off
    // system.resources.health.value in the preUpdateActor diff to detect HP
    // changes. healthByForm is our source of truth and health.value is
    // re-derived by prepareDerivedData, so include the already-resolved value
    // so it rides along in the same update instead of racing a later recompute.
    const currentFormId = (this.#reactiveActor.system as any).currentFormId;
    if (currentFormId) {
      const formKey = `system.healthByForm.${currentFormId}`;
      if (formKey in updateData) {
        updateData["system.resources.health.value"] = updateData[formKey];
      } else if (updateData["system.healthByForm"]?.[currentFormId] !== undefined) {
        updateData["system.resources.health.value"] =
          updateData["system.healthByForm"][currentFormId];
      }
    }

    if (Object.keys(updateData).length > 0) {
      this.#isUpdating = true;
      try {
        await this.#applyUpdate(updateData);
        for (const [path, value] of Object.entries(updateData)) {
          if (value !== null && typeof value === "object") {
            foundry.utils.setProperty(
              this.#baseline,
              path,
              JSON.parse(JSON.stringify(value))
            );
          }
        }
      } catch (error) {
        console.error("[FsrBaseSheet] Update failed:", error);
      } finally {
        this.#isUpdating = false;
      }
    }

    if (this.#syncAfterFlush && this.#pendingFieldPaths.size === 0) {
      this.#syncAfterFlush = false;
      this.#syncReactiveActor();
    }
  }

  async #applyUpdate(updateData: Record<string, any>): Promise<void> {
    const actor = this.actor;
    // @ts-expect-error - token property exists on ActorSheetV2
    const token = this.token;

    // Unlinked tokens store changes in the token delta
    const isUnlinkedToken = actor.isToken && token && !token.actorLink;
    if (!isUnlinkedToken) {
      await actor.update(updateData);
      return;
    }

    const tokenUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updateData)) {
      tokenUpdates[`delta.${key}`] = value;
    }
    await token.update(tokenUpdates);

    // After a delta update, explicitly refresh bar values AND max: the token
    // bars cache values and need to be told to recalculate from resources.
    const updatedActor = token.actor; // fresh synthetic actor (base + delta)
    if (updatedActor && token.object) {
      const healthResource = (updatedActor.system as any).resources?.health;
      const armorResource = (updatedActor.system as any).resources?.armor;

      if (healthResource !== undefined) {
        token.bar1.value = healthResource.value;
        token.bar1.max = healthResource.max;
      }
      if (armorResource !== undefined) {
        token.bar2.value = armorResource.value;
        token.bar2.max = armorResource.max;
      }

      token.object.drawBars();
    }
  }

  // ─── Write auditor (migration safety net) ─────────────────────────────────

  #auditEnabled(): boolean {
    try {
      return localStorage.getItem("faserip.auditWrites") === "1";
    } catch {
      return false;
    }
  }

  /**
   * Warn about reactive actor changes that were never persisted via
   * setActorField. Enable with localStorage.setItem("faserip.auditWrites","1")
   * or call from the console on an open sheet.
   */
  async auditUnpersistedFields(): Promise<string[]> {
    if (!this.#reactiveActor) return [];
    const snap = (a: any) =>
      JSON.parse(
        JSON.stringify({ name: a.name, img: a.img, system: a.system })
      );
    const diff = foundry.utils.diffObject(
      snap(this.actor),
      snap(toRaw(this.#reactiveActor)),
      { deletionKeys: true }
    );
    const unpersisted = Object.keys(foundry.utils.flattenObject(diff)).filter(
      key =>
        !this.#isDerivedPath(key) &&
        ![...this.#pendingFieldPaths].some(
          p => key === p || key.startsWith(`${p}.`)
        )
    );
    if (unpersisted.length > 0) {
      console.warn(
        `[FsrBaseSheet] ${unpersisted.length} reactive actor change(s) not persisted via setActorField:`,
        unpersisted
      );
    }
    return unpersisted;
  }

  /**
   * Helper to save system data (auto-prefixes with "system.")
   */
  async saveSystem(data: Record<string, unknown>): Promise<void> {
    const prefixed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      prefixed[`system.${key}`] = value;
    }
    await this.actor.update(prefixed);
  }
}
