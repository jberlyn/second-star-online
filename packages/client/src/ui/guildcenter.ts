/**
 * The Guild Center: frame 72 (assets/original/main/layout/frame-72.json), drawn in place on the
 * stage. Every piece sits at its sprite's rect; the alignment buttons swap members of the same size
 * and regpoint (cast-manifest Internal 276-281). Origin: the union of every sprite, stage
 * (151, 29).
 *
 * Modes:
 * - create (no guild): 310 #271 art, 311 CANCEL #275, 312 OK #274, 313-315 the alignment buttons
 *   (members 276-278, acting only while 310 shows), 316 the guild name field;
 * - member: 320 #272 art (its script hit-tests the list arrow), 321 the guild name field,
 *   322-324 the alignment (inert here), 325 the leader field, 326 the members list (its own script
 *   selects), 327 OK #288, 328 Leave #289;
 * - leader: the same without Leave, with 329 Disband #291, 330 Exile #292, 331 Abdicate #293.
 * The list popup: 71 #294 (its script's CANCEL 381 < x < 436 and OK x > 436, 142 < y < 165)
 * and 72 the guild list (member 295, the click sound on every line click). The locZ of 71/72
 * is above the screen's art.
 */
import type { GuildAlignment, GuildScreen } from "@secondstaronline/shared";
import { GUILD_DEFAULT_NAME } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action } from "./action.ts";
import { artImg, type Rect } from "./stage.ts";

export const GUILD_ORIGIN = { x: 151, y: 29 } as const;
export const GUILD_SIZE = { w: 356, h: 299 } as const;

/** Stage rects ([l, t, r, b] → x, y, w, h) from frame-72.json; fields use the member box. */
const R = (l: number, t: number, r: number, b: number): Rect => ({
  x: l,
  y: t,
  w: r - l,
  h: b - t,
});
export const GUILD_RECTS = {
  createArt: R(157, 34, 507, 190),
  cancel: R(404, 159, 461, 176),
  create: R(462, 159, 493, 178),
  good: R(301, 104, 357, 132),
  neutral: R(358, 104, 422, 132),
  evil: R(421, 104, 465, 132),
  /** The guild name field, the member box 210×16. */
  nameField: R(265, 79, 475, 95),
  guildArt: R(151, 39, 501, 328),
  /** #272's arrow: 457 < mouseH < 479, 81 < mouseV < 100 (the arrow's own script). */
  arrow: R(458, 82, 479, 100),
  nameB: R(259, 85, 469, 101),
  shownGood: R(295, 109, 351, 137),
  shownNeutral: R(352, 109, 416, 137),
  shownEvil: R(415, 109, 459, 137),
  leader: R(279, 149, 452, 165),
  /** The members list: the 167×90 scroll box and its 16-px bar. */
  members: R(280, 174, 463, 264),
  ok: R(459, 297, 486, 316),
  leave: R(163, 297, 239, 316),
  disband: R(166, 297, 223, 314),
  exile: R(224, 297, 265, 314),
  abdicate: R(271, 297, 337, 314),
  listArt: R(164, 29, 480, 174),
  /** The guild list, stretched to 286×68. */
  list: R(180, 60, 466, 128),
  listCancel: R(382, 143, 436, 165),
  listOk: R(437, 143, 480, 165),
} as const;

/** The alignment members, plain then selected. */
const ALIGN: Record<GuildAlignment, { plain: number; on: number; label: string }> = {
  G: { plain: 276, on: 279, label: "Good" },
  N: { plain: 277, on: 280, label: "Neutral" },
  E: { plain: 278, on: 281, label: "Evil" },
};

export interface GuildCenterActions {
  create(name: string, alignment: GuildAlignment): void;
  close(): void;
  view(name: string): void;
  act(act: "leave" | "disband" | "exile" | "abdicate", viewing: string, member?: string): void;
  sound(s: Sfx): void;
}

export interface GuildCenter {
  el: HTMLElement;
  readonly isOpen: boolean;
  /** The screen in its mode, or closed (null). */
  show(screen: GuildScreen | null): void;
  /** The guild list reply, shown in the guild list. */
  setList(names: readonly string[]): void;
  /** The reply to a guild view. */
  view(v: {
    name: string;
    alignment: GuildAlignment | null;
    leader: string;
    members: string[];
  }): void;
}

