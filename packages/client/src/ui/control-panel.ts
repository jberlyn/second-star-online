/**
 * The Control Panel (issue #24): a full-page dashboard that takes the game's place. An admin opens
 * it from Admin → Control Panel and goes back with Return to Game. 1.6 had nothing like it; it is a
 * plain SSO page, not original art, and its pages replace the floating admin windows over time.
 *
 * - While it is open the admin is online but off the map, as in the World Editor (the server's
 *   `openControlPanel`). The classic menu bar belongs to the game's 800×600 frame and is not shown.
 * - The header: Return to Game (always shown, the main button), the out-of-world tools that work
 *   over the Control Panel as floating windows (Friends, Who's Online, Send IM with a count of IMs that
 *   came while here, the chat rooms and Player Settings), and Return To Title Screen.
 * - The sidebar: the admin pages your role may use, grouped, then the classic editors (they leave
 *   the Control Panel for their own screens without putting you back on the map).
 * - A page with unsaved changes asks before anything leaves it.
 */
import type { Permission } from "@secondstaronline/shared";

import { action } from "./action.ts";
import { confirmBox, panelButton } from "./control-panel-kit.ts";
import type { Room } from "./gamemenu.ts";

/** One admin page. */
export interface PanelPage {
  /** Stable id, kept on its sidebar link as `data-page`. */
  id: string;
  title: string;
  /** The sidebar heading it sits under. */
  group: string;
  /** Your role needs this to see the page (the server checks every request again). */
  permission: Permission;
  /**
   * A role with this permission doesn't see the page in the sidebar: it reaches the same editor
   * as a tab of another page (the NPCs page is a tab of Creatures & NPCs for a content editor).
   */
  unless?: Permission;
  el: HTMLElement;
  /** Runs each time the page is shown: ask the server for what it lists. */
  onShow?(): void;
  /** Runs when the page stops showing (another page, or the Control Panel closes): stop sound. */
  onHide?(): void;
  /** Unsaved changes on the page: leaving it asks first and discards them. */
  changes?(): number;
  /** Drops the page's unsaved changes (the operator chose Discard changes). */
  discard?(): void;
}

/** A sidebar entry that leaves the Control Panel for another screen (a classic editor). */
export interface PanelLink {
  id: string;
  title: string;
  group: string;
  permission: Permission;
  run(): void;
}

export interface ControlPanelActions {
  returnToGame(): void;
  returnToTitle(): void;
  openFriends(): void;
  openWho(): void;
  sendIm(): void;
  enterRoom(room: Room): void;
  playerSettings(): void;
}

export interface ControlPanelOptions {
  pages: readonly PanelPage[];
  links: readonly PanelLink[];
  actions: ControlPanelActions;
  /** Whether your role holds a permission, as the server last said. */
  can(permission: Permission): boolean;
}

export interface ControlPanel {
  readonly el: HTMLElement;
  /** The page showing, or null. */
  readonly page: string | null;
  /** Shows the Control Panel: the last page you had open, if you may still use it, else the first. */
  open(): void;
  /** Shows a page (asking first if the open one has changes). */
  /** Shows page `id` (asking first if the open page has changes), then runs `then` on it. */
  go(id: string, then?: () => void): void;
  /** Your permissions changed: redraws the sidebar and leaves a page you may no longer use. */
  refresh(): void;
  /** An IM came while the Control Panel is open: counted on Send IM until it is clicked. */
  noteIm(): void;
  /** Answers an open leave question with "stay" (the Control Panel is going away under it). */
  closeQuestions(): void;
  /** The Control Panel is no longer on screen: questions close and no page is open. */
  close(): void;
  /** As `close`, and the next opening starts on the first page (a new session). */
  reset(): void;
  /**
   * Shows a line from the server (a refused chat room or IM, a broadcast) under the header: the
   * game's chat log is not on screen here.
   */
  notice(text: string): void;
}

