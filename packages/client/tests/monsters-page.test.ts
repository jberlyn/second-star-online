/**
 * The Control Panel's Monsters page (issue #31, stage 4): the list with search and filters, the
 * form for the open monster, a save sending its record and definition with the fingerprint it was
 * filled from, a form locked while its save is on its way, refreshes that never overwrite an edit,
 * the NPC file's loot, spells and flags saved live with their revision, and the monster spells card.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type {
  ContentMonstersView,
  ContentMonsterView,
  ContentNpcFileView,
  MonsterListEntry,
} from "@secondstaronline/shared";

import {
  createMonstersPage,
  dropOdds,
  type MonsterChange,
  type NpcSectionsChange,
} from "../src/ui/monsters-page.ts";

afterEach(() => document.body.replaceChildren());

const entry = (name: string, extra: Partial<MonsterListEntry> = {}): MonsterListEntry => ({
  name,
  display: name,
  state: "pack",
  pending: false,
  hostile: false,
  sea: false,
  casts: false,
  loot: false,
  npc: false,
  ...extra,
});

const LIST = [
  entry("Orc", { hostile: true, loot: true }),
  entry("Shark", { hostile: true, sea: true }),
  entry("Amber", { npc: true }),
  entry("Bog Thing", { state: "yours", display: "Bog" }),
];

const orc = (fp: string, extra: Partial<ContentMonsterView> = {}): ContentMonsterView => ({
  name: "Orc",
  display: "",
  inPack: true,
  record: {
    name: "Orc",
    body: 12,
    bodyInMainChars: true,
    hp: 30,
    attack: 5,
    defense: 2,
    xpMelee: 10,
    xpSpell: 10,
    spawnMinute: null,
  },
  form: { name: "Orc", lists: { worldEditorMonsters: true } },
  defined: false,
  pack: {
    record: {
      name: "Orc",
      body: 12,
      bodyInMainChars: true,
      hp: 30,
      attack: 5,
      defense: 2,
      xpMelee: 10,
      xpSpell: 10,
      spawnMinute: null,
    },
    form: { name: "Orc", lists: { worldEditorMonsters: true } },
  },
  sources: [{ group: "behaviour", label: "Hostile", from: "nothing: the pack has no row for it" }],
  edited: false,
  pending: { definition: null, record: null },
  fingerprint: fp,
  notice: null,
  published: true,
  ...extra,
});

const view = (monster: ContentMonsterView | null, extra: Partial<ContentMonstersView> = {}) =>
  ({
    monsters: LIST,
    monster,
    spells: {
      rows: [
        {
          tag: "Splash",
          name: "Splash",
          kind: "aimFirst",
          power: 15,
          ladder: [90, 145, 200, 300, 500, 700, 1000],
          aName: true,
        },
      ],
      fingerprint: "s".repeat(16),
      pending: false,
    },
    choices: {
      effects: ["Bolt", "Splash"],
      kinds: ["aimFirst", "buff"],
      fx: ["Splash", "Fireball"],
      items: ["Gold", "Long Sword"],
    },
    otherDraft: 0,
    monsterDraft: 0,
    ...extra,
  }) satisfies ContentMonstersView;

const file = (extra: Partial<ContentNpcFileView> = {}): ContentNpcFileView => ({
  name: "Orc",
  exists: true,
  revision: "r".repeat(16),
  loot: [{ item: "15 Gold", oneIn: 5 }],
  spells: [],
  flags: [],
  mixed: [],
  lines: 2,
  maxLines: 100,
  spellTags: ["Splash"],
  ...extra,
});

function page() {
  const asked: { seq: number; name?: string }[] = [];
  const sets: { seq: number; change: MonsterChange }[] = [];
  const spells: { seq: number; expect: string; rows: unknown }[] = [];
  const npcAsks: { seq: number; name: string }[] = [];
  const npcSets: { seq: number; name: string; expect: string | null; s: NpcSectionsChange }[] = [];
  const p = createMonstersPage({
    view: (seq, name) => asked.push({ seq, ...(name ? { name } : {}) }),
    set: (seq, change) => sets.push({ seq, change }),
    spells: (seq, rows, expect) => spells.push({ seq, rows, expect }),
    npcFile: (seq, name) => npcAsks.push({ seq, name }),
    npcFileSet: (seq, name, expect, s) => npcSets.push({ seq, name, expect, s }),
    openContent: () => {},
    openContentRow: () => {},
    body: () => null,
  });
  document.body.append(p.el);
  const q = <T extends Element>(sel: string) => p.el.querySelector(sel) as T;
  const qa = (sel: string) => [...p.el.querySelectorAll<HTMLElement>(sel)];
  return { p, asked, sets, spells, npcAsks, npcSets, q, qa };
}

/** Opens Orc and answers with its view and its NPC file. */
function openOrc(t: ReturnType<typeof page>, fp = "a".repeat(16)) {
  t.p.onShow();
  t.p.receive({ t: "contentMonsters", seq: t.asked.at(-1)?.seq ?? 0, view: view(null) });
  t.p.open("Orc");
  t.p.receive({ t: "contentMonsters", seq: t.asked.at(-1)?.seq ?? 0, view: view(orc(fp)) });
  const ask = t.npcAsks.at(-1);
  if (ask) {
    t.p.receive({ t: "contentNpcFile", seq: ask.seq, view: file() });
  }
}

