/**
 * The HP, SP and power bars. 1.6 had no XP bar: XP shows only as the level-up line.
 *
 * The wooden slots of Internal #186 are stage x 600-789, five pixels tall: HP at y 70-74 and SP
 * at y 85-89. SSO keeps that slot geometry but fills each HP and SP slot from its left edge by
 * the percentage of the maximum, so full HP or SP fills the slot whether the maximum is 20 or
 * 1000. The track and fill sprites are still the original 205 px art, clipped to the 189 px slot.
 * The hover field shows `current / max` centred on the bar.
 *
 * The power bar keeps 1.6's loader: sprite 63 starts at horizontal position 874 and moves 2 px
 * left per point over its track (Internal #169 at 677, 101); its member shows the tier
 * (Internal #473 none, #472 +3, #474 +5, #475 +7), drawn at 50 % (ink 32, blend 127).
 *
 * The box below covers stage x 590-800, y 60-110; children use stage coordinates minus that
 * origin. The box sits at its stage rect.
 */
import type { BarMember, VitalsView } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { artImg } from "./stage.ts";

export const BARS_RECT = { x: 590, y: 60, w: 210, h: 50 } as const;
/** The transparent HP/SP slot of Internal #186: stage x 600-789, 189 px wide. */
const SLOT_X = 600;
const SLOT_W = 189;
const HP_TRACK_Y = 67;
const SP_TRACK_Y = 84;
const HP_HOVER_Y = 66;
const SP_HOVER_Y = 81;
const OX = BARS_RECT.x;
const OY = BARS_RECT.y;

export interface Bars {
  el: HTMLElement;
  setVitals(v: VitalsView): void;
  setPower(bar: number, member: BarMember): void;
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

/** A bar's slot width in pixels for a value, as a percentage of its maximum. */
function fillWidth(value: number, max: number): string {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return `${Math.round(ratio * SLOT_W * 100) / 100}px`;
}

export function createBars(a: Assets): Bars {
  const el = document.createElement("div");
  el.className = "bars";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Hit points, spell points and attack power");
  const img = (n: number) => artImg(a.ui("internal", n));
  // Score channels: 36 power track, 38/39 tracks, 62/63/64 fills, 318/319 numbers.
  const hpTrack = img(150);
  const hpFill = img(151);
  const spTrack = img(152);
  const spFill = img(153);
  const powerTrack = img(169);
  const power = img(473);
  power.style.opacity = "0.5";
  const track = (cls: string, art: HTMLImageElement, y: number, h: number, z: number) => {
    const b = document.createElement("div");
    b.className = `bar-track ${cls}`;
    box(b, SLOT_X, y, SLOT_W, h, z);
    b.append(art);
    return b;
  };
  const fill = (cls: string, art: HTMLImageElement, y: number, h: number, z: number) => {
    const b = document.createElement("div");
    b.className = `bar-fill ${cls}`;
    box(b, SLOT_X, y, SLOT_W, h, z);
    b.style.width = "0px";
    b.append(art);
    return b;
  };
  const field = (cls: string) => {
    const f = document.createElement("span");
    f.className = `bar-value ${cls}`;
    f.setAttribute("aria-hidden", "true");
    return f;
  };
  const hover = (cls: string, y: number, label: HTMLElement) => {
    const h = document.createElement("div");
    h.className = `bar-hover ${cls}`;
    at(h, SLOT_X, y, 321);
    h.style.width = `${SLOT_W}px`;
    h.style.height = "14px";
    h.append(label);
    return h;
  };
  const hpText = field("hp-value");
  const spText = field("sp-value");
  const hpTrackBox = track("hp-track", hpTrack, HP_TRACK_Y, 8, 38);
  const spTrackBox = track("sp-track", spTrack, SP_TRACK_Y, 9, 39);
  const hpFillBox = fill("hp-fill", hpFill, HP_TRACK_Y, 8, 62);
  const spFillBox = fill("sp-fill", spFill, SP_TRACK_Y, 9, 64);
  at(powerTrack, 677 - 81, 101 - 2, 36);
  el.append(
    hpTrackBox,
    spTrackBox,
    hpFillBox,
    spFillBox,
    powerTrack,
    power,
    hover("hp-hover", HP_HOVER_Y, hpText),
    hover("sp-hover", SP_HOVER_Y, spText),
  );
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.setAttribute("aria-live", "polite");
  el.append(sr);
  const members: Record<BarMember, string> = {
    473: a.ui("internal", 473),
    472: a.ui("internal", 472),
    474: a.ui("internal", 474),
    475: a.ui("internal", 475),
  };
  let shown: BarMember = 473;
  const bars: Bars = {
    el,
    setVitals(v) {
      hpFillBox.style.width = fillWidth(v.hp, v.hpMax);
      spFillBox.style.width = fillWidth(v.sp, v.spMax);
      hpText.textContent = `${v.hp} / ${v.hpMax}`;
      spText.textContent = `${v.sp} / ${v.spMax}`;
      sr.textContent = `HP ${v.hp} of ${v.hpMax}, SP ${v.sp} of ${v.spMax}, level ${v.level}`;
    },
    setPower(bar, member) {
      at(power, 874 - 2 * bar - 81, 101 - 2, 63);
      if (member !== shown) {
        shown = member;
        power.src = members[member];
      }
    },
  };
  bars.setPower(0, 473);
  return bars;
}
