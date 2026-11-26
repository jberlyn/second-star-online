/**
 * The Control Panel's Characters page and player hub (ui/characters.ts, issue #26): the search,
 * opening a hub, its tabs, what each permission shows, and the moderation buttons.
 */
import { describe, expect, test } from "bun:test";

import { classicData } from "@secondstaronline/data/classic";
import {
  buildContentStore,
  type CharacterHub,
  type ContentData,
  EDIT_TEXT,
  emptyBag,
  type HousePreview,
  HUB_TEXT,
  type HubAction,
  installContent,
  NO_EQUIPMENT,
  type Permission,
} from "@secondstaronline/shared";

import {
  type CharactersPageOptions,
  createCharactersPage,
  housePreviewText,
} from "../src/ui/characters.ts";

const hub = (over: Partial<CharacterHub> = {}): CharacterHub => {
  const bag = emptyBag();
  bag[2] = { item: "Apple", qty: 4 };
  return {
    name: "Al",
    role: null,
    created: "2026-11-01T00:00:00.000Z",
    lastSaved: "2026-11-22T09:00:00.000Z",
    presence: "playing",
    sheet: {
      name: "Al",
      sex: 1,
      head: 1,
      classCode: 1,
      level: 5,
      exp: 10,
      expNeeded: 100,
      hp: 20,
      hpMax: 30,
      sp: 5,
      spMax: 8,
      stats: { str: 10, sta: 10, dex: 10, int: 10, wis: 10 },
      skills: { Slash: 3, Thrust: 1 },
      hunger: 0,
      faction: "warrior",
      factionCount: 0,
      wanted: false,
      position: { map: "x1000y992", x: 5, y: 6, facing: "S" },
      respawn: null,
      vehicle: null,
      gold: 1234,
      bank: null,
      bag,
      equip: { ...NO_EQUIPMENT, weapon: "Knife" },
      vault: ["Steel Sword"],
      spellbook: [],
      houses: [{ map: "x1y1", interior: "AlHouse1" }],
    },
    ban: null,
    jail: null,
    mute: null,
    history: [],
    edits: [],
    hunger: { max: 50_000, start: 50_000, afterDeath: 40_000 },
    houses: [
      {
        interior: "AlHouse1",
        map: "x1y1",
        x: 4,
        y: 5,
        type: "Small Shop",
        shops: [{ npc: "Zumu", lines: 2, stock: 3, till: 40 }],
        vaultItems: 2,
      },
    ],
    ...over,
  };
};

function page(perms: Permission[] = ["characterView", "ban", "kick"]) {
  const calls = {
    search: [] as [number, string][],
    open: [] as [number, string][],
    moderate: [] as {
      seq: number;
      name: string;
      action: HubAction;
      duration: string;
      reason: string;
    }[],
    activity: [] as string[],
    edit: [] as Parameters<CharactersPageOptions["edit"]>[0][],
    undo: [] as Parameters<CharactersPageOptions["undo"]>[0][],
    preview: [] as Parameters<CharactersPageOptions["housePreview"]>[0][],
    revoke: [] as Parameters<CharactersPageOptions["houseRevoke"]>[0][],
    transfer: [] as Parameters<CharactersPageOptions["houseTransfer"]>[0][],
  };
  const p = createCharactersPage({
    search: (seq, q) => calls.search.push([seq, q]),
    open: (seq, n) => calls.open.push([seq, n]),
    moderate: (r) => calls.moderate.push(r),
    edit: (r) => calls.edit.push(r),
    undo: (r) => calls.undo.push(r),
    housePreview: (r) => calls.preview.push(r),
    houseRevoke: (r) => calls.revoke.push(r),
    houseTransfer: (r) => calls.transfer.push(r),
    openActivity: (n) => calls.activity.push(n),
    can: (x) => perms.includes(x),
  });
  document.body.replaceChildren(p.el);
  const $ = <T extends HTMLElement>(action: string) =>
    p.el.querySelector<T>(`[data-action="${action}"]`) as T;
  const lastSeq = (list: [number, string][]) => list.at(-1)?.[0] ?? -1;
  const showHub = (h: CharacterHub = hub()) => {
    p.openHub(h.name);
    p.receiveHub({ seq: lastSeq(calls.open), hub: h });
  };
  return { p, calls, $, lastSeq, showHub };
}

