/**
 * World events (issue #3): offerings, the counters' drift and the counters a fight reads. The rules
 * are shared (`rules/world/events.ts`); this keeps the world's values (`world.counters`), marks
 * them for the save that writes the offerer's bag, and tells the players.
 */
import {
  CHAT_COLOR,
  COUNTER_TEXT,
  content,
  counterCommand,
  counterValue,
  driftCounters,
  findOffering,
  inClasses,
  invDelSlot,
  itemLabel,
  makeOffering,
  offeringText,
} from "@secondstaronline/shared";

import { logActivity } from "../admin/activity.ts";
import type { GroundItem, Outgoing, Player, Room, World } from "./world.ts";

/**
 * The offering a drop of bag line `slot` (1-based) makes onto the faced tile `t`, run in place of
 * the drop, or null when no placed item there takes it (the drop goes on as usual). An item counts
 * as placed when the world put it there (the World Editor, a staff `/drop`, the world seed).
 */
export function offeringDrop(
  world: World,
  room: Room,
  p: Player,
  slot: number,
  t: { x: number; y: number },
): Outgoing[] | null {
  const line = p.char.bag[slot - 1];
  if (!line) {
    return null;
  }
  let onto: GroundItem | undefined;
  let offering: ReturnType<typeof findOffering>;
  for (const g of room.map.ground) {
    if (g.x !== t.x || g.y !== t.y || g.kind !== "admin") {
      continue;
    }
    offering = findOffering(line.item, g.item);
    if (offering) {
      onto = g;
      break;
    }
  }
  if (!offering || !onto) {
    return null;
  }
  const out: Outgoing[] = [];
  const tell = (o: Player, text: string, color: number = CHAT_COLOR.normal) =>
    out.push({ to: o.id, msg: { t: "chat", text, color } });
  const r = makeOffering(offering, p.char.classCode, world.counters);
  if (r.kind === "refused") {
    tell(p, r.text);
    return out;
  }
  const names = { player: p.name, item: itemLabel(line.item), onto: itemLabel(onto.item) };
  if (JSON.stringify(r.counters) !== JSON.stringify(world.counters)) {
    world.counters = r.counters;
    world.countersDirty = true;
  }
  if (!r.keepsItem) {
    logActivity(world, p, "use", {
      item: line.item,
      qty: -1,
      at: { map: p.map.name, x: t.x, y: t.y },
      details: { offering: offering.name, onto: names.onto },
    });
    invDelSlot(p.char.bag, slot - 1, 1);
    p.invDirty = true;
  }
  if (r.message) {
    tell(p, offeringText(r.message, names));
  }
  for (const a of r.announce) {
    const text = offeringText(a.text, names);
    for (const o of world.players.values()) {
      if (inClasses(o.char.classCode, a.classes ?? undefined)) {
        tell(o, text, CHAT_COLOR.broadcast);
      }
    }
  }
  return out;
}

/**
 * The counters' drift, run once a minute: `minute` is the server's minutes running (from 1). A
 * counter that moved is saved with the next write.
 */
export function driftTick(world: World, minute: number): void {
  const next = driftCounters(world.counters, minute);
  if (next) {
    world.counters = next;
    world.countersDirty = true;
  }
}

/**
 * `/counter` (the `contentEditor` permission): lists the counters, or sets one. Returns the reply
 * and, for a set, the change to audit.
 */
export function counterChat(
  world: World,
  p: Player,
  args: string,
): { out: Outgoing[]; changed: { counter: string; before: number; after: number } | null } {
  const say = (text: string): Outgoing[] => [
    { to: p.id, msg: { t: "chat", text, color: CHAT_COLOR.normal } },
  ];
  const cmd = counterCommand(args);
  if (cmd.kind === "error") {
    return { out: say(cmd.text), changed: null };
  }
  if (cmd.kind === "list") {
    const rows = content().events.counters.map((c) => ({
      name: c.name,
      value: counterValue(world.counters, c.name),
    }));
    return {
      out: say(rows.length === 0 ? COUNTER_TEXT.none : COUNTER_TEXT.list(rows)),
      changed: null,
    };
  }
  const before = counterValue(world.counters, cmd.counter.name);
  world.counters = { ...world.counters, [cmd.counter.name]: cmd.value };
  world.countersDirty = true;
  return {
    out: say(COUNTER_TEXT.set(cmd.counter.name, cmd.value)),
    changed: { counter: cmd.counter.name, before, after: cmd.value },
  };
}
