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
  blocksPlayer,
  bookDex,
  buildContentStore,
  type ContentData,
  compileDefinitions,
  content,
  damagedForm,
  equipSlotFor,
  groundDrawOffset,
  groundTipName,
  hasBehaviour,
  hitCounter,
  ID_CONTAINERS,
  installContent,
  isEngineFixture,
  isStorageContainer,
  isUniqueContainer,
  itemRequirementRefusal,
  menuAction,
  NO_EQUIPMENT,
  newGatherCounters,
  normaliseLook,
  type Rng,
  resolveIn,
  resolveItem,
  rollWeaponBreak,
  seedDefinition,
  strengthRequirement,
  swingCooldowns,
  toolUses,
  weaponSkillList,
} from "@secondstaronline/shared";

import type { ArtKeys } from "../src/content/art.ts";
import { newItemArtGaps, usedArt } from "../src/content/art-usage.ts";
import { type ContentActor, ContentService, clientCopyOf } from "../src/content/service.ts";
import { definitionProblems } from "../src/content/validate.ts";
import type { ContentWorld } from "../src/content/world.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";
import { containerCapacity, storageIntent } from "../src/systems/economy/containers.ts";
import { plays } from "./helpers/item-plays.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

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
  seedDefinition(name, resolveIn(name, d), d.items);

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
        expect(seedDefinition(name, resolveItem(name), content().items)).toEqual(seed(name));
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

describe("the rest of an item's rules (#30 stage 4)", () => {
  test("every Classic item's seed passes the definition checks and keeps the item lists", () => {
    // (An engine fixture, the Street Lamp, never has one.)
    const all = withDefinitions(NAMES.filter((n) => !isEngineFixture(n)).map((n) => seed(n)));
    expect(definitionProblems(all)).toEqual([]);
    const compiled = compileDefinitions(all);
    expect(compiled.items.editorItems).toEqual(CLASSIC.items.editorItems);
    expect(compiled.items.playerShopWhitelist).toEqual(CLASSIC.items.playerShopWhitelist);
    // A tool keeps the hit counter it shared with its family.
    expect(seed("Gold Axe").tools).toEqual([{ can: "Chop", counter: "Axe" }, { ladder: "axe" }]);
  });

  test("an empty definition takes away tools, breaking, the paperdoll, ground and container rules", () => {
    installContent(
      buildContentStore(
        withDefinitions([
          { name: "Gold Axe" },
          { name: "Long Sword" },
          { name: "Crate" },
          { name: "Ice Hammer" },
        ]),
      ),
    );
    try {
      expect(toolUses("Gold Axe")).toEqual([]);
      // The rest of the Axe family keeps the pack's rows.
      expect(toolUses("Axe").map((u) => u.can)).toEqual(["Chop"]);
      const always: Rng = { random: () => 1 };
      expect(rollWeaponBreak({ ...NO_EQUIPMENT, weapon: "Long Sword" }, 0, 0, "Orc", always)).toBe(
        false,
      );
      expect(rollWeaponBreak({ ...NO_EQUIPMENT, weapon: "Broad Sword" }, 0, 0, "Orc", always)).toBe(
        true,
      );
      expect(isUniqueContainer("Crate")).toBe(false);
      expect(ID_CONTAINERS.some((c) => c.toLowerCase() === "crate")).toBe(false);
      expect(normaliseLook({ ...NO_EQUIPMENT, weapon: "Ice Hammer" }).weapon).toBe("Ice Hammer");
    } finally {
      installContent(classic);
    }
  });

  test("set values play: a tool, a book, a picture when worn, the ground, a container, the lists", () => {
    installContent(
      buildContentStore(
        withDefinitions([
          {
            name: "Long Sword",
            slot: "LeftHand",
            tools: [{ can: "Chop", tier: 2 }],
            requires: [{ on: "equip", needs: "level", atLeast: 5 }],
            menu: "Smith",
            damaged: "Broken Sword",
            paperdoll: [{ layer: "weapon", becomes: "Ice Hammer" }],
            ground: { blocks: true, tipName: "A Sword", offset: { dx: 3, dy: -2 } },
            container: { capacity: 7, uniqueId: true },
            use: { mysticism: 40 },
            inEditorList: true,
          },
        ]),
      ),
    );
    try {
      expect(toolUses("Long Sword")).toEqual([{ can: "Chop", tier: 2, counter: "Long Sword" }]);
      expect(menuAction("Long Sword")).toBe("Smith");
      expect(damagedForm("Long Sword")).toBe("Broken Sword");
      expect(bookDex("Long Sword")).toBe(40);
      // Drawn as an Ice Hammer is: the pack's alias of that name still applies after its own.
      expect(normaliseLook({ ...NO_EQUIPMENT, weapon: "Long Sword" }).weapon).toBe("Mining Hammer");
      expect(groundTipName("Long Sword")).toBe("A Sword");
      expect(groundDrawOffset("Long Sword")).toEqual({ dx: 3, dy: -2 });
      expect(blocksPlayer("Long Sword", { level: 1, skills: [] })).toBe(true);
      expect(containerCapacity("Long Sword")).toBe(7);
      expect(isUniqueContainer("Long Sword")).toBe(true);
      expect(
        itemRequirementRefusal("Long Sword", "equip", { level: 1, skills: [] } as never),
      ).not.toBeNull();
      expect(content().items.editorItems.filter((n) => n === "Long Sword")).toHaveLength(1);
      expect(content().items.playerShopWhitelist.some((n) => n === "Long Sword")).toBe(false);
    } finally {
      installContent(classic);
    }
  });

  test("refused: a tool that does nothing, an unknown ladder or skill, two pictures for a layer", () => {
    const { s } = service();
    const refused = (data: unknown) => {
      const r = s.draftSet(ADMIN, defRef("Long Sword"), "set", data);
      if (!r.ok) {
        return true;
      }
      const p = s.publish(ADMIN, s.draftRev(), "");
      s.draftDiscard(defRef("Long Sword"));
      return !p.ok;
    };
    try {
      const base = seed("Long Sword");
      expect(refused({ ...base, tools: [{ tier: 2 }] })).toBe(true);
      expect(refused({ ...base, tools: [{ ladder: "no such ladder" }] })).toBe(true);
      expect(
        refused({ ...base, requires: [{ on: "use", needs: "Basket Weaving", atLeast: 1 }] }),
      ).toBe(true);
      expect(refused({ ...base, use: { skillBook: { skill: "Basket Weaving" } } })).toBe(true);
      expect(refused({ ...base, damaged: "No Such Sword" })).toBe(true);
      expect(refused({ ...base, damaged: "Damaged Sword, Broad" })).toBe(false);
      expect(
        refused({
          ...base,
          paperdoll: [
            { layer: "weapon", becomes: "Axe" },
            { layer: "weapon", becomes: "Dagger" },
          ],
        }),
      ).toBe(true);
      expect(refused({ ...base, requires: [{ on: "use", needs: "level", atLeast: 3 }] })).toBe(
        false,
      );
    } finally {
      installContent(classic);
    }
  });

  test("a copied item is drawn when worn as the item it was copied from", () => {
    const { s } = service();
    try {
      expect(
        s.draftItemChange(ADMIN, { name: "Moonblade", op: "create", copyFrom: "Long Sword" }).ok,
      ).toBe(true);
      const def = s.itemsView("Moonblade").item?.form as ItemDefinition;
      expect(def.paperdoll).toEqual([{ layer: "weapon", becomes: "Long Sword" }]);
    } finally {
      installContent(classic);
    }
  });
});

