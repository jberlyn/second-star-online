/**
 * Gathering on the server: the tool part of a swing, fishing and the Watering Bucket's sprinkle,
 * seeds, regrowth and produce, and treasure. The rules are in shared/rules/crafting/gather.ts; this
 * applies them to the map, the ground and the player.
 */
import {
  buildTreasure,
  canPlant,
  castLine,
  EDITOR_MONSTERS,
  FACING_DELTA,
  FISHING_AT_DELAY,
  fishingOffset,
  GATHER_TEXT,
  gatherTool,
  hitCounter,
  isFishingPole,
  isFishingWater,
  lingoContains,
  lingoEq,
  type Rng,
  RUMOUR_NPCS,
  regrowthFrame,
  rollChunk,
  rollLogs,
  rollMiningFind,
  rollSkillGain,
  rumourLine,
  SPRINKLE_FX,
  type SwingSound,
  seedTile,
  shovelLayer1Ok,
  skillGainRule,
  skillIndex,
  sprinkleOffset,
  TREASURE,
  tileAt,
  wateredTile,
} from "@secondstaronline/shared";

import { addGround, ItemOut } from "../inventory/items.ts";
import { aqsToMap } from "../social/factions.ts";
import { queueCast } from "../spells/fx.ts";
import { playerLoc } from "../spells/geometry.ts";
import { type Outgoing, type Player, type Room, setTile, type World } from "../world/world.ts";

export interface GatherCtx {
  world: World;
  rng: Rng;
  /** Wall-clock ms: gathered drops decay like monster loot. */
  now: number;
  lootDecayMinutes: number;
}

/** What a swing's gathering produced, for the swing's own events. */
export interface GatherEvents {
  /** The swing sound when the tool is at its own tile (`treechop`, `swordhit2`). */
  sound: SwingSound | undefined;
  /** Lines for the gatherer (skill-ups, treasure). */
  lines: string[];
  /** Map events and sounds. */
  out: Outgoing[];
}

const skillOf = (p: Player, skill: string) => p.char.skills[skillIndex(skill)] ?? 0;

/** A skill handler's roll and, on a hit, the point and its line. */
function gain(p: Player, skill: string, rng: Rng, lines: string[]): boolean {
  const v = skillOf(p, skill);
  if (!rollSkillGain(skill, v, rng)) {
    return false;
  }
  p.char.skills[skillIndex(skill)] = v + 1;
  lines.push(skillGainRule(skill)?.text ?? "");
  return true;
}

function faced(p: Player): { x: number; y: number } {
  const [dx, dy] = FACING_DELTA[p.facing];
  return { x: p.x + dx, y: p.y + dy };
}

/** A gathered drop on (x, y): it decays like monster loot (no 20-item gate). */
function drop(ctx: GatherCtx, room: Room, io: ItemOut, item: string, x: number, y: number): void {
  addGround({ world: ctx.world, rng: ctx.rng, now: ctx.now }, room, io, {
    item,
    x,
    y,
    kind: "loot",
    expiresAt: ctx.now + ctx.lootDecayMinutes * 60_000,
  });
}

/** A tile change for everyone on the map. */
function change(
  ctx: GatherCtx,
  room: Room,
  io: ItemOut,
  layer: 1 | 2,
  x: number,
  y: number,
  code: string,
) {
  const ev = setTile(ctx.world, room.map, layer, x, y, code);
  if (ev) {
    io.all(ev);
  }
}

const sound = (p: Player, name: string, ch: number): Outgoing => ({
  to: p.id,
  msg: { t: "sound", name, ch },
});

/**
 * The attack routine's tool casts, before the attack power: the Watering Bucket's `sprinkle` on
 * every swing not facing north, and the Fishing Pole facing layer-1 water (the `Fishing` FX,
 * an attack delay of 20, and the fish drop). Returns the attack delay the swing leaves, or null.
 */
