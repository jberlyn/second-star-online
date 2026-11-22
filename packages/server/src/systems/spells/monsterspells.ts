/**
 * Monster spells: `M<k>Spell` and the 13 `Cast<Spell>` handlers, run from the mover once per
 * emulated player per frame (SSO runs each player's client copy in turn), aimed at that player.
 *
 * Each handler's own order of draws and exits is kept: the random ladder by the player
 * count, the Passive test, the aim, the Cow/Pig/Spikes/Web/Holy Shield exits, and the no-fight-map
 * test that only the harmful ones make.
 */
import type { MonsterSpellRule } from "@secondstaronline/data";
import { anyMatch, content, lingoContains, type Rng } from "@secondstaronline/shared";

import { hasFlag, npcData } from "../monsters/npcfiles.ts";
import type { MonsterSlot } from "../monsters/slots.ts";
import type { Player, Room } from "../world/world.ts";
import { queueCast } from "./fx.ts";
import { monsterLoc, playerLoc } from "./geometry.ts";

const DIRS = ["L", "R", "U", "D"] as const;

/**
 * `M<k>Spell` for every slot, as the client of `p` ran it: blocked while that client's
 * the monster-spell block runs, and per slot only for a live monster.
 */
export function monsterSpells(room: Room, p: Player, rng: Rng): void {
  if (p.spell.npcSpellBlock > 0) {
    return;
  }
  for (const slot of room.map.slots) {
    const m = slot.live;
    if (!m) {
      continue;
    }
    const spells = npcData(room.npcs, m.name)?.spells ?? [];
    for (const s of content().monsters.casting.spells) {
      if (spells.some((l) => lingoContains(l, `SPL|${s.tag}`))) {
        castOne(room, p, slot, s, rng);
      }
    }
  }
}

function castOne(room: Room, p: Player, slot: MonsterSlot, s: MonsterSpellRule, rng: Rng): void {
  const m = slot.live;
  if (!m) {
    return;
  }
  const ur = s.ladder[Math.min(room.players.length, 7) - 1] ?? s.ladder[0] ?? 90;
  if (rng.random(ur) !== 1) {
    return;
  }
  const passive = hasFlag(room.npcs, m.name, "Passive");
  const unprovoked = passive && !p.npcAttackFlag;
  const never = () => anyMatch(content().monsters.casting.neverCasts, m.name);
  const me = playerLoc(p);
  const mon = monsterLoc(slot) ?? me;
  const sprite = 179 + slot.slot;
  const owner = s.aName ? `a ${sprite}` : String(sprite);
  const noFight = room.map.flags.canFight === "O";
  const aim = () => ({ h: me.h - 30 + rng.random(60), v: me.v - 30 + rng.random(60) });
  const send = (caster: { h: number; v: number }, at: { h: number; v: number }, name = s.name) =>
    queueCast(room, {
      owner,
      ownerId: null,
      name,
      casterH: caster.h,
      casterV: caster.v,
      h: at.h,
      v: at.v,
      power: s.power,
    });
  switch (s.kind) {
    case "aimFirst":
    case "aimNoExit": {
      if (unprovoked) {
        return;
      }
      const a = aim();
      if (s.kind === "aimFirst" && never()) {
        return;
      }
      if (!noFight) {
        send(a, a);
      }
      return;
    }
    case "dirAfterExits":
    case "dirBeforeExits": {
      if (unprovoked) {
        return;
      }
      if (s.kind === "dirAfterExits" && never()) {
        return;
      }
      const d = rng.random(4);
      if (s.kind === "dirBeforeExits" && never()) {
        return;
      }
      const dir = DIRS[d - 1] ?? "L";
      const off: Record<string, [number, number]> = {
        L: [-20, 0],
        R: [20, 0],
        U: [0, -20],
        D: [0, 20],
      };
      const [dh, dv] = off[dir] ?? [0, 0];
      const at = { h: mon.h + dh, v: mon.v + dv };
      if (!noFight) {
        send(at, at, `${s.name}${dir}`);
      }
      return;
    }
    case "onPlayer": {
      if (unprovoked || never()) {
        return;
      }
      const a = aim();
      if (!noFight) {
        send(a, me);
      }
      return;
    }
    case "buff": {
      if (never()) {
        return;
      }
      // Passive and unprovoked: cast at you (the other spell handlers do the same).
      send(mon, unprovoked ? me : mon);
      return;
    }
  }
}
