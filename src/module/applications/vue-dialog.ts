import type { Component, App } from "vue";
import { createApp, reactive, h } from "vue";

const FADE_DURATION_MS = 150;

/**
 * Fade `el` out and hide it, matching the look of Foundry's own dialog
 * close animation. Driven entirely by our own transition + a hard timeout
 * fallback (rather than waiting on a `transitionend` event that can
 * silently never fire for Vue-rendered content), so it always finishes.
 */
function fadeOutAndHide(el: HTMLElement): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener("transitionend", finish);
      el.style.setProperty("display", "none", "important");
      resolve();
    };

    el.style.transition = `opacity ${FADE_DURATION_MS}ms ease, transform ${FADE_DURATION_MS}ms ease`;
    el.style.pointerEvents = "none";
    el.style.opacity = "0";
    el.style.transform = "scale(0.98)";

    el.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, FADE_DURATION_MS + 50);
  });
}

// TypeScript cannot resolve `foundry.applications.api.ApplicationV2` as a
// constructor expression in `extends` (the value-space path doesn't fully
// resolve), so we declare a typed shim and cast the runtime constructor to it.
// The shim methods are never executed — Foundry's real implementations run.
class _AppV2Shim {
  get element(): HTMLElement {
    throw Error("shim");
  }
  get options(): {
    position?: Partial<{
      height: number | "auto";
      width: number | "auto";
      top: number;
      left: number;
      scale: number;
      zIndex: number;
    }>;
  } & Record<string, unknown> {
    throw Error("shim");
  }
  setPosition(
    _pos?: Partial<{
      height: number | "auto";
      width: number | "auto";
      top: number;
      left: number;
      scale: number;
      zIndex: number;
    }>
  ): void {
    /* runtime */
  }
  render(_options?: boolean | Record<string, unknown>): Promise<this> {
    throw Error("shim");
  }
  close(_options?: Record<string, unknown>): Promise<this> {
    throw Error("shim");
  }
  protected _onRender(
    _context: Record<string, unknown>,
    _options: Record<string, unknown>
  ): void | Promise<void> {
    /* runtime */
  }
  protected _renderHTML(
    _context: Record<string, unknown>,
    _options: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    throw Error("shim");
  }
  protected _replaceHTML(
    _result: Record<string, unknown>,
    _content: HTMLElement,
    _options: Record<string, unknown>
  ): void {
    /* runtime */
  }
  constructor(_options?: Record<string, unknown>) {}
}
const _AppV2 = (
  foundry.applications as unknown as {
    api: { ApplicationV2: typeof _AppV2Shim };
  }
).api.ApplicationV2;

/**
 * A base class for creating Foundry ApplicationV2 dialogs with Vue components.
 * This provides proper integration with Foundry's dialog system while maintaining Vue reactivity.
 */
export class VueDialog extends _AppV2 {
  /** The Vue app instance */
  #instance: App | null = null;

  /** The Vue component to render */
  protected component: Component;

  /** Props to pass to the Vue component */
  #props: Record<string, unknown> = {};

  /** Stored escape key handler for cleanup */
  #escapeHandler: ((event: KeyboardEvent) => void) | null = null;

  /** Promise resolve function for returning values */
  #resolve: ((value: unknown) => void) | null = null;

  /** Promise for waiting on dialog result */
  #promise: Promise<unknown> | null = null;

  /** Value passed to submit(), applied once close() actually resolves */
  #pendingValue: unknown = null;

  static DEFAULT_OPTIONS = {
    classes: ["fsr-dialog", "dialog-sheet"],
    tag: "div" as const,
    window: {
      frame: true,
      positioned: true,
      title: "Dialog",
      icon: "",
      controls: [],
      minimizable: false,
      resizable: false
    },
    actions: {},
    form: {
      handler: undefined,
      closeOnSubmit: false
    },
    position: {
      width: "auto" as const,
      height: "auto" as const
    }
  };

  constructor(
    component: Component,
    props: Record<string, unknown> = {},
    options: Record<string, unknown> = {}
  ) {
    options.window = (options.window as Record<string, unknown>) || {};
    if (!(options.window as Record<string, unknown>).positioned) {
      (options.window as Record<string, unknown>).positioned = true;
    }

    super(options);
    this.component = component;
    this.#props = reactive(props);
  }

  static PARTS = {
    content: {
      id: "content",
      template: ""
    }
  };

  /**
   * Render the application HTML
   */
  async _renderHTML(
    _context: Record<string, unknown>,
    options: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const rendered: Record<string, unknown> = {};

    // Merge any new props provided during render
    if (options?.props) {
      foundry.utils.mergeObject(this.#props, options.props as object, {
        inplace: true,
        insertKeys: true
      });
    }

    // Return the component to be rendered
    rendered.content = this.component;

