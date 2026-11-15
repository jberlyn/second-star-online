/**
 * The client's picture of the world: the map, your own walker (predicted) and the other players
 * (animated from `move` events). Pure: no DOM, no sockets, no clock. The app calls `clientTick` 20
 * times a second.
 *
 * Prediction: you step at once with the same shared rules the server uses. Each step you predict is
 * remembered by its number `n`; the server's `you` messages carry its own `n`. A matching tile
 * confirms the prediction; anything else snaps to the server. If the server stays silent about a
 * predicted step for 30 ticks, the client snaps back too (the server refused it, e.g. someone stood
 * there on its side).
 */
import {
  type AmountPath,
  type AttackTimers,
  advanceStep,
  airshipWalkGrid,
  amountPath,
  applyOutcome,
  attemptMove,
  blockPCCheck,
  blocksPlayer,
  type DeltaEvent,
  type Dir,
  type EquipView,
  FACING_DELTA,
  type Facing,
  type FxSprite,
  footWalkGrid,
  type GroundView,
  type InventoryView,
  isWalkable,
  isWebBody,
  type MapView,
  MONSTER_STEP_FRAMES,
  type MonsterView,
  monsterSpriteTile,
  NO_EQUIPMENT,
  newAttackTimers,
  newFx,
  type PlayerView,
  type SelfState,
  STEP_FRAMES,
  STEPFRAMES_PER_FRAME,
  stepFx,
  stepLengthFor,
  stepOffsetPx,
  tickAttackTimers,
  tickSpriteTimers,
  type VitalsView,
  vehicleOfBody,
  type WalkWorld,
  withTile,
} from "@secondstaronline/shared";

import { type Sfx, SOUND, SWING_CHANNEL, spellSounds } from "./sfx.ts";
import type { Ghost } from "./ui/placement.ts";

export interface Peer {
  id: string;
  name: string;
  head: number;
  x: number;
  y: number;
  facing: Facing;
  /** Frames left in the current step; the step started on (fromX, fromY). */
  frames: number;
  fromX: number;
  fromY: number;
  /** Frames left of the attack animation (set to 5 on an attack). */
  atkAnim: number;
  /** What they wear. */
  equip: EquipView;
  /** A `Chars` body replacing the paperdoll (Morph, Nature Shift, Smoke Bomb), or null. */
  body: number | null;
  /** Frames left of the cast frame (set to 5 on a cast). */
  spellAnim: number;
}

/** A spell FX sprite (shared/rules/spells/spellfx.ts) in its FX slot. */
export interface ClientFx extends FxSprite {
  slot: number;
}

/** A member's `[w, h, regX, regY]` from the atlas, for the arrows' mask test. */
export type MemberRectLookup = (member: string) => readonly [number, number, number, number] | null;

/** A monster in slot 1-4 (sprites 180-183). Monster steps are always 16 frames. */
export interface ClientMonster {
  slot: number;
  name: string;
  body: number;
  x: number;
  y: number;
  facing: Facing;
  frames: number;
  fromX: number;
  fromY: number;
}

/** A one-shot effect: the hit splat (S1h-S3h) or the kill puff (kill1-kill4). */
export interface Effect {
  kind: "splat" | "kill";
  /** Playfield pixels of the sprite's registration point. */
  px: number;
  py: number;
  /** Frames shown so far. */
  age: number;
}

/** Floating text: 30 frames, up 2 px twice, then down. */
export interface Floatie {
  text: string;
  color: number;
  px: number;
  py: number;
  /** The FX's animation counter, counted down from 30. */
  anim: number;
}

export { MONSTER_STEP_FRAMES };
/** Floaties are drawn in sprites 272-278: at most seven; an eighth reuses the first. */
export const MAX_FLOATIES = 7;

