/**
 * Client tests: the Spellbook page (frame 67), spell FX, bodies and floaties in the model, and
 * the spell sounds.
 */
import { describe, expect, test } from "bun:test";

import type { AssetIndex } from "@secondstaronline/data";
import { CANNON_FIRE_ANIM, NO_EQUIPMENT, NO_FOG } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import { playAll } from "../src/audio.ts";
import { applyDelta, clientTick, createModel, type Peer } from "../src/model.ts";
import { createPlayfield, shownFrame } from "../src/playfield.ts";
import { type Sfx, SOUND, spellSounds } from "../src/sfx.ts";
import { createSpellbook, spellInfo } from "../src/ui/spellbook.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast}-${member}.png`,
  hash: null,
  reload: async () => [],
  onReload: () => {},
};

function book() {
  const sounds: Sfx[] = [];
  const said: string[] = [];
  const sb = createSpellbook(fakeAssets, {
    sound: (s) => sounds.push(s),
    say: (t) => said.push(t),
  });
  document.body.append(sb.page);
  return { sb, sounds, said };
}

const line = (sb: ReturnType<typeof book>["sb"], n: number) =>
  sb.page.querySelectorAll<HTMLElement>(".spell-line")[n - 1] as HTMLElement;

describe("the Spellbook page (frame 67)", () => {
  test("clicking a line selects it, with Clicksound2 on 3", () => {
    const { sb, sounds } = book();
    sb.setSpells(["Fireball", "Minor Heal"]);
    line(sb, 2).click();
    expect(sb.selected).toBe("Minor Heal");
    expect(sounds).toEqual([SOUND.click]);
    expect(line(sb, 2).classList.contains("selected")).toBe(true);
  });
  test("bug fixed: a click keeps the list as it is, a learned Identify included", () => {
    const { sb } = book();
    sb.setSpells(["Fireball", "Identify", "Hold"]);
    line(sb, 2).click();
    expect(sb.selected).toBe("Identify");
    expect([...sb.page.querySelectorAll(".spell-line")].map((l) => l.textContent)).toEqual([
      "Fireball",
      "Identify",
      "Hold",
    ]);
  });
  test("the cast button arms only with a spell selected, but clicks either way", () => {
    const { sb, sounds } = book();
    sb.setSpells(["Fireball"]);
    sb.pressCast();
    expect(sb.armed).toBe(false);
    expect(sounds).toEqual([SOUND.click]);
    line(sb, 1).click();
    sb.pressCast();
    expect(sb.armed).toBe(true);
    sb.pressCast(); // member 205 disarms
    expect(sb.armed).toBe(false);
  });
  test("the list box leaves the field 164 px of text and room for the bar at x 775-790", () => {
    const { sb } = book();
    const list = sb.page.querySelector(".spell-list") as HTMLElement;
    // 608 - 566 (panel x) = 42; 164 field + 3 gap + 16 bar = 183, so the box ends at stage x 791.
    expect([list.style.left, list.style.width]).toEqual(["42px", "183px"]);
    expect(list.classList.contains("director-scroll")).toBe(true);
    sb.setSpells(["Fireball"]);
    line(sb, 1).click();
    // A click in the gap beside the field (outside the 1.6 sprite) leaves the selection alone.
    const gap = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(gap, "offsetX", { value: 170 });
    list.dispatchEvent(gap);
    expect(sb.selected).toBe("Fireball");
  });
  test("selecting an empty line keeps the cursor armed with nothing selected", () => {
    const { sb } = book();
    sb.setSpells(["Fireball"]);
    line(sb, 1).click();
    sb.pressCast();
    (sb.page.querySelector(".spell-list") as HTMLElement).click();
    expect([sb.armed, sb.selected]).toEqual([true, ""]);
  });
  test("Info prints the selected spell's line, typos kept; none for Poison Dart", () => {
    const { sb, said } = book();
    sb.setSpells(["Firebolt", "Poison Dart"]);
    line(sb, 1).click();
    (sb.page.querySelector(".spell-info") as HTMLElement).click();
    line(sb, 2).click();
    (sb.page.querySelector(".spell-info") as HTMLElement).click();
    expect(said).toEqual(["Fry your oppoent with this deadly bolt of flames."]);
    expect(spellInfo("wind wave")).toBe("This wind blast will definately hurt your foes.");
  });
  test("Info and the cast button are unstretched, side by side at their members' sizes (frame-67.json channels 43, 44)", () => {
    const { sb } = book();
    const box = (sel: string) => {
      const s = (sb.page.querySelector(sel) as HTMLElement).style;
      return [s.left, s.top, s.width, s.height];
    };
    // Stage x less the panel's 566.
    expect(box(".spell-info")).toEqual(["48px", "300px", "14px", "17px"]);
    expect(box(".spell-cast")).toEqual(["69px", "295px", "32px", "27px"]);
    sb.setSpells(["Fireball"]);
    line(sb, 1).click();
    sb.pressCast();
    // Armed: member 205 (14×15, reg 7, 7) on the same loc (651, 308).
    expect(box(".spell-cast")).toEqual(["78px", "301px", "14px", "15px"]);
  });
});

