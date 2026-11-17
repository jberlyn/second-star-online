/**
 * The Blackjack Table: sprites 333 and 338-353 on frame 72
 * (assets/original/main/layout/frame-72.json), in place on the stage.
 * Every piece sits at its sprite's rect (loc − reg, never the stored size): the table
 * art (340×233, reg 170,116) at loc (323, 170), the four fields, the two bid buttons
 * (14×14, reg 6,8), and ten cards at locV 182, each at its own member's size and regpoint (the
 * card faces 1-7 and the card back 56×81 reg 28,40; faces 8-10 56×82 reg 28,41). Origin: the
 * table's rect, stage (153, 54).
 *
 * One member script reads the mouse (the table's own): Leave mouseH 242-297, V 261-279; Stand
 * H 302-358, V 260-275; Hit H 367-403, V 260-275, each setting a click block of 10. A bid button
 * sets it to 15. The server showing the table shows 333 and 338-353, leaving hides them, and a
 * new deal puts the cards back to the blank member. The server holds the table and sends the
 * whole view after each change.
 */
import type { Assets } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action, gameInput } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";

export const BJ_ORIGIN = { x: 153, y: 54 } as const;
export const BJ_SIZE = { w: 340, h: 233 } as const;

const R = (l: number, t: number, r: number, b: number): Rect => ({
  x: l,
  y: t,
  w: r - l,
  h: b - t,
});

/** Stage rects ([l, t, r, b] → x, y, w, h). */
export const BJ_RECTS = {
  /** 333 the table art: loc (323, 170), reg (170, 116). */
  table: R(153, 54, 493, 287),
  names: [R(231, 65, 338, 81), R(332, 65, 420, 81)],
  bids: [R(231, 85, 289, 101), R(333, 85, 387, 101)],
  /** 342 / 343 the two bid buttons: loc (181, 95) / (459, 95), reg (6, 8). */
  buttons: [R(175, 87, 189, 101), R(453, 87, 467, 101)],
  /** Leave: mouseH 242-297, mouseV 261-279. */
  leave: R(242, 261, 298, 280),
  /** Stand: mouseH 302-358, mouseV 260-275. */
  stand: R(302, 260, 359, 276),
  /** Hit: mouseH 367-403, mouseV 260-275. */
  hit: R(367, 260, 404, 276),
} as const;

/** The cards' locH, channels 344-348 (Player 1) and 349-353 (Player 2); locV 182. */
export const BJ_CARD_X: readonly (readonly number[])[] = [
  [193, 210, 227, 245, 261],
  [383, 400, 417, 434, 451],
];
export const BJ_CARD_Y = 182;

/** Casino members: the card back 21, the ten card faces 23-32. */
export function cardMember(card: number | "back"): {
  member: number;
  w: number;
  h: number;
  rx: number;
  ry: number;
} {
  if (card === "back") {
    return { member: 21, w: 56, h: 81, rx: 28, ry: 40 };
  }
  const tall = card >= 58;
  return { member: card - 51 + 23, w: 56, h: tall ? 82 : 81, rx: 28, ry: tall ? 41 : 40 };
}

/** The stage rect of a card (side 0/1, slot 0-4). */
export function cardRect(card: number | "back", side: 0 | 1, slot: number): Rect {
  const m = cardMember(card);
  return { x: (BJ_CARD_X[side]?.[slot] ?? 0) - m.rx, y: BJ_CARD_Y - m.ry, w: m.w, h: m.h };
}

/** One 20 fps frame. */
export const BJ_FRAME_MS = 50;

export type BjView = Extract<import("@secondstaronline/shared").ServerMsg, { t: "bj"; open: true }>;

export interface BjActions {
  bid(text: string): void;
  hit(): void;
  stand(): void;
  leave(): void;
  /** The key lock. */
  lock(on: boolean): void;
  /** Frame 72 on or off; off plays the first tab. */
  frame(on: boolean): void;
  sound(s: Sfx): void;
}

export interface BlackjackTable {
  el: HTMLElement;
  readonly isOpen: boolean;
  /** The click block. */
  readonly block: number;
  /** The server's view of the table (it opens the screen on the first one). */
  view(v: BjView): void;
  /** The server closed the table (Leave's reply). */
  close(): void;
  /** One animation frame: the click block counts down (the timer's, or a test's). */
  frame(): void;
}