export interface Self {
  id: string;
  name: string;
  head: number;
  x: number;
  y: number;
  facing: Facing;
  stepFrames: number;
  /** Steps taken, as the server counts them (SelfState.n). */
  n: number;
  /**
   * Where each predicted, unconfirmed step ended, by step number, plus where the first of
   * them started.
   */
  predicted: Map<number, { x: number; y: number }>;
  /** Tick of the oldest unconfirmed prediction, or null. */
  unconfirmedSince: number | null;
  /** Last authoritative state from the server. */
  server: SelfState;
  /** The power bar and attack timers, predicted with the server's rules. */
  timers: AttackTimers;
  body: number | null;
  /** Frames left of your own sprite's spell animation. */
  spellAnim: number;
}

export interface Model {
  map: MapView | null;
  walk: boolean[][];
  /** The Airship's grid: the walk grid of a rider (body 57). */
  walkAir: boolean[][];
  self: Self | null;
  peers: Map<string, Peer>;
  tick: number;
  /** True from a snapshot until the client has drawn the map and sent `mapReady`. */
  loading: boolean;
  /**
   * The death frame: "black" for the one draw that fills the playfield black, "frozen" while the
   * canvas keeps that picture until the respawn map is drawn.
   */
  deathStage: "none" | "black" | "frozen";
  /** The server's minute, which turns placed Clocks; null until it arrives. */
  minute: number | null;
  monsters: Map<number, ClientMonster>;
  /**
   * The name last shown placed in each roster slot 1-4 (index = slot - 1), empty at login. It
   * outlives the monster and feeds the player-blocking check.
   */
  slotNames: (string | null)[];
  vitals: VitalsView | null;
  effects: Effect[];
  floaties: Floatie[];
  /** Sounds to play this frame, with their channels (the app drains it). */
  sounds: Sfx[];
  /** Your gold, bag and equipment, as the server last sent them (`inx`). */
  inv: InventoryView | null;
  /**
   * Ctrl's item action pause (40 frames), mirrored from the server's rule so the unequip × buttons
   * know whether they click.
   */
  itemPause: number;
  /** Ground items on this map, in creation order. */
  ground: Map<string, GroundView>;
  /**
   * The key lock held by a window, mirrored from the server's rule: set when the
   * Bio window or the vault opens; cleared when the Bio closes, on the vault's first
   * withdraw and on CANCEL. The bag and the unequip × buttons do nothing while it is set.
   */
  keyLock: boolean;
  /** The monster name under the mouse and where the mouse is, in playfield pixels. */
  nameTag: { text: string; x: number; y: number } | null;
  /** Your spellbook's lines, as the server last sent them. */
  spellbook: string[];
  /** Spell FX on the map, stepped every frame like the original's FX script. */
  fx: ClientFx[];
  /** FX member rects from the atlas (set by the app); without it arrows never touch the mask. */
  fxRect: MemberRectLookup | null;
  /** Tiles changed since the playfield last drew (`tile` events); it drains them. */
  tileChanges: { x: number; y: number }[];
  /** House placement's ghost (sprite 360; ui/placement.ts), or null outside placement mode. */
  ghost: Ghost | null;
}

/** How long a predicted step may go unconfirmed before the client gives up on it. */
export const PREDICTION_TIMEOUT_TICKS = 30;
/** A press kept for up to 4 ticks, as the server does. */
export const PENDING_MAX_TICKS = 4;

export function createModel(): Model {
  return {
    map: null,
    walk: [],
    walkAir: [],
    self: null,
    peers: new Map(),
    tick: 0,
    loading: false,
    deathStage: "none",
    minute: null,
    monsters: new Map(),
    slotNames: [null, null, null, null],
    vitals: null,
    effects: [],
    floaties: [],
    sounds: [],
    inv: null,
    itemPause: 0,
    ground: new Map(),
    keyLock: false,
    nameTag: null,
    spellbook: [],
    fx: [],
    tileChanges: [],
    fxRect: null,
    ghost: null,
  };
}

