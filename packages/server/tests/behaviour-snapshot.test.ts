/**
 * The behaviour snapshot (issue #37's safety net): what every name-based decision returns today for
 * every Classic item, monster and spell, and for the names the game builds at run time. Each check
 * group is a golden file in `tests/golden/behaviour/`, one keyed line per name. A change in any rule
 * shows up as a line diff; an intended one is recorded with `SSO_UPDATE_GOLDEN=1` and, when it
 * differs from 1.6, a differences entry (docs/modding.md, "The safety net").
 *
 * The snapshot records behaviour, bugs included: `bow` matches Bowmaster's Ring and Firesword's
 * `sword` test matches Swordfish.
 *
 * Rolls are recorded by their draws: a formula runs once with every `random(n)` answering 1 and
 * once answering `n`, and the line lists the results and the sizes drawn.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { ServerMsg } from "@secondstaronline/shared";
import {
  armourRows,
  attackPower,
  bagPicture,
  basePower,
  blocksMonster,
  blocksPlayer,
  bookDex,
  bowRefusal,
  castEffect,
  castMageCap,
  checkEquip,
  clickGate,
  closedName,
  content,
  crystalColour,
  crystalPile,
  crystalsFor,
  ctrlGate,
  damagedForm,
  deedUse,
  displayName,
  EQUIP_FIELD,
  type Equipment,
  elementalRows,
  equipSlotFor,
  type Faction,
  type Fighter,
  facedDoor,
  factionRows,
  fixedInPlace,
  gatherTool,
  gearBonus,
  groundDrawOffset,
  groundLayer,
  groundMember,
  groundOverlay,
  groundPicture,
  groundTipName,
  hidesName,
  isCrystal,
  isDoorOrSwitch,
  isFishingPole,
  isGoldName,
  isHarmful,
  isInert,
  isKey,
  isUniqueContainer,
  isWebBody,
  itemLabel,
  keyConsumed,
  keyPause,
  mageSkillCap,
  menuAction,
  monsterHitsPlayer,
  monsterSkillCap,
  NO_EQUIPMENT,
  NO_FACTION,
  NOTHING,
  normaliseLook,
  overlayWhenInUse,
  pvpHit,
  type Rng,
  regenTarget,
  rollArmourBreak,
  rollKillSkillGain,
  rollWeaponBreak,
  runBook,
  seedTile,
  skillCaps,
  skillIndex,
  spCost,
  spellHitOnMonster,
  spellImp,
  spellPower,
  strengthRequirement,
  summonFor,
  swingCooldowns,
  switchState,
  turnKey,
  useDeferred,
  useItem,
  weaponSkillList,
  wisAdd,
} from "@secondstaronline/shared";

import { swingSound } from "../src/systems/combat/melee.ts";
import { isWateringBucket } from "../src/systems/crafting/gather.ts";
import { containerCapacity, mayUseContainer } from "../src/systems/economy/containers.ts";
import {
  actionIntent,
  equipIntent,
  type ItemCtx,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { BODY, bodyOf, leansToward, neverMoves } from "../src/systems/monsters/slots.ts";
import { freeFireballs } from "../src/systems/spells/cast.ts";
import { isBook } from "../src/systems/spells/learn.ts";
import { addPlayer, createWorld, type Room, type World } from "../src/systems/world/world.ts";
import { expectGolden } from "./helpers/golden.ts";
import { player, rngByN, testMap } from "./helpers/sim.ts";

const DIR = join(import.meta.dir, "golden", "behaviour");
const golden = (file: string, lines: string[]) => expectGolden(join(DIR, file), lines.join("\n"));

// ---- the names ----------------------------------------------------------------------------

/** Names the game builds at run time: containers and pictures with ids, `+N`, owner fixtures, piles. */
const RUNTIME_FORMS = [
  "Crate#12",
  "Cabinet#3",
  "Wind Cabinet#5",
  "Cauldron#7",
  "Painting#4",
  "Photo#2",
  "Long Sword+3",
  "Plate Armor +1",
  "Bob's Door",
  "Bob's Opened Door",
  "Bob's Mailbox",
  "Bob's Board",
  "Bob's House Vault",
  "The X's Guild Vault",
  "Bob's Airship",
  "Bob's Boat",
  "Bob's Battleship",
  "Bob's Newspaper",
  "Doorman's Newspaper",
  "5 Gold",
  "60 Gold",
  "150 Gold",
  "5 Blue Crystal",
  "Damaged Helm, Fire",
];

