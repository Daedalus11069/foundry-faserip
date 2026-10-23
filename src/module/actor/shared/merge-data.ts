const isObj = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const hasIds = (a: unknown[]) =>
  a.every(x => isObj(x) && typeof x.id === "string");

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ak = Object.keys(a);
    if (ak.length !== Object.keys(b).length) return false;
    return ak.every(k => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Three-way merge of plain JSON data so two clients editing different parts
 * of the same object/array don't overwrite each other when a whole subtree
 * has to be sent (Foundry replaces arrays wholesale).
 *
 * - `base`   what this client last saw from the document
 * - `local`  this client's edited copy
 * - `remote` the document's current value (may include other clients' edits)
 *
 * Only what this client changed relative to `base` is applied on top of
 * `remote`. Arrays whose elements all have string ids are merged per element;
 * other arrays and scalars take the local value.
 */
export function mergeThreeWay(base: any, local: any, remote: any): any {
  if (deepEqual(local, base)) return remote;

  if (isObj(base) && isObj(local) && isObj(remote)) {
    const out: Record<string, any> = { ...remote };
    for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
      if (deepEqual(local[key], base[key])) continue;
      if (!(key in local)) delete out[key];
      else if (key in base && key in remote) {
        out[key] = mergeThreeWay(base[key], local[key], remote[key]);
      } else out[key] = local[key];
    }
    return out;
  }

  if (
    Array.isArray(base) &&
    Array.isArray(local) &&
    Array.isArray(remote) &&
    hasIds(base) &&
    hasIds(local) &&
    hasIds(remote)
  ) {
    const baseById = new Map(base.map(x => [x.id, x]));
    const localById = new Map(local.map(x => [x.id, x]));
    const remoteIds = new Set(remote.map(x => x.id));
    const out: any[] = [];
    for (const r of remote) {
      const l = localById.get(r.id);
      const b = baseById.get(r.id);
      if (!l) {
        // Removed locally -> drop; added remotely -> keep
        if (!b) out.push(r);
        continue;
      }
      out.push(b ? mergeThreeWay(b, l, r) : l);
    }
    // Added locally
    for (const l of local) {
      if (!remoteIds.has(l.id) && !baseById.has(l.id)) out.push(l);
    }
    return out;
  }

  return local;
}