function toMonster(v: MonsterView): ClientMonster {
  return {
    slot: v.slot,
    name: v.name,
    body: v.body,
    x: v.x,
    y: v.y,
    facing: v.facing,
    frames: v.step?.frames ?? 0,
    fromX: v.step?.fromX ?? v.x,
    fromY: v.step?.fromY ?? v.y,
  };
}

/** A sprite's registration point on the playfield, from its tile and step. */
export function monsterPixel(m: ClientMonster): { px: number; py: number } {
  return walkerPixel(m.x, m.y, m.facing, m.frames, MONSTER_STEP_FRAMES);
}

function addFloatie(m: Model, f: Omit<Floatie, "anim">): void {
  if (m.floaties.length >= MAX_FLOATIES) {
    m.floaties.shift();
  }
  m.floaties.push({ ...f, anim: 30 });
}

function toPeer(p: PlayerView): Peer {
  return {
    id: p.id,
    name: p.name,
    head: p.head,
    x: p.x,
    y: p.y,
    facing: p.facing,
    frames: p.step?.frames ?? 0,
    fromX: p.step?.fromX ?? p.x,
    fromY: p.step?.fromY ?? p.y,
    atkAnim: 0,
    equip: p.equip ?? { ...NO_EQUIPMENT },
    body: p.body ?? null,
    spellAnim: 0,
  };
}

export function applySnapshot(
  m: Model,
  snap: {
    map: MapView;
    you: PlayerView;
    self: SelfState;
    players: PlayerView[];
    monsters: MonsterView[];
    ground?: GroundView[];
  },
): void {
  const timers = m.self?.timers ?? newAttackTimers();
  m.map = snap.map;
  m.walk = footWalkGrid(snap.map.layers[0], snap.map.layers[1]);
  m.walkAir = airshipWalkGrid(snap.map.layers[1]);
  m.self = {
    id: snap.you.id,
    name: snap.you.name,
    head: snap.you.head,
    x: snap.self.x,
    y: snap.self.y,
    facing: snap.self.facing,
    stepFrames: snap.self.frames,
    n: snap.self.n,
    predicted: new Map(),
    unconfirmedSince: null,
    server: snap.self,
    timers,
    body: snap.you.body ?? null,
    spellAnim: 0,
  };
  m.fx = [];
  m.peers = new Map(snap.players.map((p) => [p.id, toPeer(p)]));
  m.monsters = new Map(snap.monsters.map((v) => [v.slot, toMonster(v)]));
  for (const v of snap.monsters) {
    m.slotNames[v.slot - 1] = v.name;
  }
  m.ground = new Map((snap.ground ?? []).map((g) => [g.id, g]));
  m.effects = [];
  m.floaties = [];
  m.loading = true;
}

