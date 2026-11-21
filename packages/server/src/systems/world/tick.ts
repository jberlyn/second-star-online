/**
 * One sim tick = one original frame.
 *
 * The order is the 1.6 frame order. 1.6 ran each sprite's script in score-channel order, twice a
 * frame, around the frame script's key poll: once a map had loaded (a flag every map load set and
 * play never cleared), the frame script ran the sprites' scripts once before the key poll and once
 * after it. So a frame is: the frame-script counters (step 4 below), actor pass 1 (steps 1-3b),
 * the key poll (attack, the exit-item check, the step, the periodic save), actor pass 2 (steps
 * 1-3b again), then step 5.
 * Per map, for each player in arrival order where a step is per player:
 *  1. the timer: regen;
 *  2. the player sprite: i-frames, the action delay, the attack animation, the walk animation;
 *  3. the spawner, slot 1's monster script (attack rolls, walk tick), the move-author pick; then
 *     slots 2-4's monster scripts. Rolls the original made once per client run once per player (at
 *     most 15 players). The mover also tests the spell FX against the monsters and, between its
 *     pick and its move, runs each slot's monster spells;
 *  3b. the spell FX step;
 *  4. the frame script: the network message places the casts sent last frame; then per player the
 *     NPC spell block, Smoke Bomb, the spell collision, the death lock, hunger, the morph counter,
 *     the death pause counter, the no-spawn counter after a map entry, the pauses, the bar and the
 *     attack delay, the buff counters, the death check; after actor pass 1, the key poll: attack
 *     before movement;
 *  5. map changes, portals and respawn warps, chat cooldowns, the server's 350 ms timer, then
 *     outgoing state and saves.
 */
import {
  CANNOT_FIGHT_TEXT,
  CHAT_COLOR,
  can,
  DEFAULT_DEATH_DROPS,
  type DeathDropRules,
  type DeltaEvent,
  deathText,
  EDGE_BLOCKED_TEXT,
  exitTarget,
  isJailMap,
  isWalkable,
  JAIL,
  lingoEq,
  MODERATION_TEXT,
  neighbourMapName,
  type Rng,
  STEPFRAMES_PER_FRAME,
  sunkText,
  TICK_HZ,
  tickAttackTimers,
  tickSpriteTimers,
  USE_TEXT,
} from "@secondstaronline/shared";

import { type CasinoDeps, casinoMapChange, casinoTick } from "../casino/index.ts";
import { slotTick } from "../casino/slots.ts";
import { hears } from "../chat/ignore.ts";
import { hopTo } from "../combat/arena.ts";
import { pollAttack } from "../combat/melee.ts";
import { craftStep } from "../crafting/craft.ts";
import { regrowthStep } from "../crafting/gather.ts";
import { saveClockStep } from "../economy/containers.ts";
import { leaveTrade } from "../economy/trade.ts";
import { relockStep } from "../housing/doors.ts";
import { houseClockStep, restRegen } from "../housing/houses.ts";
import { decayLoot, dueGives, type ItemCtx, ItemOut } from "../inventory/items.ts";
import { moverPass, tickPauses, walkTick } from "../monsters/ai.ts";
import { monsterAttack } from "../monsters/attack.ts";
import { chatterOut, chatterTick } from "../monsters/npc.ts";
import { monsterView } from "../monsters/slots.ts";
import { spawnPass } from "../monsters/spawn.ts";
import {
  advancePlayer,
  type EdgeCrossing,
  type MoveCtx,
  movePlayer,
  tellOnce,
  tickLoading,
} from "../movement/movement.ts";
import { medalCheck } from "../progression/medals.ts";
import {
  ageLastHit,
  checkDeath,
  finishDeath,
  hungerStep,
  regenStep,
} from "../progression/vitals.ts";
import { lightningOn, scoreKill } from "../social/assassin.ts";
import { aqsToMap, loyaltyFrame } from "../social/factions.ts";
import { submitHighScore } from "../social/highscores.ts";
import { flagKiller } from "../social/murder.ts";
import {
  holdDefenseStep,
  morphStep,
  npcSpellBlockStep,
  smokeBombStep,
  swordShieldStep,
} from "../spells/buffs.ts";
import {
  type CollideCtx,
  type CollideOut,
  cannonballHits,
  monsterHits,
  playerCollision,
} from "../spells/collide.ts";
import { advanceFx, placeQueued } from "../spells/fx.ts";
import { serverTimer } from "../spells/hazards.ts";
import { monsterSpells } from "../spells/monsterspells.ts";
import {
  enterRoom,
  inventoryView,
  leaveRoom,
  type Outgoing,
  type Player,
  type Room,
  selfState,
  statsOf,
  vitalsView,
  type World,
  type WorldMap,
  walkGridFor,
} from "./world.ts";