describe("the search", () => {
  test("showing the page searches; Enter and Search ask for the typed text; a row opens its hub", () => {
    const { p, calls, $, lastSeq } = page();
    p.onShow();
    expect(calls.search).toEqual([[1, ""]]);
    $<HTMLInputElement>("characters-query").value = " al ";
    $<HTMLInputElement>("characters-query").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(calls.search.at(-1)?.[1]).toBe("al");
    p.receiveList({
      seq: lastSeq(calls.search),
      rows: [
        {
          name: "Al",
          level: 5,
          classCode: 1,
          role: "Admin",
          online: true,
          lastSaved: "2026-11-22T09:00:00.000Z",
        },
      ],
    });
    const cells = [...p.el.querySelectorAll("table[aria-label='Characters'] td")].map(
      (td) => td.textContent,
    );
    expect(cells).toEqual([
      "Al",
      "5",
      expect.any(String),
      "Admin",
      "Online",
      "2026-11-22 09:00:00",
    ]);
    $("characters-open").click();
    expect(calls.open.at(-1)?.[1]).toBe("Al");
  });

  test("an old answer is ignored and an empty one says so", () => {
    const { p, calls, $ } = page();
    $("characters-search").click();
    $("characters-search").click();
    p.receiveList({ seq: 1, rows: [] });
    expect(p.el.querySelector(".activity-status")?.textContent).not.toBe(HUB_TEXT.noMatches);
    p.receiveList({ seq: calls.search.at(-1)?.[0] ?? 0, rows: [] });
    expect(p.el.querySelector(".activity-status")?.textContent).toBe(HUB_TEXT.noMatches);
  });
});

describe("the hub", () => {
  test("the overview names the class, faction and place; Items lists the bag, gear, vault and houses", () => {
    const { p, $, showHub } = page();
    showHub();
    expect(p.el.querySelector(".hub-summary")?.textContent).toContain("Level 5");
    expect(p.el.querySelector(".hub-summary")?.textContent).toContain("Online on x1000y992");
    const facts = p.el.querySelector(".hub-facts")?.textContent ?? "";
    expect(facts).toContain("Warrior");
    expect(facts).toContain("20 of 30");
    $("hub-tab-items").click();
    const text = p.el.querySelector(".hub-body")?.textContent ?? "";
    expect(text).toContain("1,234");
    expect(text).toContain("Apple");
    expect(text).toContain("Knife");
    expect(text).toContain("Steel Sword");
    expect(text).toContain("AlHouse1");
    // Line 3 of the bag, as the game numbers it.
    expect(
      [...p.el.querySelectorAll("table[aria-label='Bag'] td")].map((td) => td.textContent),
    ).toEqual(["3", "Apple", "4"]);
  });

  test("Chat shows only when the server sent the log; Activity Log only with its permission", () => {
    const { $, showHub, calls } = page(["characterView", "activityLog"]);
    showHub();
    expect($("hub-tab-chat").hidden).toBe(true);
    expect($("hub-activity").hidden).toBe(false);
    $("hub-activity").click();
    expect(calls.activity).toEqual(["Al"]);
    showHub(
      hub({
        chat: [
          {
            at: "2026-11-22T09:00:00.000Z",
            channel: "say",
            sender: "Al",
            target: "x1000y992",
            text: "hello",
            outcome: "delivered",
            heard: 1,
            ignored: 0,
            muffled: 0,
          },
        ],
      }),
    );
    expect($("hub-tab-chat").hidden).toBe(false);
    $("hub-tab-chat").click();
    expect(document.body.textContent).toContain("hello");
    const other = page(["characterView"]);
    other.showHub();
    expect(other.$("hub-activity").hidden).toBe(true);
  });

  test("Activity Log shows only once a hub has come; a reset leaves nothing of the hub in the page", () => {
    const { p, $, showHub } = page(["characterView", "activityLog", "chatlog"]);
    p.openHub("Al");
    expect($("hub-activity").hidden).toBe(true);
    showHub(
      hub({
        chat: [
          {
            at: "2026-11-22T09:00:00.000Z",
            channel: "im",
            sender: "Al",
            target: "Bo",
            text: "secret plan",
            outcome: "delivered",
            heard: null,
            ignored: null,
            muffled: null,
          },
        ],
      }),
    );
    expect($("hub-activity").hidden).toBe(false);
    $("hub-tab-chat").click();
    p.reset();
    expect(p.el.textContent).not.toContain("secret plan");
    expect(p.el.querySelector(".hub-title")?.textContent).toBe("");
    expect(p.el.querySelector<HTMLElement>(".hub")?.hidden).toBe(true);
  });

  test("an unknown name shows the server's error; All characters goes back to the search", () => {
    const { p, calls, $ } = page();
    p.openHub("Nobody");
    p.receiveHub({
      seq: calls.open.at(-1)?.[0] ?? 0,
      hub: null,
      error: HUB_TEXT.notFound("Nobody"),
    });
    expect(p.el.textContent).toContain(HUB_TEXT.notFound("Nobody"));
    $("hub-back").click();
    expect(p.el.querySelector<HTMLElement>(".hub")?.hidden).toBe(true);
  });
});

