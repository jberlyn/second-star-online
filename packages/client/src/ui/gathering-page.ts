/**
 * The Control Panel's Gathering page (issue #38): the tiles players harvest with a tool (each with
 * its picture from the client's tile atlas), fishing, farming and the swings a harvest takes,
 * edited into the content store's shared draft.
 *
 * Laid out as the Items page is: a list on the left, and the open part's form behind plain tabs
 * (a harvestable tile: Tile, Tool, Skill, Harvesting, Drops, Sounds and Odds), each with a help line, rare
 * fields last, below a thin line, and a dot on each tab that holds
 * settings beyond the basics. Skill tables are shown "from skill N" (the stored rows say "above
 * N - 1"), and how often a spent tile grows back in minutes; what is saved is unchanged.
 *
 * Underneath, a harvestable tile is a harvest node: its tile and the tile it becomes, the regrowth
 * check that turns it back, the tool behaviour and tools it takes, the lowest tool tier, the
 * ground it must be on, the skill it trains with its requirement and XP, its yield table and its
 * sounds. The odds, worked out by the game's own rules (shared `gatherPreview`, `xpPreview` and
 * `fishingPreview`), show each skill value and tool tier's chance of success and expected drops.
 * New kinds of activity need code.
 *
 * A change carries the part as the page showed it (`fingerprint`): the server refuses it if someone
 * changed it since, and refuses a change that brings a new problem.
 */
