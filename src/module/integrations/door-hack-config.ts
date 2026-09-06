declare const Hooks: any;
declare const game: any;

const FASERIP_MODULE_ID = "faserip";
const HACK_PROOF_FLAG = "hackProof";
const UNBREAKABLE_FLAG = "unbreakable";

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
 * Injects "Hack-proof" and "Unbreakable" checkboxes into the core Wall
 * Config sheet's door settings, GM-only, only shown for walls actually
 * configured as a door (wall.door truthy - a plain wall segment has nothing
 * to hack or break in the first place). No renderWallConfig hook exists
 * elsewhere in this codebase - this is the first - so the injection is
 * plain DOM manipulation matching Foundry's own convention for this hook
 * rather than mirroring an in-repo pattern.
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
      "Prevents this door from being targeted by HoloSuite hacking, regardless of any lock installed on it."
    );
    appendCheckboxField(
      hackProofGroup,
      ownerDoc,
      "Unbreakable",
      UNBREAKABLE_FLAG,
      isDoorUnbreakable(document),
      "Prevents this door's lock from being broken, regardless of the acting actor's Strength."
    );
  });
}
