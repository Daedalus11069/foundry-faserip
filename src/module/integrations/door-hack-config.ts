import {
  getRequiredRollTypeChoices,
  parseRequiredSuccessConfig,
  serializeRequiredSuccessConfig,
  listNodeHackerGraphNames,
  type RequiredSuccessConfig
} from "./node-hacker-hacking";
import { requestSetDoorHackRequiredColor, requestSetDoorHackGraphName } from "../socket/faserip-socket";

declare const Hooks: any;
declare const game: any;

const FASERIP_MODULE_ID = "faserip";
const HACK_PROOF_FLAG = "hackProof";
const UNBREAKABLE_FLAG = "unbreakable";
const HACK_REQUIRED_COLOR_FLAG = "hackRequiredColor";
const HACK_GRAPH_NAME_FLAG = "hackGraphName";

/** Reads a door Wall document's hack-proof flag (defaults false when unset). */
export function isDoorHackProof(wall: any): boolean {
  const document = wall?.document ?? wall;
  return document?.getFlag?.(FASERIP_MODULE_ID, HACK_PROOF_FLAG) === true;
}

/** Reads a door Wall document's unbreakable flag (defaults false when unset). */
export function isDoorUnbreakable(wall: any): boolean {
  const document = wall?.document ?? wall;
  return document?.getFlag?.(FASERIP_MODULE_ID, UNBREAKABLE_FLAG) === true;
}

/** Reads a door Wall document's minimum-success requirement for a hack to
 * succeed - either a roll-type tier or a flat DC (see RequiredSuccessConfig
 * in node-hacker-hacking.ts), defaulting to the lowest registered tier when
 * unset. Mirrors an actor's hackRequiredColor (see ActorDataModels.ts). */
export function getDoorRequiredSuccess(wall: any): RequiredSuccessConfig {
  const document = wall?.document ?? wall;
  return parseRequiredSuccessConfig(document?.getFlag?.(FASERIP_MODULE_ID, HACK_REQUIRED_COLOR_FLAG));
}

/**
 * Sets a door's required hack success config, routed through a GM client via
 * socketlib when the caller isn't GM - Wall documents are normally GM-only
 * to update, same reasoning as requestSetDoorLockState. Exposed on
 * game.faserip.door for macro/console use (e.g.
 * `game.faserip.door.setRequiredSuccess(wall, { kind: "flatDC", value: 65 })`),
 * not just the Wall Config sheet below.
 */
export async function setDoorRequiredSuccess(
  wall: any,
  config: RequiredSuccessConfig
): Promise<boolean> {
  const document = wall?.document ?? wall;
  if (!document?.uuid) return false;
  return requestSetDoorHackRequiredColor(document.uuid, serializeRequiredSuccessConfig(config));
}

/** Reads a door Wall document's Node Designer graph name - a specific,
 * GM-built puzzle to use instead of a network generated fresh off the
 * opening roll (see attemptFaseripNodeHack's graphName handling in
 * node-hacker-hacking.ts). Empty string means "generate one". Mirrors an
 * actor's hackGraphName (see ActorDataModels.ts). */
export function getDoorHackGraphName(wall: any): string {
  const document = wall?.document ?? wall;
  return document?.getFlag?.(FASERIP_MODULE_ID, HACK_GRAPH_NAME_FLAG) || "";
}

/**
 * Sets a door's Node Designer graph name, routed through a GM client via
 * socketlib when the caller isn't GM - same reasoning as
 * setDoorRequiredSuccess above. Exposed on game.faserip.door for
 * macro/console use, not just the Wall Config sheet below. Pass "" to go
 * back to generating a network from the opening roll.
 */
export async function setDoorHackGraphName(wall: any, graphName: string): Promise<boolean> {
  const document = wall?.document ?? wall;
  if (!document?.uuid) return false;
  return requestSetDoorHackGraphName(document.uuid, graphName);
}

function appendCheckboxField(
  afterEl: Element,
  ownerDoc: Document,
  label: string,
  flagKey: string,
  checked: boolean,
  hint: string
): Element {
  const group = ownerDoc.createElement("div");
  group.classList.add("form-group");
  group.innerHTML = `
    <label>${label}</label>
    <div class="form-fields">
      <input type="checkbox" name="flags.${FASERIP_MODULE_ID}.${flagKey}" ${checked ? "checked" : ""}>
    </div>
    <p class="hint">${hint}</p>
  `;
  afterEl.after(group);
  return group;
}

/**
 * Appends the "Required Hack Success" field group: a kind toggle (Roll
 * Type / Flat DC) plus both a tier <select> and a DC <input type=number>,
 * with the inactive one hidden via a plain change listener - Foundry's
 * FormDataExtended expands dotted names into a nested object on submit, so
 * `flags.faserip.hackRequiredColor.{kind,tier,dc}` lands as exactly the
 * RequiredSuccessWireValue shape parseRequiredSuccessConfig expects. Both
 * value fields are always submitted (not just the active one) so toggling
 * kind back and forth before saving doesn't lose whichever value isn't
 * currently shown - matches serializeRequiredSuccessConfig always writing both.
 */
