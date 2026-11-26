/**
 * The Control Panel's Publish Changes page (issue #27; the Content page before) and its Pictures &
 * Sounds page (`artEl`). The live content store is built from the installed packs (Classic by
 * default) plus the operator's changes; every editor page saves into one shared draft, and this
 * page publishes it. 1.6 had nothing like it (content was compiled into the client and server); it
 * is a plain SSO page built from the Control Panel's shared parts.
 *
 * - **Pack updates**: a row a newer pack version changed after you customised it, with what the
 *   pack changed and how yours differs in plain words (content-diff.ts), to take the pack's version
 *   or keep yours.
 * - **Unpublished changes**: the one shared draft, each change with its author; clicking one opens
 *   it on the page that edits it. Its pre-publish checks, the removals it holds, and Publish. A
 *   publish another admin's change would overwrite is refused.
 * - **Where it is used**, shown while a row is open (issues #28 and #44, content-usage.ts): an
 *   item, a monster or a vehicle with every place that holds it, and its removal with the cleanup;
 *   Restore the original and Cancel unpublished change for any row. No row is edited as JSON here:
 *   every part of the content has a page with a form (content-areas.ts).
 * - **History**, with Undo for a whole publish and what each publish did to the world.
 * - **Find problems**: references nothing resolves, in content and in the world.
 * - **Pictures & Sounds** (issue #29): item pictures (item-art.ts), worn layers (worn-art.ts),
 *   bodies (body-art.ts), spell effects (fx-art.ts), tiles (tile-art.ts) and sounds (sound-art.ts),
 *   one kind at a time, with bulk uploads. The Items, Creatures and Spells pages show one record's
 *   panel through `itemPanels`, `monsterBody`, `spellEffect` and `housePreview`.
 */
import type { ArtFrameId } from "@secondstaronline/data";
import type {
  BodyChange,
  ContentBodyArtView,
  ContentDraftView,
  ContentFxArtView,
  ContentItemArtView,
  ContentListing,
  ContentNoticeView,
  ContentOverview,
  ContentProblemView,
  ContentPublishView,
  ContentRowDetail,
  ContentRowRef,
  ContentRowStatus,
  ContentSoundArtView,
  ContentTileArtView,
  ContentUsageView,
  ContentWornArtView,
  FxChange,
  FxSheetLayout,
  PictureChange,
  SoundChange,
  TileChange,
  WornChange,
} from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action, gameInput } from "./action.ts";
import { createArtUploader, postUpload } from "./art-uploads.ts";
import { createBodies, createBodyArtPicker } from "./body-art.ts";
import {
  DATASET_TEXT,
  drawRemovals,
  drawUsage,
  type RemovalPlan,
  removalForm,
  removalHeadline,
  rowName,
  words,
} from "./content-usage.ts";

export { rowName };

import { HOME_TITLES, homeOf } from "./content-areas.ts";
import { plainChanges } from "./content-diff.ts";
import {
  confirmBox,
  confirmChoice,
  createTable,
  formField,
  pageHeading,
  panelButton,
} from "./control-panel-kit.ts";
import { createFxArtPicker, createSpellEffects } from "./fx-art.ts";
import { createHouseArtPanel } from "./house-art.ts";
import { createItemArtPicker, createItemPictures } from "./item-art.ts";
import { createSounds } from "./sound-art.ts";
import { createTiles } from "./tile-art.ts";
import { createWornArtPicker, createWornLayers } from "./worn-art.ts";

/** What the page asks the server for (each answer comes back with its `seq`). */
export interface ContentPageActions {
  overview(seq: number): void;
  list(seq: number, dataset: string, part: string): void;
  row(seq: number, ref: ContentRowRef): void;
  /**
   * Puts a change in the draft. `expect` is the row's revision as it was opened, for a row that
   * carries one (a balance row): the server refuses the change once the row has changed since.
   */
  draft(
    seq: number,
    ref: ContentRowRef,
    op: "set" | "remove" | "revert",
    data: unknown,
    expect?: string,
  ): void;
  discard(seq: number, ref: ContentRowRef, expect?: string): void;
  /**
   * Opens a change on its own editor page (`editorFor`); false when no page fits or may be opened,
   * and the change opens here, as JSON.
   */
  openEditor?(ref: ContentRowRef): boolean;
  /** `logoutEveryone`: log every other player out while it publishes (issue #40). */
  publish(seq: number, summary: string, draftRev: string, logoutEveryone: boolean): void;
  undo(seq: number, id: string): void;
  notice(seq: number, ref: ContentRowRef, accept: boolean): void;
  /** Where an item or a monster is used. */
  usage(seq: number, kind: "item" | "monster" | "vehicle", key: string): void;
  /** Puts a removal with its cleanup in the draft. */
  remove(seq: number, plan: RemovalPlan): void;
  /** The references nothing resolves. */
  problems(seq: number): void;
  /** A ticket for uploading art and sounds (issue #29). */
  uploadTicket(seq: number): void;
  /** The draft's items and their pictures, for the item picture picker. */
  itemArt(seq: number): void;
  /** One picture change, made in the draft as a whole by the server. */
  picture(seq: number, change: PictureChange): void;
  /** The draft's worn layers, for the worn picture panels. */
  wornArt(seq: number): void;
  /** Cuts an uploaded worn sheet into frame files. */
  wornSheet(seq: number, sheet: string): void;
  /** One worn layer change, made in the draft as a whole by the server. */
  worn(seq: number, change: WornChange): void;
  /** The draft's bodies, for the body panels. */
  bodyArt(seq: number): void;
  /** Cuts an uploaded body sheet into its 16 frame files. */
  bodySheet(seq: number, sheet: string): void;
  /** One body change, made in the draft as a whole by the server. */
  body(seq: number, change: BodyChange): void;
  /** The draft's effect runs, for the effect panels. */
  fxArt(seq: number): void;
  /** Cuts an uploaded effect strip into its run's and trail's frame files. */
  fxSheet(seq: number, sheet: string, layout: FxSheetLayout): void;
  /** One effect run change, made in the draft as a whole by the server. */
  fx(seq: number, change: FxChange): void;
  /** The draft's tiles, for the tile panels. */
  tileArt(seq: number): void;
  /** Cuts an uploaded tileset into tile files. */
  tileSheet(seq: number, sheet: string, transparency: "alpha" | "green"): void;
  /** One tile change, made in the draft as a whole by the server. */
  tile(seq: number, change: TileChange): void;
  /** The draft's sounds, for the sound panels. */
  soundArt(seq: number): void;
  /** One sound change, made in the draft as a whole by the server. */
  sound(seq: number, change: SoundChange): void;
  /** Opens a character's hub (a holder in a usage report). */
  openCharacter(name: string): void;
}

export type ContentReply =
  | { t: "contentOverview"; seq: number; overview: ContentOverview }
  | { t: "contentList"; seq: number; listing: ContentListing | null; error?: string }
  | { t: "contentRow"; seq: number; row: ContentRowDetail | null; error?: string }
  | { t: "contentUsage"; seq: number; usage: ContentUsageView | null; error?: string }
  | {
      t: "contentProblems";
      seq: number;
      content: ContentProblemView[];
      world: ContentProblemView[];
    }
  | {
      t: "contentResult";
      seq: number;
      ok: boolean;
      text: string;
      problems?: ContentProblemView[];
      body?: number;
      run?: string;
      codes?: string[];
      sound?: string;
    }
  | { t: "contentUploadTicket"; seq: number; ticket: string; maxBytes: number }
  | { t: "contentItemArt"; seq: number; view: ContentItemArtView }
  | { t: "contentWornArt"; seq: number; view: ContentWornArtView }
  | {
      t: "contentWornSheet";
      seq: number;
      frames: Partial<Record<ArtFrameId, string>> | null;
      error?: string;
    }
  | { t: "contentBodyArt"; seq: number; view: ContentBodyArtView }
  | {
      t: "contentBodySheet";
      seq: number;
      frames: Partial<Record<ArtFrameId, string>> | null;
      cell?: { w: number; h: number };
      error?: string;
    }
  | { t: "contentFxArt"; seq: number; view: ContentFxArtView }
  | {
      t: "contentFxSheet";
      seq: number;
      frames: string[] | null;
      trail?: string[];
      cell?: { w: number; h: number };
      error?: string;
    }
  | { t: "contentTileArt"; seq: number; view: ContentTileArtView }
  | { t: "contentSoundArt"; seq: number; view: ContentSoundArtView }
  | {
      t: "contentTileSheet";
      seq: number;
      cells: { col: number; row: number; file: string }[] | null;
      grid?: { cols: number; rows: number };
      error?: string;
    };