describe("the Monsters page", () => {
  test("the list searches and filters", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentMonsters", seq: t.asked[0]?.seq ?? 0, view: view(null) });
    const names = () => t.qa("button[data-monster]").map((b) => b.dataset.monster);
    expect(names()).toEqual(["Orc", "Shark", "Amber", "Bog Thing"]);
    const filter = t.q<HTMLSelectElement>("#monsters-filter");
    filter.value = "sea";
    filter.dispatchEvent(new Event("change"));
    expect(names()).toEqual(["Shark"]);
    filter.value = "changed";
    filter.dispatchEvent(new Event("change"));
    expect(names()).toEqual(["Bog Thing"]);
    filter.value = "all";
    filter.dispatchEvent(new Event("change"));
    const search = t.q<HTMLInputElement>("#monsters-search");
    search.value = "bog";
    search.dispatchEvent(new Event("input"));
    expect(names()).toEqual(["Bog Thing"]);
  });

  test("a save sends the record and the definition with the fingerprint it was filled from", () => {
    const t = page();
    openOrc(t);
    const save = t.q<HTMLButtonElement>('[data-action="monsters-save"]');
    expect(save.disabled).toBe(true);
    const hp = t.qa('section[data-group="basics"] input[type="number"]')[0] as HTMLInputElement;
    hp.value = "45";
    hp.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    // A refresh while editing keeps the edit; a new fingerprint for the same values is adopted.
    t.p.published();
    t.p.receive({
      t: "contentMonsters",
      seq: t.asked.at(-1)?.seq ?? 0,
      view: view(orc("b".repeat(16))),
    });
    expect(hp.isConnected && hp.value).toBe("45");
    save.click();
    const sent = t.sets.at(-1)?.change;
    expect(sent).toMatchObject({ name: "Orc", op: "set", expect: "b".repeat(16) });
    expect((sent?.record as { hp?: number } | undefined)?.hp).toBe(45);
    expect((sent?.record as { body?: number } | undefined)?.body).toBeUndefined();
    expect(sent?.data).toEqual({ name: "Orc", lists: { worldEditorMonsters: true } });
    // Locked while the save is on its way.
    expect(t.q<HTMLFieldSetElement>("fieldset.items-rules").disabled).toBe(true);
    t.p.receive({
      t: "contentMonsters",
      seq: t.sets.at(-1)?.seq ?? 0,
      view: view(orc("c".repeat(16), { record: { ...orc("").record, hp: 45 } })),
      result: { ok: true, text: "Orc is in the draft." },
    });
    expect(t.q<HTMLFieldSetElement>("fieldset.items-rules").disabled).toBe(false);
    expect(save.disabled).toBe(true);
  });

  test("the NPC file's loot saves live with its revision; the odds are shown", () => {
    const t = page();
    openOrc(t);
    expect(t.npcAsks.at(-1)?.name).toBe("Orc");
    expect(t.qa('[data-list="loot"]')).toHaveLength(1);
    t.q<HTMLButtonElement>('[data-action="monsters-loot-add"]').click();
    const rows = t.qa('[data-list="loot"]');
    const item = rows[1]?.querySelector("input") as HTMLInputElement;
    item.value = "Long Sword";
    item.dispatchEvent(new Event("input"));
    t.q<HTMLButtonElement>('[data-action="monsters-npc-save"]').click();
    expect(t.npcSets.at(-1)).toMatchObject({
      name: "Orc",
      expect: "r".repeat(16),
      s: {
        loot: [
          { item: "15 Gold", oneIn: 5 },
          { item: "Long Sword", oneIn: 1 },
        ],
      },
    });
    expect(dropOdds(2, 5)).toBe("About 1 in 10 kills");
    expect(dropOdds(1, 1)).toBe("Every kill");
  });

  test("an NPC file save names the revision the edit started from; a bad chance blocks it", () => {
    const t = page();
    openOrc(t);
    t.q<HTMLButtonElement>('[data-action="monsters-loot-add"]').click();
    const rows = t.qa('[data-list="loot"]');
    const item = rows[1]?.querySelector("input") as HTMLInputElement;
    item.value = "Long Sword";
    item.dispatchEvent(new Event("input"));
    // Someone saves the file meanwhile: a refresh brings its new revision, the edit stays.
    t.p.receive({
      t: "contentNpcFile",
      seq: t.npcAsks.at(-1)?.seq ?? 0,
      view: file({ revision: "n".repeat(16) }),
    });
    expect(t.q(".monsters-npc .balance-status").textContent).toContain("Someone changed");
    const chance = rows[1]?.querySelector('input[type="number"]') as HTMLInputElement;
    chance.value = "0";
    chance.dispatchEvent(new Event("input"));
    t.q<HTMLButtonElement>('[data-action="monsters-npc-save"]').click();
    expect(t.npcSets).toEqual([]);
    chance.value = "3";
    chance.dispatchEvent(new Event("input"));
    t.q<HTMLButtonElement>('[data-action="monsters-npc-save"]').click();
    expect(t.npcSets.at(-1)?.expect).toBe("r".repeat(16));
  });

  test("the two spawn minutes go together: one alone cannot be saved", () => {
    const t = page();
    openOrc(t);
    const nums = t.qa('section[data-group="basics"] input[type="number"]') as HTMLInputElement[];
    const after = nums[3] as HTMLInputElement;
    const before = nums[4] as HTMLInputElement;
    after.value = "10";
    after.dispatchEvent(new Event("input"));
    const save = t.q<HTMLButtonElement>('[data-action="monsters-save"]');
    expect(save.disabled).toBe(true);
    before.value = "20";
    before.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    save.click();
    expect(
      (t.sets.at(-1)?.change.record as { spawnMinute?: unknown } | undefined)?.spawnMinute,
    ).toEqual({
      gt: 10,
      lt: 20,
    });
  });

  test("a monster with no NPC file can attach an empty one", () => {
    const t = page();
    t.p.onShow();
    t.p.open("Orc");
    t.p.receive({
      t: "contentMonsters",
      seq: t.asked.at(-1)?.seq ?? 0,
      view: view(orc("a".repeat(16))),
    });
    t.p.receive({
      t: "contentNpcFile",
      seq: t.npcAsks.at(-1)?.seq ?? 0,
      view: file({ exists: false, revision: null, loot: [], lines: 0 }),
    });
    const save = t.q<HTMLButtonElement>('[data-action="monsters-npc-save"]');
    expect(save.textContent).toBe("Create its NPC file");
    expect(save.disabled).toBe(false);
    save.click();
    expect(t.npcSets.at(-1)).toMatchObject({
      expect: null,
      s: { loot: [], spells: [], flags: [] },
    });
  });

  test("a monster only in the draft cannot have its NPC file edited yet", () => {
    const t = page();
    t.p.onShow();
    t.p.open("Orc");
    t.p.receive({
      t: "contentMonsters",
      seq: t.asked.at(-1)?.seq ?? 0,
      view: view(orc("a".repeat(16), { published: false })),
    });
    expect(t.npcAsks).toEqual([]);
    expect(t.q(".monsters-npc")?.textContent).toContain("publish it first");
  });

  test("the monster spells card saves every spell with its fingerprint", () => {
    const t = page();
    openOrc(t);
    const save = t.q<HTMLButtonElement>('[data-action="monsters-spells-save"]');
    expect(save.disabled).toBe(true);
    t.q<HTMLButtonElement>('[data-action="monsters-spells-add"]').click();
    expect(save.disabled).toBe(false);
    save.click();
    expect(t.spells.at(-1)).toMatchObject({ expect: "s".repeat(16) });
    expect((t.spells.at(-1)?.rows as unknown[] | undefined)?.length).toBe(2);
  });

  test("reset drops everything and stale answers", () => {
    const t = page();
    openOrc(t);
    const old = t.asked.at(-1)?.seq ?? 0;
    t.p.reset();
    t.p.receive({ t: "contentMonsters", seq: old, view: view(orc("z".repeat(16))) });
    expect(t.qa("button[data-monster]")).toHaveLength(0);
    expect(t.p.changes()).toBe(0);
  });
});

