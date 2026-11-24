/**
 * Issue #30, stage 3: the Items page on the server. Its view lists every item with what it is and
 * whether it is the pack's, changed or the operator's own, and opens an item's form as what it
 * plays now with where each rule comes from. Its changes are item definitions and catalogue rows in
 * the shared draft: saved, renamed, created by copying another item, dropped back to the pack's
 * rules, each refused when the item changed since the page saw it (from the Items page or the
 * Content page's JSON editor), and refusals name the form's fields.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  type ContentItemsView,
  content,
  installContent,
  strengthRequirement,
} from "@secondstaronline/shared";

import { contentIntent } from "../src/content/page.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { seedNewWorld, worldToCreate } from "../src/content/world-seed.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";
import { plays } from "./helpers/item-plays.ts";

const classic = content();
afterAll(() => installContent(classic));

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const OTHER: ContentActor = { accountId: "acc-other", name: "Other" };

function service(pack: "classic" | "minimal" = "classic") {
  const db = openDatabase();
  // As the server creates a world: the pack chosen first, then the migrations, then its seed.
  const creating = worldToCreate(db, pack, RELEASE_PACK_DIRS);
  runMigrations(db, loadMigrations(MIGRATIONS_DIR));
  if (creating) {
    seedNewWorld(db, creating, RELEASE_PACK_DIRS, "2026-11-24T00:00:00.000Z");
  }
  let t = 0;
  return new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 24, 0, 0, t++)).toISOString(),
    releasePacks: RELEASE_PACK_DIRS,
    onPublish: (store) => installContent(store),
  });
}

type Answer = {
  t: "contentItems";
  view: ContentItemsView;
  result?: { ok: boolean; text: string; problems?: { where: string; message: string }[] };
};

const ask = (s: ContentService, name?: string) =>
  (contentIntent(s, ADMIN, { t: "contentItems", seq: 1, ...(name ? { name } : {}) }) as Answer)
    .view;

const change = (
  s: ContentService,
  c: {
    name: string;
    op: "set" | "revert" | "discard" | "rename" | "create";
    data?: unknown;
    display?: string;
    copyFrom?: string;
    expect?: string;
  },
  actor = ADMIN,
) => contentIntent(s, actor, { t: "contentItemSet", seq: 2, ...c }) as Answer;

describe("the Items page's view (#30 stage 3)", () => {
  test("lists every item with its kind and state, and opens one as it plays now", () => {
    const s = service();
    const v = ask(s, "Long Sword");
    expect(v.items).toHaveLength(content().items.items.length);
    const kind = (n: string) => v.items.find((i) => i.name === n)?.kind;
    expect(kind("Long Sword")).toBe("weapon");
    expect(kind("Apple")).toBe("food");
    expect(v.items.every((i) => i.state === "pack" && !i.pending)).toBe(true);
    const item = v.item;
    expect(item?.name).toBe("Long Sword");
    expect(item?.defined).toBe(false);
    expect(item?.form.strength).toBe(strengthRequirement("Long Sword"));
    // Each rule's source is the pack's row that decides it.
    expect(item?.sources.find((x) => x.label === "Strength")?.from).toMatch(
      /^the pack's contains "Long Sword" \(row \d+\)$/,
    );
    expect(item?.pack).toEqual(item?.form);
    expect(item?.choices.skills).toContain("Slash");
  });

  test("an unknown item opens nothing", () => {
    expect(ask(service(), "No Such Thing").item).toBeNull();
  });
});

describe("the Items page's changes (#30 stage 3)", () => {
  test("a definition saved, published, playing; back to the pack's rules", () => {
    const s = service();
    try {
      const item = ask(s, "Long Sword").item;
      if (!item) {
        throw new Error("no Long Sword");
      }
      // Saving what it plays now stages nothing.
      const same = change(s, {
        name: "Long Sword",
        op: "set",
        data: item.form,
        expect: item.fingerprint,
      });
      expect(same.result).toEqual({
        ok: false,
        text: "Long Sword already plays that: nothing to save.",
      });
      const saved = change(s, {
        name: "Long Sword",
        op: "set",
        data: { ...item.form, strength: 23 },
        expect: item.fingerprint,
      });
      expect(saved.result?.ok).toBe(true);
      expect(saved.view.item?.defined).toBe(true);
      expect(saved.view.item?.pending.definition).toBe("set");
      expect(saved.view.item?.sources.every((x) => x.from === "your definition")).toBe(true);
      expect(saved.view.items.find((i) => i.name === "Long Sword")).toMatchObject({
        state: "edited",
        pending: true,
      });
      expect(s.publish(ADMIN, s.draftRev(), "Heavier").ok).toBe(true);
      expect(strengthRequirement("Long Sword")).toBe(23);
      // Back to the pack's rules: dropped when published.
      const now = ask(s, "Long Sword").item;
      const back = change(s, { name: "Long Sword", op: "revert", expect: now?.fingerprint });
      expect(back.result).toEqual({
        ok: true,
        text: "Long Sword plays the pack's rules again when published.",
      });
      expect(s.publish(ADMIN, s.draftRev(), "Back").ok).toBe(true);
      expect(strengthRequirement("Long Sword")).toBe(item.form.strength as number);
    } finally {
      installContent(classic);
    }
  });

  test("a save refused when the item changed since the page saw it, here or in the JSON editor", () => {
    const s = service();
    const item = ask(s, "Long Sword").item;
    if (!item) {
      throw new Error("no Long Sword");
    }
    expect(
      change(s, {
        name: "Long Sword",
        op: "set",
        data: { ...item.form, strength: 20 },
        expect: item.fingerprint,
      }).result?.ok,
    ).toBe(true);
    // The page's old fingerprint is refused.
    const stale = change(
      s,
      {
        name: "Long Sword",
        op: "set",
        data: { ...item.form, strength: 21 },
        expect: item.fingerprint,
      },
      OTHER,
    );
    expect(stale.result?.text).toBe(
      "Long Sword changed since you opened it: look at it again before saving.",
    );
    // The Content page's JSON editor names the definition's revision too.
    const ref = { dataset: "items", part: "definitions", key: "Long Sword" };
    const row = contentIntent(s, ADMIN, { t: "contentRow", seq: 3, ...ref }) as {
      row: { revision?: string };
    };
    expect(row.row.revision).toBe(ask(s, "Long Sword").item?.fingerprint);
    const noRevision = contentIntent(s, OTHER, {
      t: "contentDraft",
      seq: 4,
      ...ref,
      op: "set",
      data: { ...item.form, strength: 22 },
    }) as { ok: boolean; text: string };
    expect(noRevision.ok).toBe(false);
    expect(noRevision.text).toContain("changed since you opened it");
    const withRevision = contentIntent(s, OTHER, {
      t: "contentDraft",
      seq: 5,
      ...ref,
      op: "set",
      data: { ...item.form, strength: 22 },
      expect: row.row.revision,
    }) as { ok: boolean };
    expect(withRevision.ok).toBe(true);
    // And now the Items page's view from before that is stale.
    const after = change(s, {
      name: "Long Sword",
      op: "set",
      data: { ...item.form, strength: 24 },
      expect: row.row.revision,
    });
    expect(after.result?.ok).toBe(false);
  });

  test("stale writes refused: a raw rule edit under the form, a stale catalogue save, a gone definition", () => {
    const s = service();
    // (a) The form seeds what Long Sword plays; a raw equip-table edit makes that stale.
    const opened = ask(s, "Long Sword").item;
    if (!opened) {
      throw new Error("no Long Sword");
    }
    const equip = s.draftContent().itemRules.equip;
    expect(
      s.draftSet(ADMIN, { dataset: "itemRules", part: "equip", key: null }, "set", {
        ...equip,
        strength: [...equip.strength, { match: "exact", pattern: "Long Sword", strength: 175 }],
      }).ok,
    ).toBe(true);
    const soundOnly = change(s, {
      name: "Long Sword",
      op: "set",
      data: { ...opened.form, sound: null },
      expect: opened.fingerprint,
    });
    expect(soundOnly.result?.ok).toBe(false);
    // (b) A stale catalogue JSON save cannot undo an Items page rename.
    const catRef = { dataset: "items", part: "items", key: "Ruby Ring" };
    const cat = contentIntent(s, ADMIN, { t: "contentRow", seq: 3, ...catRef }) as unknown as {
      row: { revision?: string; data: Record<string, unknown> };
    };
    expect(cat.row.revision).toBeDefined();
    const ring = ask(s, "Ruby Ring").item;
    expect(
      change(s, {
        name: "Ruby Ring",
        op: "rename",
        display: "Red Ring",
        expect: ring?.fingerprint,
      }).result?.ok,
    ).toBe(true);
    const staleCat = contentIntent(s, OTHER, {
      t: "contentDraft",
      seq: 4,
      ...catRef,
      op: "set",
      data: cat.row.data,
      expect: cat.row.revision,
    }) as { ok: boolean; text: string };
    expect(staleCat.ok).toBe(false);
    // (c) A definition discarded after the JSON editor opened it is not recreated by a stale save.
    const defRef = { dataset: "items", part: "definitions", key: "Apple" };
    const apple = ask(s, "Apple").item;
    expect(
      change(s, {
        name: "Apple",
        op: "set",
        data: { ...apple?.form, strength: 3 },
        expect: apple?.fingerprint,
      }).result?.ok,
    ).toBe(true);
    const def = contentIntent(s, ADMIN, { t: "contentRow", seq: 5, ...defRef }) as unknown as {
      row: { revision?: string; data: unknown };
    };
    expect(s.draftDiscard(defRef as never).ok).toBe(true);
    const gone = contentIntent(s, OTHER, {
      t: "contentDraft",
      seq: 6,
      ...defRef,
      op: "set",
      data: def.row.data,
      expect: def.row.revision,
    }) as { ok: boolean; text: string };
    expect(gone.ok).toBe(false);
    expect(gone.text).toContain("gone since you opened it");
  });

  test("New and Rename run the catalogue's key checks: a key's form, and no clash with another item", () => {
    const s = service();
    for (const c of [
      { name: "5 Swords", op: "create" as const },
      { name: "Moon Sword", op: "create" as const, display: "Apple" },
      { name: "Apple", op: "create" as const },
    ]) {
      expect(change(s, c).result?.ok).toBe(false);
    }
    const sword = ask(s, "Long Sword").item;
    const renamed = change(s, {
      name: "Long Sword",
      op: "rename",
      display: "Apple",
      expect: sword?.fingerprint,
    });
    expect(renamed.result?.ok).toBe(false);
    expect(s.draft()).toEqual([]);
    // A long existing key (up to 80) is accepted by the message check: the answer comes back.
    const long = `${"Very ".repeat(10)}Long Sword`;
    const answer = change(s, { name: long, op: "rename", display: "x" });
    expect(answer.result?.ok).toBe(false);
    expect(answer.result?.text).toContain("no item");
  });

  test("refusals name the form's fields, and a refused definition stays out of the draft", () => {
    const s = service();
    const item = ask(s, "Long Sword").item;
    if (!item) {
      throw new Error("no Long Sword");
    }
    const skill = change(s, {
      name: "Long Sword",
      op: "set",
      data: { ...item.form, trains: ["Basket Weaving"] },
      expect: item.fingerprint,
    });
    expect(skill.result).toEqual({
      ok: false,
      text: "Long Sword was not saved.",
      problems: [{ where: "Trains", message: "names a skill that does not exist: Basket Weaving" }],
    });
    expect(s.draft()).toEqual([]);
    const roll = change(s, {
      name: "Long Sword",
      op: "set",
      data: {
        ...item.form,
        attack: {
          base: [
            { flat: 6, randomN: 6 },
            { flat: 1, randomN: 99_999 },
          ],
        },
      },
      expect: item.fingerprint,
    });
    expect(roll.result?.ok).toBe(false);
    expect(roll.result?.problems?.[0]?.where).toBe("Attack roll 2");
    expect(roll.result?.problems?.[0]?.message).not.toMatch(/randomN/);
  });

  test("a new item copying Long Sword plays as it does, with its picture; renamed; discarded", () => {
    const s = service();
    try {
      const made = change(s, {
        name: "Moon Sword",
        op: "create",
        display: "Moonblade",
        copyFrom: "Long Sword",
      });
      expect(made.result?.ok).toBe(true);
      expect(made.view.item).toMatchObject({
        name: "Moon Sword",
        display: "Moonblade",
        inPack: false,
        defined: true,
        pack: null,
      });
      expect(made.view.items.find((i) => i.name === "Moon Sword")).toMatchObject({
        state: "yours",
        kind: "weapon",
        display: "Moonblade",
      });
      // A name the game gives its own things, or one taken, is refused.
      expect(change(s, { name: "Long Sword", op: "create" }).result?.ok).toBe(false);
      expect(change(s, { name: "Moon Sword +2", op: "create" }).result?.ok).toBe(false);
      expect(change(s, { name: "Crate#4", op: "create" }).result?.ok).toBe(false);
      expect(s.publish(ADMIN, s.draftRev(), "Moonblade").ok).toBe(true);
      const sword = plays("Long Sword");
      const moon = plays("Moon Sword");
      for (const k of ["slot", "strength", "behaviours", "trains", "gear", "armour", "attack"]) {
        expect({ k, v: moon[k] }).toEqual({ k, v: sword[k] });
      }
      expect(content().items.items.find((i) => i.name === "Moon Sword")).toMatchObject({
        display: "Moonblade",
        sprite: "Long Sword",
      });
      // Renamed in the draft, then the rename dropped.
      const open = ask(s, "Moon Sword").item;
      const renamed = change(s, {
        name: "Moon Sword",
        op: "rename",
        display: "Star Blade",
        expect: open?.fingerprint,
      });
      expect(renamed.result).toEqual({
        ok: true,
        text: "Moon Sword is called Star Blade in the draft.",
      });
      expect(renamed.view.item?.display).toBe("Star Blade");
      const dropped = change(s, {
        name: "Moon Sword",
        op: "discard",
        expect: renamed.view.item?.fingerprint,
      });
      expect(dropped.result?.ok).toBe(true);
      expect(dropped.view.item?.display).toBe("Moonblade");
    } finally {
      installContent(classic);
    }
  });

  test("a Minimal world's items open and save", () => {
    const s = service("minimal");
    const v = ask(s);
    expect(v.items.length).toBeGreaterThanOrEqual(0);
    const made = change(s, { name: "Stick", op: "create" });
    expect(made.result?.ok).toBe(true);
    const stick = made.view.item;
    expect(stick?.form).toEqual({ name: "Stick" });
    const saved = change(s, {
      name: "Stick",
      op: "set",
      data: { name: "Stick", slot: "LeftHand", attack: { base: [{ flat: 1, randomN: 2 }] } },
      expect: stick?.fingerprint,
    });
    expect(saved.result?.ok).toBe(true);
    expect(saved.view.items.find((i) => i.name === "Stick")?.kind).toBe("weapon");
    installContent(classic);
  });
});
