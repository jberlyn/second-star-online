/**
 * The Control Panel's World page (issue #33): the World Editor rebuilt as a page. One map at a time,
 * drawn with the game's own art, with tools the in-game editor had (pencil, the fat brush, the
 * whole-layer bucket) and SSO's own (flood fill, rectangle fill, eyedropper, select with copy, cut,
 * paste and stamps, undo and redo), the four roster slots, placed items, exits, signs, the header,
 * flags and fog as forms, and the map's saved versions to restore. An SSO page: 1.6's World Editor
 * was frames 262-288 of the game.
 *
 * - Saves apply at once and are versioned, as the World Editor's always were; the server checks and
 *   applies them the same way (`editorMapError`, `applySave`). A save names the revision of the map
 *   it started from, and one over a newer save is refused.
 * - The editing operations are pure (shared `mapedit.ts`); this page holds the map being edited and
 *   its history.
 */
import {
  BLEND_LEVELS,
  brush,
  type Clip,
  type ContentMapsView,
  clearRect,
  codeAt,
  content,
  copyRect,
  EDITOR_ITEM_SLOTS,
  EDITOR_ITEMS,
  EDITOR_MONSTERS,
  EDITOR_NPCS,
  type EditorMap,
  type ExitFields,
  editorMapSchema,
  exitError,
  exitFieldsAfterLoad,
  exitFromFields,
  FOG_TEXTURES,
  fillRect,
  floodFill,
  footBlocked,
  isPaletteCode,
  itemSprite,
  type LayerIndex,
  MAP_HEIGHT,
  MAP_WIDTH,
  MapHistory,
  type MapListEntry,
  NO_FOG,
  normRect,
  pasteClip,
  type TileRect,
  tileBlocked,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { drawFog, fogLayer } from "../fog.ts";
import { action, noAutofill } from "./action.ts";
import { formActions, pageHeading, panelButton, sectionTabs } from "./control-panel-kit.ts";

export interface WorldPageActions {
  /** Asks for the open map (`at`) and, with `list`, every map. */
  view(seq: number, at?: { mx: number; my: number }, list?: boolean): void;
  save(seq: number, map: EditorMap, expect: string | null): void;
  restore(seq: number, mx: number, my: number, version: string, expect: string | null): void;
}

export interface WorldAnswer {
  t: "contentMaps";
  seq: number;
  view: ContentMapsView;
  result?: { ok: boolean; text: string };
}

export interface WorldPage {
  readonly el: HTMLElement;
  onShow(): void;
  changes(): number;
  discard(): void;
  receive(msg: WorldAnswer): void;
  reset(): void;
  /** Opens a map by its grid position. */
  open(mx: number, my: number): void;
  /** Opens (mx, my) when the page next shows, unless a map is open already (the admin's own map). */
  prefer(mx: number, my: number): void;
  /** Content or art was published: the palette, faction list and map redraw. */
  published(): void;
  /**
   * The connection dropped: an answer to an open, save or restore may never come, so nothing waits
   * for one. The edit stays; the next view says whether a save landed (a newer revision).
   */
  connectionLost(): void;
}

/** The tools. Spawn and item placing pick a tile for the row that asked. */
export type Tool =
  | "pencil"
  | "fat"
  | "bucket"
  | "flood"
  | "rect"
  | "pick"
  | "select"
  | "paste"
  | "place";

const TOOLS: readonly (readonly [Tool, string])[] = [
  ["pencil", "Pencil"],
  ["fat", "Big brush"],
  ["bucket", "Fill the whole layer"],
  ["flood", "Fill an area"],
  ["rect", "Rectangle"],
  ["pick", "Eyedropper"],
  ["select", "Select"],
  ["paste", "Paste"],
];

/** What each tool does, shown under the toolbar. */
const TOOL_HELP: Record<Tool, string> = {
  pencil: "Pencil: click a tile to paint it, or drag to paint a line.",
  fat: "Big brush: paints five tiles at once, in a plus shape. Drag to keep painting.",
  bucket: "Fill the whole layer: one click paints every tile of the layer.",
  flood: "Fill an area: paints the joined tiles that match the one you click.",
  rect: "Rectangle: drag a box to fill it with the tile.",
  pick: "Eyedropper: click a tile on the map to paint with it.",
  select: "Select: drag a box, then Copy, Cut or Clear it.",
  paste: "Paste: click where the top-left corner of the copy goes.",
  place: "Click the tile on the map.",
};

/** The layers by index (1, 2, 3, then S), in words. */
const LAYER_NAMES = [
  "Ground (layer 1)",
  "Objects (layer 2)",
  "Above characters (layer 3)",
  "Shadows (layer S)",
] as const;
/** The layers in a short form, for the tile under the pointer. */
const LAYER_SHORT = ["ground", "objects", "above", "shadows"] as const;

/** The fog textures in words. */
const FOG_TEXT: Record<string, string> = {
  NoTex: "No fog",
  Cloudy1: "Cloudy 1",
  Cloudy2: "Cloudy 2",
  Cloudy3: "Cloudy 3",
  Whispy: "Wispy",
};
/** The order layers draw in, and how see-through: 1, then S at 178/255, then 2, then 3. */
const DRAW_ORDER: readonly (readonly [LayerIndex, number])[] = [
  [0, 1],
  [3, 178 / 255],
  [1, 1],
  [2, 1],
];

const PX = 32;
/** A map position the server takes (the protocol's bound). */
const GRID_MAX = 1_000_000;
const onGrid = (n: number) => Number.isInteger(n) && Math.abs(n) <= GRID_MAX;

/** The item an editor line names, for its picture: `50 Gold` is Gold, `Cauldron#12` a Cauldron. */
function placedItemName(line: string): string {
  return line
    .trim()
    .replace(/^\d+\s+/, "")
    .replace(/#.*$/, "");
}

export function createWorldPage(actions: WorldPageActions, assets: Assets | null): WorldPage {
  const el = document.createElement("div");
  el.className = "world-page items-page balance-page plain-editor";
  el.append(
    pageHeading(
      "World",
      "Pick a map to paint its tiles and choose what is on it: monsters, items, exits, signs and fog. Saving changes the map straight away for everyone on it, and keeps the old one so you can put it back.",
    ),
  );
  let ids = 0;
  const labelled = (label: string, control: HTMLElement, help = "") => {
    const wrap = document.createElement("div");
    wrap.className = "control-panel-field balance-field";
    const isGroup = control.tagName === "DIV";
    // A group of controls is named by a heading, not a label (a label names one control).
    const l = document.createElement(isGroup ? "span" : "label");
    l.className = "control-panel-field-label";
    ids += 1;
    control.id ||= `world-field-${ids}`;
    if (l instanceof HTMLLabelElement) {
      l.htmlFor = control.id;
    } else {
      l.id = `${control.id}-label`;
      control.setAttribute("role", "group");
      control.setAttribute("aria-labelledby", l.id);
    }
    l.textContent = label;
    wrap.append(l, control);
    if (help) {
      const h = document.createElement("p");
      h.className = "control-panel-field-help";
      h.textContent = help;
      wrap.append(h);
    }
    return wrap;
  };
  const say = (p: HTMLElement, text: string, ok = true) => {
    p.textContent = text;
    p.className = ok ? "balance-status" : "balance-status balance-status-error";
  };
  /** A help line under a tab's title: what the tab is for. */
  const intro = (text: string) => {
    const p = document.createElement("p");
    p.className = "items-intro";
    p.textContent = text;
    return p;
  };
  /** A tab of the side forms: its title, a help line and its fields. */
  const section = (id: string, title: string, help: string, ...kids: HTMLElement[]) => {
    const s = document.createElement("section");
    s.className = "balance-row items-group";
    s.dataset.group = id;
    const h = document.createElement("h3");
    h.className = "balance-row-title";
    h.textContent = title;
    s.append(h, intro(help), ...kids);
    return s;
  };
  /** Fields folded under "More options" (opened when one of them is in use). */
  const more = (label: string, ...kids: HTMLElement[]) => {
    const d = document.createElement("details");
    d.className = "items-more";
    const s = action(document.createElement("summary"), "world-more-toggle");
    s.textContent = label;
    d.append(s, ...kids);
    return d;
  };
  const numInput = (id: string, value: string, label: string) => {
    const i = noAutofill(action(document.createElement("input"), id));
    i.type = "number";
    i.step = "1";
    i.value = value;
    i.setAttribute("aria-label", label);
    return i;
  };

  // ---- the map list, and going to a map by its position ----
  const mxIn = numInput("world-mx", "1000", "Map X");
  const myIn = numInput("world-my", "992", "Map Y");
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");
  const openBtn = panelButton("world-open", "Go", () => {
    const mx = Number(mxIn.value);
    const my = Number(myIn.value);
    if (!onGrid(mx) || !onGrid(my)) {
      say(goStatus, `Map X and Y are whole numbers from -${GRID_MAX} to ${GRID_MAX}.`, false);
      return;
    }
    goStatus.textContent = "";
    openMap(mx, my);
  });
  const goStatus = document.createElement("p");
  goStatus.className = "balance-status";
  goStatus.setAttribute("role", "status");
  const arrow = (id: string, label: string, title: string, dx: number, dy: number) => {
    const b = panelButton(id, label, () => {
      if (loadedAt && onGrid(loadedAt.mx + dx) && onGrid(loadedAt.my + dy)) {
        openMap(loadedAt.mx + dx, loadedAt.my + dy);
      }
    });
    b.title = title;
    return b;
  };
  const go = document.createElement("div");
  go.className = "items-filters world-go";
  go.append(labelled("Map X", mxIn), labelled("Map Y", myIn), openBtn);
  const search = noAutofill(action(document.createElement("input"), "world-search"));
  search.type = "search";
  search.id = "world-search";
  search.placeholder = "Map, name, monster or item";
  const listEl = document.createElement("ul");
  listEl.className = "items-list world-maps";
  listEl.setAttribute("aria-label", "Maps");
  const listCount = document.createElement("p");
  listCount.className = "control-panel-field-help";
  const listBox = document.createElement("section");
  listBox.className = "items-list-box";
  listBox.append(
    labelled(
      "Search",
      search,
      "Finds a map by its position, its name, or the monsters, NPCs and items on it.",
    ),
    listCount,
    listEl,
    more(
      "Go to a map by its position",
      go,
      (() => {
        const p = document.createElement("p");
        p.className = "control-panel-field-help";
        p.textContent =
          "Every map has an X and a Y on the world grid. A position with no map opens a blank one to build.";
        return p;
      })(),
      goStatus,
    ),
  );

  // ---- the editor ----
  const form = document.createElement("section");
  form.className = "items-form world-form";
  form.hidden = true;
  const head = document.createElement("div");
  head.className = "items-form-head";
  const title = document.createElement("h2");
  title.className = "content-section-title";
  const subtitle = document.createElement("p");
  subtitle.className = "control-panel-field-help items-form-id";
  const tags = document.createElement("div");
  tags.className = "balance-tags";
  const neighbours = document.createElement("div");
  neighbours.className = "content-buttons world-neighbours";
  const neighboursLabel = document.createElement("span");
  neighboursLabel.className = "control-panel-field-help";
  neighboursLabel.textContent = "Next map:";
  neighbours.append(
    neighboursLabel,
    arrow("world-west", "← West", "Open the map to the west (X − 1)", -1, 0),
    arrow("world-north", "↑ North", "Open the map to the north (Y − 1)", 0, -1),
    arrow("world-south", "↓ South", "Open the map to the south (Y + 1)", 0, 1),
    arrow("world-east", "East →", "Open the map to the east (X + 1)", 1, 0),
  );
  head.append(title, subtitle, tags, neighbours);
  const stale = document.createElement("p");
  stale.className = "balance-stale";
  stale.hidden = true;
  stale.textContent =
    "Someone changed this map while you were editing it, so saving will be refused. Undo your changes to see theirs.";

  // Toolbar.
  const toolSel = action(document.createElement("select"), "world-tool");
  toolSel.id = "world-tool";
  for (const [v, t] of TOOLS) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = t;
    toolSel.append(o);
  }
  const toolHelp = document.createElement("p");
  toolHelp.className = "control-panel-field-help world-tool-help";
  const layerSel = action(document.createElement("select"), "world-layer");
  layerSel.id = "world-layer";
  LAYER_NAMES.forEach((n, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = n;
    layerSel.append(o);
  });
  const shown = [true, true, true, true];
  const visBox = document.createElement("div");
  visBox.className = "items-checks";
  visBox.dataset.list = "visible-layers";
  LAYER_NAMES.forEach((n, i) => {
    const l = document.createElement("label");
    l.className = "items-check";
    const b = action(document.createElement("input"), "world-layer-visible");
    b.type = "checkbox";
    b.checked = true;
    b.addEventListener("change", () => {
      shown[i] = b.checked;
      draw();
    });
    l.append(b, ` ${n}`);
    visBox.append(l);
  });
  const allLayers = document.createElement("label");
  allLayers.className = "items-check";
  const allBox = action(document.createElement("input"), "world-all-layers");
  allBox.type = "checkbox";
  allLayers.append(allBox, " Select, Copy, Cut and Delete work on every layer at once");
  const zoomSel = action(document.createElement("select"), "world-zoom");
  zoomSel.id = "world-zoom";
  for (const z of ["1", "1.5", "2"]) {
    const o = document.createElement("option");
    o.value = z;
    o.textContent = `${Number(z) * 100}%`;
    zoomSel.append(o);
  }
  const undoBtn = panelButton("world-undo", "Undo last step", () => undo());
  undoBtn.title = "Takes back your last change (Ctrl+Z)";
  const redoBtn = panelButton("world-redo", "Redo", () => redo());
  redoBtn.title = "Puts back what Undo last step took (Ctrl+Y)";
  const copyBtn = panelButton("world-copy", "Copy", () => copySel(false));
  copyBtn.title = "Copies the selected box (Ctrl+C)";
  const cutBtn = panelButton("world-cut", "Cut", () => copySel(true));
  cutBtn.title = "Copies the selected box, then clears it (Ctrl+X)";
  const deleteBtn = panelButton("world-delete", "Clear", () => {
    if (selection && map) {
      change(clearRect(map, selection, selLayers()));
    }
  });
  deleteBtn.title = "Clears the tiles in the selected box";
  const stampName = noAutofill(action(document.createElement("input"), "world-stamp-name"));
  stampName.placeholder = "A name for it";
  const keepStamp = panelButton("world-stamp-keep", "Keep the copy as a stamp", () => {
    const n = stampName.value.trim();
    if (!clip || n === "") {
      say(status, clip ? "Give the stamp a name." : "Copy something first.", false);
      return;
    }
    stamps.set(n, structuredClone(clip));
    stampName.value = "";
    drawStamps();
  });
  const stampSel = action(document.createElement("select"), "world-stamp");
  stampSel.addEventListener("change", () => {
    const s = stamps.get(stampSel.value);
    if (s) {
      clip = structuredClone(s);
      setTool("paste");
    }
  });
  const currentTile = document.createElement("p");
  currentTile.className = "control-panel-field-help world-current-tile";
  const toolRow = document.createElement("div");
  toolRow.className = "items-filters world-tool-row";
  toolRow.append(
    labelled("Tool", toolSel),
    labelled("Paint on", layerSel),
    labelled("Zoom", zoomSel),
  );
  const stepButtons = document.createElement("div");
  stepButtons.className = "content-buttons world-steps";
  stepButtons.append(undoBtn, redoBtn, copyBtn, cutBtn, deleteBtn);
  const toolMore = more(
    "More tools: show or hide layers, stamps",
    labelled(
      "Show layers",
      visBox,
      "Hiding a layer only hides it while you work: it stays on the map.",
    ),
    allLayers,
    labelled(
      "Stamps",
      (() => {
        const row = document.createElement("div");
        row.className = "content-buttons";
        stampName.setAttribute("aria-label", "Stamp name");
        stampSel.setAttribute("aria-label", "Stamp to paste");
        row.append(stampName, keepStamp, stampSel);
        return row;
      })(),
      "Keep something you copied under a name, to paste it again later while this page is open.",
    ),
  );
  toolMore.classList.add("world-tool-more");
  const toolbar = document.createElement("div");
  toolbar.className = "world-toolbar";
  toolbar.append(toolRow, toolHelp, currentTile, stepButtons, toolMore);

  // Canvas.
  const canvas = action(document.createElement("canvas"), "world-canvas");
  canvas.width = MAP_WIDTH * PX;
  canvas.height = MAP_HEIGHT * PX;
  canvas.className = "world-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "The map");
  canvas.tabIndex = 0;
  const hover = document.createElement("p");
  hover.className = "control-panel-field-help";
  hover.setAttribute("aria-live", "polite");
  hover.textContent =
    "Point at a tile to see what is on it. A red corner marks a tile players can't walk onto.";

  // Palette.
  const paletteSearch = noAutofill(action(document.createElement("input"), "world-palette-search"));
  paletteSearch.type = "search";
  paletteSearch.placeholder = "Code or name, such as grass or S3";
  const paletteEl = document.createElement("div");
  paletteEl.className = "world-palette";
  paletteEl.setAttribute("aria-label", "Tiles");
  const paletteNote = document.createElement("p");
  paletteNote.className = "control-panel-field-help";

  // Spawns.
  const spawnsEl = document.createElement("div");
  // Items.
  const itemsEl = document.createElement("div");
  const itemsList = document.createElement("datalist");
  itemsList.id = "world-items";
  const addItemBtn = panelButton("world-item-add", "+ Add item", () => {
    if (!map || map.items.length >= EDITOR_ITEM_SLOTS) {
      return;
    }
    const next = structuredClone(map);
    next.items.push({ name: EDITOR_ITEMS[1] ?? "", x: 1, y: 1 });
    change(next);
    placing = { kind: "item", index: next.items.length - 1 };
    setTool("place");
    say(status, "Click the tile the new item goes on.");
  });
  addItemBtn.classList.add("items-add");
  // Exits, signs, header, flags, fog.
  const exitFields: [HTMLInputElement[], HTMLInputElement[]] = [[], []];
  const exitsEl = document.createElement("div");
  for (const e of [0, 1] as const) {
    const box = document.createElement("div");
    box.className = "items-list-editor";
    box.dataset.list = `exit${e + 1}`;
    const h = document.createElement("h4");
    h.className = "items-list-title";
    h.textContent = `Exit ${e + 1}`;
    const row = document.createElement("div");
    row.className = "items-list-row";
    const names = ["Leads to map X", "Leads to map Y", "Arrive at tile X", "Arrive at tile Y"];
    for (const [i, n] of names.entries()) {
      const inp = noAutofill(action(document.createElement("input"), `world-exit${e + 1}`));
      inp.setAttribute("aria-label", `Exit ${e + 1}: ${n}`);
      inp.placeholder = "None";
      inp.addEventListener("input", () => formEdited());
      exitFields[e][i] = inp;
      row.append(labelled(n, inp));
    }
    box.append(h, row);
    exitsEl.append(box);
  }
  const header = noAutofill(action(document.createElement("input"), "world-header"));
  header.maxLength = 200;
  header.placeholder = "No name";
  header.addEventListener("input", () => formEdited());
  const signs = [0, 1, 2].map((i) => {
    const t = noAutofill(action(document.createElement("textarea"), `world-sign${i + 1}`));
    t.rows = 2;
    t.maxLength = 1000;
    t.placeholder = "No sign";
    t.addEventListener("input", () => formEdited());
    return t;
  });
  const flagBox = (label: string, id: string) => {
    const l = document.createElement("label");
    l.className = "items-check";
    const b = action(document.createElement("input"), id);
    b.type = "checkbox";
    b.addEventListener("change", () => formEdited());
    l.append(b, ` ${label}`);
    return { l, b };
  };
  const safe = flagBox("Safe area: no fighting at all", "world-flag-safe");
  const noPvp = flagBox("No player killing: players can't attack each other", "world-flag-nopvp");
  const indoor = flagBox("Indoors", "world-flag-indoor");
  const factionSel = action(document.createElement("select"), "world-faction");
  factionSel.addEventListener("change", () => formEdited());
  const fogTex = action(document.createElement("select"), "world-fog-tex");
  for (const t of FOG_TEXTURES) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = FOG_TEXT[t] ?? t;
    fogTex.append(o);
  }
  fogTex.addEventListener("change", () => fogEdited());
  const fogBlend = action(document.createElement("select"), "world-fog-blend");
  for (const b of BLEND_LEVELS) {
    const o = document.createElement("option");
    o.value = String(b);
    o.textContent = b === 0 ? "0 (can't be seen)" : b === 255 ? "255 (solid)" : String(b);
    fogBlend.append(o);
  }
  fogBlend.addEventListener("change", () => fogEdited());
  const fogRgb = ["Red", "Green", "Blue"].map((n) => {
    const i = numInput(`world-fog-${n.toLowerCase()}`, "255", `Fog colour: ${n.toLowerCase()}`);
    i.min = "0";
    i.max = "255";
    i.addEventListener("input", () => fogEdited());
    return i;
  });
  const fogColour = document.createElement("div");
  fogColour.className = "items-range-pair world-fog-colour";
  fogRgb.forEach((i, n) => {
    fogColour.append(["Red", "Green", "Blue"][n] ?? "", i);
  });
  const fogMore = more(
    "More options",
    labelled(
      "Fog colour",
      fogColour,
      "Red, green and blue, each from 0 to 255. 255, 255, 255 is white (the fog's own colours).",
    ),
  );

  // Save, history.
  const saveBtn = panelButton(
    "world-save",
    "Save changes",
    () => {
      if (!map || busy || opening) {
        return;
      }
      const m = currentMap();
      const err = mapProblem(m);
      if (err) {
        say(status, err, false);
        return;
      }
      busy = true;
      seq += 1;
      saving.set(seq, { mx: m.mx, my: m.my });
      say(status, "Saving…");
      update();
      actions.save(seq, m, filledRevision);
    },
    "primary",
  );
  const dropBtn = panelButton("world-undo-edit", "Undo changes", () => {
    if (busy || opening) {
      return;
    }
    fill();
    status.textContent = "";
    update();
  });
  dropBtn.title = "Puts the map back as it was when you opened it (or last saved it)";
  const historyEl = document.createElement("ul");
  historyEl.className = "world-history";
  historyEl.setAttribute("aria-label", "Saved versions");
  const mainButtons = document.createElement("div");
  mainButtons.className = "content-buttons";
  mainButtons.append(saveBtn, dropBtn);
  const liveNote = document.createElement("p");
  liveNote.className = "control-panel-field-help world-live-note";
  liveNote.textContent = "Saves go live at once, for everyone on this map.";
  const buttons = document.createElement("div");
  buttons.className = "items-actions";
  buttons.append(mainButtons, liveNote);

  const canvasBox = document.createElement("div");
  canvasBox.className = "world-canvas-box";
  canvasBox.append(canvas);
  const sTiles = section(
    "tiles",
    "Tiles",
    "Pick the tile to paint with, then paint on the map above with the tool you chose.",
    labelled("Find a tile", paletteSearch),
    paletteNote,
    paletteEl,
  );
  const sSpawns = section(
    "spawns",
    "Monsters & NPCs",
    "The four monsters or NPCs that appear on this map. Choose one for a spot, then Pick on map and click the tile where it appears.",
    spawnsEl,
  );
  const sItems = section(
    "items",
    "Items",
    `Items lying on this map, put back each time it is saved (up to ${EDITOR_ITEM_SLOTS}). Put a number before an item to place a pile, as in 50 Gold.`,
    itemsEl,
    addItemBtn,
    itemsList,
  );
  const sExits = section(
    "exits",
    "Exits",
    "Where walking off this map takes players, and the tile they arrive on. For a house interior, put H1 or H2 before the map X (H1 1000). Leave all four boxes empty for no exit.",
    exitsEl,
  );
  const sText = section(
    "text",
    "Name & signs",
    "The name players see as they enter, and the text of the map's signs.",
    labelled("Map name", header, "Shown at the top as players enter the map."),
    ...signs.map((t, i) => labelled(`Sign ${i + 1}`, t)),
  );
  const sRules = section(
    "rules",
    "Rules",
    "What players can do on this map.",
    safe.l,
    noPvp.l,
    indoor.l,
    labelled(
      "Faction members appear here",
      factionSel,
      "Now and then one of the map's monsters is swapped for a member of this faction.",
    ),
  );
  const sFog = section(
    "fog",
    "Fog",
    "A haze drawn over the whole map, as players see it on the map above.",
    labelled("Fog", fogTex),
    labelled("Thickness", fogBlend, "From 0 (can't be seen) to 255 (solid)."),
    fogMore,
  );
  const sVersions = section(
    "versions",
    "Saved versions",
    "Every save keeps the map it replaced. Restoring one saves it over the map as it is now, so that can be restored too.",
    historyEl,
  );
  const tabs = sectionTabs(form, "world");
  form.append(
    head,
    stale,
    toolbar,
    canvasBox,
    hover,
    tabs.el,
    sTiles,
    sSpawns,
    sItems,
    sExits,
    sText,
    sRules,
    sFog,
    sVersions,
    formActions(buttons, status),
  );

  const layout = document.createElement("div");
  layout.className = "items-layout";
  const empty = document.createElement("p");
  empty.className = "items-empty-form";
  empty.textContent = "Pick a map on the left (or go to its position) to see and change it.";
  layout.append(listBox, empty, form);
  const loading = document.createElement("p");
  loading.className = "balance-loading";
  loading.textContent = "Loading…";
  el.append(loading, layout);

  // ---- state ----
  let seq = 0;
  let resetSeq = -1;
  let appliedSeq = -1;
  const saving = new Map<number, { mx: number; my: number }>();
  const restoring = new Set<number>();
  let maps: MapListEntry[] = [];
  let openAt: { mx: number; my: number } | null = null;
  let loadedAt: { mx: number; my: number } | null = null;
  let view: ContentMapsView["map"] = null;
  /** The map being edited (tiles, spawns, items); the forms hold the rest until read. */
  let map: EditorMap | null = null;
  /** The map as it was opened (or last saved): what "unsaved" compares against. */
  let loaded = "";
  let filledRevision: string | null = null;
  const history = new MapHistory();
  /** The map, forms included, as the last undo step left it: what the next step goes back to. */
  let committed: EditorMap | null = null;
  /** A save or restore is waiting for its answer: nothing can be edited until it comes. */
  let busy = false;
  /** Another map is being opened: nothing can be edited until it comes. */
  let opening = false;
  let tool: Tool = "pencil";
  let tile = "";
  let selection: TileRect | null = null;
  let clip: Clip | null = null;
  const stamps = new Map<string, Clip>();
  let placing: { kind: "mob" | "item"; index: number } | null = null;
  let drag: { x: number; y: number; before: EditorMap } | null = null;

  const layerNow = (): LayerIndex => Number(layerSel.value) as LayerIndex;
  const selLayers = (): LayerIndex[] => (allBox.checked ? [0, 1, 2, 3] : [layerNow()]);

  /** The map as a save would send it: the edited tiles, spawns and items, and the forms. */
  const currentMap = (): EditorMap => {
    const m = structuredClone(map as EditorMap);
    m.header = header.value;
    m.signs = [signs[0]?.value ?? "", signs[1]?.value ?? "", signs[2]?.value ?? ""];
    m.exit1 = exitFromFields(exitFields[0].map((i) => i.value) as ExitFields);
    m.exit2 = exitFromFields(exitFields[1].map((i) => i.value) as ExitFields);
    m.flags = {
      canFight: safe.b.checked ? "O" : "X",
      canPvp: noPvp.b.checked ? "O" : "X",
      isIndoors: indoor.b.checked ? "O" : "X",
      fctSpwn: factionSel.value,
    };
    // An empty colour field is no number (not 0), so the save says so.
    const rgb = fogRgb.map((i) => (i.value.trim() === "" ? Number.NaN : Number(i.value)));
    // No texture is no fog, as the World Editor saved it: its blend and colour go back to none.
    m.fog =
      fogTex.value.toLowerCase() === NO_FOG.tex.toLowerCase()
        ? { ...NO_FOG }
        : {
            tex: fogTex.value,
            blend: Number(fogBlend.value),
            r: rgb[0] ?? 255,
            g: rgb[1] ?? 255,
            b: rgb[2] ?? 255,
          };
    return m;
  };
  /** Why the map cannot be saved as it is, before it is sent. */
  const mapProblem = (m: EditorMap): string | null => {
    for (const [i, e] of [m.exit1, m.exit2].entries()) {
      const err = exitError(e);
      if (err) {
        return `Exit ${i + 1}: ${err}`;
      }
    }
    if (
      m.fog &&
      [m.fog.r, m.fog.g, m.fog.b].some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return "Fog: red, green and blue are whole numbers from 0 to 255.";
    }
    for (const [i, it] of m.items.entries()) {
      if (it.name.trim() === "" || it.name.length > 40) {
        return `Item ${i + 1}: name an item (at most 40 characters), or remove it.`;
      }
    }
    for (const [i, e] of [m.exit1, m.exit2].entries()) {
      if (e && !(onGrid(e.mx) && onGrid(e.my))) {
        return `Exit ${i + 1}: the map's X and Y are from -${GRID_MAX} to ${GRID_MAX}.`;
      }
    }
    // Anything else the server's message check would refuse (it answers a malformed message with
    // nothing, so the page would wait for ever).
    if (!editorMapSchema.safeParse(m).success) {
      return "Something on this map is out of bounds (a field too long or a number too big).";
    }
    return null;
  };
  const dirty = () => map !== null && JSON.stringify(currentMap()) !== loaded;

  const ask = (list = false) => {
    seq += 1;
    actions.view(seq, openAt ?? undefined, list);
  };

  /** Records an undo step: the map as it was (`committed`), then what it is now. */
  const record = () => {
    if (!map) {
      return;
    }
    const now = currentMap();
    if (committed && JSON.stringify(now) !== JSON.stringify(committed)) {
      history.push(committed);
    }
    committed = now;
  };
  /** A tile, spawn or item change: the map before it goes on the undo history. */
  const change = (next: EditorMap) => {
    if (!map || next === map || busy || opening) {
      return;
    }
    map = next;
    record();
    afterChange();
  };
  /** Puts a map from the history back: its tiles, spawns, items and forms. */
  const restoreStep = (m: EditorMap) => {
    stopPlacing();
    map = structuredClone(m);
    fillForms(m);
    committed = currentMap();
    void refreshFog();
    afterChange();
  };
  const afterChange = () => {
    draw();
    drawSpawns();
    drawItems();
    update();
  };
  const undo = () => {
    if (!map || busy || opening) {
      return;
    }
    record();
    const prev = history.undo(currentMap());
    if (prev) {
      restoreStep(prev);
    }
  };
  const redo = () => {
    if (!map || busy || opening) {
      return;
    }
    const next = history.redo(currentMap());
    if (next) {
      restoreStep(next);
    }
  };
  const copySel = (cut: boolean) => {
    if (!selection || !map) {
      say(status, "Select a box first, with the Select tool.", false);
      return;
    }
    clip = copyRect(map, selection, selLayers());
    if (cut) {
      change(clearRect(map, selection, selLayers()));
    }
    say(
      status,
      `Copied ${clip.w}×${clip.h} tiles: choose Paste, then click where its top-left corner goes.`,
    );
  };
  const setTool = (t: Tool) => {
    tool = t;
    toolSel.value = t === "place" ? "pencil" : t;
    toolHelp.textContent = TOOL_HELP[t];
    if (t !== "place") {
      placing = null;
    }
    draw();
  };
  /** A pending Pick on map is dropped when what it would place may have moved (undo, a refill). */
  const stopPlacing = () => {
    if (placing) {
      placing = null;
      setTool("pencil");
    }
  };
  toolSel.addEventListener("change", () => setTool(toolSel.value as Tool));
  zoomSel.addEventListener("change", () => {
    canvas.style.width = `${MAP_WIDTH * PX * Number(zoomSel.value)}px`;
  });

  toolHelp.textContent = TOOL_HELP.pencil;

  // ---- drawing ----
  const loadArt = async () => {
    if (!assets) {
      return;
    }
    await Promise.all([
      assets.loadGroup("tiles"),
      assets.loadGroup("items"),
      assets.loadGroup("bodies"),
    ]).catch(() => {});
    draw();
    drawPalette();
  };
  /** The fog as the forms hold it, drawn over the map as the game draws it. */
  let fog: { key: string; layer: HTMLCanvasElement | null; blend: number } = {
    key: "",
    layer: null,
    blend: 0,
  };
  const refreshFog = async () => {
    if (!assets || !map) {
      return;
    }
    const f = currentMap().fog;
    const key = JSON.stringify(f);
    if (key === fog.key) {
      return;
    }
    fog.key = key;
    const layer = await fogLayer(assets, f);
    // A later change may have asked again meanwhile; only the latest is kept.
    if (fog.key === key) {
      fog = { key, layer, blend: f.blend };
      draw();
    }
  };
  const draw = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !map) {
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const [l, alpha] of DRAW_ORDER) {
      if (!shown[l] || !assets) {
        continue;
      }
      ctx.globalAlpha = alpha;
      for (let y = 1; y <= MAP_HEIGHT; y++) {
        const codes = (map.layers[l][y - 1] ?? "").split(" ");
        for (let x = 1; x <= MAP_WIDTH; x++) {
          const code = codes[x - 1];
          if (code) {
            drawSprite(ctx, assets, "tiles", code, (x - 1) * PX, (y - 1) * PX, true);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    drawFog(ctx, fog.layer, fog.blend);
    // Tiles a walker cannot step on (the game's rule: layer 1 or layer 2), marked with a corner.
    ctx.fillStyle = "rgba(255,64,64,0.8)";
    for (let y = 1; y <= MAP_HEIGHT; y++) {
      for (let x = 1; x <= MAP_WIDTH; x++) {
        if (footBlocked(codeAt(map, 0, x, y), codeAt(map, 1, x, y))) {
          ctx.fillRect((x - 1) * PX, (y - 1) * PX, 5, 5);
        }
      }
    }
    if (assets) {
      for (const it of map.items) {
        drawSprite(
          ctx,
          assets,
          "items",
          itemSprite(placedItemName(it.name)),
          it.x * PX - 16,
          it.y * PX - 36,
        );
      }
      for (const m of map.mobs) {
        const body = m ? content().monster(m.name)?.body : undefined;
        if (m && body !== undefined) {
          // A slot that spawns anywhere is only marked, faintly, under its slot number.
          ctx.globalAlpha = m.anywhere ? 0.4 : 1;
          drawSprite(ctx, assets, "bodies", `${body}-F2-S`, m.x * PX - 16, m.y * PX - 35);
          ctx.globalAlpha = 1;
        }
      }
    }
    // Grid and selection.
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    for (let x = 1; x < MAP_WIDTH; x++) {
      ctx.beginPath();
      ctx.moveTo(x * PX + 0.5, 0);
      ctx.lineTo(x * PX + 0.5, canvas.height);
      ctx.stroke();
    }
    for (let y = 1; y < MAP_HEIGHT; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * PX + 0.5);
      ctx.lineTo(canvas.width, y * PX + 0.5);
      ctx.stroke();
    }
    if (selection) {
      const r = normRect(selection);
      ctx.strokeStyle = "#7fb4ff";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        (r.x0 - 1) * PX + 1,
        (r.y0 - 1) * PX + 1,
        (r.x1 - r.x0 + 1) * PX - 2,
        (r.y1 - r.y0 + 1) * PX - 2,
      );
    }
  };
  const tileAtEvent = (e: PointerEvent | MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    const scale = r.width > 0 ? r.width / canvas.width : 1;
    const x = Math.floor((e.clientX - r.left) / scale / PX) + 1;
    const y = Math.floor((e.clientY - r.top) / scale / PX) + 1;
    return {
      x: Math.min(MAP_WIDTH, Math.max(1, x)),
      y: Math.min(MAP_HEIGHT, Math.max(1, y)),
    };
  };

  /** One press of the active tool at a tile (the test hook drives it too). */
  const pressAt = (x: number, y: number) => {
    if (!map || busy || opening) {
      return;
    }
    const l = layerNow();
    switch (tool) {
      case "pencil":
      case "fat":
      case "bucket":
        if (tile) {
          drag = { x, y, before: map };
          map = brush(map, l, tool, tile, x, y);
          draw();
        }
        return;
      case "flood":
        if (tile) {
          change(floodFill(map, l, tile, x, y));
        }
        return;
      case "rect":
      case "select":
        drag = { x, y, before: map };
        selection = { x0: x, y0: y, x1: x, y1: y };
        draw();
        return;
      case "pick": {
        const code = codeAt(map, l, x, y);
        if (code) {
          setTile(code);
        }
        return;
      }
      case "paste":
        if (clip) {
          change(pasteClip(map, clip, x, y));
        }
        return;
      case "place": {
        if (!placing) {
          return;
        }
        const next = structuredClone(map);
        if (placing.kind === "mob") {
          const m = next.mobs[placing.index];
          if (m) {
            // Placed on a tile, it spawns there (no longer anywhere).
            next.mobs[placing.index] = { name: m.name, x, y };
          }
        } else {
          const it = next.items[placing.index];
          if (it) {
            next.items[placing.index] = { ...it, x, y };
          }
        }
        placing = null;
        setTool("pencil");
        change(next);
        return;
      }
    }
  };
  const moveTo = (x: number, y: number) => {
    hover.textContent = map
      ? `Tile ${x}, ${y}: ${LAYER_SHORT.map((n, i) => `${n} ${codeAt(map as EditorMap, i as LayerIndex, x, y) || "none"}`).join(" · ")}${footBlocked(codeAt(map, 0, x, y), codeAt(map, 1, x, y)) ? " · players can't walk here" : ""}`
      : "";
    if (!drag || !map) {
      return;
    }
    if (tool === "pencil" || tool === "fat") {
      map = brush(map, layerNow(), tool, tile, x, y);
      draw();
    } else if ((tool === "rect" || tool === "select") && selection) {
      selection = { ...selection, x1: x, y1: y };
      draw();
    }
  };
  const release = () => {
    if (!drag || !map) {
      drag = null;
      return;
    }
    const before = drag.before;
    drag = null;
    if (tool === "rect" && selection && tile) {
      map = fillRect(before, layerNow(), tile, selection);
      selection = null;
    }
    if (map !== before) {
      record();
      afterChange();
    } else {
      // A selection made: Copy, Cut and Delete can act on it.
      draw();
      update();
    }
  };
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture?.(e.pointerId);
    const t = tileAtEvent(e);
    pressAt(t.x, t.y);
  });
  canvas.addEventListener("pointermove", (e) => {
    const t = tileAtEvent(e);
    moveTo(t.x, t.y);
  });
  canvas.addEventListener("pointerup", () => release());
  // A cancelled press (the pointer taken away) leaves the map as it was before it.
  canvas.addEventListener("pointercancel", () => {
    if (drag) {
      map = drag.before;
      drag = null;
      selection = null;
      draw();
      update();
    }
  });
  el.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest("input, textarea")) {
      return;
    }
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      undo();
      e.preventDefault();
    } else if (k === "y" || (k === "z" && e.shiftKey)) {
      redo();
      e.preventDefault();
    } else if (k === "c") {
      copySel(false);
      e.preventDefault();
    } else if (k === "x") {
      copySel(true);
      e.preventDefault();
    } else if (k === "v" && clip) {
      setTool("paste");
      e.preventDefault();
    }
  });

  // ---- the palette ----
  const setTile = (code: string) => {
    tile = code;
    const t = content().tiles.catalogue.find((c) => c.code === code);
    currentTile.textContent = `Painting with ${code}${t?.name ? ` (${t.name})` : ""}${tileBlocked(code) ? ", which players can't walk onto" : ""}. Pick another in the Tiles tab.`;
    for (const b of paletteEl.querySelectorAll<HTMLElement>("[data-tile]")) {
      b.setAttribute("aria-pressed", b.dataset.tile === code ? "true" : "false");
    }
  };
  const drawPalette = () => {
    const words = paletteSearch.value.toLowerCase().split(/\s+/).filter(Boolean);
    // Only what a save takes: the palette pages' codes (`editorMapError` checks the same set).
    const all = content().tiles.catalogue.filter((t) => {
      if (!isPaletteCode(t.code)) {
        return false;
      }
      const text = `${t.code} ${t.name ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    const MAX = 240;
    paletteNote.textContent =
      all.length > MAX
        ? `${all.length} tiles: the first ${MAX} shown. Search to narrow them.`
        : `${all.length} tiles.`;
    paletteEl.replaceChildren(
      ...all.slice(0, MAX).map((t) => {
        const b = action(document.createElement("button"), "world-tile");
        b.type = "button";
        b.className = "world-tile";
        b.dataset.tile = t.code;
        b.title = `${t.code}${t.name ? ` ${t.name}` : ""}${tileBlocked(t.code) ? " (players can't walk onto it)" : ""}`;
        b.setAttribute("aria-label", b.title);
        b.setAttribute("aria-pressed", t.code === tile ? "true" : "false");
        const c = document.createElement("canvas");
        c.width = PX;
        c.height = PX;
        const ctx = c.getContext("2d");
        if (ctx && assets) {
          drawSprite(ctx, assets, "tiles", t.code, 0, 0, true);
        }
        b.append(c);
        b.addEventListener("click", () => setTile(t.code));
        return b;
      }),
    );
  };
  paletteSearch.addEventListener("input", drawPalette);

  // ---- spawns and items ----
  const drawSpawns = () => {
    if (!map) {
      spawnsEl.replaceChildren();
      return;
    }
    const m = map;
    spawnsEl.replaceChildren(
      ...m.mobs.map((mob, i) => {
        const row = document.createElement("div");
        row.className = "items-list-row";
        row.dataset.list = "spawns";
        const sel = action(document.createElement("select"), "world-spawn");
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "Empty";
        sel.append(none);
        for (const [group, names] of [
          ["Monsters", EDITOR_MONSTERS],
          ["NPCs", EDITOR_NPCS],
        ] as const) {
          const g = document.createElement("optgroup");
          g.label = group;
          for (const n of names) {
            const o = document.createElement("option");
            o.value = n;
            o.textContent = n;
            g.append(o);
          }
          sel.append(g);
        }
        sel.value = mob?.name ?? "";
        sel.addEventListener("change", () => {
          if (!map) {
            return;
          }
          // From the map as it is now (an item name may have been typed since this was drawn).
          const next = structuredClone(map);
          next.mobs[i] =
            sel.value === ""
              ? null
              : mob?.anywhere
                ? { name: sel.value, x: mob.x, y: mob.y, anywhere: true }
                : { name: sel.value, x: mob?.x ?? i + 1, y: mob?.y ?? 1 };
          change(next);
        });
        const at = document.createElement("span");
        at.className = "control-panel-field-help";
        at.textContent = mob
          ? mob.anywhere
            ? "Appears anywhere on the map (set with /roster). Pick on map to give it a tile."
            : `At tile ${mob.x}, ${mob.y}`
          : "";
        const pick = panelButton("world-spawn-pick", "Pick on map", () => {
          placing = { kind: "mob", index: i };
          setTool("place");
          say(status, "Click the tile where it appears.");
        });
        pick.disabled = !mob;
        pick.title = "Then click a tile on the map";
        row.append(labelled(`Spot ${i + 1}`, sel), at, pick);
        return row;
      }),
    );
  };
  const drawItems = () => {
    if (!map) {
      itemsEl.replaceChildren();
      return;
    }
    const m = map;
    addItemBtn.disabled = m.items.length >= EDITOR_ITEM_SLOTS;
    itemsEl.replaceChildren(
      ...m.items.map((it, i) => {
        const row = document.createElement("div");
        row.className = "items-list-row";
        row.dataset.list = "items";
        const name = noAutofill(action(document.createElement("input"), "world-item"));
        name.value = it.name;
        name.setAttribute("list", itemsList.id);
        // Typing changes the map at once (Save comes alive); leaving the field is one undo step.
        name.addEventListener("input", () => {
          if (!map || busy || opening) {
            return;
          }
          const next = structuredClone(map);
          const item = next.items[i];
          if (item) {
            item.name = name.value.trim();
            map = next;
            draw();
            update();
          }
        });
        const at = document.createElement("span");
        at.className = "control-panel-field-help";
        at.textContent = `At tile ${it.x}, ${it.y}`;
        row.append(
          labelled(`Item ${i + 1}`, name),
          at,
          panelButton("world-item-pick", "Pick on map", () => {
            placing = { kind: "item", index: i };
            setTool("place");
            say(status, "Click the tile it goes on.");
          }),
          panelButton("world-item-remove", "Remove", () => {
            if (!map) {
              return;
            }
            const next = structuredClone(map);
            next.items.splice(i, 1);
            stopPlacing();
            change(next);
          }),
        );
        return row;
      }),
    );
  };

  // ---- forms ----
  const formEdited = () => {
    status.textContent = "";
    update();
  };
  const fogEdited = () => {
    formEdited();
    void refreshFog();
  };
  // A form change (a field left, a box ticked, a choice made) is an undo step.
  form.addEventListener("change", () => {
    if (map && !busy && !opening) {
      record();
      update();
    }
  });
  /**
   * The faction choices: the world's factions, and the map's own key when the world no longer has
   * it (kept, so a save of something else does not drop it).
   */
  const fillFactions = (keep: string) => {
    const keys = content().social.factions.map((f) => f.key);
    factionSel.replaceChildren(
      ...[
        ["", "None"] as const,
        ...keys.map((k) => [k, k] as const),
        ...(keep !== "" && !keys.includes(keep)
          ? [[keep, `${keep} (no longer a faction)`] as const]
          : []),
      ].map(([v, t]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = t;
        return o;
      }),
    );
    factionSel.value = keep;
  };
  const fillForms = (m: EditorMap) => {
    header.value = m.header;
    signs.forEach((t, i) => {
      t.value = m.signs[i] ?? "";
    });
    const e1 = exitFieldsAfterLoad(m.exit1);
    const e2 = exitFieldsAfterLoad(m.exit2);
    exitFields[0].forEach((inp, i) => {
      inp.value = e1[i] ?? "";
    });
    exitFields[1].forEach((inp, i) => {
      inp.value = e2[i] ?? "";
    });
    safe.b.checked = m.flags.canFight === "O";
    noPvp.b.checked = m.flags.canPvp === "O";
    indoor.b.checked = m.flags.isIndoors === "O";
    fillFactions(m.flags.fctSpwn);
    fogTex.value =
      FOG_TEXTURES.find((t) => t.toLowerCase() === m.fog.tex.toLowerCase()) ?? m.fog.tex;
    fogBlend.value = String(m.fog.blend);
    [m.fog.r, m.fog.g, m.fog.b].forEach((n, i) => {
      const inp = fogRgb[i];
      if (inp) {
        inp.value = String(n);
      }
    });
  };
  /** Shows the view's map as opened; `keepHistory` after a save of it, so undo still reaches back. */
  const fill = (keepHistory = false) => {
    if (!view) {
      return;
    }
    map = structuredClone(view.map);
    loadedAt = { mx: view.map.mx, my: view.map.my };
    filledRevision = view.revision;
    if (!keepHistory) {
      history.clear();
    }
    selection = null;
    stopPlacing();
    fillForms(map);
    committed = currentMap();
    loaded = JSON.stringify(committed);
    void refreshFog();
    afterChange();
  };

  const drawHistory = () => {
    const v = view;
    historyEl.replaceChildren(
      ...(v?.versions ?? []).map((ver) => {
        const li = document.createElement("li");
        const t = document.createElement("span");
        t.textContent = `Replaced on ${ver.at.replace("T", " ").slice(0, 16)} UTC by ${ver.by} `;
        if (ver.blocked) {
          const why = document.createElement("span");
          why.className = "control-panel-field-help";
          why.textContent = `Can't be restored as it is: ${ver.blocked}`;
          li.append(t, why);
          return li;
        }
        li.append(
          t,
          panelButton("world-restore", "Restore this version", () => {
            if (!v || busy || opening || dirty()) {
              say(
                status,
                busy
                  ? "Wait for the save to finish."
                  : "Save or undo your changes before restoring a version.",
                false,
              );
              return;
            }
            busy = true;
            seq += 1;
            restoring.add(seq);
            update();
            actions.restore(seq, v.map.mx, v.map.my, ver.id, filledRevision);
          }),
        );
        return li;
      }),
    );
    if ((v?.versions.length ?? 0) === 0) {
      const li = document.createElement("li");
      li.className = "control-panel-field-help";
      li.textContent = v?.exists ? "No earlier versions yet." : "A new map: nothing saved yet.";
      historyEl.append(li);
    }
  };

  const update = () => {
    // Waiting for a save, a restore or another map: the map and forms cannot be edited meanwhile, so
    // the answer never overwrites a change made after the request went.
    form.inert = busy || opening;
    form.setAttribute("aria-busy", busy || opening ? "true" : "false");
    const v = view;
    if (!v) {
      return;
    }
    const id = `x${v.map.mx}y${v.map.my}`;
    const name = header.value.trim();
    title.textContent = name || `Map ${id}`;
    subtitle.textContent = name
      ? `Map ${id} (X ${v.map.mx}, Y ${v.map.my})`
      : `X ${v.map.mx}, Y ${v.map.my}`;
    tags.replaceChildren(
      ...(v.exists ? [] : [["New map: not saved yet", "pending"] as const]).map(([t, kind]) => {
        const s = document.createElement("span");
        s.className = `balance-tag items-tag-${kind}`;
        s.textContent = t;
        return s;
      }),
    );
    const isDirty = dirty();
    stale.hidden = !(isDirty && v.revision !== filledRevision);
    saveBtn.disabled = busy || opening || !(isDirty || !v.exists);
    saveBtn.textContent = v.exists ? "Save changes" : "Create this map";
    markUsed();
    dropBtn.hidden = !isDirty;
    undoBtn.disabled = !history.canUndo;
    redoBtn.disabled = !history.canRedo;
    for (const b of [copyBtn, cutBtn, deleteBtn]) {
      b.disabled = selection === null;
    }
  };

  /** A dot on each tab that holds something (`data-used`). */
  const markUsed = () => {
    if (!map) {
      return;
    }
    const m = currentMap();
    const used: Record<string, boolean> = {
      spawns: m.mobs.some((x) => x !== null),
      items: m.items.length > 0,
      exits: m.exit1 !== null || m.exit2 !== null,
      text: m.header.trim() !== "" || m.signs.some((x) => x.trim() !== ""),
      rules:
        m.flags.canFight === "O" ||
        m.flags.canPvp === "O" ||
        m.flags.isIndoors === "O" ||
        m.flags.fctSpwn !== "",
      fog: m.fog.tex.toLowerCase() !== NO_FOG.tex.toLowerCase(),
    };
    for (const sec of [sSpawns, sItems, sExits, sText, sRules, sFog]) {
      const u = String(used[sec.dataset.group ?? ""] === true);
      if (sec.dataset.used !== u) {
        sec.dataset.used = u;
      }
    }
    // The fog's colour fold opens when the colour is not plain white.
    if (m.fog.r !== 255 || m.fog.g !== 255 || m.fog.b !== 255) {
      fogMore.open = true;
    }
  };

  const drawStamps = () => {
    stampSel.replaceChildren(
      ...["", ...stamps.keys()].map((n) => {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n === "" ? "Paste a stamp…" : n;
        return o;
      }),
    );
  };
  drawStamps();

  const drawList = () => {
    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = maps.filter((m) => {
      const text =
        `${m.name} ${m.mx} ${m.my} ${m.title} ${m.roster.join(" ")} ${m.items.join(" ")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    listCount.textContent =
      rows.length > 400
        ? `${rows.length} of ${maps.length} maps: the first 400 shown. Search to narrow them.`
        : rows.length === maps.length
          ? `${maps.length} maps`
          : `${rows.length} of ${maps.length} maps`;
    listEl.replaceChildren(
      ...rows.slice(0, 400).map((m) => {
        const li = document.createElement("li");
        const b = action(document.createElement("button"), "world-open-map");
        b.type = "button";
        b.className = "items-list-item";
        b.dataset.map = m.name;
        if (loadedAt && loadedAt.mx === m.mx && loadedAt.my === m.my) {
          b.setAttribute("aria-current", "true");
        }
        const name = document.createElement("span");
        name.className = "items-list-name";
        // Its name when it has one, with its position; else its position.
        name.textContent = m.title || m.name;
        const meta = document.createElement("span");
        meta.className = "items-list-meta";
        meta.textContent = [...(m.title ? [m.name] : []), ...m.roster, ...m.items]
          .slice(0, 6)
          .join(" · ");
        b.append(name, " ", meta);
        b.addEventListener("click", () => openMap(m.mx, m.my));
        li.append(b);
        return li;
      }),
    );
  };
  search.addEventListener("input", drawList);

  const openMap = (mx: number, my: number) => {
    if (map && (dirty() || busy)) {
      say(
        status,
        busy
          ? "Wait for the save to finish."
          : "This map has unsaved changes: save them or undo them first.",
        false,
      );
      return;
    }
    openAt = { mx, my };
    mxIn.value = String(mx);
    myIn.value = String(my);
    status.textContent = "";
    // Until it comes, the map shown cannot be edited (its edits would be lost when it does).
    opening = map !== null && !(loadedAt?.mx === mx && loadedAt?.my === my);
    update();
    ask();
  };

  const fillItemChoices = () => {
    itemsList.replaceChildren(
      ...EDITOR_ITEMS.slice(1).map((n) => {
        const o = document.createElement("option");
        o.value = n;
        return o;
      }),
    );
  };
  /** The list's entry for a map as it was just saved (the list is asked for only on showing). */
  const listEntry = (m: EditorMap): MapListEntry => ({
    mx: m.mx,
    my: m.my,
    name: `x${m.mx}y${m.my}`,
    title: m.header,
    roster: m.mobs.flatMap((x) => (x ? [x.name] : [])),
    items: m.items.map((i) => i.name),
  });
  /** Shows a view; `filled` when its map was just filled (a save's answer), so it is not again. */
  const show = (v: ContentMapsView, filled = false) => {
    loading.hidden = true;
    if (v.maps) {
      maps = v.maps;
    } else if (v.map?.exists) {
      const e = listEntry(v.map.map);
      const i = maps.findIndex((m) => m.mx === e.mx && m.my === e.my);
      maps = i >= 0 ? maps.map((m, j) => (j === i ? e : m)) : [...maps, e];
    }
    if (itemsList.childElementCount === 0) {
      fillItemChoices();
    }
    drawList();
    const m = v.map;
    if (!m || !openAt || m.map.mx !== openAt.mx || m.map.my !== openAt.my) {
      return;
    }
    const first = !view || view.map.mx !== m.map.mx || view.map.my !== m.map.my;
    view = m;
    opening = false;
    form.hidden = false;
    empty.hidden = true;
    if (!filled && (first || (!dirty() && !busy))) {
      fill();
      if (first && !tile) {
        setTile(content().tiles.catalogue.find((t) => isPaletteCode(t.code))?.code ?? "");
        drawPalette();
        void loadArt();
      }
    }
    drawHistory();
    update();
  };

  return {
    el,
    onShow: () => ask(true),
    // A save on its way counts too: leaving now would not say whether it landed.
    changes: () => (dirty() || busy ? 1 : 0),
    discard() {
      if (!busy && !opening) {
        fill();
        status.textContent = "";
        update();
      }
    },
    receive(msg) {
      if (msg.seq <= resetSeq) {
        return;
      }
      const newer = msg.seq >= appliedSeq;
      const wasSaveNotRestore = saving.delete(msg.seq);
      const wasSave = wasSaveNotRestore || restoring.delete(msg.seq);
      let filled = false;
      if (wasSave) {
        busy = false;
        if (msg.result) {
          say(status, msg.result.text, msg.result.ok);
          if (msg.result.ok && msg.view.map) {
            view = msg.view.map;
            // A save keeps the undo history (the same map, as it now is); a restore starts afresh.
            fill(wasSaveNotRestore);
            filled = true;
          }
        }
      }
      if (!newer) {
        update();
        return;
      }
      appliedSeq = msg.seq;
      show(msg.view, filled);
    },
    reset() {
      seq += 1;
      resetSeq = seq;
      appliedSeq = seq;
      saving.clear();
      restoring.clear();
      maps = [];
      opening = false;
      committed = null;
      fog = { key: "", layer: null, blend: 0 };
      openAt = null;
      loadedAt = null;
      view = null;
      map = null;
      loaded = "";
      filledRevision = null;
      history.clear();
      busy = false;
      selection = null;
      clip = null;
      stamps.clear();
      drawStamps();
      placing = null;
      drag = null;
      tile = "";
      search.value = "";
      status.textContent = "";
      listEl.replaceChildren();
      form.hidden = true;
      empty.hidden = false;
      goStatus.textContent = "";
      loading.hidden = false;
    },
    open(mx, my) {
      openMap(mx, my);
    },
    prefer(mx, my) {
      if (!map && !openAt) {
        openAt = { mx, my };
        mxIn.value = String(mx);
        myIn.value = String(my);
      }
    },
    published() {
      // A tile the content no longer has is not painted with.
      if (tile && !isPaletteCode(tile)) {
        setTile(content().tiles.catalogue.find((t) => isPaletteCode(t.code))?.code ?? "");
      }
      fillItemChoices();
      drawPalette();
      if (map) {
        drawSpawns();
        drawItems();
        fillFactions(factionSel.value);
        fog.key = "";
        void refreshFog();
        draw();
      }
    },
    connectionLost() {
      const waiting = busy;
      busy = false;
      opening = false;
      saving.clear();
      restoring.clear();
      if (waiting) {
        say(
          status,
          "The connection dropped before the answer came, so it isn't known whether it saved. Your changes are kept; if a save (yours too) landed, the page says so.",
          false,
        );
      }
      update();
    },
  };
}