export interface TickDeps {
  /** Finds a map by its `x<mx>y<my>` name, or null when there is none. */
  loadMap(name: string): WorldMap | null;
  /** Finds a map by id (the stored respawn point), or null. */
  loadMapById?(id: string): WorldMap | null;
  /** Where a player goes when their place is gone (the operator's Fallback map setting). */
  fallbackPoint?: { map: string; x: number; y: number };
  saveIntervalTicks: number;
  rng: Rng;
  /** Server minute of the hour, for Zombie and Skeleton spawns. */
  minute?(): number;
  /** Wall-clock ms, for loot decay. */
  now?(): number;
  /** Minutes before monster loot decays (setting `lootDecay`, in minutes, default 30). */
  lootDecayMinutes?: number;
  /** Seconds between a talking NPC's RND lines (setting `npcChatter`, default 150). */
  npcChatterSeconds?: number;
  /** Whose deaths drop gold or an item, and how (settings `deathDrops` and the rest of Items). */
  deathDrops?: DeathDropRules;
  /** Where Portal sends players (setting `portalTargets`); with none, a Portal cast is refused. */
  portalTargets?: readonly { map: string; x: number; y: number }[];
  /** The Server Spirit's map (setting `hazardMap`), or null. */
  hazardMap?: string | null;
  /**
   * The blackjack reset and reconnect grace. Required: every warp needs it to pay out a stake
   * forfeited by leaving mid-hand (tests with no casino pass `NO_CASINO`).
   */
  casino: CasinoDeps;
  /**
   * The perf tick probe: called after each stretch of the tick ("rooms": every map's pass and its
   * delta messages; "world": portals to jail; "players": the per-player flush). Absent in normal
   * play and tests, so the sim stays pure.
   */
  phase?(name: "rooms" | "world" | "players"): void;
}

export interface TickResult {
  out: Outgoing[];
  /** Players whose position and vitals should be written now. */
  saves: Player[];
  /** Maps whose monster slots should be written now. */
  slotSaves: WorldMap[];
  /** Players whose gold, bag or equipment changed this tick (written with the ground log). */
  invSaves: Player[];
  /** Players whose client sent its month report this frame, in order. */
  houseChecks: Player[];
}

/** Rolls taken for at most this many players on a map. */
export const MAX_EMULATED_PLAYERS = 15;
/** Monster HP and positions are saved at least this often (frames) besides spawns and deaths. */
export const SLOT_SAVE_TICKS = 600;

/** Colour of the death line. */
export const DEATH_TEXT_COLOR = CHAT_COLOR.death;

const isInvulnerable = (p: Player) => can(p.role, "invulnerable");

/** The players whose client rolls are emulated: everyone, or a random 15. */
function emulated(room: Room, rng: Rng): Player[] {
  const all = room.players;
  if (all.length <= MAX_EMULATED_PLAYERS) {
    return all;
  }
  const pool = [...all];
  const out: Player[] = [];
  while (out.length < MAX_EMULATED_PLAYERS) {
    out.push(pool.splice(rng.random(pool.length) - 1, 1)[0] as Player);
  }
  return out.sort((a, b) => all.indexOf(a) - all.indexOf(b));
}

