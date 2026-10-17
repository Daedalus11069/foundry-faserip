import { reactive } from "vue";

/**
 * Charman validation errors keyed by sheet section + item name, so the
 * accordion tabs can highlight the titlebar of a collapsed item that Charman
 * rejected. Cleared on the next successful push.
 */
export type CharmanErrorSection = "powers" | "talents" | "weapons" | "armors";

const itemErrors = reactive<Record<string, string[]>>({});

const key = (section: CharmanErrorSection, name: string) =>
  `${section}:${name}`;

export function clearCharmanItemErrors(): void {
  for (const k of Object.keys(itemErrors)) delete itemErrors[k];
}

export function setCharmanItemError(
  section: CharmanErrorSection,
  name: string,
  message: string
): void {
  const k = key(section, name);
  (itemErrors[k] ??= []).push(message);
}

/** Error text for an item, or "" when it has none (reactive). */
export function getCharmanItemError(
  section: CharmanErrorSection,
  name: string
): string {
  return (itemErrors[key(section, name)] ?? []).join("; ");
}
