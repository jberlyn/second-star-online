/**
 * Issue #30, stage 2: item definitions. An item's rules in one record (`items.definitions`), which
 * the store compiles into exact rows that win in every table they cover; the pack's rows that
 * matched the item stop applying to it there. A definition seeded from what an item plays now and
 * saved unchanged plays identically (RNG draws included) for every Classic item, alone or with
 * every other item defined too; a defined item ignores the pack's every-match rows; removing the
 * definition gives the item back to the pack's rules.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ItemDefinition } from "@secondstaronline/data";
import { classicData } from "@secondstaronline/data/classic";
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  buildContentStore,
  type ContentData,
  compileDefinitions,
  content,
  equipSlotFor,
  hasBehaviour,
  installContent,
  NO_EQUIPMENT,
  resolveIn,
  resolveItem,
  seedDefinition,
  strengthRequirement,
  swingCooldowns,
  weaponSkillList,
} from "@secondstaronline/shared";

import type { ArtKeys } from "../src/content/art.ts";
import { newItemArtGaps, usedArt } from "../src/content/art-usage.ts";
import { type ContentActor, ContentService, clientCopyOf } from "../src/content/service.ts";
import { definitionProblems } from "../src/content/validate.ts";
import type { ContentWorld } from "../src/content/world.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";
import { plays } from "./helpers/item-plays.ts";

const classic = content();
afterAll(() => installContent(classic));

const CLASSIC = classicData as unknown as ContentData;
const NAMES = classicData.items.items.map((i) => i.name);
/** Names the game meets at run time too: an upgraded weapon, a masterwork, a container's #id. */
const RUNTIME = ["Long Sword+3", "Knight's Sword +1", "Gold Axe+2", "Crate#12", "Bob's Door"];
const MASTERWORKS = new Set(
  (classicData.craft.stations.smith?.masterwork ?? []).flatMap((m) =>
    m.outcomes.map((o) => o.result.toLowerCase()),
  ),
);

const seed = (name: string, d: ContentData = CLASSIC): ItemDefinition =>
  seedDefinition(name, resolveIn(name, d));

/** Classic with these item definitions. */
function withDefinitions(defs: readonly ItemDefinition[]): ContentData {
  return { ...CLASSIC, items: { ...CLASSIC.items, definitions: [...defs] } };
}

/** What every name plays under a world. */
function playsAll(d: ContentData, names: readonly string[]): Map<string, unknown> {
  installContent(buildContentStore(d));
  try {
    return new Map(names.map((n) => [n, plays(n)]));
  } finally {
    installContent(classic);
  }
}

const ALL = [...NAMES, ...RUNTIME];
const classicPlays = playsAll(CLASSIC, ALL);

function expectSame(got: Map<string, unknown>) {
  for (const name of ALL) {
    expect({ name, ...(got.get(name) as object) }).toEqual({
      name,
      ...(classicPlays.get(name) as object),
    });
  }
}

