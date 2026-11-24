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
  HUB_ACTIONS,
  HUB_TEXT,
  type HubAction,
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
  let pendingMod: { seq: number; name: string; kind: "moderate" | "edit" | "undo" } | null = null;
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
        const houses = createTable<{ map: string; interior: string }>({
          label: "Houses",
          columns: [
            { label: "Stands on", cell: (r) => r.map },
            { label: "Interior", cell: (r) => r.interior },
          ],
          empty: "They own no house.",
          key: (r) => r.interior,
        });
        houses.setRows(s.houses);
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
          section("Houses", houses.el),
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
      editor.load(msg.hub.name, msg.hub.sheet);
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
    openHub,
    permissionsChanged() {
      cancelQuestion();
      // The server drops an edit the role may no longer make without an answer.
      if (pendingMod && pendingMod.kind !== "moderate" && !opts.can("characterEditor")) {
        pendingMod = null;
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
