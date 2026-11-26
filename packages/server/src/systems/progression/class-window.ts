/**
 * The player's Class window (issue #15): your class, what it gives, and each way out of it with
 * every check marked, the trainers that teach it, and a Change button for a path taken from the
 * window. Only in a world that uses it (`classWindowOn`): Classic's players never see it, as in 1.6.
 * Also the note a trainer's list shows beside a class with paths.
 */
import {
  allClassWays,
  atTrainer,
  type ClassCardView,
  type ClassWay,
  type ClassWayView,
  type ClassWindowView,
  classPerkLines,
  classRow,
  classWindowOn,
  fromWindow,
  lingoEq,
  promoteFromWindow,
  SKILL_KEYS,
  skillDisplay,
  wayGrantLines,
  wayStatus,
  waysOutOf,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import { applyPromotion, promotionState } from "../economy/intents.ts";
import type { ItemCtx } from "../inventory/items.ts";
import type { NpcStore } from "../monsters/npcfiles.ts";
import type { Outgoing, Player } from "../world/world.ts";

/** A class as the window shows it; an unknown code shows as "class <code>". */
function card(code: number): ClassCardView {
  const row = classRow(code);
  return {
    code,
    name: row?.name ?? `class ${code}`,
    description: row?.description ?? null,
    icon: row?.icon ?? null,
    perks: classPerkLines(code, (i) => skillDisplay(SKILL_KEYS[i] ?? "")),
  };
}

/** The NPCs whose files train a class (`TRN|<class>:<price>`), A–Z. */
function trainersOf(npcs: NpcStore, cls: string): string[] {
  const out: string[] = [];
  for (const f of npcs.values()) {
    if (!f.empty && f.trains.some((t) => lingoEq(t.cls, cls))) {
      out.push(f.name);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Every check of a way, as the window lists them: requirements, the gold, then the items. */
function checks(w: ClassWay, p: Player): ClassWayView["checks"] {
  const st = wayStatus(w, promotionState(p));
  return [
    ...st.requires.map((r) => ({ label: `${r.label} (you have ${r.have})`, met: r.met })),
    ...(st.gold.need > 0
      ? [{ label: `${st.gold.need.toLocaleString("en-US")} gold`, met: st.gold.met }]
      : []),
    ...st.items.map((i) => ({
      label: `${i.qty === 1 ? i.item : `${i.qty} ${i.item}`}${i.keep ? " (kept)" : ""} (you have ${i.have})`,
      met: i.met,
    })),
  ];
}

/** The window's contents for `p`. */
export function classWindowView(npcs: NpcStore, p: Player): ClassWindowView {
  const code = p.char.classCode;
  const ways = waysOutOf(code).filter((w) => w.to.code !== code);
  return {
    current: card(code),
    ways: ways.map((w) => {
      const list = checks(w, p);
      return {
        to: card(w.to.code),
        text: w.text ?? null,
        trainers: atTrainer(w) ? trainersOf(npcs, w.to.name) : [],
        here: fromWindow(w),
        checks: list,
        grants: wayGrantLines(w, skillDisplay),
        ready: list.every((c) => c.met),
      };
    }),
  };
}

/** Game ▸ Your Class: the window, in a world that uses it. */
export function classOpenIntent(npcs: NpcStore, p: Player): Outgoing[] {
  if (!classWindowOn()) {
    return [];
  }
  return [{ to: p.id, msg: { t: "classWindow", view: classWindowView(npcs, p) } }];
}

/**
 * The Class window's Change: a path into `code` the window may take, from your class, every check
 * met. A promotion changes the class, gold, vitals, skills, bag and spellbook, plays `heal2` and
 * refreshes the window.
 */
export function classPromoteIntent(
  ctx: ItemCtx,
  p: Player,
  code: number,
): { out: Outgoing[]; changed: boolean } {
  if (!classWindowOn()) {
    return { out: [], changed: false };
  }
  const tell = (text: string): Outgoing => ({
    to: p.id,
    msg: { t: "chat", text, color: 0 },
  });
  const before = p.char.gold;
  const r = promoteFromWindow(promotionState(p), code, ctx.rng);
  const out: Outgoing[] = r.texts.map(tell);
  if (r.result) {
    if (r.result.gold !== before) {
      logActivity(ctx.world, p, "pay", {
        gold: r.result.gold - before,
        details: { train: classRow(code)?.name ?? String(code) },
      });
    }
    applyPromotion(p, r.result);
    out.push({ to: p.id, msg: { t: "sound", name: "heal2", ch: 3 } });
  }
  out.push({ to: p.id, msg: { t: "classWindow", view: classWindowView(ctx.world.npcs, p) } });
  return { out, changed: r.result !== null };
}

/**
 * A trainer's list note for a class with paths (issue #15): what it needs, each marked, with the
 * trainer's price. Undefined for a class with only 1.6's promotion, whose trainers say nothing more.
 */
export function trainNote(p: Player, cls: string, price: number): string | undefined {
  const ways = allClassWays().filter((w) => atTrainer(w) && !w.legacy && lingoEq(w.to.name, cls));
  if (ways.length === 0) {
    return undefined;
  }
  const mine = ways.filter((w) => w.from.includes(p.char.classCode));
  const w = mine[0];
  if (!w) {
    const from = ways.flatMap((x) => x.from).map((c) => classRow(c)?.name ?? `class ${c}`);
    return `Only for ${[...new Set(from)].join(", ")}.`;
  }
  const st = wayStatus(w, promotionState(p), price);
  const parts = [
    ...st.requires.map((r) => `${r.label} ${r.met ? "✓" : "✗"}`),
    ...(st.gold.need > 0
      ? [`${st.gold.need.toLocaleString("en-US")} gold ${st.gold.met ? "✓" : "✗"}`]
      : []),
    ...st.items.map((i) => `${i.qty === 1 ? i.item : `${i.qty} ${i.item}`} ${i.met ? "✓" : "✗"}`),
  ];
  return parts.length === 0 ? "Ready." : `Needs ${parts.join(", ")}.`;
}
