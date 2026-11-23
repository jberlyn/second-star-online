/**
 * The player hub's character editor on the server (issue #26; rules: shared
 * rules/admin/character-edit.ts). An admin's edit goes through the authoritative server, never
 * straight to the database:
 *
 * - **Online:** the live character changes and their client is told at once (vitals, inventory,
 *   sheet, spellbook, a warp for a move or a new look). The game then writes them, so the next
 *   save can never put the old values back.
 * - **Offline:** the saved character is rewritten in one transaction (the game wraps it). The
 *   server is single-threaded, so the character cannot log in halfway through.
 * - **Checked:** the game's own limits, items and spells that exist, maps that exist, the jail, and
 *   the wear rules (breaking them needs a logged override). An edit made over a stale hub is
 *   refused: every field it sets must still hold what the hub showed.
 * - **Logged:** `character_edits` keeps the reason and each field's value before and after, which
 *   undo works from; gold and items moved are `admin` activity events, so the ledger check never
 *   reports them as `unlogged`.
 *
 * I/O goes through `EditDeps`, wired in game.ts.
 */
import {
  deriveEdit,
  diffEdit,
  EDIT_FIELDS,
  EDIT_TEXT,
  type EditableCharacter,
  type EditChange,
  type EditField,
  editableOf,
  editErrors,
  effectiveStats,
  factionIdOf,
  fieldLabels,
  ITEM_FIELDS,
  isJailMap,
  isStaff,
  lingoEq,
  needsContainerId,
  type Rng,
  type Role,
  SETTABLE_FIELDS,
  type SkillValues,
  sameValue,
  skillsFromKeys,
  sortFaction,
  staleCheckFields,
  undoConflicts,
  wearBreaks,
} from "@secondstaronline/shared";

import type { CasinoDeps } from "../casino/index.ts";
import type { Outgoing, Player, World, WorldMap } from "../world/world.ts";
import {
  checkPlayer,
  holdingsOf,
  logActivity,
  logBagChange,
  type OfflineCharacter,
  resetHoldings,
} from "./activity.ts";
import { liveSheet, type StoredCharacter, storedSheet } from "./characters.ts";
import { adminWarp } from "./commands.ts";

/** The character an edit is made to. */
export interface EditTarget {
  characterId: string;
  accountId: string;
  name: string;
  role: Role;
}

export interface EditDeps {
  findCharacter(name: string): EditTarget | null;
  /** Everything saved about an offline character (persistence/hub.ts). */
  stored(characterId: string): StoredCharacter | null;
  /** A map by name, ignoring case; null when there is none. */
  loadMap(name: string): WorldMap | null;
  mapName(mapId: string): string;
  /** An offline character's jail is in force. */
  jailedOffline(characterId: string): boolean;
  /** Rewrites an offline character from `after` (the caller owns the transaction). */
  writeOffline(stored: StoredCharacter, after: EditableCharacter, mapIds: MapIds): void;
  casino: CasinoDeps;
  rng: Rng;
}

/** The map ids an edit's position and respawn point resolve to. */
export interface MapIds {
  position: string;
  respawn: string | null;
}

/** A checked edit, ready to apply. */
export interface PreparedEdit {
  target: EditTarget;
  online: Player | null;
  stored: StoredCharacter | null;
  before: EditableCharacter;
  after: EditableCharacter;
  changes: EditChange[];
  mapIds: MapIds;
  override: boolean;
}

export type Prepared = { ok: true; edit: PreparedEdit } | { ok: false; text: string };

/** The character as the editor sees it now: live when online, saved when not. */
function currentOf(
  world: World,
  target: EditTarget,
  deps: EditDeps,
): { online: Player | null; stored: StoredCharacter | null; now: EditableCharacter } | null {
  const p = world.players.get(target.characterId);
  if (p) {
    return { online: p, stored: null, now: editableOf(liveSheet(world, p, deps.mapName)) };
  }
  const stored = deps.stored(target.characterId);
  return stored ? { online: null, stored, now: editableOf(storedSheet(world, stored)) } : null;
}

/**
 * The checks every edit and undo makes before it applies: maps exist (and are named as the game
 * names them), the jail is respected, and a character who is trading, gambling or off the map is
 * not changed under what they are doing.
 */
