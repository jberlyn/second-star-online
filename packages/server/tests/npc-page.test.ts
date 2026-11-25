/**
 * Issue #32, stage 1: the Control Panel's NPCs page on the server. Its list is every NPC file and
 * every name the editor lists or a species give (player shops left out); the open file is LOAD's
 * (live stock and gold written in) with its revision; a save is checked as the NPC Editor's SAVE is,
 * applies at once, starts the shop again and is refused over a file changed since.
 */
import { describe, expect, test } from "bun:test";

import { NPC_EDIT_TEXT } from "@secondstaronline/shared";

import { npcFileRevision } from "../src/systems/admin/npcedit.ts";
import { npcPageFile, npcPageView, saveNpcPage } from "../src/systems/admin/npcpage.ts";
import { npcFileNamed, setNpcFile } from "../src/systems/monsters/npcfiles.ts";
import type { World } from "../src/systems/world/world.ts";
import { setup, testMap } from "./helpers/sim.ts";

const ledgerOf = (world: World) => (npc: string) => world.shops.get(npc) ?? null;

function scene() {
  return setup([testMap("x1000y992")]).world;
}

describe("the NPCs page (issue #32)", () => {
  test("the list holds every file, list name and species; a player shop is never on it", () => {
    const world = scene();
    setNpcFile(world.npcs, "Cuche", "SEL|Apple:5:1");
    world.playerShops.set("cuche", {} as never);
    const v = npcPageView(world, ledgerOf(world));
    const amber = v.npcs.find((n) => n.name === "Amber");
    expect(amber).toMatchObject({ file: true, shop: true });
    expect(v.npcs.find((n) => n.name === "Orc")).toMatchObject({ species: true });
    expect(v.npcs.some((n) => n.name.toLowerCase() === "cuche")).toBe(false);
    expect(npcPageFile(world, "Cuche", ledgerOf(world))).toBeNull();
    expect(v.choices.items.length).toBeGreaterThan(0);
    expect(v.choices.classes.length).toBeGreaterThan(0);
  });

  test("the open file is LOAD's, live stock written in, with the file's revision", () => {
    const world = scene();
    const f = npcFileNamed(world.npcs, "Amber");
    const sel = f?.sells[0];
    if (!f || !sel) {
      throw new Error("Amber sells");
    }
    world.shops.set(f.name, {
      npc: f.name,
      gold: f.gold,
      goldLine: f.goldLine,
      dirty: true,
      lines: [{ kind: "SEL", line: sel.line, item: sel.item, stock: sel.stock + 7 }],
    } as never);
    const v = npcPageFile(world, "amber", ledgerOf(world));
    expect(v?.name).toBe("Amber");
    expect(v?.revision).toBe(npcFileRevision(f.text));
    expect(v?.text).toContain(`SEL|${sel.item}:${sel.price}:${sel.stock + 7}`);
  });

  test("a stock set back to the stored number resets the live shop (issue #32 review)", () => {
    const world = scene();
    const f = npcFileNamed(world.npcs, "Amber");
    const sel = f?.sells[0];
    if (!f || !sel) {
      throw new Error("Amber sells");
    }
    world.shops.set(f.name, {
      npc: f.name,
      gold: f.gold,
      goldLine: f.goldLine,
      dirty: true,
      lines: [{ kind: "SEL", line: sel.line, item: sel.item, stock: 2 }],
    } as never);
    const v = npcPageFile(world, "Amber", ledgerOf(world));
    // The stored file's own text: the live stock (2) goes back to it.
    const r = saveNpcPage(world, "Amber", f.text, v?.revision ?? null, ledgerOf(world));
    expect(r.save).not.toBeNull();
    expect(world.shops.has("Amber")).toBe(false);
  });

  test("a save applies at once; a stale one, a bad line or an unknown name is refused", () => {
    const world = scene();
    const v = npcPageFile(world, "Amber", ledgerOf(world));
    const ok = saveNpcPage(
      world,
      "Amber",
      "BIO|Name: Amber\nSEL|apple:7:2",
      v?.revision ?? null,
      ledgerOf(world),
    );
    expect(ok.ok).toBe(true);
    expect(ok.save?.npc).toBe("Amber");
    // Written as the NPC Editor writes it: CR-separated (an archived spelling such as "apple" stays).
    expect(npcFileNamed(world.npcs, "Amber")?.text).toBe("BIO|Name: Amber\rSEL|apple:7:2");
    // The same revision again is stale now.
    const stale = saveNpcPage(world, "Amber", "BIO|x", v?.revision ?? null, ledgerOf(world));
    expect(stale.ok ? "" : stale.text).toContain("changed since you opened it");
    const now = npcPageFile(world, "Amber", ledgerOf(world));
    const bad = saveNpcPage(
      world,
      "Amber",
      "SEL|Fire:5:10",
      now?.revision ?? null,
      ledgerOf(world),
    );
    expect(bad.text).toBe(NPC_EDIT_TEXT.refused('Line 1: "Fire" is not an item.'));
    expect(saveNpcPage(world, "Nobody At All", "BIO|x", null, ledgerOf(world)).ok).toBe(false);
    // A species with no file gets one, naming no revision.
    const bare = npcPageView(world, ledgerOf(world)).npcs.find((n) => n.species && !n.file);
    if (bare) {
      expect(saveNpcPage(world, bare.name, "FLG|Passive", null, ledgerOf(world)).ok).toBe(true);
      expect(npcFileNamed(world.npcs, bare.name)?.flags).toEqual(["FLG|Passive"]);
    }
  });
});
