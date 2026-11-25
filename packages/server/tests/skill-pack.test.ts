/**
 * Issue #38: a test pack built through the Skills, Gathering and Items pages' server API, then
 * played. Two `xp`-model skills (one levelling by a table, one by a formula), two tiered picks and
 * a quarry node that trains Quarrying by 10 XP times the pick's tier: gathering with each tier
 * gains XP and levels up exactly as the pages' previews say.
 */
import { afterAll, describe, expect, test } from "bun:test";

import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  content,
  type DeltaEvent,
  gatherPreview,
  installContent,
  type PreviewContext,
  type ServerMsg,
  skillIndex,
  tileAt,
  withTile,
  xpPreview,
} from "@secondstaronline/shared";

import { draftGatheringChange, gatheringView } from "../src/content/gathering-page.ts";
import { type ContentActor, ContentService } from "../src/content/service.ts";
import { draftSkillChange, skillsView } from "../src/content/skills-page.ts";
import { seedNewWorld, worldToCreate } from "../src/content/world-seed.ts";
import { openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, MIGRATIONS_DIR, runMigrations } from "../src/persistence/migrations.ts";
import { setAttackHeld } from "../src/systems/combat/melee.ts";
import { player, rngByN, setup, testMap } from "./helpers/sim.ts";

const classic = content();
afterAll(() => installContent(classic));

const ADMIN: ContentActor = { accountId: "acc-admin", name: "Admin" };
type Out = { to: string; msg: ServerMsg }[];

function service() {
  const db = openDatabase();
  const creating = worldToCreate(db, "classic", RELEASE_PACK_DIRS);
  runMigrations(db, loadMigrations(MIGRATIONS_DIR));
  if (creating) {
    seedNewWorld(db, creating, RELEASE_PACK_DIRS, "2026-11-25T00:00:00.000Z");
  }
  let t = 0;
  return new ContentService({
    db,
    now: () => new Date(Date.UTC(2026, 10, 25, 0, 0, t++)).toISOString(),
    releasePacks: RELEASE_PACK_DIRS,
    onPublish: (store) => installContent(store),
  });
}

const ok = (r: { ok: boolean; error?: string; problems?: unknown; value?: unknown }) => {
  if (!r.ok) {
    throw new Error(`${r.error} ${JSON.stringify(r.problems ?? [])}`);
  }
};

/** Builds the pack through the pages and publishes it; returns the quarry's tiles. */
function buildPack(s: ContentService) {
  // Skills page: two xp skills.
  ok(
    draftSkillChange(s, ADMIN, {
      key: "Quarrying",
      op: "create",
      data: {
        progression: {
          model: "xp",
          curve: "quarry",
          on: {
            gather: {
              xp: [
                { op: "set", value: 10 },
                { op: "multiply", value: "tier" },
              ],
            },
          },
        },
        curve: {
          name: "quarry",
          expect: null,
          curve: { counting: "perLevel", table: [0, 100, 100, 150], formula: 200, cap: 20 },
        },
      },
    }),
  );
  ok(
    draftSkillChange(s, ADMIN, {
      key: "Masonry",
      op: "create",
      data: {
        display: "Stone Masonry",
        progression: { model: "xp", curve: "mason", on: { craft: { xp: 25 } } },
        curve: {
          name: "mason",
          expect: null,
          curve: {
            counting: "total",
            formula: [
              { op: "set", value: "level" },
              { op: "multiply", value: 100 },
            ],
          },
        },
      },
    }),
  );
  // Items page: two picks, tier 1 and tier 2, sharing one hit counter.
  for (const [name, tier] of [
    ["Bronze Pick", 1],
    ["Iron Pick", 2],
  ] as const) {
    ok(s.draftItemChange(ADMIN, { name, op: "create", copyFrom: "Mining Hammer" }));
    const item = s.itemsView(name).item;
    if (!item) {
      throw new Error(name);
    }
    ok(
      s.draftItemChange(ADMIN, {
        name,
        op: "set",
        data: { ...item.form, tools: [{ can: "Mine", tier, counter: "Pick" }] },
        expect: item.fingerprint,
      }),
    );
  }
  // Gathering page: a quarry node, and every success taking 2 hits.
  const g = gatheringView(s);
  const used = new Set(
    g.nodes.flatMap((n) => [n.node.tile.toLowerCase(), n.node.becomes.toLowerCase()]),
  );
  const [tile, becomes] = g.choices.tiles
    .map((t) => t.code)
    .filter((c) => c.length === 2 && !used.has(c.toLowerCase()));
  if (!tile || !becomes) {
    throw new Error("no free tiles");
  }
  ok(
    draftGatheringChange(s, ADMIN, {
      op: "newNode",
      data: {
        node: {
          tile,
          can: "Mine",
          becomes,
          skill: "Quarrying",
          gains: true,
          yield: "Quarry stone",
          hitSound: null,
          successSound: null,
        },
        yieldTable: { kind: "chance", item: "Logs", chance: 1 },
        // A new table: there was none under the name.
        yieldExpect: null,
        regrows: null,
      },
    }),
  );
  ok(
    draftGatheringChange(s, ADMIN, {
      op: "counter",
      data: [{ gt: -1, value: 2 }],
      expect: g.counter.fingerprint,
    }),
  );
  expect(s.check()).toEqual([]);
  ok(s.publish(ADMIN, s.draftRev(), "The quarry pack"));
  return { tile, becomes };
}

