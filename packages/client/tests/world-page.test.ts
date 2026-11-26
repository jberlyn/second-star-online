/**
 * The Control Panel's World page (issue #33): a map opens from its position or the list (which
 * finds maps by what is placed on them), a tool paints on the active layer, undo and redo walk the
 * edits, a spawn slot takes a monster, and a save sends the whole map with the revision it was
 * opened at; a refresh never overwrites an edit, and a stale one says so.
 */
import { afterEach, describe, expect, test } from "bun:test";

import {
  blankMap,
  type ContentMapsView,
  content,
  type EditorMap,
  isPaletteCode,
} from "@secondstaronline/shared";

import { createWorldPage } from "../src/ui/world-page.ts";

afterEach(() => document.body.replaceChildren());

const MAPS = [
  { mx: 1000, my: 992, name: "x1000y992", title: "Town", roster: ["Slime"], items: [] },
  { mx: 1001, my: 992, name: "x1001y992", title: "Fields", roster: [], items: ["Gold Chest"] },
];

const view = (map: EditorMap | null, extra: Partial<NonNullable<ContentMapsView["map"]>> = {}) =>
  ({
    maps: MAPS,
    map: map ? { map, exists: true, revision: "a".repeat(16), versions: [], ...extra } : null,
  }) satisfies ContentMapsView;

function page() {
  const asked: { seq: number; at?: { mx: number; my: number }; list?: boolean }[] = [];
  const saves: { seq: number; map: EditorMap; expect: string | null }[] = [];
  const restores: { version: string; expect: string | null }[] = [];
  const p = createWorldPage(
    {
      view: (seq, at, list) =>
        asked.push({ seq, ...(at ? { at } : {}), ...(list ? { list } : {}) }),
      save: (seq, map, expect) => saves.push({ seq, map, expect }),
      restore: (_seq, _mx, _my, version, expect) => restores.push({ version, expect }),
    },
    null,
  );
  document.body.append(p.el);
  const q = <T extends Element>(sel: string) => p.el.querySelector(sel) as T;
  const qa = (sel: string) => [...p.el.querySelectorAll<HTMLElement>(sel)];
  const open = (m: EditorMap, extra = {}) => {
    p.open(m.mx, m.my);
    p.receive({ t: "contentMaps", seq: asked.at(-1)?.seq ?? 0, view: view(m, extra) });
  };
  /** A press and release of the active tool on tile (x, y). */
  const press = (x: number, y: number) => {
    const c = q<HTMLCanvasElement>(".world-canvas");
    const at = { clientX: (x - 1) * 32 + 5, clientY: (y - 1) * 32 + 5, bubbles: true };
    c.dispatchEvent(new MouseEvent("pointerdown", at));
    c.dispatchEvent(new MouseEvent("pointerup", at));
  };
  return { p, asked, saves, restores, q, qa, open, press };
}