describe("spell FX, bodies and floaties in the model", () => {
  test("an fx event places the FX, plays its sound on 4 and the caster's cast frame; the model steps it", () => {
    const m = createModel();
    m.self = null;
    applyDelta(m, [{ e: "fx", slot: 1, name: "Minor Heal", h: 200, v: 150 }]);
    expect(m.sounds).toEqual([{ name: "fx2", ch: 4 }]);
    // The FX actor runs two calls a tick, so the 6 calls take 3 ticks.
    for (let i = 0; i < 3; i++) {
      clientTick(m, { held: null, turn: false, pending: null });
    }
    expect(m.fx[0]?.frame).toBe(7);
    clientTick(m, { held: null, turn: false, pending: null });
    expect(m.fx).toEqual([]);
  });
  test("SSO: a cannonball shot plays cannonball on 4, shows the rider's firing frames and stops on fxend", () => {
    const m = createModel();
    m.self = null;
    m.peers.set("ann", {
      id: "ann",
      name: "Ann",
      head: 1,
      x: 8,
      y: 5,
      facing: "E",
      frames: 0,
      atkAnim: 0,
      spellAnim: 0,
      body: 56,
      equip: NO_EQUIPMENT,
    } as unknown as Peer);
    m.walkAir = Array.from({ length: 12 }, () => Array(17).fill(true));
    applyDelta(m, [{ e: "fx", slot: 2, name: "CannonballShotR", h: 318, v: 157, caster: "ann" }]);
    expect(m.sounds).toEqual([{ name: "cannonball", ch: 4 }]);
    const ann = m.peers.get("ann") as Peer;
    expect(ann.spellAnim).toBe(CANNON_FIRE_ANIM);
    expect(shownFrame(m, 56, "E", 0, ann.spellAnim, 0)).toBe("fire1");
    expect(shownFrame(m, 56, "E", 0, 1, 0)).toBe("fire3");
    // A walker's cast still shows the attack frame.
    expect(shownFrame(m, null, "E", 0, 3, 0)).toBe("F4");
    clientTick(m, { held: null, turn: false, pending: null });
    expect(m.fx[0]?.h).toBe(328);
    // Another FX in another slot is left alone.
    applyDelta(m, [{ e: "fx", slot: 1, name: "Minor Heal", h: 200, v: 150 }]);
    applyDelta(m, [{ e: "fxend", slot: 2, name: "CannonballShotR" }]);
    expect(m.fx.map((f) => f.name)).toEqual(["Minor Heal"]);
  });
  test("SSO: the client stops a shot over a tile an Airship cannot cross", () => {
    const m = createModel();
    m.self = null;
    m.walkAir = Array.from({ length: 12 }, () => Array.from({ length: 17 }, (_, x) => x + 1 < 10));
    applyDelta(m, [{ e: "fx", slot: 1, name: "CannonballShotR", h: 270, v: 157 }]);
    for (let i = 0; i < 20 && m.fx.length > 0; i++) {
      clientTick(m, { held: null, turn: false, pending: null });
    }
    expect(m.fx).toEqual([]);
  });
  test("a new FX in a slot replaces the old one", () => {
    const m = createModel();
    applyDelta(m, [
      { e: "fx", slot: 1, name: "Splash", h: 100, v: -10 },
      { e: "fx", slot: 1, name: "Hold", h: 100, v: 100 },
    ]);
    expect(m.fx.map((f) => f.name)).toEqual(["Hold"]);
  });
  test("a spell kill: the number and splat first, then kill1 and fx on 1", () => {
    const m = createModel();
    m.monsters.set(1, {
      slot: 1,
      name: "Slime",
      body: 30,
      x: 3,
      y: 3,
      facing: "S",
      frames: 0,
      fromX: 3,
      fromY: 3,
    });
    applyDelta(m, [{ e: "mspell", slot: 1, text: "8", color: 124, splat: true, kill: true }]);
    expect(m.sounds).toEqual([SOUND.floatieHit, SOUND.spellKill]);
    expect(m.effects.map((e) => e.kind)).toEqual(["splat", "kill"]);
    expect(m.floaties.map((f) => f.text)).toEqual(["8"]);
    expect(m.monsters.size).toBe(0);
  });
  test("a monster heal is silent with no splat, colour 46", () => {
    const m = createModel();
    m.monsters.set(1, {
      slot: 1,
      name: "Slime",
      body: 30,
      x: 3,
      y: 3,
      facing: "S",
      frames: 0,
      fromX: 3,
      fromY: 3,
    });
    applyDelta(m, [{ e: "mspell", slot: 1, text: "9", color: 46, splat: false, kill: false }]);
    expect(m.sounds).toEqual([]);
    expect(m.floaties[0]?.color).toBe(46);
  });
});