    return rendered;
  }

  /**
   * Replace the HTML content in the application
   */
  _replaceHTML(
    result: Record<string, unknown>,
    content: HTMLElement,
    _options: Record<string, unknown>
  ): void {
    // Check if the Vue Instance exists, if not create it
    if (!this.#instance) {
      const Instance = this;

      // Create Vue app with render function
      this.#instance = createApp({
        render: () =>
          Object.entries(result).map(([key, component]) =>
            h(
              "div",
              {
                "data-application-part": key
              },
              [h(component as Component, { ...this.#props, dialog: this })]
            )
          )
      });

      // Add update mixin for auto-height
      this.#instance.mixin({
        updated() {
          // Resize the application window after the Vue Instance is updated
          if (Instance?.options?.position?.height === "auto")
            Instance.setPosition({ height: "auto" });

          // Call the render method when the Vue Instance is updated
          // -- This will call FoundryVTTs Hooks related to rendering when Vue is updated
          // -- Useful for when other modules listen for rendering events to inject HTML
          Instance.render();
        }
      });

      // Mount the Vue instance
      this.#instance.mount(content);
    }
  }

  /**
   * Called after the application is rendered
   */
  _onRender(
    _context: Record<string, unknown>,
    _options: Record<string, unknown>
  ): void {
    super._onRender?.(_context, _options);

    // Ensure the dialog is properly centered on first render
    if (this.element && !this.element.style.left) {
      // Let Foundry handle initial positioning
      this.setPosition({});
    }

    // Add keyboard event listener for Escape key
    this._addEscapeKeyHandler();
  }

  /**
   * Add keyboard event handler for Escape key
   */
  _addEscapeKeyHandler(): void {
    if (!this.element) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Esc") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
    };

    this.#escapeHandler = handleKeyDown;
    this.element.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keydown", handleKeyDown);
  }

  /**
   * Submit a value and close the dialog. The caller's wait() promise resolves
   * only once close() has fully finished (see close() below) - not
   * immediately here - so a caller awaiting this dialog before opening the
   * next one doesn't race the closing animation/cleanup and end up with
   * multiple dialogs visibly open at once.
   */
  submit(value: unknown): void {
    this.#pendingValue = value;
    void this.close();
  }

  /**
   * Hide the window without resolving wait() or tearing down the Vue
   * instance. For a dialog whose handler needs to show a follow-up dialog
   * (e.g. "Defend" opening a karma-spending dialog before the actual roll
   * happens) and only calls submit() once that whole flow finishes - so the
   * original window would otherwise sit fully visible on screen beneath the
   * follow-up dialog the whole time. Safe to call before an eventual
   * submit()/close(), which still runs its normal cleanup.
   */
  async hide(): Promise<void> {
    const el = this.element;
    if (el) await fadeOutAndHide(el);
  }

  /**
   * Wait for the dialog to be submitted or closed
   */
  wait(): Promise<unknown> {
    if (!this.#promise) {
      this.#promise = new Promise(resolve => {
        this.#resolve = resolve;
      });
    }
    return this.#promise;
  }

  /**
   * Clean up Vue app when dialog closes
   */
  async close(options?: Record<string, unknown>): Promise<this> {
    const el = this.element;

    // Remove escape key handler
    if (this.#escapeHandler) {
      this.element?.removeEventListener("keydown", this.#escapeHandler);
      window.removeEventListener("keydown", this.#escapeHandler);
      this.#escapeHandler = null;
    }

    if (this.#instance) {
      this.#instance.unmount();
      this.#instance = null;
    }

    // Fade out and hide the window ourselves rather than relying on
    // ApplicationV2's own closing animation. That animation depends on a
    // transitionend firing on this element, which can silently never happen
    // for Vue-rendered dialog content - leaving a fully interactive,
    // un-closeable window stuck on screen even after the user already picked
    // an option. Our own fade has a hard timeout fallback so it can't hang
    // the same way. Foundry's own close() below still runs for proper
    // app-registry cleanup, but a caller awaiting this dialog (e.g. a
    // multi-weapon attack loop opening one dialog per weapon) is unblocked
    // as soon as the fade finishes.
    if (el) await fadeOutAndHide(el);

    let result: this;
    try {
      result = await super.close(options);
    } catch (err) {
      console.warn("FASERIP | VueDialog close() failed, forcing removal:", err);
      el?.remove();
      result = this;
    }

    // Resolve wait() only after the window has actually finished closing
    // (submit() sets #pendingValue beforehand; an unsubmitted close, e.g.
    // Escape or the X button, resolves with null).
    if (this.#resolve) {
      this.#resolve(this.#pendingValue);
      this.#resolve = null;
    }

    return result;
  }

  /**
   * Static helper to create and show a Vue dialog
   */
  static async show(
    component: Component,
    props: Record<string, unknown> = {},
    options: Record<string, unknown> = {}
  ): Promise<unknown> {
    const dialog = new VueDialog(component, props, options);
    await dialog.render(true);
    return dialog.wait();
  }
}