export function applyDelta(m: Model, events: readonly DeltaEvent[]): void {
  for (const ev of events) {
    switch (ev.e) {
      case "enter":
        m.peers.set(ev.player.id, toPeer(ev.player));
        break;
      case "leave":
        m.peers.delete(ev.id);
        break;
      case "move": {
        const p = m.peers.get(ev.id);
        if (!p) {
          break;
        }
        // Snap to the start tile and animate the step.
        p.fromX = ev.fromX;
        p.fromY = ev.fromY;
        p.x = ev.toX;
        p.y = ev.toY;
        p.facing = ev.facing;
        p.frames = ev.frames;
        break;
      }
      case "turn": {
        const p = m.peers.get(ev.id);
        if (p) {
          p.facing = ev.facing;
        }
        break;
      }
      case "mspawn":
        m.monsters.set(ev.monster.slot, toMonster(ev.monster));
        m.slotNames[ev.monster.slot - 1] = ev.monster.name;
        break;
      case "mmove": {
        const mon = m.monsters.get(ev.slot);
        if (mon) {
          mon.fromX = ev.fromX;
          mon.fromY = ev.fromY;
          mon.x = ev.toX;
          mon.y = ev.toY;
          mon.facing = ev.facing;
          mon.frames = MONSTER_STEP_FRAMES;
        }
        break;
      }
      case "mgone":
        m.monsters.delete(ev.slot);
        break;
      case "mhit": {
        const mon = m.monsters.get(ev.slot);
        if (!mon) {
          break;
        }
        const { px, py } = monsterPixel(mon);
        if (ev.kill) {
          // kill1 at the monster; the splat and number go to its off-stage sprite.
          m.effects.push({ kind: "kill", px, py, age: 0 });
          m.sounds.push(SOUND.monsterKill);
        }
        // The kill block does not exit: `hitsound` plays on every hit.
        m.sounds.push(SOUND.monsterHit);
        if (ev.kill) {
          m.monsters.delete(ev.slot);
        } else {
          m.effects.push({ kind: "splat", px, py, age: 0 });
          addFloatie(m, { text: String(ev.dmg), color: 84, px, py });
        }
        break;
      }
      case "swing": {
        if (m.self && ev.id === m.self.id) {
          // Snap the predicted bar to the server's swing.
          const t = m.self.timers;
          t.bar = 0;
          t.canAttack = false;
          t.atkAnim = 5;
          t.atDelay = ev.atDelay;
          t.actionDelay = ev.actionDelay;
        } else {
          const p = m.peers.get(ev.id);
          if (p) {
            p.atkAnim = 5;
          }
        }
        if (ev.sound) {
          m.sounds.push({ name: ev.sound, ch: SWING_CHANNEL });
        }
        break;
      }
      case "phit": {
        const who = m.self && ev.id === m.self.id ? m.self : m.peers.get(ev.id);
        if (who) {
          const frames = "stepFrames" in who ? who.stepFrames : who.frames;
          const { px, py } = walkerPixel(who.x, who.y, who.facing, frames, lenOf(who.body));
          // PvP damage has the splat and `hitsound`; monster hits do not.
          if (ev.splat) {
            m.effects.push({ kind: "splat", px, py, age: 0 });
            m.sounds.push(SOUND.floatieHit);
          }
          addFloatie(m, { text: ev.text, color: ev.color, px, py });
        }
        break;
      }
      case "tile": {
        // The tile layer changes and the playfield redraws it.
        const layer = ev.layer - 1;
        const rows = m.map?.layers[layer];
        const next = rows ? withTile(rows, ev.x, ev.y, ev.code) : null;
        if (m.map && next && layer >= 0 && layer < 4) {
          m.map.layers[layer] = next;
          if (layer < 2) {
            m.walk = footWalkGrid(m.map.layers[0], m.map.layers[1]);
            m.walkAir = airshipWalkGrid(m.map.layers[1]);
          }
          m.tileChanges.push({ x: ev.x, y: ev.y });
        }
        break;
      }
      case "gadd":
        m.ground.set(ev.item.id, ev.item);
        break;
      case "gdel":
        m.ground.delete(ev.id);
        break;
      case "gset": {
        // A door-state change swaps the sprite's member in place: the door or switch keeps its
        // place in the sprite order and shows its new picture.
        const g = m.ground.get(ev.id);
        if (g) {
          m.ground.set(ev.id, { ...g, name: ev.name });
        }
        break;
      }
      case "look": {
        const p = m.peers.get(ev.id);
        if (p) {
          p.equip = ev.equip;
        }
        break;
      }
      case "fx": {
        // A new FX takes its slot from whatever was there.
        m.fx = m.fx.filter((f) => f.slot !== ev.slot);
        m.fx.push({ ...newFx(ev.name, { h: ev.h, v: ev.v }), slot: ev.slot });
        m.fx.sort((a, b) => a.slot - b.slot);
        m.sounds.push(...spellSounds(ev.name));
        if (ev.caster) {
          const who = m.self && ev.caster === m.self.id ? m.self : m.peers.get(ev.caster);
          if (who) {
            who.spellAnim = 5;
          }
        }
        break;
      }
      case "body": {
        const who = m.self && ev.id === m.self.id ? m.self : m.peers.get(ev.id);
        if (who) {
          who.body = ev.body;
        }
        break;
      }
      case "mspell": {
        const mon = m.monsters.get(ev.slot);
        if (!mon) {
          break;
        }
        const { px, py } = monsterPixel(mon);
        // The floating text runs before the death check: the number, and with item 6 the splat and
        // `hitsound` on channel 5; then a kill hides the monster under `kill1` and plays `fx` on
        // channel 1.
        if (ev.splat) {
          m.effects.push({ kind: "splat", px, py, age: 0 });
          m.sounds.push(SOUND.floatieHit);
        }
        if (ev.kill) {
          m.effects.push({ kind: "kill", px, py, age: 0 });
          m.sounds.push(SOUND.spellKill);
          m.monsters.delete(ev.slot);
        }
        addFloatie(m, { text: ev.text, color: ev.color, px, py });
        break;
      }
    }
  }
}