function placeChecks(
  world: World,
  target: EditTarget,
  online: Player | null,
  before: EditableCharacter,
  after: EditableCharacter,
  deps: EditDeps,
): { ok: true; mapIds: MapIds } | { ok: false; text: string } {
  const changed = (f: EditField) => !sameValue(before[f], after[f]);
  // A seat is kept by id: a player who dropped mid-hand is offline but their stake is still held.
  const seated = [...world.casinoTables.values()].some((t) =>
    t.seats.some((seat) => seat?.id === target.characterId),
  );
  const busy = seated || (online !== null && (online.trade !== null || online.casino !== null));
  if (busy && (ITEM_FIELDS.some(changed) || changed("position"))) {
    return { ok: false, text: EDIT_TEXT.busy(target.name) };
  }
  const pos = deps.loadMap(after.position.map);
  if (!pos) {
    return { ok: false, text: EDIT_TEXT.noMap(after.position.map) };
  }
  after.position.map = pos.name;
  let respawn: string | null = null;
  if (after.respawn) {
    const m = deps.loadMap(after.respawn.map);
    if (!m) {
      return { ok: false, text: EDIT_TEXT.noMap(after.respawn.map) };
    }
    after.respawn.map = m.name;
    respawn = m.id;
    if (changed("respawn") && !isStaff(target.role) && isJailMap(m.name, world.jail.map)) {
      return { ok: false, text: EDIT_TEXT.jailMap };
    }
  }
  if (changed("position")) {
    if (online?.editing) {
      return { ok: false, text: EDIT_TEXT.editing(target.name) };
    }
    const jailed = online ? online.jailUntil !== null : deps.jailedOffline(target.characterId);
    if (jailed) {
      return { ok: false, text: EDIT_TEXT.jailed(target.name) };
    }
    if (!isStaff(target.role) && isJailMap(pos.name, world.jail.map)) {
      return { ok: false, text: EDIT_TEXT.jailMap };
    }
  }
  return { ok: true, mapIds: { position: pos.id, respawn } };
}

/** Gives a bare Crate, Cabinet or Cauldron added to the bag its own storage, as `invAdd` does. */
function containerIds(world: World, before: EditableCharacter, after: EditableCharacter, rng: Rng) {
  after.bag.forEach((l, i) => {
    if (!l || sameValue(l, before.bag[i]) || !needsContainerId(l.item)) {
      return;
    }
    let item = `${l.item}#${rng.random(999999)}`;
    for (let n = 0; n < 20 && world.containers.has(item); n++) {
      item = `${l.item}#${rng.random(999999)}`;
    }
    l.item = item;
  });
}

/** The strength played with: allocated, plus the class's and the held medals' points. */
function strengthOf(c: EditableCharacter): number {
  const { str, sta, dex, int, wis } = c;
  return effectiveStats({ str, sta, dex, int, wis }, c.classCode, skillsFromKeys(c.skills)).str;
}

/**
 * An editor save: `set` holds the new values and `seen` what the hub showed for them. Refused
 * when a value is out of the game's limits, when the hub was stale, or when the worn gear breaks
 * the wear rules without `override`.
 */
export function prepareEdit(
  world: World,
  req: {
    name: string;
    set: Partial<EditableCharacter>;
    seen: Partial<EditableCharacter>;
    override: boolean;
  },
  deps: EditDeps,
): Prepared {
  const target = deps.findCharacter(req.name.trim());
  if (!target) {
    return { ok: false, text: `There is no character named ${req.name.trim()}.` };
  }
  const cur = currentOf(world, target, deps);
  if (!cur) {
    return { ok: false, text: `There is no character named ${req.name.trim()}.` };
  }
  // Every field set, and every field a level change brings within its new limits, must still read
  // as the hub showed it.
  const fields = staleCheckFields(req.set);
  for (const f of fields) {
    if (!(SETTABLE_FIELDS as readonly string[]).includes(f) || !(f in req.seen)) {
      return { ok: false, text: EDIT_TEXT.badField(f) };
    }
  }
  const stale = fields.filter((f) => !sameValue(req.seen[f], cur.now[f]));
  if (stale.length > 0) {
    return { ok: false, text: EDIT_TEXT.stale(fieldLabels(stale)) };
  }
  const before = cur.now;
  const after = deriveEdit(before, req.set);
  const errors = editErrors(before, after);
  if (errors.length > 0) {
    return { ok: false, text: errors.join(" ") };
  }
  const breaks = wearBreaks(before, after, strengthOf(after));
  if (breaks.length > 0 && !req.override) {
    return { ok: false, text: `${EDIT_TEXT.wear} ${breaks.join(" ")}` };
  }
  const place = placeChecks(world, target, cur.online, before, after, deps);
  if (!place.ok) {
    return place;
  }
  containerIds(world, before, after, deps.rng);
  const changes = diffEdit(before, after);
  if (changes.length === 0) {
    return { ok: false, text: EDIT_TEXT.nothing };
  }
  return {
    ok: true,
    edit: {
      target,
      online: cur.online,
      stored: cur.stored,
      before,
      after,
      changes,
      mapIds: place.mapIds,
      override: breaks.length > 0,
    },
  };
}