describe("moderation", () => {
  test("only the actions your role holds are offered", () => {
    const { $, showHub } = page(["characterView", "kick", "unmute"]);
    showHub();
    $("hub-tab-moderation").click();
    expect([...$<HTMLSelectElement>("hub-action").options].map((o) => o.value)).toEqual([
      "kick",
      "unmute",
    ]);
    const none = page(["characterView"]);
    none.showHub();
    none.$("hub-tab-moderation").click();
    expect(none.$("hub-apply")?.isConnected ?? false).toBe(false);
  });

  test("a ban needs a reason, asks first, then sends the length and reason and reloads when done", async () => {
    const { p, calls, $, showHub } = page();
    showHub();
    $("hub-tab-moderation").click();
    $<HTMLSelectElement>("hub-action").value = "ban";
    $<HTMLSelectElement>("hub-action").dispatchEvent(new Event("change"));
    $("hub-apply").click();
    expect(calls.moderate).toEqual([]);
    expect(p.el.textContent).toContain(HUB_TEXT.needReason);
    $<HTMLInputElement>("hub-length").value = "7d";
    $<HTMLInputElement>("hub-reason").value = "trading gold for money";
    $("hub-apply").click();
    expect(p.el.querySelector(".control-panel-confirm")?.textContent).toContain("Ban Al for 7d?");
    $("control-panel-confirm-ok").click();
    await Promise.resolve();
    expect(calls.moderate).toEqual([
      { seq: 1, name: "Al", action: "ban", duration: "7d", reason: "trading gold for money" },
    ]);
    const opened = calls.open.length;
    // Another request's answer is not this one's.
    p.receiveResult({ seq: 9, ok: true, text: "Bea is banned." });
    expect(p.el.textContent).not.toContain("Bea is banned.");
    p.receiveResult({ seq: 1, ok: true, text: "Al is banned." });
    expect(p.el.textContent).toContain("Al is banned.");
    expect(calls.open.length).toBe(opened + 1);
    expect($<HTMLInputElement>("hub-reason").value).toBe("");
  });

  test("a kick hides the reason and sends neither it nor a length; a refusal keeps what was typed", async () => {
    const { p, calls, $, showHub } = page();
    showHub();
    $("hub-tab-moderation").click();
    $<HTMLSelectElement>("hub-action").value = "kick";
    $<HTMLSelectElement>("hub-action").dispatchEvent(new Event("change"));
    $<HTMLInputElement>("hub-length").value = "7d";
    $<HTMLInputElement>("hub-reason").value = "afk";
    expect($("hub-reason").closest<HTMLElement>(".control-panel-field")?.hidden).toBe(true);
    $("hub-apply").click();
    $("control-panel-confirm-ok").click();
    await Promise.resolve();
    expect(calls.moderate).toEqual([
      { seq: 1, name: "Al", action: "kick", duration: "", reason: "" },
    ]);
    p.receiveResult({ seq: 1, ok: false, text: "You may not kick them." });
    expect($<HTMLInputElement>("hub-reason").value).toBe("afk");
  });

  test("a result that comes after another character was opened leaves that hub alone", async () => {
    const { p, calls, $, showHub } = page();
    showHub();
    $("hub-tab-moderation").click();
    $<HTMLSelectElement>("hub-action").value = "kick";
    $<HTMLSelectElement>("hub-action").dispatchEvent(new Event("change"));
    $("hub-apply").click();
    $("control-panel-confirm-ok").click();
    await Promise.resolve();
    showHub(hub({ name: "Bea" }));
    $("hub-tab-moderation").click();
    const opened = calls.open.length;
    p.receiveResult({ seq: 1, ok: true, text: "Al was kicked." });
    expect(p.el.textContent).not.toContain("Al was kicked.");
    expect(calls.open.length).toBe(opened);
  });

  test("a question left open is not acted on once the hub, the page or the permission changed", async () => {
    const perms: Permission[] = ["characterView", "ban", "kick"];
    const { p, calls, $, showHub } = page(perms);
    showHub();
    $("hub-tab-moderation").click();
    $<HTMLSelectElement>("hub-action").value = "kick";
    $<HTMLSelectElement>("hub-action").dispatchEvent(new Event("change"));
    // Leaving for another page and coming back closes it.
    $("hub-apply").click();
    p.el.remove();
    document.body.append(p.el);
    p.onShow();
    expect(p.el.querySelector(".control-panel-confirm")).toBeNull();
    // A permission lost while it is open closes it too.
    $("hub-apply").click();
    perms.splice(perms.indexOf("kick"), 1);
    p.permissionsChanged();
    expect(p.el.querySelector(".control-panel-confirm")).toBeNull();
    await Promise.resolve();
    expect(calls.moderate).toEqual([]);
  });

  test("losing /chatlog or /banip takes their chat, addresses and IP bans off the open hub", () => {
    const perms: Permission[] = ["characterView", "chatlog", "banip"];
    const { p, $, showHub } = page(perms);
    showHub(
      hub({
        chat: [
          {
            at: "2026-11-22T09:00:00.000Z",
            channel: "im",
            sender: "Al",
            target: "Bo",
            text: "secret plan",
            outcome: "delivered",
            heard: null,
            ignored: null,
            muffled: null,
          },
        ],
        addresses: [{ address: "10.0.0.7", key: "10.0.0.7", lastSeen: "2026-11-22T09:00:00.000Z" }],
        ipBans: [
          {
            address: "10.0.0.7",
            actorName: "God",
            actorRole: "Admin",
            reason: "",
            createdAt: "2026-11-22T09:00:00.000Z",
            expiresAt: null,
          },
        ],
        history: [
          {
            action: "ipban",
            address: "10.0.0.7",
            actorName: "God",
            actorRole: "Admin",
            reason: "",
            createdAt: "2026-11-22T09:00:00.000Z",
            expiresAt: null,
          },
        ],
      }),
    );
    $("hub-tab-chat").click();
    expect(p.el.textContent).toContain("secret plan");
    perms.length = 1;
    p.permissionsChanged();
    expect(p.el.textContent).not.toContain("secret plan");
    expect($("hub-tab-chat").hidden).toBe(true);
    $("hub-tab-moderation").click();
    expect(p.el.textContent).not.toContain("10.0.0.7");
  });
});