export function tick(world: World, deps: TickDeps): TickResult {
  const out: Outgoing[] = [];
  const saves = new Set<Player>();
  const deaths = new Set<Player>();
  const houseChecks: Player[] = [];
  const slotSaves = new Set<WorldMap>();
  const invSaves = new Set<Player>();
  const crossings: EdgeCrossing[] = [];
  const respawns: Player[] = [];
  const portals: Player[] = [];
  const exits: { player: Player; exit: "Exit" | "Exit2" }[] = [];
  const { rng } = deps;
  const tell = (to: Player, text: string, color: number = CHAT_COLOR.normal) =>
    out.push({ to: to.id, msg: { t: "chat", text, color } });
  world.tickNo += 1;
  const itemCtx: ItemCtx = { world, rng, now: deps.now?.() ?? 0 };

  const collideCtx: CollideCtx = {
    rng,
    item: itemCtx,
    lootDecayMinutes: deps.lootDecayMinutes ?? 30,
    tick: world.tickNo,
  };

  for (const room of world.rooms.values()) {
    const map = room.map;
    const n = room.players.length;
    /** Events for everyone on the map; `except` is left out (it gets `you` instead). */
    const events: { except: string | null; ev: DeltaEvent }[] = [];
    const all = (ev: DeltaEvent) => events.push({ except: null, ev });
    const players = [...room.players];

    // 1-3b are one actorList pass, run twice per frame inside the frame script (once a map has
    // loaded it advances the frame itself): once between the counters and the key poll, and once
    // after the key poll.
    // The emulated-client pick is taken once and shared by both passes.
    const rollers = emulated(room, rng);
    let slotEvent = false;
    for (const p of players) {
      tickLoading(p);
      ageLastHit(p);
    }
    const actorPass = () => {
      // 1. The timer sprite.
      for (const p of players) {
        regenStep(p);
      }
      // 2. The player sprite.
      for (const p of players) {
        if (p.flicker > 0) {
          p.flicker -= 1;
        }
        tickSpriteTimers(p.timers);
        advancePlayer(p);
      }
      // 3. Monsters.
      for (const p of rollers) {
        if (p.deadLock > 0 || p.loading > 0 || p.monDropIn > 0 || p.dontHitMeAgain) {
          continue;
        }
        for (const s of spawnPass(map, { rng, players: n, minute: deps.minute?.() ?? 0 })) {
          all({ e: "mspawn", monster: monsterView(s) });
          slotEvent = true;
        }
      }
      for (const slot of map.slots) {
        if (slot.live) {
          // The spell-hit lockout counts down in the slot's script.
          if (slot.live.hitCountb > 0) {
            slot.live.hitCountb -= 1;
          }
          for (const p of players) {
            const o = monsterAttack(map, slot, p, {
              rng,
              npcs: room.npcs,
              invulnerable: isInvulnerable,
            });
            if (o) {
              all({ e: "phit", id: o.victim.id, text: o.text, color: o.color, splat: o.splat });
              for (const line of o.lines) {
                tell(o.victim, line);
              }
            }
          }
          const step = walkTick(map, slot, { players: room.players, rng });
          if (step && slot.live) {
            const m = slot.live;
            all({
              e: "mmove",
              slot: slot.slot,
              fromX: step.fromX,
              fromY: step.fromY,
              toX: m.x,
              toY: m.y,
              facing: m.facing,
            });
          }
        }
        if (slot.slot === 1) {
          // The mover's spell test, once (per-client copies are a P2P artefact).
          if (map.slots.some((s) => s.live)) {
            const hits: CollideOut = {
              events: [],
              out: [],
              portals: [],
              slotsChanged: false,
              broadcasts: [],
            };
            monsterHits(room, collideCtx, hits);
            for (const ev of hits.events) {
              all(ev);
            }
            out.push(...hits.out);
            // A spell kill's broadcast goes out as a melee kill's does.
            for (const b of hits.broadcasts) {
              for (const o of world.players.values()) {
                if (hears(o, b.from)) {
                  tell(o, b.text);
                }
              }
            }
            if (hits.slotsChanged) {
              slotEvent = true;
            }
          }
          for (const p of rollers) {
            if (p.deadLock > 0 || p.loading > 0) {
              continue;
            }
            const step = moverPass(room.npcs, map, p, n, rng, room.players, () =>
              monsterSpells(room, p, rng),
            );
            if (step?.slot.live) {
              const m = step.slot.live;
              all({
                e: "mmove",
                slot: step.slot.slot,
                fromX: step.fromX,
                fromY: step.fromY,
                toX: m.x,
                toY: m.y,
                facing: m.facing,
              });
            }
          }
        }
      }

      // 3b. The spell FX sprites' `stepFrame` (channels 260+).
      advanceFx(room);
      // 3c. Cannonball shots stop at what they meet (an SSO addition).
      if (room.fx.length > 0) {
        const shots: CollideOut = {
          events: [],
          out: [],
          portals: [],
          slotsChanged: false,
          broadcasts: [],
        };
        cannonballHits(room, collideCtx, shots);
        for (const ev of shots.events) {
          all(ev);
        }
        out.push(...shots.out);
        for (const b of shots.broadcasts) {
          for (const o of world.players.values()) {
            if (hears(o, b.from)) {
              tell(o, b.text);
            }
          }
        }
        if (shots.slotsChanged) {
          slotEvent = true;
        }
      }
    };

    // 4. The frame script: the counters. The NPC spell block counts down at its top, then its
    //    network message places last frame's casts.
    for (const p of players) {
      npcSpellBlockStep(p);
    }
    const placed = placeQueued(room, rng);
    for (const ev of placed.events) {
      all(ev);
    }
    for (const l of placed.lines) {
      tell(l.to, l.text);
    }
    tickPauses(map);
    // RND chatter: each talking monster speaks on its own fixed interval, heard by the whole map.
    for (const slot of map.slots) {
      const said = chatterTick(room.npcs, slot, (deps.npcChatterSeconds ?? 150) * TICK_HZ, rng);
      if (said) {
        out.push(...chatterOut(room, said, undefined, true));
      }
    }
    // The door-lock countdown: one timer per map, the earliest client's; at 0 the open coloured and
    // switch doors close.
    const relock = new ItemOut(room);
    relockStep(itemCtx, room, relock);
    out.push(...relock.out);
    // A slot pull's 30-frame spin, settled by the server.
    for (const p of players) {
      out.push(...slotTick(rng, p));
    }
    const ctx: MoveCtx = {
      rng,
      emit: (actor, ev) => events.push({ except: actor.id, ev }),
      tell: (to, text) => tell(to, text),
      crossings,
      send: (o) => out.push(o),
    };
    // The world ticks: one regrowth frame per map, however many players are on it.
    out.push(
      ...regrowthStep(
        room,
        { world, rng, now: itemCtx.now, lootDecayMinutes: deps.lootDecayMinutes ?? 30 },
        world.tickNo,
      ),
    );
    for (const p of players) {
      const spells: CollideOut = {
        events: [],
        out: [],
        portals: [],
        slotsChanged: false,
        broadcasts: [],
      };
      smokeBombStep(room, p, spells);
      playerCollision(room, p, collideCtx, spells);
      for (const ev of spells.events) {
        all(ev);
      }
      out.push(...spells.out);
      for (const q of spells.portals) {
        if (!portals.includes(q)) {
          portals.push(q);
        }
      }
      // The faction-drop run while `Fctcnt > 0`.
      const loyalty = loyaltyFrame(world, p);
      if (loyalty.line) {
        tell(p, loyalty.line);
      }
      if (loyalty.kicked) {
        saves.add(p);
      }
      if (p.deadLock > 0) {
        p.deadLock -= 1;
        if (p.deadLock === 0) {
          respawns.push(p);
        }
      }
      const warning = hungerStep(p, can(p.role, "noHunger"), rng);
      if (warning) {
        tell(p, warning);
      }
      const bodies: { events: DeltaEvent[] } = { events: [] };
      morphStep(p, bodies);
      for (const ev of bodies.events) {
        all(ev);
      }
      if (p.deathPause > 0) {
        p.deathPause -= 1;
      }
      if (p.monDropIn > 0) {
        p.monDropIn -= 1;
      }
      // The piggy-bank countdown.
      if (p.piggie > 0) {
        p.piggie -= 1;
      }
      // The item-action pause counts down here.
      if (p.itemPause > 0) {
        p.itemPause -= 1;
      }
      // The five-minute countdown: the clock reply sends the month report.
      if (houseClockStep(p)) {
        houseChecks.push(p);
      }
      // The crafting counters: Smith, Cook, Build, Mix.
      out.push(...craftStep(room, p, { world, rng }, itemCtx.now));
      tickAttackTimers(p.timers);
      if (p.cannonReload > 0) {
        p.cannonReload -= 1;
      }
      // Rest regen in a house.
      restRegen(p, rng);
      // The buff counters: Hold and Stone Skin, the attack counter (Argon's Fist, the Purple
      // Potion), then Firesword and Magic Shield.
      holdDefenseStep(p, (text) => tell(p, text));
      if (p.timers.attackCounter > 0) {
        p.timers.attackCounter -= 1;
        if (p.timers.attackCounter === 0) {
          tell(p, USE_TEXT.argonEnds);
          p.attackBonus = 0;
        }
      }
      swordShieldStep(p, (text) => tell(p, text));
      const death = checkDeath(room, p, rng, {
        item: itemCtx,
        rules: deps.deathDrops ?? DEFAULT_DEATH_DROPS,
        everyDeath: can(p.role, "dropOnEveryDeath"),
        lightningGame: lightningOn(world),
      });
      if (death.kind === "death") {
        deaths.add(p);
        out.push(...death.out);
        for (const line of death.lines) {
          tell(p, line);
        }
        saves.add(p);
      } else if (death.kind === "arena") {
        // The line is the dead player's own `sqa`, filtered by ignore lists.
        out.push(...aqsToMap(world, p, death.text));
        if (death.tile) {
          // The `3` message re-places the sprite for everyone.
          for (const ev of hopTo(p, death.tile.x, death.tile.y)) {
            events.push({ except: p.id, ev });
          }
        }
      }
    }

    // Actor pass 1: a held-in-place player stays on the frame.
    actorPass();

    // The key poll: attack before movement, then the periodic save.
    for (const p of players) {
      const swing = pollAttack(room, p, {
        rng,
        now: itemCtx.now,
        lootDecayMinutes: deps.lootDecayMinutes ?? 30,
        world,
        lightning: lightningOn(world),
      });
      if (swing.cannotFight) {
        tell(p, CANNOT_FIGHT_TEXT);
      }
      if (swing.swing) {
        all({ e: "swing", id: p.id, ...swing.swing });
      }
      for (const h of swing.hits) {
        all({ e: "mhit", slot: h.slot.slot, dmg: h.dmg, kill: h.kill });
        if (h.kill) {
          slotEvent = true;
          saves.add(p);
        }
      }
      for (const line of swing.lines) {
        tell(p, line);
      }
      out.push(...swing.out);
      for (const hit of swing.pvp) {
        // Damage floaties carry the splat and `hitsound`, from a player or a monster.
        all({ e: "phit", id: hit.victim.id, text: hit.text, color: hit.color, splat: hit.splat });
        for (const line of hit.lines) {
          tell(hit.victim, line);
        }
      }
      // The killer's client sends it as `sqa` to @AllUsers, so the killer's ignorers miss it.
      if (swing.broadcast) {
        for (const o of world.players.values()) {
          if (hears(o, p.name)) {
            tell(o, swing.broadcast);
          }
        }
      }
      // 1.6's exit-item check runs before the arrows are read: standing exactly on an
      // `Exit`/`Exit2` item on foot warps you, and no step starts this frame.
      const exit = exitUnder(p);
      if (exit) {
        exits.push({ player: p, exit });
      } else {
        movePlayer(room, p, ctx);
      }
      // The periodic save and its quest chest roll, after the key poll; the exit warp itself waits
      // for step 5.
      saveClockStep(world, p, rng);
    }

    // Actor pass 2 (and any further): the closing frame transition.
    for (let pass = 1; pass < STEPFRAMES_PER_FRAME; pass++) {
      actorPass();
    }

    if (slotEvent || (world.tickNo % SLOT_SAVE_TICKS === 0 && map.slots.some((s) => s.dirty))) {
      slotSaves.add(map);
    }
    for (const member of room.players) {
      const mine = events.filter((e) => e.except !== member.id).map((e) => e.ev);
      if (mine.length > 0) {
        out.push({ to: member.id, msg: { t: "delta", events: mine } });
      }
    }
  }

  deps.phase?.("rooms");
  for (const p of portals) {
    const from = p.map;
    out.push(...portal(world, deps, p));
    if (p.map !== from) {
      saves.add(p);
    }
  }
  for (const { player: p, exit } of exits) {
    const from = p.map;
    out.push(...takeExit(world, deps, p, exit));
    // A refused exit changes nothing worth saving.
    if (p.map !== from) {
      saves.add(p);
    }
  }
  out.push(...serverTimer(world, deps.hazardMap ?? null, rng));

  out.push(...dueGives(itemCtx));
  out.push(...decayLoot(itemCtx));

  for (const c of crossings) {
    const from = c.player.map;
    out.push(...crossMapEdge(world, deps, c));
    // A refused crossing changes nothing worth saving.
    if (c.player.map !== from) {
      saves.add(c.player);
    }
  }
  for (const p of respawns) {
    out.push(...respawn(world, deps, p, saves));
    saves.add(p);
  }
  // The Blackjack Table's 40-frame reset and reconnect grace.
  out.push(...casinoTick(world, deps.casino));
  for (const p of [...world.players.values()]) {
    const released = jailTick(world, deps, p);
    if (released.length > 0) {
      out.push(...released);
      saves.add(p);
    }
    out.push(...muteTick(world, deps, p));
  }
  deps.phase?.("world");

  for (const p of world.players.values()) {
    // The sizzle counter counts down once per frame.
    if (p.broadcastIn > 0) {
      p.broadcastIn -= 1;
    }
    if (p.chatIn > 0) {
      p.chatIn -= 1;
    }
    if (p.unsentLogIn > 0) {
      p.unsentLogIn -= 1;
    }
    // The award line follows this tick's skill changes, before the sheet is sent.
    out.push(...medalCheck(p));
    const s = selfState(p);
    const last = p.lastSent;
    const changed =
      !last ||
      last.n !== s.n ||
      last.x !== s.x ||
      last.y !== s.y ||
      last.facing !== s.facing ||
      last.hold !== s.hold;
    if (changed || p.forceYou) {
      out.push({ to: p.id, msg: { t: "you", self: s } });
      p.lastSent = s;
      p.forceYou = false;
    }
    if (p.vitalsDirty) {
      p.vitalsDirty = false;
      out.push({ to: p.id, msg: { t: "vitals", vitals: vitalsView(p) } });
    }
    out.push(...flushInventory(world, p));
    if (deaths.has(p)) {
      // After this tick's you/vitals, so the client holds the death frame when it goes black.
      out.push({ to: p.id, msg: { t: "death" } });
    }
    // The sheet shows the stats played with: allocated plus the held medals' points.
    const stats = statsOf(p);
    const sheet = JSON.stringify([stats, p.char.skills]);
    if (sheet !== p.lastSheet) {
      p.lastSheet = sheet;
      out.push({ to: p.id, msg: { t: "sheet", stats, skills: [...p.char.skills] } });
    }
    if (p.invSaveDue) {
      p.invSaveDue = false;
      invSaves.add(p);
    }
    p.saveIn -= 1;
    if (p.saveIn <= 0) {
      p.saveIn = deps.saveIntervalTicks;
      saves.add(p);
      // The high score is sent with the periodic save.
      submitHighScore(world, p);
    }
  }
  deps.phase?.("players");
  return {
    out,
    saves: [...saves],
    slotSaves: [...slotSaves],
    invSaves: [...invSaves],
    houseChecks,
  };
}