describe("stage 4 review fixes (#30)", () => {
  /** Classic with these definitions, installed. */
  const installed = (defs: ItemDefinition[]) =>
    installContent(buildContentStore(withDefinitions(defs)));

  test("a container's menu, capacity and ground rules match its #id copies (Sol 1, Neon 1)", () => {
    installed([
      { ...seed("Crate"), container: { capacity: 7, uniqueId: true } },
      {
        name: "Barrel",
        menu: "Storage",
        container: { capacity: 4, uniqueId: true },
        ground: { blocks: true },
      },
    ]);
    try {
      // An already-filled Crate#12 holds what the defined Crate holds.
      expect(containerCapacity("Crate#12")).toBe(7);
      expect(menuAction("Crate#12")).toBe("Storage");
      // A new carried container, newly acquired as Barrel#12, opens, holds and blocks as a Barrel.
      expect(isUniqueContainer("Barrel")).toBe(true);
      expect(menuAction("Barrel#12")).toBe("Storage");
      expect(containerCapacity("Barrel#12")).toBe(4);
      expect(blocksPlayer("Barrel#12", { level: 1, skills: [] })).toBe(true);
      // The resolver agrees.
      expect(resolveItem("Barrel#12").find((h) => h.key === "itemRules menu")).toBeDefined();
    } finally {
      installContent(classic);
    }
  });

  test("carried Storage needs a #id for each copy (Sol 2)", () => {
    const refused = (d: ItemDefinition) =>
      definitionProblems(withDefinitions([d])).some((p) => p.message.includes("#id"));
    expect(refused({ name: "Long Sword", menu: "Storage" })).toBe(true);
    expect(refused({ ...seed("Crate"), container: { capacity: 3 } })).toBe(true);
    expect(refused(seed("Crate"))).toBe(false);
  });

  test("carried Storage needs a container behaviour, so containers cannot nest", () => {
    const refused = (d: ItemDefinition) =>
      definitionProblems(withDefinitions([d])).some((p) =>
        p.message.includes("container behaviour"),
      );
    const barrel: ItemDefinition = {
      name: "Barrel",
      menu: "Storage",
      container: { capacity: 4, uniqueId: true },
    };
    expect(refused(barrel)).toBe(true);
    expect(refused({ ...barrel, behaviours: ["crate"] })).toBe(false);
    // Every Classic container, defined as it plays now, passes.
    for (const name of ["Crate", "Cabinet", "Wind Cabinet", "Cauldron"]) {
      expect({ name, refused: refused(seed(name)) }).toEqual({ name, refused: false });
    }
    // With the behaviour, the game counts it a container: one may not go inside another.
    installed([{ ...barrel, behaviours: ["crate"] }]);
    try {
      expect(isStorageContainer("Barrel#12")).toBe(true);
    } finally {
      installContent(classic);
    }
  });

  test("a copy held from before its item got a #id gets one when opened (Sol 2)", () => {
    installed([{ name: "Long Sword", menu: "Storage", container: { uniqueId: true } }]);
    try {
      const map = testMap("x1000y992");
      const s = setup([map], undefined, rngByN());
      const a = player("a", map, 5, 5);
      s.join(a);
      a.char.bag[0] = { item: "Long Sword", qty: 2 };
      storageIntent(s.world, a, 1, rngByN());
      // One copy of the stack takes an id of its own on a line of its own, and opens.
      expect(a.char.bag[0]).toEqual({ item: "Long Sword", qty: 1 });
      const own = a.char.bag[1]?.item ?? "";
      expect(own).toMatch(/^Long Sword#\d+$/);
      expect(a.container?.name).toBe(own);
      // A copy with an id keeps it, and its storage.
      a.container = null;
      a.keyLock = false;
      storageIntent(s.world, a, 2, rngByN());
      expect(a.char.bag[1]?.item).toBe(own);
      expect((a.container as { name: string } | null)?.name).toBe(own);
      // Without an id to give (no rng), a bare copy opens nothing.
      a.container = null;
      a.keyLock = false;
      expect(storageIntent(s.world, a, 1).length).toBe(1);
      expect(a.container).toBeNull();
    } finally {
      installContent(classic);
    }
  });

  test("a new item may not take a map fixture's name or a door's other form (Sol 3)", () => {
    const { s } = service();
    try {
      for (const name of ["Wooden Door", "Gold Chest", "Open Gold Door"]) {
        const r = s.draftItemChange(ADMIN, { name, op: "create", copyFrom: "Apple" });
        expect({ name, ok: r.ok }).toEqual({ name, ok: false });
      }
      expect(s.draft()).toEqual([]);
    } finally {
      installContent(classic);
    }
  });

  test("a masterwork's definition never changes its base item's needs or worn picture (Sol 4)", () => {
    const mw = "Knight's Sword +1";
    expect(
      definitionProblems(
        withDefinitions([
          { name: mw, requires: [{ on: "equip", needs: "level", atLeast: 50 }] },
          { name: "Sword of Hope +1", paperdoll: [{ layer: "weapon", becomes: "Axe" }] },
        ]),
      ),
    ).toHaveLength(2);
    // A definition with neither leaves the base's alias and needs alone (Neon 2).
    const base = classicPlaysLook("Knight's Sword");
    const own = classicPlaysLook(mw);
    installed([{ name: mw }]);
    try {
      expect(normaliseLook({ ...NO_EQUIPMENT, weapon: "Knight's Sword" }).weapon).toBe(base);
      expect(normaliseLook({ ...NO_EQUIPMENT, weapon: mw }).weapon).toBe(own);
    } finally {
      installContent(classic);
    }
  });

  test("definition aliases follow each other whatever their order; the resolver skips excepted rows (Sol 5)", () => {
    const a: ItemDefinition = {
      name: "Long Sword",
      paperdoll: [{ layer: "weapon", becomes: "Axe" }],
    };
    const b: ItemDefinition = {
      name: "Short Sword",
      paperdoll: [{ layer: "weapon", becomes: "Long Sword" }],
    };
    const drawn = (defs: ItemDefinition[]) => {
      installed(defs);
      try {
        return normaliseLook({ ...NO_EQUIPMENT, weapon: "Short Sword" }).weapon;
      } finally {
        installContent(classic);
      }
    };
    expect(drawn([a, b])).toBe(drawn([b, a]));
    // Clearing Ice Hammer's alias: the renderer draws Ice Hammer, and so does the resolver.
    installed([{ ...seed("Ice Hammer"), paperdoll: undefined }]);
    try {
      expect(normaliseLook({ ...NO_EQUIPMENT, weapon: "Ice Hammer" }).weapon).toBe("Ice Hammer");
      const hit = resolveItem("Ice Hammer").find((h) => h.key === "itemRules paperdoll.aliases");
      expect(hit).toBeUndefined();
    } finally {
      installContent(classic);
    }
    // A loop is refused.
    expect(
      definitionProblems(
        withDefinitions([
          { name: "Long Sword", paperdoll: [{ layer: "weapon", becomes: "Short Sword" }] },
          { name: "Short Sword", paperdoll: [{ layer: "weapon", becomes: "Long Sword" }] },
        ]),
      ).some((p) => p.message.includes("loop")),
    ).toBe(true);
  });

  test("a layer of its own clears a definition's alias; a missing alias target is refused (Sol 6, Neon 3)", () => {
    const { s } = service();
    try {
      expect(
        s.draftItemChange(ADMIN, { name: "Moonblade", op: "create", copyFrom: "Long Sword" }).ok,
      ).toBe(true);
      const view = s.wornArtView().items.find((i) => i.name === "Moonblade");
      expect(view?.ownLayerPossible).toBe(true);
      expect(s.draftWorn(ADMIN, { op: "ownLayer", item: "Moonblade" }).ok).toBe(true);
      expect(
        ((s.itemsView("Moonblade").item?.form ?? {}) as ItemDefinition).paperdoll,
      ).toBeUndefined();
    } finally {
      installContent(classic);
    }
    const published = withDefinitions([]);
    const next = withDefinitions([
      { ...seed("Long Sword"), paperdoll: [{ layer: "weapon", becomes: "No Such Blade" }] },
    ]);
    const keys = artKeysOf([], []);
    const packs = artKeysOf(NAMES, ["Long Sword-f1-s", "Axe-f1-s"]);
    expect(
      newItemArtGaps(next, published, packs, keys, keys).some((p) =>
        p.message.includes("No Such Blade"),
      ),
    ).toBe(true);
  });

  test("every matching platform row is kept (Sol 7)", () => {
    const data = withDefinitions([]);
    const rows = data.itemRules.ground.platforms;
    const two = {
      ...data,
      itemRules: {
        ...data.itemRules,
        ground: {
          ...data.itemRules.ground,
          platforms: [
            ...rows,
            { match: "exact", pattern: "Apple", needs: "level", atLeast: 5 },
            { match: "exact", pattern: "Apple", needs: "level", atLeast: 20 },
          ],
        },
      },
    } as ContentData;
    const def = seed("Apple", two);
    expect(def.ground?.platforms).toHaveLength(2);
    installContent(
      buildContentStore({ ...two, items: { ...two.items, definitions: [def] } } as ContentData),
    );
    try {
      expect(blocksPlayer("Apple", { level: 10, skills: [] })).toBe(true);
      expect(blocksPlayer("Apple", { level: 20, skills: [] })).toBe(false);
    } finally {
      installContent(classic);
    }
  });

  test("break slots are the ones the engine rolls (Sol 8)", () => {
    const { s } = service();
    try {
      const r = s.draftSet(ADMIN, defRef("Long Sword"), "set", {
        ...seed("Long Sword"),
        breaks: { weapon: ["BodyE"] },
      });
      expect(r.ok).toBe(false);
    } finally {
      installContent(classic);
    }
  });

  test("actions that never work are refused: a two-handed bow, Smith with no recipe (Sol 9)", () => {
    const problems = (d: ItemDefinition) => definitionProblems(withDefinitions([d]));
    expect(
      problems({ ...seed("Steel Bow"), twoHanded: true }).some((p) => p.message.includes("bow")),
    ).toBe(true);
    expect(
      problems({ ...seed("Long Sword"), menu: "Smith" }).some((p) => p.message.includes("Smith")),
    ).toBe(true);
  });

  test("a book's teaching is checked, and a copied spell book says it teaches nothing yet (Sol 10)", () => {
    const { s } = service();
    try {
      const skillBook = seed("Combat Book");
      const bad = {
        ...skillBook,
        use: { ...skillBook.use, skillBook: { skill: "Fighting", points: "1 + nosuchname" } },
      };
      const r = s.draftSet(ADMIN, defRef("Combat Book"), "set", bad);
      const p = r.ok ? s.publish(ADMIN, s.draftRev(), "") : r;
      expect(p.ok).toBe(false);
      s.draftDiscard(defRef("Combat Book"));
      const made = s.draftItemChange(ADMIN, {
        name: "Primer",
        op: "create",
        copyFrom: "Fireball Book",
      });
      expect(made.ok && made.value).toContain("teaches no spell");
      expect(
        ((s.itemsView("Primer").item?.form ?? {}) as ItemDefinition).use?.mysticism,
      ).toBeUndefined();
    } finally {
      installContent(classic);
    }
  });

  test("a copied tool names the gathering node it is not yet on; a counter may be any name (Sol 11)", () => {
    const { s } = service();
    try {
      const made = s.draftItemChange(ADMIN, {
        name: "Frost Pick",
        op: "create",
        copyFrom: "Ice Hammer",
      });
      expect(made.ok && made.value).toContain("add Frost Pick to that node's tools");
    } finally {
      installContent(classic);
    }
    const counters = newGatherCounters();
    let done = false;
    for (let i = 0; i < 100 && !done; i++) {
      done = hitCounter(counters, "constructor", 0);
    }
    expect(done).toBe(true);
  });

  test("a refusal names the field it is in (Sol 12, Neon 10)", () => {
    const { s } = service();
    try {
      const item = s.itemsView("Long Sword").item;
      const answer = s.draftItemChange(ADMIN, {
        name: "Long Sword",
        op: "set",
        data: { ...item?.form, requires: [{ on: "equip", needs: "Basket Weaving", atLeast: 1 }] },
        expect: item?.fingerprint,
      });
      expect(!answer.ok && answer.problems?.[0]?.where).toBe("Requirement 1");
    } finally {
      installContent(classic);
    }
  });

  test("a publish compiles the definitions once more, not once per build (Sol 13)", () => {
    const { s } = service();
    try {
      for (const n of ["Long Sword", "Apple", "Crate"]) {
        expect(s.draftSet(ADMIN, defRef(n), "set", seed(n)).ok).toBe(true);
      }
      const checked = s.check();
      expect(checked).toEqual([]);
      expect(s.publish(ADMIN, s.draftRev(), "").ok).toBe(true);
      // A shallow copy (a draft with an NPC Editor save, the store with uploaded art's rects) shares
      // the datasets the compile reads, and so its compiled tables.
      const published = s.publishedContent();
      const copy = { ...published, npcFiles: { ...published.npcFiles } };
      expect(compileDefinitions(copy).itemRules).toBe(compileDefinitions(published).itemRules);
      // The store the publish rebuilt compiled the tables the publish's checks compiled: the
      // installed store's tables are those very objects.
      expect(content().itemRules.equip).toBe(compileDefinitions(published).itemRules.equip);
    } finally {
      installContent(classic);
    }
  });

  test("a definition saved before stage 4 takes the rules it played, once (Sol 14, Neon 12)", () => {
    const db = openDatabase();
    // A database at migration 68 with a stage 3 Fishing Pole definition, published and drafted.
    const all = loadMigrations(MIGRATIONS_DIR);
    runMigrations(
      db,
      all.filter((m) => !m.name.includes("_69_")),
    );
    const old = { name: "Fishing Pole", slot: "LeftHand" };
    db.query(
      `INSERT INTO content_rows (dataset, part, row_key, op, data, base_hash, base_data, seq, updated_by, updated_at)
       VALUES ('items', 'definitions', 'Fishing Pole', 'set', ?, 'stale', NULL, 1, 'acc', '2026-11-24')`,
    ).run(JSON.stringify(old));
    runMigrations(db, all);
    const { s } = service(RELEASE_PACK_DIRS, db);
    try {
      const lines = s.backfillDefinitions();
      expect(lines).toHaveLength(1);
      expect(toolUses("Fishing Pole").map((u) => u.can)).toEqual(["Fish"]);
      // No pack notice for the groups it never chose.
      expect(s.notices()).toEqual([]);
      // Once.
      expect(s.backfillDefinitions()).toEqual([]);
    } finally {
      installContent(classic);
    }
  });
});

/** What Classic draws a weapon as. */
function classicPlaysLook(weapon: string): string {
  return normaliseLook({ ...NO_EQUIPMENT, weapon }).weapon;
}

/** Art keys holding these item pictures and worn frames. */
function artKeysOf(items: readonly string[], paperdoll: readonly string[]): ArtKeys {
  return {
    sprites: { items: new Set(items), paperdoll: new Set(paperdoll) },
    sounds: new Set(),
  } as unknown as ArtKeys;
}