function appendRequiredSuccessField(
  afterEl: Element,
  ownerDoc: Document,
  flagKey: string,
  current: RequiredSuccessConfig
): Element {
  const group = ownerDoc.createElement("div");
  group.classList.add("form-group");

  const tierOptions = getRequiredRollTypeChoices()
    .map(
      ({ value, label }) =>
        `<option value="${value}"${current.kind === "tier" && value === current.value ? " selected" : ""}>${label}</option>`
    )
    .join("");
  const dcValue = current.kind === "flatDC" ? current.value : 30;

  group.innerHTML = `
    <label>Required Hack Success</label>
    <div class="form-fields">
      <select name="flags.${FASERIP_MODULE_ID}.${flagKey}.kind" class="faserip-hack-kind">
        <option value="tier"${current.kind === "tier" ? " selected" : ""}>Roll Type</option>
        <option value="flatDC"${current.kind === "flatDC" ? " selected" : ""}>Flat DC</option>
      </select>
      <select name="flags.${FASERIP_MODULE_ID}.${flagKey}.tier" class="faserip-hack-tier"${current.kind === "flatDC" ? ' style="display:none"' : ""}>${tierOptions}</select>
      <input type="number" name="flags.${FASERIP_MODULE_ID}.${flagKey}.dc" class="faserip-hack-dc" value="${dcValue}"${current.kind === "tier" ? ' style="display:none"' : ""}>
    </div>
    <p class="hint">Either the minimum Universal Table color, or a flat DC the raw roll total must meet, a hacker's roll must reach to crack this door's lock.</p>
  `;

  const kindSelect = group.querySelector(".faserip-hack-kind") as HTMLSelectElement;
  const tierSelect = group.querySelector(".faserip-hack-tier") as HTMLElement;
  const dcInput = group.querySelector(".faserip-hack-dc") as HTMLElement;
  kindSelect.addEventListener("change", () => {
    const isFlatDC = kindSelect.value === "flatDC";
    tierSelect.style.display = isFlatDC ? "none" : "";
    dcInput.style.display = isFlatDC ? "" : "none";
  });

  afterEl.after(group);
  return group;
}

/**
 * Appends the Node Designer graph select - "(generate from opening roll)"
 * plus every graph name from listNodeHackerGraphNames(). That lookup is
 * async (it awaits Node Hacker's own graph store), but this whole function
 * runs synchronously inside the renderWallConfig hook, so the select starts
 * with just the current value (in case it's a name not in the list yet, or
 * the lookup is still pending) and gets the rest of its <option>s filled in
 * once the promise resolves - same tradeoff EditTab.vue's onMounted makes
 * for the actor sheet's equivalent field, just without Vue's reactivity to
 * lean on here.
 */
function appendGraphNameField(
  afterEl: Element,
  ownerDoc: Document,
  flagKey: string,
  current: string
): Element {
  const group = ownerDoc.createElement("div");
  group.classList.add("form-group");
  const currentOption =
    current ? `<option value="${current}" selected>${current}</option>` : "";
  group.innerHTML = `
    <label>
      Node Graph
      <span class="hint" style="font-weight: normal;">(overrides Required Hack Success above)</span>
    </label>
    <div class="form-fields">
      <select name="flags.${FASERIP_MODULE_ID}.${flagKey}" class="faserip-hack-graph">
        <option value="">(generate from opening roll)</option>
        ${currentOption}
      </select>
    </div>
    <p class="hint">Optional: pick a graph built in Node Hacker's Node Designer to use for this door instead of a network generated fresh off the opening roll.</p>
  `;

  const select = group.querySelector(".faserip-hack-graph") as HTMLSelectElement;
  void listNodeHackerGraphNames().then(names => {
    for (const name of names) {
      if (name === current) continue; // Already present as currentOption above.
      const option = ownerDoc.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    }
  });

  afterEl.after(group);
  return group;
}

/**
 * Injects "Hack-proof", "Unbreakable", "Required Hack Success", and "Node
 * Graph" fields into the core Wall Config sheet's door settings, GM-only,
 * only shown for walls actually configured as a door (wall.door truthy - a
 * plain wall segment has nothing to hack or break in the first place). No
 * renderWallConfig hook exists elsewhere in this codebase - this is the
 * first - so the injection is plain DOM manipulation matching Foundry's own
 * convention for this hook rather than mirroring an in-repo pattern.
 */
export function initHackProofDoorConfig(): void {
  Hooks.on("renderWallConfig", (app: any, htmlEl: any) => {
    if (!game.user?.isGM) return;

    const document = app.document ?? app.object;
    if (!document || !document.door) return;

    const html: HTMLElement =
      htmlEl instanceof HTMLElement ? htmlEl : htmlEl?.[0];
    if (!html) return;

    const doorTypeGroup = html.querySelector('select[name="door"]')?.closest(
      ".form-group"
    );
    if (!doorTypeGroup) return;

    const ownerDoc = html.ownerDocument ?? globalThis.document;

    const hackProofGroup = appendCheckboxField(
      doorTypeGroup,
      ownerDoc,
      "Hack-proof",
      HACK_PROOF_FLAG,
      isDoorHackProof(document),
      "Doors are hackable by default (via Node Hacker/LocknKey), regardless of any lock installed on them. Check this to exempt this specific door from hacking."
    );
    const unbreakableGroup = appendCheckboxField(
      hackProofGroup,
      ownerDoc,
      "Unbreakable",
      UNBREAKABLE_FLAG,
      isDoorUnbreakable(document),
      "Prevents this door's lock from being broken, regardless of the acting actor's Strength."
    );
    const requiredSuccessGroup = appendRequiredSuccessField(
      unbreakableGroup,
      ownerDoc,
      HACK_REQUIRED_COLOR_FLAG,
      getDoorRequiredSuccess(document)
    );
    appendGraphNameField(
      requiredSuccessGroup,
      ownerDoc,
      HACK_GRAPH_NAME_FLAG,
      getDoorHackGraphName(document)
    );
  });
}
