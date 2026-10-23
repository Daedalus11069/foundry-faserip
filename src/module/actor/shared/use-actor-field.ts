import { inject, watch } from "vue";
import type { FsrBaseSheet } from "../FsrBaseSheet";

/**
 * Component-facing API for path-based actor writes.
 *
 * `fields` is a Proxy keyed by document path so templates keep using v-model:
 *   <input v-model="fields['system.callname']" />
 * Reads are reactive (they read the reactive actor); writes go through
 * FsrBaseSheet.setActorField, which updates the reactive actor in place and
 * queues exactly that path for a debounced actor.update().
 */
export function useActorField(getReactiveActor: () => any) {
  const sheet = inject("sheet") as FsrBaseSheet;

  const getField = (path: string) =>
    foundry.utils.getProperty(getReactiveActor(), path);
  const setField = (path: string, value: unknown) =>
    sheet.setActorField(path, value);

  const fields = new Proxy({} as Record<string, any>, {
    get: (_t, path) => (typeof path === "string" ? getField(path) : undefined),
    set: (_t, path, value) => {
      if (typeof path === "string") setField(path, value);
      return true;
    }
  });

  /**
   * Scoped deep watcher for child components that mutate a nested object or
   * array in place (v-model="power.name" inside a v-for, push/splice, ...).
   * Persists the whole subtree at `path` whenever anything inside changes.
   */
  const persistDeep = (path: string) =>
    watch(
      () => getField(path),
      () => setField(path, getField(path)),
      { deep: true }
    );

  return {
    fields,
    setField,
    getField,
    persistDeep,
    flush: () => sheet.flushActorFields()
  };
}