/**
 * Sends a changed inventory to its owner (`inx`) and a changed look to the map, and
 * marks the inventory for writing.
 */
export function flushInventory(world: World, p: Player): Outgoing[] {
  const out: Outgoing[] = [];
  if (p.invDirty) {
    p.invDirty = false;
    p.invSaveDue = true;
    out.push({ to: p.id, msg: { t: "inv", inv: inventoryView(p) } });
  }
  if (p.lookDirty) {
    p.lookDirty = false;
    const room = world.rooms.get(p.map.name);
    for (const o of room?.players ?? []) {
      if (o !== p) {
        out.push({
          to: o.id,
          msg: { t: "delta", events: [{ e: "look", id: p.id, equip: { ...p.char.equip } }] },
        });
      }
    }
  }
  return out;
}

/**
 * The end of the death lock: a player killer who was not already flagged is flagged wanted, the
 * death line goes to everyone in colour 8, Hunger is set to 40000, then the player warps to the
 * stored respawn point. A flagged killer is written with the victim (`saves`).
 */
function respawn(world: World, deps: TickDeps, p: Player, saves: Set<Player>): Outgoing[] {
  const flag = flagKiller(world, p);
  const out: Outgoing[] = [...flag.out];
  if (flag.killer) {
    saves.add(flag.killer);
  }
  // A rider whose hull ran out gets the shot-down line instead (an SSO addition).
  const text = p.sunk ? sunkText(p.name, p.sunk, p.lastToHitMe) : deathText(p.name, p.lastToHitMe);
  p.sunk = null;
  for (const o of world.players.values()) {
    out.push({ to: o.id, msg: { t: "chat", text, color: DEATH_TEXT_COLOR } });
  }
  // The killer's Assassin points line follows the death line, by the same credit as the flag.
  out.push(...scoreKill(world, p));
  finishDeath(p);
  p.vitalsDirty = true;
  // Death cannot bypass confinement. Revive at the jail arrival; the sentence runs on.
  if (isJailMap(p.map.name)) {
    out.push(...warp(world, p, p.map, JAIL.x, JAIL.y, deps.casino));
    return out;
  }
  const to = respawnTarget(p.char.respawn, deps);
  out.push(...warp(world, p, to?.map ?? p.map, to?.x ?? p.x, to?.y ?? p.y, deps.casino));
  return out;
}

