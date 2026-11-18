/**
 * The Friends window and the Bio window's player layouts, placed from the shipped layout data's
 * sub-movie frame-1.json and score-spans.jsonl.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { AssetIndex } from "@secondstaronline/data";
import { socialData } from "@secondstaronline/data";

import type { Assets } from "../src/assets.ts";
import { createBioWindow } from "../src/ui/bio.ts";
import { createFriendsWindow, FRIENDS_RECTS } from "../src/ui/friends.ts";
import type { Rect } from "../src/ui/im.ts";
import { createWhoWindow } from "../src/ui/who.ts";
import { createWindowLayer } from "../src/ui/window.ts";

const fakeAssets: Assets = {
  index: { version: 1, inputHash: "", atlases: {} as AssetIndex["atlases"], ui: {}, sounds: {} },
  sheets: {},
  loadGroup: async () => {},
  sprite: () => undefined,
  ui: (cast, member) => `/assets/ui/${cast.toLowerCase()}-${member}.png`,
};

const SUB = join(import.meta.dir, "../../../assets/original/sub");
const asRect = (r: Rect) => [r.x, r.y, r.x + r.w, r.y + r.h];
const rectOf = (movie: string, ch: number) =>
  (
    JSON.parse(readFileSync(join(SUB, movie, "layout", "frame-1.json"), "utf8")) as {
      sprites: { channel: number; rect: number[] }[];
    }
  ).sprites.find((s) => s.channel === ch)?.rect;
const stretchedOf = (movie: string, ch: number) => {
  const span = readFileSync(join(SUB, movie, "layout", "score-spans.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(
      (l) => JSON.parse(l) as { channel: number; frames: number[]; loc: number[]; size: number[] },
    )
    .find((s) => s.channel === ch && s.frames[0] === 2);
  if (!span) {
    throw new Error(`${movie} channel ${ch}`);
  }
  const [x, y] = span.loc as [number, number];
  const [w, h] = span.size as [number, number];
  return [x, y, x + w, y + h];
};

function friendsScene() {
  const layer = createWindowLayer();
  document.body.append(layer.el);
  const calls: string[] = [];
  const w = createFriendsWindow(fakeAssets, layer, {
    remove: (n) => calls.push(`remove ${n}`),
    im: (n) => calls.push(`im ${n}`),
    away: () => calls.push("away"),
  });
  const btn = (member: number) =>
    w.window.el.querySelector<HTMLButtonElement>(
      `[data-action="${member === 4 ? "friends-remove" : member === 6 ? "friends-message" : "friends-away"}"]`,
    );
  const rows = () => [...w.window.el.querySelectorAll<HTMLElement>(".friends-name")];
  return { w, calls, btn, rows };
}

describe("the Friends window", () => {
  test("its sprites sit at frame-1.json's rects (the list at frames 2-28's)", () => {
    expect(asRect(FRIENDS_RECTS.frame)).toEqual(rectOf("Friendsgui", 1) as number[]);
    expect(asRect(FRIENDS_RECTS.list)).toEqual(stretchedOf("Friendsgui", 2));
    expect(asRect(FRIENDS_RECTS.remove)).toEqual(rectOf("Friendsgui", 3) as number[]);
    expect(asRect(FRIENDS_RECTS.im)).toEqual(rectOf("Friendsgui", 4) as number[]);
    expect(asRect(FRIENDS_RECTS.away)).toEqual(rectOf("Friendsgui", 5) as number[]);
  });

  test("titled Friends on a white stage, the art from Friendsgui's own members", () => {
    const { w } = friendsScene();
    expect(w.window.el.querySelector(".window-title")?.textContent).toBe("Friends");
    expect(
      w.window.el.querySelector<HTMLElement>(".window-body")?.style.backgroundColor.toUpperCase(),
    ).toBe("#FFFFFF");
    const srcs = [...w.window.el.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(srcs).toEqual([
      "/assets/ui/friendsgui-3.png",
      "/assets/ui/friendsgui-4.png",
      "/assets/ui/friendsgui-6.png",
      "/assets/ui/friendsgui-7.png",
    ]);
  });

  test("before any click Remove and IM do nothing; Away always opens", () => {
    const { w, calls, btn } = friendsScene();
    w.setNames(["Bob", "Cy"]);
    btn(4)?.click();
    btn(6)?.click();
    btn(7)?.click();
    expect(calls).toEqual(["away"]);
  });

  test("a clicked line is the selection; it stays after the list changes", () => {
    const { w, calls, btn, rows } = friendsScene();
    w.setNames(["Bob", "Cy"]);
    rows()[1]?.click();
    expect(w.selected).toBe("Cy");
    expect(rows()[1]?.getAttribute("aria-selected")).toBe("true");
    btn(4)?.click();
    w.setNames(["Bob"]);
    // The removed name is still selected: Remove again, and IM opens for it.
    btn(4)?.click();
    btn(6)?.click();
    expect(calls).toEqual(["remove Cy", "remove Cy", "im Cy"]);
    expect(rows().map((r) => r.textContent)).toEqual(["Bob"]);
  });

  test("a click below the last line selects nothing (an empty line)", () => {
    const { w, calls, btn } = friendsScene();
    w.setNames(["Bob"]);
    w.window.el.querySelector<HTMLElement>(".friends-list")?.click();
    btn(6)?.click();
    expect(calls).toEqual([]);
  });
});

function bioScene() {
  const layer = createWindowLayer();
  document.body.append(layer.el);
  const closed: unknown[] = [];
  const bio = createBioWindow(fakeAssets, layer, {
    list: () => {},
    closed: (how) => closed.push(how ?? "npc"),
  });
  const q = <T extends HTMLElement>(sel: string) => bio.window.el.querySelector<T>(sel);
  return { bio, closed, q };
}

const member = (id: number) => socialData.medals.awards.find((a) => a.id === id)?.member;

describe("the Bio window's player layouts", () => {
  test("the medal strip and the profile boxes at their rects", () => {
    expect(rectOf("BioWindow", 7)).toEqual([17, 113, 241, 129]);
    expect(stretchedOf("BioWindow", 6)).toEqual([22, 137, 293, 239]);
  });

  test("someone else's bio: read-only profile, the strip, no Buy or Sell; closing saves nothing", () => {
    const { bio, closed, q } = bioScene();
    bio.showPlayer({
      title: "Bob Star",
      bio: ["Name: Bob Star", "Class: Adventurer", "Sex: Male", "Score: 65", "Vile Murderer"],
      profile: "Hi",
      medals: ["39", "31"],
      own: false,
    });
    expect(q(".window-title")?.textContent).toBe("Bob Star");
    expect(q(".bio-bio")?.textContent).toBe(
      "Name: Bob Star\nClass: Adventurer\nSex: Male\nScore: 65\nVile Murderer",
    );
    expect(q(".bio-profile")?.hidden).toBe(false);
    expect(q(".bio-profile")?.textContent).toBe("Hi");
    expect(q(".bio-myprofile")?.hidden).toBe(true);
    expect(q(".bio-buy")?.hidden).toBe(true);
    expect(q(".bio-sell")?.hidden).toBe(true);
    expect(q(".bio-medals")?.hidden).toBe(false);
    const imgs = [...bio.window.el.querySelectorAll<HTMLImageElement>(".bio-medal")];
    expect(imgs).toHaveLength(14);
    expect(imgs[0]?.getAttribute("src")).toBe(`/assets/ui/biowindow-${member(39)}.png`);
    expect(imgs[1]?.getAttribute("src")).toBe(`/assets/ui/biowindow-${member(31)}.png`);
    expect(imgs[2]?.getAttribute("src")).toBe(
      `/assets/ui/biowindow-${socialData.bios.medalStrip.blankMember}.png`,
    );
    expect(imgs[1]?.style.left).toBe("16px");
    // Every slot past the medals shows the empty medal.
    expect(imgs[10]?.getAttribute("src")).toBe(
      `/assets/ui/biowindow-${socialData.bios.medalStrip.blankMember}.png`,
    );
    bio.window.close();
    expect(closed).toEqual([{ player: true, profile: null }]);
  });

  test("your own bio: the editable box, its text sent on close, edited or not", () => {
    const { bio, closed, q } = bioScene();
    bio.showPlayer({
      title: "Ann Star",
      bio: ["Name: Ann Star"],
      profile: "Mine.",
      medals: [],
      own: true,
    });
    const box = q<HTMLTextAreaElement>(".bio-myprofile");
    expect(box?.hidden).toBe(false);
    expect(box?.value).toBe("Mine.");
    expect(box?.maxLength).toBe(500);
    expect(q(".bio-profile")?.hidden).toBe(true);
    bio.window.close();
    if (box) {
      box.value = "Changed";
    }
    bio.showPlayer({ title: "Ann Star", bio: [], profile: "Mine", medals: [], own: true });
    if (box) {
      box.value = "Changed";
    }
    bio.window.close();
    expect(closed).toEqual([
      { player: true, profile: "Mine." },
      { player: true, profile: "Changed" },
    ]);
  });

  test("bug fixed: a bio with fewer medals clears slots 11-14 too", () => {
    const { bio } = bioScene();
    const twelve = ["39", "31", "94", "95", "93", "35", "61", "44", "45", "91", "92", "20"];
    bio.showPlayer({ title: "A", bio: [], profile: "", medals: twelve, own: false });
    expect(bio.strip.slice(10, 12)).toEqual([member(92) ?? null, member(20) ?? null]);
    bio.showPlayer({ title: "B", bio: [], profile: "", medals: [], own: false });
    const blank = socialData.bios.medalStrip.blankMember;
    expect(bio.strip).toEqual(Array(14).fill(blank));
    const imgs = [...bio.window.el.querySelectorAll<HTMLImageElement>(".bio-medal")];
    expect(imgs[11]?.getAttribute("src")).toBe(`/assets/ui/biowindow-${blank}.png`);
  });

  test("an NPC bio over a player one hides the strip and the editable box; closing is the NPC close", () => {
    const { bio, closed, q } = bioScene();
    bio.showPlayer({ title: "Ann Star", bio: [], profile: "x", medals: [], own: true });
    bio.show({
      name: "Jim",
      bio: ["A trader"],
      profile: ["Buy"],
      buy: true,
      sell: false,
      train: false,
    });
    expect(q(".bio-medals")?.hidden).toBe(true);
    expect(q(".bio-myprofile")?.hidden).toBe(true);
    expect(q(".bio-buy")?.hidden).toBe(false);
    bio.window.close();
    expect(closed).toEqual(["npc"]);
  });
});

describe("the Who window's Profile", () => {
  test("asks for the selection's bio, drops the highlight, keeps the selection", () => {
    const layer = createWindowLayer();
    const asked: string[] = [];
    const who = createWhoWindow(fakeAssets, layer, {
      im: () => {},
      profile: (n) => asked.push(n),
    });
    who.show(["Ann", "Bob"]);
    const profile = who.window.el.querySelector<HTMLButtonElement>(".who-profile");
    profile?.click();
    expect(asked).toEqual([]);
    const row = who.window.el.querySelectorAll<HTMLElement>(".who-name")[1];
    row?.click();
    profile?.click();
    expect(asked).toEqual(["Bob"]);
    expect(row?.getAttribute("aria-selected")).toBe("false");
    expect(who.selected).toBe("Bob");
  });
});