describe("the World page", () => {
  test("the list finds maps by position, header or what is placed on them", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentMaps", seq: t.asked[0]?.seq ?? 0, view: view(null) });
    const names = () => t.qa("button[data-map]").map((b) => b.dataset.map);
    expect(names()).toEqual(["x1000y992", "x1001y992"]);
    const s = t.q<HTMLInputElement>("#world-search");
    s.value = "chest";
    s.dispatchEvent(new Event("input"));
    expect(names()).toEqual(["x1001y992"]);
  });

  test("a pencil paints the active layer; undo and redo walk it; the save names the opened revision", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const code = content().tiles.catalogue[3]?.code as string;
    t.q<HTMLButtonElement>(`[data-tile="${code}"]`).click();
    const layer = t.q<HTMLSelectElement>("#world-layer");
    layer.value = "1";
    layer.dispatchEvent(new Event("change"));
    t.press(3, 4);
    const save = t.q<HTMLButtonElement>('[data-action="world-save"]');
    expect(save.disabled).toBe(false);
    t.q<HTMLButtonElement>('[data-action="world-undo"]').click();
    expect(save.disabled).toBe(true);
    t.q<HTMLButtonElement>('[data-action="world-redo"]').click();
    // A refresh (someone saved the map) keeps the edit and says it is stale.
    t.p.onShow();
    t.p.receive({
      t: "contentMaps",
      seq: t.asked.at(-1)?.seq ?? 0,
      view: view(blankMap(1000, 992), { revision: "b".repeat(16) }),
    });
    expect(
      t
        .qa(".world-form .balance-stale")
        .some((e) => !e.hidden && e.textContent?.includes("Someone changed this map")),
    ).toBe(true);
    save.click();
    const sent = t.saves.at(-1);
    expect(sent?.expect).toBe("a".repeat(16));
    expect(sent?.map.layers[1][3]?.split(" ")[2]).toBe(code);
  });

  test("a spawn slot takes a monster and a tile picked on the map", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const slot = t.qa('[data-list="spawns"] select')[0] as HTMLSelectElement;
    slot.value = "Slime";
    slot.dispatchEvent(new Event("change"));
    (t.qa('[data-action="world-spawn-pick"]')[0] as HTMLButtonElement).click();
    t.press(9, 7);
    t.q<HTMLButtonElement>('[data-action="world-save"]').click();
    expect(t.saves.at(-1)?.map.mobs[0]).toEqual({ name: "Slime", x: 9, y: 7 });
  });

  test("a rectangle fills on release; select, copy and paste move a block", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const code = content().tiles.catalogue[3]?.code as string;
    t.q<HTMLButtonElement>(`[data-tile="${code}"]`).click();
    const tool = t.q<HTMLSelectElement>("#world-tool");
    tool.value = "rect";
    tool.dispatchEvent(new Event("change"));
    const c = t.q<HTMLCanvasElement>(".world-canvas");
    const at = (x: number, y: number) => ({ clientX: (x - 1) * 32 + 5, clientY: (y - 1) * 32 + 5 });
    c.dispatchEvent(new MouseEvent("pointerdown", at(1, 1)));
    c.dispatchEvent(new MouseEvent("pointermove", at(2, 2)));
    c.dispatchEvent(new MouseEvent("pointerup", at(2, 2)));
    tool.value = "select";
    tool.dispatchEvent(new Event("change"));
    c.dispatchEvent(new MouseEvent("pointerdown", at(1, 1)));
    c.dispatchEvent(new MouseEvent("pointermove", at(2, 2)));
    c.dispatchEvent(new MouseEvent("pointerup", at(2, 2)));
    t.q<HTMLButtonElement>('[data-action="world-copy"]').click();
    tool.value = "paste";
    tool.dispatchEvent(new Event("change"));
    t.press(10, 10);
    t.q<HTMLButtonElement>('[data-action="world-save"]').click();
    const rows = t.saves.at(-1)?.map.layers[0] ?? [];
    const codes = rows
      .join(" ")
      .split(" ")
      .filter((x) => x === code);
    expect(codes).toHaveLength(8);
    expect(rows[9]?.split(" ")[9]).toBe(code);
  });

  test("the list is asked for on showing only; opening a map does not scan the world", () => {
    const t = page();
    t.p.onShow();
    expect(t.asked[0]?.list).toBe(true);
    t.p.open(1000, 992);
    expect(t.asked[1]?.list).toBeUndefined();
  });

  test("while another map opens or a save is out, nothing can be edited, so no edit is lost", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const form = t.q<HTMLElement>(".world-form");
    t.p.open(1001, 992);
    expect(form.inert).toBe(true);
    const header = t.q<HTMLInputElement>('[data-action="world-header"]');
    // The answer opens the new map, editable again.
    t.p.receive({
      t: "contentMaps",
      seq: t.asked.at(-1)?.seq ?? 0,
      view: view(blankMap(1001, 992)),
    });
    expect(form.inert).toBe(false);
    header.value = "Mine";
    header.dispatchEvent(new Event("input"));
    t.q<HTMLButtonElement>('[data-action="world-save"]').click();
    expect(form.inert).toBe(true);
    // A dropped connection stops the wait; the edit stays.
    t.p.connectionLost();
    expect(form.inert).toBe(false);
    expect(header.value).toBe("Mine");
  });

  test("undo takes back a form edit, and still reaches back after a save", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const sign = t.q<HTMLTextAreaElement>('[data-action="world-sign1"]');
    sign.value = "Welcome";
    sign.dispatchEvent(new Event("input"));
    sign.dispatchEvent(new Event("change", { bubbles: true }));
    const undo = t.q<HTMLButtonElement>('[data-action="world-undo"]');
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(sign.value).toBe("");
    t.q<HTMLButtonElement>('[data-action="world-redo"]').click();
    expect(sign.value).toBe("Welcome");
    t.q<HTMLButtonElement>('[data-action="world-save"]').click();
    const sent = t.saves.at(-1) as { seq: number; map: EditorMap };
    t.p.receive({
      t: "contentMaps",
      seq: sent.seq,
      view: view(sent.map, { revision: "c".repeat(16) }),
      result: { ok: true, text: "Saved" },
    });
    expect(undo.disabled).toBe(false);
    undo.click();
    expect(sign.value).toBe("");
  });

  test("a faction the world no longer has, and a spawn set by /roster, survive a save of something else", () => {
    const t = page();
    const m = blankMap(1000, 992);
    m.flags.fctSpwn = "pirates";
    m.mobs[1] = { name: "Slime", x: 2, y: 1, anywhere: true };
    t.open(m);
    const header = t.q<HTMLInputElement>('[data-action="world-header"]');
    header.value = "Renamed";
    header.dispatchEvent(new Event("input"));
    t.q<HTMLButtonElement>('[data-action="world-save"]').click();
    const sent = t.saves.at(-1)?.map;
    expect(sent?.flags.fctSpwn).toBe("pirates");
    expect(sent?.mobs[1]).toEqual({ name: "Slime", x: 2, y: 1, anywhere: true });
  });

  test("placing a /roster spawn gives it a tile; a version that cannot come back says why", () => {
    const t = page();
    const m = blankMap(1000, 992);
    m.mobs[0] = { name: "Slime", x: 1, y: 1, anywhere: true };
    t.open(m, {
      versions: [
        { id: "v1", by: "Al", at: "2026-11-25T00:00:00.000Z", blocked: "Layer 1 has a row…" },
      ],
    });
    expect(t.qa('[data-action="world-restore"]')).toHaveLength(0);
    expect(t.q<HTMLElement>(".world-history")?.textContent).toContain("Can't be restored");
    (t.qa('[data-action="world-spawn-pick"]')[0] as HTMLButtonElement).click();
    t.press(5, 6);
    t.q<HTMLButtonElement>('[data-action="world-save"]').click();
    expect(t.saves.at(-1)?.map.mobs[0]).toEqual({ name: "Slime", x: 5, y: 6 });
  });

  test("the palette offers only what a save takes", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const codes = t.qa("[data-tile]").map((b) => b.dataset.tile as string);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every(isPaletteCode)).toBe(true);
  });

  test("a save the server's message check would drop is not sent, so the page never waits for ever", () => {
    const t = page();
    const m = blankMap(1000, 992);
    m.items = [{ name: "Apple", x: 1, y: 1 }];
    t.open(m);
    const name = t.qa('[data-list="items"] input')[0] as HTMLInputElement;
    name.value = "";
    name.dispatchEvent(new Event("input"));
    const save = t.q<HTMLButtonElement>('[data-action="world-save"]');
    expect(save.disabled).toBe(false);
    save.click();
    expect(t.saves).toHaveLength(0);
    expect(t.q<HTMLElement>(".world-form").inert).toBe(false);
    expect(t.q<HTMLElement>('.world-form [role="status"]').textContent).toContain("Item 1");
    // An exit past the grid's bound is refused the same way.
    name.value = "Apple";
    name.dispatchEvent(new Event("input"));
    const exit = t.qa('[data-action="world-exit1"]') as HTMLInputElement[];
    ["2000000", "1", "1", "1"].forEach((v, i) => {
      (exit[i] as HTMLInputElement).value = v;
    });
    save.click();
    expect(t.saves).toHaveLength(0);
  });

  test("Undo changes puts the map back; Restore this version sends the version with the revision shown", () => {
    const t = page();
    t.open(blankMap(1000, 992), {
      versions: [{ id: "v1", by: "Al", at: "2026-11-25T00:00:00.000Z" }],
    });
    const header = t.q<HTMLInputElement>('[data-action="world-header"]');
    header.value = "Mine";
    header.dispatchEvent(new Event("input"));
    // Restoring over an edit is refused until it is saved or dropped.
    t.q<HTMLButtonElement>('[data-action="world-restore"]').click();
    expect(t.restores).toHaveLength(0);
    t.q<HTMLButtonElement>('[data-action="world-undo-edit"]').click();
    expect(header.value).toBe("");
    t.q<HTMLButtonElement>('[data-action="world-restore"]').click();
    expect(t.restores).toEqual([{ version: "v1", expect: "a".repeat(16) }]);
    expect(t.p.changes()).toBe(1);
  });

  test("a publish refreshes the palette and drops a tile the content no longer has", () => {
    const t = page();
    const m = blankMap(1000, 992);
    // A tile the content no longer has (a publish removed it), taken with the eyedropper.
    m.layers[0][0] = ["QQ9", ...(m.layers[0][0] ?? "").split(" ").slice(1)].join(" ");
    t.open(m);
    const tool = t.q<HTMLSelectElement>("#world-tool");
    tool.value = "pick";
    tool.dispatchEvent(new Event("change"));
    t.press(1, 1);
    const painting = () =>
      t.qa(".world-form p").find((p) => p.textContent?.startsWith("Painting with"))?.textContent;
    expect(painting()).toContain("QQ9");
    t.p.published();
    expect(painting()).not.toContain("QQ9");
    expect(t.qa('[data-tile][aria-pressed="true"]')).toHaveLength(1);
  });
});