/**
 * Undo: the edit's "before" values go back, but only while every field it changed still holds
 * the value it set. Otherwise the fields that moved are named and nothing changes.
 */
export function prepareUndo(
  world: World,
  req: {
    name: string;
    edit: { characterId: string; changes: EditChange[]; undoneBy: string | null } | null;
  },
  deps: EditDeps,
): Prepared {
  const target = deps.findCharacter(req.name.trim());
  const e = req.edit;
  if (!target || !e || e.characterId !== target.characterId) {
    return { ok: false, text: EDIT_TEXT.noEdit };
  }
  if (e.undoneBy !== null) {
    return { ok: false, text: EDIT_TEXT.alreadyUndone };
  }
  const cur = currentOf(world, target, deps);
  if (!cur) {
    return { ok: false, text: EDIT_TEXT.noEdit };
  }
  // A field that is no longer saved (Agility, Speed) has nothing to put back.
  const live = e.changes.filter((c) => EDIT_FIELDS.includes(c.field));
  const conflicts = undoConflicts(cur.now, live);
  if (conflicts.length > 0) {
    return { ok: false, text: EDIT_TEXT.undoConflict(fieldLabels(conflicts)) };
  }
  const before = cur.now;
  const after = structuredClone(before);
  for (const c of live) {
    (after as unknown as Record<string, unknown>)[c.field] =
      // A skills change holds only the skills it moved: they go back over the current ones.
      c.field === "skills"
        ? { ...after.skills, ...(c.before as SkillValues) }
        : structuredClone(c.before);
  }
  // The restored state must hold together as it stands now: an HP max put back below the HP
  // gained since, say, is a conflict too.
  const invalid = editErrors(before, after, { restore: true });
  if (invalid.length > 0) {
    return { ok: false, text: `${EDIT_TEXT.undoInvalid} ${invalid.join(" ")}` };
  }
  // Gear put back on must follow the wear rules; an override is never carried over silently.
  const breaks = wearBreaks(before, after, strengthOf(after));
  if (breaks.length > 0) {
    return { ok: false, text: `${EDIT_TEXT.undoWear} ${breaks.join(" ")}` };
  }
  const place = placeChecks(world, target, cur.online, before, after, deps);
  if (!place.ok) {
    return place;
  }
  const changes = diffEdit(before, after);
  if (changes.length === 0) {
    return { ok: false, text: EDIT_TEXT.nothing };
  }
  return {
    ok: true,
    edit: {
      target,
      online: cur.online,
      stored: cur.stored,
      before,
      after,
      changes,
      mapIds: place.mapIds,
      override: false,
    },
  };
}

/**
 * Puts an edit on the live character and returns what their client (and their map) must be
 * sent. The caller writes them afterwards.
 */