describe("spell sounds", () => {
  test("Portal plays heal2 on 4 and heal1 on 3; bolts lightning; arrows nothing", () => {
    expect(spellSounds("Portal")).toEqual([
      { name: "heal2", ch: 4 },
      { name: "heal1", ch: 3 },
    ]);
    expect(spellSounds("BoltD")).toEqual([{ name: "lightning", ch: 4 }]);
    expect(spellSounds("Blue ArrowsL")).toEqual([]);
    expect(spellSounds("Bless")).toEqual([]);
    // The puff `xSmokeoBomb` does not contain "Smoke Bomb" (no space): silent.
    expect(spellSounds("xSmokeoBomb")).toEqual([]);
    expect(spellSounds("Smoke Bomb")).toEqual([{ name: "fireballs", ch: 4 }]);
  });
});

describe("the church bell", () => {
  test("the church bell's sound carries its own volume, 200, to play", () => {
    const calls: string[] = [];
    const audio = {
      play: (s: Sfx) => calls.push(`play ${s.name} ${s.ch} ${s.volume ?? "channel"}`),
    };
    playAll(audio, [{ name: "churchy", ch: 5, volume: 200 }, SOUND.floatieHit]);
    expect(calls).toEqual(["play churchy 5 200", "play hitsound 5 channel"]);
  });
});

describe("trails", () => {
  test('Smoke Bomb draws its trail "xSmoke Bomb-<n>" over the FX for frames 1-15', () => {
    // happy-dom has no 2D context: a stub that accepts every call, so `draw` runs.
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : () => undefined),
      set: (t, k, v) => {
        t[k] = v;
        return true;
      },
    });
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
    try {
      const drawn: string[] = [];
      const assets: Assets = {
        ...fakeAssets,
        sprite: (group, name) => {
          if (group === "fx") {
            drawn.push(name);
          }
          return undefined;
        },
      };
      const pf = createPlayfield(assets);
      const m = createModel();
      const row = Array(17).fill("G1").join(" ");
      const rows = Array<string>(12).fill(row);
      m.map = {
        name: "x1y1",
        title: "",
        layers: [rows, rows, rows, rows],
        signs: ["", "", ""],
        fog: NO_FOG,
      };
      const at = (name: string, frame: number) => {
        drawn.length = 0;
        m.fx = [{ slot: 1, name, frame, h: 200, v: 150, gone: false }];
        pf.draw(m);
        return [...drawn];
      };
      expect(at("Smoke Bomb", 1)).toEqual(["Smoke Bomb-1", "xSmoke Bomb-1"]);
      expect(at("Smoke Bomb", 15)).toEqual(["Smoke Bomb-15", "xSmoke Bomb-15"]);
      // The puff after the counter is not a trail spell.
      expect(at("xSmokeoBomb", 3)).toEqual(["xSmokeoBomb-3"]);
    } finally {
      HTMLCanvasElement.prototype.getContext = real;
    }
  });
});
