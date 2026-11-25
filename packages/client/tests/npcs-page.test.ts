/**
 * The Control Panel's NPCs page (issue #32): the list, the open file as sections or text kept in
 * step, validation as you type with the server's own check, a save sending the whole text with the
 * revision the edit started from, and a file read two ways opening as text; and the plain form:
 * tabs in plain words with a dot on those with settings, the flags as ticks, the till as one
 * number, spells ticked or folded away, and each drop's odds.
 */
import { afterEach, describe, expect, test } from "bun:test";

import type { ContentNpcsView, ContentNpcView, NpcListEntry } from "@secondstaronline/shared";

import { createNpcsPage, lootOdds, npcCheck, npcText } from "../src/ui/npcs-page.ts";

afterEach(() => document.body.replaceChildren());

const entry = (name: string, extra: Partial<NpcListEntry> = {}): NpcListEntry => ({
  name,
  file: true,
  npc: true,
  species: false,
  shop: false,
  banker: false,
  trainer: false,
  loot: false,
  ...extra,
});

const LIST = [
  entry("Amber", { shop: true }),
  entry("Kanta", { banker: true }),
  entry("Orc", { npc: false, species: true, loot: true }),
];

const AMBER = "OWN|king\rBIO|Name: Amber\rSEL|Apple:10:5\rBUY|Apple:5\rGLD|100";

const amber = (extra: Partial<ContentNpcView> = {}): ContentNpcView => ({
  name: "Amber",
  exists: true,
  revision: "a".repeat(16),
  text: AMBER,
  species: false,
  ...extra,
});

const view = (npc: ContentNpcView | null): ContentNpcsView => ({
  npcs: LIST,
  npc,
  choices: { items: ["Apple", "Pie"], classes: ["Earth Mage"], spellTags: ["Splash"] },
});

function page() {
  const asked: { seq: number; name?: string }[] = [];
  const saves: { seq: number; name: string; text: string; expect: string | null }[] = [];
  const p = createNpcsPage({
    view: (seq, name) => asked.push({ seq, ...(name ? { name } : {}) }),
    save: (seq, name, text, expect) => saves.push({ seq, name, text, expect }),
    openMonster: () => {},
  });
  document.body.append(p.el);
  const q = <T extends Element>(sel: string) => p.el.querySelector(sel) as T;
  const qa = (sel: string) => [...p.el.querySelectorAll<HTMLElement>(sel)];
  const open = (npc: ContentNpcView) => {
    p.onShow();
    p.receive({ t: "contentNpcs", seq: asked.at(-1)?.seq ?? 0, view: view(null) });
    p.open(npc.name);
    p.receive({ t: "contentNpcs", seq: asked.at(-1)?.seq ?? 0, view: view(npc) });
  };
  return { p, asked, saves, q, qa, open };
}