export function applyLive(world: World, p: Player, e: PreparedEdit, deps: EditDeps): Outgoing[] {
  const a = e.after;
  const changed = new Set(e.changes.map((c) => c.field));
  const c = p.char;
  const out: Outgoing[] = [];
  c.classCode = a.classCode;
  Object.assign(c.vitals, {
    level: a.level,
    exp: a.exp,
    expNeeded: a.expNeeded,
    hp: a.hp,
    hpMax: a.hpMax,
    sp: a.sp,
    spMax: a.spMax,
  });
  p.vitalsDirty = true;
  c.stats = { str: a.str, sta: a.sta, dex: a.dex, int: a.int, wis: a.wis };
  c.skills = skillsFromKeys(a.skills);
  c.hunger = a.hunger;
  if (changed.has("faction")) {
    c.faction = sortFaction(factionIdOf(a.faction), world.factionPowers);
  }
  c.factionCount = a.factionCount;
  c.wanted = a.wanted;
  c.respawn =
    a.respawn && e.mapIds.respawn
      ? { mapId: e.mapIds.respawn, x: a.respawn.x, y: a.respawn.y }
      : null;
  if (changed.has("gold") || changed.has("bag") || changed.has("equip")) {
    c.gold = a.gold;
    c.bag = a.bag.map((l) => (l ? { item: l.item, qty: l.qty } : null));
    c.equip = { ...a.equip };
    p.invDirty = true;
    if (changed.has("equip")) {
      p.lookDirty = true;
    }
    // A crate or cabinet opened from the bag and edited away closes, as one given away does.
    const box = p.container;
    if (box?.carried && !c.bag.some((l) => l !== null && lingoEq(l.item, box.name))) {
      p.container = null;
      p.keyLock = false;
      out.push({ to: p.id, msg: { t: "vault", items: [], open: false, closed: true } });
    }
  }
  if (changed.has("bank") || changed.has("vault")) {
    c.bank = a.bank;
    c.vault = [...a.vault];
    c.storeDirty = true;
  }
  if (changed.has("spellbook")) {
    p.spell.book = [...a.spellbook];
    p.spell.bookDirty = true;
    out.push({ to: p.id, msg: { t: "spellbook", spells: [...p.spell.book] } });
  }
  if (changed.has("vault") && p.vaultOpen) {
    // An open vault list is replaced, so a click never takes a line it no longer shows.
    out.push({ to: p.id, msg: { t: "vault", items: [...c.vault], open: false } });
  }
  c.sex = a.sex;
  if (changed.has("head")) {
    p.head = a.head;
    // Their own paperdoll redraws with the inventory.
    p.invDirty = true;
    // Everyone on the map, them included, redraws the head at once (no warp). Off the map (an
    // editor or the Control Panel) only they are told, so their own paperdoll follows.
    const room = world.rooms.get(p.map.name);
    for (const o of p.editing ? [p] : (room?.players ?? [p])) {
      out.push({
        to: o.id,
        msg: {
          t: "delta",
          events: [{ e: "look", id: p.id, equip: { ...c.equip }, head: p.head }],
        },
      });
    }
  }
  if (changed.has("position")) {
    // A move is the admin warp. Arriving on an O-O-O map would set the respawn point; the edit
    // keeps the one it shows instead, so a move (or its undo) never changes it on the side and an
    // online edit ends as an offline one does.
    out.push(...adminWarp(world, p, a.position.map, a.position.x, a.position.y, deps));
    c.respawn =
      a.respawn && e.mapIds.respawn
        ? { mapId: e.mapIds.respawn, x: a.respawn.x, y: a.respawn.y }
        : null;
  }
  return out;
}

/**
 * The activity events an edit makes: the gold and items it moved, as `admin` events from the
 * admin, and one event naming the other fields it changed. For an online character the ledger is
 * checked first, so anything gameplay had not yet logged is reported as it was, then started
 * again after the edit.
 */
export function logEdit(
  world: World,
  e: PreparedEdit,
  admin: Player,
  editId: string,
  phase: "before" | "after",
): void {
  const p = e.online;
  if (phase === "before") {
    if (p) {
      checkPlayer(world, p);
    }
    return;
  }
  const who: Player | OfflineCharacter = p ?? {
    id: e.target.characterId,
    accountId: e.target.accountId,
    name: e.target.name,
  };
  const details = { via: "characterEditor", edit: editId };
  const other = { id: admin.id, name: admin.name };
  const carried = (c: EditableCharacter) =>
    holdingsOf({ gold: c.gold, bag: c.bag, equip: c.equip });
  logBagChange(world, who, "admin", carried(e.before), carried(e.after), {
    other,
    details,
  });
  // The bank and the vault are other places (not carried), so the ledger does not move; their
  // amounts are in the details.
  if (e.after.bank !== null && e.before.bank !== null && e.after.bank !== e.before.bank) {
    logActivity(world, who, "admin", {
      other,
      details: { ...details, bank: e.after.bank - e.before.bank },
    });
  }
  const vault = (c: EditableCharacter) => {
    const m = new Map<string, number>();
    for (const v of c.vault) {
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };
  const was = vault(e.before);
  const now = vault(e.after);
  for (const item of new Set([...was.keys(), ...now.keys()])) {
    const d = (now.get(item) ?? 0) - (was.get(item) ?? 0);
    if (d !== 0) {
      logActivity(world, who, "admin", { other, item, details: { ...details, vault: d } });
    }
  }
  const rest = e.changes
    .map((c) => c.field)
    .filter((f) => !["gold", "bag", "equip", "bank", "vault"].includes(f));
  if (rest.length > 0) {
    logActivity(world, who, "admin", {
      other,
      details: { ...details, fields: fieldLabels(rest).join(", ") },
    });
  }
  if (p) {
    resetHoldings(p);
  }
}