/** What `respawnTarget` and `fallbackTarget` read. */
export type FallbackDeps = Pick<TickDeps, "loadMap" | "loadMapById" | "fallbackPoint">;

/** A place on a loaded map. */
type Target = { map: WorldMap; x: number; y: number };

/**
 * Where a death or a jail release sends a player: their respawn point. Every character has one
 * from creation (the starting map), replaced on entering an O-O-O map; only when its map is gone
 * do they go to the fallback point. Null when neither map exists.
 */
export function respawnTarget(
  respawn: { mapId: string; x: number; y: number } | null,
  deps: FallbackDeps,
): Target | null {
  const own = respawn ? (deps.loadMapById?.(respawn.mapId) ?? null) : null;
  if (respawn && own) {
    return { map: own, x: respawn.x, y: respawn.y };
  }
  return fallbackTarget(deps);
}

/**
 * Where a player goes when the place they were is gone (a deleted map, a decayed house): the
 * operator's fallback point, never their respawn point, so it cannot carry them anywhere they
 * chose (such as back to a tutorial island). Null when its map is missing. Travel someone chooses
 * (an exit, an edge, `/warp`, a Portal) never falls back: it is refused.
 */
export function fallbackTarget(deps: FallbackDeps): Target | null {
  const pt = deps.fallbackPoint;
  const map = pt ? deps.loadMap(pt.map) : null;
  return pt && map ? { map, x: pt.x, y: pt.y } : null;
}

