/**
 * Containers by behaviour (issue #37 stage 3): a world's own crate or cauldron takes items on Drop
 * and saves with its id in the world editor, as Classic's Crate and Cauldron do.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import { buildContentStore, type ContentData, installContent } from "@secondstaronline/shared";

import { editorItemOk } from "../src/systems/admin/worldedit.ts";
import { dropRoute } from "../src/systems/economy/containers.ts";
import type { GroundItem } from "../src/systems/world/world.ts";

const at = (item: string) => ({ item }) as GroundItem;

/** Runs `body` with Classic plus two items of a world's own: a Barrel crate and a Brew Pot. */
function withOwnContainers(body: () => void): void {
  const d = structuredClone(classicData) as ContentData;
  // An item with no picture is no Inventory member, which `/drop` refuses; borrow the Cauldron's.
  d.items.items.push(
    { name: "Barrel", sprite: "Cauldron" },
    { name: "Brew Pot", sprite: "Cauldron" },
  );
  d.itemRules.behaviours.push(
    { match: "exact", pattern: "Barrel", behaviour: "crate" },
    { match: "exact", pattern: "Brew Pot", behaviour: "cauldron" },
  );
  installContent(buildContentStore(d));
  try {
    body();
  } finally {
    installContent(buildContentStore(classicData));
  }
}

/** Runs `body` with every behaviour row gone, then puts Classic back. */
function withNoBehaviours(body: () => void): void {
  const d = structuredClone(classicData) as ContentData;
  d.itemRules.behaviours = [];
  installContent(buildContentStore(d));
  try {
    body();
  } finally {
    installContent(buildContentStore(classicData));
  }
}

describe("containers by behaviour", () => {
  test("Classic's routes are unchanged", () => {
    expect(dropRoute(at("Crate#12"))).toBe("Crate#12");
    expect(dropRoute(at("Wind Cabinet#3"))).toBe("Wind Cabinet#3");
    expect(dropRoute(at("Gold Chest"))).toBe("Gold Chest");
    expect(dropRoute(at("Bob's House Vault"))).toBe("Bob's House Vault");
    // The personal Vault is the caller's (its behaviour), before the route.
    expect(dropRoute(at("Vault"))).toBeNull();
    expect(dropRoute(at("Crate"))).toBeNull();
    expect(dropRoute(at("Apple"))).toBeNull();
    expect(editorItemOk("Cauldron#12")).toBe(true);
    expect(editorItemOk("Crate#12")).toBe(false);
  });

  test("a world's own crate takes Drop, and its cauldron saves with its id", () => {
    withOwnContainers(() => {
      expect(dropRoute(at("Barrel#2"))).toBe("Barrel#2");
      expect(dropRoute(at("Barrel"))).toBeNull();
      expect(editorItemOk("Brew Pot#77")).toBe(true);
      expect(editorItemOk("Barrel#77")).toBe(false);
    });
  });

  test("an engine fixture takes Drop only as a vault, whatever its owner is called", () => {
    expect(dropRoute(at("The Crate#1's Board"))).toBeNull();
    expect(dropRoute(at("The Crate#1's Guild Vault"))).toBe("The Crate#1's Guild Vault");
    expect(dropRoute(at("Bob's Mailbox"))).toBeNull();
  });

  test("with no behaviours nothing takes Drop but the house and guild vaults", () => {
    withNoBehaviours(() => {
      for (const n of ["Vault", "Gold Chest", "Crate#5", "Cauldron#2"]) {
        expect(dropRoute(at(n))).toBeNull();
      }
      expect(dropRoute(at("Bob's House Vault"))).toBe("Bob's House Vault");
    });
  });
});