describe("the editor", () => {
  const confirm = () =>
    document.querySelector<HTMLButtonElement>('[data-action="control-panel-confirm-ok"]')?.click();
  const flush = () => new Promise((r) => setTimeout(r, 0));

  test("Edit shows only with characterEditor", () => {
    const viewer = page(["characterView"]);
    viewer.showHub();
    expect(viewer.$("hub-tab-edit").hidden).toBe(true);
    expect(viewer.$("hub-tab-edits").hidden).toBe(false);
    const editor = page(["characterView", "characterEditor"]);
    editor.showHub();
    expect(editor.$("hub-tab-edit").hidden).toBe(false);
  });

  test("hunger is checked against the world's limits sent with the character", async () => {
    // A world whose deaths set 90000 hunger: the client's own store has only the engine defaults.
    const { p, $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub(hub({ hunger: { max: 90_000, start: 50_000, afterDeath: 90_000 } }));
    $("hub-tab-edit").click();
    expect(p.el.textContent).toContain(
      "0 to 90000 (the most hunger can be); a new character starts at 50000, a death sets 90000.",
    );
    $<HTMLInputElement>("hub-edit-hunger").value = "60000";
    $<HTMLInputElement>("hub-edit-reason").value = "fed";
    $("hub-edit-save").click();
    confirm();
    await flush();
    expect(calls.edit.at(-1)?.set.hunger).toBe(60_000);
    $<HTMLInputElement>("hub-edit-hunger").value = "90001";
    $("hub-edit-save").click();
    expect(p.el.textContent).toContain("Hunger: a whole number from 0 to 90000.");
  });

  test("Save sends only what changed, with what the hub showed, after asking; then reloads", async () => {
    const { p, $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub();
    $("hub-tab-edit").click();
    $<HTMLInputElement>("hub-edit-gold").value = "5000";
    $<HTMLInputElement>("hub-edit-bag-1-item").value = "Knife";
    $<HTMLInputElement>("hub-edit-bag-1-qty").value = "2";
    $("hub-edit-save").click();
    // No reason yet.
    expect(p.el.textContent).toContain(EDIT_TEXT.needReason);
    expect(document.querySelector(".control-panel-confirm")).toBeNull();
    $<HTMLInputElement>("hub-edit-reason").value = "refund";
    $("hub-edit-save").click();
    expect(document.querySelector(".control-panel-confirm")?.textContent).toContain(
      "Gold: 1,234 → 5,000",
    );
    confirm();
    await flush();
    const sent = calls.edit.at(-1);
    expect(sent?.set.gold).toBe(5000);
    expect(sent?.seen.gold).toBe(1234);
    expect(sent?.set.bag?.[0]).toEqual({ item: "Knife", qty: 2 });
    expect(Object.keys(sent?.set ?? {}).sort()).toEqual(["bag", "gold"]);
    expect(sent?.reason).toBe("refund");
    const opens = calls.open.length;
    p.receiveResult({ seq: sent?.seq ?? 0, ok: true, text: "Saved" });
    expect(calls.open.length).toBe(opens + 1);
    expect($<HTMLInputElement>("hub-edit-reason").value).toBe("");
  });

  test("a head or sex a publish took out stays selected, so an unrelated edit keeps it", async () => {
    const d = structuredClone(classicData) as ContentData;
    d.classes.creation.sexes = [
      { code: 1, label: "Male", heads: [3, 4] },
      { code: 5, label: "Orc", heads: [6, 7] },
    ];
    installContent(buildContentStore(d));
    try {
      const { $, calls, showHub } = page(["characterView", "characterEditor"]);
      // Al wears Head1, which Male no longer lists.
      showHub();
      $("hub-tab-edit").click();
      const sex = $<HTMLSelectElement>("hub-edit-sex");
      const head = $<HTMLSelectElement>("hub-edit-head");
      expect([...sex.options].map((o) => o.textContent)).toEqual(["Male", "Orc"]);
      expect([...head.options].map((o) => o.value)).toEqual(["1", "3", "4"]);
      expect(head.value).toBe("1");
      $<HTMLInputElement>("hub-edit-gold").value = "5000";
      $<HTMLInputElement>("hub-edit-reason").value = "refund";
      $("hub-edit-save").click();
      confirm();
      await flush();
      expect(Object.keys(calls.edit.at(-1)?.set ?? {})).toEqual(["gold"]);
      // Picking another sex offers only its heads; back to their own, their own head again.
      sex.value = "5";
      sex.dispatchEvent(new Event("change"));
      expect([...head.options].map((o) => o.value)).toEqual(["6", "7"]);
      expect(head.value).toBe("6");
      sex.value = "1";
      sex.dispatchEvent(new Event("change"));
      expect(head.value).toBe("1");
      // A publish while the editor is open: the lists follow, keeping what is picked.
      const next = structuredClone(d);
      next.classes.creation.sexes = [
        { code: 1, label: "Human", heads: [3] },
        { code: 9, label: "Elf", heads: [8] },
      ];
      installContent(buildContentStore(next));
      expect([...sex.options].map((o) => o.textContent)).toEqual(["Human", "Elf"]);
      expect([sex.value, head.value]).toEqual(["1", "1"]);
      // A sex the world lost entirely still lists a head (the character's own).
      next.classes.creation.sexes = [{ code: 9, label: "Elf", heads: [8] }];
      installContent(buildContentStore(next));
      expect([...sex.options].map((o) => o.textContent)).toEqual(["Elf", "Sex 1"]);
      expect([...head.options].map((o) => o.value)).toEqual(["1"]);
    } finally {
      installContent(buildContentStore(classicData as ContentData));
    }
  });

  test("a value out of the game's limits is named and nothing is sent", () => {
    const { p, $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub();
    $("hub-tab-edit").click();
    $<HTMLInputElement>("hub-edit-str").value = "40";
    $<HTMLInputElement>("hub-edit-reason").value = "x";
    $("hub-edit-save").click();
    expect(p.el.textContent).toContain("Strength: a whole number from 1 to 20.");
    expect(calls.edit).toEqual([]);
    $("hub-edit-reset").click();
    $("hub-edit-save").click();
    expect(p.el.textContent).toContain(EDIT_TEXT.nothing);
  });

  test("the log lists each change; Undo needs a reason and asks first", async () => {
    const { p, $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub(
      hub({
        edits: [
          {
            id: "e1",
            at: "2026-11-22T09:00:00.000Z",
            actorName: "God",
            reason: "refund",
            changes: [{ field: "gold", before: 0, after: 1234 }],
            override: false,
            undoOf: null,
            undoneBy: null,
            kind: "edit",
            summary: "",
            irreversible: false,
          },
        ],
      }),
    );
    $("hub-tab-edits").click();
    expect(p.el.textContent).toContain("Gold: 0 → 1,234");
    $("hub-undo").click();
    expect(p.el.textContent).toContain(EDIT_TEXT.needReason);
    $<HTMLInputElement>("hub-undo-reason").value = "wrong one";
    $("hub-undo").click();
    confirm();
    await flush();
    expect(calls.undo).toEqual([
      { seq: expect.any(Number), name: "Al", id: "e1", reason: "wrong one" },
    ]);
    // A viewer sees the log without the button.
    const viewer = page(["characterView"]);
    viewer.showHub(hub({ edits: [] }));
    viewer.$("hub-tab-edits").click();
    expect(viewer.p.el.querySelector('[data-action="hub-undo"]')).toBeNull();
  });
});

describe("one change at a time", () => {
  test("a second save waits while the first has no answer", async () => {
    const { $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub();
    $("hub-tab-edit").click();
    const save = async (gold: string) => {
      $<HTMLInputElement>("hub-edit-gold").value = gold;
      $<HTMLInputElement>("hub-edit-reason").value = "x";
      $("hub-edit-save").click();
      document
        .querySelector<HTMLButtonElement>('[data-action="control-panel-confirm-ok"]')
        ?.click();
      await new Promise((r) => setTimeout(r, 0));
    };
    await save("5");
    await save("6");
    expect(calls.edit).toHaveLength(1);
    expect(document.body.textContent).toContain(EDIT_TEXT.wait);
  });
});

describe("the hub's houses (issue #36)", () => {
  const confirmBtn = () =>
    document.querySelector<HTMLButtonElement>('[data-action="control-panel-confirm-ok"]');
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const revokePreview: HousePreview = {
    action: "revoke",
    owner: "Al",
    house: hub().houses[0] as HousePreview["house"],
    vault: { name: "Al's House Vault", items: ["Apple", "Apple", "Knife"] },
    vaultFate: "destroyed",
    shops: [{ npc: "Zumu", stock: [{ item: "Fish", qty: 3 }], till: 40 }],
    floor: [{ item: "Chair", qty: 1 }],
    inside: ["Bo"],
    renames: [],
    guild: null,
    expect: "tok1",
  };

  test("Items lists each house; a viewer gets no Revoke or Transfer", () => {
    const { p, $, showHub } = page(["characterView"]);
    showHub();
    $("hub-tab-items").click();
    expect(
      [...p.el.querySelectorAll("table[aria-label='Houses'] td")].map((td) => td.textContent),
    ).toEqual([
      "Small Shop",
      "x1y1 (4, 5)",
      "AlHouse1",
      "Zumu: 2 lines, 3 in stock, till 40 gold",
      "2 items",
    ]);
    expect(p.el.querySelector('[data-action="hub-house-revoke"]')).toBeNull();
    expect(p.el.querySelector('[data-action="hub-house-reason"]')).toBeNull();
  });

  test("Revoke needs a reason, asks the server first, lists what goes and sends what was shown", async () => {
    const { p, $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub();
    $("hub-tab-items").click();
    $("hub-house-revoke").click();
    expect(p.el.textContent).toContain(EDIT_TEXT.needReason);
    expect(calls.preview).toEqual([]);
    $<HTMLInputElement>("hub-house-reason").value = "griefing";
    $("hub-house-revoke").click();
    expect(calls.preview).toEqual([
      { seq: expect.any(Number), name: "Al", interior: "AlHouse1", action: "revoke", to: "" },
    ]);
    // An old answer is ignored.
    p.receiveHousePreview({ seq: -5, preview: revokePreview });
    expect(confirmBtn()).toBeNull();
    p.receiveHousePreview({ seq: calls.preview[0]?.seq ?? 0, preview: revokePreview });
    const box = document.querySelector(".control-panel-confirm-box")?.textContent ?? "";
    expect(box).toContain("Demolish Al's Small Shop on x1y1 (4, 5), interior AlHouse1?");
    expect(box).toContain("Everyone inside (Bo) is moved out to its door.");
    expect(box).toContain("Al's House Vault is destroyed: 2 Apple, Knife.");
    expect(box).toContain("Zumu's shop is destroyed: stock 3 Fish; till 40 gold.");
    expect(box).toContain("On the floor, destroyed: Chair.");
    expect(box).toContain("This can't be undone.");
    confirmBtn()?.click();
    await flush();
    expect(calls.revoke).toEqual([
      {
        seq: expect.any(Number),
        name: "Al",
        interior: "AlHouse1",
        expect: "tok1",
        reason: "griefing",
      },
    ]);
    p.receiveResult({
      seq: calls.revoke[0]?.seq ?? 0,
      ok: true,
      text: "Al's house was demolished.",
    });
    expect(p.el.textContent).toContain("Al's house was demolished.");
    expect($<HTMLInputElement>("hub-house-reason").value).toBe("");
  });

  test("Transfer needs a name; a refusal from the preview is shown and nothing is sent", async () => {
    const { p, $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub();
    $("hub-tab-items").click();
    $<HTMLInputElement>("hub-house-reason").value = "sold";
    $("hub-house-transfer").click();
    expect(calls.preview).toEqual([]);
    $<HTMLInputElement>("hub-house-to").value = " Bo ";
    $("hub-house-transfer").click();
    expect(calls.preview.at(-1)).toMatchObject({ action: "transfer", to: "Bo" });
    p.receiveHousePreview({
      seq: calls.preview.at(-1)?.seq ?? 0,
      preview: null,
      error: "Bo's House Vault would hold 16 items, but holds at most 15. Nothing changed.",
    });
    expect(p.el.textContent).toContain("holds at most 15");
    expect(confirmBtn()).toBeNull();
    $("hub-house-transfer").click();
    p.receiveHousePreview({
      seq: calls.preview.at(-1)?.seq ?? 0,
      preview: { ...revokePreview, action: "transfer", to: "Bo", vaultFate: "merged" },
    });
    // A Small Shop: no door or mailbox, and a custom header stays.
    const box = document.querySelector(".control-panel-confirm-box")?.textContent ?? "";
    expect(box).toContain("Give Al's Small Shop on x1y1 (4, 5), interior AlHouse1, to Bo?");
    expect(box).toContain("Zumu works for Bo, with its stock (3 Fish) and till (40 gold).");
    expect(box).toContain(
      "Al's House Vault's contents move in with what is already in Bo's House Vault: 2 Apple, Knife.",
    );
    expect(box).toContain("Anyone inside (Bo) stays where they are.");
    expect(box).toContain("Its header is kept as it is.");
    expect(box).not.toContain("door");
    // Transferring back does not promise the vault back.
    expect(box).toContain(
      "Transferring it back returns the house and its shops, but not necessarily the vault's contents: they go back only if Bo owns no other house then.",
    );
    confirmBtn()?.click();
    await flush();
    expect(calls.transfer).toEqual([
      {
        seq: expect.any(Number),
        name: "Al",
        interior: "AlHouse1",
        to: "Bo",
        expect: "tok1",
        reason: "sold",
      },
    ]);
  });

  test("the edit log shows a house change's summary and never offers its undo", () => {
    const { p, $, showHub } = page(["characterView", "characterEditor"]);
    showHub(
      hub({
        edits: [
          {
            id: "h1",
            at: "2026-11-22T09:00:00.000Z",
            actorName: "God",
            reason: "griefing",
            changes: [],
            override: false,
            undoOf: null,
            undoneBy: null,
            kind: "houseRevoke",
            summary: "Demolished Small House on x1y1 (4, 5).",
            irreversible: true,
          },
        ],
      }),
    );
    $("hub-tab-edits").click();
    expect(p.el.textContent).toContain("House revoked");
    expect(p.el.textContent).toContain("Demolished Small House on x1y1 (4, 5).");
    expect(p.el.textContent).toContain("Can't be undone");
    expect(p.el.querySelector('[data-action="hub-undo"]')).toBeNull();
  });

  test("a house's renames and a guild hall's guild are named as they are", () => {
    const house = housePreviewText({
      ...revokePreview,
      action: "transfer",
      to: "Bo",
      renames: ["door", "mailbox", "House Vault", "header"],
    });
    expect(house.list).toContain("Its door, mailbox, House Vault and header become Bo's.");
    const hall = housePreviewText({
      ...revokePreview,
      action: "transfer",
      to: "Bo",
      renames: [],
      guild: "Hawks",
    });
    expect(hall.list).toContain(
      "Its door and Guild Vault stay The Hawks's; their Guild Key opens it.",
    );
    expect(hall.list.join(" ")).not.toContain("mailbox");
  });

  test("the result of a change stays on screen after the last house goes", async () => {
    const { p, $, calls, showHub } = page(["characterView", "characterEditor"]);
    showHub();
    $("hub-tab-items").click();
    $<HTMLInputElement>("hub-house-reason").value = "griefing";
    $("hub-house-revoke").click();
    p.receiveHousePreview({ seq: calls.preview.at(-1)?.seq ?? 0, preview: revokePreview });
    confirmBtn()?.click();
    await flush();
    p.receiveResult({
      seq: calls.revoke[0]?.seq ?? 0,
      ok: true,
      text: "Al's house was demolished.",
    });
    // The hub is read again, now with no house.
    p.receiveHub({ seq: calls.open.at(-1)?.[0] ?? 0, hub: hub({ houses: [] }) });
    expect(p.el.textContent).toContain("They own no house.");
    expect(p.el.textContent).toContain("Al's house was demolished.");
    expect(p.el.querySelector('[data-action="hub-house-reason"]')).toBeNull();
  });
});