const semantic = (label: string) =>
  `guild-${label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

export function createGuildCenter(a: Assets, act: GuildCenterActions): GuildCenter {
  const el = document.createElement("div");
  el.className = "guild-center";
  el.hidden = true;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Guild Center");
  const put = <T extends HTMLElement>(node: T, r: Rect, z: number): T => {
    node.style.left = `${r.x - GUILD_ORIGIN.x}px`;
    node.style.top = `${r.y - GUILD_ORIGIN.y}px`;
    node.style.width = `${r.w}px`;
    node.style.height = `${r.h}px`;
    node.style.zIndex = String(z);
    el.append(node);
    return node;
  };
  const art = (m: number, r: Rect, z: number) => {
    const img = put(artImg(a.ui("internal", m)), r, z);
    img.classList.add("gc-art");
    return img;
  };
  const button = (m: number, origin: string, label: string, r: Rect, z: number, on: () => void) => {
    const b = put(action(document.createElement("button"), origin), r, z);
    b.type = "button";
    b.className = "hit gc-button";
    b.setAttribute("aria-label", label);
    if (m > 0) {
      b.append(artImg(a.ui("internal", m), label));
    }
    b.addEventListener("click", on);
    return b;
  };
  const textField = (cls: string, r: Rect, z: number) => {
    const f = put(document.createElement("div"), r, z);
    f.className = `gc-field ${cls}`;
    return f;
  };

  // ---- create mode (310-316) --------------------------------------------------------------
  const create: HTMLElement[] = [];
  create.push(art(271, GUILD_RECTS.createArt, 9991));
  let alignment: GuildAlignment = "G";
  const alignButtons = (["G", "N", "E"] as const).map((k, i) => {
    const r = [GUILD_RECTS.good, GUILD_RECTS.neutral, GUILD_RECTS.evil][i] as Rect;
    const b = button(0, semantic(ALIGN[k].label), ALIGN[k].label, r, 9994 + i, () => {
      // A selected member has no script; a plain one selects itself.
      if (alignment !== k) {
        alignment = k;
        drawAlign();
      }
    });
    const img = artImg(a.ui("internal", ALIGN[k].plain), ALIGN[k].label);
    b.append(img);
    create.push(b);
    return { b, img };
  });
  const drawAlign = () => {
    (["G", "N", "E"] as const).forEach((k, i) => {
      const x = alignButtons[i];
      if (x) {
        const on = alignment === k;
        x.img.src = a.ui("internal", on ? ALIGN[k].on : ALIGN[k].plain);
        x.b.setAttribute("aria-pressed", String(on));
      }
    });
  };
  // The guild name field: editable, one line, and a `limit` box: typing stops when the 210-px box
  // is full.
  const nameInput = put(
    action(document.createElement("input"), "guild-name"),
    GUILD_RECTS.nameField,
    9997,
  );
  nameInput.className = "gc-input";
  nameInput.type = "text";
  nameInput.spellcheck = false;
  nameInput.value = GUILD_DEFAULT_NAME;
  nameInput.setAttribute("aria-label", "Guild name");
  let lastFit = nameInput.value;
  nameInput.addEventListener("input", () => {
    if (nameInput.scrollWidth > nameInput.clientWidth && nameInput.clientWidth > 0) {
      nameInput.value = lastFit;
    }
    lastFit = nameInput.value;
  });
  create.push(nameInput);
  create.push(
    button(275, semantic("Cancel"), "Cancel", GUILD_RECTS.cancel, 9992, () => {
      close();
      act.close();
    }),
  );
  // OK unlocks the keys at once; the screen stays until the reply.
  create.push(
    button(274, semantic("OK"), "OK", GUILD_RECTS.create, 9993, () =>
      act.create(nameInput.value.slice(0, 100), alignment),
    ),
  );

  // ---- member and leader modes (320-331) --------------------------------------------------
  const guild: HTMLElement[] = [];
  guild.push(art(272, GUILD_RECTS.guildArt, 9991));
  const arrow = button(0, semantic("Guild list"), "Guild list", GUILD_RECTS.arrow, 9991, () =>
    showList(true),
  );
  guild.push(arrow);
  const nameB = textField("gc-name", GUILD_RECTS.nameB, 9992);
  const shown = (["G", "N", "E"] as const).map((k, i) => {
    const r = [GUILD_RECTS.shownGood, GUILD_RECTS.shownNeutral, GUILD_RECTS.shownEvil][i] as Rect;
    const img = art(ALIGN[k].plain, r, 9993 + i);
    img.alt = ALIGN[k].label;
    return img;
  });
  const leaderField = textField("gc-leader", GUILD_RECTS.leader, 9996);
  const memberBox = put(
    action(document.createElement("div"), "guild-select-member"),
    GUILD_RECTS.members,
    9997,
  );
  memberBox.className = "gc-field gc-list gc-members";
  memberBox.setAttribute("role", "listbox");
  memberBox.setAttribute("aria-label", "Guild members");
  guild.push(nameB, ...shown, leaderField, memberBox);
  const okButton = button(288, semantic("OK"), "OK", GUILD_RECTS.ok, 9998, () => {
    close();
    act.close();
  });
  const leave = button(289, semantic("Leave guild"), "Leave guild", GUILD_RECTS.leave, 9999, () => {
    const v = nameB.textContent ?? "";
    // The guard first; then the scripts act and close the screen.
    if (sameGuild(v)) {
      close();
    }
    act.act("leave", v);
  });
  const disband = button(291, semantic("Disband"), "Disband", GUILD_RECTS.disband, 9999, () => {
    const v = nameB.textContent ?? "";
    // The guard first; then the scripts act and close the screen.
    if (sameGuild(v)) {
      close();
    }
    act.act("disband", v);
  });
  const exile = button(292, semantic("Exile"), "Exile", GUILD_RECTS.exile, 9999, () => {
    const v = nameB.textContent ?? "";
    if (!sameGuild(v)) {
      act.act("exile", v);
      return;
    }
    // Nothing selected → nothing; the line goes from the field at once.
    if (selNum === 0) {
      return;
    }
    const target = memberLines[selNum - 1] ?? "";
    memberLines.splice(selNum - 1, 1);
    selNum = 0;
    drawMembers();
    act.act("exile", v, target);
  });
  const abdicate = button(293, semantic("Abdicate"), "Abdicate", GUILD_RECTS.abdicate, 9999, () => {
    const v = nameB.textContent ?? "";
    if (!sameGuild(v)) {
      act.act("abdicate", v);
      return;
    }
    // The selected member survives exile, viewing and reopening (1.6 never cleared it).
    if (selName === "") {
      return;
    }
    act.act("abdicate", v, selName);
  });
  guild.push(okButton);

  // ---- the list popup (71/72) -------------------------------------------------------------
  const list: HTMLElement[] = [];
  list.push(art(294, GUILD_RECTS.listArt, 9998));
  const listBox = put(
    action(document.createElement("div"), "guild-select-guild"),
    GUILD_RECTS.list,
    9999,
  );
  listBox.className = "gc-field gc-list gc-guilds";
  listBox.setAttribute("role", "listbox");
  listBox.setAttribute("aria-label", "Guilds");
  list.push(listBox);
  list.push(
    button(0, "guild-list-cancel", "Cancel", GUILD_RECTS.listCancel, 9999, () => showList(false)),
    button(0, "guild-list-open", "OK", GUILD_RECTS.listOk, 9999, () => {
      showList(false);
      act.view(selGuild);
    }),
  );

  // ---- state ------------------------------------------------------------------------------
  let open = false;
  let mode: "create" | "member" | "leader" = "create";
  let ownGuild = "";
  let memberLines: string[] = [];
  let selNum = 0;
  let selName = "";
  let guildLines: string[] = [];
  let selGuild = "";
  const sameGuild = (v: string) => v.toLowerCase() === ownGuild.toLowerCase();

  const lines = (box: HTMLElement, rows: readonly string[], on: number) => {
    box.replaceChildren(
      ...rows.map((t, i) => {
        const row = document.createElement("div");
        row.className = "gc-row";
        row.setAttribute("role", "option");
        row.textContent = t;
        row.classList.toggle("on", i + 1 === on);
        return row;
      }),
    );
  };
  const drawMembers = () => lines(memberBox, memberLines, selNum);
  const rowIndex = (box: HTMLElement, e: Event) => {
    const row = (e.target as HTMLElement).closest(".gc-row");
    return row ? [...box.children].indexOf(row) + 1 : 0;
  };
  // The members list: the line under the pointer; below the last, nothing.
  memberBox.addEventListener("click", (e) => {
    const n = rowIndex(memberBox, e);
    selName = n > 0 ? (memberLines[n - 1] ?? "") : "";
    selNum = n;
    drawMembers();
  });
  // The guild list: the click sound first, every line, an empty one too.
  listBox.addEventListener("click", (e) => {
    act.sound(SOUND.click);
    const n = rowIndex(listBox, e);
    selGuild = n > 0 ? (guildLines[n - 1] ?? "") : "";
    lines(listBox, guildLines, n);
  });

  const showList = (on: boolean) => {
    for (const x of list) {
      x.hidden = !on;
    }
  };
  const setAlignShown = (al: GuildAlignment | null) => {
    if (al === null) {
      return; // no test matched: 322-324 keep their members
    }
    (["G", "N", "E"] as const).forEach((k, i) => {
      const img = shown[i];
      if (img) {
        img.src = a.ui("internal", al === k ? ALIGN[k].on : ALIGN[k].plain);
      }
    });
  };
  const fill = (
    name: string,
    al: GuildAlignment | null,
    leader: string,
    members: readonly string[],
  ) => {
    nameB.textContent = name;
    setAlignShown(al);
    leaderField.textContent = leader;
    memberLines = [...members];
    selNum = 0;
    drawMembers();
  };
  const close = () => {
    open = false;
    el.hidden = true;
    showList(false);
  };

  showList(false);
  const g: GuildCenter = {
    el,
    get isOpen() {
      return open;
    },
    show(screen) {
      if (!screen) {
        close();
        return;
      }
      open = true;
      el.hidden = false;
      showList(false);
      mode = screen.mode;
      for (const x of create) {
        x.hidden = mode !== "create";
      }
      for (const x of guild) {
        x.hidden = mode === "create";
      }
      leave.hidden = mode !== "member";
      for (const b of [disband, exile, abdicate]) {
        b.hidden = mode !== "leader";
      }
      if (screen.mode === "create") {
        // Each opening starts on Good (an assumption: 1.6's files do not say what resets the
        // swapped member).
        alignment = "G";
        drawAlign();
        ownGuild = "";
        return;
      }
      ownGuild = screen.name;
      fill(screen.name, screen.alignment, screen.leader, screen.members);
    },
    setList(names) {
      guildLines = [...names];
      lines(listBox, guildLines, 0);
    },
    view(v) {
      fill(v.name, v.alignment, v.leader, v.members);
    },
  };
  return g;
}
