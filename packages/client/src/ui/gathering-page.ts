/**
 * The Control Panel's Gathering page (issue #38): the harvest nodes by tile (each with its tile's
 * picture from the client's tile atlas), fishing, farming and the hit counter, edited into the
 * content store's shared draft. A node edits its tile and the tile it becomes, how it regrows, the
 * tool behaviour and tools it takes, the lowest tool tier, the ground it must be on, the skill it
 * trains with its requirement and XP, its yield table, and its sounds. A preview, worked out by the
 * game's own rules (shared `gatherPreview`, `xpPreview` and `fishingPreview`), shows each skill
 * value and tool tier's chance of success and expected yield. New activity kinds need code.
 *
 * A change carries the part as the page showed it (`fingerprint`): the server refuses it if someone
 * changed it since, and refuses a change that brings a new problem.
 */
import type { HarvestNode, XpSettings, YieldTable } from "@secondstaronline/data";
import {
  type ContentGatheringView,
  type ContentProblemView,
  fishingPreview,
  type GatheringNodeView,
  gatherPreview,
  nodeToolTiers,
  previewCap,
  TILE_SIZE,
  xpPreview,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action, noAutofill } from "./action.ts";
import { formActions, pageHeading, panelButton, sectionTabs } from "./control-panel-kit.ts";
import { canonical } from "./items-page.ts";
import { chanceText } from "./skills-page.ts";

/** A Gathering page change as the page sends it. */
export interface GatheringChange {
  op: "node" | "newNode" | "removeNode" | "fishing" | "farming" | "counter" | "discard";
  index?: number;
  data?: unknown;
  expect?: string;
}

export interface GatheringPageActions {
  view(seq: number): void;
  set(seq: number, change: GatheringChange): void;
  openContent(): void;
  /** Opens a skill on the Skills page. */
  openSkill(key: string): void;
}

export type GatheringAnswer = {
  t: "contentGathering";
  seq: number;
  view: ContentGatheringView;
  result?: { ok: boolean; text: string; problems?: ContentProblemView[] };
};

export interface GatheringPage {
  readonly el: HTMLElement;
  onShow(): void;
  changes(): number;
  discard(): void;
  receive(msg: GatheringAnswer): void;
  published(): void;
  reset(): void;
  /** Opens a node's form (or the page's top). */
  open(node?: number): void;
}

type NodeWork = { node: HarvestNode; yieldTable: YieldTable | null; regrows: string | null };

/**
 * A node save as the server takes it: the yield table only when the form edited it (with its
 * revision as loaded), a `bySkill` left with no rows left out.
 */
export function nodePayload(
  work: NodeWork,
  yieldEdit: { edited: boolean; expect: string | null },
): Record<string, unknown> {
  const out: Record<string, unknown> = { node: structuredClone(work.node), regrows: work.regrows };
  if (yieldEdit.edited && work.yieldTable) {
    const t = structuredClone(work.yieldTable);
    if (t.kind === "chance" && t.bySkill?.length === 0) {
      delete t.bySkill;
    }
    out.yieldTable = t;
    out.yieldExpect = yieldEdit.expect;
  }
  return out;
}

/**
 * Preview rows over every skill value from 0 to 100, with each run of values that reads the same
 * folded into one row ("21-30"), so every change shows.
 */
export function foldRows<T>(
  values: readonly number[],
  cells: (v: number) => T,
  key: (t: T) => string,
): { from: number; to: number; cells: T }[] {
  const out: { from: number; to: number; cells: T }[] = [];
  for (const v of values) {
    const c = cells(v);
    const last = out.at(-1);
    if (last && key(last.cells) === key(c)) {
      last.to = v;
    } else {
      out.push({ from: v, to: v, cells: c });
    }
  }
  return out;
}

const ALL_SKILLS = Array.from({ length: 101 }, (_, i) => i);

let ids = 0;
function labelled(label: string, control: HTMLElement, help = ""): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "control-panel-field balance-field";
  const l = document.createElement("label");
  l.className = "control-panel-field-label";
  ids += 1;
  control.id ||= `gathering-field-${ids}`;
  l.htmlFor = control.id;
  l.textContent = label;
  wrap.append(l, control);
  if (help) {
    const h = document.createElement("p");
    h.className = "control-panel-field-help";
    h.textContent = help;
    wrap.append(h);
  }
  return wrap;
}
function option(value: string, text = value): HTMLOptionElement {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = text;
  return o;
}

/** The skill values a preview shows. */