function allNames(): string[] {
  const c = content();
  const names = new Set<string>();
  for (const i of c.items.items) {
    names.add(i.name);
  }
  for (const f of c.items.fixtures) {
    names.add(typeof f === "string" ? f : (f as { name: string }).name);
  }
  for (const m of c.craft.stations.smith.masterwork) {
    for (const o of m.outcomes) {
      names.add(o.result);
    }
  }
  for (const n of RUNTIME_FORMS) {
    names.add(n);
  }
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const NAMES = allNames();
const SPELLS = content()
  .spells.spells.map((s) => s.name)
  .sort();
const SPECIES = content()
  .monsters.monsters.map((m) => m.name)
  .sort();

// ---- helpers ------------------------------------------------------------------------------

/** An Rng that answers every draw 1 ("min") or `n` ("max") and records the sizes drawn. */
function rec(policy: "min" | "max"): Rng & { draws: number[] } {
  const draws: number[] = [];
  return {
    draws,
    random(n) {
      draws.push(n);
      if (!(n >= 1)) {
        return 0;
      }
      return policy === "min" ? 1 : Math.floor(n);
    },
  };
}

/** A roll run both ways: `min→max [draws]`, the draws of the min run. */
function roll<T>(f: (rng: Rng) => T): string {
  const lo = rec("min");
  const a = f(lo);
  const hi = rec("max");
  const b = f(hi);
  const sa = show(a);
  const sb = show(b);
  return `${sa === sb ? sa : `${sa}→${sb}`} [${lo.draws.join(",")}]`;
}

function show(v: unknown): string {
  if (v === null || v === undefined) {
    return "-";
  }
  if (typeof v === "string") {
    return JSON.stringify(v);
  }
  if (typeof v === "object") {
    return JSON.stringify(v);
  }
  return String(v);
}

/** A line: the name, then `key=value` fields. */
const line = (name: string, fields: Record<string, unknown>) =>
  `${name} | ${Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "string" && !v.includes(" [") ? v : show(v)}`)
    .join(" ")}`;

/** Skills by name; the rest 0. */
function skillArray(skills: Record<string, number> = {}, all = 0): number[] {
  const out = Array(content().classes.skills.length).fill(all) as number[];
  for (const [k, v] of Object.entries(skills)) {
    out[skillIndex(k)] = v;
  }
  return out;
}

function fighter(o: {
  str?: number;
  sta?: number;
  int?: number;
  wis?: number;
  level?: number;
  skills?: Record<string, number>;
  allSkills?: number;
  equip?: Partial<Equipment>;
  faction?: Faction;
  wanted?: boolean;
}): Fighter {
  return {
    level: o.level ?? 1,
    str: o.str ?? 10,
    sta: o.sta ?? 10,
    int: o.int ?? 10,
    wis: o.wis ?? 10,
    skills: skillArray(o.skills, o.allSkills ?? 0),
    equip: { ...NO_EQUIPMENT, ...o.equip },
    faction: o.faction ?? NO_FACTION,
    attackBonus: 0,
    wanted: o.wanted ?? false,
  };
}

/** The item worn where it equips, or held as a weapon when it equips nowhere. */
function wearing(name: string): Equipment {
  const slot = equipSlotFor(name);
  const field = slot === "No" ? "weapon" : EQUIP_FIELD[slot];
  return { ...NO_EQUIPMENT, [field]: name };
}

const FACTIONS: [string, Faction][] = [
  ["none", NO_FACTION],
  ...[1, 2, 3].flatMap((id) =>
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((b): [string, Faction] => [
      `f${id}b${b}`,
      { id: id as 1 | 2 | 3, f1Bonus: b, f2Bonus: b, f3Bonus: b },
    ]),
  ),
];

// ---- the checks ---------------------------------------------------------------------------

describe("the behaviour snapshot", () => {
  test("covers every Classic item, masterwork, spell and monster", () => {
    expect(NAMES.length).toBeGreaterThan(400);
    expect(SPELLS.length).toBeGreaterThan(30);
    expect(SPECIES.length).toBeGreaterThan(100);
  });

  test("item keyword predicates", () => {
    golden(
      "item-keywords.txt",
      NAMES.map((n) =>
        line(n, {
          key: isKey(n),
          book: isBook(n),
          bowNoArrows: bowRefusal({ weapon: n, offHand: NOTHING }, []) !== null,
          bowNoCrystal: show(bowRefusal({ weapon: n, offHand: "Blue Arrows" }, [])),
          hidesName: hidesName({ ...NO_EQUIPMENT, body: n }),
          gatherTool: show(gatherTool(n)),
          fishingPole: isFishingPole(n),
          wateringBucket: isWateringBucket(n),
          fireballs: show(freeFireballs(n, true)),
          seed: show(seedTile(n)),
          deed: show(deedUse(n)),
          gold: isGoldName(n),
          crystal: isCrystal(n),
          colour: show(crystalColour(n)),
          pile: show(crystalPile(n)),
          uniqueContainer: isUniqueContainer(n),
          display: show(displayName(n)),
          label: show(itemLabel(n)),
        }),
      ),
    );
  });

  test("swing cooldowns by weapon and skill", () => {
    golden(
      "swing.txt",
      NAMES.map((n) => {
        const at = (axe: number, mining: number) => {
          const c = swingCooldowns(
            { ...NO_EQUIPMENT, weapon: n },
            skillArray({ AxeFighting: axe, Mining: mining }),
          );
          return `${c.atDelay}/${c.actionDelay}`;
        };
        const ring = swingCooldowns(
          { ...NO_EQUIPMENT, weapon: n, ring: "Ring of Quickness" },
          skillArray(),
        );
        return line(n, {
          s0: at(0, 0),
          s45: at(45, 45),
          s75: at(75, 75),
          s95: at(95, 95),
          quick: `${ring.atDelay}/${ring.actionDelay}`,
          worn: (() => {
            const c = swingCooldowns(wearing(n), skillArray());
            return `${c.atDelay}/${c.actionDelay}`;
          })(),
          sound: show(swingSound(n)),
        });
      }),
    );
  });

  test("item rule tables", () => {
    const weak = { str: 0, wanted: false, equip: NO_EQUIPMENT };
    const strong = { str: 40, wanted: false, equip: NO_EQUIPMENT };
    const wanted = { str: 40, wanted: true, equip: NO_EQUIPMENT };
    const shielded = {
      str: 40,
      wanted: true,
      equip: { ...NO_EQUIPMENT, offHand: "Wooden Shield" },
    };
    const twoHanded = { str: 40, wanted: true, equip: { ...NO_EQUIPMENT, weapon: "War Hammer" } };
    const eq = (r: ReturnType<typeof checkEquip>) => (r.ok ? r.slot : r.text);
    const vitals = { hp: 10, hpMax: 50, sp: 10, spMax: 50, hunger: 10000 };
    golden(
      "item-rules.txt",
      NAMES.map((n) => {
        const worn = wearing(n);
        const look = normaliseLook(worn);
        return line(n, {
          slot: equipSlotFor(n),
          str: strengthRequirement(n),
          equipWeak: eq(checkEquip(n, weak)),
          equipStrong: eq(checkEquip(n, strong)),
          equipWanted: eq(checkEquip(n, wanted)),
          equipShield: eq(checkEquip(n, shielded)),
          equipTwoHanded: eq(checkEquip(n, twoHanded)),
          menu: menuAction(n),
          useSilent: useDeferred(n),
          use: roll((rng) => useItem(n, vitals, rng)),
          useStuffed: show(useItem(n, { ...vitals, hunger: 40000 }, rec("min"))),
          bookDex: bookDex(n),
          book: roll((rng) => runBook(n, skillArray({}, 10), [], rng)),
          look: show(look),
          gear: show({
            spell: gearBonus(worn, "spell"),
            attack: gearBonus(worn, "attack"),
            blackArts: gearBonus(worn, "blackArts"),
            martialArts: gearBonus(worn, "martialArts"),
          }),
          armour: `${armourRows(20, worn, "HitMe")}/${armourRows(20, worn, "HitMe2")}`,
          damaged: show(damagedForm(n)),
        });
      }),
    );
  });

  test("elemental armour by trigger", () => {
    const triggers = [
      ...new Set(content().itemRules.armour.elemental.map((r) => r.trigger)),
      "a Yeti",
      "Ice Sword",
    ].sort();
    golden(
      "elemental.txt",
      NAMES.flatMap((n) => {
        const worn = wearing(n);
        const hits = triggers
          .map((t) => [
            t,
            elementalRows(20, worn, "HitMe", t),
            elementalRows(20, worn, "HitMe2", t),
          ])
          .filter(([, a, b]) => a !== 20 || b !== 20)
          .map(([t, a, b]) => `${t}:${a}/${b}`);
        return hits.length ? [`${n} | ${hits.join(" ")}`] : [];
      }),
    );
  });

  test("equipment breaks", () => {
    const monsters = ["Slime", "Orc", "a Slime", "a Orc"];
    golden(
      "breaks.txt",
      NAMES.map((n) => {
        const worn = wearing(n);
        const all = { ...NO_EQUIPMENT, body: n, head: n, offHand: n, weapon: n };
        return line(n, {
          ...Object.fromEntries(
            monsters.map((m) => [
              `armour(${m})`,
              roll((rng) => rollArmourBreak(all, 10, 0, m, rng)),
            ]),
          ),
          ...Object.fromEntries(
            monsters.map((m) => [
              `weapon(${m})`,
              roll((rng) => rollWeaponBreak(worn, 10, 0, m, rng)),
            ]),
          ),
        });
      }),
    );
  });

  test("ground pictures, layers and tips", () => {
    golden(
      "ground.txt",
      NAMES.map((n) =>
        line(n, {
          picture: groundPicture(n),
          member: groundMember(n),
          bag: bagPicture(n),
          layer: groundLayer(n),
          offset: show(groundDrawOffset(n)),
          overlay: show(groundOverlay(n)),
          inUse: overlayWhenInUse(n),
          tip: show(groundTipName(n)),
          blocks: blocksPlayer(n, { level: 1, skills: skillArray() }),
          blocksMaster: blocksPlayer(n, { level: 200, skills: skillArray({}, 100) }),
          blocksMonster: blocksMonster(n),
          fixed: fixedInPlace(n, true),
          capacity: containerCapacity(n),
        }),
      ),
    );
  });

  test("ground click and Ctrl routing", () => {
    golden(
      "ground-routing.txt",
      NAMES.map((n) =>
        line(n, {
          click: show(clickGate(n)),
          ctrl: show(ctrlGate(n, { str: 10, mine: false })),
          ctrlStrong: show(ctrlGate(n, { str: 30, mine: false })),
          ctrlMine: show(ctrlGate(n, { str: 30, mine: true })),
        }),
      ),
    );
  });

  test("keys and doors", () => {
    const doors = NAMES.filter((n) => /door|switch/i.test(n)).concat([
      "The X's Door",
      "The X's Opened Door",
      "The Y's Door",
      "Al's Door",
    ]);
    const lines: string[] = [];
    for (const n of NAMES.filter((x) => isKey(x) || /door|switch/i.test(x))) {
      lines.push(
        line(n, {
          faced: show(facedDoor(["Rock", n, "Chair"])),
          doorOrSwitch: isDoorOrSwitch(n),
          switch: show(switchState(n)),
          closed: show(closedName(n)),
        }),
      );
    }
    for (const key of NAMES.filter(isKey)) {
      const turns = doors
        .map((d) => [d, turnKey(key, d, "Bob", "X")] as const)
        .filter(([, t]) => t.kind !== "silent")
        .map(([d, t]) => {
          const spent =
            t.kind === "turn" ? ` spent=${keyConsumed(t, key)} pause=${keyPause(t)}` : "";
          return `${d}→${show(t)}${spent}`;
        });
      lines.push(`key ${key} | ${turns.join(" ; ") || "-"}`);
    }
    golden("doors.txt", lines);
  });

  test("container access", () => {
    const bob = player("Bob", testMap("x1"), 5, 5);
    const guilded = player("Al", testMap("x1"), 5, 5);
    guilded.guild = "X";
    golden(
      "containers.txt",
      NAMES.filter((n) => /vault|crate|cabinet|cauldron|chest/i.test(n)).map((n) =>
        line(n, {
          capacity: containerCapacity(n),
          bob: mayUseContainer(bob, n),
          guildX: mayUseContainer(guilded, n),
        }),
      ),
    );
  });

  test("attack power by weapon", () => {
    const grid: [string, Fighter][] = [
      ["novice", fighter({ str: 5 })],
      ["mid", fighter({ str: 16, level: 20, allSkills: 45 })],
      ["master", fighter({ str: 20, level: 60, allSkills: 100 })],
    ];
    golden(
      "attack-power.txt",
      NAMES.map((n) =>
        line(n, {
          trains: weaponSkillList(n).join(",") || "-",
          ...Object.fromEntries(
            grid.flatMap(([k, f]) => {
              const plain = { ...f, equip: { ...f.equip, weapon: n } };
              const arrows = { ...f, equip: { ...f.equip, weapon: n, offHand: "Blue Arrows" } };
              return [
                [k, roll((rng) => attackPower(plain, rng).power)],
                [`${k}Arrows`, roll((rng) => attackPower(arrows, rng, () => true))],
              ];
            }),
          ),
        }),
      ),
    );
  });

  test("kill skill gain rolls", () => {
    // One weapon per distinct skill list, and bare hands.
    const byList = new Map<string, string>();
    for (const n of [NOTHING, ...NAMES]) {
      const list = weaponSkillList(n).join(",");
      if (!byList.has(list)) {
        byList.set(list, n);
      }
    }
    // Bodies with a monster cap of 10 (Spikes), 50 and the default 85.
    const bodies = [90, 35, 0];
    const lines: string[] = [];
    for (const [list, weapon] of [...byList].sort()) {
      for (const x of list === "" ? [50] : [0, 1, 29, 31, 49, 51, 61, 81, 99, 100]) {
        for (const [fk, faction] of FACTIONS.filter(([k]) =>
          ["none", "f1b3", "f2b2", "f2b5", "f3b4", "f3b9"].includes(k),
        )) {
          for (const [sta, wis] of [
            [5, 5],
            [20, 24],
          ] as const) {
            const outs = bodies.map((body) => {
              const lo = rec("min");
              const f = fighter({ sta, wis, int: 12, allSkills: x, faction, equip: { weapon } });
              const gained = rollKillSkillGain(f, body, lo);
              return `${body}:${gained.join("+") || "-"}[${lo.draws.join(",")}]`;
            });
            lines.push(
              `${weapon} (${list || "-"}) x=${x} ${fk} sta=${sta} wis=${wis} | ${outs.join(" ")}`,
            );
          }
        }
      }
    }
    golden("kill-skill-gain.txt", lines);
  });

  test("skill caps and the Wisdom and Intelligence tiers", () => {
    const lines: string[] = [];
    for (const [k, f] of FACTIONS) {
      lines.push(
        line(`faction ${k}`, {
          caps: show(skillCaps(fighter({ faction: f }))),
          mage: mageSkillCap(f),
          castMage: castMageCap(f),
        }),
      );
    }
    for (let w = 0; w <= 30; w++) {
      lines.push(`wisdom ${w} | add=${wisAdd(w)}`);
    }
    const bodies = [
      ...new Set([0, 200, ...content().monsters.monsters.map((m) => m.body)].sort((a, b) => a - b)),
    ];
    for (const b of bodies) {
      lines.push(
        `body ${b} | ${[0, 5, 6, 10, 11, 15, 16, 20, 21, 25, 26].map((i) => `int${i}=${monsterSkillCap(b, i)}`).join(" ")}`,
      );
    }
    golden("skill-caps.txt", lines);
  });

  test("faction perks", () => {
    golden(
      "factions.txt",
      FACTIONS.map(([k, faction]) => {
        const f = fighter({ str: 10, allSkills: 50, faction, equip: { weapon: "Long Sword" } });
        return line(k, {
          attack: roll((rng) => attackPower(f, rng).power),
          factionRows: factionRows(10, f),
          monsterHit: roll((rng) => monsterHitsPlayer(10, f, 0, rng)),
          pvpHit: roll((rng) => pvpHit(10, f, "Long Sword", 0, rng)),
          spellBase: basePower({ skills: f.skills, equip: f.equip, faction }),
          regen: regenTarget(faction.id === 3 ? faction.f3Bonus : null),
        });
      }),
    );
  });

  test("spells: power, school gain, cost and refusal", () => {
    const lines: string[] = [];
    const forms = [...SPELLS, "FireballL", "BoltR", "Wind waveU", "wind wave"];
    for (const s of forms) {
      lines.push(
        line(s, {
          effect: show(castEffect(s)),
          inert: isInert(s),
          harmful: isHarmful(s),
          sp: spCost(s, NOTHING),
          spNinja: spCost(s, "Ninja Outfit"),
          crystals: show(crystalsFor(s)),
          summon: show(summonFor(s)),
        }),
      );
      const powers = [0, 5, 11, 15, 25, 35, 55, 75, 85, 95, 98].map((v) => {
        const c = { skills: skillArray({}, v), equip: NO_EQUIPMENT, faction: NO_FACTION };
        const m = {
          skills: skillArray({}, v),
          equip: NO_EQUIPMENT,
          faction: { id: 1, f1Bonus: 3, f2Bonus: 0, f3Bonus: 0 } as Faction,
        };
        return `${v}:${spellPower(s, c)}/${spellPower(s, m)}`;
      });
      lines.push(`${s} | power ${powers.join(" ")}`);
      const imps = [1, 29, 30, 49, 50, 99].flatMap((v) =>
        [NO_FACTION, { id: 1, f1Bonus: 4, f2Bonus: 0, f3Bonus: 0 } as Faction].map((fac) => {
          const skills = skillArray({}, v);
          const lo = rec("min");
          const out = spellImp(s, skills, fac, lo);
          return `${v}/${fac.id}:${out.length}[${lo.draws.join(",")}]`;
        }),
      );
      lines.push(`${s} | gain ${imps.join(" ")}`);
      const skills = skillArray({}, 10);
      lines.push(`${s} | gainLines ${show(spellImp(s, skills, NO_FACTION, rec("min")))}`);
    }
    golden("spells.txt", lines);
  });

  test("monster species: bodies, rule tables and spell hits", () => {
    const rules = content().monsters.rules;
    const ruleNames = Object.keys(rules) as (keyof typeof rules)[];
    const matches = (n: string, rows: unknown): boolean => {
      if (!Array.isArray(rows)) {
        return false;
      }
      return rows.some((r: { match?: string; pattern?: string; name?: string }) => {
        const p = r.pattern ?? r.name ?? (typeof r === "string" ? r : "");
        if (typeof p !== "string" || p === "") {
          return false;
        }
        return r.match === "contains"
          ? n.toLowerCase().includes(p.toLowerCase())
          : n.toLowerCase() === p.toLowerCase();
      });
    };
    const lines = SPECIES.map((n) => {
      const body = bodyOf(n);
      return line(n, {
        body,
        neverMoves: neverMoves(body),
        web: isWebBody(body),
        pig: body === BODY.pig,
        holyShield: body === BODY.holyShield,
        undead: body === 61,
        leans: leansToward(n),
        rules: ruleNames.filter((k) => matches(n, rules[k])).join(",") || "-",
      });
    });
    // Each FX member against every body: the result, grouped by the bodies that share it.
    const members = new Set<string>();
    for (const s of content().spells.spells) {
      for (const f of s.fx) {
        members.add(f.member);
        for (const d of ["L", "R", "U", "D"]) {
          members.add(`${f.member}${d}-1`);
        }
        members.add(`${f.member}-1`);
      }
    }
    for (const fx of [
      "minor heal-3",
      "major heal-3",
      "meteor-13",
      "meteor-19",
      "BoltL-1",
      "Dispel Illusions-8",
      "splash-18",
      "crush-18",
      "Firebolt-12",
      "FireballL-1",
      "wind waveD-1",
      "Blue ArrowsL",
    ]) {
      members.add(fx);
    }
    const bodies = [
      ...new Set(
        [200, 445, ...content().monsters.monsters.map((m) => m.body)].sort((a, b) => a - b),
      ),
    ];
    for (const m of [...members].sort()) {
      const groups = new Map<string, number[]>();
      for (const b of bodies) {
        const r = roll((rng) => spellHitOnMonster(m, `${b}-1-1`, 5, 10, rng));
        groups.set(r, [...(groups.get(r) ?? []), b]);
      }
      if (groups.size === 1 && groups.has("- []")) {
        continue;
      }
      const parts = [...groups].map(([r, bs]) =>
        bs.length > 3 ? `${r} (${bs.length} bodies)` : `${r} (${bs.join(",")})`,
      );
      lines.push(`fx ${m} | ${parts.join(" ; ")}`);
    }
    golden("monsters.txt", lines);
  });

  test("items through the server's use, equip, click and Ctrl", () => {
    const lines: string[] = [];
    for (const n of NAMES) {
      const out: Record<string, string> = {};
      for (const action of ["use", "equip", "click", "ctrl"] as const) {
        out[action] = throughSystem(n, action);
      }
      lines.push(line(n, out));
    }
    golden("item-actions.txt", lines);
  });
});

/** One action on one item in a fresh scene: what was said and what changed. */
function throughSystem(name: string, action: "use" | "equip" | "click" | "ctrl"): string {
  const map = testMap("x1000y992");
  const world: World = createWorld();
  const rng = rngByN();
  const ctx: ItemCtx = { world, rng, now: 1_000_000 };
  const p = player("Bob", map, 5, 5);
  p.char.stats = { str: 30, sta: 15, dex: 30, int: 15, wis: 15 };
  p.char.vitals.hp = 10;
  p.char.vitals.sp = 10;
  p.char.hunger = 10000;
  p.facing = "E";
  addPlayer(world, p);
  p.loading = 0;
  p.flicker = 0;
  const room = world.rooms.get(map.name) as Room;
  try {
    let msgs: { to: string; msg: ServerMsg }[];
    if (action === "use" || action === "equip") {
      p.char.bag[0] = { item: name, qty: 1 };
      msgs = action === "use" ? useIntent(ctx, room, p, 1) : equipIntent(ctx, room, p, 1);
    } else {
      map.ground.push({ id: "g1", item: name, x: 6, y: 5, kind: "drop", expiresAt: null });
      msgs = action === "click" ? pickupIntent(ctx, room, p, "g1") : actionIntent(ctx, room, p);
    }
    const said = msgs
      .filter((m) => m.to === p.id)
      .map((m) =>
        m.msg.t === "chat"
          ? JSON.stringify(m.msg.text)
          : m.msg.t === "delta"
            ? `delta:${m.msg.events.map((e) => e.e).join("+")}`
            : m.msg.t,
      );
    const bag = p.char.bag
      .filter((l) => l !== null)
      .map((l) => `${l.item}x${l.qty}`)
      .join(",");
    const worn = Object.entries(p.char.equip)
      .filter(([, v]) => v !== NOTHING)
      .map(([k, v]) => `${k}:${v}`)
      .join(",");
    const ground = map.ground.map((g) => g.item).join(",");
    const v = p.char.vitals;
    return `{${said.join(" ")}} bag[${bag}] worn[${worn}] ground[${ground}] hp${v.hp} sp${v.sp} hunger${p.char.hunger}${p.container ? ` open:${p.container.name}` : ""}`;
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
}
