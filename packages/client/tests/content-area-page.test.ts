/**
 * The Control Panel pages built from content forms (ui/content-area-page.ts): a records tab lists a
 * part's entries and edits one in a form; a settings tab edits sections as cards. Saves go into the
 * draft naming the row's revision; an optional section can be turned off and added back; a vehicle's
 * Remove hands over to its removal form; a page off screen catches up when shown again.
 */
import { describe, expect, test } from "bun:test";

import type { ContentListing, ContentRowDetail, ContentRowRef } from "@secondstaronline/shared";

import { type AreaTab, createAreaPage } from "../src/ui/content-area-page.ts";
import type { ContentAnswer, ContentRequests } from "../src/ui/content-requests.ts";
import type { FormWords } from "../src/ui/schema-form.ts";

const SECTION_SCHEMA = {
  type: "object",
  properties: { cost: { type: "integer", minimum: 0, maximum: 100 } },
  required: ["cost"],
  additionalProperties: false,
};
const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    hull: { type: "integer", minimum: 1, maximum: 999 },
  },
  required: ["name", "hull"],
  additionalProperties: false,
};

const words: FormWords = { field: () => ({}), names: () => [] };

interface Fake extends ContentRequests {
  drafts: { ref: ContentRowRef; op: string; data: unknown; expect?: string }[];
  rows: Map<string, ContentRowDetail>;
}

function fake(): Fake {
  const rows = new Map<string, ContentRowDetail>();
  const id = (r: ContentRowRef) => `${r.dataset}/${r.part}/${r.key ?? ""}`;
  const drafts: Fake["drafts"] = [];
  const ok: ContentAnswer = { ok: true, text: "" };
  return {
    drafts,
    rows,
    classUsage: async () => ({ name: "", holders: 0, pending: null }),
    removeClass: async () => ok,
    list: async (dataset, part): Promise<ContentListing> => ({
      dataset,
      part,
      keyField: "name",
      schema: ENTRY_SCHEMA,
      rows: [...rows.values()]
        .filter((r) => r.dataset === dataset && r.part === part && r.key !== null)
        .map((r) => ({ key: r.key, status: r.status ?? "pack", draft: r.draft?.op ?? null })),
    }),
    row: async (r) => {
      const row = rows.get(id(r));
      if (!row) {
        throw new Error("There is no such row.");
      }
      return row;
    },
    draft: async (ref, op, data, expect) => {
      drafts.push({ ref, op, data, ...(expect !== undefined ? { expect } : {}) });
      return ok;
    },
    discard: async () => ok,
    receive: () => false,
    reset: () => {},
  };
}

const sectionRow = (part: string, value: unknown, extra: Partial<ContentRowDetail> = {}) =>
  ({
    dataset: "casino",
    part,
    key: null,
    keyField: null,
    readOnly: false,
    status: value === null ? null : "pack",
    pack: value,
    published: value,
    draft: null,
    schema: SECTION_SCHEMA,
    revision: "rev-1",
    ...extra,
  }) as ContentRowDetail;

