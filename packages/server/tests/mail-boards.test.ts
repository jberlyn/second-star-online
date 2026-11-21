/**
 * Sim tests: mail and message boards on the server.
 */
import { describe, expect, test } from "bun:test";

import type { ServerMsg } from "@secondstaronline/shared";

import { actionIntent, type ItemCtx, pickupIntent } from "../src/systems/inventory/items.ts";
import {
  type BoardDeps,
  type BoardStore,
  boardCloseIntent,
  boardPostIntent,
} from "../src/systems/mail/boards.ts";
import {
  type MailDeps,
  type MailStore,
  mailDelete,
  mailSend,
  mailUiIntent,
} from "../src/systems/mail/mail.ts";
import {
  addPlayer,
  createWorld,
  enterRoom,
  type GroundItem,
  type Player,
  type Room,
  type World,
} from "../src/systems/world/world.ts";
import { player, rngByN, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const chat = (msgs: Out, to: string) =>
  msgs.flatMap((m) => (m.to === to && m.msg.t === "chat" ? [m.msg.text] : []));
const of = (msgs: Out, to: string, t: ServerMsg["t"]) =>
  msgs.filter((m) => m.to === to && m.msg.t === t).map((m) => m.msg);

const mailDeps: MailDeps = { chatCooldownFrames: 60, mailBodyMax: 2000, mailboxMax: 50 };
const boardDeps: BoardDeps = { chatCooldownFrames: 60, boardPostsMax: 200, boardPostMax: 300 };

function scene() {
  const map = testMap("x1000y992");
  const world: World = createWorld();
  const boxes = new Map<string, { id: number; from: string; subject: string; body: string }[]>();
  const posts = new Map<string, { author: string; body: string }[]>();
  let n = 0;
  const known = ["Alice", "Bob", "Carol"];
  const mail: MailStore = {
    load: (o) => [...(boxes.get(o) ?? [])],
    add: (o, m, cap) => {
      const box = boxes.get(o) ?? [];
      box.push({ id: ++n, ...m });
      while (box.length > cap) {
        box.shift();
      }
      boxes.set(o, box);
    },
    remove: (o, id) =>
      void boxes.set(
        o,
        (boxes.get(o) ?? []).filter((m) => m.id !== id),
      ),
    find: (name) => {
      const k = known.find((x) => x.toLowerCase() === name.toLowerCase());
      return k ? { id: k, name: k } : null;
    },
  };
  const boards: BoardStore = {
    load: (b) => [...(posts.get(b.toLowerCase()) ?? [])],
    add: (b, author, body, cap) => {
      const list = posts.get(b.toLowerCase()) ?? [];
      list.push({ author, body });
      while (list.length > cap) {
        list.shift();
      }
      posts.set(b.toLowerCase(), list);
    },
  };
  const join = (name: string, x = 5, y = 6, facing: Player["facing"] = "N"): Player => {
    const p = player(name, map, x, y);
    p.facing = facing;
    addPlayer(world, p);
    p.loading = 0;
    return p;
  };
  const room = (): Room => world.rooms.get(map.name) as Room;
  const ctx = (): ItemCtx => ({ world, rng: rngByN(), now: 1_000_000, mail, boards });
  const put = (id: string, item: string, x: number, y: number): GroundItem => {
    const g: GroundItem = { id, item, x, y, kind: "drop", expiresAt: null };
    map.ground.push(g);
    return g;
  };
  return { world, boxes, posts, mail, boards, join, room, ctx, put, map };
}

describe("opening a mailbox", () => {
  test("click: in front it locks the keys, pauses 40 frames and sends the list", () => {
    const s = scene();
    s.put("m", "Alice's Mailbox", 5, 5);
    const a = s.join("Alice");
    s.mail.add("Alice", { from: "Bob", subject: "Hi", body: "Yo" }, 50);
    const out = pickupIntent(s.ctx(), s.room(), a, "m");
    expect(chat(out, "Alice")).toEqual(["You check your mail..."]);
    expect(of(out, "Alice", "mail")).toEqual([
      { t: "mail", messages: [{ id: 1, from: "Bob", subject: "Hi", body: "Yo" }], lock: true },
    ]);
    expect(a.keyLock).toBe(true);
    expect(a.itemPause).toBe(4);
    expect(a.mailList).toBe(true);
  });

  test("out of place, a stranger hears the position line first", () => {
    const s = scene();
    s.put("m", "Alice's Mailbox", 5, 5);
    const b = s.join("Bob", 9, 9);
    const out = pickupIntent(s.ctx(), s.room(), b, "m");
    expect(chat(out, "Bob")).toEqual([
      "You see the mailbox, but you must be standing in front of it to check it.",
    ]);
    expect(b.keyLock).toBe(false);
  });

  test("in front but not the owner: 'not yours'", () => {
    const s = scene();
    s.put("m", "Alice's Mailbox", 5, 5);
    const b = s.join("Bob");
    const out = pickupIntent(s.ctx(), s.room(), b, "m");
    expect(chat(out, "Bob")).toEqual(["You can't check mail that's not yours!"]);
    expect(b.keyLock).toBe(false);
  });

  test("Universal Mail has no owner test and opens your own box", () => {
    const s = scene();
    s.put("u", "Universal Mail", 5, 5);
    const b = s.join("Bob");
    s.mail.add("Bob", { from: "Carol", subject: "S", body: "B" }, 50);
    const out = pickupIntent(s.ctx(), s.room(), b, "u");
    expect(chat(out, "Bob")).toEqual(["You check your mail..."]);
    expect(of(out, "Bob", "mail")).toHaveLength(1);
  });

  test("bug fixed: Ctrl does not reopen an open mailbox; it opens again once closed", () => {
    const s = scene();
    s.put("m", "Alice's Mailbox", 5, 5);
    const a = s.join("Alice");
    const first = actionIntent(s.ctx(), s.room(), a);
    expect(chat(first, "Alice")).toEqual(["You check your mail..."]);
    expect(a.keyLock).toBe(true);
    expect(a.itemPause).toBe(4);
    a.itemPause = 0;
    expect(actionIntent(s.ctx(), s.room(), a)).toEqual([]);
    expect(a.itemPause).toBe(0);
    mailUiIntent(a, "close");
    expect(a.keyLock).toBe(false);
    expect(chat(actionIntent(s.ctx(), s.room(), a), "Alice")).toEqual(["You check your mail..."]);
  });

  test("bug fixed: Ctrl does nothing while a window holds the key lock or the map loads", () => {
    const s = scene();
    s.put("c", "Clock", 5, 5);
    const a = s.join("Alice");
    a.keyLock = true;
    expect(actionIntent(s.ctx(), s.room(), a)).toEqual([]);
    a.keyLock = false;
    a.loading = 1;
    expect(actionIntent(s.ctx(), s.room(), a)).toEqual([]);
    a.loading = 0;
    expect(chat(actionIntent(s.ctx(), s.room(), a), "Alice")).toEqual(["This is a clock."]);
  });

  test("the click is ignored under the key lock", () => {
    const s = scene();
    s.put("m", "Alice's Mailbox", 5, 5);
    const a = s.join("Alice");
    pickupIntent(s.ctx(), s.room(), a, "m");
    a.itemPause = 0;
    expect(pickupIntent(s.ctx(), s.room(), a, "m")).toEqual([]);
  });
});

describe("the mail buttons mirror the key lock", () => {
  test("bug fixed: composeClose keeps the lock with the list up; close unlocks and takes it down", () => {
    const s = scene();
    s.put("m", "Alice's Mailbox", 5, 5);
    const a = s.join("Alice");
    pickupIntent(s.ctx(), s.room(), a, "m");
    mailUiIntent(a, "reply");
    expect(a.keyLock).toBe(true);
    mailUiIntent(a, "composeClose");
    expect(a.keyLock).toBe(true);
    expect(a.mailList).toBe(true);
    mailUiIntent(a, "close");
    expect(a.mailList).toBe(false);
    expect(a.keyLock).toBe(false);
  });

  test("ignored before any pane has opened", () => {
    const s = scene();
    const a = s.join("Alice");
    a.keyLock = true;
    mailUiIntent(a, "composeClose");
    expect(a.keyLock).toBe(true);
  });
});

describe("sending", () => {
  test("a send with no mailbox opened this session stores nothing", () => {
    const s = scene();
    const a = s.join("Alice");
    s.join("Bob");
    a.mailUi = false;
    expect(mailSend(s.world, a, { to: "Bob", subject: "S", body: "Hi" }, s.mail, mailDeps)).toEqual(
      [],
    );
    expect(s.boxes.get("Bob") ?? []).toEqual([]);
  });

  const send = (
    s: ReturnType<typeof scene>,
    p: Player,
    to: string,
    body = "Hello",
    subject = "Sub",
  ) => {
    p.mailUi = true; // the mailbox was opened (a send needs one)
    return mailSend(s.world, p, { to, subject, body }, s.mail, mailDeps);
  };

  test("the sender is stamped, an unknown name is dropped and mailSent still goes", () => {
    const s = scene();
    const a = s.join("Alice");
    a.keyLock = true;
    const out = send(s, a, "Bob,Nobody");
    expect(s.boxes.get("Bob")).toEqual([{ id: 1, from: "Alice", subject: "Sub", body: "Hello" }]);
    expect(of(out, "Alice", "mailSent")).toHaveLength(1);
  });

  test("bug fixed: a send keeps the keys locked while the list is up", () => {
    const s = scene();
    s.put("m", "Alice's Mailbox", 5, 5);
    const a = s.join("Alice");
    pickupIntent(s.ctx(), s.room(), a, "m");
    send(s, a, "Bob");
    expect(a.mailList).toBe(true);
    expect(a.keyLock).toBe(true);
  });

  test("an online recipient gets the notice, and a reload only with the list up", () => {
    const s = scene();
    const a = s.join("Alice");
    const b = s.join("Bob", 3, 3);
    let out = send(s, a, "Bob");
    expect(chat(out, "Bob")).toEqual(["*** You have new mail from Alice"]);
    expect(of(out, "Bob", "mail")).toEqual([]);
    b.mailList = true;
    a.chatIn = 0;
    out = send(s, a, "Bob");
    const reload = of(out, "Bob", "mail");
    expect(reload).toHaveLength(1);
    expect(reload[0]).toMatchObject({ lock: false });
    expect((reload[0] as { messages: unknown[] }).messages).toHaveLength(2);
  });

  test("mailing yourself reloads your own open list", () => {
    const s = scene();
    const a = s.join("Alice");
    a.mailList = true;
    const out = send(s, a, "alice");
    expect(chat(out, "Alice")).toEqual(["*** You have new mail from Alice"]);
    expect(of(out, "Alice", "mail")).toHaveLength(1);
  });

  test("bug fixed: a repeated name gets one copy; more than 7 names is refused with a line", () => {
    const s = scene();
    const a = s.join("Alice");
    send(s, a, "Bob,bob,BOB");
    expect(s.boxes.get("Bob")).toHaveLength(1);
    a.chatIn = 0;
    const out = send(s, a, "x1,x2,x3,x4,x5,x6,x7,Carol");
    expect(chat(out, "Alice")).toEqual(["*** A message can go to at most 7 people."]);
    expect(of(out, "Alice", "mailSent")).toEqual([]);
    expect(s.boxes.get("Carol")).toBeUndefined();
    expect(a.chatIn).toBe(0);
    send(s, a, ",,,,,,,Carol");
    expect(s.boxes.get("Carol")).toHaveLength(1);
  });

  test("bug fixed: every space and star is stripped from To", () => {
    const s = scene();
    const a = s.join("Alice");
    send(s, a, " B o*b ");
    expect(s.boxes.get("Bob")).toHaveLength(1);
    a.chatIn = 0;
    send(s, a, "Car    ol****");
    expect(s.boxes.get("Carol")).toHaveLength(1);
  });

  test("an empty body or no recipient does nothing", () => {
    const s = scene();
    const a = s.join("Alice");
    expect(send(s, a, "Bob", "")).toEqual([]);
    expect(send(s, a, " , ", "x")).toEqual([]);
    expect(send(s, a, ",,", "x")).toEqual([]);
    expect(s.boxes.size).toBe(0);
    expect(a.chatIn).toBe(0);
  });

  test("the body is cut to 2,000 characters", () => {
    const s = scene();
    const a = s.join("Alice");
    send(s, a, "Bob", "x".repeat(3000));
    expect(s.boxes.get("Bob")?.[0]?.body).toHaveLength(2000);
  });

  test("the 51st message drops the oldest", () => {
    const s = scene();
    const a = s.join("Alice");
    for (let i = 1; i <= 51; i++) {
      a.chatIn = 0;
      send(s, a, "Bob", `m${i}`);
    }
    const box = s.boxes.get("Bob") ?? [];
    expect(box).toHaveLength(50);
    expect(box[0]?.body).toBe("m2");
    expect(box[49]?.body).toBe("m51");
  });

  test("the chat wait refuses with no mailSent and stays locked", () => {
    const s = scene();
    const a = s.join("Alice");
    send(s, a, "Bob");
    a.keyLock = true;
    const out = send(s, a, "Bob");
    expect(chat(out, "Alice")).toEqual(["You cannot chat yet - 3 seconds remaining."]);
    expect(of(out, "Alice", "mailSent")).toEqual([]);
    expect(a.keyLock).toBe(true);
    expect(s.boxes.get("Bob")).toHaveLength(1);
  });

  test("mail from someone you ignore is still delivered", () => {
    const s = scene();
    const a = s.join("Alice");
    const b = s.join("Bob", 3, 3);
    b.ignore = ["Alice"];
    const out = send(s, a, "Bob");
    expect(chat(out, "Bob")).toEqual(["*** You have new mail from Alice"]);
    expect(s.boxes.get("Bob")).toHaveLength(1);
  });
});

describe("deleting", () => {
  test("only your own message; another's id does nothing", () => {
    const s = scene();
    const a = s.join("Alice");
    s.mail.add("Alice", { from: "Bob", subject: "1", body: "a" }, 50);
    s.mail.add("Bob", { from: "Alice", subject: "2", body: "b" }, 50);
    mailDelete(a, 2, s.mail);
    expect(s.boxes.get("Bob")).toHaveLength(1);
    mailDelete(a, 1, s.mail);
    expect(s.boxes.get("Alice")).toHaveLength(0);
  });
});

describe("boards", () => {
  const board = (s: ReturnType<typeof scene>, p: Player, id: string) =>
    pickupIntent(s.ctx(), s.room(), p, id);

  test("bug fixed: Town Square by click needs you in front: locks, no pause", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    s.put("far", "Message Boards", 12, 3);
    const a = s.join("Alice");
    const away = board(s, a, "far");
    expect(chat(away, "Alice")).toEqual([
      "You see the message board, but you must be standing in front of it to read it.",
    ]);
    expect(of(away, "Alice", "board")).toEqual([]);
    expect(a.keyLock).toBe(false);
    expect(a.board).toBeNull();
    const out = board(s, a, "b");
    expect(chat(out, "Alice")).toEqual(["You view the message board"]);
    expect(of(out, "Alice", "board")).toEqual([
      { t: "board", board: { topic: "Town Square", text: "", lock: true } },
    ]);
    expect(a.keyLock).toBe(true);
    expect(a.itemPause).toBe(0);
    expect(a.board).toBe("Town Square");
  });

  test("Town Square by Ctrl keeps Ctrl's pause", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    const a = s.join("Alice");
    actionIntent(s.ctx(), s.room(), a);
    expect(a.itemPause).toBe(4);
    expect(a.board).toBe("Town Square");
  });

  test("bug fixed: a hall's board opens for its members from in front, locks, pause 4", () => {
    const s = scene();
    s.put("g", "The Knights's Board", 5, 5);
    const c = s.join("Carol");
    c.guild = "Knights";
    const out = board(s, c, "g");
    expect(chat(out, "Carol")).toEqual(["You view the message board"]);
    expect(of(out, "Carol", "board")[0]).toMatchObject({
      board: { topic: "The Knights's Board", lock: true },
    });
    expect(c.keyLock).toBe(true);
    expect(c.itemPause).toBe(4);
  });

  test("bug fixed: a hall's board is refused to a non-member and from away", () => {
    const s = scene();
    s.put("g", "The Knights's Board", 5, 5);
    const c = s.join("Carol");
    c.guild = "Rooks";
    expect(chat(board(s, c, "g"), "Carol")).toEqual([
      "Only members of this guild can read its board.",
    ]);
    expect(c.board).toBeNull();
    expect(c.keyLock).toBe(false);
    const k = s.join("Kay", 5, 3, "S");
    k.guild = "Knights";
    k.y = 2; // rows 1-7, but not in front
    expect(chat(board(s, k, "g"), "Kay")).toEqual([
      "You see the message board, but you must be standing in front of it to read it.",
    ]);
    expect(k.board).toBeNull();
    expect(k.itemPause).toBe(4);
  });

  test("bug fixed: a post is appended in 1.6's format and the open board reloads with it", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    const a = s.join("Alice");
    board(s, a, "b");
    const out = boardPostIntent(a, "Hello there", s.boards, boardDeps);
    const text = `From: Alice\r\rHello there\r${"_".repeat(24)}\r`;
    expect(out).toEqual([
      { to: "Alice", msg: { t: "board", board: { topic: "Town Square", text, lock: true } } },
    ]);
    expect(a.board).toBe("Town Square");
    expect(a.keyLock).toBe(true);
    expect(s.posts.get("town square")).toEqual([{ author: "Alice", body: "Hello there" }]);
    const b = s.join("Bob", 4, 5, "E");
    const read = board(s, b, "b");
    expect((of(read, "Bob", "board")[0] as { board: { text: string } }).board.text).toBe(text);
  });

  test("bug fixed: a refused post (no letter or digit) alerts and keeps the keys locked", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    const a = s.join("Alice");
    board(s, a, "b");
    const out = boardPostIntent(a, "!!! ...", s.boards, boardDeps);
    expect(out).toEqual([
      { to: "Alice", msg: { t: "alert", text: "Type in something before you post!!!" } },
    ]);
    expect(a.keyLock).toBe(true);
    expect(a.board).toBe("Town Square");
    expect(boardPostIntent(a, "ok now", s.boards, boardDeps)).toHaveLength(1);
  });

  test("a post is cut to 300 and a board keeps 200", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    const a = s.join("Alice");
    board(s, a, "b");
    boardPostIntent(a, "x".repeat(400), s.boards, boardDeps);
    expect(s.posts.get("town square")?.[0]?.body).toHaveLength(300);
    for (let i = 0; i < 205; i++) {
      s.boards.add("Town Square", "Bob", `p${i}`, 200);
    }
    expect(s.posts.get("town square")).toHaveLength(200);
    expect(s.posts.get("town square")?.[0]?.body).toBe("p5");
  });

  test("the chat wait refuses a post and leaves the board open", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    const a = s.join("Alice");
    board(s, a, "b");
    a.chatIn = 40;
    const out = boardPostIntent(a, "hi", s.boards, boardDeps);
    expect(chat(out, "Alice")).toEqual(["You cannot chat yet - 2 seconds remaining."]);
    expect(a.board).toBe("Town Square");
    expect(s.posts.size).toBe(0);
  });

  test("a post goes to the board that is open", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    s.put("g", "The Knights's Board", 6, 6);
    const a = s.join("Alice");
    a.guild = "Knights";
    board(s, a, "b");
    boardCloseIntent(a);
    a.facing = "E";
    a.y = 6;
    a.itemPause = 0;
    board(s, a, "g");
    boardPostIntent(a, "to the hall", s.boards, boardDeps);
    expect(s.posts.get("the knights's board")).toHaveLength(1);
    expect(s.posts.get("town square")).toBeUndefined();
  });

  test("bug fixed: a map change closes the board", () => {
    const s = scene();
    s.put("g", "The Knights's Board", 5, 5);
    const a = s.join("Alice");
    a.guild = "Knights";
    board(s, a, "g");
    a.map = testMap("x1001y992");
    enterRoom(s.world, a);
    expect(a.board).toBeNull();
    expect(a.keyLock).toBe(false);
    a.chatIn = 0;
    expect(boardPostIntent(a, "from afar", s.boards, boardDeps)).toEqual([]);
    expect(s.posts.get("the knights's board")).toBeUndefined();
  });

  test("Close unlocks and forgets the board", () => {
    const s = scene();
    s.put("b", "Message Boards", 5, 5);
    const a = s.join("Alice");
    board(s, a, "b");
    boardCloseIntent(a);
    expect(a.keyLock).toBe(false);
    expect(a.board).toBeNull();
    expect(boardPostIntent(a, "late", s.boards, boardDeps)).toEqual([]);
  });
});