export function preSwing(room: Room, p: Player, ctx: GatherCtx, ev: GatherEvents): number | null {
  const weapon = p.char.equip.weapon;
  const me = playerLoc(p);
  if (lingoEq(weapon, "Watering Bucket") || weapon.toLowerCase().includes("watering bucket")) {
    const off = sprinkleOffset(p.facing);
    if (off) {
      const h = me.h + off[0];
      const v = me.v + off[1];
      queueCast(room, {
        owner: p.name,
        ownerId: p.id,
        name: SPRINKLE_FX,
        casterH: h,
        casterV: v,
        h,
        v,
        power: 1,
      });
    }
  }
  if (!isFishingPole(weapon)) {
    return null;
  }
  const t = faced(p);
  const io = new ItemOut(room);
  if (isFishingWater(tileAt(room.map.layers[0], t.x, t.y))) {
    const off = fishingOffset(p.facing);
    queueCast(room, {
      owner: p.name,
      ownerId: p.id,
      name: "Fishing",
      casterH: me.h,
      casterV: me.v,
      h: me.h + off[0],
      v: me.v + off[1],
      power: 1,
    });
    const r = castLine(skillOf(p, "Fishing"), p.antiMacro, p.stepFrames > 0, ctx.rng);
    p.antiMacro = r.antiMacro;
    if (r.fish) {
      drop(ctx, room, io, r.fish, t.x, t.y);
    }
    if (r.gained) {
      p.char.skills[skillIndex("Fishing")] = skillOf(p, "Fishing") + 1;
      ev.lines.push(skillGainRule("Fishing")?.text ?? "");
    }
  }
  ev.out.push(...io.out);
  return FISHING_AT_DELAY;
}

/**
 * The tool block of 1.6's attack routine, for the attacker: the tool's tile in front, its counter,
 * the tile change, the drop, the sounds and the skill handler. Any other tile does nothing (the
 * swing stays an ordinary attack). The Watering Bucket counts every swing.
 */
export function toolSwing(room: Room, p: Player, ctx: GatherCtx, ev: GatherEvents): void {
  const tool = gatherTool(p.char.equip.weapon);
  if (!tool) {
    return;
  }
  const t = faced(p);
  const layer2 = room.map.layers[1];
  const code = tileAt(layer2, t.x, t.y);
  const skill = skillOf(p, tool.skill);
  const io = new ItemOut(room);
  const midStep = p.stepFrames > 0;
  if (tool.counter === "Watering") {
    // No tile test before counting; a success on an unseeded tile is wasted.
    if (hitCounter(p.gather, "Watering", skill)) {
      const next = wateredTile(code);
      if (next) {
        change(ctx, room, io, 2, t.x, t.y, next);
      }
    }
    ev.out.push(...io.out);
    return;
  }
  if (tool.counter === "Dig" && !shovelLayer1Ok(room.map.layers[0], t.x, t.y)) {
    return;
  }
  if (!tool.tiles || !lingoEq(code, tool.tiles.from)) {
    return;
  }
  if (tool.hitSound) {
    ev.sound = tool.hitSound.name;
  }
  if (!hitCounter(p.gather, tool.counter, skill)) {
    return;
  }
  change(ctx, room, io, 2, t.x, t.y, tool.tiles.to);
  let found: string | null = null;
  if (tool.counter === "Chop") {
    found = rollLogs(skill, ctx.rng);
  } else if (tool.counter === "Mine") {
    found = lingoEq(tool.tool, "Mining Hammer")
      ? rollMiningFind(skill, ctx.rng)
      : rollChunk(tool.tool, skill, ctx.rng);
  }
  // Only while standing: a success mid-step loses its drop.
  if (found && !midStep) {
    drop(ctx, room, io, found, t.x, t.y);
  }
  if (tool.counter === "Dig") {
    digTreasure(ctx, room, io, ev, t.x, t.y);
  }
  if (tool.successSound) {
    io.out.push(sound(p, tool.successSound.name, tool.successSound.ch));
  }
  if (tool.imp) {
    gain(p, tool.skill, ctx.rng, ev.lines);
  }
  ev.out.push(...io.out);
}

/**
 * `treack` → 1.6's treasure check on every successful dig: on the treasure's map (exactly, not
 * 1.6's `contains`) `random(5) = 1` puts the item on the dug tile, tells the digger, and picks a
 * new treasure.
 */