describe("item definitions compile into the tables (#30 stage 2)", () => {
  test("every Classic item, defined alone as it plays now, plays identically", () => {
    let checked = 0;
    for (const name of NAMES) {
      installContent(buildContentStore(withDefinitions([seed(name)])));
      try {
        // The item itself, and the items whose rows it shared (its masterworks, its family).
        for (const n of [name, ...RUNTIME]) {
          expect({ n, ...plays(n) }).toEqual({ n, ...(classicPlays.get(n) as object) });
        }
        // Seeding again in the compiled world gives the same definition: it is stable.
        expect(seedDefinition(name, resolveItem(name))).toEqual(seed(name));
      } finally {
        installContent(classic);
      }
      checked++;
    }
    expect(checked).toBe(NAMES.length);
  });

  test("every Classic item defined at once plays identically, RNG draws included", () => {
    expectSame(playsAll(withDefinitions(NAMES.map((n) => seed(n))), ALL));
  });

  test("base items defined, masterworks not: the masterworks keep the pack's rows", () => {
    const bases = NAMES.filter((n) => !MASTERWORKS.has(n.toLowerCase()));
    expect(bases.length).toBeLessThan(NAMES.length);
    expectSame(playsAll(withDefinitions(bases.map((n) => seed(n))), ALL));
  });

  test("a defined item ignores the pack's rows, every-match tables included", () => {
    // An empty definition: no slot, no behaviours, no attack rolls, no skills trained.
    installContent(buildContentStore(withDefinitions([{ name: "Long Sword" }])));
    try {
      expect(equipSlotFor("Long Sword")).toBe("No");
      expect(hasBehaviour("Long Sword", "sword")).toBe(false);
      expect(weaponSkillList("Long Sword")).toEqual([]);
      // Its family keeps the pack's rows for every sword name.
      expect(hasBehaviour("Broad Sword", "sword")).toBe(true);
      expect(equipSlotFor("Broad Sword")).toBe(equipSlotFor("Broad Sword"));
      expect(plays("Broad Sword")).toEqual(
        classicPlays.get("Broad Sword") as Record<string, unknown>,
      );
      // A runtime `+N` spelling: behaviours test the name without it, so they follow the
      // definition; the other tables test the whole name, so it keeps the pack's rows.
      expect(hasBehaviour("Long Sword+3", "sword")).toBe(false);
      expect(equipSlotFor("Long Sword+3")).toBe("LeftHand");
      // The resolver sees only the definition's rows (none): nothing of the pack's.
      const keys = resolveItem("Long Sword").map((h) => h.key);
      expect(keys).not.toContain("itemRules behaviours");
      expect(keys).not.toContain("attPower attPower.skillBlocks");
    } finally {
      installContent(classic);
    }
  });

  test("a changed definition plays its own values", () => {
    const sword: ItemDefinition = {
      ...seed("Long Sword"),
      slot: "LeftHand",
      strength: 17,
      attack: { base: [{ flat: 40, randomN: 0 }] },
      trains: ["Swordsmanship"],
    };
    installContent(buildContentStore(withDefinitions([sword])));
    try {
      expect(strengthRequirement("Long Sword")).toBe(17);
      expect(weaponSkillList("Long Sword")).toEqual(["Swordsmanship"]);
      // The pack's base roll for "Sword" no longer draws for it: one fixed roll.
      const a = plays("Long Sword").attack as [number, number, number[]][];
      expect(a[0]?.[0]).toBe(a[0]?.[1]);
    } finally {
      installContent(classic);
    }
  });

  test("a base item's definition leaves its masterworks the pack's rows", () => {
    // Classic's exact Knight's Sword rows also cover Knight's Sword +1 (weaponIs).
    const before = weaponSkillList("Knight's Sword +1");
    expect(before.length).toBeGreaterThan(0);
    installContent(
      buildContentStore(
        withDefinitions([{ ...seed("Knight's Sword"), trains: ["Swordsmanship", "Fencing"] }]),
      ),
    );
    try {
      expect(weaponSkillList("Knight's Sword")).toEqual(["Swordsmanship", "Fencing"]);
      expect(weaponSkillList("Knight's Sword +1")).toEqual(before);
      expect(plays("Knight's Sword +1")).toEqual(
        classicPlays.get("Knight's Sword +1") as Record<string, unknown>,
      );
    } finally {
      installContent(classic);
    }
  });

  test("a seed saved unchanged keeps a mixed loadout's cooldown (each row at its deciding row)", () => {
    const d = structuredClone(CLASSIC) as ContentData;
    d.itemRules.swing.cooldowns = [
      { match: "contains", pattern: "Sword", slot: "weapon", atDelay: 12, actionDelay: 12 },
      { match: "exact", pattern: "Ring of Quickness", slot: "ring", atDelay: 10, actionDelay: 10 },
      { match: "exact", pattern: "Long Sword", slot: "weapon", atDelay: 8, actionDelay: 8 },
    ] as ContentData["itemRules"]["swing"]["cooldowns"];
    const loadout = () => {
      const e = { ...NO_EQUIPMENT, weapon: "Long Sword", ring: "Ring of Quickness" };
      return swingCooldowns(e, []).atDelay;
    };
    installContent(buildContentStore(d));
    try {
      expect(loadout()).toBe(8);
      const def = seedDefinition("Long Sword", resolveIn("Long Sword", d));
      expect(def.cooldowns).toEqual([{ slot: "weapon", atDelay: 8, actionDelay: 8 }]);
      installContent(buildContentStore({ ...d, items: { ...d.items, definitions: [def] } }));
      expect(loadout()).toBe(8);
    } finally {
      installContent(classic);
    }
  });

  test("a contains skill block with no pattern matches every weapon, and a definition leaves it", () => {
    const d = structuredClone(CLASSIC) as ContentData;
    d.attPower.attPower.skillBlocks = [
      {
        weaponMatch: "contains",
        pattern: null,
        tiers: [{ subWeapon: null, when: null, op: "add", value: 5 }],
      },
      ...d.attPower.attPower.skillBlocks,
    ] as ContentData["attPower"]["attPower"]["skillBlocks"];
    const hit = resolveIn("Long Sword", d).find((h) => h.key === "attPower attPower.skillBlocks");
    expect(hit?.rows.some((r) => r.index === 1)).toBe(true);
    const compiled = compileDefinitions({
      ...d,
      items: { ...d.items, definitions: [{ name: "Long Sword" }] },
    });
    const blocks = compiled.attPower.attPower.skillBlocks as unknown as { except?: string[] }[];
    expect(blocks[0]?.except).toContain("Long Sword");
    // No pack block still applies to the defined (empty) Long Sword.
    for (const b of blocks) {
      const r = b as { weaponMatch: string; pattern: string | null; except?: string[] };
      if (r.weaponMatch === "contains" && "long sword".includes((r.pattern ?? "").toLowerCase())) {
        expect(r.except ?? []).toContain("Long Sword");
      }
    }
  });

  test("one item's book behaviour never turns a shared meal line into a read line", () => {
    const d = structuredClone(CLASSIC) as ContentData;
    d.itemRules.use.messages = [
      ...d.itemRules.use.messages,
      { match: "contains", pattern: "Potion", text: "Gulp." },
    ];
    const line = (data: ContentData) =>
      resolveIn("Red Potion", data).find((h) => h.key === "itemRules use.messages")?.deciding[0]
        ?.raw.text;
    expect(line(d)).toBe("Gulp.");
    const compiled = compileDefinitions({
      ...d,
      items: { ...d.items, definitions: [{ name: "Potion", behaviours: ["book"] }] },
    });
    expect(line(compiled)).toBe("Gulp.");
    // Classic's book rows stay read lines.
    const books = compiled.itemRules.use.messages.filter((m) => m.read === true);
    expect(books.length).toBeGreaterThan(0);
  });

  test("the compile never changes the data it is given, and none compiles to itself", () => {
    const d = withDefinitions([{ name: "Long Sword" }]);
    const before = JSON.stringify(d);
    compileDefinitions(d);
    expect(JSON.stringify(d)).toBe(before);
    expect(compileDefinitions(CLASSIC)).toBe(CLASSIC);
  });

  test("the client compiles the same store from the copy the server sends", () => {
    const d = withDefinitions([{ ...seed("Apple"), use: { usable: true, message: "Crunch." } }]);
    const copy = clientCopyOf(d);
    const sent = JSON.parse(copy.json) as { data: ContentData };
    const server = buildContentStore(d);
    const client = buildContentStore({ ...d, ...sent.data } as ContentData);
    expect(client.itemRules).toEqual(server.itemRules);
    expect(client.attPower).toEqual(server.attPower);
    expect(client.classes.skillGain).toEqual(server.classes.skillGain);
  });
});

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
const defRef = (key: string) => ({ dataset: "items" as const, part: "definitions", key });