export function createGatheringPage(actions: GatheringPageActions, assets?: Assets): GatheringPage {
  const el = document.createElement("div");
  el.className = "gathering-page items-page balance-page";
  el.append(
    pageHeading(
      "Gathering",
      "Harvest nodes (what a tool does to a tile), fishing, farming and the hit counter. A node turns its tile into another, drops from a yield table that can scale with skill, and trains a skill. Changes go into the content draft, published from the Content page. New kinds of activity need code.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  const discardAll = panelButton("gathering-discard", "Drop the draft's gathering changes", () => {
    if (view) {
      send({ op: "discard", expect: view.fingerprint }, "discard");
    }
  });
  draftLine.append(
    draftText,
    panelButton("gathering-open-content", "Review and publish on the Content page", () =>
      actions.openContent(),
    ),
    discardAll,
  );
  const statusLine = () => {
    const p = document.createElement("p");
    p.className = "balance-status";
    p.setAttribute("role", "status");
    return p;
  };
  const say = (p: HTMLElement, text: string, ok = true) => {
    p.textContent = text;
    p.className = ok ? "balance-status" : "balance-status balance-status-error";
  };
  const problemText = (r: { text: string; problems?: ContentProblemView[] }) =>
    [r.text, ...(r.problems ?? []).map((p) => `${p.where}: ${p.message}`)].join(" ");

  // ---- the list ----
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  const listEl = document.createElement("ul");
  listEl.className = "items-list";
  listEl.setAttribute("aria-label", "Harvest nodes");
  const newBtn = panelButton("gathering-new-node", "New harvest node", () => {
    if (guard()) {
      return;
    }
    openIndex = -1;
    work = {
      node: {
        tile: "",
        can: (view?.choices.cans[0] ?? "Chop") as HarvestNode["can"],
        becomes: "",
        skill: view?.skills[0]?.skill ?? "",
        gains: true,
        hitSound: null,
        successSound: null,
      },
      yieldTable: null,
      regrows: null,
    };
    yieldEdit = { edited: false, expect: null };
    filled = { value: "", fingerprint: "" };
    drawList();
    drawNode();
  });
  const fixedLinks = document.createElement("div");
  fixedLinks.className = "content-buttons";
  fixedLinks.append(
    panelButton("gathering-open-fishing", "Fishing", () => openFixed("fishing")),
    panelButton("gathering-open-farming", "Farming", () => openFixed("farming")),
    panelButton("gathering-open-counter", "Hit counter", () => openFixed("counter")),
  );
  listBox.append(newBtn, fixedLinks, listEl);

  // ---- the form ----
  const form = document.createElement("section");
  form.className = "items-form";
  form.hidden = true;
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this since you started editing it: saving will be refused. Drop your edit to see theirs.";
  const body = document.createElement("div");
  const status = statusLine();
  const saveBtn = panelButton(
    "gathering-save",
    "Save to the draft",
    () => {
      if (invalid.size > 0) {
        say(status, [...invalid.values()].join(". "), false);
        return;
      }
      if (part === "node") {
        if (openIndex === -1) {
          send({ op: "newNode", data: nodePayload(work, yieldEdit) }, "node");
        } else {
          send(
            {
              op: "node",
              index: openIndex,
              data: nodePayload(work, yieldEdit),
              expect: filled.fingerprint,
            },
            "node",
          );
        }
      } else if (part !== null) {
        send({ op: part, data: structuredClone(fixedWork), expect: filled.fingerprint }, part);
      }
    },
    "primary",
  );
  const undoBtn = panelButton("gathering-undo-edit", "Drop my edit", () => {
    if (part === "node" && openIndex === -1) {
      // A new node not yet saved: the form closes.
      part = null;
      form.hidden = true;
      invalid.clear();
      update();
      drawList();
    } else {
      refill();
    }
    status.textContent = "";
  });
  const removeBtn = panelButton(
    "gathering-remove-node",
    "Remove this node",
    () => {
      if (part === "node" && openIndex >= 0) {
        send({ op: "removeNode", index: openIndex, expect: filled.fingerprint }, "node");
      }
    },
    "danger",
  );
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(saveBtn, undoBtn, removeBtn);
  form.append(title, stale, sectionTabs(form, "gathering").el, body, formActions(buttons, status));
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  layout.append(listBox, form);
  el.append(draftLine, loading, layout);

  // ---- state ----
  let seq = 0;
  let resetSeq = -1;
  let appliedSeq = -1;
  const saving = new Map<number, string>();
  let view: ContentGatheringView | null = null;
  /** What the form shows: a node, or one of the fixed parts. */
  let part: "node" | "fishing" | "farming" | "counter" | null = null;
  /** The node open (-1: a new one). */
  let openIndex = -1;
  let work: NodeWork = { node: {} as HarvestNode, yieldTable: null, regrows: null };
  /** Whether the form edited the yield table, and its revision as the form loaded it. */
  let yieldEdit: { edited: boolean; expect: string | null } = { edited: false, expect: null };
  let fixedWork: unknown = null;
  let filled = { value: "", fingerprint: "" };
  let busy = false;
  const invalid = new Map<HTMLElement, string>();
  const previewTier = { value: 0 };
  /** A node asked for before the view came. */
  let pendingOpen: number | undefined;

  const current = () => (part === "node" ? work : fixedWork);
  const dirty = () => part !== null && (canonical(current()) !== filled.value || invalid.size > 0);
  const guard = () => {
    if (busy) {
      say(status, "Wait for the save to finish.", false);
      return true;
    }
    if (dirty()) {
      say(status, "Save your edit or drop it first.", false);
      return true;
    }
    return false;
  };
  const send = (change: GatheringChange, what: string) => {
    if (busy) {
      return;
    }
    busy = true;
    say(status, "Saving…");
    update();
    seq += 1;
    saving.set(seq, what);
    actions.set(seq, change);
  };
  const ask = () => {
    seq += 1;
    actions.view(seq);
  };
  const update = () => {
    const d = dirty();
    saveBtn.disabled = busy || !(d || (part === "node" && openIndex === -1));
    undoBtn.disabled = busy || !d;
    removeBtn.hidden = !(part === "node" && openIndex >= 0);
    removeBtn.disabled = busy;
    discardAll.hidden = !view?.pending;
    const shownFp =
      part === "node"
        ? (view?.nodes[openIndex]?.fingerprint ?? filled.fingerprint)
        : part === "fishing"
          ? view?.fishing.fingerprint
          : part === "farming"
            ? view?.farming.fingerprint
            : part === "counter"
              ? view?.counter.fingerprint
              : filled.fingerprint;
    stale.hidden = !(d && openIndex !== -1 && shownFp !== filled.fingerprint);
  };
  const edited = () => {
    status.textContent = "";
    update();
    drawPreview();
  };

  // ---- small controls ----
  const text = (idName: string, value: string, write: (t: string) => void, list = "") => {
    const t = noAutofill(action(document.createElement("input"), idName));
    t.value = value;
    if (list) {
      t.setAttribute("list", list);
    }
    t.addEventListener("input", () => {
      write(t.value.trim());
      edited();
    });
    return t;
  };
  const int = (
    idName: string,
    value: number | null | undefined,
    min: number,
    max: number,
    nullable: boolean,
    label: string,
    write: (n: number | null) => void,
  ) => {
    const input = noAutofill(action(document.createElement("input"), idName));
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.value = value === null || value === undefined ? "" : String(value);
    if (nullable) {
      input.placeholder = "none";
    }
    input.addEventListener("input", () => {
      const t = input.value.trim();
      if (t === "" && nullable) {
        invalid.delete(input);
        write(null);
      } else if (!/^-?\d+$/.test(t) || Number(t) < min || Number(t) > max) {
        invalid.set(input, `${label}: a whole number from ${min} to ${max}`);
      } else {
        invalid.delete(input);
        write(Number(t));
      }
      edited();
    });
    return input;
  };
  const check = (idName: string, on: boolean, label: string, write: (on: boolean) => void) => {
    const l = document.createElement("label");
    l.className = "items-check";
    const b = action(document.createElement("input"), idName);
    b.type = "checkbox";
    b.checked = on;
    b.addEventListener("change", () => {
      write(b.checked);
      edited();
    });
    l.append(b, ` ${label}`);
    return l;
  };
  const codes = (value: readonly string[] | undefined, label: string, input: HTMLInputElement) => {
    input.value = (value ?? []).join(", ");
    return (t: string): string[] | null => {
      const parts = t
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== "");
      if (!parts.every((x) => x.length === 2)) {
        invalid.set(input, `${label}: two-letter tile codes, comma-separated`);
        return null;
      }
      invalid.delete(input);
      return parts;
    };
  };
  /** Rows of objects with whole-number and text fields, with add and remove. */
  const rowsEditor = <T extends Record<string, unknown>>(
    idPrefix: string,
    label: string,
    rows: T[],
    fields: readonly {
      key: keyof T & string;
      label: string;
      kind: "int" | "text";
      list?: string;
    }[],
    blank: () => T,
    /** Runs on every change, before the page's own (a row added, removed or typed in). */
    changed: () => void = () => {},
  ): HTMLElement => {
    const box = document.createElement("div");
    box.className = "items-list-editor";
    const h = document.createElement("p");
    h.className = "items-list-title";
    h.textContent = label;
    const listBox2 = document.createElement("div");
    const draw = () => {
      listBox2.replaceChildren(
        ...rows.map((row, i) => {
          const line = document.createElement("div");
          line.className = "items-list-row";
          for (const f of fields) {
            const control =
              f.kind === "int"
                ? int(
                    `${idPrefix}-${f.key}`,
                    row[f.key] as number,
                    -1_000_000,
                    1_000_000_000,
                    false,
                    `${label} ${i + 1} ${f.label}`,
                    (n) => {
                      (row as Record<string, unknown>)[f.key] = n ?? 0;
                      changed();
                    },
                  )
                : text(
                    `${idPrefix}-${f.key}`,
                    String(row[f.key] ?? ""),
                    (t) => {
                      (row as Record<string, unknown>)[f.key] = t;
                      changed();
                    },
                    f.list,
                  );
            line.append(labelled(f.label, control));
          }
          line.append(
            panelButton(`${idPrefix}-remove`, "Remove", () => {
              rows.splice(i, 1);
              changed();
              for (const k of [...invalid.keys()]) {
                if (!k.isConnected) {
                  invalid.delete(k);
                }
              }
              draw();
              edited();
            }),
          );
          return line;
        }),
      );
    };
    draw();
    box.append(
      h,
      listBox2,
      panelButton(`${idPrefix}-add`, "Add a row", () => {
        rows.push(blank());
        changed();
        draw();
        edited();
      }),
    );
    return box;
  };

  // Datalists for picks.
  const tilesList = document.createElement("datalist");
  tilesList.id = "gathering-tiles";
  const itemsList = document.createElement("datalist");
  itemsList.id = "gathering-items";
  const soundsList = document.createElement("datalist");
  soundsList.id = "gathering-sounds";
  const yieldsList = document.createElement("datalist");
  yieldsList.id = "gathering-yields";
  el.append(tilesList, itemsList, soundsList, yieldsList);

  /** A tile's picture, drawn from the client's tile atlas (the published art). */
  const tilePicture = (code: string): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = TILE_SIZE;
    c.height = TILE_SIZE;
    c.className = "gathering-tile";
    c.setAttribute("aria-hidden", "true");
    const ctx = c.getContext("2d");
    if (assets && ctx && code) {
      void assets
        .loadGroup("tiles")
        .then(() => drawSprite(ctx, assets, "tiles", code, 0, 0, true))
        .catch(() => {});
    }
    return c;
  };
  const tileName = (code: string) =>
    view?.choices.tiles.find((t) => t.code.toLowerCase() === code.toLowerCase())?.name ?? "";

  // ---- the preview ----
  const preview = document.createElement("div");
  preview.className = "gathering-preview";
  const drawPreview = () => {
    preview.replaceChildren();
    if (!view) {
      return;
    }
    const table = document.createElement("table");
    table.className = "control-panel-table";
    const head = document.createElement("tr");
    const tbody = document.createElement("tbody");
    const cell = (tag: "td" | "th", t: string) => {
      const c = document.createElement(tag);
      c.textContent = t;
      return c;
    };
    if (part === "fishing" && fixedWork) {
      const f = fixedWork as {
        bands: { lt: number; fish: string }[];
        fishCheck: { gt: number; value: number }[];
      };
      table.setAttribute("aria-label", "Fishing by skill");
      head.append(cell("th", "Fishing"), cell("th", "Bites"), cell("th", "Catches"));
      const fish = fishingPreview(f, ALL_SKILLS);
      for (const { from, to, cells: r } of foldRows(
        ALL_SKILLS,
        (v) => fish[v] as (typeof fish)[number],
        (r) => `${r.bite}|${r.fish}`,
      )) {
        const tr = document.createElement("tr");
        tr.append(
          cell("td", from === to ? String(from) : `${from}-${to}`),
          cell("td", chanceText(r.bite)),
          cell("td", r.fish ?? "nothing"),
        );
        tbody.append(tr);
      }
    } else if (part === "node") {
      const node = work.node;
      // The tools the node takes, as the game resolves them (its exact tools, when it names any).
      const usable = nodeToolTiers(node, view.tools);
      const tiers = [...new Set(usable.map((t) => t.tier))].sort((x, y) => x - y);
      const shownTiers =
        previewTier.value > 0 ? tiers.filter((t) => t === previewTier.value) : tiers;
      const yields: Record<string, YieldTable> = { ...view.yields };
      if (node.yield && work.yieldTable) {
        yields[node.yield] = work.yieldTable;
      }
      const skill = view.skills.find((s) => s.skill.toLowerCase() === node.skill.toLowerCase());
      table.setAttribute("aria-label", "Success and yield by skill and tool tier");
      head.append(
        cell("th", "Tools"),
        cell("th", node.skill || "Skill"),
        cell("th", "Swings a success"),
        cell("th", "Success a swing"),
        cell("th", "Drops a success"),
        cell("th", "Drops a swing"),
        cell("th", skill?.model === "xp" ? "XP a success" : "Trains"),
      );
      if (shownTiers.length === 0) {
        const tr = document.createElement("tr");
        const td = cell(
          "td",
          "No tool can work it: no tool row gives its behaviour to the tools it names.",
        );
        td.colSpan = 7;
        tr.append(td);
        tbody.append(tr);
      }
      for (const tier of shownTiers) {
        const ctx = {
          stats: { level: 1, str: 0, sta: 0, int: 0, wis: 0, dex: 0 },
          tables: view.tables,
          otherSkills: 0,
          tier,
          caps: view.caps,
          damage: 0,
          monsterCap: null,
        };
        const xpRows =
          skill?.model === "xp" && skill.curve && node.gains
            ? xpPreview(
                skill.skill,
                skill.curve,
                previewCap(skill.cap ?? undefined, ctx),
                (skill.gather as XpSettings | null) ?? undefined,
                ctx,
                node.xp,
              )
            : null;
        const cells = gatherPreview(
          node,
          {
            counterTable: view.counter.rows,
            yields,
            ...(view.findChance !== null ? { findChance: view.findChance } : {}),
          },
          ALL_SKILLS,
          [tier],
          { level: 1, otherSkills: 0 },
        );
        const tools = usable
          .filter((t) => t.tier === tier)
          .map((t) => t.tool)
          .join(", ");
        const shown = (v: number) => {
          const c = cells[v];
          if (!c) {
            return ["", "", "", "", "", ""];
          }
          const xpRow = xpRows?.find((r) => r.level === v);
          const trains = xpRows
            ? xpRow
              ? `${Number(xpRow.perAction.toFixed(2))}${xpRow.estimate ? " (mean)" : ""}`
              : "0"
            : node.gains && skill?.gather
              ? "its chance roll"
              : "no";
          return c.why
            ? [c.why, "—", "—", "—", "—", "—"]
            : [
                c.hits === null ? "never" : String(c.hits),
                chanceText(c.success),
                chanceText(c.drop),
                c.perSwing.toFixed(3),
                trains,
                "",
              ];
        };
        for (const { from, to, cells: c } of foldRows(ALL_SKILLS, shown, (x) => x.join("|"))) {
          const tr = document.createElement("tr");
          tr.append(
            cell("td", `Tier ${tier}: ${tools}`),
            cell("td", from === to ? String(from) : `${from}-${to}`),
            ...c.slice(0, 5).map((t) => cell("td", t)),
          );
          tbody.append(tr);
        }
      }
    } else {
      return;
    }
    const thead = document.createElement("thead");
    thead.append(head);
    table.append(thead, tbody);
    const wrap = document.createElement("div");
    wrap.className = "control-panel-table-wrap";
    wrap.append(table);
    preview.append(wrap);
  };

  // ---- the node form ----
  const drawNode = () => {
    if (!view) {
      return;
    }
    part = "node";
    form.hidden = false;
    const n = work.node;
    title.textContent =
      openIndex === -1 ? "A new harvest node" : `Node ${openIndex + 1}: ${n.can} ${n.tile}`;
    const sound = (key: "hitSound" | "successSound", label: string) => {
      const s = n[key];
      const box = document.createElement("div");
      box.className = "items-list-row";
      box.append(
        labelled(
          label,
          text(
            `gathering-${key}`,
            s?.name ?? "",
            (t) => {
              n[key] =
                t === "" ? null : { name: t, ch: n[key]?.ch ?? (key === "hitSound" ? 3 : 2) };
            },
            soundsList.id,
          ),
        ),
        labelled(
          "Channel",
          int(`gathering-${key}-ch`, s?.ch ?? null, 1, 8, true, `${label} channel`, (c) => {
            const cur = n[key];
            if (cur) {
              cur.ch = c ?? 1;
            }
          }),
        ),
      );
      return box;
    };
    const can = action(document.createElement("select"), "gathering-can");
    for (const c of view.choices.cans) {
      can.append(option(c));
    }
    can.value = n.can;
    can.addEventListener("change", () => {
      n.can = can.value as HarvestNode["can"];
      edited();
    });
    const skill = action(document.createElement("select"), "gathering-skill");
    for (const s of view.skills) {
      skill.append(option(s.skill, s.display === s.skill ? s.skill : `${s.display} (${s.skill})`));
    }
    skill.value = n.skill;
    skill.addEventListener("change", () => {
      n.skill = skill.value;
      edited();
    });
    const regrows = action(document.createElement("select"), "gathering-regrows");
    regrows.append(option("", "It does not regrow"));
    // A produce check drops farming produce: a node's tile never regrows there.
    for (const c of view.regrowth.checks.filter((x) => !x.produce)) {
      // random(roll) < below fires on below - 1 of the roll's values.
      const per = Math.max(0, c.below - 1) / view.regrowth.roll / view.regrowth.tiles;
      regrows.append(
        option(
          c.handler,
          per > 0
            ? `${c.handler}: about 1 in ${Math.round(1 / per).toLocaleString("en-US")} frames for the tile`
            : `${c.handler}: never runs`,
        ),
      );
    }
    regrows.value = work.regrows ?? "";
    regrows.addEventListener("change", () => {
      work.regrows = regrows.value || null;
      edited();
    });
    const toolsInput = noAutofill(action(document.createElement("input"), "gathering-tools"));
    toolsInput.value = (n.tools ?? []).join(", ");
    toolsInput.placeholder = "any tool that can";
    toolsInput.addEventListener("input", () => {
      const parts = toolsInput.value
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x !== "");
      if (parts.length === 0) {
        delete n.tools;
      } else {
        n.tools = parts;
      }
      edited();
    });
    const underInput = noAutofill(action(document.createElement("input"), "gathering-under"));
    const readUnder = codes(n.under, "Ground", underInput);
    underInput.placeholder = "any ground";
    underInput.addEventListener("input", () => {
      const parts = readUnder(underInput.value);
      if (parts !== null) {
        if (parts.length === 0) {
          delete n.under;
        } else {
          n.under = parts;
        }
      }
      edited();
    });
    // The requirement.
    const reqBox = document.createElement("div");
    reqBox.className = "items-list-row";
    const drawReq = () => {
      reqBox.replaceChildren(
        check("gathering-requires-on", !!n.requires, "Needs a skill or level first", (on) => {
          if (on) {
            n.requires = { needs: n.skill || "level", atLeast: 1 };
          } else {
            delete n.requires;
          }
          drawReq();
        }),
      );
      if (n.requires) {
        const r = n.requires;
        const needs = action(document.createElement("select"), "gathering-requires-needs");
        needs.append(option("level", "Level"));
        for (const s of view?.skills ?? []) {
          needs.append(option(s.skill));
        }
        needs.value = r.needs;
        needs.addEventListener("change", () => {
          r.needs = needs.value;
          edited();
        });
        reqBox.append(
          labelled("Needs", needs),
          labelled(
            "At least",
            int("gathering-requires-at", r.atLeast, 0, 1_000_000, false, "Needs at least", (v) => {
              r.atLeast = v ?? 0;
            }),
          ),
          labelled(
            "Says",
            text("gathering-requires-text", r.text ?? "", (t) => {
              if (t === "") {
                delete r.text;
              } else {
                r.text = t;
              }
            }),
            'Empty: "You need <skill> <n> to <can> this."',
          ),
        );
      }
    };
    drawReq();
    // The yield table.
    const yieldBox = document.createElement("div");
    const drawYield = () => {
      yieldBox.replaceChildren();
      const name = text(
        "gathering-yield",
        n.yield ?? "",
        (t) => {
          if (t === "") {
            delete n.yield;
            work.yieldTable = null;
          } else {
            n.yield = t;
            // A table the world has is only named (its rows stay as they are); a new name makes
            // a new table, saved with the node.
            const known = view && Object.hasOwn(view.yields, t) ? view.yields[t] : undefined;
            work.yieldTable = structuredClone(known ?? { kind: "chance", item: "", chance: 1 });
            yieldEdit = known
              ? { edited: false, expect: view?.yieldFingerprints[t] ?? null }
              : { edited: true, expect: null };
          }
          drawYieldFields();
        },
        yieldsList.id,
      );
      const fields = document.createElement("div");
      const drawYieldFields = () => {
        fields.replaceChildren();
        const t = work.yieldTable;
        if (!t || !n.yield) {
          return;
        }
        const shared = openIndex >= 0 ? (view?.nodes[openIndex]?.yieldSharedWith ?? []) : [];
        if (shared.length > 0) {
          fields.append(
            Object.assign(document.createElement("p"), {
              className: "control-panel-field-help",
              textContent: `Nodes ${shared.map((i) => i + 1).join(", ")} roll this table too: a change here changes theirs.`,
            }),
          );
        }
        if (t.kind === "ore") {
          fields.append(
            Object.assign(document.createElement("p"), {
              className: "control-panel-field-help",
              textContent: "An ore strike: crystals and ores from the world's mining tables.",
            }),
          );
          return;
        }
        // Rows by skill, kept on the table only while it has some (`bySkill` holds at least one).
        const by = t.bySkill ?? [];
        const yieldChanged = () => {
          yieldEdit.edited = true;
          if (by.length > 0) {
            t.bySkill = by;
          } else {
            delete t.bySkill;
          }
        };
        fields.append(
          labelled(
            "Drops",
            text(
              "gathering-yield-item",
              t.item,
              (v) => {
                t.item = v;
                yieldEdit.edited = true;
              },
              itemsList.id,
            ),
          ),
          labelled(
            "1 in",
            int(
              "gathering-yield-chance",
              t.chance,
              1,
              1_000_000_000,
              false,
              "Yield chance",
              (v) => {
                t.chance = v ?? 1;
                yieldEdit.edited = true;
              },
            ),
            "Each success drops it on random(n) = 1.",
          ),
          rowsEditor(
            "gathering-yield-by",
            "By skill: from the last row the skill is above, 1 in this",
            by,
            [
              { key: "gt", label: "Skill above", kind: "int" },
              { key: "value", label: "1 in", kind: "int" },
            ],
            () => ({ gt: 0, value: 1 }),
            yieldChanged,
          ),
        );
      };
      drawYieldFields();
      yieldBox.append(
        labelled(
          "Yield table",
          name,
          "The table each success rolls, by name (empty: it drops nothing).",
        ),
        fields,
      );
    };
    drawYield();
    const tierSel = action(document.createElement("select"), "gathering-preview-tier");
    tierSel.append(option("0", "Every tool tier"));
    for (const t of [...new Set(view.tools.map((x) => x.tier))].sort((a, b) => a - b)) {
      tierSel.append(option(String(t), `Tier ${t}`));
    }
    tierSel.value = String(previewTier.value);
    tierSel.addEventListener("change", () => {
      previewTier.value = Number(tierSel.value);
      drawPreview();
    });
    const tools = view.tools.filter((t) => t.can === n.can);
    const section = (t: string, ...children: HTMLElement[]) => {
      const sec = document.createElement("section");
      sec.className = "balance-row items-group";
      const h = document.createElement("h3");
      h.className = "balance-row-title";
      h.textContent = t;
      sec.append(h, ...children);
      return sec;
    };
    const picture = document.createElement("div");
    picture.className = "items-list-row";
    picture.append(tilePicture(n.tile), " becomes ", tilePicture(n.becomes));
    body.replaceChildren(
      section(
        "Tile",
        picture,
        labelled(
          "Tile",
          text(
            "gathering-tile",
            n.tile,
            (t) => {
              n.tile = t;
            },
            tilesList.id,
          ),
          "The layer-2 tile it is on (two letters).",
        ),
        labelled(
          "Becomes",
          text(
            "gathering-becomes",
            n.becomes,
            (t) => {
              n.becomes = t;
            },
            tilesList.id,
          ),
          "What the tile turns into on a success.",
        ),
        labelled(
          "Regrows",
          regrows,
          "The world's regrowth check that turns the spent tile back, a frame at a time.",
        ),
      ),
      section(
        "Tools",
        labelled("Tool behaviour", can),
        labelled(
          "Only these tools",
          toolsInput,
          "Item names, comma-separated (empty: any tool that can). Tools that can now: " +
            (tools
              .map((t) => `${t.match === "exact" ? "" : "any "}${t.pattern} (tier ${t.tier})`)
              .join(", ") || "none"),
        ),
        labelled(
          "Lowest tool tier",
          int("gathering-tier", n.tier ?? null, 1, 1000, true, "Lowest tier", (v) => {
            if (v === null) {
              delete n.tier;
            } else {
              n.tier = v;
            }
          }),
          "A lower tier is told it needs a better tool. Empty: 1.",
        ),
        labelled(
          "Ground",
          underInput,
          "The layer-1 tiles it must be on, comma-separated (empty: any).",
        ),
      ),
      section(
        "Skill",
        labelled("Skill", skill, "Its value reads the hit counter and the yield table's rows."),
        panelButton("gathering-open-skill", "Open the skill", () => actions.openSkill(n.skill)),
        check(
          "gathering-gains",
          n.gains,
          "Each success trains it (its gather progression)",
          (on) => {
            n.gains = on;
          },
        ),
        labelled(
          "XP a success",
          int("gathering-xp", n.xp ?? null, 0, 1_000_000_000, true, "XP", (v) => {
            if (v === null) {
              delete n.xp;
            } else {
              n.xp = v;
            }
          }),
          "For an XP-model skill: replaces the skill's own gather XP. Empty: the skill's.",
        ),
        reqBox,
      ),
      section("Yield", yieldBox),
      section(
        "Sounds and effects",
        sound("hitSound", "Swing sound"),
        sound("successSound", "Success sound"),
        check(
          "gathering-treasure",
          n.treasure === true,
          "A success may dig up the buried treasure",
          (on) => {
            if (on) {
              n.treasure = true;
            } else {
              delete n.treasure;
            }
          },
        ),
      ),
      section(
        "Preview",
        labelled("Tool tier", tierSel),
        Object.assign(document.createElement("p"), {
          className: "control-panel-field-help",
          textContent:
            "Worked out by the game's own rules from the form as it is now: the swings each success takes (the hit counter), the chance a success drops, and the XP it gives. A tool's tier gates the node and feeds formulas that read tier.",
        }),
        preview,
      ),
    );
    drawPreview();
    update();
  };

  // ---- the fixed parts ----
  const drawFixed = () => {
    if (!view || part === null || part === "node") {
      return;
    }
    form.hidden = false;
    const section = (t: string, ...children: HTMLElement[]) => {
      const sec = document.createElement("section");
      sec.className = "balance-row items-group";
      const h = document.createElement("h3");
      h.className = "balance-row-title";
      h.textContent = t;
      sec.append(h, ...children);
      return sec;
    };
    if (part === "counter") {
      title.textContent = "Hit counter";
      body.replaceChildren(
        section(
          "Swings a success takes, by the skill",
          rowsEditor(
            "gathering-counter",
            "From the last row the skill is above",
            fixedWork as { gt: number; value: number }[],
            [
              { key: "gt", label: "Skill above", kind: "int" },
              { key: "value", label: "Swings", kind: "int" },
            ],
            () => ({ gt: 0, value: 1 }),
          ),
          Object.assign(document.createElement("p"), {
            className: "control-panel-field-help",
            textContent:
              "Every harvest node and a Water tool read it: an empty counter loads this many hits, each swing takes one, and the swing that empties it succeeds.",
          }),
        ),
      );
    } else if (part === "fishing") {
      title.textContent = "Fishing";
      const f = fixedWork as Record<string, unknown> | null;
      if (!f) {
        body.replaceChildren(
          Object.assign(document.createElement("p"), {
            className: "control-panel-field-help",
            textContent: "This world has no fishing.",
          }),
        );
        return;
      }
      const water = noAutofill(action(document.createElement("input"), "gathering-water"));
      const readWater = codes(f.waterTiles as string[], "Water tiles", water);
      water.addEventListener("input", () => {
        const p = readWater(water.value);
        if (p) {
          f.waterTiles = p;
        }
        edited();
      });
      body.replaceChildren(
        section(
          "Fishing",
          Object.assign(document.createElement("p"), {
            className: "control-panel-field-help",
            textContent: `A Fish tool facing water casts the line; the bound Fishing skill (${view.fishing.skill ?? "none: fishing is off"}) reads these tables and trains from its gather progression.`,
          }),
          labelled("Water tiles", water, "Two-letter codes, comma-separated."),
          rowsEditor(
            "gathering-bands",
            "Catches: the last band the skill is below",
            f.bands as { lt: number; fish: string }[],
            [
              { key: "lt", label: "Skill below", kind: "int" },
              { key: "fish", label: "Fish", kind: "text", list: itemsList.id },
            ],
            () => ({ lt: 100, fish: "" }),
          ),
          rowsEditor(
            "gathering-bite",
            "Bites: 1 in this, from the last row the skill is above",
            f.fishCheck as { gt: number; value: number }[],
            [
              { key: "gt", label: "Skill above", kind: "int" },
              { key: "value", label: "1 in", kind: "int" },
            ],
            () => ({ gt: 0, value: 1 }),
          ),
          labelled(
            "Catches from one tile",
            int(
              "gathering-anti-macro",
              f.antiMacroStart as number,
              1,
              1_000_000,
              false,
              "Catches from one tile",
              (v) => {
                f.antiMacroStart = v ?? 1;
              },
            ),
          ),
          labelled(
            "Told when spent",
            text("gathering-stopped", String(f.stoppedText ?? ""), (t) => {
              f.stoppedText = t;
            }),
          ),
        ),
        section("Preview", preview),
      );
      drawPreview();
    } else if (part === "farming") {
      title.textContent = "Farming";
      const f = fixedWork as Record<string, unknown> | null;
      if (!f) {
        body.replaceChildren(
          Object.assign(document.createElement("p"), {
            className: "control-panel-field-help",
            textContent: "This world has no farming.",
          }),
        );
        return;
      }
      const skill = action(document.createElement("select"), "gathering-watering-skill");
      for (const s of view.skills) {
        skill.append(option(s.skill));
      }
      skill.value = String(f.wateringSkill ?? "");
      skill.addEventListener("change", () => {
        f.wateringSkill = skill.value;
        edited();
      });
      body.replaceChildren(
        section(
          "Farming",
          rowsEditor(
            "gathering-seeds",
            "Seeds: the item, and the tile it plants",
            f.seeds as { item: string; plants: string }[],
            [
              { key: "item", label: "Seed", kind: "text", list: itemsList.id },
              { key: "plants", label: "Plants", kind: "text", list: tilesList.id },
            ],
            () => ({ item: "", plants: "" }),
          ),
          labelled(
            "Tilled soil",
            text("gathering-seed-test", String(f.seedTest ?? ""), (t) => {
              f.seedTest = t;
            }),
            "The tiles seeds plant on, separated by *.",
          ),
          labelled("Watering skill", skill, "The skill whose hit counter a Water tool advances."),
          rowsEditor(
            "gathering-watering",
            "Watering: a seeded tile and what it becomes",
            f.watering as { from: string; to: string }[],
            [
              { key: "from", label: "From", kind: "text", list: tilesList.id },
              { key: "to", label: "To", kind: "text", list: tilesList.id },
            ],
            () => ({ from: "", to: "" }),
          ),
          rowsEditor(
            "gathering-produce",
            "Produce: a grown tile drops this as regrowth reaches it",
            f.produce as { tile: string; item: string }[],
            [
              { key: "tile", label: "Tile", kind: "text", list: tilesList.id },
              { key: "item", label: "Item", kind: "text", list: itemsList.id },
            ],
            () => ({ tile: "", item: "" }),
          ),
        ),
      );
    }
    update();
  };

  const refill = () => {
    if (!view) {
      return;
    }
    invalid.clear();
    if (part === "node") {
      const n = view.nodes[openIndex];
      if (openIndex >= 0 && n) {
        work = {
          node: structuredClone(n.node),
          yieldTable: structuredClone(n.yield),
          regrows: n.regrows,
        };
        yieldEdit = {
          edited: false,
          expect:
            n.node.yield !== undefined ? (view.yieldFingerprints[n.node.yield] ?? null) : null,
        };
        filled = { value: canonical(work), fingerprint: n.fingerprint };
      }
      drawNode();
    } else if (part) {
      fixedWork =
        part === "counter"
          ? structuredClone(view.counter.rows)
          : part === "fishing"
            ? structuredClone(view.fishing.data)
            : structuredClone(view.farming.data);
      filled = {
        value: canonical(fixedWork),
        fingerprint:
          part === "counter"
            ? view.counter.fingerprint
            : part === "fishing"
              ? view.fishing.fingerprint
              : view.farming.fingerprint,
      };
      drawFixed();
    }
    update();
  };
  const openNode = (index: number) => {
    if (guard()) {
      return;
    }
    part = "node";
    openIndex = index;
    status.textContent = "";
    refill();
    drawList();
  };
  const openFixed = (p: "fishing" | "farming" | "counter") => {
    if (guard()) {
      return;
    }
    part = p;
    openIndex = 0;
    status.textContent = "";
    refill();
    drawList();
  };

  const drawList = () => {
    if (!view) {
      return;
    }
    listEl.replaceChildren(
      ...view.nodes.map((n: GatheringNodeView) => {
        const li = document.createElement("li");
        const b = action(document.createElement("button"), "gathering-open-node");
        b.type = "button";
        b.className = "items-list-item";
        b.dataset.node = String(n.index);
        if (part === "node" && openIndex === n.index) {
          b.setAttribute("aria-current", "true");
        }
        const name = document.createElement("span");
        const tn = tileName(n.node.tile);
        name.textContent = `${n.node.can} ${n.node.tile}${tn ? ` (${tn})` : ""}`;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          n.node.skill,
          n.yield?.kind === "chance" ? n.yield.item : n.yield ? "ore" : "",
          (n.node.tier ?? 1) > 1 ? `tier ${n.node.tier}` : "",
        ]
          .filter((x) => x !== "")
          .join(" · ");
        b.append(tilePicture(n.node.tile), " ", name, " ", meta);
        b.addEventListener("click", () => openNode(n.index));
        li.append(b);
        return li;
      }),
    );
  };

  const show = (v: ContentGatheringView) => {
    loading.hidden = true;
    view = v;
    const opts = (l: HTMLDataListElement, values: string[]) => {
      if (l.childElementCount !== values.length) {
        l.replaceChildren(...values.map((x) => option(x)));
      }
    };
    opts(
      tilesList,
      v.choices.tiles.map((t) => t.code),
    );
    opts(itemsList, v.choices.items);
    opts(soundsList, v.choices.sounds);
    opts(yieldsList, v.choices.yields);
    drawList();
    const total = v.otherDraft + (v.pending ? 1 : 0);
    draftLine.hidden = total === 0;
    draftText.textContent = v.pending
      ? "The draft changes gathering, live once published. "
      : total > 0
        ? `The draft holds ${v.otherDraft} other ${v.otherDraft === 1 ? "change" : "changes"}. `
        : "";
    if (pendingOpen !== undefined && v.nodes[pendingOpen]) {
      const n = pendingOpen;
      pendingOpen = undefined;
      openNode(n);
    }
    if (part !== null && !busy && !dirty()) {
      if (part === "node" && openIndex >= 0 && !v.nodes[openIndex]) {
        part = null;
        form.hidden = true;
      } else if (!(part === "node" && openIndex === -1)) {
        refill();
      }
    }
    update();
  };

  return {
    el,
    onShow: ask,
    changes: () => (dirty() && !busy ? 1 : 0),
    discard() {
      if (!busy) {
        if (part === "node" && openIndex === -1) {
          part = null;
          form.hidden = true;
        } else {
          refill();
        }
        status.textContent = "";
      }
    },
    receive(msg) {
      if (msg.seq <= resetSeq) {
        return;
      }
      const newer = msg.seq >= appliedSeq;
      const save = saving.get(msg.seq);
      if (save !== undefined) {
        saving.delete(msg.seq);
        busy = false;
        if (msg.result) {
          say(status, msg.result.ok ? msg.result.text : problemText(msg.result), msg.result.ok);
          if (msg.result.ok) {
            if (part === "node" && openIndex === -1) {
              // The new node is the last.
              openIndex = msg.view.nodes.length - 1;
            }
            if (part === "node" && !msg.view.nodes[openIndex]) {
              part = null;
              form.hidden = true;
            }
            view = msg.view;
            refill();
          }
        }
      }
      if (newer) {
        appliedSeq = msg.seq;
        show(msg.view);
      } else {
        update();
      }
    },
    published() {
      if (el.isConnected) {
        ask();
      }
    },
    reset() {
      seq += 1;
      resetSeq = seq;
      appliedSeq = seq;
      saving.clear();
      view = null;
      part = null;
      openIndex = -1;
      busy = false;
      invalid.clear();
      fixedWork = null;
      pendingOpen = undefined;
      filled = { value: "", fingerprint: "" };
      status.textContent = "";
      listEl.replaceChildren();
      body.replaceChildren();
      form.hidden = true;
      loading.hidden = false;
      draftLine.hidden = true;
    },
    open(node) {
      if (node === undefined) {
        return;
      }
      if (view?.nodes[node]) {
        openNode(node);
      } else {
        pendingOpen = node;
      }
    },
  };
}