const vehicleRow = (name: string, hull: number): ContentRowDetail => ({
  dataset: "houses",
  part: "vehicles",
  key: name,
  keyField: "name",
  readOnly: false,
  status: "pack",
  pack: { name, hull },
  published: { name, hull },
  draft: null,
  schema: ENTRY_SCHEMA,
  revision: `rev-${name}`,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(tabs: AreaTab[], requests: Fake) {
  let published = 0;
  const page = createAreaPage(
    { id: "test-area", title: "Test", intro: "", tabs },
    { requests, words: () => words, openContent: () => published++ },
  );
  document.body.append(page.el);
  const q = <T extends Element>(sel: string) => page.el.querySelector(sel) as T;
  const button = (text: string, within: ParentNode = page.el) =>
    [...within.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === text && !b.hidden,
    );
  return { page, q, button };
}

describe("settings cards", () => {
  test("a card shows its section's form, and a save puts it in the draft with its revision", async () => {
    const r = fake();
    r.rows.set("casino/slots/", sectionRow("slots", { cost: 10 }));
    const t = setup(
      [
        {
          kind: "settings",
          label: "Casino",
          help: "",
          parts: [{ dataset: "casino", part: "slots", title: "Slot Machine", help: "" }],
        },
      ],
      r,
    );
    t.page.onShow();
    await flush();
    const input = t.q<HTMLInputElement>(".schema-form input");
    expect(input.value).toBe("10");
    const save = t.button("Save changes") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    input.value = "12";
    input.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    // A page with an unsaved card says so (the Control Panel asks before leaving it).
    expect(t.page.changes()).toBe(1);
    save.click();
    await flush();
    expect(r.drafts).toEqual([
      {
        ref: { dataset: "casino", part: "slots", key: null },
        op: "set",
        data: { cost: 12 },
        expect: "rev-1",
      },
    ]);
    // A section the world can't go without has no Turn this off.
    expect(t.button("Turn this off")).toBeUndefined();
    t.page.el.remove();
  });

  test("a value out of its limits is not sent, and says why", async () => {
    const r = fake();
    r.rows.set("casino/slots/", sectionRow("slots", { cost: 10 }));
    const t = setup(
      [
        {
          kind: "settings",
          label: "Casino",
          help: "",
          parts: [{ dataset: "casino", part: "slots", title: "Slot Machine", help: "" }],
        },
      ],
      r,
    );
    t.page.onShow();
    await flush();
    const input = t.q<HTMLInputElement>(".schema-form input");
    input.value = "500";
    input.dispatchEvent(new Event("input"));
    t.button("Save changes")?.click();
    await flush();
    expect(r.drafts).toHaveLength(0);
    expect(t.q(".balance-status").textContent).toContain("from 0 to 100");
    t.page.el.remove();
  });

  test("an optional section can be turned off, and one the world leaves out added back", async () => {
    const r = fake();
    r.rows.set("casino/slots/", sectionRow("slots", { cost: 10 }, { optional: true }));
    r.rows.set("casino/checkers/", sectionRow("checkers", null, { optional: true }));
    const t = setup(
      [
        {
          kind: "settings",
          label: "Casino",
          help: "",
          parts: [
            { dataset: "casino", part: "slots", title: "Slot Machine", help: "" },
            { dataset: "casino", part: "checkers", title: "Checkers", help: "" },
          ],
        },
      ],
      r,
    );
    t.page.onShow();
    await flush();
    const [slots, checkers] = [...t.page.el.querySelectorAll<HTMLElement>(".content-area-card")];
    // Turning one off asks first, then removes the section.
    t.button("Turn this off", slots as HTMLElement)?.click();
    await flush();
    (document.querySelector('[data-action="control-panel-confirm-ok"]') as HTMLElement).click();
    await flush();
    await flush();
    expect(r.drafts.at(-1)).toMatchObject({
      ref: { dataset: "casino", part: "slots", key: null },
      op: "remove",
    });
    // The one the world leaves out says so, and Add it starts a blank one to save.
    expect(checkers?.textContent).toContain("This world goes without it.");
    t.button("Add it", checkers as HTMLElement)?.click();
    const input = (checkers as HTMLElement).querySelector<HTMLInputElement>(".schema-form input");
    expect(input?.value).toBe("0");
    (input as HTMLInputElement).value = "3";
    input?.dispatchEvent(new Event("input"));
    t.button("Save changes", checkers as HTMLElement)?.click();
    await flush();
    expect(r.drafts.at(-1)).toEqual({
      ref: { dataset: "casino", part: "checkers", key: null },
      op: "set",
      data: { cost: 3 },
    });
    t.page.el.remove();
  });
});

describe("records", () => {
  const vehicles = (removeVia?: { label: string; run(key: string): void }): AreaTab[] => [
    {
      kind: "records",
      label: "Vehicles",
      help: "",
      part: {
        dataset: "houses",
        part: "vehicles",
        title: "Vehicles",
        help: "",
        noun: "vehicle",
        ...(removeVia ? { removeVia } : {}),
      },
    },
  ];

  test("an entry opens from the list; its name can't change, a new one is made with a name", async () => {
    const r = fake();
    r.rows.set("houses/vehicles/Boat", vehicleRow("Boat", 60));
    r.rows.set("houses/vehicles/Airship", vehicleRow("Airship", 40));
    const t = setup(vehicles(), r);
    t.page.onShow();
    await flush();
    const items = [...t.page.el.querySelectorAll<HTMLButtonElement>(".items-list-item")];
    // Listed A–Z, whatever order the rows are stored in.
    expect(items.map((b) => b.textContent)).toEqual(["Airship", "Boat"]);
    items[1]?.click();
    await flush();
    const [name, hull] = [
      ...t.page.el.querySelectorAll<HTMLInputElement>(".items-form .schema-form input"),
    ];
    (hull as HTMLInputElement).value = "70";
    hull?.dispatchEvent(new Event("input"));
    t.button("Save changes")?.click();
    await flush();
    expect(r.drafts.at(-1)).toEqual({
      ref: { dataset: "houses", part: "vehicles", key: "Boat" },
      op: "set",
      data: { name: "Boat", hull: 70 },
      expect: "rev-Boat",
    });
    // Renaming is refused: the name is how the game finds it (the form was drawn again after the
    // save, from what the draft holds).
    expect(name?.isConnected).toBe(false);
    const again = t.page.el.querySelector<HTMLInputElement>(".items-form .schema-form input");
    (again as HTMLInputElement).value = "Ship";
    again?.dispatchEvent(new Event("input"));
    t.button("Save changes")?.click();
    await flush();
    expect(r.drafts).toHaveLength(1);
    expect(t.q(".items-form .balance-status").textContent).toContain("can't change once saved");
    t.page.el.remove();
  });

  test("+ New makes one under its name, naming no revision", async () => {
    const r = fake();
    r.rows.set("houses/vehicles/Boat", vehicleRow("Boat", 60));
    const t = setup(vehicles(), r);
    t.page.onShow();
    await flush();
    t.button("+ New vehicle")?.click();
    await flush();
    const [name, hull] = [
      ...t.page.el.querySelectorAll<HTMLInputElement>(".items-form .schema-form input"),
    ];
    (name as HTMLInputElement).value = "Raft";
    name?.dispatchEvent(new Event("input"));
    (hull as HTMLInputElement).value = "5";
    hull?.dispatchEvent(new Event("input"));
    t.button("Save changes")?.click();
    await flush();
    expect(r.drafts.at(-1)).toEqual({
      ref: { dataset: "houses", part: "vehicles", key: "Raft" },
      op: "set",
      data: { name: "Raft", hull: 5 },
    });
    t.page.el.remove();
  });

  test("a vehicle's Remove hands over to its removal form", async () => {
    const r = fake();
    r.rows.set("houses/vehicles/Boat", vehicleRow("Boat", 60));
    const removed: string[] = [];
    const t = setup(vehicles({ label: "Remove this vehicle…", run: (k) => removed.push(k) }), r);
    t.page.onShow();
    await flush();
    t.page.el.querySelector<HTMLButtonElement>(".items-list-item")?.click();
    await flush();
    t.button("Remove this vehicle…")?.click();
    expect(removed).toEqual(["Boat"]);
    expect(r.drafts).toHaveLength(0);
    t.page.el.remove();
  });

  test("a publish while the page is off screen is caught up when it is shown", async () => {
    const r = fake();
    r.rows.set("houses/vehicles/Boat", vehicleRow("Boat", 60));
    const t = setup(vehicles(), r);
    let lists = 0;
    const list = r.list;
    r.list = (d, p) => {
      lists++;
      return list(d, p);
    };
    t.page.onShow();
    await flush();
    expect(lists).toBe(1);
    t.page.el.remove();
    // Off screen: nothing is asked.
    t.page.published();
    await flush();
    expect(lists).toBe(1);
    document.body.append(t.page.el);
    t.page.onShow();
    await flush();
    expect(lists).toBe(2);
    t.page.el.remove();
  });
});