/** Advances effects and floaties by one frame. */
export function tickEffects(m: Model): void {
  for (const e of m.effects) {
    e.age += 1;
  }
  // Splats show S1h, S2h, S3h; the kill puff kill1-kill4; one frame each.
  m.effects = m.effects.filter((e) => e.age < (e.kind === "splat" ? 3 : 4));
  for (const f of m.floaties) {
    if (f.anim > 20) {
      f.py += 2;
    }
    if (f.anim > 28) {
      f.py -= 4;
    }
    f.anim -= 1;
  }
  m.floaties = m.floaties.filter((f) => f.anim > 0);
  for (const mon of m.monsters.values()) {
    if (mon.frames > 0) {
      mon.frames -= 1;
    }
  }
}

function snapToServer(s: Self, st: SelfState): void {
  s.x = st.x;
  s.y = st.y;
  s.facing = st.facing;
  s.stepFrames = st.frames;
  s.n = st.n;
  s.predicted.clear();
  s.unconfirmedSince = null;
}

/** Reconciles your predicted walker with the server's `you`. */
/** `{ t: "death" }`: the next playfield draw is the black frame. */
export function onDeath(m: Model): void {
  m.deathStage = "black";
}

/** The respawn map has been drawn: the playfield draws normally again. */
export function onRespawnDrawn(m: Model): void {
  m.deathStage = "none";
}

export function applyYou(m: Model, st: SelfState): void {
  const s = m.self;
  if (!s) {
    return;
  }
  s.server = st;
  if (st.n > s.n) {
    snapToServer(s, st);
    return;
  } // the server stepped where we did not
  if (st.n === s.n) {
    if (s.x !== st.x || s.y !== st.y) {
      snapToServer(s, st);
      return;
    }
    // Same tile: the server owns facing (turns, blocked steps).
    if (s.stepFrames === 0) {
      s.facing = st.facing;
    }
    s.predicted.clear();
    s.unconfirmedSince = null;
    return;
  }
  // We are ahead: the server has not acted on our latest steps yet. Its tile must be where
  // we were after its step count; otherwise our history is wrong.
  const mine = s.predicted.get(st.n);
  if (!mine || mine.x !== st.x || mine.y !== st.y) {
    snapToServer(s, st);
    return;
  }
  for (const k of [...s.predicted.keys()]) {
    if (k <= st.n) {
      s.predicted.delete(k);
    }
  }
  s.unconfirmedSince = s.predicted.size > 0 ? m.tick : null;
}

export interface Intent {
  /** Arrow held (after L > R > U > D), or null. */
  held: Dir | null;
  turn: boolean;
  /** A press not yet acted on. */
  pending: { dir: Dir; turn: boolean; age: number } | null;
}