/**
 * The portal exit: `random(n)` of the operator's portal targets whose maps exist. With none, the
 * portal does nothing (a bug fixed: 1.6's empty warp fell back to the start point); the cast is
 * refused before then (`portalOpen`), so this only happens when a map went missing meanwhile.
 */
function portal(world: World, deps: TickDeps, p: Player): Outgoing[] {
  if (isJailMap(p.map.name)) {
    return [];
  }
  const open = openPortalTargets(deps);
  const t = open[deps.rng.random(open.length) - 1];
  return t ? warp(world, p, t.map, t.x, t.y, deps.casino) : [];
}

/** The operator's portal targets whose maps exist. */
function openPortalTargets(
  deps: Pick<TickDeps, "loadMap" | "portalTargets">,
): { map: WorldMap; x: number; y: number }[] {
  return (deps.portalTargets ?? []).flatMap((t) => {
    const map = deps.loadMap(t.map);
    return map ? [{ map, x: t.x, y: t.y }] : [];
  });
}

/** Whether a Portal cast has anywhere to send players. */
export function portalOpen(deps: Pick<TickDeps, "loadMap" | "portalTargets">): boolean {
  return openPortalTargets(deps).length > 0;
}

/**
 * Find an `Exit` or `Exit2` under the player, ignoring case, when the player is exactly on its
 * tile and not stepping. Return null when keys are locked, loading or dead, as in 1.6.
 */