import type { HarvestNode, XpSettings, YieldTable } from "@secondstaronline/data";
import {
  type ContentGatheringView,
  type ContentProblemView,
  content,
  type FishCatch,
  fishingPreview,
  type GatheringNodeView,
  gatherPreview,
  nodeToolTiers,
  previewCap,
  TICK_HZ,
  TILE_SIZE,
  xpPreview,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { action, noAutofill } from "./action.ts";
import {
  formActions,
  moreFields,
  pageHeading,
  panelButton,
  sectionTabs,
} from "./control-panel-kit.ts";
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

/** A row of fishing's catch pool as the form edits it. */
type CatchRow = {
  fish: string;
  from: number;
  below?: number;
  weight: number;
  xp?: number;
  tools?: string[];
};

/**
 * The fields each tab holds, by part ("Restore this tab to the original" puts these back). A
 * node's `@regrows` and `@yieldTable` are the form's own, beside its node fields.
 */
const TAB_FIELDS: Record<string, Record<string, readonly string[]>> = {
  node: {
    tile: ["tile", "becomes", "under", "@regrows"],
    tool: ["can", "tools", "tier"],
    skill: ["skill", "requires", "gains", "xp"],
    harvest: ["odds", "tierBonus", "depletes", "respawn"],
    drops: ["yield", "treasure", "@yieldTable"],
    sounds: ["hitSound", "successSound", "strikeFx"],
  },
  fishing: {
    fishing: ["waterTiles", "antiMacroStart", "stoppedText", "trains"],
    cast: ["castFx", "castSound", "fxOffsets"],
    catches: ["catches"],
    bites: ["fishCheck"],
  },
  farming: {
    seeds: ["seedTest", "seeds"],
    watering: ["wateringSkill", "watering"],
    crops: ["produce"],
  },
  counter: { counter: ["*"] },
};

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

/** A wait of `frames` server frames, in plain words ("about 11 minutes"). */
export function waitText(frames: number): string {
  const seconds = frames / TICK_HZ;
  if (seconds < 90) {
    const s = Math.max(1, Math.round(seconds));
    return `${s} ${s === 1 ? "second" : "seconds"}`;
  }
  const minutes = seconds / 60;
  if (minutes < 90) {
    return `${Math.round(minutes)} minutes`;
  }
  return `${(minutes / 60).toFixed(1).replace(/\.0$/, "")} hours`;
}

/** A regrowth check's name as the page says it: `CheckTrees` is "Trees". */
export function regrowthName(handler: string): string {
  const bare = handler.replace(/^(Check|Do)(?=[A-Z])/, "");
  const spaced = bare.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * How a regrowth check reads in the "Grows back" pick: its name and the average wait for one spent
 * tile. The check runs on a frame whose roll (`random(roll)`) is below `below` (`below - 1` of the
 * roll's values), then turns back one tile of `tiles`.
 */
export function regrowthText(
  check: { handler: string; below: number },
  roll: number,
  tiles: number,
): string {
  const per = Math.max(0, check.below - 1) / roll / tiles;
  return per > 0
    ? `${regrowthName(check.handler)}: grows back in about ${waitText(1 / per)} on average`
    : `${regrowthName(check.handler)}: never grows back`;
}

/** The tool behaviours as the page says them. */
const CAN_TEXT: Record<string, string> = {
  Chop: "Chop (axes)",
  Mine: "Mine (picks)",
  Dig: "Dig (shovels)",
  Farm: "Farm (hoes and the like)",
};

const ALL_SKILLS = Array.from({ length: 101 }, (_, i) => i);

let ids = 0;
function labelled(
  label: string,
  control: HTMLElement,
  help: string | HTMLElement = "",
): HTMLElement {
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
    const h = typeof help === "string" ? document.createElement("p") : help;
    h.classList.add("control-panel-field-help");
    if (typeof help === "string") {
      h.textContent = help;
    }
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
function helpLine(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "control-panel-field-help";
  p.textContent = text;
  return p;
}
/** A help line under a tab's title: what the tab is for. */
function intro(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "items-intro";
  p.textContent = text;
  return p;
}
/** A section's less used fields, shown after its main ones. */
function more(_used: boolean, ...controls: HTMLElement[]): HTMLElement {
  return moreFields("", ...controls);
}
/** One tab of the form: its title, its help line, and whether it holds settings (its tab's dot). */
function section(
  id: string,
  title: string,
  help: string,
  used: boolean,
  ...children: HTMLElement[]
): HTMLElement {
  const sec = document.createElement("section");
  sec.className = "balance-row items-group";
  sec.dataset.group = id;
  sec.dataset.used = String(used);
  const h = document.createElement("h3");
  h.className = "balance-row-title";
  h.textContent = title;
  sec.append(h);
  if (help) {
    sec.append(intro(help));
  }
  sec.append(...children);
  return sec;
}

export function createGatheringPage(actions: GatheringPageActions, assets?: Assets): GatheringPage {
  const el = document.createElement("div");
  el.className = "gathering-page items-page balance-page plain-editor";
  el.append(
    pageHeading(
      "Gathering",
      "Choose what players can harvest with tools, and how fishing and farming work. Saving puts your changes with the other unpublished changes: players get them once you publish them on the Publish Changes page.",
    ),
  );
  const draftLine = document.createElement("div");
  draftLine.className = "balance-draft";
  draftLine.hidden = true;
  const draftText = document.createElement("span");
  const discardAll = panelButton(
    "gathering-discard",
    "Cancel unpublished gathering changes",
    () => {
      if (view) {
        send({ op: "discard", expect: view.fingerprint }, "discard");
      }
    },
  );
  draftLine.append(
    draftText,
    panelButton("gathering-open-content", "Review and publish…", () => actions.openContent()),
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
  const listHead = (text: string) => {
    const p = document.createElement("p");
    p.className = "items-list-title gathering-list-title";
    p.textContent = text;
    return p;
  };
  const listEl = document.createElement("ul");
  listEl.className = "items-list";
  listEl.setAttribute("aria-label", "Harvestable tiles");
  const newBtn = panelButton("gathering-new-node", "+ New harvestable tile", () => {
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
    status.textContent = "";
    drawList();
    drawNode();
  });
  const fixedEl = document.createElement("ul");
  fixedEl.className = "items-list";
  fixedEl.setAttribute("aria-label", "Other activities");
  const fixedItem = (p: "fishing" | "farming" | "counter", name: string, meta: string) => {
    const li = document.createElement("li");
    const b = action(document.createElement("button"), `gathering-open-${p}`);
    b.type = "button";
    b.className = "items-list-item";
    b.dataset.part = p;
    const n = document.createElement("span");
    n.textContent = name;
    const m = document.createElement("span");
    m.className = "items-list-meta";
    m.textContent = meta;
    b.append(n, " ", m);
    b.addEventListener("click", () => openFixed(p));
    li.append(b);
    return li;
  };
  fixedEl.append(
    fixedItem("fishing", "Fishing", "water, catches and bites"),
    fixedItem("farming", "Farming", "seeds, watering and crops"),
    fixedItem("counter", "Swings per harvest", "by skill, for every tile"),
  );
  listBox.append(
    newBtn,
    listHead("Harvestable tiles"),
    listEl,
    listHead("Other activities"),
    fixedEl,
  );

  // ---- the form ----
  const form = document.createElement("section");
  form.className = "items-form";
  form.hidden = true;
  const header = document.createElement("div");
  header.className = "items-form-head";
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const subtitle = document.createElement("p");
  subtitle.className = "control-panel-field-help items-form-id";
  const tags = document.createElement("div");
  tags.className = "balance-tags";
  header.append(title, subtitle, tags);
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this while you were editing it, so saving will be refused. Undo your changes to see theirs.";
  const body = document.createElement("div");
  const status = statusLine();
  const saveBtn = panelButton(
    "gathering-save",
    "Save changes",
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
  const undoBtn = panelButton("gathering-undo-edit", "Undo changes", () => {
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
    "Remove this harvestable tile",
    () => {
      if (part === "node" && openIndex >= 0) {
        send({ op: "removeNode", index: openIndex, expect: filled.fingerprint }, "node");
      }
    },
    "danger",
  );
  const revertBtn = panelButton("gathering-revert", "Restore the original", () => {
    const pack = packOf();
    if (!view || !pack || part === null) {
      return;
    }
    if (part === "node") {
      const n = view.nodes[openIndex];
      if (!n) {
        return;
      }
      const original = pack.value as NodeWork;
      send(
        {
          op: "node",
          index: openIndex,
          data: nodePayload(structuredClone(original), {
            edited: original.yieldTable !== null,
            expect:
              original.node.yield !== undefined
                ? (view.yieldFingerprints[original.node.yield] ?? null)
                : null,
          }),
          expect: n.fingerprint,
        },
        "node",
      );
    } else {
      const fp =
        part === "counter"
          ? view.counter.fingerprint
          : part === "fishing"
            ? view.fishing.fingerprint
            : view.farming.fingerprint;
      send({ op: part, data: structuredClone(pack.value), expect: fp }, part);
    }
  });
  revertBtn.title = "Puts it back to what the pack plays, as an unpublished change.";
  const mainButtons = document.createElement("div");
  mainButtons.className = "content-buttons";
  mainButtons.append(saveBtn, undoBtn);
  const otherButtons = document.createElement("div");
  otherButtons.className = "content-buttons items-reset-buttons";
  otherButtons.append(revertBtn, removeBtn);
  const buttons = document.createElement("div");
  buttons.className = "items-actions";
  buttons.append(mainButtons, otherButtons);
  form.append(header, stale, sectionTabs(form, "gathering").el, body, formActions(buttons, status));
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  const empty = document.createElement("p");
  empty.className = "items-empty-form";
  empty.textContent =
    "Pick a harvestable tile or an activity on the left to see and change how it works.";
  const layout = document.createElement("div");
  layout.className = "items-layout";
  layout.append(listBox, empty, form);
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
      say(status, "Save or undo your changes first.", false);
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
    // As on the other editor pages, Undo shows only once there is something to undo.
    undoBtn.hidden = !(d || (part === "node" && openIndex === -1));
    undoBtn.disabled = busy;
    removeBtn.hidden = !(part === "node" && openIndex >= 0);
    removeBtn.disabled = busy;
    const original = packOf();
    revertBtn.hidden = !(original && original.differs);
    revertBtn.disabled = busy;
    otherButtons.hidden = removeBtn.hidden && revertBtn.hidden;
    drawTags();
    discardAll.hidden = !view?.pending;
    empty.hidden = !form.hidden || !view;
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
    markRestores();
    update();
    drawPreview();
  };

  /**
   * What the pack plays for the part open (a node: its node, yield table and regrowth), and
   * whether the draft differs from it; null for a node of the operator's own or nothing open.
   */
  const packOf = (): { value: unknown; differs: boolean } | null => {
    if (!view || part === null) {
      return null;
    }
    if (part === "node") {
      const n = view.nodes[openIndex];
      return n?.pack
        ? {
            value: { node: n.pack.node, yieldTable: n.pack.yield, regrows: n.pack.regrows },
            differs: n.differs === true,
          }
        : null;
    }
    const p = view[part];
    return p.pack === undefined ? null : { value: p.pack, differs: p.differs === true };
  };
  /** A field of the form (`@x`: the node form's own; `*`: the whole part), from `from`. */
  const fieldOf = (from: unknown, key: string): unknown => {
    if (key === "*") {
      return from;
    }
    const o = from as Record<string, unknown> | null;
    if (part === "node") {
      return key.startsWith("@") ? o?.[key.slice(1)] : (o?.node as Record<string, unknown>)?.[key];
    }
    return o?.[key];
  };
  const drawTags = () => {
    const t: [string, string][] = [];
    const original = packOf();
    if (part === "node" && openIndex === -1) {
      t.push(["New: not saved yet", "pending"]);
    } else if (part !== null && view) {
      const own =
        part === "node"
          ? !original
          : original !== null && original.value === null && fixedWork !== null;
      t.push(
        own
          ? ["Added by you", "changed"]
          : original?.differs
            ? ["Changed by you", "changed"]
            : ["Original", "original"],
      );
    }
    tags.replaceChildren(
      ...t.map(([x, kind]) => {
        const s = document.createElement("span");
        s.className = `balance-tag items-tag-${kind}`;
        s.textContent = x;
        return s;
      }),
    );
  };
  /** Adds "Restore this tab to the original" to each tab that has fields the pack sets. */
  const addRestores = () => {
    const original = packOf();
    const fields = TAB_FIELDS[part ?? ""] ?? {};
    if (!original || part === null) {
      return;
    }
    for (const sec of body.querySelectorAll<HTMLElement>(":scope > .items-group")) {
      const id = sec.dataset.group ?? "";
      const keys = fields[id];
      if (!keys) {
        continue;
      }
      const foot = document.createElement("div");
      foot.className = "items-group-foot";
      const restore = panelButton(
        `gathering-pack-${id}`,
        "Restore this tab to the original",
        () => {
          const from = original.value;
          if (part === "node") {
            for (const k of keys) {
              const v = structuredClone(fieldOf(from, k));
              if (k === "@regrows") {
                work.regrows = (v as string | null) ?? null;
              } else if (k === "@yieldTable") {
                work.yieldTable = (v as YieldTable | null) ?? null;
                const name = (from as NodeWork).node.yield;
                yieldEdit = {
                  edited: work.yieldTable !== null,
                  expect: name !== undefined ? (view?.yieldFingerprints[name] ?? null) : null,
                };
              } else if (v === undefined) {
                delete (work.node as Record<string, unknown>)[k];
              } else {
                (work.node as Record<string, unknown>)[k] = v;
              }
            }
            invalid.clear();
            drawNode();
          } else {
            if (keys.includes("*") || fixedWork === null || from === null) {
              fixedWork = structuredClone(from);
            } else {
              for (const k of keys) {
                (fixedWork as Record<string, unknown>)[k] = structuredClone(fieldOf(from, k));
              }
            }
            invalid.clear();
            drawFixed();
          }
          edited();
        },
      );
      restore.classList.add("items-restore");
      foot.append(document.createElement("span"), restore);
      sec.append(foot);
    }
    markRestores();
  };
  /** Shows each tab's restore only where the form differs from the pack. */
  const markRestores = () => {
    const original = packOf();
    const fields = TAB_FIELDS[part ?? ""] ?? {};
    const now = part === "node" ? work : fixedWork;
    for (const b of body.querySelectorAll<HTMLButtonElement>(
      ":scope > .items-group > .items-group-foot > .items-restore",
    )) {
      const id = b.closest<HTMLElement>(".items-group")?.dataset.group ?? "";
      b.hidden =
        !original ||
        (fields[id] ?? []).every(
          (k) => canonical(fieldOf(now, k)) === canonical(fieldOf(original.value, k)),
        );
    }
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
  /** A whole-number input; `offset` is added for show (a "from skill" of an "above" row). */
  const int = (
    idName: string,
    value: number | null | undefined,
    min: number,
    max: number,
    nullable: boolean,
    label: string,
    write: (n: number | null) => void,
    offset = 0,
  ) => {
    const input = noAutofill(action(document.createElement("input"), idName));
    input.type = "number";
    input.min = String(min + offset);
    input.max = String(max + offset);
    input.value = value === null || value === undefined ? "" : String(value + offset);
    input.addEventListener("input", () => {
      const t = input.value.trim();
      if (t === "" && nullable) {
        invalid.delete(input);
        write(null);
      } else if (!/^-?\d+$/.test(t) || Number(t) - offset < min || Number(t) - offset > max) {
        invalid.set(input, `${label}: a whole number from ${min + offset} to ${max + offset}`);
      } else {
        invalid.delete(input);
        write(Number(t) - offset);
      }
      edited();
    });
    return input;
  };
  /** A number input that takes up to two decimal places (a percent such as 0.5). */
  const decimal = (
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
    input.step = "any";
    input.min = String(min);
    input.max = String(max);
    input.value = value === null || value === undefined ? "" : String(value);
    input.addEventListener("input", () => {
      const t = input.value.trim();
      if (t === "" && nullable) {
        invalid.delete(input);
        write(null);
      } else if (!/^\d+(\.\d{1,2})?$/.test(t) || Number(t) < min || Number(t) > max) {
        invalid.set(input, `${label}: a number from ${min} to ${max}, at most two decimal places`);
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
  /** Two-letter tile codes typed comma-separated; null (and an error) when one does not read. */
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
  /**
   * A list of rows, each a line of whole-number and text fields with a Remove button, and an Add
   * button. A field with `offset` shows its number moved by it ("from skill 11" for "above 10").
   */
  const rowsEditor = <T extends Record<string, unknown>>(
    idPrefix: string,
    label: string,
    help: string,
    addText: string,
    rows: T[],
    fields: readonly {
      key: keyof T & string;
      label: string;
      /** `names`: item names, comma-separated, kept as a list (left out when empty). */
      kind: "int" | "decimal" | "text" | "names";
      list?: string;
      offset?: number;
      min?: number;
      max?: number;
      /** An int that may be left empty (the key is then left out), showing this placeholder. */
      optional?: string;
    }[],
    blank: () => T,
    /** Runs on every change, before the page's own (a row added, removed or typed in). */
    changed: () => void = () => {},
  ): HTMLElement => {
    const box = document.createElement("div");
    box.className = "items-list-editor";
    box.dataset.list = idPrefix;
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
              f.kind === "decimal"
                ? decimal(
                    `${idPrefix}-${f.key}`,
                    row[f.key] as number | undefined,
                    f.min ?? 0,
                    f.max ?? 100,
                    false,
                    `${label}, row ${i + 1}: ${f.label}`,
                    (n) => {
                      (row as Record<string, unknown>)[f.key] = n ?? 0;
                      changed();
                    },
                  )
                : f.kind === "names"
                  ? text(
                      `${idPrefix}-${f.key}`,
                      ((row[f.key] as string[] | undefined) ?? []).join(", "),
                      (t) => {
                        const parts = t
                          .split(",")
                          .map((x) => x.trim())
                          .filter((x) => x !== "");
                        if (parts.length === 0) {
                          delete (row as Record<string, unknown>)[f.key];
                        } else {
                          (row as Record<string, unknown>)[f.key] = parts;
                        }
                        changed();
                      },
                    )
                  : f.kind === "int"
                    ? int(
                        `${idPrefix}-${f.key}`,
                        row[f.key] as number | undefined,
                        f.min ?? -1_000_000,
                        f.max ?? 1_000_000_000,
                        f.optional !== undefined,
                        `${label}, row ${i + 1}: ${f.label}`,
                        (n) => {
                          if (n === null && f.optional !== undefined) {
                            delete (row as Record<string, unknown>)[f.key];
                          } else {
                            (row as Record<string, unknown>)[f.key] = n ?? 0;
                          }
                          changed();
                        },
                        f.offset ?? 0,
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
            if (f.optional !== undefined) {
              control.placeholder = f.optional;
            }
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
      if (rows.length === 0) {
        listBox2.append(helpLine("None yet."));
      }
    };
    draw();
    box.append(h);
    if (help) {
      box.append(helpLine(help));
    }
    const add = panelButton(`${idPrefix}-add`, addText, () => {
      rows.push(blank());
      changed();
      draw();
      edited();
    });
    add.classList.add("items-add");
    box.append(listBox2, add);
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
  const effectsList = document.createElement("datalist");
  effectsList.id = "gathering-effects";
  el.append(tilesList, itemsList, soundsList, yieldsList, effectsList);

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
  /** A tile as the page names it: "Tree (S3)", or its code alone when it has no name. */
  const tileText = (code: string) => {
    const n = tileName(code);
    return code === "" ? "" : n ? `${n} (${code})` : code;
  };
  const skillName = (key: string) =>
    view?.skills.find((s) => s.skill.toLowerCase() === key.toLowerCase())?.display ?? key;

  // ---- the odds ----
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
        catches: FishCatch[];
        fishCheck: { gt: number; value: number }[];
      };
      table.setAttribute("aria-label", "Fishing by skill");
      head.append(
        cell("th", "Fishing skill"),
        cell("th", "Bite chance per cast"),
        cell("th", "Catches"),
      );
      // A fish's share of the catches, and its own XP when it gives one.
      const catchText = (c: { fish: string; share: number; xp?: number | undefined }) =>
        `${c.fish}${c.share < 1 ? ` ${Number((c.share * 100).toFixed(1))}%` : ""}${c.xp === undefined ? "" : ` (${c.xp} XP)`}`;
      const fish = fishingPreview(f, ALL_SKILLS);
      for (const { from, to, cells: r } of foldRows(
        ALL_SKILLS,
        (v) => fish[v] as (typeof fish)[number],
        (r) => `${r.bite}|${r.catches.map(catchText).join(";")}`,
      )) {
        const tr = document.createElement("tr");
        tr.append(
          cell("td", from === to ? String(from) : `${from}-${to}`),
          cell("td", chanceText(r.bite)),
          cell("td", r.catches.length === 0 ? "nothing" : r.catches.map(catchText).join("; ")),
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
      table.setAttribute("aria-label", "Odds by skill and tool tier");
      const lasts =
        (node.depletes ?? 1) > 1
          ? `Each tile gives ${node.depletes} harvests on average before it turns into ${tileText(node.becomes) || node.becomes}.`
          : `Every harvest turns the tile into ${tileText(node.becomes) || node.becomes}.`;
      const back =
        node.respawn !== undefined
          ? ` It comes back ${waitText(node.respawn * TICK_HZ)} later.`
          : "";
      preview.append(helpLine(lasts + back));
      head.append(
        cell("th", "Tools"),
        cell("th", node.skill ? `${skillName(node.skill)} skill` : "Skill"),
        cell("th", "Swings per harvest"),
        cell("th", "Harvest chance per swing"),
        cell("th", "Drop chance per harvest"),
        cell("th", "Drops per swing"),
        cell("th", skill?.model === "xp" ? "XP per harvest" : "Trains the skill"),
      );
      if (shownTiers.length === 0) {
        const tr = document.createElement("tr");
        const td = cell(
          "td",
          "No tool can work it: no tool with this tool action matches the tools it names.",
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
              ? `${Number(xpRow.perAction.toFixed(2))}${xpRow.estimate ? " (average)" : ""}`
              : "0"
            : node.gains && skill?.gather
              ? "yes, by chance"
              : "no";
          return c.why
            ? [c.why, "—", "—", "—", "—", "—"]
            : [
                c.hits === null
                  ? "never"
                  : c.byChance
                    ? `about ${Number(c.hits.toFixed(1))}`
                    : String(c.hits),
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

  // ---- a harvestable tile's form ----
  const drawNode = () => {
    if (!view) {
      return;
    }
    part = "node";
    form.hidden = false;
    const n = work.node;
    const named = tileName(n.tile);
    title.textContent =
      openIndex === -1 ? "New harvestable tile" : `${n.can} ${named || `tile ${n.tile}`}`;
    subtitle.textContent = openIndex === -1 ? "" : `Node ${openIndex + 1} · tile ${n.tile}`;

    // Tile.
    const pictureRow = document.createElement("div");
    pictureRow.className = "gathering-picture";
    const fromName = document.createElement("span");
    const toName = document.createElement("span");
    const drawPictures = () => {
      fromName.textContent = tileText(n.tile) || "(no tile yet)";
      toName.textContent = tileText(n.becomes) || "(no tile yet)";
      pictureRow.replaceChildren(
        tilePicture(n.tile),
        fromName,
        " turns into ",
        tilePicture(n.becomes),
        toName,
      );
    };
    drawPictures();
    const regrows = action(document.createElement("select"), "gathering-regrows");
    regrows.append(option("", "Never: it stays as it is"));
    // A produce check drops farming produce: a node's tile never regrows there.
    for (const c of view.regrowth.checks.filter((x) => !x.produce)) {
      regrows.append(option(c.handler, regrowthText(c, view.regrowth.roll, view.regrowth.tiles)));
    }
    regrows.value = work.regrows ?? "";
    regrows.addEventListener("change", () => {
      work.regrows = regrows.value || null;
      edited();
    });
    const underInput = noAutofill(action(document.createElement("input"), "gathering-under"));
    const readUnder = codes(n.under, "Only on this ground", underInput);
    underInput.placeholder = "Any ground";
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
    const tileTab = section(
      "tile",
      "Tile",
      "The tile players work with a tool, and what it turns into once harvested.",
      n.under !== undefined || work.regrows !== null,
      pictureRow,
      labelled(
        "Tile",
        text(
          "gathering-tile",
          n.tile,
          (t) => {
            n.tile = t;
            drawPictures();
          },
          tilesList.id,
        ),
        "Its two-letter code on the map's object layer, such as S3.",
      ),
      labelled(
        "Turns into",
        text(
          "gathering-becomes",
          n.becomes,
          (t) => {
            n.becomes = t;
            drawPictures();
          },
          tilesList.id,
        ),
        "The tile it becomes after a harvest, such as a stump.",
      ),
      labelled(
        "Grows back",
        regrows,
        "Whether the harvested tile turns back into this one by itself, and about how long that takes.",
      ),
      more(
        n.under !== undefined,
        labelled(
          "Only on this ground",
          underInput,
          "Ground tile codes it must stand on, comma-separated, such as G1, G2. Empty: any ground.",
        ),
      ),
    );

    // Tool.
    const can = action(document.createElement("select"), "gathering-can");
    for (const c of view.choices.cans) {
      can.append(option(c, CAN_TEXT[c] ?? c));
    }
    can.value = n.can;
    const toolsHelp = document.createElement("p");
    const drawToolsHelp = () => {
      const tools = view?.tools.filter((t) => t.can === n.can) ?? [];
      toolsHelp.textContent = `Tools that can ${n.can.toLowerCase()} now: ${
        tools
          .map(
            (t) =>
              `${t.match === "exact" ? t.pattern : `anything named like “${t.pattern}”`} (tier ${t.tier})`,
          )
          .join(", ") || "none"
      }.`;
    };
    drawToolsHelp();
    can.addEventListener("change", () => {
      n.can = can.value as HarvestNode["can"];
      drawToolsHelp();
      toolsInput.placeholder = `Any tool that can ${n.can.toLowerCase()}`;
      edited();
    });
    const toolsInput = noAutofill(action(document.createElement("input"), "gathering-tools"));
    toolsInput.value = (n.tools ?? []).join(", ");
    toolsInput.placeholder = `Any tool that can ${n.can.toLowerCase()}`;
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
    const tierInput = int(
      "gathering-tier",
      n.tier ?? null,
      1,
      1000,
      true,
      "Lowest tool tier",
      (v) => {
        if (v === null) {
          delete n.tier;
        } else {
          n.tier = v;
        }
      },
    );
    tierInput.placeholder = "1";
    const toolTab = section(
      "tool",
      "Tool",
      "Which tools can harvest it.",
      n.tools !== undefined || n.tier !== undefined,
      labelled("Tool action", can, toolsHelp),
      more(
        n.tools !== undefined || n.tier !== undefined,
        labelled(
          "Only these tools",
          toolsInput,
          "Item names, comma-separated, for a tile only special tools can work. Empty: any tool with the tool action.",
        ),
        labelled(
          "Lowest tool tier",
          tierInput,
          "Players with a lower-tier tool are told they need a better one. Empty: any tier.",
        ),
      ),
    );

    // Skill.
    const skill = action(document.createElement("select"), "gathering-skill");
    for (const s of view.skills) {
      skill.append(option(s.skill, s.display));
    }
    skill.value = n.skill;
    skill.addEventListener("change", () => {
      n.skill = skill.value;
      edited();
    });
    const reqBox = document.createElement("div");
    reqBox.className = "gathering-requirement";
    const drawReq = () => {
      reqBox.replaceChildren(
        check(
          "gathering-requires-on",
          !!n.requires,
          "Players need a skill, a level or a class before they can harvest it",
          (on) => {
            if (on) {
              n.requires = { needs: n.skill || "level", atLeast: 1 };
            } else {
              delete n.requires;
            }
            drawReq();
          },
        ),
      );
      if (n.requires) {
        const r = n.requires;
        const needs = action(document.createElement("select"), "gathering-requires-needs");
        needs.append(option("level", "Character level"));
        // A class (issue #15): the classes that may, ticked below.
        needs.append(option("class", "A class"));
        for (const s of view?.skills ?? []) {
          needs.append(option(s.skill, s.display));
        }
        needs.value = r.needs;
        needs.addEventListener("change", () => {
          r.needs = needs.value;
          edited();
          drawReq();
        });
        const row = document.createElement("div");
        row.className = "items-list-row";
        if (r.needs === "class") {
          const boxes = document.createElement("div");
          boxes.className = "gathering-classes";
          for (const k of content().classes.classes) {
            boxes.append(
              check(
                `gathering-requires-class-${k.code}`,
                (r.classes ?? []).includes(k.code),
                k.name,
                (on) => {
                  const now = new Set(r.classes ?? []);
                  if (on) {
                    now.add(k.code);
                  } else {
                    now.delete(k.code);
                  }
                  if (now.size > 0) {
                    r.classes = [...now].sort((a, b) => a - b);
                  } else {
                    delete r.classes;
                  }
                },
              ),
            );
          }
          row.append(labelled("Needs", needs), labelled("Classes", boxes));
        } else {
          row.append(
            labelled("Needs", needs),
            labelled(
              "At least",
              int(
                "gathering-requires-at",
                r.atLeast,
                0,
                1_000_000,
                false,
                "Needs at least",
                (v) => {
                  r.atLeast = v ?? 0;
                },
              ),
            ),
          );
        }
        reqBox.append(
          row,
          labelled(
            "Message when they can't",
            text("gathering-requires-text", r.text ?? "", (t) => {
              if (t === "") {
                delete r.text;
              } else {
                r.text = t;
              }
            }),
            "Empty: “You need <skill> <number> to <action> this.”",
          ),
        );
      }
    };
    drawReq();
    const xpInput = int(
      "gathering-xp",
      n.xp ?? null,
      0,
      1_000_000_000,
      true,
      "XP per harvest",
      (v) => {
        if (v === null) {
          delete n.xp;
        } else {
          n.xp = v;
        }
      },
    );
    xpInput.placeholder = "The skill's own amount";
    const skillTab = section(
      "skill",
      "Skill",
      "The skill that decides how many swings a harvest takes, and that harvesting trains.",
      n.requires !== undefined || n.xp !== undefined || !n.gains,
      labelled("Skill", skill),
      panelButton("gathering-open-skill", "Open this skill on the Skills page", () =>
        actions.openSkill(n.skill),
      ),
      check("gathering-gains", n.gains, "Each harvest trains the skill", (on) => {
        n.gains = on;
      }),
      reqBox,
      more(
        n.xp !== undefined,
        labelled(
          "XP per harvest",
          xpInput,
          "Only for skills that level up by XP. Empty: the skill's own amount for gathering.",
        ),
      ),
    );

    // Harvesting: how a swing harvests, how long the tile lasts, and when it comes back.
    const how = action(document.createElement("select"), "gathering-how");
    how.append(
      option("swings", "After a set number of swings (Swings per harvest)"),
      option("odds", "By a chance on every swing, better with skill"),
    );
    how.value = n.odds ? "odds" : "swings";
    const oddsBox = document.createElement("div");
    const drawOdds = () => {
      oddsBox.replaceChildren();
      if (!n.odds) {
        oddsBox.append(
          helpLine(
            "Each swing counts down the tool's swings; the swing that reaches 0 harvests. How many swings a harvest takes at each skill value is set once for every tile, on Swings per harvest in the list.",
          ),
        );
        return;
      }
      const points = n.odds;
      const bonus = decimal(
        "gathering-tier-bonus",
        n.tierBonus ?? null,
        0,
        100,
        true,
        "Better tools add",
        (v) => {
          if (v === null) {
            delete n.tierBonus;
          } else {
            n.tierBonus = v;
          }
        },
      );
      bonus.placeholder = "Nothing";
      oddsBox.append(
        rowsEditor(
          "gathering-odds",
          "Chance each swing harvests",
          "The chance at a few skill levels, in percent. Between two levels it rises in a straight line; below the first and past the last it stays the same. List the levels going up.",
          "+ Add a level",
          points,
          [
            { key: "level", label: "At skill", kind: "int", min: 0, max: 100 },
            { key: "percent", label: "Chance %", kind: "decimal", min: 0, max: 100 },
          ],
          () => ({ level: Math.min(100, (points.at(-1)?.level ?? 0) + 10), percent: 100 }),
        ),
        labelled(
          "Better tools add (% per tier)",
          bonus,
          "Added to the chance for each tier the tool is above the lowest tier this tile takes, so a better axe chops faster. Empty: tools make no difference.",
        ),
      );
    };
    drawOdds();
    how.addEventListener("change", () => {
      if (how.value === "odds") {
        // A start to change: a quarter of swings at the tile's required level, nearly all at 99.
        const from = n.requires && n.requires.needs !== "level" ? n.requires.atLeast : 1;
        n.odds = [
          { level: Math.min(from, 98), percent: 25 },
          { level: 99, percent: 90 },
        ];
      } else {
        delete n.odds;
        delete n.tierBonus;
      }
      drawOdds();
      edited();
    });
    const depletesInput = int(
      "gathering-depletes",
      n.depletes ?? null,
      1,
      1_000_000,
      true,
      "Used up 1 time in",
      (v) => {
        if (v === null || v === 1) {
          delete n.depletes;
        } else {
          n.depletes = v;
        }
      },
    );
    depletesInput.placeholder = "1: every harvest";
    const respawnInput = int(
      "gathering-respawn",
      n.respawn ?? null,
      1,
      604_800,
      true,
      "Comes back after",
      (v) => {
        if (v === null) {
          delete n.respawn;
        } else {
          n.respawn = v;
        }
      },
    );
    respawnInput.placeholder = "Only as it grows back";
    const harvestTab = section(
      "harvest",
      "Harvesting",
      "How a swing harvests, how many harvests the tile gives before it is used up, and when it comes back. Leave these as they are for the classic game; use chances, lasting tiles and timers for harvests that get likelier with skill and tiles that come back on a timer.",
      n.odds !== undefined || n.depletes !== undefined || n.respawn !== undefined,
      labelled("A swing harvests", how),
      oddsBox,
      labelled(
        "Used up 1 time in … harvests",
        depletesInput,
        "1 (or empty): every harvest turns the tile. 8: on average it gives 8 harvests before it turns, as an oak gives several logs.",
      ),
      labelled(
        "Comes back after (seconds)",
        respawnInput,
        "Once used up, the tile turns back this many seconds later (60 is a minute), whether or not anyone is there. Empty: only “Grows back” on the Tile tab brings it back.",
      ),
    );

    // Drops.
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
      name.placeholder = "Nothing";
      const fields = document.createElement("div");
      const drawYieldFields = () => {
        fields.replaceChildren();
        const t = work.yieldTable;
        if (!t || !n.yield) {
          return;
        }
        const shared = openIndex >= 0 ? (view?.nodes[openIndex]?.yieldSharedWith ?? []) : [];
        if (shared.length > 0) {
          const others = shared
            .map((i) => {
              const o = view?.nodes[i]?.node;
              return o ? `${o.can} ${tileName(o.tile) || `tile ${o.tile}`}` : `node ${i + 1}`;
            })
            .join(", ");
          fields.append(
            helpLine(
              `${others} ${shared.length === 1 ? "uses" : "use"} this drop table too: a change here changes theirs.`,
            ),
          );
        }
        if (t.kind === "ore") {
          fields.append(
            helpLine("A mining strike: crystals and ores, from the world's mining tables."),
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
            "Item it drops",
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
            "Chance per harvest: 1 in",
            int(
              "gathering-yield-chance",
              t.chance,
              1,
              1_000_000_000,
              false,
              "Chance per harvest",
              (v) => {
                t.chance = v ?? 1;
                yieldEdit.edited = true;
              },
            ),
            "1 means every harvest drops it; 3 means one harvest in three, on average.",
          ),
          rowsEditor(
            "gathering-yield-by",
            "Better odds with more skill",
            "From each skill value on, the chance is 1 in this instead. The last row the skill reaches wins.",
            "+ Add a skill row",
            by,
            [
              { key: "gt", label: "From skill", kind: "int", offset: 1 },
              { key: "value", label: "1 in", kind: "int", min: 1 },
            ],
            () => ({ gt: 0, value: 1 }),
            yieldChanged,
          ),
        );
      };
      drawYieldFields();
      yieldBox.append(
        labelled(
          "Drop table",
          name,
          "The name of the table a harvest rolls. Several tiles can share one. Empty: it drops nothing.",
        ),
        fields,
      );
    };
    drawYield();
    const dropsTab = section(
      "drops",
      "Drops",
      "What a harvest gives the player.",
      n.yield !== undefined || n.treasure === true,
      yieldBox,
      check(
        "gathering-treasure",
        n.treasure === true,
        "A harvest can dig up the buried treasure",
        (on) => {
          if (on) {
            n.treasure = true;
          } else {
            delete n.treasure;
          }
        },
      ),
    );

    // Sounds.
    const sound = (key: "hitSound" | "successSound", label: string, help: string) =>
      labelled(
        label,
        Object.assign(
          text(
            `gathering-${key}`,
            n[key]?.name ?? "",
            (t) => {
              n[key] =
                t === "" ? null : { name: t, ch: n[key]?.ch ?? (key === "hitSound" ? 3 : 2) };
              drawChannels();
            },
            soundsList.id,
          ),
          { placeholder: "None" },
        ),
        help,
      );
    const channels = document.createElement("div");
    const drawChannels = () => {
      channels.replaceChildren(
        ...(["hitSound", "successSound"] as const)
          .filter((key) => n[key] !== null)
          .map((key) =>
            labelled(
              key === "hitSound" ? "Swing sound channel" : "Harvest sound channel",
              int(
                `gathering-${key}-ch`,
                n[key]?.ch ?? null,
                1,
                8,
                false,
                key === "hitSound" ? "Swing sound channel" : "Harvest sound channel",
                (c) => {
                  const cur = n[key];
                  if (cur) {
                    cur.ch = c ?? 1;
                  }
                },
              ),
            ),
          ),
      );
      if (channels.childElementCount === 0) {
        channels.append(helpLine("Pick a sound first."));
      } else {
        channels.append(
          helpLine(
            "Sound channels 1 to 8. Leave them as they are unless sounds cut each other off.",
          ),
        );
      }
    };
    drawChannels();
    // The strike effect (issue #41).
    const strikeFrames = document.createElement("div");
    const drawStrikeFrames = () => {
      strikeFrames.replaceChildren(
        ...(n.strikeFx
          ? [
              labelled(
                "Frames shown",
                int(
                  "gathering-strike-frames",
                  n.strikeFx.frames,
                  1,
                  99,
                  false,
                  "Frames shown",
                  (c) => {
                    if (n.strikeFx) {
                      n.strikeFx.frames = c ?? 1;
                    }
                  },
                ),
                "How many of the effect's frames play, from frame 1. Upload its pictures on Effects.",
              ),
            ]
          : []),
      );
    };
    drawStrikeFrames();
    const strike = labelled(
      "Strike effect",
      Object.assign(
        text(
          "gathering-strike-fx",
          n.strikeFx?.fx ?? "",
          (t) => {
            const had = n.strikeFx !== undefined;
            if (t === "") {
              delete n.strikeFx;
            } else {
              n.strikeFx = { fx: t, frames: n.strikeFx?.frames ?? 12 };
            }
            if (had !== (n.strikeFx !== undefined)) {
              drawStrikeFrames();
            }
          },
          effectsList.id,
        ),
        { placeholder: "None" },
      ),
      "Plays on the tile at every swing that strikes it, and everyone nearby sees it.",
    );
    const soundsTab = section(
      "sounds",
      "Sounds and effect",
      "What players hear and see while harvesting it.",
      n.hitSound !== null || n.successSound !== null || n.strikeFx !== undefined,
      sound(
        "hitSound",
        "Swing sound",
        "Plays on every swing at this tile, instead of the tool's usual sound.",
      ),
      sound("successSound", "Harvest sound", "Plays to the player when a harvest succeeds."),
      strike,
      strikeFrames,
      more(false, channels),
    );

    // Odds.
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
    const oddsTab = section(
      "odds",
      "Odds",
      "How harvesting this tile plays at each skill value, worked out by the game's own rules from the form as it is now (before you save).",
      false,
      labelled("Show tools of", tierSel),
      preview,
    );

    body.replaceChildren(tileTab, toolTab, skillTab, harvestTab, dropsTab, soundsTab, oddsTab);
    addRestores();
    drawPreview();
    update();
  };

  // ---- fishing, farming and the swings a harvest takes ----

  /** Fishing's cast: the splash every map shows, where it lands, and the sound everyone hears. */
  const castSection = (f: Record<string, unknown>) => {
    type Run = { fx: string; frames: number } | null;
    type Snd = { name: string; ch: number } | null;
    const frames = document.createElement("div");
    const drawFrames = () => {
      const run = f.castFx as Run;
      frames.replaceChildren(
        ...(run
          ? [
              labelled(
                "Frames shown",
                int("gathering-cast-frames", run.frames, 1, 99, false, "Frames shown", (c) => {
                  const now = f.castFx as Run;
                  if (now) {
                    now.frames = c ?? 1;
                  }
                }),
                "How many of the effect's frames play, from frame 1. Upload its pictures on Effects.",
              ),
            ]
          : []),
      );
    };
    drawFrames();
    const effect = labelled(
      "Splash effect",
      Object.assign(
        text(
          "gathering-cast-fx",
          (f.castFx as Run)?.fx ?? "",
          (t) => {
            const had = f.castFx !== null;
            f.castFx = t === "" ? null : { fx: t, frames: (f.castFx as Run)?.frames ?? 13 };
            if (had !== (f.castFx !== null)) {
              drawFrames();
            }
          },
          effectsList.id,
        ),
        { placeholder: "None" },
      ),
      "Plays on the water at every cast, and everyone nearby sees it.",
    );
    const channel = document.createElement("div");
    const drawChannel = () => {
      const snd = f.castSound as Snd;
      channel.replaceChildren(
        snd
          ? labelled(
              "Cast sound channel",
              int("gathering-cast-sound-ch", snd.ch, 1, 8, false, "Cast sound channel", (c) => {
                const now = f.castSound as Snd;
                if (now) {
                  now.ch = c ?? 1;
                }
              }),
              "Sound channels 1 to 8. Leave it as it is unless sounds cut each other off.",
            )
          : helpLine("Pick a sound first."),
      );
    };
    drawChannel();
    const castSound = labelled(
      "Cast sound",
      Object.assign(
        text(
          "gathering-cast-sound",
          (f.castSound as Snd)?.name ?? "",
          (t) => {
            const had = f.castSound !== null;
            f.castSound = t === "" ? null : { name: t, ch: (f.castSound as Snd)?.ch ?? 4 };
            if (had !== (f.castSound !== null)) {
              drawChannel();
            }
          },
          soundsList.id,
        ),
        { placeholder: "None" },
      ),
      "Everyone nearby hears it at every cast.",
    );
    // Where the splash lands, from the fisher, for each way they face.
    const offsets = f.fxOffsets as Record<"N" | "S" | "E" | "W", [number, number]>;
    const facing = (k: "N" | "S" | "E" | "W", word: string) => {
      const row = document.createElement("div");
      row.className = "items-list-row";
      const pair = offsets[k] ?? [0, 0];
      offsets[k] = pair;
      const across = int(
        `gathering-cast-offset-${k.toLowerCase()}-x`,
        pair[0],
        -200,
        200,
        false,
        `Facing ${word}: pixels right`,
        (v) => {
          pair[0] = v ?? 0;
        },
      );
      const down = int(
        `gathering-cast-offset-${k.toLowerCase()}-y`,
        pair[1],
        -200,
        200,
        false,
        `Facing ${word}: pixels down`,
        (v) => {
          pair[1] = v ?? 0;
        },
      );
      row.append(
        labelled(`Facing ${word}: pixels right`, across),
        labelled(`Facing ${word}: pixels down`, down),
      );
      return row;
    };
    return section(
      "cast",
      "Splash and sound",
      "What players see and hear when someone casts into water.",
      f.castFx !== null || f.castSound !== null,
      effect,
      frames,
      castSound,
      more(
        false,
        channel,
        helpLine(
          "Where the splash lands, in pixels from the fisher, for each way they face. A tile is 32 pixels.",
        ),
        facing("N", "north"),
        facing("S", "south"),
        facing("E", "east"),
        facing("W", "west"),
      ),
    );
  };

  /** What trains the Fishing skill: each cast, each catch, or both. */
  const trainsField = (f: Record<string, unknown>) => {
    f.trains ??= { cast: true, catch: false };
    const t = f.trains as { cast: boolean; catch: boolean };
    const box = document.createElement("div");
    box.className = "gathering-trains";
    const head = document.createElement("p");
    head.className = "items-list-title";
    head.textContent = "What trains Fishing";
    box.append(
      head,
      check("gathering-trains-cast", t.cast, "Each cast trains it, caught or not", (on) => {
        t.cast = on;
      }),
      check("gathering-trains-catch", t.catch, "Each catch trains it", (on) => {
        t.catch = on;
      }),
      helpLine(
        "A cast trains only while the spot has catches left. With both ticked a catch trains twice. A skill that rises by chance rolls for each; one that rises by XP gets its XP for each, a catch the fish's own XP when the Catches tab gives one.",
      ),
    );
    return box;
  };

  const drawFixed = () => {
    if (!view || part === null || part === "node") {
      return;
    }
    form.hidden = false;
    subtitle.textContent = "";
    if (part === "counter") {
      title.textContent = "Swings per harvest";
      body.replaceChildren(
        section(
          "counter",
          "Swings per harvest",
          "How many swings a harvest takes at each skill value. Every harvestable tile uses it, and so does watering crops.",
          true,
          rowsEditor(
            "gathering-counter",
            "Swings by skill",
            "From each skill value on, a harvest takes this many swings. The last row the skill reaches wins.",
            "+ Add a skill row",
            fixedWork as { gt: number; value: number }[],
            [
              { key: "gt", label: "From skill", kind: "int", offset: 1 },
              { key: "value", label: "Swings", kind: "int" },
            ],
            () => ({ gt: 0, value: 1 }),
          ),
        ),
      );
    } else if (part === "fishing") {
      title.textContent = "Fishing";
      const f = fixedWork as Record<string, unknown> | null;
      if (!f) {
        body.replaceChildren(helpLine("This world has no fishing."));
        update();
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
      const skill = view.fishing.skill;
      body.replaceChildren(
        section(
          "fishing",
          "Fishing",
          `Players fish by using a fishing tool while facing water. ${skill ? `It trains ${skillName(skill)}.` : "No skill is set as the fishing skill, so fishing is off."}`,
          true,
          labelled(
            "Water tiles",
            water,
            "Two-letter tile codes players can fish in, comma-separated.",
          ),
          labelled(
            "Catches before a spot runs out",
            int(
              "gathering-anti-macro",
              f.antiMacroStart as number,
              1,
              1_000_000,
              false,
              "Catches before a spot runs out",
              (v) => {
                f.antiMacroStart = v ?? 1;
              },
            ),
            "After this many catches from one tile, players must fish from another tile to catch more.",
          ),
          labelled(
            "Message when a spot runs out",
            text("gathering-stopped", String(f.stoppedText ?? ""), (t) => {
              f.stoppedText = t;
            }),
          ),
          trainsField(f),
        ),
        castSection(f),
        section(
          "catches",
          "Catches",
          "Which fish players catch at each skill value.",
          true,
          rowsEditor(
            "gathering-catches",
            "Fish caught",
            "A bite catches one of the fish whose skill range holds the fisher's Fishing skill, picked by weight: a fish of weight 3 is caught three times as often as one of weight 1. Ranges may overlap, so a skilled fisher can still catch small fish. “Only with” names the fishing tools that catch it (a harpoon for sharks); empty, any does. XP is what a catch gives when Fishing rises by XP and catches train it (empty: the skill's own XP).",
            "+ Add a fish",
            f.catches as CatchRow[],
            [
              { key: "fish", label: "Fish", kind: "text", list: itemsList.id },
              { key: "from", label: "From skill", kind: "int", min: 0, max: 100 },
              {
                key: "below",
                label: "Below skill",
                kind: "int",
                min: 1,
                max: 101,
                optional: "no limit",
              },
              { key: "weight", label: "Weight", kind: "int", min: 1, max: 1_000_000 },
              { key: "xp", label: "XP", kind: "int", min: 0, optional: "skill's own" },
              { key: "tools", label: "Only with", kind: "names", optional: "any fishing tool" },
            ],
            (): CatchRow => ({ fish: "", from: 0, weight: 1 }),
          ),
        ),
        section(
          "bites",
          "Bites",
          "The chance each cast gets a bite, at each skill value.",
          true,
          rowsEditor(
            "gathering-bite",
            "Bite chance by skill",
            "From each skill value on, a cast bites 1 time in this many. The last row the skill reaches wins.",
            "+ Add a skill row",
            f.fishCheck as { gt: number; value: number }[],
            [
              { key: "gt", label: "From skill", kind: "int", offset: 1 },
              { key: "value", label: "1 in", kind: "int", min: 1 },
            ],
            () => ({ gt: 0, value: 1 }),
          ),
        ),
        section(
          "odds",
          "Odds",
          "How fishing plays at each skill value, worked out by the game's own rules from the form as it is now (before you save).",
          false,
          preview,
        ),
      );
      drawPreview();
    } else if (part === "farming") {
      title.textContent = "Farming";
      const f = fixedWork as Record<string, unknown> | null;
      if (!f) {
        body.replaceChildren(helpLine("This world has no farming."));
        update();
        return;
      }
      const skill = action(document.createElement("select"), "gathering-watering-skill");
      for (const s of view.skills) {
        skill.append(option(s.skill, s.display));
      }
      skill.value = String(f.wateringSkill ?? "");
      skill.addEventListener("change", () => {
        f.wateringSkill = skill.value;
        edited();
      });
      // The tilled-soil test is stored `*SL*`: shown and typed as codes, comma-separated.
      const soil = noAutofill(action(document.createElement("input"), "gathering-seed-test"));
      soil.value = String(f.seedTest ?? "")
        .split("*")
        .filter((c) => c !== "")
        .join(", ");
      soil.addEventListener("input", () => {
        const parts = soil.value
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x !== "");
        if (!parts.every((x) => x.length === 2)) {
          invalid.set(soil, "Seeds plant on: two-letter tile codes, comma-separated");
        } else {
          invalid.delete(soil);
          f.seedTest = parts.length === 0 ? "" : `*${parts.join("*")}*`;
        }
        edited();
      });
      body.replaceChildren(
        section(
          "seeds",
          "Seeds",
          "Which items plant seeds, and where.",
          true,
          labelled(
            "Seeds plant on",
            soil,
            "Tile codes of tilled soil, comma-separated, such as SL.",
          ),
          rowsEditor(
            "gathering-seeds",
            "Seeds",
            "Using a seed item on tilled soil turns the soil into its planted tile.",
            "+ Add a seed",
            f.seeds as { item: string; plants: string }[],
            [
              { key: "item", label: "Seed item", kind: "text", list: itemsList.id },
              { key: "plants", label: "Planted tile", kind: "text", list: tilesList.id },
            ],
            () => ({ item: "", plants: "" }),
          ),
        ),
        section(
          "watering",
          "Watering",
          "Watering a planted tile grows it. It takes swings like a harvest, read from the watering skill.",
          true,
          labelled(
            "Watering skill",
            skill,
            "The skill whose swings per harvest a watering tool uses.",
          ),
          rowsEditor(
            "gathering-watering",
            "What watering grows",
            "",
            "+ Add a planted tile",
            f.watering as { from: string; to: string }[],
            [
              { key: "from", label: "Planted tile", kind: "text", list: tilesList.id },
              { key: "to", label: "Grows into", kind: "text", list: tilesList.id },
            ],
            () => ({ from: "", to: "" }),
          ),
        ),
        section(
          "crops",
          "Crops",
          "What a fully grown tile gives when it is ready.",
          true,
          rowsEditor(
            "gathering-produce",
            "Crops",
            "A grown tile drops its crop item when the world's crop check reaches it.",
            "+ Add a crop",
            f.produce as { tile: string; item: string }[],
            [
              { key: "tile", label: "Grown tile", kind: "text", list: tilesList.id },
              { key: "item", label: "Crop item", kind: "text", list: itemsList.id },
            ],
            () => ({ tile: "", item: "" }),
          ),
        ),
      );
    }
    addRestores();
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
        name.textContent = `${n.node.can} ${tileName(n.node.tile) || `tile ${n.node.tile}`}`;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [
          skillName(n.node.skill),
          n.yield?.kind === "chance" ? n.yield.item : n.yield ? "ores" : "",
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
    for (const b of fixedEl.querySelectorAll<HTMLButtonElement>("button")) {
      if (part !== null && part !== "node" && b.dataset.part === part) {
        b.setAttribute("aria-current", "true");
      } else {
        b.removeAttribute("aria-current");
      }
    }
  };

  const show = (v: ContentGatheringView) => {
    loading.hidden = true;
    view = v;
    const opts = (l: HTMLDataListElement, values: { value: string; text?: string }[]) => {
      if (l.childElementCount !== values.length) {
        l.replaceChildren(...values.map((x) => option(x.value, x.text)));
      }
    };
    opts(
      tilesList,
      v.choices.tiles.map((t) => ({ value: t.code, ...(t.name ? { text: t.name } : {}) })),
    );
    opts(
      itemsList,
      v.choices.items.map((x) => ({ value: x })),
    );
    opts(
      soundsList,
      v.choices.sounds.map((x) => ({ value: x })),
    );
    opts(
      yieldsList,
      v.choices.yields.map((x) => ({ value: x })),
    );
    opts(
      effectsList,
      v.choices.effects.map((x) => ({ value: x })),
    );
    drawList();
    const total = v.otherDraft + (v.pending ? 1 : 0);
    draftLine.hidden = total === 0;
    draftText.textContent = v.pending
      ? `You have unpublished gathering changes${v.otherDraft > 0 ? ` (and ${v.otherDraft} other ${v.otherDraft === 1 ? "change" : "changes"})` : ""}. Players get them once you publish. `
      : total > 0
        ? `${v.otherDraft === 1 ? "1 unpublished change" : `${v.otherDraft} unpublished changes`} (none to gathering). Players get them once you publish. `
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
        update();
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
      empty.hidden = true;
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