/** Fixtures on the ground block your step; the server has the skills. */
function groundBlocks(m: Model, x: number, y: number): boolean {
  const who = { level: m.vitals?.level ?? 1, skills: [] as number[] };
  for (const g of m.ground.values()) {
    if (g.x === x && g.y === y && blocksPlayer(g.name, who)) {
      return true;
    }
  }
  return false;
}

/**
 * A step's length (in `stepFrame` calls) for a walker with this body: half of 16 aboard an
 * Airship, which peers know by body 57 as 1.6's did.
 */
export function lenOf(body: number | null | undefined): number {
  return stepLengthFor(vehicleOfBody(body));
}

function walkWorld(m: Model): WalkWorld {
  if (vehicleOfBody(m.self?.body) !== null) {
    // An Airship rider: its own grid, nothing blocks it.
    return {
      walkable: (x, y) => isWalkable(m.walkAir, x, y),
      pcBlocked: () => false,
      itemBlocks: () => false,
      webAt: () => false,
    };
  }
  return {
    walkable: (x, y) => isWalkable(m.walk, x, y),
    itemBlocks: (x, y) => groundBlocks(m, x, y),
    // A Web exactly on my own tile; the server prints the line.
    webAt: (x, y) =>
      [...m.monsters.values()].some(
        (mon) => isWebBody(mon.body) && mon.frames === 0 && mon.x === x && mon.y === y,
      ),
    // The player-blocking check: standing, non-rider peers, then slots 1-4.
    pcBlocked: (x, y) =>
      blockPCCheck(
        x,
        y,
        [...m.peers.values()].filter((p) => p.frames === 0 && vehicleOfBody(p.body) === null),
        m.slotNames.map((name, i) => {
          const mon = m.monsters.get(i + 1);
          return {
            name,
            at: mon ? monsterSpriteTile(mon.x, mon.y, mon.fromX, mon.fromY, mon.frames) : null,
          };
        }),
      ),
  };
}

/** One `stepFrame` of every actor the client animates: peers, effects, FX and your own sprite. */
function actorPass(m: Model): void {
  for (const p of m.peers.values()) {
    if (p.frames > 0) {
      p.frames -= 1;
    }
    if (p.atkAnim > 0) {
      p.atkAnim -= 1;
    }
    if (p.spellAnim > 0) {
      p.spellAnim -= 1;
    }
  }
  tickEffects(m);
  for (const fx of m.fx) {
    stepFx(fx);
  }
  m.fx = m.fx.filter((f) => !f.gone);
  const s = m.self;
  if (!s) {
    return;
  }
  if (s.spellAnim > 0) {
    s.spellAnim -= 1;
  }
  tickSpriteTimers(s.timers);
  advanceStep(s);
}

/**
 * One client tick, in 1.6's frame order: the frame-script counters, actor pass 1,
 * the key poll where your walker acts on the input exactly as the server will (shared rules), then
 * actor pass 2. Map edges are not predicted: the server's snapshot
 * moves you.
 */
export function clientTick(m: Model, intent: Intent): void {
  m.tick += 1;
  if (m.itemPause > 0) {
    m.itemPause -= 1;
  }
  if (m.self) {
    tickAttackTimers(m.self.timers);
  }
  actorPass(m);
  keyPoll(m, intent);
  for (let pass = 1; pass < STEPFRAMES_PER_FRAME; pass++) {
    actorPass(m);
  }
}