export function exitUnder(p: Player): "Exit" | "Exit2" | null {
  // An airship flies over exits.
  if (p.vehicle || p.stepFrames > 0 || p.loading > 0 || p.keyLock || p.deadLock > 0) {
    return null;
  }
  for (const g of p.map.ground) {
    if (g.x === p.x && g.y === p.y) {
      if (lingoEq(g.item, "Exit")) {
        return "Exit";
      }
      if (lingoEq(g.item, "Exit2")) {
        return "Exit2";
      }
    }
  }
  return null;
}

/**
 * A warp to `x<MX>y<MY> <LX> <LY>` with map field 13 (Exit) or 18 (Exit2). An exit with no target,
 * or whose map is missing, leaves you standing on it and says so once (a bug fixed: 1.6's missing
 * map sent you to the start point).
 */
function takeExit(world: World, deps: TickDeps, p: Player, which: "Exit" | "Exit2"): Outgoing[] {
  if (isJailMap(p.map.name)) {
    return [];
  }
  const e = which === "Exit" ? p.map.exit1 : p.map.exit2;
  // A house's exit names its interior (`H1<mx>`).
  const map = e ? deps.loadMap(exitTarget(e)) : null;
  if (e && map) {
    return warp(world, p, map, e.x, e.y, deps.casino);
  }
  return refuseTravel(p);
}