export interface ContentPage {
  readonly el: HTMLElement;
  /** The page was shown: ask for the overview (and the rows on screen). */
  onShow(): void;
  /** The page stopped showing: a sound preview stops. */
  onHide(): void;
  receive(msg: ContentReply): void;
  /** The published store changed (a publish by anyone): refresh what is on screen. */
  published(): void;
  /** Opens a row in the editor (the Balance page's links to other datasets' rows). */
  openRow(r: ContentRowRef): void;
  /**
   * The Items page's picture and worn panels (issue #30): #29's panels, made once, talking to the
   * server through this page. `saved` runs when one of them put a change in the draft. Null with no
   * art to draw them.
   */
  itemPanels(saved: () => void): ItemPanels | null;
  /**
   * The Monsters page's body panel (issue #31): #29's body panel, made once, talking to the server
   * through this page. Null with no art to draw it.
   */
  monsterBody(saved: () => void): MonsterBodyPanel | null;
  /** The Spells page's cast-effect panel. Null with no art to draw it. */
  spellEffect(saved: () => void): RecordPanel | null;
  /** The House types tab's placement preview panel (issue #10). Null with no art to draw it. */
  housePreview(saved: () => void): RecordPanel | null;
  /** The Pictures & Sounds page: every picture and sound, one kind at a time. */
  readonly artEl: HTMLElement;
  /** Picture work set up and not yet saved. */
  changes(): number;
  discard(): void;
  reset(): void;
}

/** #29's picture and worn panels for one item, as the Items page shows them. */
export interface ItemPanels {
  readonly el: HTMLElement;
  /**
   * Shows the item's picture and, when it is worn, its worn layer (the draft's). Each panel is
   * refreshed on its own: one holding a picture or frames not yet saved is left as it is, unless
   * `force` (the page's edits were dropped).
   */
  show(key: string, force?: boolean): void;
  clear(): void;
  /** A picture or frames set up and not yet saved to the draft. */
  pending(): boolean;
}

/**
 * A picture panel for one record of an editor page (a creature's body, a spell's cast effect):
 * #29's panel, made once, talking to the server through this page.
 */
export interface RecordPanel {
  readonly el: HTMLElement;
  /** Shows the record's picture (the draft's); one holding unsaved work is kept unless `force`. */
  show(key: string, force?: boolean): void;
  clear(): void;
  /** Work set up and not yet saved to the draft. */
  pending(): boolean;
}

/** #29's body panel for one monster, as the Monsters page shows it (issue #31). */
export interface MonsterBodyPanel {
  readonly el: HTMLElement;
  /** Shows the monster's body (the draft's); one holding unsaved frames is kept unless `force`. */
  show(monster: string, force?: boolean): void;
  clear(): void;
  /** Frames set up and not yet saved to the draft. */
  pending(): boolean;
}

/** The part of a picture panel `makeItemPanels` drives. */
interface PanelLike<V, A> {
  readonly el: HTMLElement;
  show(item: A, view: V): void;
  clear(): void;
  pending(): boolean;
}

/**
 * The Items page's two panels over the server's views (exported for its tests). Each refreshes on
 * its own: one holding unsaved work keeps it, but a panel that has just saved refreshes though it
 * still looks pending, since what it held is in the draft now.
 */
export function makeItemPanels(
  make: (
    picSaved: () => void,
    wornSaved: () => void,
  ) => {
    pic: PanelLike<ContentItemArtView, ContentItemArtView["items"][number]>;
    worn: PanelLike<ContentWornArtView, { kind: "item"; item: string }>;
  },
  askItemArt: () => Promise<ContentItemArtView>,
  askWornArt: () => Promise<ContentWornArtView>,
  saved: () => void,
): ItemPanels {
  let picJustSaved = false;
  let wornJustSaved = false;
  const { pic, worn } = make(
    () => {
      picJustSaved = true;
      saved();
    },
    () => {
      wornJustSaved = true;
      saved();
    },
  );
  const el = document.createElement("div");
  el.className = "items-pictures";
  el.append(pic.el, worn.el);
  let mine = 0;
  let shown: string | null = null;
  return {
    el,
    show(key, force = false) {
      const at = ++mine;
      const other = shown === null || shown.toLowerCase() !== key.toLowerCase();
      shown = key;
      const same = (n: string) => n.toLowerCase() === key.toLowerCase();
      // Another item, or dropped edits, refresh both; otherwise a panel with unsaved work keeps
      // it (saving the picture must not wipe frames set up beside it).
      const keepPic = !force && !other && !picJustSaved && pic.pending();
      const keepWorn = !force && !other && !wornJustSaved && worn.pending();
      picJustSaved = false;
      wornJustSaved = false;
      void askItemArt()
        .then((view) => {
          if (at !== mine || shown === null || keepPic) {
            return;
          }
          const item = view.items.find((i) => same(i.name));
          if (item) {
            pic.show(item, view);
          } else {
            pic.clear();
          }
        })
        .catch(() => pic.clear());
      void askWornArt()
        .then((view) => {
          if (at !== mine || shown === null || keepWorn) {
            return;
          }
          if (view.items.some((i) => same(i.name))) {
            worn.show({ kind: "item", item: key }, view);
          } else {
            worn.clear();
          }
        })
        .catch(() => worn.clear());
    },
    clear() {
      mine += 1;
      shown = null;
      pic.clear();
      worn.clear();
    },
    pending: () => pic.pending() || worn.pending(),
  };
}

/** Just a row's ref (a notice or draft row carries more, which an intent's strict schema refuses). */
export function refOf(r: ContentRowRef): ContentRowRef {
  return { dataset: r.dataset, part: r.part, key: r.key };
}

/** `items/items/Ale`, `casino/blackjack`. */
export function refLabel(r: ContentRowRef): string {
  return r.key === null ? `${r.dataset}/${r.part}` : `${r.dataset}/${r.part}/${r.key}`;
}

const OP_TEXT: Record<ContentDraftView["op"], string> = {
  set: "Changed",
  remove: "Removed",
  revert: "Back to the original",
};

const STATUS_TEXT: Record<ContentRowStatus, string> = {
  pack: "Original",
  changed: "Changed by you",
  added: "Added by you",
  removed: "Removed",
};

/** `items/items/Ale` back to its row (a history line names rows by their path). */
function refFromLabel(label: string): ContentRowRef {
  const [dataset = "", part = "", ...rest] = label.split("/");
  return { dataset, part, key: rest.length > 0 ? rest.join("/") : null };
}

/** The item, monster or vehicle a row is, or null for any other row. */
export function entryOf(
  r: ContentRowRef,
): { kind: "item" | "monster" | "vehicle"; key: string } | null {
  if (r.key === null) {
    return null;
  }
  if (r.dataset === "items" && r.part === "items") {
    return { kind: "item", key: r.key };
  }
  if (r.dataset === "monsters" && r.part === "monsters") {
    return { kind: "monster", key: r.key };
  }
  if (r.dataset === "houses" && r.part === "vehicles") {
    return { kind: "vehicle", key: r.key };
  }
  return null;
}

/** `2026-11-22T09:15:03.120Z` → `2026-11-22 09:15`. */
const when = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/** How `b` differs from `a`, one plain line per value that differs. */
function diffBlock(ref: ContentRowRef, label: string, a: unknown, b: unknown): HTMLElement {
  const box = document.createElement("figure");
  box.className = "content-diff";
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  const ul = document.createElement("ul");
  ul.className = "content-diff-lines";
  const lines =
    b === null || b === undefined
      ? [{ where: "", what: "removed" }]
      : plainChanges(ref.dataset, ref.part, a, b);
  for (const c of lines.length > 0 ? lines : [{ where: "", what: "nothing" }]) {
    const li = document.createElement("li");
    if (c.where) {
      const w = document.createElement("strong");
      w.textContent = `${c.where}: `;
      li.append(w);
    }
    li.append(c.what);
    ul.append(li);
  }
  box.append(cap, ul);
  return box;
}

