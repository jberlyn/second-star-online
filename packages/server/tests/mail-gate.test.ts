/**
 * The mailbox gate on SEND: a send is taken only while the mailbox is open, from opening it until
 * the list's CLOSE (it used to stay open for the rest of the session once any mailbox had opened).
 */
import { describe, expect, test } from "bun:test";

import { pickupIntent } from "../src/systems/inventory/items.ts";
import { type MailDeps, type MailStore, mailSend, mailUiIntent } from "../src/systems/mail/mail.ts";
import {
  addPlayer,
  createWorld,
  enterRoom,
  type GroundItem,
  type Room,
} from "../src/systems/world/world.ts";
import { player, rngByN, testMap } from "./helpers/sim.ts";

const mailDeps: MailDeps = { chatCooldownFrames: 0, mailBodyMax: 2000, mailboxMax: 50 };

function scene() {
  const map = testMap("x1000y992");
  const world = createWorld();
  const boxes = new Map<string, { id: number; from: string; subject: string; body: string }[]>();
  let n = 0;
  const mail: MailStore = {
    load: (o) => [...(boxes.get(o) ?? [])],
    add: (o, m) => void boxes.set(o, [...(boxes.get(o) ?? []), { id: ++n, ...m }]),
    remove: () => {},
    find: (name) => (["Alice", "Bob"].includes(name) ? { id: name, name } : null),
  };
  const box: GroundItem = {
    id: "m",
    item: "Alice's Mailbox",
    x: 5,
    y: 5,
    kind: "drop",
    expiresAt: null,
  };
  map.ground.push(box);
  const a = player("Alice", map, 5, 6);
  a.facing = "N";
  addPlayer(world, a);
  a.loading = 0;
  const room = world.rooms.get(map.name) as Room;
  const open = () => {
    a.itemPause = 0;
    pickupIntent({ world, rng: rngByN(), now: 1_000_000, mail }, room, a, "m");
  };
  const send = () => mailSend(world, a, { to: "Bob", subject: "S", body: "Hi" }, mail, mailDeps);
  return { world, a, open, send, sent: () => (boxes.get("Bob") ?? []).length };
}

describe("the mailbox gate", () => {
  test("SSO: closing the mailbox ends sending until it is opened again", () => {
    const s = scene();
    s.open();
    expect(s.a.mailUi).toBe(true);
    s.send();
    expect(s.sent()).toBe(1);
    mailUiIntent(s.a, "close");
    expect(s.a.mailUi).toBe(false);
    expect(s.send()).toEqual([]);
    expect(s.sent()).toBe(1);
    s.open();
    s.send();
    expect(s.sent()).toBe(2);
  });

  test("a pane's CLOSE or REPLY keeps the mailbox open", () => {
    const s = scene();
    s.open();
    mailUiIntent(s.a, "reply");
    mailUiIntent(s.a, "composeClose");
    s.send();
    expect(s.sent()).toBe(1);
  });

  test("SSO: a map change ends the mailbox session, so a send from elsewhere is refused", () => {
    const s = scene();
    s.open();
    expect(s.a.mailUi).toBe(true);
    enterRoom(s.world, s.a);
    expect(s.a.mailUi).toBe(false);
    expect(s.a.mailList).toBe(false);
    expect(s.send()).toEqual([]);
    expect(s.sent()).toBe(0);
  });
});
