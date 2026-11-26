/**
 * The behaviour snapshot (issue #37's safety net): what every name-based decision returns today for
 * every Classic item, monster and spell, and for the names the game builds at run time. Each check
 * group is a golden file in `tests/golden/behaviour/`, one keyed line per name. A change in any rule
 * shows up as a line diff; an intended one is recorded with `SSO_UPDATE_GOLDEN=1` and, when it
 * differs from 1.6, a differences entry (docs/modding.md, "The safety net").
 *
 * The snapshot records behaviour, 1.6's kept bugs included. Fixed ones show as the change that
 * fixed them (stage 3: Bowmaster's Ring is no bow, and Firesword passes over a Swordfish).
 *
 * Rolls are recorded by their draws: a formula runs once with every `random(n)` answering 1 and
 * once answering `n`, and the line lists the results and the sizes drawn.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import type { ServerMsg } from "@secondstaronline/shared";
import {
  ARROW_COLOURS,
  armourRows,
  attackPower,
  bagPicture,
  basePower,
  blocksMonster,
  blocksPlayer,
  bookDex,
  bowRefusal,
  burnedResult,
  CRYSTAL_COLOURS,
  castEffect,
  castMageCap,
  catchesFor,
  checkEquip,
  clickGate,
  closedName,
  content,
  cookResult,
  craftTimer,
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
  emptyBag,
  equipSlotFor,
  type Faction,
  type Fighter,
  facedDoor,
  factionPerk,
  factionRows,
  failurePool,
  fishCheck,
  fixedInPlace,
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
  isFootprint,
  isGoldName,
  isHarmful,
  isKey,
  isTrap,
  isUniqueContainer,
  isWateringTool,
  itemLabel,
  keyConsumed,
  keyPause,
  mageSkillCap,
  masterworkPool,
  meleeDamageVsMonster,
  meleeKillXp,
  menuAction,
  monsterHitsPlayer,
  monsterSkillCap,
  NO_EQUIPMENT,
  NO_FACTION,
  NOTHING,
  newFx,
  nodeTool,
  normaliseLook,
  orePool,
  overlayWhenInUse,
  paperdollLayers,
  placeFx,
  pvpHit,
  type Rng,
  regenTarget,
  repairResult,
  rollArmourBreak,
  rollKillSkillGain,
  rollMiningFind,
  rollWeaponBreak,
  rollYield,
  ruleMatches,
  runBook,
  seedTile,
  skillCaps,
  skillDisplay,
  skillIndex,
  smithChunk,
  spCost,
  spellDefense,
  spellHitOnMonster,
  spellImp,
  spellPower,
  startCraft,
  stepFx,
  strengthRequirement,
  summonFor,
  swingCooldowns,
  switchState,
  toolCan,
  train,
  turnKey,
  useDeferred,
  useItem,
  WATERING_SKILL,
  weaponSkillList,
} from "@secondstaronline/shared";

import { swingSound } from "../src/systems/combat/melee.ts";
import { containerCapacity, mayUseContainer } from "../src/systems/economy/containers.ts";
import { sellName } from "../src/systems/economy/shop.ts";
import {
  actionIntent,
  equipIntent,
  type ItemCtx,
  pickupIntent,
  useIntent,
} from "../src/systems/inventory/items.ts";
import { monsterAttack, monsterAttackValue } from "../src/systems/monsters/attack.ts";
import { clickNpc, ctrlPig } from "../src/systems/monsters/npc.ts";
import {
  bodyOf,
  defenseOf,
  leansToward,
  type MonsterSlot,
  neverMoves,
} from "../src/systems/monsters/slots.ts";
import { regenStep } from "../src/systems/progression/vitals.ts";
import { freeFireballs } from "../src/systems/spells/cast.ts";
import { onHolyShield } from "../src/systems/spells/geometry.ts";
import { isBook } from "../src/systems/spells/learn.ts";
import {
  addPlayer,
  createWorld,
  type Player,
  type Room,
  type World,
} from "../src/systems/world/world.ts";
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
  for (const m of c.craft.stations.smith!.masterwork) {
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

/** An Rng that answers the given values in turn, then 1, and records the sizes drawn. */
function seq(values: number[]): Rng & { draws: number[] } {
  const draws: number[] = [];
  let i = 0;
  return {
    draws,
    random(n) {
      draws.push(n);
      const v = values[i++] ?? 1;
      return Math.min(v, Math.max(1, Math.floor(n)));
    },
  };
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
/**
 * The gathering and crafting gains, in the order gather.json's `skillGain` rows listed them before
 * stage 6 (#37) moved them onto the skills' progression.
 */
const GAIN_SKILLS: [string, "gather" | "craft"][] = [
  ["Lumberjacking", "gather"],
  ["Shoveling", "gather"],
  ["Farming", "gather"],
  ["Mining", "gather"],
  ["Fishing", "gather"],
  ["Cooking", "craft"],
  ["Blacksmithing", "craft"],
  ["Alchemy", "craft"],
  ["Carpentry", "craft"],
];

/**
 * 1.6's Wisdom addition to the kill roll, now Classic's `wisdomBonus` stat table (#37 stage 6):
 * the table read as the roll reads it.
 */
function wisAdd(wisdom: number): number {
  const t = content().classes.progression.tables.wisdomBonus;
  return t ? t.tiers.reduce((v, r) => (wisdom > r.above ? v + r.add : v), t.start) : 0;
}

/** A book's result with its skill as the shown name the snapshot recorded before stage 6. */
function bookProjection(r: ReturnType<typeof runBook>) {
  return r.kind === "skill" ? { ...r, skill: skillDisplay(r.skill) } : r;
}

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

/**
 * Factions: none, then each faction with one bonus field set at a time, so a perk that reads the
 * wrong field shows.
 */
/** 1.6's faction numbers, 1 Mage, 2 Warrior, 3 Adventurer, as Classic's keys. */
const FACTION_KEYS = ["mage", "warrior", "adventurer"] as const;

/**
 * A faction as 1.6 held it: its number and the three bonuses, of which only the faction's own was
 * ever read (so `f1.f2b5`, a Mage with a Warrior bonus, is a Mage at tier 0). Tier 10 cannot occur:
 * the faction sort stops at 9.
 */
const FACTIONS: [string, Faction][] = [
  ["none", NO_FACTION],
  ...[1, 2, 3].flatMap((id) =>
    [1, 2, 3].flatMap((field) =>
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((b): [string, Faction] => [
        `f${id}.f${field}b${b}`,
        { key: FACTION_KEYS[id - 1] ?? null, tier: field === id ? b : 0 },
      ]),
    ),
  ),
];

const SKILL_NAMES = content().classes.skills.map((s) => s.skill);

/** The skills the kill gain rolls, and the requirement each tests after its roll. */
const KILL_SKILLS = [
  "HammerWielding",
  "AxeFighting",
  "Punch",
  "Archery",
  "MartialArts",
  "UnholyCombat",
  "Thrust",
  "StaffFighting",
  "Slash",
  "HeavyArms",
  "Swordsmanship",
  "Fencing",
];
const KILL_REQUIRES: Record<string, [string, number]> = {
  Thrust: ["Slash", 30],
  HeavyArms: ["Thrust", 60],
  Swordsmanship: ["Slash", 50],
  Fencing: ["Swordsmanship", 20],
};

/** The skills spell power and the cast gain read. */
const SPELL_SKILLS = [
  "Magery",
  "Blessing",
  "Wrath",
  "Illusion",
  "Water",
  "Earth",
  "Fire",
  "Wind",
  "BlackArts",
  "MartialArts",
  "Wizardry",
  "Sorcery",
];

/**
 * What a gathering tool does, without how the tables are written: the watering it does, else the
 * first harvest node it can work, in the shape the old one-row-per-tool table gave.
 */
function toolBehaviour(n: string) {
  const water = toolCan(n, "Water");
  if (water) {
    return {
      tool: water.counter,
      counter: "Watering",
      skill: WATERING_SKILL,
      tiles: null,
      sounds: [null, null],
      gains: false,
    };
  }
  for (const node of content().gather.harvest) {
    const use = nodeTool(n, node);
    if (use) {
      return {
        tool: use.counter,
        counter: node.can,
        skill: node.skill,
        tiles: { from: node.tile, to: node.becomes },
        sounds: [node.hitSound?.name ?? null, node.successSound?.name ?? null],
        gains: node.gains,
      };
    }
  }
  return null;
}

/**
 * The chunk a mining tool's success rolls: the chance yield of the Mine node it works (the old
 * per-hammer chunk table), drawing nothing for a tool with none.
 */
function rollChunk(tool: string, skill: number, rng: Rng): string | null {
  const node = content().gather.harvest.find((h) => h.can === "Mine" && nodeTool(tool, h));
  const table = node?.yield === undefined ? undefined : content().gather.yields[node.yield];
  return table?.kind === "chance" ? rollYield(node?.yield, skill, rng) : null;
}

/** A bag holding one line of `item`. */
function bagWith(item: string) {
  const bag = emptyBag();
  bag[0] = { item, qty: 1 };
  return bag;
}

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
          gatherTool: show(toolBehaviour(n)),
          fishingPole: isFishingPole(n),
          wateringBucket: isWateringTool(n),
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
        const at = (skills: Record<string, number>) => {
          const c = swingCooldowns({ ...NO_EQUIPMENT, weapon: n }, skillArray(skills));
          return `${c.atDelay}/${c.actionDelay}`;
        };
        const ring = swingCooldowns(
          { ...NO_EQUIPMENT, weapon: n, ring: "Ring of Quickness" },
          skillArray(),
        );
        return line(n, {
          s0: at({}),
          // Axe Fighting and Mining apart, so a ladder reading the other skill shows.
          ...Object.fromEntries(
            [45, 75, 95].flatMap((v) => [
              [`axe${v}`, at({ AxeFighting: v })],
              [`mining${v}`, at({ Mining: v })],
            ]),
          ),
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
    const weak = { level: 1, classCode: 1, skills: [], str: 0, wanted: false, equip: NO_EQUIPMENT };
    const strong = {
      level: 1,
      classCode: 1,
      skills: [],
      str: 40,
      wanted: false,
      equip: NO_EQUIPMENT,
    };
    const wanted = {
      level: 1,
      classCode: 1,
      skills: [],
      str: 40,
      wanted: true,
      equip: NO_EQUIPMENT,
    };
    const shielded = {
      level: 1,
      classCode: 1,
      skills: [],
      str: 40,
      wanted: true,
      equip: { ...NO_EQUIPMENT, offHand: "Wooden Shield" },
    };
    const twoHanded = {
      level: 1,
      classCode: 1,
      skills: [],
      str: 40,
      wanted: true,
      equip: { ...NO_EQUIPMENT, weapon: "War Hammer" },
    };
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
          book: roll((rng) => bookProjection(runBook(n, fighter({ allSkills: 10 }), [], rng))),
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
      ...new Set([
        ...content().itemRules.armour.elemental.map((r) => r.trigger),
        "a Yeti",
        "Ice Sword",
      ]),
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

  test("spell defence by worn item", () => {
    golden(
      "spell-defence.txt",
      NAMES.map((n) => {
        const equip = wearing(n);
        return line(n, {
          plain: roll((rng) => spellDefense(20, { equip, magicShield: false }, rng)),
          shield: roll((rng) => spellDefense(20, { equip, magicShield: true }, rng)),
          low: roll((rng) => spellDefense(2, { equip, magicShield: false }, rng)),
        });
      }),
    );
  });

  test("equipment breaks", () => {
    const monsters = ["Slime", "Orc", "a Slime", "a Orc"];
    // The slot pick is the second draw: 1 Body, 2 Head, 3 Right Hand.
    const picks: [string, number][] = [
      ["body", 1],
      ["head", 2],
      ["hand", 3],
    ];
    golden(
      "breaks.txt",
      NAMES.map((n) => {
        const worn = wearing(n);
        // The item only in the slot the draws pick, beside a sword; the other slots empty, so a
        // break read from the wrong slot shows.
        const inSlot: Record<string, Equipment> = {
          body: { ...NO_EQUIPMENT, weapon: "Long Sword", body: n },
          head: { ...NO_EQUIPMENT, weapon: "Long Sword", head: n },
          hand: { ...NO_EQUIPMENT, weapon: "Long Sword", offHand: n },
        };
        const all = { ...NO_EQUIPMENT, body: n, head: n, offHand: n, weapon: n };
        return line(n, {
          ...Object.fromEntries(
            monsters.flatMap((m) =>
              picks.map(([slot, pick]) => {
                const rng = seq([1, pick, pick, pick, pick]);
                const r = rollArmourBreak(inSlot[slot] as Equipment, 10, 0, m, rng);
                return [`armour(${m},${slot})`, `${show(r)}[${rng.draws.join(",")}]`];
              }),
            ),
          ),
          armourNoBreak: roll((rng) => rollArmourBreak(all, 10, 0, "Orc", rng)),
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
    const power = (f: Fighter) => attackPower(f, rec("min"), () => true).power;
    golden(
      "attack-power.txt",
      NAMES.map((n) => {
        // Each skill alone at 60 (Strength 16, level 30): the skills this weapon's blocks read.
        const alone = (skills: Record<string, number>, offHand = NOTHING) =>
          power(fighter({ str: 16, level: 30, skills, equip: { weapon: n, offHand } }));
        const base = alone({});
        const reads = SKILL_NAMES.map((s) => [s, alone({ [s]: 60 }) - base] as const)
          .filter(([, d]) => d !== 0)
          .map(([s, d]) => `${s}${d > 0 ? "+" : ""}${d}`);
        return line(n, {
          trains: weaponSkillList(n).join(",") || "-",
          base,
          reads: reads.join(",") || "-",
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
          // Every arrow colour, for a master.
          arrows: ARROW_COLOURS.map((c) => {
            const f = fighter({
              str: 20,
              level: 60,
              allSkills: 100,
              equip: { weapon: n, offHand: `${c} Arrows` },
            });
            return `${c}:${power(f)}`;
          }).join(","),
        });
      }),
    );
  });

  test("melee damage against each monster", () => {
    // Only the weapon and monster pairs whose damage differs from a weapon no row names.
    const dmg = (weapon: string, m: string) => {
      const lo = rec("min");
      const d = meleeDamageVsMonster(60, { name: m, defense: defenseOf(m) }, weapon, lo);
      return `${d}[${lo.draws.join(",")}]`;
    };
    const plain = new Map(SPECIES.map((m) => [m, dmg("~", m)]));
    const lines: string[] = [];
    for (const n of NAMES) {
      const hits = SPECIES.flatMap((m) => {
        const d = dmg(n, m);
        return d === plain.get(m) ? [] : [`${m}:${d}`];
      });
      if (hits.length) {
        lines.push(`${n} | ${hits.join(" ")}`);
      }
    }
    golden("melee-affinities.txt", lines);
  });

  test("kill skill gain: which skill each weapon trains, and its requirement", () => {
    // One weapon per distinct skill list, and bare hands.
    const byList = new Map<string, string>();
    for (const n of [NOTHING, ...NAMES]) {
      const list = weaponSkillList(n).join(",");
      if (!byList.has(list)) {
        byList.set(list, n);
      }
    }
    const lines: string[] = [];
    for (const [list, weapon] of [...byList].sort()) {
      for (const skill of KILL_SKILLS) {
        // The skill alone, then its requirement just failed and just met.
        const req = KILL_REQUIRES[skill];
        const cases: [string, Record<string, number>][] = [["alone", {}]];
        if (req) {
          cases.push([`${req[0]}=${req[1]}`, { [req[0]]: req[1] }]);
          cases.push([`${req[0]}=${req[1] + 1}`, { [req[0]]: req[1] + 1 }]);
        }
        const outs = cases.flatMap(([label, extra]) =>
          [1, 20, 21, 49, 51].map((x) => {
            const lo = rec("min");
            const f = fighter({ skills: { ...extra, [skill]: x }, equip: { weapon } });
            const gained = rollKillSkillGain(f, 0, lo);
            return `${label}/${x}:${gained.join("+") || "-"}[${lo.draws.join(",")}]`;
          }),
        );
        lines.push(`${weapon} (${list || "-"}) ${skill} | ${outs.join(" ")}`);
      }
      // Every skill at once, requirements met, with draws answering 1, 2, 1, 2 … : the order the
      // skills roll in, and which of them gain.
      // A Warrior at bonus 5 (cap 100), so no skill is held back by the cap.
      const order = [31, 45].map((x) => {
        const values = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 1 : 2));
        const rng = seq(values);
        const f = fighter({
          skills: Object.fromEntries(KILL_SKILLS.map((k) => [k, x])),
          equip: { weapon },
          faction: { key: "warrior", tier: 5 },
        });
        f.skills[skillIndex("Slash")] = 51;
        f.skills[skillIndex("Thrust")] = 61;
        f.skills[skillIndex("Swordsmanship")] = 21;
        const gained = rollKillSkillGain(f, 0, rng);
        return `all${x}:${gained.join("+") || "-"}[${rng.draws.join(",")}]`;
      });
      lines.push(`${weapon} (${list || "-"}) order | ${order.join(" ")}`);
    }
    golden("kill-skill-gain.txt", lines);
  });

  test("kill skill gain: roll sizes, caps and the monster's cap", () => {
    const lines: string[] = [];
    for (const skill of KILL_SKILLS) {
      // A weapon that trains it, with its requirement met.
      const weapon =
        [NOTHING, ...NAMES].find((n) =>
          weaponSkillList(n).some((s) => s.replace(/\s/g, "") === skill),
        ) ?? NOTHING;
      const req = KILL_REQUIRES[skill];
      const met = req ? { [req[0]]: 100 } : {};
      const draw = (o: Partial<Parameters<typeof fighter>[0]>, x: number, body = 0) => {
        const lo = rec("min");
        const f = fighter({ ...o, skills: { ...met, [skill]: x }, equip: { weapon } });
        const gained = rollKillSkillGain(f, body, lo).includes(skill);
        return `${gained ? "+" : "-"}[${lo.draws.join(",")}]`;
      };
      const sizes = [5, 10, 20].flatMap((sta) =>
        [0, 6, 11, 16, 21, 23, 24].map((wis) => `sta${sta}wis${wis}:${draw({ sta, wis }, 20)}`),
      );
      lines.push(`${skill} via ${weapon} | ${sizes.join(" ")}`);
      const caps = FACTIONS.filter(([k]) => /^(none|f[123]\.f\db(0|3|5|9))$/.test(k)).flatMap(
        ([k, faction]) =>
          // Intelligence 26 lifts the monster's cap past 99, so only the faction caps apply.
          [29, 30, 31, 49, 50, 51, 79, 80, 81, 99].map(
            (x) => `${k}/${x}:${draw({ faction, int: 26 }, x)}`,
          ),
      );
      lines.push(`${skill} caps | ${caps.join(" ")}`);
      const bodies = [90, 35, 0].flatMap((body) =>
        [9, 11, 49, 51].flatMap((x) =>
          [5, 21].map((int) => `body${body}/int${int}/${x}:${draw({ int }, x, body)}`),
        ),
      );
      lines.push(`${skill} monster cap | ${bodies.join(" ")}`);
    }
    golden("kill-skill-rolls.txt", lines);
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
        `body ${b} | ${[0, 5, 6, 10, 11, 15, 16, 20, 21, 22, 23, 25, 26].map((i) => `int${i}=${monsterSkillCap(b, i)}`).join(" ")}`,
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
          regen: regenTarget(factionPerk(faction, "regeneration")),
          regenServer: regenOf(faction),
        });
      }),
    );
  });

  test("spells: power, school gain, cost and refusal", () => {
    const lines: string[] = [];
    const forms = [...SPELLS, "FireballL", "BoltR", "Wind waveU", "wind wave"];
    const gearItems = [...new Set(content().itemRules.gear.map((r) => r.pattern))];
    for (const s of forms) {
      lines.push(
        line(s, {
          effect: show(castEffect(s)),
          harmful: isHarmful(s),
          sp: spCost(s, NOTHING),
          spNinja: spCost(s, "Ninja Outfit"),
          spRoyalNinja: spCost(s, "Royal Ninja Uniform"),
          crystals: show(crystalsFor(s)),
          summon: show(summonFor(s)),
        }),
      );
      // Each school skill alone, so a spell read from the wrong skill shows.
      const caster = (skills: Record<string, number>, faction = NO_FACTION, equip = NO_EQUIPMENT) =>
        spellPower(s, { skills: skillArray(skills), equip, faction });
      const base = caster({});
      const bySkill = SPELL_SKILLS.flatMap((k) =>
        [5, 11, 25, 55, 75, 85, 95, 98].map((v) => [k, v, caster({ [k]: v }) - base] as const),
      )
        .filter(([, , d]) => d !== 0)
        .map(([k, v, d]) => `${k}${v}:${d}`);
      const byFaction = [0, 1, 2, 3, 4].map(
        (b) => `f1b${b}:${caster({}, { key: "mage", tier: b }) - base}`,
      );
      const byOther = [2, 3].map(
        (id) => `f${id}:${caster({}, { key: FACTION_KEYS[id - 1] ?? null, tier: 4 }) - base}`,
      );
      const byGear = gearItems
        .map((g) => [g, caster({}, NO_FACTION, wearing(g)) - base] as const)
        .filter(([, d]) => d !== 0)
        .map(([g, d]) => `${g}:${d}`);
      lines.push(
        `${s} | power base=${base} ${bySkill.join(" ")} ${byFaction.join(" ")} ${byOther.join(" ")} gear ${byGear.join(",") || "-"}`,
      );
      // The cast gain: Magery alone, then each school alone, then Magery and the school together.
      const gain = (skills: Record<string, number>, faction: Faction) => {
        const lo = rec("min");
        const out = spellImp(s, { ...fighter({ faction }), skills: skillArray(skills) }, lo);
        return `${out.join("/") || "-"}[${lo.draws.join(",")}]`;
      };
      const mage4: Faction = { key: "mage", tier: 4 };
      const gains = ["Magery", ...SPELL_SKILLS.filter((k) => k !== "Magery")].flatMap((k) =>
        [10, 29, 31, 99].map((v) => `${k}${v}:${gain({ [k]: v }, NO_FACTION)}`),
      );
      lines.push(`${s} | gain ${gains.join(" ")}`);
      lines.push(
        `${s} | gainMage ${[29, 31, 99].map((v) => `${v}:${gain(Object.fromEntries(SPELL_SKILLS.map((k) => [k, v])), mage4)}`).join(" ")}`,
      );
    }
    golden("spells.txt", lines);
  });

  test("monster species: bodies, predicates and what the server does with them", () => {
    const rules = content().monsters.rules;
    const ruleNames = Object.keys(rules) as (keyof typeof rules)[];
    // The name tables with no predicate of their own, matched as the engine matches them.
    const inRows = (n: string, rows: unknown): boolean =>
      Array.isArray(rows) &&
      rows.some((r) => typeof r === "object" && r !== null && ruleMatches(n, r as never));
    const lines = SPECIES.map((n) => {
      const body = bodyOf(n);
      return line(n, {
        body,
        defense: defenseOf(n),
        attack: show(monsterAttackValue(n)),
        neverMoves: neverMoves(n),
        web: isTrap(n),
        footprint: isFootprint(n),
        leans: leansToward(n),
        killXp: `${meleeKillXp(30, n, NO_EQUIPMENT)}/${meleeKillXp(30, n, { ...NO_EQUIPMENT, ring: "Ring of Experience" })}`,
        rows: ruleNames.filter((k) => inRows(n, rules[k])).join(",") || "-",
        ...throughMonster(n),
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
    // 1.6 read these by body; SSO reads the flags of the species drawn with that body.
    const flagsOfBody = (b: number) =>
      content().monsters.monsters.find((x) => x.body === b)?.flags ?? {};
    for (const m of [...members].sort()) {
      const groups = new Map<string, number[]>();
      for (const b of bodies) {
        const r = roll((rng) => spellHitOnMonster(m, flagsOfBody(b), 5, 10, rng));
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

  test("spell effect placement and flight", () => {
    const names = new Set<string>([
      "sprinkle",
      "Slot Machine",
      "Fishing",
      "BSmith",
      "Music",
      "CannonballShotL",
      "CannonballShotR",
      "CannonballShotU",
      "CannonballShotD",
      ...["Blue", "Red", "White"].flatMap((c) =>
        ["L", "R", "U", "D"].map((d) => `${c} Arrows${d}`),
      ),
    ]);
    for (const sp of content().spells.spells) {
      names.add(sp.name);
      for (const f of sp.fx) {
        names.add(f.member);
        names.add(f.effect);
      }
    }
    const lines = [...names].sort().map((n) => {
      const at = placeFx(n, { h: 250, v: 200 }, { h: 380, v: 150 });
      if (!at) {
        return `${n} | -`;
      }
      const fx = newFx(n, at);
      const trail: string[] = [`${fx.h},${fx.v}f${fx.frame}`];
      let goneAt = "-";
      for (let i = 1; i <= 120; i++) {
        stepFx(fx, (x, y) => x === 12 && y === 5);
        if ([1, 2, 4, 8, 16, 32, 64].includes(i)) {
          trail.push(`${fx.h},${fx.v}f${fx.frame}`);
        }
        if (fx.gone) {
          goneAt = String(i);
          break;
        }
      }
      return `${n} | at=${at.h},${at.v} trail=${trail.join(" ")} gone=${goneAt}`;
    });
    golden("fx.txt", lines);
  });

  test("keys used on doors through the server", () => {
    const doors = NAMES.filter((n) => /door|switch/i.test(n)).concat([
      "The X's Door",
      "The X's Opened Door",
      "The Y's Door",
      "Al's Door",
    ]);
    const lines: string[] = [];
    for (const key of NAMES.filter(isKey)) {
      for (const door of doors) {
        lines.push(`${key} on ${door} | ${keyThroughServer(key, door)}`);
      }
    }
    golden("keys-through-server.txt", lines);
  });

  test("paperdoll layers by worn item and facing", () => {
    golden(
      "paperdoll.txt",
      NAMES.map((n) => {
        const look = { head: 1, equip: wearing(n) };
        const helmed = { head: 1, equip: { ...wearing(n), head: "Chain Helm" } };
        return line(n, {
          ...Object.fromEntries(
            (["S", "W", "N", "E"] as const).map((f) => [
              f,
              paperdollLayers(look, "F1", f).slice(1).join(","),
            ]),
          ),
          attackN: paperdollLayers(look, "F4", "N").slice(1).join(","),
          helmedS: paperdollLayers(helmed, "F1", "S").slice(1).join(","),
          hidesName: hidesName(wearing(n)),
        });
      }),
    );
  });

  test("gathering and crafting tables", () => {
    const lines: string[] = [];
    for (let skill = 0; skill <= 100; skill += 1) {
      lines.push(
        line(`skill ${skill}`, {
          ore: orePool(skill),
          find: roll((rng) => rollMiningFind(skill, rng)),
          chunks: ["Ice Hammer", "Fire Hammer", "Mining Hammer", "Axe"]
            .map((t) => `${t}:${roll((rng) => rollChunk(t, skill, rng))}`)
            .join(","),
          fish: show(
            catchesFor(skill)
              .map((c) => c.fish)
              .join("+") || null,
          ),
          fishCheck: fishCheck(skill),
          gains: GAIN_SKILLS.map(
            ([k, source]) =>
              `${k}:${roll((rng) => train(fighter({ skills: { [k]: skill } }), skillIndex(k), source, rng) === 1)}`,
          ).join(","),
          timers: (["Smith", "Cook", "Mix", "Build"] as const)
            .map((k) => `${k}:${craftTimer(k, skill)}`)
            .join(","),
          campfire: craftTimer("Cook", skill, true),
          failure: show(failurePool(skill)),
          masterwork: masterworkPool(skill),
        }),
      );
    }
    // Every item started at a station that is there, with each set of tools.
    const views: [string, { leftHand: string; rightHand: string }][] = [
      ["hammerSaw", { leftHand: "Blacksmith Hammer", rightHand: "Saw" }],
      ...CRYSTAL_COLOURS.map((c): [string, { leftHand: string; rightHand: string }] => [
        `${c.toLowerCase()}Sand`,
        { leftHand: NOTHING, rightHand: `${c} Sand` },
      ]),
      ["bare", { leftHand: NOTHING, rightHand: NOTHING }],
    ];
    for (const n of NAMES) {
      const starts = views.map(([k, tools]) => {
        const bag = emptyBag();
        bag[0] = { item: n, qty: 2 };
        // One of every chunk and crystal, so each repair and potion can start.
        [
          "Chunk of Iron",
          "Chunk of Steel",
          "Chunk of Star",
          "Chunk of Ice",
          "Chunk of Fire",
          ...CRYSTAL_COLOURS.map((c) => `${c} Crystal`),
        ].forEach((item, i) => {
          bag[i + 1] = { item, qty: 1 };
        });
        const r = startCraft(
          {
            bag,
            ...tools,
            skill: () => 40,
            facing: () => true,
            keyLock: false,
            itemPause: 0,
          },
          1,
        );
        return `${k}=${show(r)}`;
      });
      lines.push(
        `${n} | smithChunk=${show(smithChunk(n))} repair=${show(repairResult(n))} cook=${show(cookResult(n))} burned=${show(burnedResult(n))} sell=${show(sellName(n, 1, bagWith(`${n}#4`)))} ${starts.join(" ")}`,
      );
    }
    golden("gather-craft.txt", lines);
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
    return `{${said.join(" ")}} bag[${bag}] worn[${worn}] ground[${ground}] gold${p.char.gold} hp${v.hp} sp${v.sp} hunger${p.char.hunger}${p.container ? ` open:${p.container.name}` : ""}`;
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
}

/** What one action on a monster did: the lines and message kinds Bob got, and what changed. */
function throughMonster(name: string): Record<string, string> {
  const scene = (x: number, y: number, canFight = "X") => {
    const map = testMap("x1000y992");
    map.flags.canFight = canFight;
    const world = createWorld();
    const p = player("Bob", map, 5, 5);
    p.facing = "E";
    p.flicker = 0;
    addPlayer(world, p);
    p.loading = 0;
    const slot = map.slots[0] as MonsterSlot;
    slot.species = name;
    slot.live = {
      name,
      hp: 50,
      x,
      y,
      facing: "W",
      anim: 0,
      fromX: x,
      fromY: y,
      queue: [],
      hitCountb: 0,
    };
    return { map, world, p, slot, room: world.rooms.get(map.name) as Room };
  };
  const said = (
    out: { to: string; msg: ServerMsg }[] | undefined,
    p: Player,
    slot: MonsterSlot,
  ) => {
    const told = (out ?? [])
      .filter((m) => m.to === p.id)
      .map((m) => (m.msg.t === "chat" ? JSON.stringify(m.msg.text) : m.msg.t));
    const bag = p.char.bag.filter((l) => l !== null).map((l) => l.item);
    return `{${told.join(" ")}}${slot.live ? "" : " gone"}${bag.length ? ` bag[${bag.join(",")}]` : ""}${p.bio ? " bio" : ""}`;
  };
  const click = (x: number, y: number) => {
    const s = scene(x, y);
    return said(clickNpc(s.room, s.p, 1, rec("min")).out, s.p, s.slot);
  };
  const ctrl = (() => {
    const s = scene(6, 5);
    const r = ctrlPig(s.room, s.p, rec("min"));
    return r ? said(r.out, s.p, s.slot) : "-";
  })();
  const shield = (wanted: boolean) => {
    const s = scene(5, 5);
    s.p.char.wanted = wanted;
    return onHolyShield(s.p, s.map.slots);
  };
  const attack = (wanted: boolean, canFight = "X") => {
    const s = scene(6, 5, canFight);
    s.p.char.wanted = wanted;
    const r = monsterAttack(s.map, s.slot, s.p, {
      rng: rec("min"),
      npcs: s.world.npcs,
      invulnerable: () => false,
    });
    return r ? r.text : "-";
  };
  return {
    clickFaced: click(6, 5),
    clickFar: click(12, 9),
    ctrl,
    shieldsInnocent: String(shield(false)),
    shieldsWanted: String(shield(true)),
    attacksInnocent: attack(false),
    attacksWanted: attack(true),
    // A no-fight map: only an officer fights, and only the wanted.
    safeInnocent: attack(false, "O"),
    safeWanted: attack(true, "O"),
  };
}

/** The regeneration target the server uses for a faction: the frames until 1 HP comes back. */
function regenOf(faction: Faction): number {
  const map = testMap("x1");
  const p = player("Bob", map, 5, 5);
  p.char.faction = faction;
  p.char.hunger = 10000;
  p.char.vitals = { ...p.char.vitals, hp: 1, hpMax: 100 };
  p.regenCounter = 1;
  for (let i = 1; i < 1000; i++) {
    regenStep(p);
    if (p.char.vitals.hp > 1) {
      return i;
    }
  }
  return -1;
}

/** Bob uses `key` facing `door`: what was said and what the door and key became. */
function keyThroughServer(key: string, door: string): string {
  const map = testMap("x1000y992");
  const world = createWorld();
  const ctx: ItemCtx = { world, rng: rngByN(), now: 1_000_000 };
  const p = player("Bob", map, 5, 5);
  p.guild = "X";
  p.facing = "E";
  addPlayer(world, p);
  p.loading = 0;
  map.ground.push({ id: "d1", item: door, x: 6, y: 5, kind: "admin", expiresAt: null });
  p.char.bag[0] = { item: key, qty: 1 };
  const room = world.rooms.get(map.name) as Room;
  try {
    const out = useIntent(ctx, room, p, 1);
    const told = out
      .filter((m) => m.to === p.id && m.msg.t === "chat")
      .map((m) => JSON.stringify((m.msg as { text: string }).text));
    const bag = p.char.bag.filter((l) => l !== null).map((l) => `${l.item}x${l.qty}`);
    return `{${told.join(" ")}} door[${map.ground.map((g) => g.item).join(",")}] bag[${bag.join(",")}] pause${p.itemPause}`;
  } catch (e) {
    return `throws ${(e as Error).message}`;
  }
}