function service(packs: Record<string, string> = RELEASE_PACK_DIRS, db = openDatabase()) {
  if (packs === RELEASE_PACK_DIRS) {
    runMigrations(db, loadMigrations(MIGRATIONS_DIR));
  }
  let t = 0;
  const s = new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 24, 0, 0, t++)).toISOString(),
    releasePacks: packs,
    onPublish: (store) => installContent(store),
  });
  return { db, s };
}

describe("item definitions on a running server (#30 stage 2)", () => {
  test("drafted, published and undone through the content store, live", () => {
    const { s } = service();
    try {
      const sword = { ...seed("Long Sword"), strength: 23 };
      expect(s.draftSet(ADMIN, defRef("Long Sword"), "set", sword).ok).toBe(true);
      const p = s.publish(ADMIN, s.draftRev(), "Heavier sword");
      expect(p.ok).toBe(true);
      expect(strengthRequirement("Long Sword")).toBe(23);
      // No pack notice for a definition the pack's rules have not changed under.
      expect(s.notices()).toEqual([]);
      expect(s.undo(ADMIN, p.ok ? p.value.id : "").ok).toBe(true);
      expect(strengthRequirement("Long Sword")).toBe(
        (classicPlays.get("Long Sword") as { strength: number }).strength,
      );
    } finally {
      installContent(classic);
    }
  });

  test("refused: a bad value, an unknown item, a fixture, a masterwork's behaviours, no skill", () => {
    const { s } = service();
    const refused = (key: string, data: unknown) => {
      const r = s.draftSet(ADMIN, defRef(key), "set", data);
      if (!r.ok) {
        return true;
      }
      const p = s.publish(ADMIN, s.draftRev(), "");
      s.draftDiscard(defRef(key));
      return !p.ok;
    };
    try {
      expect(refused("Long Sword", { name: "Long Sword", strength: 9999 })).toBe(true);
      expect(refused("Long Sword", { name: "Long Sword", attack: { base: [{ flat: 1 }] } })).toBe(
        true,
      );
      expect(refused("Long Sword", { name: "Long Sword", colour: "red" })).toBe(true);
      expect(refused("No Such Sword", { name: "No Such Sword", strength: 1 })).toBe(true);
      expect(refused("Bob's Door", { name: "Bob's Door" })).toBe(true);
      expect(
        refused("Knight's Sword +1", { name: "Knight's Sword +1", behaviours: ["sword"] }),
      ).toBe(true);
      expect(refused("Long Sword", { name: "Long Sword", trains: ["Basket Weaving"] })).toBe(true);
      expect(
        refused("Long Sword", {
          name: "Long Sword",
          cooldowns: [
            { slot: "weapon", atDelay: 10, actionDelay: 10 },
            { slot: "weapon", atDelay: 2, actionDelay: 2 },
          ],
        }),
      ).toBe(true);
      // The same definition, valid, publishes.
      expect(refused("Long Sword", seed("Long Sword"))).toBe(false);
    } finally {
      installContent(classic);
    }
  });

  test("removing the item takes its definition with it (#28)", () => {
    const { s } = service();
    try {
      expect(s.draftSet(ADMIN, defRef("Ruby Ring"), "set", seed("Ruby Ring")).ok).toBe(true);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      // The definition is the item's own row, not a use of it.
      const used = s.usage("item", "Ruby Ring");
      expect(
        used.ok && used.value.uses.some((u) => u.where.startsWith("items/definitions/Ruby Ring")),
      ).toBe(false);
      const r = s.draftRemoval(ADMIN, {
        kind: "item",
        key: "Ruby Ring",
        content: "remove",
        copies: "purge",
        replacement: null,
        refundGold: 0,
      });
      expect(r.ok).toBe(true);
      expect(s.draft().some((d) => d.part === "definitions" && d.op === "remove")).toBe(true);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      expect(s.publishedContent().items.definitions ?? []).toEqual([]);
    } finally {
      installContent(classic);
    }
  });

  test("a retired item keeps its definition; a retirement settled into a removal takes it", () => {
    const world = (held: boolean): ContentWorld => ({
      usage: () => (held ? [{ place: "bag", count: 1 } as never] : []),
      holders: () => (held ? 1 : 0),
      begin: () => {},
      tell: () => {},
      apply: () => [],
      problems: () => [],
      rollback: () => {},
      commit: () => {},
    });
    // ("leave" would keep Ruby Ring's other references, which a retired or removed item refuses.)
    for (const [held, content] of [
      [true, "remove"],
      [false, "remove"],
    ] as const) {
      const { s } = service();
      try {
        expect(s.draftSet(ADMIN, defRef("Ruby Ring"), "set", seed("Ruby Ring")).ok).toBe(true);
        expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
        const r = s.draftRemoval(
          ADMIN,
          {
            kind: "item",
            key: "Ruby Ring",
            content,
            copies: "retire",
            replacement: null,
            refundGold: 0,
          },
          world(held),
        );
        expect(r.ok).toBe(true);
        const p = s.publish(ADMIN, s.draftRev(), "", world(held));
        expect(
          p.ok
            ? ""
            : `${held} ${content} ${p.error} ${JSON.stringify((p as { problems?: unknown }).problems)}`,
        ).toBe("");
        const live = s.publishedContent();
        const def = (live.items.definitions ?? []).some((d) => d.name === "Ruby Ring");
        // Held: retired, its rules kept for the copies. Not held: removed, definition and all.
        expect(def).toBe(held);
        expect(live.items.items.some((i) => i.name === "Ruby Ring")).toBe(held);
      } finally {
        installContent(classic);
      }
    }
  });

  test("unusable definitions are refused: two-handed off the weapon hand, worn with nothing to draw", () => {
    const ring = {
      ...CLASSIC,
      items: {
        ...CLASSIC.items,
        definitions: [{ name: "Ruby Ring", slot: "Ring", twoHanded: true }],
      },
    } as ContentData;
    expect(
      definitionProblems(ring)
        .map((p) => p.message)
        .join(),
    ).toContain("only a LeftHand weapon");
    expect(
      definitionProblems({
        ...CLASSIC,
        items: {
          ...CLASSIC.items,
          definitions: [{ name: "Long Sword", slot: "LeftHand", twoHanded: true }],
        },
      } as ContentData),
    ).toEqual([]);
    // A new weapon worn only through its definition, with no picture and no worn layer.
    const empty = (): ArtKeys => ({
      sprites: {
        tiles: new Set(),
        bodies: new Set(),
        paperdoll: new Set(),
        fx: new Set(),
        items: new Set(),
      },
      sounds: new Set(),
    });
    const next = {
      ...CLASSIC,
      items: {
        ...CLASSIC.items,
        items: [...CLASSIC.items.items, { name: "Moon Sword", icon: null }],
        definitions: [{ name: "Moon Sword", slot: "LeftHand" }],
      },
    } as unknown as ContentData;
    const gaps = newItemArtGaps(next, CLASSIC, empty(), empty(), empty());
    expect(gaps.map((g) => g.where)).toEqual(["items/items/Moon Sword"]);
    // And the art a definition-only worn item draws counts as used.
    expect(usedArt(next).sprites.paperdoll.has("moon sword")).toBe(true);
  });

  test("a pack update under a defined item: a notice that explains, accept gives the pack's rules back", () => {
    const db = openDatabase();
    runMigrations(db, loadMigrations(MIGRATIONS_DIR));
    const dir = mkdtempSync(join(tmpdir(), "sso-definition-pack-"));
    try {
      const s1 = service(RELEASE_PACK_DIRS, db).s;
      const sword = { ...seed("Long Sword"), strength: 23 };
      expect(s1.draftSet(ADMIN, defRef("Long Sword"), "set", sword).ok).toBe(true);
      expect(s1.draftSet(ADMIN, defRef("Broad Sword"), "set", seed("Broad Sword")).ok).toBe(true);
      // The operator's own sword, copied from Long Sword: no pack has it.
      const made = s1.draftItemChange(ADMIN, {
        name: "Zebra Sword",
        op: "create",
        copyFrom: "Long Sword",
      });
      expect(made.ok ? "" : made.error).toBe("");
      expect(s1.publish(ADMIN, s1.draftRev(), "").ok).toBe(true);
      expect(s1.notices()).toEqual([]);
      // The next Classic gives exactly "Long Sword" a Strength row of its own.
      cpSync(RELEASE_PACK_DIRS.classic as string, dir, { recursive: true });
      const file = join(dir, "data", "item-rules.json");
      const rules = JSON.parse(readFileSync(file, "utf8"));
      rules.equip.strength.push({ match: "exact", pattern: "Long Sword", strength: 5 });
      // A rule the operator's own item would also meet: still no notice for it (it follows no pack).
      rules.equip.strength.push({ match: "exact", pattern: "Zebra Sword", strength: 7 });
      writeFileSync(file, JSON.stringify(rules));
      const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify({ ...m, version: "9.9.9" }));
      const s2 = service({ ...RELEASE_PACK_DIRS, classic: dir }, db).s;
      // Only the Long Sword's definition: the Broad Sword's pack rules did not change.
      const notices = s2.notices();
      expect(notices.map((n) => [n.part, n.key, n.packVersion])).toEqual([
        ["definitions", "Long Sword", "9.9.9"],
      ]);
      expect(notices[0]?.note).toContain("no longer follows");
      // Named for the pack whose rule tables changed, not merely the last pack installed.
      expect(notices[0]?.note).toContain(`${notices[0]?.packName} v9.9.9 changed its rules`);
      expect(notices[0]?.packName).toBe("Classic");
      expect((notices[0]?.now as ItemDefinition | undefined)?.strength).toBe(5);
      // The definition still plays.
      expect(strengthRequirement("Long Sword")).toBe(23);
      // Taking the pack's version drops the definition: the pack's rules play again.
      const accepted = s2.acceptNotice(ADMIN, defRef("Long Sword"));
      expect(accepted.ok).toBe(true);
      expect(strengthRequirement("Long Sword")).toBe(5);
      expect(s2.notices()).toEqual([]);
      expect(s2.undo(ADMIN, accepted.ok ? accepted.value.id : "").ok).toBe(true);
      expect(strengthRequirement("Long Sword")).toBe(23);
      // Dismissing keeps the definition, and the notice goes.
      expect(s2.dismissNotice(ADMIN, defRef("Long Sword")).ok).toBe(true);
      expect(s2.notices()).toEqual([]);
      expect(strengthRequirement("Long Sword")).toBe(23);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      installContent(classic);
    }
  });
});