/** The key poll: starts a predicted step from the held or pending arrow. */
function keyPoll(m: Model, intent: Intent): void {
  const s = m.self;
  if (!s) {
    return;
  }
  if (s.unconfirmedSince !== null && m.tick - s.unconfirmedSince > PREDICTION_TIMEOUT_TICKS) {
    snapToServer(s, s.server);
  }
  if (m.loading) {
    intent.pending = null;
    return;
  }
  // The whole key poll sits inside the key-lock check; the server agrees.
  if (m.keyLock) {
    intent.pending = null;
    return;
  }
  // No step starts during the attack animation or while held; the server agrees.
  if (s.timers.atkAnim > 0 || s.server.hold) {
    return;
  }
  const pending = intent.pending;
  const dir = pending ? pending.dir : intent.held;
  const turn = pending ? pending.turn : intent.turn;
  if (!dir) {
    return;
  }
  const o = attemptMove(s, dir, turn, walkWorld(m));
  if (o.kind === "none") {
    if (pending) {
      pending.age += 1;
      if (pending.age > PENDING_MAX_TICKS) {
        intent.pending = null;
      }
    }
    return;
  }
  intent.pending = null;
  if (o.kind === "edge") {
    s.facing = o.facing; // the server sends the new map
    return;
  }
  applyOutcome(s, o, lenOf(s.body));
  if (o.kind === "step") {
    // Remember where we stood before the first unconfirmed step, so a `you` that has not
    // seen it yet still matches.
    if (s.predicted.size === 0) {
      s.predicted.set(s.n, { x: o.fromX, y: o.fromY });
    }
    s.n += 1;
    s.predicted.set(s.n, { x: s.x, y: s.y });
    if (s.unconfirmedSince === null) {
      s.unconfirmedSince = m.tick;
    }
  }
}

/**
 * The overlay frame (1-4) of an animated ground item on a tick. The animated-tile counter counts 13
 * → 1 once per frame (12 at login) and the item's animation script sets members 1-4 at counts 12,
 * 9, 6, 3, so a 13-frame cycle holds frames 1-4 for 3, 3, 3 and 4 frames. Tick 0 is count 12.
 * Frame-script counter: not doubled.
 */
export function animObjFrame(tick: number): 1 | 2 | 3 | 4 {
  const k = ((tick % 13) + 13) % 13;
  return k < 3 ? 1 : k < 6 ? 2 : k < 9 ? 3 : 4;
}

/** Where to draw a walker: the tile it is stepping from, plus the step offset. */
export function walkerPixel(
  x: number,
  y: number,
  facing: Facing,
  framesLeft: number,
  stepLength: number = STEP_FRAMES,
): { px: number; py: number } {
  const dx = facing === "E" ? 1 : facing === "W" ? -1 : 0;
  const dy = facing === "S" ? 1 : facing === "N" ? -1 : 0;
  // Stage anchor H = X*32+14, V = Y*32−3; relative to the playfield origin (30, 31) that is
  // (X*32−16, Y*32−34).
  if (framesLeft <= 0 || framesLeft > stepLength) {
    return { px: x * 32 - 16, py: y * 32 - 34 };
  }
  const moved = stepOffsetPx(framesLeft, stepLength);
  return { px: (x - dx) * 32 - 16 + dx * moved, py: (y - dy) * 32 - 34 + dy * moved };
}

/** Ctrl or the Action button: the server starts the 40-frame pause unless one is running. */
export function pressAction(m: Model): void {
  if (m.itemPause === 0) {
    m.itemPause = 40;
  }
}

/**
 * The branch the amount dialog's OK will take, from what this client sees, as 1.6's client
 * decided it from its own sprites (`amountPath`): a standing player on the faced tile
 * while you stand, then a monster one or two tiles ahead.
 */
export function predictAmountPath(m: Model, gold: boolean, enough: boolean): AmountPath {
  const s = m.self;
  if (!s) {
    return "short";
  }
  const [dx, dy] = FACING_DELTA[s.facing];
  const ax = s.x + dx;
  const ay = s.y + dy;
  const playerAhead =
    s.stepFrames === 0 &&
    [...m.peers.values()].some((p) => p.frames === 0 && p.x === ax && p.y === ay);
  const monsterAhead = [...m.monsters.values()].some(
    (mon) => (mon.x === ax && mon.y === ay) || (mon.x === ax + dx && mon.y === ay + dy),
  );
  return amountPath({ gold, enough, playerAhead, monsterAhead });
}
