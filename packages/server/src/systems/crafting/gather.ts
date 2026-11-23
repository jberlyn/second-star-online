/**
 * Gathering on the server: the tool part of a swing, fishing and the Watering Bucket's sprinkle,
 * seeds, regrowth and produce, and treasure. The rules are in shared/rules/crafting/gather.ts; this
 * applies them to the map, the ground and the player.
 */
import {
  boundSkillIndex,
  buildTreasure,
  canPlant,
  castLine,
  EDITOR_MONSTERS,
  FACING_DELTA,
  FISHING_LAYERS,
  FISHING_STOPPED_TEXT,
  findSkillIndex,
  fishingOffset,
  fishingSpot,
  GATHER_TEXT,
  gatherTool,
  hitCounter,
  isFishingPole,
  isFishingWater,
  lingoContains,
  lingoEq,
  REGROWTH_CATCH_UP_FRAMES,
  type Rng,
  RUMOUR_NPCS,
  regrowthFrame,
  rollChunk,
  rollLogs,
  rollMiningFind,
  rollSkillGain,
  rumourLine,
  SKILL_KEYS,
  SPRINKLE_FX,
  type SwingSound,
  seedTile,
  shovelLayer1Ok,
  skillGainRule,
  skillValue,
  sprinkleOffset,
  swingCooldowns,
  TREASURE,
  tileAt,
  wateredTile,
} from "@secondstaronline/shared";

import { logPlaced } from "../admin/activity.ts";
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

const skillOf = (p: Player, skill: string) => skillValue(p.char.skills, skill);

/** A skill handler's roll and, on a hit, the point and its line. */
function gain(p: Player, skill: string, rng: Rng, lines: string[]): boolean {
  const i = findSkillIndex(skill);
  const v = i === undefined ? 0 : (p.char.skills[i] ?? 0);
  if (i === undefined || !rollSkillGain(skill, v, rng)) {
    return false;
  }
  p.char.skills[i] = v + 1;
  lines.push(skillGainRule(skill)?.text ?? "");
  return true;
}

function faced(p: Player): { x: number; y: number } {
  const [dx, dy] = FACING_DELTA[p.facing];
  return { x: p.x + dx, y: p.y + dy };
}

