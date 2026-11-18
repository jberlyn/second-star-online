/**
 * Client: the Guild Center (frame 72). Rects are checked against the shipped layout data's
 * frame-72.json.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import type { GuildAlignment } from "@secondstaronline/shared";

import type { Assets } from "../src/assets.ts";
import type { Sfx } from "../src/sfx.ts";
import { createGuildCenter, GUILD_ORIGIN, GUILD_RECTS } from "../src/ui/guildcenter.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

function center() {
  const sent: unknown[] = [];
  const sounds: Sfx[] = [];
  const gc = createGuildCenter(fakeAssets, {
    create: (name: string, alignment: GuildAlignment) => sent.push(["create", name, alignment]),
    close: () => sent.push(["close"]),
    view: (name: string) => sent.push(["view", name]),
    act: (act, viewing, member) => sent.push(["act", act, viewing, member]),
    sound: (s) => sounds.push(s),
  });
  document.body.replaceChildren(gc.el);
  const by = <T extends HTMLElement>(label: string) =>
    [...gc.el.querySelectorAll<T>(`[aria-label="${label}"]`)].find((e) => !e.hidden) as T;
  const rows = (label: string) => [...by(label).querySelectorAll<HTMLElement>(".gc-row")];
  return { gc, sent, sounds, by, rows };
}

const FRAME = JSON.parse(
  readFileSync(join(import.meta.dir, "../../../assets/original/main/layout/frame-72.json"), "utf8"),
) as { sprites: { channel: number; rect: number[] }[] };
const rectOf = (ch: number) => FRAME.sprites.find((s) => s.channel === ch)?.rect;
const asRect = (r: { x: number; y: number; w: number; h: number }) => [
  r.x,
  r.y,
  r.x + r.w,
  r.y + r.h,
];

describe("placement", () => {
  test("every bitmap sits at its sprite's rect", () => {
    const pairs: [keyof typeof GUILD_RECTS, number][] = [
      ["createArt", 310],
      ["cancel", 311],
      ["create", 312],
      ["good", 313],
      ["neutral", 314],
      ["evil", 315],
      ["guildArt", 320],
      ["shownGood", 322],
      ["shownNeutral", 323],
      ["shownEvil", 324],
      ["ok", 327],
      ["leave", 328],
      ["disband", 329],
      ["exile", 330],
      ["abdicate", 331],
      ["listArt", 71],
      ["list", 72],
    ];
    for (const [k, ch] of pairs) {
      expect([k, asRect(GUILD_RECTS[k])]).toEqual([k, rectOf(ch) as number[]]);
    }
    expect(GUILD_ORIGIN).toEqual({ x: 151, y: 29 });
  });
});

describe("modes", () => {
  test("create: the creator, Good selected, the field keeping its text", () => {
    const { gc, by } = center();
    gc.show({ mode: "create" });
    expect(by<HTMLInputElement>("Guild name").value).toBe("Super Guild Guys ");
    expect(by("Good").getAttribute("aria-pressed")).toBe("true");
    by("Evil").click();
    expect(by("Evil").getAttribute("aria-pressed")).toBe("true");
    expect(by("Good").getAttribute("aria-pressed")).toBe("false");
    // A new opening starts on Good again.
    gc.show({ mode: "create" });
    expect(by("Good").getAttribute("aria-pressed")).toBe("true");
  });

  test("OK sends the field and the alignment and leaves the screen up", () => {
    const { gc, by, sent } = center();
    gc.show({ mode: "create" });
    by<HTMLInputElement>("Guild name").value = "Knights";
    by("Neutral").click();
    by("OK").click();
    expect(sent).toEqual([["create", "Knights", "N"]]);
    expect(gc.isOpen).toBe(true);
  });

  test("member: Leave, no leader buttons; leader: Disband, Exile, Abdicate, no Leave", () => {
    const { gc, by } = center();
    const s = { name: "Knights", alignment: "G" as const, leader: "Al", members: ["Bo", "Cy"] };
    gc.show({ mode: "member", ...s });
    expect(by("Leave guild")).toBeDefined();
    expect(by("Disband")).toBeUndefined();
    gc.show({ mode: "leader", ...s });
    expect(by("Leave guild")).toBeUndefined();
    expect(by("Disband")).toBeDefined();
    expect(by("Exile")).toBeDefined();
    expect(by("Abdicate")).toBeDefined();
  });
});

describe("the members list, exile and abdicate", () => {
  const leader = () => {
    const c = center();
    c.gc.show({
      mode: "leader",
      name: "Knights",
      alignment: "G",
      leader: "Al",
      members: ["Bo", "Cy"],
    });
    return c;
  };

  test("exile needs a selection; the line goes from the list at once", () => {
    const { by, rows, sent } = leader();
    by("Exile").click();
    expect(sent).toEqual([]);
    rows("Guild members")[0]?.click();
    by("Exile").click();
    expect(sent).toEqual([["act", "exile", "Knights", "Bo"]]);
    expect(rows("Guild members").map((r) => r.textContent)).toEqual(["Cy"]);
  });

  test("bug fixed: an exile clears the selection, so Abdicate cannot crown the exiled member", () => {
    const { by, rows, sent } = leader();
    rows("Guild members")[0]?.click();
    by("Exile").click();
    by("Abdicate").click();
    expect(sent).toEqual([["act", "exile", "Knights", "Bo"]]);
    rows("Guild members")[0]?.click();
    by("Abdicate").click();
    expect(sent.at(-1)).toEqual(["act", "abdicate", "Knights", "Cy"]);
  });

  test("bug fixed: a redrawn screen clears the selection", () => {
    const { gc, by, rows, sent } = leader();
    rows("Guild members")[0]?.click();
    gc.view({ name: "Knights", alignment: "G", leader: "Al", members: ["Bo", "Cy"] });
    by("Abdicate").click();
    expect(sent).toEqual([]);
  });

  test("another guild on screen: the action is sent for the server's line, the screen stays", () => {
    const { gc, by, sent } = leader();
    gc.view({ name: "Rogues", alignment: "E", leader: "Dee", members: [] });
    by("Disband").click();
    expect(sent).toEqual([["act", "disband", "Rogues", undefined]]);
    expect(gc.isOpen).toBe(true);
  });

  test("Disband on your own guild closes the screen", () => {
    const { gc, by } = leader();
    by("Disband").click();
    expect(gc.isOpen).toBe(false);
  });
});

describe("the guild list", () => {
  test("the arrow opens it; each line click plays Clicksound2, an empty one too; OK views", () => {
    const { gc, by, rows, sounds, sent } = center();
    gc.show({ mode: "member", name: "Knights", alignment: "G", leader: "Al", members: [] });
    gc.setList(["Knights", "Rogues"]);
    expect(by("Guilds")).toBeUndefined();
    by("Guild list").click();
    rows("Guilds")[1]?.click();
    by("Guilds").click(); // below the last line
    expect(sounds.map((s) => s.name)).toEqual(["Clicksound2", "Clicksound2"]);
    rows("Guilds")[1]?.click();
    const ok = [...gc.el.querySelectorAll<HTMLElement>('[aria-label="OK"]')].find(
      (e) => !e.hidden && e.dataset.action === "guild-list-open",
    );
    ok?.click();
    expect(sent).toEqual([["view", "Rogues"]]);
    expect(by("Guilds")).toBeUndefined();
  });

  test("a view with no alignment leaves the buttons as they were", () => {
    const { gc } = center();
    gc.show({ mode: "member", name: "Knights", alignment: "E", leader: "Al", members: [] });
    const evil = () =>
      [...gc.el.querySelectorAll<HTMLImageElement>("img.gc-art")].find((i) => i.alt === "Evil");
    expect(evil()?.src).toContain("internal-281");
    gc.view({ name: "Gone", alignment: null, leader: "", members: [] });
    expect(evil()?.src).toContain("internal-281");
  });
});