function digTreasure(
  ctx: GatherCtx,
  room: Room,
  io: ItemOut,
  ev: GatherEvents,
  x: number,
  y: number,
): void {
  const tr = ctx.world.treasure;
  if (!tr || !lingoEq(tr.map, room.map.name)) {
    return;
  }
  if (ctx.rng.random(TREASURE.chance) !== 1) {
    return;
  }
  drop(ctx, room, io, tr.item, x, y);
  ev.lines.push(TREASURE.text);
  ctx.world.treasure = buildTreasure(ctx.world.treasureMaps, ctx.rng);
}

/**
 * The treasure question to a rumour NPC: the live monsters in the map's four slots, less any name
 * the World Editor's MONSTER list contains; each rumour NPC among them, in slot order, names the
 * treasure map's header (field 17) if it has one. The server sends `aqs`, which the asker's client
 * relays as a `sqa` line to the map, so everyone there reads it.
 */
export function sayTreasure(
  world: World,
  p: Player,
  rng: Rng,
  header: (map: string) => string,
): Outgoing[] {
  const room = world.rooms.get(p.map.name);
  const tr = world.treasure;
  if (!room || !tr) {
    return [];
  }
  const monsterList = EDITOR_MONSTERS.join("\r");
  const out: Outgoing[] = [];
  for (const slot of room.map.slots) {
    const name = slot.live?.name ?? "";
    if (name === "" || lingoContains(monsterList, name)) {
      continue;
    }
    if (!RUMOUR_NPCS.some((n) => lingoEq(n, name))) {
      continue;
    }
    const h = header(tr.map);
    if (h === "") {
      continue;
    }
    // `aqs`, relayed by the asker as `sqa`: muffled in a house and dropped by the asker's ignorers
    // like any relay.
    out.push(...aqsToMap(world, p, rumourLine(name, h, rng.random(2))));
  }
  return out;
}

/** The treasure list, built at server start and when the `treasureMaps` setting changes. */
export function resetTreasure(world: World, maps: readonly string[], rng: Rng): void {
  world.treasureMaps = [...maps];
  world.treasure = buildTreasure(world.treasureMaps, rng);
}

/**
 * Using seeds: the faced tile from your tile and facing; `"*SL*" contains` it (an off-map EMPTY
 * tile passes) → "You plant the seeds." and the seeded tile; else the wrong-tile line. The caller
 * uses up the seed either way. The 425-frame item-action pause after it only waited for the
 * server's `inx` reply in 1.6, so it is not kept.
 */
export function plantSeeds(world: World, room: Room, p: Player, item: string): Outgoing[] {
  const io = new ItemOut(room);
  const plants = seedTile(item);
  if (!plants) {
    return io.out;
  }
  const t = faced(p);
  const code = tileAt(room.map.layers[1], t.x, t.y);
  if (!canPlant(code)) {
    io.tell(p, GATHER_TEXT.plantWrong);
    return io.out;
  }
  io.tell(p, GATHER_TEXT.plant);
  // Off the map the server's word test refuses the change.
  const ev = setTile(world, room.map, 2, t.x, t.y, plants);
  if (ev) {
    io.all(ev);
  }
  return io.out;
}

/**
 * One player's frame of world ticks (as in 1.6, one roll per player on the map): skipped while the
 * player is loading; the six checks wait out the player's death-respawn pause (`regrowthStop`).
 */
export function regrowthStep(room: Room, p: Player, ctx: GatherCtx): Outgoing[] {
  const io = new ItemOut(room);
  if (p.loading > 0) {
    return io.out;
  }
  regrowthFrame(
    p.regrowthStop > 0,
    {
      layer2: () => room.map.layers[1],
      hasGround: (x, y) => room.map.ground.some((g) => g.x === x && g.y === y),
      setTile: (x, y, code) => change(ctx, room, io, 2, x, y, code),
      produce: (x, y, item) => drop(ctx, room, io, item, x, y),
    },
    ctx.rng,
  );
  return io.out;
}
