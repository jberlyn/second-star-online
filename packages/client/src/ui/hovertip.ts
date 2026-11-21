/**
 * Hover tips: a small box that names what the mouse is over, following the pointer with its
 * top-left corner just below the pointer's tip. It is an SSO addition (1.6 had no tooltips) drawn
 * from 1.6's own parts so it reads as part of the original interface: the purple frame of the item
 * menu (Inventory #50) around a see-through black middle, and the item menu title's lettering
 * (Arial, white, a 1 px black shadow) a size smaller.
 *
 * One tip serves the whole game: the panel's controls attach to it, and the playfield shows it for
 * the player, NPC, monster or ground items under the mouse, one per line (it replaces 1.6's
 * floating hover name, sprite 156).
 * The tip lives in the 800×600 stage-coordinate menu layer so it can cross any frame's edge, and it
 * is kept on the stage: it slides left at the right edge and flips above the pointer at the
 * bottom. Only a mouse shows it: a touch has no hover, and its tap must not leave a box behind.
 */

const STAGE_W = 800;
const STAGE_H = 600;
/** The tip's top-left corner from the pointer's tip: level with it, below the arrow. */
export const TIP_DX = 0;
export const TIP_DY = 20;
/** The gap above the pointer when the tip flips up at the stage's bottom edge. */
const TIP_FLIP_GAP = 2;

/** A labelled tip with an optional subtle keyboard shortcut badge (panel tabs). */
export interface KeyedTip {
  label: string;
  shortcut?: string;
}

/** A tip's text: one line, a keyed line, or a list of lines; null or empty shows nothing. */
export type TipText = string | KeyedTip | readonly string[] | null;

export interface HoverTips {
  /**
   * Shows the tip while the mouse is over `target`. `text` is read on each move, so it can follow
   * changing state; null or "" shows nothing.
   */
  attach(target: HTMLElement, text: TipText | (() => TipText)): void;
  /**
   * Shows `text` for `owner` at the pointer (client coordinates), or hides the tip if `owner` holds
   * it and `text` is null. For places with no element per thing, such as the playfield canvas. A
   * list of two or more shows one per line, the first bold and a size larger (the thing a click
   * acts on) and the rest below it.
   */
  showFor(owner: object, text: TipText, clientX: number, clientY: number): void;
  /** Hides the tip if `owner` holds it. */
  release(owner: object): void;
  /** Hides the tip, whoever holds it. */
  hide(): void;
  /** Player Settings → Accessibility → Larger hover tips. */
  setLarge(on: boolean): void;
  /** While this returns true no tip shows (the item menu is open, an item is being dragged). */
  blocked: () => boolean;
  /** The tip element. */
  el: HTMLElement;
}

function isKeyedTip(v: TipText): v is KeyedTip {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** `frame` is the URL of the item menu's background, whose border is the tip's frame. */
export function createHoverTips(layer: HTMLElement, frame: string): HoverTips {
  const tip = document.createElement("div");
  tip.className = "hover-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  tip.style.borderImageSource = `url("${frame}")`;
  layer.append(tip);
  let owner: object | null = null;

  /** Puts the tip at the pointer (client coordinates), kept on the stage. */
  const place = (clientX: number, clientY: number) => {
    const r = layer.getBoundingClientRect();
    const scale = r.width / STAGE_W || 1;
    const x = (clientX - r.left) / scale;
    const y = (clientY - r.top) / scale;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(0, Math.min(x + TIP_DX, STAGE_W - w));
    const top = y + TIP_DY + h > STAGE_H ? y - h - TIP_FLIP_GAP : y + TIP_DY;
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(Math.max(0, top))}px`;
  };
  const hide = () => {
    owner = null;
    tip.hidden = true;
  };
  /** What the tip shows now, to skip rebuilding it on every move. */
  let shown = "";
  const render = (value: Exclude<TipText, null>) => {
    if (isKeyedTip(value)) {
      const shortcut = value.shortcut?.trim() ?? "";
      const key = shortcut ? `k:${value.label}\u0000${shortcut}` : value.label;
      if (key === shown) {
        return;
      }
      shown = key;
      if (!shortcut) {
        tip.textContent = value.label;
        return;
      }
      const badge = document.createElement("span");
      badge.className = "hover-tip-key";
      badge.textContent = shortcut;
      tip.replaceChildren(document.createTextNode(value.label), badge);
      return;
    }
    const lines = typeof value === "string" ? [value] : value;
    const key = lines.join("\n");
    if (key === shown) {
      return;
    }
    shown = key;
    if (lines.length === 1) {
      tip.textContent = lines[0] ?? "";
      return;
    }
    tip.replaceChildren(
      ...lines.map((line, i) => {
        const row = document.createElement("div");
        row.className = i === 0 ? "hover-tip-first" : "hover-tip-more";
        row.textContent = line;
        return row;
      }),
    );
  };
  const show = (who: object, text: TipText, clientX: number, clientY: number) => {
    const empty =
      text === null ||
      (typeof text === "string" && text === "") ||
      (Array.isArray(text) && (text.length === 0 || !text[0])) ||
      (isKeyedTip(text) && text.label === "");
    if (empty || tips.blocked()) {
      if (owner === who) {
        hide();
      }
      return;
    }
    owner = who;
    render(text);
    tip.hidden = false;
    place(clientX, clientY);
  };

  const tips: HoverTips = {
    el: tip,
    blocked: () => false,
    setLarge(on) {
      tip.classList.toggle("hover-tip-large", on);
    },
    attach(target, text) {
      const read = () => (typeof text === "function" ? text() : text);
      const move = (e: PointerEvent) => {
        if (e.pointerType === "mouse") {
          show(target, read(), e.clientX, e.clientY);
        }
      };
      target.addEventListener("pointerenter", move);
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerleave", () => tips.release(target));
      // A press acts on the control (opens a menu, starts a drag); the tip gets out of the way.
      target.addEventListener("pointerdown", () => tips.release(target));
    },
    showFor: show,
    release(who) {
      if (owner === who) {
        hide();
      }
    },
    hide,
  };
  return tips;
}
