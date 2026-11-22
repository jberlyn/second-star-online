/**
 * The Assassin's game on the server.
 *
 * 1.6 split it between the clients (the victim reported its rating by `ASSSORT`, the killer
 * computed and sent its points) and the server (the mode, the tally and the tables). SSO does all
 * of it on the server from resolved kills, and the one-hit Lightning flag is the server's mode.
 */
import {
  type AssassinMode,
  type AssassinState,
  CHAT_COLOR,
  combatRating,
  endLines,
  invAdd,
  killPoints,
  prizesGiven,
  type Rng,
  rankEntry,
  STATUE_TEXT,
  scoreLine,
  scoring,
  startLines,
  statueBlock,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import type { Outgoing, Player, World } from "../world/world.ts";

/** What the end needs from outside: the prize setting and a write for offline winners. */
export interface AssassinDeps {
  rng: Rng;
  /** The `assassinPrizes` setting, four lines (first to fourth place), read at the end. */
  prizes: () => readonly string[];
  /** `InvAdd` on an offline character's stored bag (1.6 wrote the file). */
  giveOffline: (characterId: string, prize: string) => void;
}

const toAll = (world: World, text: string): Outgoing[] =>
  [...world.players.values()].map((o) => ({
    to: o.id,
    msg: { t: "chat", text, color: CHAT_COLOR.normal },
  }));

/** One-hit PvP melee is on (1.6's `ltass`). */
export function lightningOn(world: World): boolean {
  return world.assassin.mode === "LIGHTNING";
}

/**
 * Menu 502's three items; the caller has checked the `assassinGame` permission. Both starts send their lines, clear
 * the scores of everyone who scored and the current table, and set the mode; a normal start over a
 * Lightning game ends Lightning, which reading Lightning from the mode does by itself.
 */
export function setAssassinMode(world: World, mode: AssassinMode, deps: AssassinDeps): Outgoing[] {
  const s = world.assassin;
  world.assassinDirty = true;
  if (mode === "STOP") {
    return endGame(world, s, deps);
  }
  s.scores.clear();
  s.current = [];
  s.mode = mode;
  return startLines(mode).flatMap((t) => toAll(world, t));
}

/**
 * The end of a game: the lines, a win for the first, the mode STOP, then prizes 1-4 to the first
 * four. Nobody scored: no winners, no win and no prizes; a missing place prints blank (second and
 * third) and gets nothing. The current table stays for the Statue.
 */
function endGame(world: World, s: AssassinState, deps: AssassinDeps): Outgoing[] {
  const out = endLines(s.current).flatMap((t) => toAll(world, t));
  const first = s.current[0];
  if (first) {
    const wins = (s.wins.get(first.id) ?? 0) + 1;
    s.wins.set(first.id, wins);
    s.legends = rankEntry(s.legends, { id: first.id, name: first.name, points: wins }) ?? s.legends;
  }
  s.mode = "STOP";
  prizesGiven(deps.prizes()).forEach((prize, k) => {
    const w = s.current[k];
    if (!w) {
      return;
    }
    const online = world.players.get(w.id);
    if (online) {
      // A full bag loses the item; gold always lands.
      const r = invAdd(online.char, prize, 1, deps.rng);
      const details = { prize: "Assassin", lost: r.kind === "full" ? 1 : null };
      logActivity(
        world,
        online,
        "reward",
        r.kind === "gold"
          ? { gold: r.amount, details }
          : { item: prize, qty: r.kind === "full" ? 0 : 1, details },
      );
      online.invDirty = true;
    } else {
      deps.giveOffline(w.id, prize);
    }
  });
  return out;
}

/**
 * Scores a kill (1.6's `ASSSORT` → `CompareAss` → `ASSGAMEADDSCORE`) at the end of `victim`'s death
 * lock, after the death line. The killer is whoever last hit it, by id, if still online and not
 * itself; a wanted victim counts too. The victim's rating is taken after its death penalty, the
 * killer's as it stands. Nothing while no game runs.
 */
export function scoreKill(world: World, victim: Player): Outgoing[] {
  const s = world.assassin;
  const id = victim.lastToHitId;
  if (!scoring(s.mode) || id === null || id === victim.id) {
    return [];
  }
  const killer = world.players.get(id);
  if (!killer) {
    return [];
  }
  const points = killPoints(
    s.mode,
    combatRating(killer.char.skills, killer.char.vitals.hpMax),
    combatRating(victim.char.skills, victim.char.vitals.hpMax),
  );
  const total = (s.scores.get(killer.id) ?? 0) + points;
  s.scores.set(killer.id, total);
  s.current =
    rankEntry(s.current, { id: killer.id, name: killer.name, points: total }) ?? s.current;
  world.assassinDirty = true;
  return toAll(world, scoreLine(killer.name, points));
}

/**
 * The Statue: its line to the clicker, then the all-time block and the current block, each a chat
 * line in colour 0.
 */
export function statueLines(world: World): string[] {
  return [
    STATUE_TEXT,
    statueBlock("allTime", world.assassin.legends),
    statueBlock("current", world.assassin.current),
  ];
}
