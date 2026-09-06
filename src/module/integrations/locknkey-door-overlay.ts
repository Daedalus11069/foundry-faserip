import { Rank } from "../enums";
import { isHoloSuiteActive } from "./holosuite-hacking";
import { isDoorHackProof, isDoorUnbreakable } from "./door-hack-config";
import {
  getLocknKeyApi,
  isLocknKeyModuleActive,
  attemptDoorHack,
  attemptBreakDoorLock,
  refreshLocknKeyHover
} from "./holosuite-door-hacking";

declare const globalThis: any;
declare const canvas: any;
declare const document: Document;

const FASERIP_MODULE_ID = "faserip";
const DOOR_CONTROL_PATH = "foundry.canvas.containers.DoorControl";
const MIDDLE_BUTTON = 1;
const OFFSET_PX = 12;

let registered = false;
let warnedNoLibWrapper = false;
let overlayEl: HTMLDivElement | null = null;
let overlayWall: any = null;
let outsideClickListener: ((event: MouseEvent) => void) | null = null;

function removeOverlay(): void {
  overlayEl?.remove();
  overlayEl = null;
  overlayWall = null;
  if (outsideClickListener) {
    document.removeEventListener("mousedown", outsideClickListener, true);
    outsideClickListener = null;
  }
}

/** Reads LocknKey's lock status for a wall via its LnKFlags.isLocked()
 * static method (confirmed from source - LnKFlags is the class itself on
 * the API object, not a callable factory, and there's no `.locked`
 * property; isLocked(pObject) returns the boolean directly). Degrades to
 * "unknown" if that shape ever changes, since it isn't a documented
 * contract. */
function readLockStatus(wall: any): string {
  const api = getLocknKeyApi();
  if (typeof api?.LnKFlags?.isLocked !== "function") return "Unknown";
  try {
    return api.LnKFlags.isLocked(wall.document ?? wall) ? "Locked" : "Unlocked";
  } catch (err) {
    console.warn("faserip | LocknKey LnKFlags.isLocked() lookup failed", err);
    return "Unknown";
  }
}

/** Opens the menu for a door's control, or closes it if it's already open
 * for that same door (toggle-on-repeat-click). */
function toggleOverlay(control: any): void {
  const wall = control.wall;
  if (!wall) return;

  if (overlayEl && overlayWall === wall) {
    removeOverlay();
    return;
  }

  removeOverlay();

  const el = document.createElement("div");
  el.classList.add("faserip-locknkey-overlay");
  Object.assign(el.style, {
    position: "fixed",
    zIndex: "100",
    background: "rgba(0, 0, 0, 0.85)",
    color: "#fff",
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    pointerEvents: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "2px"
  } as CSSStyleDeclaration);

  const status = document.createElement("div");
  status.textContent = `Lock: ${readLockStatus(wall)}`;
  el.appendChild(status);

  const buttonRow = document.createElement("div");
  buttonRow.style.display = "flex";
  buttonRow.style.gap = "4px";
  el.appendChild(buttonRow);

  const api = getLocknKeyApi();

  const addButton = (label: string, onClick: () => void) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.style.fontSize = "11px";
    btn.addEventListener("click", () => {
      onClick();
      removeOverlay();
    });
    buttonRow.appendChild(btn);
  };

  // Picking and hacking are the same action from the player's side now: one
  // "Pick Lock" button. When HoloSuite is active and the door isn't
  // hack-proof, picking means rolling Reasoning and running the hack
  // minigame (attemptDoorHack already unlocks via LocknKey on success).
  // Otherwise it falls back to LocknKey's plain, un-rolled PickHoveredLock().
  const hackAvailable = isHoloSuiteActive() && !isDoorHackProof(wall);
  if (hackAvailable || typeof api?.PickHoveredLock === "function") {
    addButton("Pick Lock", () => {
      if (!hackAvailable) {
        refreshLocknKeyHover(wall);
        api.PickHoveredLock();
        return;
      }

      const controlledActor = (canvas as any)?.tokens?.controlled?.[0]?.actor;
      if (!controlledActor) {
        globalThis.ui?.notifications?.warn?.(
          "Select a token first, then click Pick Lock."
        );
        return;
      }

      const attributeRank: Rank =
        controlledActor.getCurrentForm?.()?.attributes?.reasoning?.rank ??
        Rank.Typical;

      void attemptDoorHack({
        actor: controlledActor,
        wall,
        attributeName: `${controlledActor.name} Picking Lock`,
        attributeRank
      });
    });
  }
  if (typeof api?.BreakHoveredLock === "function" && !isDoorUnbreakable(wall)) {
    addButton("Break", () => {
      const controlledActor = (canvas as any)?.tokens?.controlled?.[0]?.actor;
      if (!controlledActor) {
        globalThis.ui?.notifications?.warn?.(
          "Select a token first, then click Break."
        );
        return;
      }

      const attributeRank: Rank =
        controlledActor.getCurrentForm?.()?.attributes?.strength?.rank ??
        Rank.Typical;

      void attemptBreakDoorLock({
        actor: controlledActor,
        wall,
        attributeRank
      });
    });
  }

  const screenPoint = control.getGlobalPosition
    ? control.getGlobalPosition()
    : { x: control.x, y: control.y };
  const canvasRect = canvas?.app?.view?.getBoundingClientRect?.();
  el.style.left = `${(canvasRect?.left ?? 0) + screenPoint.x + OFFSET_PX}px`;
  el.style.top = `${(canvasRect?.top ?? 0) + screenPoint.y - OFFSET_PX}px`;

  document.body.appendChild(el);
  overlayEl = el;
  overlayWall = wall;

  // Dismiss on any click outside the menu. Attached on the next tick so the
  // same middle-click mousedown that opened the menu doesn't immediately
  // close it again via event bubbling to document.
  outsideClickListener = (event: MouseEvent) => {
    if (overlayEl && !overlayEl.contains(event.target as Node)) {
      removeOverlay();
    }
  };
  const listener = outsideClickListener;
  globalThis.setTimeout(() => {
    if (outsideClickListener === listener) {
      document.addEventListener("mousedown", listener, true);
    }
  }, 0);
}