const CTX: PreviewContext = {
  stats: { level: 1, str: 1, sta: 1, int: 1, wis: 1, dex: 1 },
  tables: {},
  otherSkills: 0,
  tier: 1,
  caps: { faction: 50, mage: 30 },
  damage: 0,
  monsterCap: null,
};

describe("a test pack built through the Skills and Gathering pages", () => {
  test("gathering with each tier gains XP and levels up as the previews say", () => {
    const s = service();
    try {
      const { tile, becomes } = buildPack(s);
      const view = skillsView(s, "Quarrying");
      expect(view.skills.slice(-2).map((x) => [x.skill, x.model])).toEqual([
        ["Quarrying", "xp"],
        ["Masonry", "xp"],
      ]);
      const quarry = gatheringView(s).nodes.at(-1);
      if (!quarry || !view.skill?.curve) {
        throw new Error("the pack");
      }
      const settings =
        view.skill.row.progression?.model === "xp"
          ? view.skill.row.progression.on?.gather
          : undefined;
      // The previews: tier 1 gives 10 XP a success, tier 2 gives 20; a success takes 2 swings.
      const tier1 = xpPreview("Quarrying", view.skill.curve.curve, 100, settings || undefined, CTX);
      const tier2 = xpPreview("Quarrying", view.skill.curve.curve, 100, settings || undefined, {
        ...CTX,
        tier: 2,
      });
      expect(tier1[1]).toMatchObject({ level: 1, total: 0, need: 100, perAction: 10, actions: 10 });
      expect(tier2[1]).toMatchObject({ level: 1, perAction: 20, actions: 5 });
      const cells = gatherPreview(
        quarry.node,
        {
          counterTable: [{ gt: -1, value: 2 }],
          yields: { "Quarry stone": { kind: "chance", item: "Logs", chance: 1 } },
        },
        [1],
        [1, 2],
        { level: 1, otherSkills: 0 },
      );
      expect(cells.map((c) => [c.tier, c.hits, c.success, c.perSwing])).toEqual([
        [1, 2, 0.5, 0.5],
        [2, 2, 0.5, 0.5],
      ]);

      // Play: a quarry stone north of the player, a pick in hand.
      const map = testMap("x1000y992");
      map.layers[1] = withTile(map.layers[1], 5, 5, tile) ?? map.layers[1];
      const sim = setup([map], undefined, rngByN());
      const a = player("a", map, 5, 6);
      sim.join(a);
      const q = skillIndex("Quarrying");
      expect(a.char.skills[q]).toBe(1);
      const swing = (n: number): Out => {
        const out: Out = [];
        let done = 0;
        setAttackHeld(a, true);
        while (done < n) {
          const o = sim.run(1);
          out.push(...o);
          done += o
            .flatMap((x) => (x.to === "a" && x.msg.t === "delta" ? x.msg.events : []))
            .filter((e: DeltaEvent) => e.e === "swing").length;
        }
        setAttackHeld(a, false);
        return out;
      };
      const lines = (out: Out) =>
        out.flatMap((o) => (o.to === "a" && o.msg.t === "chat" ? [o.msg.text] : []));
      /** One success: the stone is put back after each. */
      const success = () => {
        map.layers[1] = withTile(map.layers[1], 5, 5, tile) ?? map.layers[1];
        const out = swing(2);
        expect(tileAt(map.layers[1], 5, 5)).toBe(becomes);
        return lines(out);
      };
      // Tier 1: 10 XP a success; level 1 to 2 takes 100 XP, so the 10th success levels up.
      a.char.equip.weapon = "Bronze Pick";
      for (let i = 1; i < (tier1[1]?.actions ?? 0); i++) {
        expect(success()).toEqual([]);
      }
      expect(success()).toEqual(["You have advanced in the art of Quarrying!"]);
      expect(a.char.skills[q]).toBe(2);
      expect(a.char.skillXp?.[q]).toBe(100);
      // Tier 2: 20 XP a success; level 2 to 3 takes another 100, so the 5th success.
      a.char.equip.weapon = "Iron Pick";
      for (let i = 1; i < (tier2[2]?.actions ?? 0); i++) {
        expect(success()).toEqual([]);
      }
      expect(success()).toEqual(["You have advanced in the art of Quarrying!"]);
      expect(a.char.skills[q]).toBe(3);
      expect(a.char.skillXp?.[q]).toBe(200);
      expect(tier2[2]?.actions).toBe(5);
    } finally {
      installContent(classic);
    }
  });
});