function section(title: string, intro = ""): { el: HTMLElement; body: HTMLElement } {
  const el = document.createElement("section");
  el.className = "content-section";
  const h = document.createElement("h2");
  h.className = "content-section-title";
  h.textContent = title;
  el.append(h);
  if (intro) {
    const p = document.createElement("p");
    p.className = "content-section-intro";
    p.textContent = intro;
    el.append(p);
  }
  const body = document.createElement("div");
  el.append(body);
  return { el, body };
}

function problemList(problems: readonly ContentProblemView[]): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "content-problems";
  for (const p of problems) {
    const li = document.createElement("li");
    const where = document.createElement("code");
    where.textContent = p.where;
    li.append(where, `: ${p.message}`);
    ul.append(li);
  }
  return ul;
}

export function createContentPage(actions: ContentPageActions, assets?: Assets): ContentPage {
  const root = document.createElement("section");
  root.className = "content-page plain-editor";
  root.append(
    pageHeading(
      "Publish Changes",
      "Changes saved on the other pages wait here, unpublished, until someone publishes them: players get them at once, with no restart. Click a change to see it on its page. History lists every publish, with Undo.",
    ),
  );

  let seq = 0;
  const next = () => ++seq;
  let overview: ContentOverview | null = null;
  /** The answers we wait for, by kind. */
  let overviewSeq = -1;
  let rowSeq = -1;
  let resultSeq = -1;
  let usageSeq = -1;
  let problemsSeq = -1;
  /** What the last action was, to know what to refresh after its result. */
  let afterResult: () => void = () => {};
  /**
   * Whether the last action was the row editor's (save, remove, revert, discard its change): only
   * its result is the editor's to show, and only it makes the editor's text the saved text.
   */
  let resultInEditor = false;

  const status = document.createElement("p");
  status.className = "content-status";
  status.setAttribute("role", "status");
  status.hidden = true;
  const say = (text: string, problems: readonly ContentProblemView[] = []) => {
    status.replaceChildren(text);
    if (problems.length > 0) {
      status.append(problemList(problems));
    }
    status.hidden = text === "";
  };
  root.append(status);

  // ---- pack updates ---------------------------------------------------------------------------
  const notices = section(
    "Pack updates waiting for you",
    "A pack update changed something you had already changed. Players keep your version until you choose which to keep.",
  );
  const noticeList = document.createElement("div");
  notices.body.append(noticeList);
  const drawNotices = (list: readonly ContentNoticeView[]) => {
    notices.el.hidden = list.length === 0;
    noticeList.replaceChildren(
      ...list.map((n) => {
        const box = document.createElement("article");
        box.className = "content-notice";
        box.dataset.row = refLabel(n);
        const p = document.createElement("p");
        p.textContent = `${n.packName} v${n.packVersion} changed ${rowName(n)}, which you had ${n.yoursOp === "remove" ? "removed" : "changed"}.`;
        p.title = refLabel(n);
        const diffs = document.createElement("div");
        diffs.className = "content-diffs";
        diffs.append(
          diffBlock(n, `What ${n.packName} changed`, n.was, n.now),
          diffBlock(n, `How yours differs from ${n.packName}'s new version`, n.now, n.yours),
        );
        const buttons = document.createElement("div");
        buttons.className = "content-buttons";
        buttons.append(
          panelButton("content-notice-accept", `Use ${n.packName}'s version`, () => {
            void confirmBox(root, {
              text: `Replace your version of ${rowName(n)} with ${n.packName}'s? Players get it at once (you can undo it from the History tab).`,
              confirm: `Use ${n.packName}'s version`,
              cancel: "Keep mine",
            }).then((yes) => {
              if (yes) {
                resultSeq = next();
                resultInEditor = false;
                afterResult = refreshAll;
                actions.notice(resultSeq, refOf(n), true);
              }
            });
          }),
          panelButton("content-notice-dismiss", "Keep mine", () => {
            resultSeq = next();
            resultInEditor = false;
            afterResult = refreshAll;
            actions.notice(resultSeq, refOf(n), false);
          }),
        );
        box.append(p);
        if (n.note) {
          const note = document.createElement("p");
          note.className = "content-notice-note";
          note.textContent = n.note;
          box.append(note);
        }
        box.append(diffs, buttons);
        return box;
      }),
    );
  };

  // ---- the draft ------------------------------------------------------------------------------
  const draft = section(
    "Unpublished changes",
    "Changes made on the editor pages by every admin wait here until someone publishes them. They are checked first: anything that would break the game is listed below and must be fixed before you can publish.",
  );
  const draftTable = createTable<ContentDraftView>({
    label: "Draft changes",
    empty:
      "Nothing to publish: there are no unpublished changes. Make changes on the Items, Creatures & NPCs or other editor pages.",
    key: refLabel,
    // A change opens on the page that edits it; "Where it is used" is the fallback.
    open: {
      id: "content-draft-open",
      run: (d) => {
        if (!actions.openEditor?.(refOf(d))) {
          openRow(d);
        }
      },
    },
    columns: [
      {
        label: "What",
        cell: (d) => {
          const s = document.createElement("span");
          s.textContent = rowName(d);
          const home = homeOf(d.dataset, d.part);
          s.title = home ? `Opens on the ${HOME_TITLES[home]} page` : "";
          return s;
        },
      },
      { label: "Change", cell: (d) => (d.added ? "Added" : OP_TEXT[d.op]) },
      { label: "By", cell: (d) => d.author },
      { label: "When (UTC)", cell: (d) => when(d.updatedAt) },
      {
        label: "",
        cell: (d) => {
          const box = document.createElement("div");
          box.className = "content-buttons";
          box.append(
            panelButton("content-draft-discard", "Cancel this change", () => {
              // Taking a change out can't be undone: ask first.
              void confirmBox(root, {
                text: `Cancel the unpublished change to ${rowName(d)}? It is thrown away and can't be brought back.`,
                confirm: "Cancel the change",
                cancel: "Keep it",
                danger: true,
              }).then((yes) => {
                if (yes) {
                  resultSeq = next();
                  resultInEditor = false;
                  afterResult = refreshAll;
                  actions.discard(resultSeq, refOf(d), d.revision);
                }
              });
            }),
          );
          return box;
        },
      },
    ],
  });
  const checks = document.createElement("div");
  checks.className = "content-checks";
  const summary = gameInput("content-summary");
  summary.type = "text";
  summary.maxLength = 200;
  summary.placeholder = "Cheaper ale, stronger orcs…";
  const publishBtn = panelButton(
    "content-publish",
    "Publish",
    () => {
      if (!overview || overview.draft.length === 0) {
        return;
      }
      const count = overview.draft.length;
      const draftRev = overview.draftRev;
      const removing = overview.removals ?? [];
      // Off by default; suggested when the draft removes something players hold or the world has.
      const inWorld = removing.some((r) => r.inWorld > 0);
      void confirmChoice(root, {
        text: `Publish ${count} change${count === 1 ? "" : "s"}? They go live for every player at once.`,
        confirm: "Publish",
        cancel: "Not yet",
        ...(removing.length > 0 ? { list: [removalHeadline(removing)] } : {}),
        check: {
          action: "content-publish-logout",
          label: "Log everyone out while publishing",
          hint: inWorld
            ? "Suggested: this draft removes items or monsters that players hold or that are in the world, or a class characters are in. Everyone but you is logged out and saved first, and nobody can log in until the publish ends."
            : "Everyone but you is logged out and saved first, and nobody can log in until the publish ends.",
        },
      }).then(({ yes, checked }) => {
        if (yes) {
          resultSeq = next();
          resultInEditor = false;
          afterResult = () => {
            summary.value = "";
            refreshAll();
          };
          actions.publish(resultSeq, summary.value, draftRev, checked);
        }
      });
    },
    "primary",
  );
  const publishRow = document.createElement("div");
  publishRow.className = "content-publish";
  publishRow.append(
    formField(
      "Note for the history (optional)",
      summary,
      "What this publish changes, shown in the History tab.",
    ),
    publishBtn,
  );
  let removals = drawRemovals([]);
  draft.body.append(draftTable.el, checks, removals, publishRow);

  // ---- where it is used ----------------------------------------------------------------------
  const rows = section(
    "Where it is used",
    "An item, a creature or a vehicle, with every place that uses it. Removing one asks what happens to each of them.",
  );

  // ---- item pictures (issue #29) --------------------------------------------------------------
  /** Draft changes waiting for their result, by seq (the picture picker's saves). */
  /** A content change's answer; `body` is the body a body change drew on. */
  type ContentAnswer = {
    ok: boolean;
    text: string;
    body?: number;
    run?: string;
    codes?: string[];
    sound?: string;
    problems?: { where: string; message: string }[];
  };
  const resultWaits = new Map<number, (r: ContentAnswer) => void>();
  const itemArtWaits = new Map<number, (v: ContentItemArtView) => void>();
  const wornArtWaits = new Map<number, (v: ContentWornArtView) => void>();
  const bodyArtWaits = new Map<number, (v: ContentBodyArtView) => void>();
  const fxArtWaits = new Map<number, (v: ContentFxArtView) => void>();
  const tileArtWaits = new Map<number, (v: ContentTileArtView) => void>();
  const soundArtWaits = new Map<number, (v: ContentSoundArtView) => void>();
  type TileCut =
    | {
        ok: true;
        grid: { cols: number; rows: number };
        cells: { col: number; row: number; file: string }[];
      }
    | { ok: false; error: string };
  const tileSheetWaits = new Map<number, (r: TileCut) => void>();
  const fxSheetWaits = new Map<
    number,
    (
      r:
        | { ok: true; cell: { w: number; h: number }; frames: string[]; trail: string[] }
        | { ok: false; error: string },
    ) => void
  >();
  const bodySheetWaits = new Map<
    number,
    (
      r:
        | { ok: true; cell: { w: number; h: number }; frames: Partial<Record<ArtFrameId, string>> }
        | { ok: false; error: string },
    ) => void
  >();
  const sheetWaits = new Map<
    number,
    (
      r: { ok: true; frames: Partial<Record<ArtFrameId, string>> } | { ok: false; error: string },
    ) => void
  >();
  /** Ticket requests waiting for their answer, by seq. */
  const ticketWaits = new Map<number, (t: { ticket: string; maxBytes: number }) => void>();
  const ticket = (): Promise<{ ticket: string; maxBytes: number }> =>
    new Promise((resolve, reject) => {
      const s = next();
      ticketWaits.set(s, resolve);
      actions.uploadTicket(s);
      setTimeout(() => {
        if (ticketWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** The draft's items and pictures, as the picker needs them. */
  const askItemArt = (): Promise<ContentItemArtView> =>
    new Promise((resolve, reject) => {
      const s = next();
      itemArtWaits.set(s, resolve);
      actions.itemArt(s);
      setTimeout(() => {
        if (itemArtWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** The draft's worn layers, as the worn panels need them. */
  const askWornArt = (): Promise<ContentWornArtView> =>
    new Promise((resolve, reject) => {
      const s = next();
      wornArtWaits.set(s, resolve);
      actions.wornArt(s);
      setTimeout(() => {
        if (wornArtWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** The draft's bodies, as the body panels need them. */
  const askBodyArt = (): Promise<ContentBodyArtView> =>
    new Promise((resolve, reject) => {
      const s = next();
      bodyArtWaits.set(s, resolve);
      actions.bodyArt(s);
      setTimeout(() => {
        if (bodyArtWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** The draft's effect runs, as the effect panels need them. */
  const askFxArt = (): Promise<ContentFxArtView> =>
    new Promise((resolve, reject) => {
      const s = next();
      fxArtWaits.set(s, resolve);
      actions.fxArt(s);
      setTimeout(() => {
        if (fxArtWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** The draft's tiles, as the tile panels need them. */
  const askTileArt = (): Promise<ContentTileArtView> =>
    new Promise((resolve, reject) => {
      const s = next();
      tileArtWaits.set(s, resolve);
      actions.tileArt(s);
      setTimeout(() => {
        if (tileArtWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** The draft's sounds, as the sound panels need them. */
  const askSoundArt = (): Promise<ContentSoundArtView> =>
    new Promise((resolve, reject) => {
      const s = next();
      soundArtWaits.set(s, resolve);
      actions.soundArt(s);
      setTimeout(() => {
        if (soundArtWaits.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });
  /** Waits for a draft change's `contentResult`. */
  const awaitResult = (send: (seq: number) => void) =>
    new Promise<ContentAnswer>((resolve) => {
      const s = next();
      resultWaits.set(s, resolve);
      send(s);
      setTimeout(() => {
        if (resultWaits.delete(s)) {
          resolve({ ok: false, text: "The server did not answer." });
        }
      }, 15_000);
    });
  const artOptions = assets
    ? {
        assets,
        async upload(file: File) {
          try {
            const t = await ticket();
            if (file.size > t.maxBytes) {
              return {
                ok: false as const,
                error: `the file is ${Math.ceil(file.size / 1024)} KB; uploads may be at most ${Math.floor(t.maxBytes / 1024)} KB`,
              };
            }
            return (
              (await postUpload(file, "image", t.ticket)) ?? {
                ok: false as const,
                error: "the server did not answer",
              }
            );
          } catch (e) {
            return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
          }
        },
        apply(change: PictureChange) {
          return awaitResult((s) => actions.picture(s, change));
        },
        saved() {
          refreshAll();
          refreshRow();
        },
      }
    : null;
  const wornOptions = artOptions
    ? {
        ...artOptions,
        apply(change: WornChange) {
          return awaitResult((s) => actions.worn(s, change));
        },
        slice(sheet: string) {
          return new Promise<
            { ok: true; frames: Partial<Record<ArtFrameId, string>> } | { ok: false; error: string }
          >((resolve) => {
            const s = next();
            sheetWaits.set(s, resolve);
            actions.wornSheet(s, sheet);
            setTimeout(() => {
              if (sheetWaits.delete(s)) {
                resolve({ ok: false, error: "the server did not answer" });
              }
            }, 15_000);
          });
        },
      }
    : null;
  const bodyOptions = artOptions
    ? {
        ...artOptions,
        apply(change: BodyChange) {
          return awaitResult((s) => actions.body(s, change));
        },
        saved() {
          refreshAll();
          refreshRow();
        },
        slice(sheet: string) {
          return new Promise<
            | {
                ok: true;
                cell: { w: number; h: number };
                frames: Partial<Record<ArtFrameId, string>>;
              }
            | { ok: false; error: string }
          >((resolve) => {
            const s = next();
            bodySheetWaits.set(s, resolve);
            actions.bodySheet(s, sheet);
            setTimeout(() => {
              if (bodySheetWaits.delete(s)) {
                resolve({ ok: false, error: "the server did not answer" });
              }
            }, 15_000);
          });
        },
      }
    : null;
  const fxOptions = artOptions
    ? {
        ...artOptions,
        apply(change: FxChange) {
          return awaitResult((s) => actions.fx(s, change));
        },
        saved(_spells: string[]) {
          refreshAll();
        },
        slice(sheet: string, layout: FxSheetLayout) {
          return new Promise<
            | { ok: true; cell: { w: number; h: number }; frames: string[]; trail: string[] }
            | { ok: false; error: string }
          >((resolve) => {
            const s = next();
            fxSheetWaits.set(s, resolve);
            actions.fxSheet(s, sheet, layout);
            setTimeout(() => {
              if (fxSheetWaits.delete(s)) {
                resolve({ ok: false, error: "the server did not answer" });
              }
            }, 15_000);
          });
        },
      }
    : null;
  const tileOptions = artOptions
    ? {
        assets: artOptions.assets,
        upload: artOptions.upload,
        apply(change: TileChange) {
          return awaitResult((s) => actions.tile(s, change));
        },
        saved() {
          refreshAll();
        },
        slice(sheet: string, transparency: "alpha" | "green") {
          return new Promise<TileCut>((resolve) => {
            const s = next();
            tileSheetWaits.set(s, resolve);
            actions.tileSheet(s, sheet, transparency);
            setTimeout(() => {
              if (tileSheetWaits.delete(s)) {
                resolve({ ok: false, error: "the server did not answer" });
              }
            }, 15_000);
          });
        },
      }
    : null;
  const soundOptions = assets
    ? {
        async upload(file: File, still: () => boolean = () => true) {
          try {
            if (!still()) {
              return { ok: false as const, error: "" };
            }
            const t = await ticket();
            // The section moved on while the ticket came: nothing is posted.
            if (!still()) {
              return { ok: false as const, error: "" };
            }
            if (file.size > t.maxBytes) {
              return {
                ok: false as const,
                error: `the file is ${Math.ceil(file.size / 1024)} KB; uploads may be at most ${Math.floor(t.maxBytes / 1024)} KB`,
              };
            }
            return (
              (await postUpload(file, "sound", t.ticket)) ?? {
                ok: false as const,
                error: "the server did not answer",
              }
            );
          } catch (e) {
            return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
          }
        },
        apply(change: SoundChange) {
          return awaitResult((s) => actions.sound(s, change));
        },
        saved() {
          refreshAll();
        },
      }
    : null;
  /** The Items page's panels, once made. */
  let itemPanelsMade: ItemPanels | null = null;
  function itemPanels(saved: () => void): ItemPanels | null {
    if (itemPanelsMade || !artOptions || !wornOptions) {
      return itemPanelsMade;
    }
    const art = artOptions;
    const worn = wornOptions;
    itemPanelsMade = makeItemPanels(
      (picSaved, wornSaved) => ({
        pic: createItemArtPicker({ ...art, saved: picSaved }),
        worn: createWornArtPicker({ ...worn, saved: wornSaved }, "items-worn-art"),
      }),
      askItemArt,
      askWornArt,
      saved,
    );
    return itemPanelsMade;
  }
  /** The Monsters page's body panel, once made. */
  let monsterBodyMade: MonsterBodyPanel | null = null;
  function monsterBody(saved: () => void): MonsterBodyPanel | null {
    if (monsterBodyMade || !bodyOptions) {
      return monsterBodyMade;
    }
    let justSaved = false;
    const panel = createBodyArtPicker(
      {
        ...bodyOptions,
        saved: () => {
          justSaved = true;
          saved();
        },
      },
      "monsters-body",
    );
    let mine = 0;
    let shown: string | null = null;
    monsterBodyMade = {
      el: panel.el,
      show(monster, force = false) {
        const at = ++mine;
        const other = shown === null || shown.toLowerCase() !== monster.toLowerCase();
        shown = monster;
        const keep = !force && !other && !justSaved && panel.pending();
        justSaved = false;
        if (keep) {
          return;
        }
        void askBodyArt()
          .then((view) => {
            if (at !== mine || shown === null) {
              return;
            }
            if (view.monsters.some((m) => m.name.toLowerCase() === monster.toLowerCase())) {
              panel.show({ kind: "monster", monster }, view);
            } else {
              panel.clear();
            }
          })
          .catch(() => {
            if (at === mine) {
              panel.clear();
            }
          });
      },
      clear() {
        mine += 1;
        shown = null;
        panel.clear();
      },
      pending: () => panel.pending(),
    };
    return monsterBodyMade;
  }
  /** The Spells page's effect panel (a spell's cast picture), once made. */
  let spellEffectMade: RecordPanel | null = null;
  function spellEffect(saved: () => void): RecordPanel | null {
    if (spellEffectMade || !fxOptions) {
      return spellEffectMade;
    }
    let justSaved = false;
    const panel = createFxArtPicker(
      {
        ...fxOptions,
        saved: (_spells: string[]) => {
          justSaved = true;
          refreshAll();
          saved();
        },
      },
      "spells-effect",
    );
    let mine = 0;
    let shown: string | null = null;
    spellEffectMade = {
      el: panel.el,
      show(spell: string, force = false) {
        const at = ++mine;
        const other = shown === null || shown.toLowerCase() !== spell.toLowerCase();
        // The run chosen before stays chosen while the same spell is shown.
        const was = other ? null : (panel.current() ?? panel.remembered());
        shown = spell;
        const keep = !force && !other && !justSaved && panel.pending();
        justSaved = false;
        if (keep) {
          return;
        }
        void askFxArt()
          .then((view) => {
            if (at !== mine || shown === null) {
              return;
            }
            if (view.spells.some((x) => x.name.toLowerCase() === spell.toLowerCase())) {
              const run =
                was?.kind === "spell" && was.spell.toLowerCase() === spell.toLowerCase()
                  ? was.run
                  : undefined;
              panel.show({ kind: "spell", spell, ...(run !== undefined ? { run } : {}) }, view);
            } else {
              panel.clear();
            }
          })
          .catch(() => {
            if (at === mine) {
              panel.clear();
            }
          });
      },
      clear() {
        mine += 1;
        shown = null;
        panel.clear();
      },
      pending: () => panel.pending(),
    };
    return spellEffectMade;
  }

  /** The House types tab's placement preview panel, once made. */
  let housePreviewMade: RecordPanel | null = null;
  function housePreview(saved: () => void): RecordPanel | null {
    if (housePreviewMade || !artOptions) {
      return housePreviewMade;
    }
    let justSaved = false;
    const panel = createHouseArtPanel({
      ...artOptions,
      saved() {
        justSaved = true;
        refreshAll();
        saved();
      },
    });
    let mine = 0;
    let shown: string | null = null;
    housePreviewMade = {
      el: panel.el,
      show(house: string, force = false) {
        const at = ++mine;
        const same = shown !== null && shown.toLowerCase() === house.toLowerCase();
        shown = house;
        const keep = !force && same && !justSaved && panel.pending();
        justSaved = false;
        if (keep) {
          return;
        }
        void askItemArt()
          .then((view) => {
            if (at === mine && shown !== null) {
              panel.show(house, view);
            }
          })
          .catch(() => {
            if (at === mine) {
              panel.clear();
            }
          });
      },
      clear() {
        mine += 1;
        shown = null;
        panel.clear();
      },
      pending: () => panel.pending(),
    };
    return housePreviewMade;
  }

  // ---- the row view: where it is used, and removing it ----------------------------------------
  const editor = document.createElement("div");
  editor.className = "content-editor";
  editor.hidden = true;
  const editorTitle = document.createElement("h3");
  editorTitle.className = "content-editor-title";
  const editorState = document.createElement("p");
  editorState.className = "content-editor-state";
  const editorError = document.createElement("div");
  editorError.className = "content-editor-error";
  editorError.setAttribute("role", "alert");
  const openPageBtn = panelButton(
    "content-open-page",
    "Change it on its page",
    () => {
      if (editing) {
        actions.openEditor?.(editing);
      }
    },
    "primary",
  );
  const removeBtn = panelButton("content-remove", "Remove…", () => removeRow(), "danger");
  const revertBtn = panelButton("content-revert", "Restore the original", () => revertRow());
  const discardBtn = panelButton("content-discard", "Cancel unpublished change", () => {
    if (editing) {
      resultSeq = next();
      resultInEditor = true;
      afterResult = refreshAll;
      actions.discard(resultSeq, editing, editingRevision);
    }
  });
  const closeBtn = panelButton("content-close", "Close", () => closeEditor());
  const editorButtons = document.createElement("div");
  editorButtons.className = "content-buttons";
  editorButtons.append(openPageBtn, removeBtn, revertBtn, discardBtn, closeBtn);
  const usageBox = document.createElement("div");
  usageBox.className = "content-usage-box";
  const removalBox = document.createElement("div");
  removalBox.className = "content-removal-box";
  editor.append(editorTitle, editorState, usageBox, removalBox, editorError, editorButtons);
  rows.body.append(editor);

  /** The row shown. */
  let editing: ContentRowRef | null = null;
  /** The shown row's revision as it was loaded, sent back with a change to it. */
  let editingRevision: string | undefined;

  const showError = (text: string, problems: readonly ContentProblemView[] = []) => {
    editorError.replaceChildren(text);
    if (problems.length > 0) {
      editorError.append(problemList(problems));
    }
  };

  /** The usage report of the row shown, once it has come. */
  let usage: ContentUsageView | null = null;

  function askUsage(r: ContentRowRef): void {
    const entry = entryOf(r);
    usage = null;
    usageBox.replaceChildren();
    removalBox.replaceChildren();
    if (!entry) {
      usageSeq = -1;
      return;
    }
    usageSeq = next();
    actions.usage(usageSeq, entry.kind, entry.key);
  }

  function openRow(r: ContentRowRef): void {
    const ref = refOf(r);
    // A usage report still on its way belongs to the row being left.
    usageSeq = -1;
    usage = null;
    usageBox.replaceChildren();
    removalBox.replaceChildren();
    editing = ref;
    editingRevision = undefined;
    editor.hidden = false;
    // The row is on its own tab: opening one (from a link on another page, the unpublished
    // changes or the history) shows it.
    showTab("rows");
    editorTitle.textContent = rowName(ref);
    editorState.textContent = "Loading…";
    showError("");
    rowSeq = next();
    actions.row(rowSeq, ref);
  }

  /** The row shown catches up with the draft (after a change made elsewhere). */
  function refreshRow(): void {
    if (editing && !editor.hidden && removalBox.childElementCount === 0) {
      openRow(editing);
    }
  }

  function showRow(d: ContentRowDetail): void {
    editingRevision = d.revision;
    editorTitle.textContent = rowName(d);
    const parts = [d.status ? STATUS_TEXT[d.status] : "Not published yet"];
    if (d.draft) {
      parts.push(`unpublished change (${OP_TEXT[d.draft.op].toLowerCase()}, by ${d.draft.author})`);
    }
    if (d.readOnly) {
      parts.push("built from the pictures: it can't be changed");
    }
    if (d.note) {
      parts.push(d.note);
    }
    editorState.textContent = parts.join(", ");
    openPageBtn.hidden = d.readOnly || homeOf(d.dataset, d.part) === null || !actions.openEditor;
    removeBtn.hidden = d.readOnly || d.keyField === null || d.published === null;
    // Worded as the editor pages word it.
    const kind = entryOf(d)?.kind;
    removeBtn.textContent =
      kind === "item"
        ? "Remove or retire this item…"
        : kind === "monster"
          ? "Remove this creature…"
          : kind === "vehicle"
            ? "Remove this vehicle…"
            : "Remove…";
    if (d.published !== null && entryOf(d)) {
      askUsage(d);
    }
    revertBtn.hidden = d.readOnly || d.pack === null || d.status === "pack" || d.status === null;
    discardBtn.hidden = d.draft === null;
  }

  function closeEditor(): void {
    usage = null;
    usageSeq = -1;
    usageBox.replaceChildren();
    removalBox.replaceChildren();
    editor.hidden = true;
    editing = null;
    editingRevision = undefined;
    showTab("publish");
  }

  function removeRow(): void {
    const ref = editing;
    const revision = editingRevision;
    if (!ref || ref.key === null) {
      return;
    }
    // An item, a monster or a vehicle is removed with its cleanup, once its usage report is in.
    if (entryOf(ref)) {
      if (!usage) {
        showError("Wait a moment: the list of where it is used is still loading.");
        return;
      }
      const u = usage;
      removalBox.replaceChildren(
        removalForm(u, root, {
          submit: (plan) => {
            resultSeq = next();
            resultInEditor = true;
            afterResult = () => {
              removalBox.replaceChildren();
              refreshAll();
              openRow(ref);
            };
            actions.remove(resultSeq, plan);
          },
          cancel: () => removalBox.replaceChildren(),
        }),
      );
      return;
    }
    void confirmBox(root, {
      text: `Remove ${rowName(ref)}? It goes with the other unpublished changes, and players lose it once you publish.`,
      confirm: "Remove",
      cancel: "Keep it",
      danger: true,
    }).then((yes) => {
      if (yes) {
        resultSeq = next();
        resultInEditor = true;
        afterResult = () => {
          refreshAll();
          openRow(ref);
        };
        actions.draft(resultSeq, ref, "remove", null, revision);
      }
    });
  }

  function revertRow(): void {
    const ref = editing;
    if (!ref) {
      return;
    }
    resultSeq = next();
    resultInEditor = true;
    afterResult = () => {
      refreshAll();
      openRow(ref);
    };
    actions.draft(resultSeq, ref, "revert", null, editingRevision);
  }

  // ---- publish history ------------------------------------------------------------------------
  // ---- art and sounds (issue #29) -------------------------------------------------------------
  const artSection = section(
    "Upload files",
    "Upload PNG pictures and WAV, MP3 or OGG sounds to use later. A file does nothing on its own: players see or hear it once something uses it (an item's picture, a sound) and that change is published.",
  );
  const uploader = createArtUploader({ ticket });
  artSection.body.append(uploader.el);

  const picturesSection = section(
    "Item pictures",
    "See which items have no picture, and upload many at once (each file named after its item). To change one item's picture, use its Picture tab on the Items page.",
  );
  const pictures = artOptions
    ? createItemPictures({
        ...artOptions,
        openItem(key) {
          openRow({ dataset: "items", part: "items", key });
          editor.scrollIntoView?.({ block: "start" });
        },
      })
    : null;
  if (pictures) {
    picturesSection.body.append(pictures.el);
  } else {
    picturesSection.el.hidden = true;
  }
  const wornSection = section(
    "Worn pictures",
    "How each worn item looks on a character, frame by frame. Open one to upload, check and preview its frames, or upload many at once.",
  );
  const wornLayers = wornOptions ? createWornLayers(wornOptions) : null;
  if (wornLayers) {
    wornSection.body.append(wornLayers.el);
  } else {
    wornSection.el.hidden = true;
  }
  const bodiesSection = section(
    "Monster bodies",
    "How each monster (and each Morph shape) looks walking and attacking. Open one to upload, check and preview its frames, make a new body, or upload many at once.",
  );
  const bodies = bodyOptions ? createBodies(bodyOptions) : null;
  if (bodies) {
    bodiesSection.body.append(bodies.el);
  } else {
    bodiesSection.el.hidden = true;
  }
  const effectsSection = section(
    "Spell effects",
    "The animations spells play. Open one to upload, check and play its frames, make a new one, or upload many at once.",
  );
  const effects = fxOptions ? createSpellEffects(fxOptions) : null;
  if (effects) {
    effectsSection.body.append(effects.el);
  } else {
    effectsSection.el.hidden = true;
  }
  const tilesSection = section(
    "Tiles",
    "Every map tile, with its picture. Open one to change its picture, its name and whether players can walk on it, or add many tiles at once from tilesets.",
  );
  const tiles = tileOptions ? createTiles(tileOptions) : null;
  if (tiles) {
    tilesSection.body.append(tiles.el);
  } else {
    tilesSection.el.hidden = true;
  }
  const soundsSection = section(
    "Sounds",
    "Every sound the game plays, and what plays it. Open one to hear it or replace its file; add new sounds one at a time or many at once.",
  );
  const sounds = soundOptions ? createSounds(soundOptions) : null;
  if (sounds) {
    soundsSection.body.append(sounds.el);
  } else {
    soundsSection.el.hidden = true;
  }
  const refreshPictures = () => {
    if (pictures) {
      void askItemArt()
        .then((v) => pictures.setView(v))
        .catch(() => {});
    }
    if (wornLayers) {
      void askWornArt()
        .then((v) => wornLayers.setView(v))
        .catch(() => {});
    }
    if (bodies) {
      void askBodyArt()
        .then((v) => bodies.setView(v))
        .catch(() => {});
    }
    if (effects) {
      void askFxArt()
        .then((v) => effects.setView(v))
        .catch(() => {});
    }
    if (tiles) {
      void askTileArt()
        .then((v) => tiles.setView(v))
        .catch(() => {});
    }
    if (sounds) {
      void askSoundArt()
        .then((v) => sounds.setView(v))
        .catch(() => {});
    }
  };

  const history = section(
    "Publish history",
    "Every publish, newest first. Undo this publish puts everything it changed back as it was before.",
  );
  const historyTable = createTable<ContentPublishView>({
    label: "Publish history",
    empty: "Nothing has been published yet.",
    key: (p) => p.id,
    columns: [
      { label: "When (UTC)", cell: (p) => when(p.at) },
      { label: "By", cell: (p) => p.actorName },
      {
        label: "Note",
        cell: (p) => {
          if (p.cleanup.length === 0 && p.loggedOut === null) {
            return p.summary;
          }
          const cell = document.createElement("div");
          cell.append(p.summary);
          if (p.cleanup.length > 0) {
            const ul = document.createElement("ul");
            ul.className = "content-usage-list";
            for (const line of p.cleanup) {
              const li = document.createElement("li");
              li.textContent = line;
              ul.append(li);
            }
            cell.append(ul);
          }
          // Shown apart from what it did to the world: Undo's warning is about that alone.
          if (p.loggedOut !== null) {
            const note = document.createElement("p");
            note.className = "content-history-logout";
            note.textContent = `Logged everyone else out while publishing: ${p.loggedOut === 0 ? "nobody else was online" : p.loggedOut === 1 ? "1 player" : `${p.loggedOut} players`}.`;
            cell.append(note);
          }
          return cell;
        },
      },
      {
        label: "What it changed",
        cell: (p) => {
          const s = document.createElement("span");
          s.textContent = p.rows.map((r) => rowName(refFromLabel(r))).join(", ");
          s.title = p.rows.join(", ");
          return s;
        },
      },
      {
        label: "",
        cell: (p) => {
          if (p.undoneBy) {
            return "Undone";
          }
          return panelButton("content-undo", "Undo this publish", () => {
            void confirmBox(root, {
              text: `Undo "${p.summary}"? Everything it changed goes back as it was before, and players get that at once.${p.cleanup.length > 0 ? " What it did to the world (deleted, replaced or despawned) is not undone." : ""}`,
              confirm: "Undo",
              cancel: "Keep it",
              danger: true,
            }).then((yes) => {
              if (yes) {
                resultSeq = next();
                resultInEditor = false;
                afterResult = refreshAll;
                actions.undo(resultSeq, p.id);
              }
            });
          });
        },
      },
    ],
  });
  history.body.append(historyTable.el);

  // ---- problems -------------------------------------------------------------------------------
  const problemsSection = section(
    "Find problems",
    "Things that name something that doesn't exist, such as a shop selling an item that was removed. They never stop the game: an unknown item shows by its name with no picture, and an unknown monster appears as a stand-in.",
  );
  const problemsBody = document.createElement("div");
  problemsBody.className = "content-problems-body";
  problemsSection.body.append(
    panelButton("content-problems-check", "Check for problems", () => {
      problemsSeq = next();
      problemsBody.replaceChildren("Looking…");
      actions.problems(problemsSeq);
    }),
    problemsBody,
  );
  const drawProblems = (contentList: ContentProblemView[], world: ContentProblemView[]) => {
    const part = (title: string, list: ContentProblemView[], none: string) => {
      const h = document.createElement("h4");
      h.className = "content-usage-title";
      h.textContent = `${title} (${list.length})`;
      if (list.length === 0) {
        const p = document.createElement("p");
        p.className = "content-checks-ok";
        p.textContent = none;
        return [h, p];
      }
      return [h, problemList(list)];
    };
    problemsBody.replaceChildren(
      ...part("In the world", world, "Every stored item and spawn names something that exists."),
      ...part("In content", contentList, "Every reference in content resolves."),
    );
  };

  // ---- tabs: one job at a time, publishing first ---------------------------------------------
  type Tab = "publish" | "art" | "history" | "problems" | "rows";
  const TABS: readonly (readonly [Tab, string, HTMLElement[]])[] = [
    ["publish", "Unpublished changes", [notices.el, draft.el]],
    ["history", "History", [history.el]],
    ["problems", "Find problems", [problemsSection.el]],
    // Shown while a row is open (a link from another page, or a change with no page of its own).
    ["rows", "Where it is used", [rows.el]],
    // On the Pictures & Sounds page (`artEl`), not a tab here.
    [
      "art",
      "",
      [
        picturesSection.el,
        wornSection.el,
        bodiesSection.el,
        effectsSection.el,
        tilesSection.el,
        soundsSection.el,
        artSection.el,
      ],
    ],
  ];
  let tab: Tab = "publish";
  const strip = document.createElement("div");
  strip.className = "control-panel-tabs content-tabs";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Content");
  const tabButtons = TABS.filter(([id]) => id !== "art").map(([id, label]) => {
    const b = action(document.createElement("button"), "content-tab");
    b.type = "button";
    b.className = "control-panel-tab";
    b.setAttribute("role", "tab");
    b.dataset.tab = id;
    b.textContent = label;
    b.addEventListener("click", () => showTab(id));
    return b;
  });
  strip.append(...tabButtons);
  // Arrow keys, Home and End move between tabs, choosing as they go.
  strip.addEventListener("keydown", (e) => {
    const shown = tabButtons.filter((b) => !b.hidden);
    const i = shown.findIndex((b) => b.dataset.tab === tab);
    const n = shown.length;
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % n
        : e.key === "ArrowLeft"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (to < 0) {
      return;
    }
    e.preventDefault();
    showTab((shown[to]?.dataset.tab as Tab | undefined) ?? tab);
    shown[to]?.focus();
  });

  // Pictures and sounds: one kind at a time, picked from a list.
  const artParts: readonly (readonly [string, HTMLElement])[] = [
    ["Item pictures", picturesSection.el],
    ["Worn pictures", wornSection.el],
    ["Monster bodies", bodiesSection.el],
    ["Spell effects", effectsSection.el],
    ["Tiles", tilesSection.el],
    ["Sounds", soundsSection.el],
    ["Upload files", artSection.el],
  ];
  const artSel = action(document.createElement("select"), "content-art-kind");
  for (const [label, el] of artParts) {
    // A part with nothing to draw (no art in this build) has no entry.
    if (el.hidden) {
      continue;
    }
    const o = document.createElement("option");
    o.value = label;
    o.textContent = label;
    artSel.append(o);
  }
  const artPick = document.createElement("div");
  artPick.className = "content-section content-art-pick";
  artPick.append(formField("Show", artSel, "Which kind of pictures or sounds to list."));
  artSel.addEventListener("change", () => showArt());

  /** Shows the kind of pictures and sounds picked (the Pictures & Sounds page). */
  function showArt(): void {
    for (const [label, el] of artParts) {
      el.classList.toggle("control-panel-tab-hidden", label !== artSel.value);
    }
  }

  /** Shows one tab's sections. */
  function showTab(id: Tab): void {
    tab = id;
    for (const [t, , els] of TABS) {
      if (t === "art") {
        continue;
      }
      for (const sec of els) {
        sec.classList.toggle("control-panel-tab-hidden", t !== id);
      }
    }
    for (const b of tabButtons) {
      const on = b.dataset.tab === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      // The row's tab is there only while a row is open.
      if (b.dataset.tab === "rows") {
        b.hidden = editor.hidden;
      }
    }
  }

  /** Marks the Unpublished changes tab while it has something waiting, with its count. */
  function markTabs(o: ContentOverview): void {
    const b = tabButtons[0] as HTMLButtonElement;
    const waiting = o.draft.length + o.notices.length;
    b.textContent =
      o.draft.length > 0 ? `Unpublished changes (${o.draft.length})` : "Unpublished changes";
    b.classList.toggle("control-panel-tab-used", waiting > 0);
    if (waiting > 0) {
      b.title =
        o.notices.length > 0 ? "A pack update is waiting for you" : "Waiting to be published";
    } else {
      b.removeAttribute("title");
    }
  }

  root.append(strip, notices.el, draft.el, history.el, problemsSection.el, rows.el);
  // The Pictures & Sounds page: one kind at a time, picked from a list.
  const artRoot = document.createElement("div");
  artRoot.className = "content-page content-art-page plain-editor";
  artRoot.append(
    pageHeading(
      "Pictures & Sounds",
      "Every picture and sound the game uses: item pictures, worn pictures, creature bodies, spell effects, tiles and sounds. Upload your own to replace them: an upload goes into the draft, and players see it once it is published. To change one item's, creature's or spell's picture, its own page is easier.",
    ),
    artPick,
    picturesSection.el,
    wornSection.el,
    bodiesSection.el,
    effectsSection.el,
    tilesSection.el,
    soundsSection.el,
    artSection.el,
  );
  showTab("publish");
  showArt();

  function refreshAll(): void {
    overviewSeq = next();
    actions.overview(overviewSeq);
    refreshPictures();
  }

  function drawOverview(o: ContentOverview): void {
    overview = o;
    markTabs(o);
    drawNotices(o.notices);
    draftTable.setRows(o.draft);
    checks.replaceChildren();
    if (o.draft.length > 0) {
      if (o.problems.length === 0) {
        const ok = document.createElement("p");
        ok.className = "content-checks-ok";
        ok.textContent = "Every check passes.";
        checks.append(ok);
      } else {
        const bad = document.createElement("p");
        bad.textContent = "Fix these before publishing:";
        checks.append(bad, problemList(o.problems));
      }
    }
    const nextRemovals = drawRemovals(o.removals ?? []);
    removals.replaceWith(nextRemovals);
    removals = nextRemovals;
    publishBtn.disabled = o.draft.length === 0 || o.problems.length > 0;
    publishBtn.textContent = o.draft.length > 1 ? `Publish ${o.draft.length} changes` : "Publish";
    historyTable.setRows(o.history);
  }

  return {
    el: root,
    artEl: artRoot,
    onShow: refreshAll,
    openRow,
    itemPanels,
    monsterBody,
    spellEffect,
    housePreview,
    onHide: () => sounds?.stop(),
    receive(msg) {
      switch (msg.t) {
        case "contentUploadTicket": {
          const wait = ticketWaits.get(msg.seq);
          ticketWaits.delete(msg.seq);
          wait?.({ ticket: msg.ticket, maxBytes: msg.maxBytes });
          return;
        }
        case "contentItemArt": {
          const wait = itemArtWaits.get(msg.seq);
          itemArtWaits.delete(msg.seq);
          wait?.(msg.view);
          return;
        }
        case "contentWornArt": {
          const wait = wornArtWaits.get(msg.seq);
          wornArtWaits.delete(msg.seq);
          wait?.(msg.view);
          return;
        }
        case "contentBodyArt": {
          const wait = bodyArtWaits.get(msg.seq);
          bodyArtWaits.delete(msg.seq);
          wait?.(msg.view);
          return;
        }
        case "contentBodySheet": {
          const wait = bodySheetWaits.get(msg.seq);
          bodySheetWaits.delete(msg.seq);
          wait?.(
            msg.frames && msg.cell
              ? { ok: true, cell: msg.cell, frames: msg.frames }
              : { ok: false, error: msg.error ?? "the sheet could not be cut" },
          );
          return;
        }
        case "contentFxArt": {
          const wait = fxArtWaits.get(msg.seq);
          fxArtWaits.delete(msg.seq);
          wait?.(msg.view);
          return;
        }
        case "contentTileArt": {
          const wait = tileArtWaits.get(msg.seq);
          tileArtWaits.delete(msg.seq);
          wait?.(msg.view);
          return;
        }
        case "contentSoundArt": {
          const wait = soundArtWaits.get(msg.seq);
          soundArtWaits.delete(msg.seq);
          wait?.(msg.view);
          return;
        }
        case "contentTileSheet": {
          const wait = tileSheetWaits.get(msg.seq);
          tileSheetWaits.delete(msg.seq);
          wait?.(
            msg.cells && msg.grid
              ? { ok: true, grid: msg.grid, cells: msg.cells }
              : { ok: false, error: msg.error ?? "the tileset could not be cut" },
          );
          return;
        }
        case "contentFxSheet": {
          const wait = fxSheetWaits.get(msg.seq);
          fxSheetWaits.delete(msg.seq);
          wait?.(
            msg.frames && msg.cell
              ? { ok: true, cell: msg.cell, frames: msg.frames, trail: msg.trail ?? [] }
              : { ok: false, error: msg.error ?? "the strip could not be cut" },
          );
          return;
        }
        case "contentWornSheet": {
          const wait = sheetWaits.get(msg.seq);
          sheetWaits.delete(msg.seq);
          wait?.(
            msg.frames
              ? { ok: true, frames: msg.frames }
              : { ok: false, error: msg.error ?? "the sheet could not be cut" },
          );
          return;
        }
        case "contentOverview":
          if (msg.seq === overviewSeq) {
            drawOverview(msg.overview);
          }
          return;
        case "contentList":
          return;
        case "contentRow":
          if (msg.seq === rowSeq) {
            if (msg.row) {
              showRow(msg.row);
            } else {
              editorState.textContent = msg.error ?? "There is no such row.";
            }
          }
          return;
        case "contentUsage":
          if (msg.seq === usageSeq) {
            usage = msg.usage;
            usageBox.replaceChildren(
              msg.usage
                ? drawUsage(msg.usage, {
                    openRow: (r) => openRow(r),
                    openCharacter: (name) => actions.openCharacter(name),
                  })
                : (msg.error ?? ""),
            );
          }
          return;
        case "contentProblems":
          if (msg.seq === problemsSeq) {
            drawProblems(msg.content, msg.world);
          }
          return;
        case "contentResult":
          if (resultWaits.has(msg.seq)) {
            const wait = resultWaits.get(msg.seq);
            resultWaits.delete(msg.seq);
            wait?.({
              ok: msg.ok,
              text: msg.text,
              ...(msg.body !== undefined ? { body: msg.body } : {}),
              ...(msg.run !== undefined ? { run: msg.run } : {}),
              ...(msg.codes !== undefined ? { codes: msg.codes } : {}),
              ...(msg.sound !== undefined ? { sound: msg.sound } : {}),
              ...(msg.problems !== undefined ? { problems: msg.problems } : {}),
            });
            return;
          }
          if (msg.seq === resultSeq) {
            if (msg.ok) {
              say(msg.text);
              afterResult();
            } else if (resultInEditor && !editor.hidden) {
              showError(msg.text, msg.problems ?? []);
              say("");
            } else {
              say(msg.text, msg.problems ?? []);
            }
          }
          return;
      }
    },
    published() {
      if (root.isConnected) {
        refreshAll();
      }
    },
    changes: () =>
      (wornLayers?.pending() ? 1 : 0) +
      (bodies?.pending() ? 1 : 0) +
      (spellEffectMade?.pending() ? 1 : 0) +
      (effects?.pending() ? 1 : 0) +
      (tiles?.pending() ? 1 : 0) +
      (sounds?.pending() ? 1 : 0),
    discard: () => {
      closeEditor();
      // Frames set up in the sections' own panels go too.
      wornLayers?.discard();
      bodies?.discard();
      effects?.discard();
      tiles?.discard();
      sounds?.discard();
    },
    reset() {
      overview = null;
      // Answers still awaited belong to the session that ended.
      for (const wait of resultWaits.values()) {
        wait({ ok: false, text: "The session ended." });
      }
      resultWaits.clear();
      ticketWaits.clear();
      itemArtWaits.clear();
      wornArtWaits.clear();
      bodyArtWaits.clear();
      for (const wait of bodySheetWaits.values()) {
        wait({ ok: false, error: "the session ended" });
      }
      bodySheetWaits.clear();
      fxArtWaits.clear();
      for (const wait of fxSheetWaits.values()) {
        wait({ ok: false, error: "the session ended" });
      }
      fxSheetWaits.clear();
      tileArtWaits.clear();
      soundArtWaits.clear();
      for (const wait of tileSheetWaits.values()) {
        wait({ ok: false, error: "the session ended" });
      }
      tileSheetWaits.clear();
      for (const wait of sheetWaits.values()) {
        wait({ ok: false, error: "the session ended" });
      }
      sheetWaits.clear();
      pictures?.reset();
      wornLayers?.reset();
      bodies?.reset();
      effects?.reset();
      tiles?.reset();
      sounds?.reset();
      problemsBody.replaceChildren();
      closeEditor();
      say("");
    },
  };
}