/** The chat rooms the header lists, in the Chat menu's order. */
const ROOMS: readonly { room: Room; label: string }[] = [
  { room: "general", label: "General Chat" },
  { room: "newPlayer", label: "New Player Chat" },
  { room: "tradingPost", label: "Trading Post Chat" },
  { room: "guild", label: "Guild Chat" },
  { room: "admin", label: "Admin Chat" },
];

export function createControlPanel(opts: ControlPanelOptions): ControlPanel {
  const { actions } = opts;
  const root = document.createElement("div");
  root.className = "control-panel";

  // ---- header ----
  const header = document.createElement("header");
  header.className = "control-panel-header";
  const brand = document.createElement("span");
  brand.className = "control-panel-brand";
  brand.textContent = "Control Panel";
  const back = panelButton(
    "control-panel-return",
    "Return to Game",
    () => guard(actions.returnToGame, "return to the game"),
    "primary",
  );
  back.classList.add("control-panel-return");

  const tools = document.createElement("nav");
  tools.className = "control-panel-tools";
  tools.setAttribute("aria-label", "Tools");
  const tool = (id: string, label: string, run: () => void) => {
    const b = panelButton(id, label, run);
    b.classList.add("control-panel-tool");
    return b;
  };
  let unread = 0;
  const imCount = document.createElement("span");
  imCount.className = "control-panel-badge";
  imCount.hidden = true;
  const im = tool("control-panel-im", "Send IM", () => {
    setUnread(0);
    actions.sendIm();
  });
  im.append(imCount);
  const setUnread = (n: number) => {
    unread = n;
    imCount.textContent = String(n);
    imCount.hidden = n === 0;
    im.setAttribute("aria-label", n === 0 ? "Send IM" : `Send IM, ${n} new`);
  };
  const rooms = action(document.createElement("select"), "control-panel-room");
  rooms.className = "control-panel-rooms";
  rooms.setAttribute("aria-label", "Enter a chat room");
  rooms.addEventListener("change", () => {
    const r = ROOMS.find((x) => x.room === rooms.value);
    rooms.value = "";
    if (r) {
      actions.enterRoom(r.room);
    }
  });
  const fillRooms = () => {
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Chat rooms";
    first.disabled = true;
    rooms.replaceChildren(
      first,
      ...ROOMS.filter((r) => r.room !== "admin" || opts.can("adminChat")).map((r) => {
        const o = document.createElement("option");
        o.value = r.room;
        o.textContent = r.label;
        return o;
      }),
    );
    rooms.value = "";
  };
  tools.append(
    tool("control-panel-friends", "Friends", actions.openFriends),
    tool("control-panel-who", "Who's Online", actions.openWho),
    im,
    rooms,
    tool("control-panel-player-settings", "Player Settings", actions.playerSettings),
  );
  const title = panelButton("control-panel-title", "Return To Title Screen", () =>
    guard(actions.returnToTitle, "return to the title screen"),
  );
  title.classList.add("control-panel-to-title");
  header.append(brand, back, tools, title);

  // ---- sidebar and main ----
  const body = document.createElement("div");
  body.className = "control-panel-body";
  const side = document.createElement("nav");
  side.className = "control-panel-sidebar";
  side.setAttribute("aria-label", "Admin pages");
  const main = document.createElement("main");
  main.className = "control-panel-main";
  const none = document.createElement("p");
  none.className = "control-panel-none";
  none.textContent = "Your role has no admin pages.";
  body.append(side, main);
  const notice = document.createElement("p");
  notice.className = "control-panel-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  root.append(header, notice, body);

  let current: PanelPage | null = null;
  /** The page to come back to when the Control Panel opens again. */
  let last: string | null = null;
  const allowed = () =>
    opts.pages.filter((p) => opts.can(p.permission) && !(p.unless && opts.can(p.unless)));

  /** Runs `go` now, or once the operator agrees to drop the open page's changes. */
  const guard = (go: () => void, what: string) => {
    const n = current?.changes?.() ?? 0;
    if (n === 0) {
      go();
      return;
    }
    const changes = n === 1 ? "an unsaved change" : `${n} unsaved changes`;
    void confirmBox(root, {
      text: `You have ${changes} on ${current?.title}. If you ${what}, ${n === 1 ? "it" : "they"} will be discarded.`,
      confirm: "Discard changes",
      cancel: "Keep editing",
      danger: true,
    }).then((yes) => {
      if (yes) {
        current?.discard?.();
        go();
      }
    });
  };

  const show = (p: PanelPage | null) => {
    if (current && current !== p) {
      current.onHide?.();
    }
    current = p;
    if (p) {
      last = p.id;
    }
    main.replaceChildren(p ? p.el : none);
    for (const a of side.querySelectorAll<HTMLElement>(".control-panel-link")) {
      if (p && a.dataset.page === p.id) {
        a.setAttribute("aria-current", "page");
      } else {
        a.removeAttribute("aria-current");
      }
    }
    p?.onShow?.();
  };

  const go = (id: string, then?: () => void) => {
    const p = allowed().find((x) => x.id === id);
    if (!p) {
      return;
    }
    if (p === current) {
      then?.();
      return;
    }
    guard(() => {
      show(p);
      then?.();
    }, "leave this page");
  };

  const drawSidebar = () => {
    const entries: { group: string; el: HTMLElement }[] = [];
    for (const p of allowed()) {
      const a = action(document.createElement("button"), "control-panel-page");
      a.type = "button";
      a.className = "control-panel-link";
      a.dataset.page = p.id;
      a.textContent = p.title;
      a.addEventListener("click", () => go(p.id));
      entries.push({ group: p.group, el: a });
    }
    for (const l of opts.links.filter((x) => opts.can(x.permission))) {
      const a = action(document.createElement("button"), "control-panel-tool-link");
      a.type = "button";
      a.className = "control-panel-link control-panel-link-out";
      a.dataset.link = l.id;
      a.textContent = l.title;
      a.addEventListener("click", () => guard(l.run, `open the ${l.title}`));
      entries.push({ group: l.group, el: a });
    }
    const groups = [...new Set(entries.map((e) => e.group))];
    side.replaceChildren(
      ...groups.map((g) => {
        const sec = document.createElement("section");
        sec.className = "control-panel-group";
        const h = document.createElement("h2");
        h.className = "control-panel-group-title";
        h.textContent = g;
        sec.append(h, ...entries.filter((e) => e.group === g).map((e) => e.el));
        return sec;
      }),
    );
    if (current) {
      side.querySelector(`[data-page="${current.id}"]`)?.setAttribute("aria-current", "page");
    }
  };

  const closeQuestions = () => {
    root.querySelector(".control-panel-confirm")?.dispatchEvent(new Event("control-panel-cancel"));
  };

  return {
    el: root,
    get page() {
      return current?.id ?? null;
    },
    open() {
      closeQuestions();
      notice.hidden = true;
      notice.textContent = "";
      setUnread(0);
      fillRooms();
      drawSidebar();
      const pages = allowed();
      show(pages.find((p) => p.id === last) ?? pages[0] ?? null);
    },
    go,
    refresh() {
      fillRooms();
      drawSidebar();
      if (current && !allowed().includes(current)) {
        // A page you may no longer use drops what it held, even with changes.
        closeQuestions();
        current.discard?.();
        if (root.isConnected) {
          show(allowed()[0] ?? null);
        } else {
          current.onHide?.();
          current = null;
        }
      }
    },
    close() {
      closeQuestions();
      current?.onHide?.();
      current = null;
    },
    reset() {
      closeQuestions();
      current?.onHide?.();
      current = null;
      last = null;
    },
    noteIm() {
      if (root.isConnected) {
        setUnread(unread + 1);
      }
    },
    closeQuestions,
    notice(text) {
      notice.textContent = text;
      notice.hidden = text === "";
    },
  };
}
