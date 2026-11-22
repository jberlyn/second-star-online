/**
 * The HP, SP and XP bars. 1.6 had no XP bar (XP showed only as the level-up line) and a power bar
 * in the third slot; SSO has no power bar and shows XP there instead.
 *
 * The wooden slots of Internal #186 are stage x 600-789, five pixels tall: HP at y 70-74, SP at
 * y 85-89 and the third (1.6's power bar) at y 101-105. SSO fills each slot from its left edge by
 * the percentage of the maximum, so full HP or SP fills the slot whether the maximum is 20 or
 * 1000. The HP and SP fill sprites are the original 205 px art, clipped to the 189 px slot; the
 * XP fill is flat green toward the next level. The depleted part of a slot is plain black rather
 * than 1.6's darker track sprites.
 *
 * Hovering any bar shows all three values at once, each centred on its own bar: `15 / 20 HP`,
 * `20 / 20 SP` and `1,240 / 2,000 XP`. Aboard a vehicle the HP bar shows its hull instead.
 *
 * Player Settings adds an optional colour-blind palette (Amber/Gold HP + Sky-Cyan SP over black,
 * `.bars-colorblind`) in the same slot geometry.
 *
 * The box below covers stage x 590-800, y 60-110; children use stage coordinates minus that
 * origin. The box sits at its stage rect.
 */
import type { VitalsView } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import { artImg } from "./stage.ts";

export const BARS_RECT = { x: 590, y: 60, w: 210, h: 50 } as const;
/** The transparent HP/SP slot of Internal #186: stage x 600-789, 189 px wide. */
const SLOT_X = 600;
const SLOT_W = 189;
const HP_TRACK_Y = 67;
const SP_TRACK_Y = 84;
/** The third slot shows y 101–105, with a pixel behind the bezel on either side. */
const XP_TRACK_Y = 100;
const XP_TRACK_H = 7;
const HP_HOVER_Y = 66;
const SP_HOVER_Y = 81;
const XP_HOVER_Y = 96;
const OX = BARS_RECT.x;
const OY = BARS_RECT.y;

export interface BarsOptions {
  colorblind: boolean;
}

export interface Bars {
  el: HTMLElement;
  setVitals(v: VitalsView): void;
  reset(): void;
  setOptions(opts: BarsOptions): void;
}

function at(el: HTMLElement, x: number, y: number, z: number): void {
  el.style.position = "absolute";
  el.style.left = `${x - OX}px`;
  el.style.top = `${y - OY}px`;
  el.style.zIndex = String(z);
}

function box(el: HTMLElement, x: number, y: number, w: number, h: number, z: number): void {
  at(el, x, y, z);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.overflow = "hidden";
}

/** A number with thousands separators: 1,240. */
export function grouped(n: number): string {
  return Math.trunc(n).toLocaleString("en-US");
}

/** A bar's slot width in pixels for a value, as a percentage of its maximum. */
function fillWidth(value: number, max: number): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return `${Math.round(ratio * SLOT_W * 100) / 100}px`;
}

export function createBars(a: Assets): Bars {
  const el = document.createElement("div");
  el.className = "bars";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Hit points, spell points and experience");
  const img = (n: number) => artImg(a.ui("internal", n));
  // Score channels: 38/39 tracks, 62/64 fills; the XP track and fill take 1.6's power bar
  // channels (36, 63).
  const hpFill = img(151);
  hpFill.classList.add("bar-fill-img");
  const spFill = img(153);
  spFill.classList.add("bar-fill-img");
  const track = (cls: string, y: number, h: number, z: number) => {
    const b = document.createElement("div");
    b.className = `bar-track ${cls}`;
    box(b, SLOT_X, y, SLOT_W, h, z);
    return b;
  };
  const fill = (cls: string, art: HTMLImageElement | null, y: number, h: number, z: number) => {
    const b = document.createElement("div");
    b.className = `bar-fill ${cls}`;
    box(b, SLOT_X, y, SLOT_W, h, z);
    b.style.width = "0px";
    if (art) {
      b.append(art);
    }
    return b;
  };
  const field = (cls: string) => {
    const f = document.createElement("span");
    f.className = `bar-value ${cls}`;
    f.setAttribute("aria-hidden", "true");
    return f;
  };
  const clearHover = () => el.classList.remove("bars-show-values");
  const hover = (cls: string, y: number, hgt: number, label: HTMLElement) => {
    const h = action(document.createElement("div"), "bars-show-values");
    h.className = `bar-hover ${cls}`;
    at(h, SLOT_X, y, 321);
    h.style.width = `${SLOT_W}px`;
    h.style.height = `${hgt}px`;
    h.append(label);
    h.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") {
        el.classList.add("bars-show-values");
      }
    });
    h.addEventListener("pointerleave", (event) => {
      const next = event.relatedTarget;
      if (!(next instanceof Element && next.parentElement === el && next.matches(".bar-hover"))) {
        clearHover();
      }
    });
    h.addEventListener("pointercancel", clearHover);
    return h;
  };
  const hpText = field("hp-value");
  const spText = field("sp-value");
  const xpText = field("xp-value");
  const hpFillBox = fill("hp-fill", hpFill, HP_TRACK_Y, 8, 62);
  const spFillBox = fill("sp-fill", spFill, SP_TRACK_Y, 9, 64);
  const xpFillBox = fill("xp-fill", null, XP_TRACK_Y, XP_TRACK_H, 63);
  el.append(
    track("hp-track", HP_TRACK_Y, 8, 38),
    track("sp-track", SP_TRACK_Y, 9, 39),
    track("xp-track", XP_TRACK_Y, XP_TRACK_H, 36),
    hpFillBox,
    spFillBox,
    xpFillBox,
    hover("hp-hover", HP_HOVER_Y, 15, hpText),
    hover("sp-hover", SP_HOVER_Y, 15, spText),
    hover("xp-hover", XP_HOVER_Y, 14, xpText),
  );
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.setAttribute("aria-live", "polite");
  el.append(sr);

  return {
    el,
    reset() {
      clearHover();
      for (const fill of [hpFillBox, spFillBox, xpFillBox]) {
        fill.style.width = "0px";
      }
      for (const value of [hpText, spText, xpText, sr]) {
        value.textContent = "";
      }
    },
    setVitals(v) {
      // Aboard a vehicle the HP bar shows its hull, which hits wear instead of HP.
      const hull = v.hull;
      hpFillBox.style.width = hull ? fillWidth(hull.hp, hull.max) : fillWidth(v.hp, v.hpMax);
      spFillBox.style.width = fillWidth(v.sp, v.spMax);
      // XP is held toward the next level, so the bar empties on a level-up. A value at or past
      // the destination (data saved before a level check ran) shows full; there is no level cap.
      xpFillBox.style.width = fillWidth(v.exp, v.expNeeded);
      hpText.textContent = hull
        ? `Hull ${grouped(hull.hp)} / ${grouped(hull.max)}`
        : `${grouped(v.hp)} / ${grouped(v.hpMax)} HP`;
      spText.textContent = `${grouped(v.sp)} / ${grouped(v.spMax)} SP`;
      xpText.textContent = `${grouped(v.exp)} / ${grouped(v.expNeeded)} XP`;
      const first = hull ? `Hull ${hull.hp} of ${hull.max}` : `HP ${v.hp} of ${v.hpMax}`;
      sr.textContent = `${first}, SP ${v.sp} of ${v.spMax}, level ${v.level}, XP ${v.exp} of ${v.expNeeded}`;
    },
    setOptions(opts) {
      el.classList.toggle("bars-colorblind", opts.colorblind);
    },
  };
}
