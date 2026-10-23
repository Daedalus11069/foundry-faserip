import { toRaw } from "vue";

const MAX_DEPTH = 4;
const MAX_NODES = 200;

const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * Bounded structural equality for plain data (objects, arrays, primitives).
 * Anything else (class instances, Sets, ...) counts as "different" so callers
 * fall back to plain assignment. If the work budget is exceeded the answer is
 * also "different", so the check can never cost more than the assignment it is
 * trying to avoid.
 */
export function isSameData(a: unknown, b: unknown): boolean {
  let nodes = 0;
  const walk = (x: unknown, y: unknown, depth: number): boolean => {
    if (x === y) return true;
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) {
        if (!walk(toRaw(x[i]), y[i], depth + 1)) return false;
      }
      return true;
    }
    if (isPlainObject(x) && isPlainObject(y)) {
      const xk = Object.keys(x);
      if (xk.length !== Object.keys(y).length) return false;
      for (const k of xk) {
        if (!(k in y)) return false;
        if (!walk(toRaw(x[k]), y[k], depth + 1)) return false;
      }
      return true;
    }
    return false;
  };
  return walk(a, b, 0);
}

/**
 * Assign each key of `src` onto `target` only when the value actually differs.
 * Foundry re-runs prepareData after every update and hands back new-but-equal
 * objects; assigning those would re-trigger every computed and template that
 * reads them.
 */
export function assignIfChanged(
  target: Record<string, any>,
  src: Record<string, any>
): void {
  for (const [key, value] of Object.entries(src)) {
    if (!isSameData(toRaw(target[key]), value)) target[key] = value;
  }
}