/** A gathered drop on (x, y): it decays like monster loot (no 20-item gate). */
function drop(
  ctx: GatherCtx,
  room: Room,
  io: ItemOut,
  item: string,
  x: number,
  y: number,
  by: Player | null = null,
  details: Record<string, string | boolean> | null = null,
): void {
  // The gatherer's activity log names what they found; regrowth has no gatherer.
  if (by) {
    logPlaced(ctx.world, by, "gather", item, { at: { map: room.map.name, x, y }, details });
  }
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

/** A weapon that sprinkles water on a swing: any name containing "watering bucket". */
export function isWateringBucket(weapon: string): boolean {
  return lingoEq(weapon, "Watering Bucket") || weapon.toLowerCase().includes("watering bucket");
}

/**
 * The attack routine's tool casts, before the attack power: the Watering Bucket's `sprinkle` on
 * every swing not facing north, and the Fishing Pole facing water on either layer (the `Fishing`
 * FX, an attack delay of 20, less the Ring of Quickness's speed-up, and the fish drop). Returns the
 * attack delay the swing leaves, or null.
 */
export function preSwing(room: Room, p: Player, ctx: GatherCtx, ev: GatherEvents): number | null {
  const weapon = p.char.equip.weapon;
  const me = playerLoc(p);
  if (isWateringBucket(weapon)) {
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
  // A world that binds no Fishing skill has no fishing.
  const fishing = boundSkillIndex("fishing");
  if (!isFishingPole(weapon) || fishing === undefined) {
    return null;
  }
  const t = faced(p);
  const io = new ItemOut(room);
  const layers = room.map.layers;
  if (FISHING_LAYERS.some((l) => isFishingWater(tileAt(layers[l - 1] ?? [], t.x, t.y)))) {
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
    // The allowance belongs to the tile you fish from, and outlasts a logout.
    const spot = fishingSpot(ctx.world.fishingSpots.get(p.id), p.map.id, p.x, p.y);
    const r = castLine(p.char.skills[fishing] ?? 0, spot.left, ctx.rng);
    ctx.world.fishingSpots.set(p.id, { ...spot, left: r.antiMacro });
    // A spent tile says so, once per press like a movement refusal.
    if (spot.left === 0 && p.told !== FISHING_STOPPED_TEXT) {
      ev.lines.push(FISHING_STOPPED_TEXT);
      p.told = FISHING_STOPPED_TEXT;
    }
    if (r.fish) {
      drop(ctx, room, io, r.fish, t.x, t.y, p);
    }
    if (r.gained) {
      p.char.skills[fishing] = (p.char.skills[fishing] ?? 0) + 1;
      ev.lines.push(skillGainRule(SKILL_KEYS[fishing] ?? "")?.text ?? "");
    }
  }
  ev.out.push(...io.out);
  // The Ring of Quickness shortens the cast (`swingCooldowns`).
  return swingCooldowns(p.char.equip, p.char.skills).atDelay;
}

/**
 * The tool block of 1.6's attack routine, for the attacker: the tool's tile in front, its counter,
 * the tile change, the drop, the sounds and the skill handler. Any other tile does nothing (the
 * swing stays an ordinary attack). The Watering Bucket counts only swings at a seeded tile. A
 * success mid-step drops on the changed tile like any other.
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
  if (tool.counter === "Watering") {
    // Only a seeded tile takes water, so only a swing at one counts.
    const next = wateredTile(code);
    if (next && hitCounter(p.gather, tool.tool, skill)) {
      change(ctx, room, io, 2, t.x, t.y, next);
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
  if (!hitCounter(p.gather, tool.tool, skill)) {
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
  if (found) {
    drop(ctx, room, io, found, t.x, t.y, p);
  }
  if (tool.counter === "Dig") {
    digTreasure(ctx, room, io, ev, t.x, t.y, p);
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
  p: Player,
): void {
  const tr = ctx.world.treasure;
  if (!tr || !lingoEq(tr.map, room.map.name)) {
    return;
  }
  if (ctx.rng.random(TREASURE.chance) !== 1) {
    return;
  }
  drop(ctx, room, io, tr.item, x, y, p, { treasure: true });
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
 * Using seeds: the faced tile from your tile and facing must be tilled soil (`SL`) → "You plant
 * the seeds." and the seeded tile, and `planted` tells the caller to use up one seed. Any other
 * tile, or off the map, gives the wrong-tile line and keeps the seed. The 425-frame item-action
 * pause after it only waited for the server's `inx` reply in 1.6, so it is not kept.
 */
export function plantSeeds(
  world: World,
  room: Room,
  p: Player,
  item: string,
): { out: Outgoing[]; planted: boolean } {
  const io = new ItemOut(room);
  const plants = seedTile(item);
  if (!plants) {
    return { out: io.out, planted: false };
  }
  const t = faced(p);
  const code = tileAt(room.map.layers[1], t.x, t.y);
  const ev = canPlant(code) ? setTile(world, room.map, 2, t.x, t.y, plants) : null;
  if (!ev) {
    io.tell(p, GATHER_TEXT.plantWrong);
    return { out: io.out, planted: false };
  }
  io.tell(p, GATHER_TEXT.plant);
  io.all(ev);
  return { out: io.out, planted: true };
}

/**
 * A map's world ticks: one regrowth frame per server tick, however many players are on it. A map
 * left empty (its room unloaded) catches up on the frames it missed, up to an hour's worth, when
 * the room next ticks.
 */
export function regrowthStep(room: Room, ctx: GatherCtx, tickNo: number): Outgoing[] {
  const io = new ItemOut(room);
  const map = room.map;
  const last = map.regrowthTick ?? tickNo - 1;
  const frames = Math.min(Math.max(tickNo - last, 0), REGROWTH_CATCH_UP_FRAMES);
  map.regrowthTick = tickNo;
  const hooks = {
    layer2: () => map.layers[1],
    hasGround: (x: number, y: number) => map.ground.some((g) => g.x === x && g.y === y),
    setTile: (x: number, y: number, code: string) => change(ctx, room, io, 2, x, y, code),
    produce: (x: number, y: number, item: string) => drop(ctx, room, io, item, x, y),
  };
  for (let i = 0; i < frames; i++) {
    regrowthFrame(hooks, ctx.rng);
  }
  return io.out;
}