/** SSO's refusal of travel to a map that is not there: the blocked line, once a press. */
function refuseTravel(p: Player): Outgoing[] {
  const out: Outgoing[] = [];
  tellOnce(p, EDGE_BLOCKED_TEXT, (text) =>
    out.push({ to: p.id, msg: { t: "chat", text, color: CHAT_COLOR.normal } }),
  );
  return out;
}

/**
 * The map change. A crossing is refused, as a wall refuses a step, when there is no map beyond the
 * edge or the wrapped tile on it is unwalkable; you stay, facing the edge. Bugs fixed: 1.6 never
 * checked the wrapped tile, and with no next map its empty map reply warped you to `x1000y992`
 * (5,5).
 */
export function crossMapEdge(world: World, deps: TickDeps, c: EdgeCrossing): Outgoing[] {
  const { player: p, outcome: o } = c;
  if (isJailMap(p.map.name)) {
    return [];
  }
  const from = p.map.name;
  const nextName = neighbourMapName(from, o.dmx, o.dmy);
  const next = nextName ? deps.loadMap(nextName) : null;
  // The wrapped tile must be walkable on the next map, on foot or aboard. The client only turned
  // for an edge and waits for the snapshot, so a refusal needs no correction; the player reads
  // why once a press (SSO's own line).
  if (!next || !isWalkable(walkGridFor(next, p.vehicle), o.toX, o.toY)) {
    return refuseTravel(p);
  }
  return warp(world, p, next, o.toX, o.toY, deps.casino);
}

/**
 * A stored sentence ends at its wall-clock time, checked once a second (every 20 ticks), in an
 * editor or dead too. A prisoner on the jail map goes to their respawn point (`releaseFromJail`).
 * 1.6 counted frames only while online and restarted the count on every entry to the jail.
 */
export function jailTick(world: World, deps: TickDeps, p: Player): Outgoing[] {
  if (p.jailUntil === null || !deps.now || world.tickNo % 20 !== 0) {
    return [];
  }
  if (deps.now() < p.jailUntil) {
    return [];
  }
  return releaseFromJail(world, p, deps);
}

/** A mute ends at its wall-clock time, checked once a second, and the player is told. */
export function muteTick(world: World, deps: TickDeps, p: Player): Outgoing[] {
  if (p.muteUntil === null || !deps.now || world.tickNo % 20 !== 0 || deps.now() < p.muteUntil) {
    return [];
  }
  p.muteUntil = null;
  return [{ to: p.id, msg: { t: "chat", text: MODERATION_TEXT.youAreUnmuted, color: 0 } }];
}

/**
 * Ends `p`'s sentence; on the jail map they go to their respawn point (`respawnTarget`). An editor
 * is closed first.
 */
export function releaseFromJail(
  world: World,
  p: Player,
  deps: FallbackDeps & Pick<TickDeps, "casino">,
): Outgoing[] {
  p.jailUntil = null;
  if (!isJailMap(p.map.name) || p.editing) {
    return [];
  }
  const to = respawnTarget(p.char.respawn, deps);
  return to ? warp(world, p, to.map, to.x, to.y, deps.casino) : [];
}

/**
 * Moves a player to a tile on a map, unchecked, and reloads the map for them. `casino` is required:
 * leaving mid-hand forfeits a stake, which may be owed to an opponent who is offline.
 */
export function warp(
  world: World,
  p: Player,
  map: WorldMap,
  x: number,
  y: number,
  casino: CasinoDeps,
): Outgoing[] {
  // A trade and any open casino game/panel end when a player changes map.
  const out = leaveTrade(world, p);
  out.push(...casinoMapChange(world, p, casino));
  out.push(...leaveRoom(world, p));
  p.map = map;
  p.x = x;
  p.y = y;
  p.stepFrames = 0;
  out.push(...enterRoom(world, p));
  return out;
}
