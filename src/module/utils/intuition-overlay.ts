/**
 * Intuition Overlay
 *
 * Renders a floating HUD badge above a token showing the intuition roll result
 * with Universal Table color coding (white/green/yellow/red).
 */

// ─── Internal State ────────────────────────────────────────────────────────────

interface OverlayEntry {
  container: PIXI.Container;
  timeoutId: ReturnType<typeof setTimeout> | null;
  isHoverOverlay: boolean;
}

const activeOverlays = new Map<string, OverlayEntry>();

const lastIntuitionRolls = new Map<
  string,
  { total: number; colorClass: string }
>();

let hoverListenerRegistered = false;

// ─── Public API ────────────────────────────────────────────────────────────────

export function initIntuitionHoverListener(): void {
  if (hoverListenerRegistered) return;
  hoverListenerRegistered = true;

  Hooks.on("hoverToken", (token: any, hovered: boolean) => {
    const tokenId: string | undefined = token?.id;
    if (!tokenId) return;

    if (hovered) {
      if (activeOverlays.has(tokenId)) return;

      const lastRoll = lastIntuitionRolls.get(tokenId);
      if (!lastRoll) return;

      _showOverlay(
        tokenId,
        token,
        lastRoll.total,
        lastRoll.colorClass,
        null,
        true
      );
    } else {
      const entry = activeOverlays.get(tokenId);
      if (entry?.isHoverOverlay) {
        removeIntuitionOverlay(tokenId);
      }
    }
  });
}

export function showIntuitionOverlay(
  tokenId: string,
  total: number,
  colorClass: string,
  durationMs: number
): void {
  lastIntuitionRolls.set(tokenId, { total, colorClass });
  initIntuitionHoverListener();
  removeIntuitionOverlay(tokenId);

  const token: any = (canvas as any)?.tokens?.get(tokenId);

  if (!token) {
    console.warn("[IntuitionOverlay] Token not found:", tokenId);
    return;
  }

  const timeoutId = setTimeout(() => {
    removeIntuitionOverlay(tokenId);
  }, durationMs);

  _showOverlay(tokenId, token, total, colorClass, timeoutId, false);
}

export function removeIntuitionOverlay(tokenId: string): void {
  const entry = activeOverlays.get(tokenId);
  if (!entry) return;
  if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
  if (!entry.container.destroyed) {
    entry.container.destroy({ children: true });
  }
  activeOverlays.delete(tokenId);
}

export function cleanupAllIntuitionOverlays(): void {
  for (const [, entry] of activeOverlays) {
    if (entry.timeoutId !== null) clearTimeout(entry.timeoutId);
    if (!entry.container.destroyed) {
      entry.container.destroy({ children: true });
    }
  }
  activeOverlays.clear();
  lastIntuitionRolls.clear();
}

export function hasIntuitionOverlay(tokenId: string): boolean {
  return activeOverlays.has(tokenId);
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function _showOverlay(
  tokenId: string,
  token: any,
  total: number,
  colorClass: string,
  timeoutId: ReturnType<typeof setTimeout> | null,
  isHoverOverlay: boolean
): void {
  const container = buildOverlayContainer(total, colorClass);

  const tokenW: number = token.w ?? (canvas as any)?.grid?.size ?? 100;
  const bounds = container.getLocalBounds();
  container.x = (tokenW - bounds.width) / 2 - bounds.x;
  container.y = -(bounds.height + 8);

  token.addChild(container);
  activeOverlays.set(tokenId, { container, timeoutId, isHoverOverlay });
}

// ─── PIXI Badge Builder ────────────────────────────────────────────────────────

const FONT_SIZE = 28;
const PADDING_H = 15;
const PADDING_V = 9;
const GAP = 9;
const ICON_SIZE = FONT_SIZE;
const TEXT_COLOR = "#e0f0ff";

function buildOverlayContainer(
  total: number,
  colorClass: string
): PIXI.Container {
  const container = new PIXI.Container();

  // Eye icon
  const icon = buildEyeIcon();

  // Roll total text
  const text = new PIXI.Text(String(total), {
    fontSize: FONT_SIZE,
    fill: TEXT_COLOR,
    fontWeight: "bold"
  });

  const iconBounds = icon.getLocalBounds();
  const textBounds = text.getLocalBounds();
  const totalWidth = PADDING_H * 2 + iconBounds.width + GAP + textBounds.width;
  const totalHeight =
    PADDING_V * 2 + Math.max(iconBounds.height, textBounds.height);

  // Background pill with color based on result
  const bgColor = getColorFromClass(colorClass);

  const bg = new PIXI.Graphics();
  bg.beginFill(bgColor, 0.9);
  bg.drawRoundedRect(0, 0, totalWidth, totalHeight, totalHeight / 2);
  bg.endFill();

  // Position icon
  icon.x = PADDING_H - iconBounds.x;
  icon.y =
    PADDING_V +
    (totalHeight - PADDING_V * 2 - iconBounds.height) / 2 -
    iconBounds.y;

  // Position text
  text.x = PADDING_H + iconBounds.width + GAP - textBounds.x;
  text.y =
    PADDING_V +
    (totalHeight - PADDING_V * 2 - textBounds.height) / 2 -
    textBounds.y;

  container.addChild(bg, icon, text);

  return container;
}

function buildEyeIcon(): PIXI.Text {
  const color = 0x64b5f6;
  const icon = new PIXI.Text("\uf06e", {
    // fa-eye
    fontSize: ICON_SIZE,
    fill: color,
    fontFamily: "Font Awesome 6 Pro"
  });
  return icon;
}

function getColorFromClass(colorClass: string): number {
  const colorMap: Record<string, number> = {
    "ultimate-botch": 0x000000, // Black
    botch: 0x4a0000, // Dark red
    white: 0x4a4a4a, // Dark gray
    green: 0x1b5e20, // Dark green
    yellow: 0x996800, // Dark yellow/gold
    red: 0x8b0000, // Dark red
    perfect: 0xffd700 // Gold
  };

  return colorMap[colorClass] || 0x1a1a2e; // Default dark blue
}