export function createBlackjack(a: Assets, act: BjActions): BlackjackTable {
  const el = document.createElement("div");
  el.className = "blackjack";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Blackjack table");
  const put = <T extends HTMLElement>(node: T, r: Rect, z: number): T => {
    node.style.left = `${r.x - BJ_ORIGIN.x}px`;
    node.style.top = `${r.y - BJ_ORIGIN.y}px`;
    node.style.width = `${r.w}px`;
    node.style.height = `${r.h}px`;
    node.style.zIndex = String(z);
    el.append(node);
    return node;
  };
  const table = put(artImg(a.ui("casino", 20), "Blackjack table"), BJ_RECTS.table, 1);
  table.classList.add("bj-art");
  const names = [0, 1].map((i) => {
    const s = put(document.createElement("span"), BJ_RECTS.names[i] as Rect, 2);
    s.className = "bj-name";
    return s;
  });
  const fields = [0, 1].map((i) => {
    const f = gameInput("blackjack-bid");
    put(f, BJ_RECTS.bids[i] as Rect, 2);
    f.type = "text";
    f.maxLength = 16;
    f.className = "bj-bid";
    f.setAttribute("aria-label", i === 0 ? "Player 1's bid" : "Player 2's bid");
    f.autocomplete = "off";
    return f;
  });
  const buttons = [0, 1].map((i) => {
    const b = action(document.createElement("button"), "blackjack-lock-bid");
    put(b, BJ_RECTS.buttons[i] as Rect, 3);
    b.type = "button";
    b.className = "bj-button hit";
    b.setAttribute("aria-label", "Lock your bid");
    const img = artImg(a.ui("casino", i === 0 ? 41 : 43), "");
    img.classList.add("bj-art");
    b.append(img);
    return { b, img };
  });
  const cards = [0, 1].map((side) =>
    Array.from({ length: 5 }, (_, slot) => {
      const img = artImg(a.ui("casino", 21), "");
      put(img, cardRect("back", side as 0 | 1, slot), 4 + slot);
      img.classList.add("bj-art", "bj-card");
      img.hidden = true;
      return img;
    }),
  );
  const hot = (label: string, r: Rect, on: () => void) => {
    const b = put(
      action(
        document.createElement("button"),
        `blackjack-${label.toLowerCase().replaceAll(" ", "-")}`,
      ),
      r,
      8,
    );
    b.type = "button";
    b.className = "hit bj-hot";
    b.setAttribute("aria-label", label);
    b.addEventListener("click", on);
    return b;
  };

  let open = false;
  let side: 1 | 2 = 1;
  let locked: [boolean, boolean] = [false, false];
  let lastServer: [string, string] = ["", ""];
  let block = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const hide = () => {
    stop();
    open = false;
    block = 0;
    el.hidden = true;
  };

  hot("Leave the table", BJ_RECTS.leave, () => {
    if (block > 0) {
      return;
    }
    block = 10;
    act.leave();
  });
  hot("Stand", BJ_RECTS.stand, () => {
    if (block > 0) {
      return;
    }
    block = 10;
    act.stand();
  });
  hot("Hit", BJ_RECTS.hit, () => {
    if (block > 0) {
      return;
    }
    block = 10;
    act.hit();
  });
  buttons.forEach(({ b }, i) => {
    b.addEventListener("click", () => {
      // Only your own button, not once locked (its member changed), not while blocked.
      if (!open || side !== i + 1 || locked[i] || block > 0) {
        return;
      }
      block = 15;
      act.bid((fields[i] as HTMLInputElement).value);
    });
  });

  const m: BlackjackTable = {
    el,
    get isOpen() {
      return open;
    },
    get block() {
      return block;
    },
    view(v) {
      const first = !open;
      open = true;
      side = v.side;
      locked = [...v.locked];
      el.hidden = false;
      if (first) {
        block = 0;
        lastServer = ["", ""];
        stop();
        timer = setInterval(() => m.frame(), BJ_FRAME_MS);
        act.lock(true);
        act.frame(true);
      }
      for (const i of [0, 1] as const) {
        (names[i] as HTMLElement).textContent = v.names[i];
        const f = fields[i] as HTMLInputElement;
        const mine = side === i + 1;
        // Your own field is local text while unlocked; a changed server value overwrites it.
        if (!mine || locked[i] || v.fields[i] !== lastServer[i]) {
          f.value = v.fields[i];
        }
        lastServer[i] = v.fields[i];
        f.readOnly = !mine || locked[i];
        const btn = buttons[i];
        if (btn) {
          const member = (i === 0 ? 41 : 43) + (locked[i] ? 1 : 0);
          btn.img.src = a.ui("casino", member);
          btn.b.dataset.locked = locked[i] ? "1" : "0";
        }
        const hand = v.hands[i];
        (cards[i] ?? []).forEach((img, slot) => {
          const c = hand[slot];
          if (c === undefined) {
            img.hidden = true;
            return;
          }
          const r = cardRect(c, i, slot);
          const cm = cardMember(c);
          img.src = a.ui("casino", cm.member);
          img.style.left = `${r.x - BJ_ORIGIN.x}px`;
          img.style.top = `${r.y - BJ_ORIGIN.y}px`;
          img.style.width = `${r.w}px`;
          img.style.height = `${r.h}px`;
          img.dataset.card = String(c);
          img.hidden = false;
        });
      }
      for (const s of v.sfx) {
        act.sound(s === "shuffle" ? SOUND.cardShuffle : s === "deal" ? SOUND.cardDeal : SOUND.cash);
      }
    },
    close() {
      const was = open;
      hide();
      if (was) {
        act.lock(false);
        act.frame(false);
      }
    },
    frame() {
      if (block > 0) {
        block -= 1;
      }
    },
  };
  return m;
}
