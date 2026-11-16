/**
 * The HP, SP and power bars. 1.6 had no XP bar: XP shows only as the
 * level-up line.
 *
 * The original's bar loader slides 205 px bars (registration point x 81) leftward from the
 * stage's right edge: the track at horizontal position `871 − min(max, 200)`, the fill at
 * `871 − min(value, 200)`, so `value + 10` px show inside the 800 px stage. Current HP and SP ride
 * the fill's left end in two number fields (Internal #216/#217, Arial 10 bold white, right
 * aligned, 102 px left of the fill). The power bar (sprite 63) starts at horizontal position 874
 * and moves 2 px left per point over its track (Internal #169 at 677, 101); its member shows the
 * tier (Internal #473 none, #472 +3, #474 +5, #475 +7), drawn at 50 % (ink 32, blend 127).
 *
 * The box below covers stage x 590-800, y 60-110; children use stage coordinates minus that
 * origin. The box sits at its stage rect.
 */
import type { BarMember, VitalsView } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { artImg } from "./stage.ts";

export const BARS_RECT = { x: 590, y: 60, w: 210, h: 50 } as const;
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
  const field = (cls: string) => {
    const f = document.createElement("span");
    f.className = `bar-value ${cls}`;
    return f;
  };
  const hpText = field("hp-value");
  const spText = field("sp-value");
  at(powerTrack, 677 - 81, 101 - 2, 36);
  el.append(hpTrack, spTrack, hpFill, spFill, powerTrack, power, hpText, spText);
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
      const cap = (n: number) => Math.min(n, 200);
      at(hpTrack, 871 - cap(v.hpMax) - 81, 68 - 1, 38);
      at(spTrack, 871 - cap(v.spMax) - 81, 86 - 2, 39);
      at(hpFill, 871 - cap(v.hp) - 81, 68 - 1, 62);
      at(spFill, 871 - cap(v.sp) - 81, 86 - 2, 64);
      hpText.textContent = String(v.hp);
      spText.textContent = String(v.sp);
      at(hpText, 871 - cap(v.hp) - 102, 67, 318);
      at(spText, 871 - cap(v.sp) - 102, 82, 319);
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
