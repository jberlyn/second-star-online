/**
 * The Control Panel's Characters page and player hub (issue #26). 1.6 had nothing like it: staff
 * read a character's text files by hand. It is a plain SSO page built from the Control Panel's
 * shared parts.
 *
 * - **Search:** characters whose name contains the text, online or not. A row opens the hub.
 * - **The hub:** one character in one place. Overview (class, vitals, stats, skills, where they
 *   are), Items (gold, bank, bag, worn gear, vault, spellbook, houses), Moderation (what is in
 *   force, the buttons and the history, with addresses for a role with `/banip`) and Chat (their
 *   newest lines, for a role with `/chatlog`). Activity opens their Activity Log timeline.
 * - **Houses** (issue #36): each house's map, door, interior, type, shops and House Vault count.
 *   With `characterEditor`, Revoke and Transfer ask the server what the change will do, show it,
 *   and act only once the admin confirms that.
 * - The server reads an online character live, so the hub is never a save behind. Every read is
 *   audited.
 */
import {
  CHARACTER_SEARCH_MAX,
  type CharacterHub,
  type CharacterListRow,
  type ChatLogRow,
  classLabel,
  content,
  EDIT_TEXT,
  type EditableCharacter,
  factionLabel,
  type HousePreview,
  HUB_ACTIONS,
  HUB_TEXT,
  type HubAction,
  type HubHouse,
  historyLine,
  type ModerationLogRow,
  type ModerationRecord,
  type Permission,
  sexLabel,
  TIMED_HUB_ACTIONS,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import { activityTime } from "./activity-log.ts";
import { createCharacterEditor, createEditLog } from "./character-editor.ts";
import {
  confirmBox,
  createTable,
  formField,
  pageHeading,
  panelButton,
} from "./control-panel-kit.ts";

export interface CharactersPageOptions {
  search(seq: number, query: string): void;
  open(seq: number, name: string): void;
  moderate(req: {
    seq: number;
    name: string;
    action: HubAction;
    duration: string;
    reason: string;
  }): void;
  /** The character editor's save, and undo from its log. */
  edit(req: {
    seq: number;
    name: string;
    set: Partial<EditableCharacter>;
    seen: Partial<EditableCharacter>;
    override: boolean;
    reason: string;
  }): void;
  undo(req: { seq: number; name: string; id: string; reason: string }): void;
  /** The hub's houses (issue #36): what a revoke or transfer would do, asked before either. */
  housePreview(req: {
    seq: number;
    name: string;
    interior: string;
    action: "revoke" | "transfer";
    to: string;
  }): void;
  houseRevoke(req: {
    seq: number;
    name: string;
    interior: string;
    expect: string;
    reason: string;
  }): void;
  houseTransfer(req: {
    seq: number;
    name: string;
    interior: string;
    to: string;
    expect: string;
    reason: string;
  }): void;
  /** Opens the character's timeline on the Activity Log page. */
  openActivity(name: string): void;
  /** Whether your role holds a permission, as the server last said. */
  can(permission: Permission): boolean;
}

export interface CharactersPage {
  readonly el: HTMLElement;
  /** Runs each time the page is shown: the last search again, or the hub open again. */
  onShow(): void;
  /** The server's answers. */
  receiveList(msg: { seq: number; rows: CharacterListRow[] }): void;
  receiveHub(msg: { seq: number; hub: CharacterHub | null; error?: string }): void;
  receiveResult(msg: { seq: number; ok: boolean; text: string }): void;
  receiveHousePreview(msg: { seq: number; preview: HousePreview | null; error?: string }): void;
  /**
   * Your permissions changed: what the hub may no longer show goes at once, an open question
   * closes, and the hub is read again.
   */
  permissionsChanged(): void;
  /** Opens a character's hub (from another page). */
  openHub(name: string): void;
  /** Forgets everything shown (a logout, or the permission lost). */
  reset(): void;
}

const ACTION_LABELS: Record<HubAction, string> = {
  kick: "Kick",
  ban: "Ban",
  unban: "Lift ban",
  jail: "Jail",
  unjail: "Release from jail",
  mute: "Mute",
  unmute: "Lift mute",
};

/** The equipment fields in the paperdoll's order, with their labels. */
const WORN: readonly [string, string][] = [
  ["head", "Head"],
  ["body", "Body"],
  ["weapon", "Weapon"],
  ["offHand", "Off hand"],
  ["feet", "Feet"],
  ["ring", "Ring"],
];

const STAT_LABELS: readonly [keyof CharacterHub["sheet"]["stats"], string][] = [
  ["str", "Strength"],
  ["sta", "Stamina"],
  // The game labels Dexterity "Mysticism" on the stats panel and the creation screen.
  ["dex", "Mysticism (dex)"],
  ["int", "Intelligence"],
  ["wis", "Wisdom"],
];

type Tab = "overview" | "items" | "edit" | "edits" | "moderation" | "chat";
const TABS: readonly [Tab, string][] = [
  ["overview", "Overview"],
  ["items", "Items"],
  ["edit", "Edit"],
  ["edits", "Edits"],
  ["moderation", "Moderation"],
  ["chat", "Chat"],
];

/** `ends 2026-11-29 09:00:00 UTC` or `permanent`. */
function endText(r: ModerationRecord): string {
  return r.expiresAt === null ? "permanent" : `until ${activityTime(r.expiresAt)} UTC`;
}

/** A term and its value, for a `<dl>`. */
function facts(rows: readonly [string, string][]): HTMLElement {
  const dl = document.createElement("dl");
  dl.className = "hub-facts";
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
  return dl;
}

function subtitle(text: string): HTMLElement {
  const h = document.createElement("h2");
  h.className = "activity-subtitle";
  h.textContent = text;
  return h;
}

function section(title: string, ...body: Node[]): HTMLElement {
  const s = document.createElement("section");
  s.className = "hub-section";
  s.append(subtitle(title), ...body);
  return s;
}

function wide(s: HTMLElement): HTMLElement {
  s.classList.add("hub-wide");
  return s;
}

function list(items: readonly string[], empty: string): HTMLElement {
  if (items.length === 0) {
    const p = document.createElement("p");
    p.className = "control-panel-table-empty";
    p.textContent = empty;
    return p;
  }
  const ul = document.createElement("ul");
  ul.className = "hub-list";
  for (const i of items) {
    const li = document.createElement("li");
    li.textContent = i;
    ul.append(li);
  }
  return ul;
}

/** `2 Apple, Knife`, or `nothing`. */
function itemsText(items: readonly { item: string; qty: number }[]): string {
  return items.map((i) => (i.qty === 1 ? i.item : `${i.qty} ${i.item}`)).join(", ") || "nothing";
}

/** A container's lines as `2 Apple, Knife`. */
function linesText(lines: readonly string[]): string {
  const by = new Map<string, { item: string; qty: number }>();
  for (const l of lines) {
    const e = by.get(l) ?? { item: l, qty: 0 };
    e.qty += 1;
    by.set(l, e);
  }
  return itemsText([...by.values()]);
}

/** `a, b and c`. */
function andList(words: readonly string[]): string {
  return words.length <= 1
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** A house's row text: `Small House on x1000y992 (10, 5)`. */
export function houseLabel(h: HubHouse): string {
  return `${h.type ?? "House"} on ${h.map} (${h.x}, ${h.y})`;
}

/** A house's shops, as the Houses table shows them. */
function shopsText(h: HubHouse): string {
  return (
    h.shops
      .map(
        (s) =>
          `${s.npc}: ${s.lines} line${s.lines === 1 ? "" : "s"}, ${s.stock} in stock, till ${s.till.toLocaleString("en")} gold`,
      )
      .join("; ") || "No shop"
  );
}

/** The question a house preview asks, and what the change will do, line by line (issue #36). */
export function housePreviewText(p: HousePreview): { text: string; list: string[] } {
  const where = houseLabel(p.house);
  const list: string[] = [];
  if (p.action === "revoke") {
    if (p.inside.length > 0) {
      list.push(`Everyone inside (${p.inside.join(", ")}) is moved out to its door.`);
    }
    list.push(
      p.vaultFate === "destroyed"
        ? `${p.vault.name} is destroyed: ${linesText(p.vault.items)}.`
        : `${p.vault.name} is kept: they own another house.`,
    );
    for (const s of p.shops) {
      list.push(
        `${s.npc}'s shop is destroyed: stock ${itemsText(s.stock)}; till ${s.till.toLocaleString("en")} gold.`,
      );
    }
    list.push(`On the floor, destroyed: ${itemsText(p.floor)}.`);
    list.push("This can't be undone.");
    return { text: `Demolish ${p.owner}'s ${where}, interior ${p.house.interior}?`, list };
  }
  const to = p.to ?? "";
  if (p.renames.length > 0) {
    list.push(`Its ${andList(p.renames)} become ${to}'s.`);
  }
  if (p.guild !== null) {
    list.push(`Its door and Guild Vault stay The ${p.guild}'s; their Guild Key opens it.`);
  } else if (!p.renames.includes("header")) {
    list.push("Its header is kept as it is.");
  }
  for (const s of p.shops) {
    list.push(
      `${s.npc} works for ${to}, with its stock (${itemsText(s.stock)}) and till (${s.till.toLocaleString("en")} gold).`,
    );
  }
  if (p.vault.items.length === 0) {
    list.push(`${p.vault.name} is empty: nothing moves.`);
  } else if (p.vaultFate === "kept") {
    list.push(`${p.vault.name} stays ${p.owner}'s: they own another house.`);
  } else {
    list.push(
      `${p.vault.name}'s contents move ${p.vaultFate === "merged" ? "in with what is already in" : "into"} ${to}'s House Vault: ${linesText(p.vault.items)}.`,
    );
  }
  if (p.inside.length > 0) {
    list.push(`Anyone inside (${p.inside.join(", ")}) stays where they are.`);
  }
  // Transferring it back gives the house back, but the vault rules apply again then.
  list.push(
    p.vaultFate === "moved" || p.vaultFate === "merged"
      ? `Transferring it back returns the house and its shops, but not necessarily the vault's contents: they go back only if ${to} owns no other house then.`
      : "Transferring it back returns the house and its shops; the vault rules apply again then.",
  );
  return { text: `Give ${p.owner}'s ${where}, interior ${p.house.interior}, to ${to}?`, list };
}

export function createCharactersPage(opts: CharactersPageOptions): CharactersPage {
  const root = document.createElement("section");
  root.className = "characters";
  root.append(
    pageHeading(
      "Characters",
      "Find a character to see their sheet, items, moderation and history. Times are UTC.",
    ),
  );

  let seq = 0;
  let lastQuery: string | null = null;
  /** The hub on screen, by name, or null for the search. */
  let openName: string | null = null;
  let hub: CharacterHub | null = null;
  let tab: Tab = "overview";

  // ---- the search ------------------------------------------------------------------------------
  const searchBox = document.createElement("div");
  const form = document.createElement("form");
  form.className = "activity-filters";
  form.addEventListener("submit", (e) => e.preventDefault());
  const query = gameInput("characters-query");
  query.type = "search";
  query.maxLength = CHARACTER_SEARCH_MAX;
  query.spellcheck = false;
  query.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
  });
  form.append(
    formField("Name", query, HUB_TEXT.searchHelp),
    panelButton("characters-search", "Search", () => search(), "primary"),
  );
  const status = document.createElement("p");
  status.className = "activity-status";
  status.setAttribute("role", "status");
  const results = createTable<CharacterListRow>({
    label: "Characters",
    columns: [
      { label: "Name", cell: (r) => r.name },
      { label: "Level", cell: (r) => String(r.level), numeric: true },
      { label: "Class", cell: (r) => classLabel(r.classCode) },
      { label: "Role", cell: (r) => r.role ?? "" },
      { label: "Status", cell: (r) => (r.online ? "Online" : "Offline") },
      { label: "Last saved (UTC)", cell: (r) => activityTime(r.lastSaved) },
    ],
    empty: "",
    key: (r) => r.name,
    open: { id: "characters-open", run: (r) => openHub(r.name) },
  });
  results.el.hidden = true;
  searchBox.append(form, status, results.el);

  // ---- the hub ---------------------------------------------------------------------------------
  const hubBox = document.createElement("div");
  hubBox.className = "hub";
  hubBox.hidden = true;
  const back = panelButton("hub-back", "All characters", () => closeHub());
  const refresh = panelButton("hub-refresh", "Refresh", () => {
    if (openName) {
      ask(openName);
    }
  });
  const activity = panelButton("hub-activity", "Activity Log", () => {
    if (hub) {
      opts.openActivity(hub.name);
    }
  });
  const hubTools = document.createElement("div");
  hubTools.className = "hub-tools";
  hubTools.append(back, refresh, activity);
  const hubTitle = document.createElement("h2");
  hubTitle.className = "hub-title";
  const hubSummary = document.createElement("p");
  hubSummary.className = "hub-summary";
  const hubStatus = document.createElement("p");
  hubStatus.className = "activity-status";
  hubStatus.setAttribute("role", "status");
  const tabs = document.createElement("div");
  tabs.className = "activity-modes";
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Show");
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  for (const [t, label] of TABS) {
    const b = panelButton(`hub-tab-${t}`, label, () => showTab(t));
    tabButtons.set(t, b);
    tabs.append(b);
  }
  const body = document.createElement("div");
  body.className = "hub-body";
  hubBox.append(hubTools, hubTitle, hubSummary, hubStatus, tabs, body);

  root.append(searchBox, hubBox);

  // ---- moderation controls (kept across redraws so a half-typed reason survives) ----------------
  const modAction = action(document.createElement("select"), "hub-action");
  const modLength = gameInput("hub-length");
  modLength.type = "text";
  modLength.maxLength = 12;
  modLength.placeholder = "default";
  modLength.spellcheck = false;
  const modReason = gameInput("hub-reason");
  modReason.type = "text";
  modReason.maxLength = 200;
  const modResult = document.createElement("p");
  modResult.className = "activity-status";
  modResult.setAttribute("role", "status");
  const lengthField = formField(
    "Length",
    modLength,
    "Such as 30m, 12h, 7d or perm. Empty uses the server's default.",
  );
  // A kick takes no reason: its command logs only who was kicked.
  const reasonField = formField(
    "Reason",
    modReason,
    "Kept in the moderation log. Required to ban, jail or mute.",
  );
  const modApply = panelButton("hub-apply", "Apply", () => apply(), "danger");
  /** The request waiting for its result (a moderation button, an edit or an undo), and its hub. */
  let modSeq = 0;
  let pendingMod: {
    seq: number;
    name: string;
    kind: "moderate" | "edit" | "undo" | "house";
  } | null = null;
  /** Answers an open question with Cancel (the hub or the page it was asked on is going). */
  const cancelQuestion = () =>
    root.querySelector(".control-panel-confirm")?.dispatchEvent(new Event("control-panel-cancel"));
  const fillActions = () => {
    const was = modAction.value;
    modAction.replaceChildren(
      ...HUB_ACTIONS.filter((a) => opts.can(a)).map((a) => {
        const o = document.createElement("option");
        o.value = a;
        o.textContent = ACTION_LABELS[a];
        return o;
      }),
    );
    if ([...modAction.options].some((o) => o.value === was)) {
      modAction.value = was;
    }
    drawLength();
  };
  const drawLength = () => {
    lengthField.hidden = !TIMED_HUB_ACTIONS.includes(modAction.value as HubAction);
    reasonField.hidden = modAction.value === "kick";
  };
  modAction.addEventListener("change", drawLength);
  const modForm = document.createElement("form");
  modForm.className = "activity-filters";
  modForm.addEventListener("submit", (e) => e.preventDefault());
  modForm.append(formField("Action", modAction), lengthField, reasonField, modApply);

  const apply = () => {
    const h = hub;
    const a = modAction.value as HubAction;
    if (!h || !HUB_ACTIONS.includes(a)) {
      return;
    }
    const timed = TIMED_HUB_ACTIONS.includes(a);
    if (timed && modReason.value.trim() === "") {
      modResult.textContent = HUB_TEXT.needReason;
      modReason.focus();
      return;
    }
    const length = timed ? modLength.value.trim() : "";
    // What was asked about is what is sent, even if the fields change behind the question.
    const reason = a === "kick" ? "" : modReason.value;
    const what =
      a === "kick"
        ? `Kick ${h.name} from the game?`
        : `${ACTION_LABELS[a]} ${h.name}${timed ? ` for ${length === "" ? "the default length" : length}` : ""}?`;
    void confirmBox(root, {
      text: what,
      confirm: ACTION_LABELS[a],
      cancel: "Cancel",
      danger: a === "kick" || timed,
    }).then((yes) => {
      // Still the same hub, on screen, and still allowed: the role or the page may have changed
      // while the question was open.
      if (!yes || !root.isConnected || hub?.name !== h.name || !opts.can(a)) {
        return;
      }
      if (pendingMod !== null) {
        modResult.textContent = EDIT_TEXT.wait;
        return;
      }
      modSeq += 1;
      pendingMod = { seq: modSeq, name: h.name, kind: "moderate" };
      modResult.textContent = "Working…";
      opts.moderate({
        seq: modSeq,
        name: h.name,
        action: a,
        duration: length,
        reason,
      });
    });
  };

  // ---- the editor and its log ------------------------------------------------------------------
  const editor = createCharacterEditor({
    host: root,
    save: (req) => {
      const h = hub;
      // One change at a time: a second could hide the first's answer.
      if (!h || !opts.can("characterEditor") || pendingMod !== null) {
        return false;
      }
      modSeq += 1;
      pendingMod = { seq: modSeq, name: h.name, kind: "edit" };
      opts.edit({ seq: modSeq, name: h.name, ...req });
      return true;
    },
  });
  const editLog = createEditLog({
    host: root,
    canUndo: () => opts.can("characterEditor"),
    undo: (id, reason) => {
      const h = hub;
      if (!h || pendingMod !== null) {
        return false;
      }
      modSeq += 1;
      pendingMod = { seq: modSeq, name: h.name, kind: "undo" };
      opts.undo({ seq: modSeq, name: h.name, id, reason });
      return true;
    },
  });

  // ---- the houses (issue #36): kept across redraws so a half-typed reason survives --------------
  const houseReason = gameInput("hub-house-reason");
  houseReason.type = "text";
  houseReason.maxLength = 200;
  const houseTo = gameInput("hub-house-to");
  houseTo.type = "text";
  houseTo.maxLength = CHARACTER_SEARCH_MAX;
  houseTo.spellcheck = false;
  const houseStatus = document.createElement("p");
  houseStatus.className = "activity-status";
  houseStatus.setAttribute("role", "status");
  const houseForm = document.createElement("form");
  houseForm.className = "activity-filters";
  houseForm.addEventListener("submit", (e) => e.preventDefault());
  houseForm.append(
    formField("Reason", houseReason, "Required to revoke or transfer. Kept in the edit log."),
    formField("Transfer to", houseTo, "The character a transfer gives the house to."),
  );
  /** The preview asked for, and what the admin will confirm with it. */
  let pendingPreview: {
    seq: number;
    name: string;
    interior: string;
    action: "revoke" | "transfer";
    to: string;
    reason: string;
  } | null = null;

  const houseAsk = (house: HubHouse, act: "revoke" | "transfer") => {
    const h = hub;
    if (!h || !opts.can("characterEditor")) {
      return;
    }
    const reason = houseReason.value.trim();
    if (reason === "") {
      houseStatus.textContent = EDIT_TEXT.needReason;
      houseReason.focus();
      return;
    }
    const to = act === "transfer" ? houseTo.value.trim() : "";
    if (act === "transfer" && to === "") {
      houseStatus.textContent = "Name the character to give the house to.";
      houseTo.focus();
      return;
    }
    modSeq += 1;
    pendingPreview = {
      seq: modSeq,
      name: h.name,
      interior: house.interior,
      action: act,
      to,
      reason,
    };
    houseStatus.textContent = "Looking at the house…";
    opts.housePreview({ seq: modSeq, name: h.name, interior: house.interior, action: act, to });
  };

  const houseConfirm = (p: HousePreview, asked: NonNullable<typeof pendingPreview>) => {
    const q = housePreviewText(p);
    houseStatus.textContent = "";
    void confirmBox(root, {
      text: q.text,
      list: q.list,
      confirm: asked.action === "revoke" ? "Demolish" : "Transfer",
      cancel: "Cancel",
      danger: true,
    }).then((yes) => {
      if (!yes || !root.isConnected || hub?.name !== asked.name || !opts.can("characterEditor")) {
        return;
      }
      if (pendingMod !== null) {
        houseStatus.textContent = EDIT_TEXT.wait;
        return;
      }
      modSeq += 1;
      pendingMod = { seq: modSeq, name: asked.name, kind: "house" };
      houseStatus.textContent = "Working…";
      const base = {
        seq: modSeq,
        name: asked.name,
        interior: asked.interior,
        expect: p.expect,
        reason: asked.reason,
      };
      if (asked.action === "revoke") {
        opts.houseRevoke(base);
      } else {
        opts.houseTransfer({ ...base, to: asked.to });
      }
    });
  };

  // ---- behaviour -------------------------------------------------------------------------------
  const search = () => {
    seq += 1;
    lastQuery = query.value.trim();
    status.textContent = "Searching…";
    opts.search(seq, lastQuery);
  };

  const ask = (name: string) => {
    seq += 1;
    hubStatus.textContent = "Loading…";
    opts.open(seq, name);
  };

  const openHub = (name: string) => {
    cancelQuestion();
    pendingMod = null;
    openName = name;
    hub = null;
    tab = "overview";
    modReason.value = "";
    modLength.value = "";
    modResult.textContent = "";
    pendingPreview = null;
    houseReason.value = "";
    houseTo.value = "";
    houseStatus.textContent = "";
    editor.clear();
    editLog.clear();
    searchBox.hidden = true;
    hubBox.hidden = false;
    hubTitle.textContent = name;
    hubSummary.textContent = "";
    // Shown again once the hub arrives, for a role with the activity log.
    activity.hidden = true;
    tabs.hidden = true;
    body.replaceChildren();
    ask(name);
  };

  const closeHub = () => {
    cancelQuestion();
    openName = null;
    hub = null;
    hubBox.hidden = true;
    searchBox.hidden = false;
    if (lastQuery !== null) {
      search();
    }
    query.focus();
  };

  const showTab = (t: Tab) => {
    tab = t;
    draw();
  };

  const presenceText = (h: CharacterHub) =>
    h.presence === "playing"
      ? `Online on ${h.sheet.position.map}`
      : h.presence === "editing"
        ? "Online, in an editor or the Control Panel"
        : "Offline";

  const draw = () => {
    const h = hub;
    if (!h) {
      return;
    }
    const s = h.sheet;
    hubTitle.textContent = h.name;
    const inForce = [h.ban && "banned", h.jail && "jailed", h.mute && "muted"].filter(Boolean);
    hubSummary.textContent = [
      `Level ${s.level} ${classLabel(s.classCode)}`,
      h.role ?? "Player",
      presenceText(h),
      ...inForce,
    ].join(" · ");
    activity.hidden = !opts.can("activityLog");
    tabs.hidden = false;
    tabButtons.get("chat")?.toggleAttribute("hidden", h.chat === undefined);
    tabButtons.get("edit")?.toggleAttribute("hidden", !opts.can("characterEditor"));
    if (
      (tab === "chat" && h.chat === undefined) ||
      (tab === "edit" && !opts.can("characterEditor"))
    ) {
      tab = "overview";
    }
    for (const [t, b] of tabButtons) {
      b.setAttribute("aria-pressed", String(t === tab));
    }
    body.replaceChildren(...drawTab(h));
  };

  const drawTab = (h: CharacterHub): HTMLElement[] => {
    const s = h.sheet;
    switch (tab) {
      case "overview": {
        const where = `${s.position.map} (${s.position.x}, ${s.position.y}), facing ${s.position.facing}`;
        const stats = createTable<[string, number]>({
          label: "Stats",
          columns: [
            { label: "Stat", cell: (r) => r[0] },
            { label: "Points", cell: (r) => String(r[1]), numeric: true },
          ],
          empty: "",
          key: (r) => r[0],
        });
        stats.setRows(STAT_LABELS.map(([k, label]) => [label, s.stats[k]]));
        // Keyed by skill key: two skills may share a display name.
        const skills = createTable<[string, number, string]>({
          label: "Skills",
          columns: [
            { label: "Skill", cell: (r) => r[0] },
            { label: "Level", cell: (r) => String(r[1]), numeric: true },
          ],
          empty: "",
          key: (r) => r[2],
        });
        skills.setRows(
          content().classes.skills.map((k) => [
            k.display ?? k.skill,
            s.skills[k.skill] ?? 0,
            k.skill,
          ]),
        );
        return [
          section(
            "Character",
            facts([
              ["Class", classLabel(s.classCode)],
              ["Level", String(s.level)],
              ["Experience", `${s.exp} of ${s.expNeeded}`],
              ["HP", `${s.hp} of ${s.hpMax}`],
              ["SP", `${s.sp} of ${s.spMax}`],
              ["Hunger", String(s.hunger)],
              ["Faction", factionLabel(s.faction)],
              ["Wanted", s.wanted ? "Yes" : "No"],
              ["Sex", sexLabel(s.sex) || `Sex ${s.sex}`],
              ["Head", String(s.head)],
            ]),
          ),
          section(
            "Where",
            facts([
              ["Position", where],
              [
                "Respawn point",
                s.respawn
                  ? `${s.respawn.map} (${s.respawn.x}, ${s.respawn.y})`
                  : "The server's fallback point",
              ],
              ["Riding", s.vehicle ?? "Nothing"],
            ]),
          ),
          section(
            "Account",
            facts([
              ["Role", h.role ?? "Player"],
              ["Created", `${activityTime(h.created)} UTC`],
              ["Last saved", `${activityTime(h.lastSaved)} UTC`],
            ]),
          ),
          section("Stats", stats.el),
          section("Skills", skills.el),
        ];
      }
      case "items": {
        const bag = createTable<{ slot: number; item: string; qty: number }>({
          label: "Bag",
          columns: [
            { label: "Line", cell: (r) => String(r.slot), numeric: true },
            { label: "Item", cell: (r) => r.item },
            { label: "Quantity", cell: (r) => String(r.qty), numeric: true },
          ],
          empty: "The bag is empty.",
          key: (r) => String(r.slot),
        });
        bag.setRows(
          s.bag.flatMap((l, i) => (l ? [{ slot: i + 1, item: l.item, qty: l.qty }] : [])),
        );
        const worn = createTable<[string, string]>({
          label: "Worn gear",
          columns: [
            { label: "Slot", cell: (r) => r[0] },
            { label: "Item", cell: (r) => r[1] },
          ],
          empty: "",
          key: (r) => r[0],
        });
        worn.setRows(
          WORN.map(([k, label]) => {
            const item = s.equip[k] ?? "";
            return [label, item === "NOTHING" || item === "" ? "—" : item];
          }),
        );
        const editing = opts.can("characterEditor");
        const houses = createTable<HubHouse>({
          label: "Houses",
          columns: [
            { label: "House", cell: (r) => r.type ?? "Unknown type" },
            { label: "Stands on", cell: (r) => `${r.map} (${r.x}, ${r.y})` },
            { label: "Interior", cell: (r) => r.interior },
            { label: "Shop", cell: (r) => shopsText(r) },
            {
              label: "House Vault",
              cell: (r) => `${r.vaultItems} item${r.vaultItems === 1 ? "" : "s"}`,
              numeric: true,
            },
            ...(editing
              ? [
                  {
                    label: "",
                    cell: (r: HubHouse) => {
                      const box = document.createElement("div");
                      box.className = "hub-house-actions";
                      const rev = panelButton(
                        "hub-house-revoke",
                        "Revoke",
                        () => houseAsk(r, "revoke"),
                        "danger",
                      );
                      const give = panelButton("hub-house-transfer", "Transfer", () =>
                        houseAsk(r, "transfer"),
                      );
                      for (const b of [rev, give]) {
                        b.dataset.house = r.interior;
                      }
                      box.append(rev, give);
                      return box;
                    },
                  },
                ]
              : []),
          ],
          empty: "They own no house.",
          key: (r) => r.interior,
        });
        houses.setRows(h.houses);
        return [
          section(
            "Gold",
            facts([
              ["Carried", s.gold.toLocaleString("en")],
              ["Bank", s.bank === null ? "No account" : s.bank.toLocaleString("en")],
            ]),
          ),
          section("Bag", bag.el),
          section("Worn", worn.el),
          section("Vault", list(s.vault, "The vault is empty.")),
          section("Spellbook", list(s.spellbook, "They know no spells.")),
          // Full width: the table has a column for each fact and, to edit, the buttons.
          wide(
            section(
              "Houses",
              houses.el,
              // The status stays while editing, so a change's answer shows after the last house goes.
              ...(editing && h.houses.length > 0 ? [houseForm] : []),
              ...(editing ? [houseStatus] : []),
            ),
          ),
        ];
      }
      case "edit":
        return editor.sections;
      case "edits":
        editLog.show(h.name, h.edits);
        return editLog.sections;
      case "moderation": {
        const now = (label: string, r: ModerationRecord | null) =>
          [
            label,
            r
              ? `${endText(r)}, by ${r.actorName} (${r.actorRole})${r.reason ? `: ${r.reason}` : ""}`
              : "No",
          ] as [string, string];
        const history = createTable<ModerationLogRow>({
          label: "Moderation history",
          columns: [{ label: "Entry", cell: (r) => historyLine(r) }],
          empty: "Nothing has been logged.",
          key: (r) => `${r.createdAt}-${r.action}-${r.address ?? ""}`,
        });
        history.setRows([...h.history].reverse());
        const ipRows: [string, string][] = (h.ipBans ?? []).map((b) => [
          "IP banned",
          `${b.address} ${b.expiresAt === null ? "permanently" : `until ${activityTime(b.expiresAt)} UTC`}, by ${b.actorName} (${b.actorRole})${b.reason ? `: ${b.reason}` : ""}${h.bypassesIpBans ? ". Their role is not stopped by IP bans." : ""}`,
        ]);
        const out = [
          section(
            "In force",
            facts([now("Banned", h.ban), now("Jailed", h.jail), now("Muted", h.mute), ...ipRows]),
          ),
        ];
        fillActions();
        if (modAction.options.length > 0) {
          out.push(section("Act", modForm, modResult));
        }
        out.push(section("History", history.el));
        if (h.addresses) {
          const addresses = createTable<{ address: string; lastSeen: string }>({
            label: "Addresses",
            columns: [
              { label: "Address", cell: (r) => r.address },
              { label: "Last seen (UTC)", cell: (r) => activityTime(r.lastSeen) },
            ],
            empty: "No address is recorded.",
            key: (r) => r.address,
          });
          addresses.setRows(h.addresses);
          out.push(section("Addresses", addresses.el));
        }
        return out;
      }
      case "chat": {
        const chat = createTable<ChatLogRow>({
          label: "Chat log",
          columns: [
            { label: "Time (UTC)", cell: (r) => activityTime(r.at) },
            { label: "Channel", cell: (r) => r.channel },
            { label: "To", cell: (r) => r.target ?? "" },
            { label: "From", cell: (r) => r.sender },
            { label: "Text", cell: (r) => r.text },
          ],
          empty: "Nothing they said is logged.",
          key: (r) => `${r.at}-${r.sender}-${r.text}`,
        });
        chat.setRows([...(h.chat ?? [])].reverse());
        return [section("Newest first", chat.el)];
      }
    }
  };

  status.textContent = HUB_TEXT.searchHelp;

  return {
    el: root,
    onShow() {
      // A question left open when the page was last left is not asked again.
      cancelQuestion();
      if (openName) {
        ask(openName);
      } else {
        search();
      }
    },
    receiveList(msg) {
      if (msg.seq !== seq) {
        return;
      }
      results.setRows(msg.rows);
      results.el.hidden = msg.rows.length === 0;
      status.textContent =
        msg.rows.length === 0
          ? HUB_TEXT.noMatches
          : `${msg.rows.length} character${msg.rows.length === 1 ? "" : "s"}.`;
    },
    receiveHub(msg) {
      if (msg.seq !== seq || openName === null) {
        return;
      }
      if (!msg.hub) {
        hub = null;
        activity.hidden = true;
        tabs.hidden = true;
        body.replaceChildren();
        hubStatus.textContent = msg.error ?? HUB_TEXT.notFound(openName);
        return;
      }
      hub = msg.hub;
      openName = msg.hub.name;
      hubStatus.textContent = "";
      editor.load(msg.hub.name, msg.hub.sheet, msg.hub.hunger, msg.hub.levels);
      editLog.show(msg.hub.name, msg.hub.edits);
      draw();
    },
    receiveResult(msg) {
      const asked = pendingMod;
      if (!asked || msg.seq !== asked.seq) {
        return;
      }
      pendingMod = null;
      // The operator has opened someone else since: the result is not theirs.
      if (!hub || hub.name !== asked.name) {
        return;
      }
      if (asked.kind === "edit") {
        editor.result(msg.ok, msg.text);
      } else if (asked.kind === "undo") {
        editLog.result(msg.ok, msg.text);
      } else if (asked.kind === "house") {
        houseStatus.textContent = msg.text;
        if (msg.ok) {
          houseReason.value = "";
          houseTo.value = "";
        }
      } else {
        modResult.textContent = msg.text;
        if (msg.ok) {
          modReason.value = "";
          modLength.value = "";
        }
      }
      if (msg.ok) {
        ask(hub.name);
      }
    },
    receiveHousePreview(msg) {
      const asked = pendingPreview;
      if (!asked || msg.seq !== asked.seq) {
        return;
      }
      pendingPreview = null;
      if (!hub || hub.name !== asked.name) {
        return;
      }
      if (!msg.preview) {
        houseStatus.textContent = msg.error ?? "";
        return;
      }
      houseConfirm(msg.preview, asked);
    },
    openHub,
    permissionsChanged() {
      cancelQuestion();
      // The server drops an edit the role may no longer make without an answer.
      if (pendingMod && pendingMod.kind !== "moderate" && !opts.can("characterEditor")) {
        pendingMod = null;
      }
      if (!opts.can("characterEditor")) {
        pendingPreview = null;
      }
      const h = hub;
      if (!h) {
        return;
      }
      if (!opts.can("chatlog")) {
        delete h.chat;
      }
      if (!opts.can("banip")) {
        delete h.addresses;
        delete h.ipBans;
        delete h.bypassesIpBans;
        h.history = h.history.map((r) => ({ ...r, address: null }));
      }
      draw();
      // Read again, so anything newly allowed shows; a reply already on its way is ignored.
      if (openName) {
        ask(openName);
      }
    },
    reset() {
      cancelQuestion();
      seq += 1;
      pendingMod = null;
      // Nothing the hub showed stays in the page, hidden or not.
      body.replaceChildren();
      hubTitle.textContent = "";
      hubSummary.textContent = "";
      hubStatus.textContent = "";
      tab = "overview";
      modReason.value = "";
      modLength.value = "";
      modResult.textContent = "";
      pendingPreview = null;
      houseReason.value = "";
      houseTo.value = "";
      houseStatus.textContent = "";
      editor.clear();
      editLog.clear();
      lastQuery = null;
      openName = null;
      hub = null;
      query.value = "";
      results.setRows([]);
      results.el.hidden = true;
      status.textContent = HUB_TEXT.searchHelp;
      hubBox.hidden = true;
      searchBox.hidden = false;
    },
  };
}