/**
 * Shows a status/action menu on a door's lock icon when middle-clicked.
 * Left-click is core's own OPEN/CLOSED toggle and right-click is core's
 * LOCKED/CLOSED toggle (also read by LocknKey's own shift/ctrl/alt-modified
 * GM actions and by key-holding players' plain right-click) - both already
 * carry meaning, so this uses the middle mouse button instead, added as a
 * brand new listener on each DoorControl instance rather than intercepting
 * either of core's existing handlers. Only registers if LocknKey is active;
 * degrades to no Hack button if HoloSuite Hacking isn't active.
 */
export function initLocknKeyDoorOverlay(): void {
  if (registered) return;
  if (!isLocknKeyModuleActive()) return;

  if (typeof globalThis.libWrapper === "undefined") {
    if (!warnedNoLibWrapper) {
      warnedNoLibWrapper = true;
      console.warn(
        "faserip | libWrapper is not active - the LocknKey door menu is disabled. Install and enable the libWrapper module to use this feature."
      );
    }
    return;
  }

  registered = true;

  // draw() runs once per DoorControl instance, and again on every redraw -
  // including the redraw a lock/unlock triggers. Core's own draw() clears
  // and rebinds its own listeners each time (removeAllListeners internally),
  // which wipes ours out too - so this rebinds unconditionally after every
  // wrapped() call rather than only once per instance, using a stored
  // handler reference so re-registering is idempotent (off() before on()).
  try {
    globalThis.libWrapper.register(
      FASERIP_MODULE_ID,
      `${DOOR_CONTROL_PATH}.prototype.draw`,
      async function (this: any, wrapped: (...args: any[]) => any, ...args: any[]) {
        const result = await wrapped(...args);
        if (!this.__faseripMiddleClickHandler) {
          this.__faseripMiddleClickHandler = (event: any) => {
            if (event.button !== MIDDLE_BUTTON) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            toggleOverlay(this);
          };
        }
        this.off("pointerdown", this.__faseripMiddleClickHandler);
        this.on("pointerdown", this.__faseripMiddleClickHandler);
        return result;
      },
      "WRAPPER"
    );
  } catch (err) {
    // Surfaced rather than swallowed - a wrong method name or namespace path
    // on a future Foundry version would otherwise fail this registration
    // completely silently, leaving the middle-click menu dead with no clue
    // why.
    console.error(
      `faserip | Failed to register the LocknKey door menu libWrapper patch on ${DOOR_CONTROL_PATH}.prototype.draw`,
      err
    );
  }
}