describe("the NPCs page", () => {
  test("the list filters by what a file makes an NPC", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentNpcs", seq: t.asked[0]?.seq ?? 0, view: view(null) });
    const names = () => t.qa("button[data-npc]").map((b) => b.dataset.npc);
    expect(names()).toEqual(["Amber", "Kanta", "Orc"]);
    const f = t.q<HTMLSelectElement>("#npcs-filter");
    f.value = "banker";
    f.dispatchEvent(new Event("change"));
    expect(names()).toEqual(["Kanta"]);
  });

  test("a sell added in the sections saves the whole file, other lines kept, with its revision", () => {
    const t = page();
    t.open(amber());
    const save = t.q<HTMLButtonElement>('[data-action="npcs-save"]');
    expect(save.disabled).toBe(true);
    t.q<HTMLButtonElement>('[data-action="npcs-sells-add"]').click();
    const rows = t.qa('[data-list="sells"] .items-list-row');
    const item = rows[1]?.querySelector("input") as HTMLInputElement;
    item.value = "Pie";
    item.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    save.click();
    expect(t.saves.at(-1)).toMatchObject({
      name: "Amber",
      text: "OWN|king\rBIO|Name: Amber\rSEL|Apple:10:5\rSEL|Pie:1:1\rBUY|Apple:5\rGLD|100",
      expect: "a".repeat(16),
    });
  });

  test("the text view carries the sections' edit, and back; a refused line is shown as you type", () => {
    const t = page();
    t.open(amber());
    t.q<HTMLButtonElement>('[data-action="npcs-buys-remove"]').click();
    const mode = t.q<HTMLSelectElement>("#npcs-mode");
    mode.value = "text";
    mode.dispatchEvent(new Event("change"));
    const area = t.q<HTMLTextAreaElement>("#npcs-text");
    expect(area.value).toBe("OWN|king\nBIO|Name: Amber\nSEL|Apple:10:5\nGLD|100");
    area.value += "\nSEL|Fire:5:1";
    area.dispatchEvent(new Event("input"));
    expect(t.q(".npcs-check").textContent).toContain('"Fire" is not an item');
    expect(t.q<HTMLButtonElement>('[data-action="npcs-save"]').disabled).toBe(true);
    area.value = area.value.replace("SEL|Fire:5:1", "RND|Hello");
    area.dispatchEvent(new Event("input"));
    mode.value = "forms";
    mode.dispatchEvent(new Event("change"));
    expect(t.q<HTMLTextAreaElement>('[data-action="npcs-chatter"]')?.value).toBe("Hello");
    // Still unsaved after the switch: the save sends the edit made as text.
    const save = t.q<HTMLButtonElement>('[data-action="npcs-save"]');
    expect(save.disabled).toBe(false);
    expect(t.p.changes()).toBe(1);
    save.click();
    expect(t.saves.at(-1)?.text).toBe(
      "OWN|king\nBIO|Name: Amber\nSEL|Apple:10:5\nGLD|100\nRND|Hello",
    );
  });

  test("a row cannot be added or removed while a field of its table does not read", () => {
    const t = page();
    t.open(amber());
    const price = t
      .qa('[data-list="sells"] .items-list-row')[0]
      ?.querySelectorAll("input")[1] as HTMLInputElement;
    price.value = "-2";
    price.dispatchEvent(new Event("input"));
    t.q<HTMLButtonElement>('[data-action="npcs-sells-add"]').click();
    expect(t.qa('[data-list="sells"] .items-list-row')).toHaveLength(1);
    expect(price.isConnected && price.value).toBe("-2");
  });

  test("Undo changes after a switch puts back the file as shown; a stale file says so", () => {
    const t = page();
    t.open(amber());
    const mode = t.q<HTMLSelectElement>("#npcs-mode");
    mode.value = "text";
    mode.dispatchEvent(new Event("change"));
    const area = t.q<HTMLTextAreaElement>("#npcs-text");
    area.value = area.value.replace("Name: Amber", "Name: Ann");
    area.dispatchEvent(new Event("input"));
    mode.value = "forms";
    mode.dispatchEvent(new Event("change"));
    // Someone saves Amber meanwhile: the edit stays, marked stale.
    t.p.onShow();
    t.p.receive({
      t: "contentNpcs",
      seq: t.asked.at(-1)?.seq ?? 0,
      view: view(amber({ revision: "b".repeat(16), text: "BIO|Name: Amber\rGLD|1" })),
    });
    expect(
      t
        .qa(".items-form .balance-stale")
        .some((e) => !e.hidden && e.textContent?.includes("Someone saved")),
    ).toBe(true);
    t.q<HTMLButtonElement>('[data-action="npcs-undo"]').click();
    expect(t.p.changes()).toBe(0);
    expect(t.q<HTMLTextAreaElement>('[data-action="npcs-bio"]').value).toBe("Name: Amber");
  });

  test("a name with no file makes one, naming no revision; the Monsters link follows its permission", () => {
    const t = page();
    t.open(amber({ name: "Cow", exists: false, revision: null, text: "", species: true }));
    const save = t.q<HTMLButtonElement>('[data-action="npcs-save"]');
    expect(save.textContent).toBe("Create its NPC file");
    save.click();
    expect(t.saves.at(-1)).toMatchObject({ name: "Cow", text: "", expect: null });
    expect(t.q<HTMLElement>('[data-action="npcs-open-monster"]').hidden).toBe(false);
  });

  test("reset drops answers already on their way", () => {
    const t = page();
    t.p.onShow();
    const seq = t.asked.at(-1)?.seq ?? 0;
    t.p.reset();
    t.p.receive({ t: "contentNpcs", seq, view: view(null) });
    expect(t.qa("button[data-npc]")).toHaveLength(0);
  });

  test("a file read two ways opens as text", () => {
    const t = page();
    t.open(amber({ text: "BIO|I sell INV|x:1" }));
    expect(t.q<HTMLSelectElement>("#npcs-mode").value).toBe("text");
  });

  test("the shared helpers: the text a save sends, and the server's check", () => {
    expect(npcText("BIO|x", { ...emptyish(), bio: ["y"] })).toBe("BIO|y");
    expect(npcCheck("SEL|Apple:1:1").error).toBeNull();
  });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the plain-language form", () => {
  const MONSTER =
    "BIO|Name: Orc\rINV|Apple:4\rINV|5 Gold:2\rSPL|Splash\rFLG|Passive\rFLG|Grumpy\rOWN|x";
  const orc = () => amber({ name: "Orc", text: MONSTER, species: true });
  const tabs = (t: ReturnType<typeof page>) =>
    t.qa('[data-action="npcs-tab"]').map((b) => b.dataset.tab);
  const used = (t: ReturnType<typeof page>) =>
    t.qa(".control-panel-tab-used").map((b) => b.dataset.tab);

  test("an empty form says to pick an NPC, and the tabs are named in plain words", async () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentNpcs", seq: t.asked.at(-1)?.seq ?? 0, view: view(null) });
    expect(t.q<HTMLElement>(".items-empty-form").hidden).toBe(false);
    t.open(orc());
    await tick();
    expect(t.q<HTMLElement>(".items-empty-form").hidden).toBe(true);
    expect(tabs(t)).toEqual(["Talk", "Shop", "Bank and training", "As a monster", "All"]);
    // The form never shows the file's tags; only the text view does.
    expect(t.q(".items-rules").textContent).not.toMatch(/\b(INV|SPL|FLG|SEL|BUY|GLD)\|/);
    expect(t.q(".balance-tags").textContent).toContain("Also a monster");
  });

  test("a dot marks the tabs the file fills, and follows the edit", async () => {
    const t = page();
    t.open(amber());
    await tick();
    expect(used(t)).toEqual(["Talk", "Shop"]);
    t.q<HTMLInputElement>('[data-action="npcs-banker"]').click();
    await tick();
    expect(used(t)).toEqual(["Talk", "Shop", "Bank and training"]);
  });

  test("the two flags that do something are ticks; any other flag line is kept under More options", () => {
    const t = page();
    t.open(orc());
    const still = t.q<HTMLInputElement>('[data-action="npcs-flag-still"]');
    const passive = t.q<HTMLInputElement>('[data-action="npcs-flag-passive"]');
    expect([still.checked, passive.checked]).toEqual([false, true]);
    const other = t.q<HTMLTextAreaElement>('[data-action="npcs-flags"]');
    expect(other.value).toBe("Grumpy");
    expect(other.closest("details")?.open).toBe(true);
    still.click();
    passive.click();
    t.q<HTMLButtonElement>('[data-action="npcs-save"]').click();
    expect(t.saves.at(-1)?.text).toBe(
      "BIO|Name: Orc\rINV|Apple:4\rINV|5 Gold:2\rSPL|Splash\rFLG|Grumpy\rFLG|Still\rOWN|x",
    );
  });

  test("the till is one number: emptied, its line goes", () => {
    const t = page();
    t.open(amber());
    const gold = t.q<HTMLInputElement>('[data-action="npcs-gold"]');
    expect(gold.value).toBe("100");
    gold.value = "-5";
    gold.dispatchEvent(new Event("input"));
    expect(t.q<HTMLButtonElement>('[data-action="npcs-save"]').disabled).toBe(true);
    gold.value = "";
    gold.dispatchEvent(new Event("input"));
    t.q<HTMLButtonElement>('[data-action="npcs-save"]').click();
    expect(t.saves.at(-1)?.text).toBe("OWN|king\rBIO|Name: Amber\rSEL|Apple:10:5\rBUY|Apple:5");
  });

  test("ticked spells show; the rest wait under Add a spell", () => {
    const t = page();
    t.open(orc());
    const box = t.q<HTMLElement>('[data-list="spells"]');
    const shownTicks = [...box.querySelectorAll(":scope > .items-checks input")];
    expect(shownTicks).toHaveLength(1);
    expect(box.querySelector(".items-more-picks summary")?.textContent).toBe("Add a spell…");
  });

  test("each drop line says its odds a kill, following the chance and the number of lines", () => {
    const t = page();
    t.open(orc());
    const odds = () => t.qa(".npcs-odds").map((s) => s.textContent);
    // Two lines: one picked at random, then 1 in 4 or 1 in 2.
    expect(odds()).toEqual(["About 1 in 8 kills", "About 1 in 4 kills"]);
    const n = t
      .qa('[data-list="loot"] .items-list-row')[1]
      ?.querySelectorAll("input")[1] as HTMLInputElement;
    n.value = "1";
    n.dispatchEvent(new Event("input"));
    expect(odds()).toEqual(["About 1 in 8 kills", "About 1 in 2 kills"]);
    t.q<HTMLButtonElement>('[data-action="npcs-loot-remove"]').click();
    expect(odds()).toEqual(["Every kill"]);
    expect(lootOdds(3, 10)).toBe("About 1 in 30 kills");
  });
});

function emptyish() {
  return {
    bio: [],
    profile: [],
    chatter: [],
    sells: [],
    buys: [],
    gold: [],
    trains: [],
    banker: [],
    loot: [],
    spells: [],
    flags: [],
  };
}