describe("the plain-language World page", () => {
  test("an empty state shows until a map opens; the title is the map's name with its position under it", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentMaps", seq: t.asked[0]?.seq ?? 0, view: view(null) });
    const empty = t.q<HTMLElement>(".items-empty-form");
    expect(empty.hidden).toBe(false);
    const m = blankMap(1000, 992);
    m.header = "Town";
    t.open(m);
    expect(empty.hidden).toBe(true);
    expect(t.q(".world-form .content-section-title").textContent).toBe("Town");
    expect(t.q(".world-form .items-form-id").textContent).toContain("x1000y992");
  });

  test("the list shows a map by its name, with its position beside it", () => {
    const t = page();
    t.p.onShow();
    t.p.receive({ t: "contentMaps", seq: t.asked[0]?.seq ?? 0, view: view(null) });
    const first = t.q('button[data-map="x1000y992"]');
    expect(first.querySelector(".items-list-name")?.textContent).toBe("Town");
    expect(first.querySelector(".items-list-meta")?.textContent).toContain("x1000y992");
    expect(t.q(".world-page .items-list-box > .control-panel-field-help")?.textContent).toBe(
      "2 maps",
    );
  });

  test("the side forms are tabs; a tab holding something carries a dot", async () => {
    const t = page();
    const m = blankMap(1000, 992);
    m.items = [{ name: "Apple", x: 1, y: 1 }];
    t.open(m);
    // The tab strip follows the form a moment later (a mutation observer).
    await new Promise((r) => setTimeout(r, 0));
    const tabs = t.qa(".world-form .control-panel-tab").map((b) => b.textContent);
    expect(tabs).toEqual([
      "Tiles",
      "Monsters & NPCs",
      "Items",
      "Exits",
      "Name & signs",
      "Rules",
      "Fog",
      "Layers and stamps",
      "Saved versions",
      "All",
    ]);
    const group = (id: string) => t.q<HTMLElement>(`section[data-group="${id}"]`);
    expect(group("items").dataset.used).toBe("true");
    expect(group("exits").dataset.used).toBe("false");
    const header = t.q<HTMLInputElement>('[data-action="world-header"]');
    header.value = "Mine";
    header.dispatchEvent(new Event("input"));
    expect(group("text").dataset.used).toBe("true");
    await new Promise((r) => setTimeout(r, 0));
    const itemsTab = t.qa(".world-form .control-panel-tab").find((b) => b.textContent === "Items");
    expect(itemsTab?.classList.contains("control-panel-tab-used")).toBe(true);
  });

  test("tools and layers are named in words, and the tool says what it does", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const layers = [...t.q<HTMLSelectElement>("#world-layer").options].map((o) => o.textContent);
    expect(layers).toEqual([
      "Ground (layer 1)",
      "Objects (layer 2)",
      "Above characters (layer 3)",
      "Shadows (layer S)",
    ]);
    const help = t.q(".world-tool-help");
    expect(help.textContent).toContain("Pencil");
    const tool = t.q<HTMLSelectElement>("#world-tool");
    tool.value = "flood";
    tool.dispatchEvent(new Event("change"));
    expect(help.textContent).toContain("joined tiles");
    expect(t.q('[data-action="world-undo"]').textContent).toBe("Undo last step");
  });

  test("the Save bar says saves go live (Save and go live); Undo changes shows only after an edit", () => {
    const t = page();
    t.open(blankMap(1000, 992));
    const save = t.q<HTMLButtonElement>('[data-action="world-save"]');
    const undo = t.q<HTMLButtonElement>('[data-action="world-undo-edit"]');
    expect(save.textContent).toBe("Save and go live");
    expect(undo.hidden).toBe(true);
    expect(t.q(".world-live-note").textContent).toContain("go live at once");
    const header = t.q<HTMLInputElement>('[data-action="world-header"]');
    header.value = "Mine";
    header.dispatchEvent(new Event("input"));
    expect(undo.hidden).toBe(false);
    // A position with no map: the button makes it.
    const n = page();
    n.open(blankMap(5, 5), { exists: false });
    expect(n.q('[data-action="world-save"]').textContent).toBe("Create this map");
    expect(n.q(".world-form .balance-tags").textContent).toContain("New map");
  });

  test("fog is named in words, and its colour is shown with it", () => {
    const t = page();
    const m = blankMap(1000, 992);
    m.fog = { tex: "Cloudy1", blend: 100, r: 200, g: 255, b: 255 };
    t.open(m);
    const tex = t.q<HTMLSelectElement>('[data-action="world-fog-tex"]');
    expect(tex.options[0]?.textContent).toBe("No fog");
    expect(tex.selectedOptions[0]?.textContent).toBe("Cloudy 1");
    expect(t.q('section[data-group="fog"] .items-more').closest("details")).toBeNull();
    expect(t.q<HTMLElement>('section[data-group="fog"]').dataset.used).toBe("true");
    t.q<HTMLButtonElement>('[data-action="world-save"]').click();
  });
});