describe("the plain-language form", () => {
  const save = (t: ReturnType<typeof page>) =>
    t.q<HTMLButtonElement>('[data-action="monsters-save"]');

  test("one Save sends the rules, then the name players see once the rules are saved", () => {
    const t = page();
    openOrc(t);
    const hp = t.qa('section[data-group="basics"] input[type="number"]')[0] as HTMLInputElement;
    hp.value = "50";
    hp.dispatchEvent(new Event("input"));
    const display = t.q<HTMLInputElement>("#monsters-display");
    display.value = "Big Orc";
    display.dispatchEvent(new Event("input"));
    save(t).click();
    expect(t.sets.map((s) => s.change.op)).toEqual(["set"]);
    t.p.receive({
      t: "contentMonsters",
      seq: t.sets.at(-1)?.seq ?? 0,
      view: view(orc("d".repeat(16), { record: { ...orc("").record, hp: 50 } })),
      result: { ok: true, text: "Saved." },
    });
    expect(t.sets.at(-1)?.change).toEqual({
      name: "Orc",
      op: "rename",
      display: "Big Orc",
      expect: "d".repeat(16),
    });
  });

  test("a name alone is saved by the same button", () => {
    const t = page();
    openOrc(t);
    const display = t.q<HTMLInputElement>("#monsters-display");
    display.value = "Big Orc";
    display.dispatchEvent(new Event("input"));
    expect(save(t).disabled).toBe(false);
    save(t).click();
    expect(t.sets.at(-1)?.change).toMatchObject({ op: "rename", display: "Big Orc" });
  });

  test("a weapon bonus is typed from … to … and saved as a roll", () => {
    const t = page();
    openOrc(t);
    t.q<HTMLButtonElement>('[data-action="monsters-affinity-add"]').click();
    const row = t.q('[data-list="affinities"]');
    const name = row.querySelector('[data-action="monsters-text"]') as HTMLInputElement;
    name.value = "Silver";
    name.dispatchEvent(new Event("input"));
    const from = row.querySelector('[data-action="monsters-affinity-from"]') as HTMLInputElement;
    const to = row.querySelector('[data-action="monsters-affinity-to"]') as HTMLInputElement;
    expect([from.value, to.value]).toEqual(["1", "1"]);
    from.value = "3";
    to.value = "8";
    from.dispatchEvent(new Event("input"));
    save(t).click();
    expect(
      (t.sets.at(-1)?.change.data as { affinities?: unknown } | undefined)?.affinities,
    ).toEqual([{ weapon: "Silver", delta: 2, randomN: 6 }]);
  });

  test("a weapon bonus whose 'to' is below its 'from' can't be saved", () => {
    const t = page();
    openOrc(t);
    t.q<HTMLButtonElement>('[data-action="monsters-affinity-add"]').click();
    const row = t.q('[data-list="affinities"]');
    const to = row.querySelector('[data-action="monsters-affinity-to"]') as HTMLInputElement;
    to.value = "-5";
    to.dispatchEvent(new Event("input"));
    expect(save(t).disabled).toBe(true);
    expect(t.q(".control-panel-form-actions .balance-status").textContent).toContain(
      "Weapon bonus",
    );
  });

  test("tabs with settings carry a mark; More options opens when one of its fields is set", () => {
    const t = page();
    openOrc(t);
    const group = (id: string) => t.q<HTMLElement>(`section[data-group="${id}"]`);
    expect(group("lists").dataset.used).toBe("true");
    expect(group("behaviour").dataset.used).toBe("false");
    expect(group("behaviour").querySelector<HTMLDetailsElement>(".items-more")?.open).toBe(false);
    const box = group("behaviour").querySelector<HTMLInputElement>('input[type="checkbox"]');
    box?.click();
    expect(group("behaviour").dataset.used).toBe("true");
    // A monster that is already big opens the fold.
    const big = page();
    big.p.onShow();
    big.p.open("Orc");
    big.p.receive({
      t: "contentMonsters",
      seq: big.asked.at(-1)?.seq ?? 0,
      view: view(orc("a".repeat(16), { form: { name: "Orc", footprint: true } })),
    });
    expect(
      big.q('section[data-group="behaviour"]').querySelector<HTMLDetailsElement>(".items-more")
        ?.open,
    ).toBe(true);
  });

  test("Restore this tab shows only where the monster differs from the pack", () => {
    const t = page();
    openOrc(t);
    const restore = t.q<HTMLButtonElement>('[data-action="monsters-pack-basics"]');
    expect(restore.hidden).toBe(true);
    const hp = t.qa('section[data-group="basics"] input[type="number"]')[0] as HTMLInputElement;
    hp.value = "99";
    hp.dispatchEvent(new Event("input"));
    expect(restore.hidden).toBe(false);
    restore.click();
    expect(save(t).disabled).toBe(true);
  });

  test("the NPC flags the game reads are tick boxes; others are listed, to keep or take out", () => {
    const t = page();
    t.p.onShow();
    t.p.open("Orc");
    t.p.receive({
      t: "contentMonsters",
      seq: t.asked.at(-1)?.seq ?? 0,
      view: view(orc("a".repeat(16))),
    });
    t.p.receive({
      t: "contentNpcFile",
      seq: t.npcAsks.at(-1)?.seq ?? 0,
      view: file({ flags: ["Custom"] }),
    });
    const flags = t.qa('[data-action="monsters-npc-flag"]') as HTMLInputElement[];
    expect(flags.map((f) => f.checked)).toEqual([false, false]);
    (flags[0] as HTMLInputElement).click();
    // Any other flag is listed as it is, with Take it out: nothing to type.
    const out = t.q<HTMLButtonElement>('[data-action="monsters-npc-flag-out"]');
    expect(out.closest("li")?.textContent).toContain("Custom");
    expect(out.closest("details")?.open).toBe(true);
    expect(t.p.el.querySelector('[data-action="monsters-npc-flags"]')).toBeNull();
    // Taken out, it goes with the next save.
    t.q<HTMLButtonElement>('[data-action="monsters-npc-flag-out"]').click();
    t.q<HTMLButtonElement>('[data-action="monsters-npc-save"]').click();
    expect(t.npcSets.at(-1)?.s.flags).toEqual(["Passive"]);
  });

  test("ticking a spell adds it to the file's spells", () => {
    const t = page();
    openOrc(t);
    const pick = t.q('[data-list="spells"]');
    const box = pick.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
    box?.click();
    t.q<HTMLButtonElement>('[data-action="monsters-npc-save"]').click();
    expect(t.npcSets.at(-1)?.s.spells).toEqual(["Splash"]);
  });

  test("a monster spell's aim is shown in words", () => {
    const t = page();
    openOrc(t);
    const aim = t.q<HTMLSelectElement>('[data-action="monsters-spell-kind"]');
    expect([...aim.options].map((o) => o.textContent)).toEqual([
      "Lands near the player",
      "On the monster itself",
    ]);
  });
});
