/**
 * The Control Panel's Packs page (issue #34): the installed packs, exporting the operator's
 * published changes as a pack file, and importing one: checked and reviewed first, then merged
 * into the draft or installed as a pack (in play from the next start). Files go over HTTP with an
 * upload ticket (`/upload/pack`, `PACK_DOWNLOAD_PATH`); the rest over the socket.
 *
 * In plain words (the editor pages' `.plain-editor` look): each pack is a card saying what it is
 * and whether it is in use, and a checked file says what it would add, change and remove before
 * anything does.
 */
import {
  type ContentPackPreview,
  type ContentPacksView,
  PACK_DOWNLOAD_PATH,
  UPLOAD_PATH,
  UPLOAD_TICKET_HEADER,
} from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import { confirmBox, formField, pageHeading, panelButton } from "./control-panel-kit.ts";

export interface PacksPageActions {
  view(seq: number): void;
  apply(seq: number, importId: string, mode: "merge" | "install" | "cancel"): void;
  remove(seq: number, id: string): void;
  ticket(seq: number): void;
}

export type PacksAnswer =
  | {
      t: "contentPacks";
      seq: number;
      view: ContentPacksView;
      result?: { ok: boolean; text: string };
    }
  | { t: "contentUploadTicket"; seq: number; ticket: string; maxBytes: number };

export interface PacksPage {
  readonly el: HTMLElement;
  onShow(): void;
  /** Takes an answer meant for this page; false when it is another page's. */
  receive(msg: PacksAnswer): boolean;
  reset(): void;
}

/** This page's request numbers start far from the other pages', so a ticket's answer is told apart. */
const SEQ_BASE = 1_000_000_000;

const STATE_TEXT: Record<ContentPacksView["packs"][number]["state"], string> = {
  loaded: "In use",
  "next start": "In use once the server restarts",
  "removed at next start": "Removed when the server restarts",
  "left out": "Not in use: it stopped the server starting",
};

/** A row's path (`items/items/Frost Sword`) as words: "Frost Sword (items)". */
export function rowText(path: string): string {
  const parts = path.split("/");
  if (parts.length < 3) {
    return path;
  }
  const [dataset, part, ...key] = parts;
  const where = part === dataset ? dataset : `${dataset}, ${part}`;
  return `${key.join("/")} (${where})`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createPacksPage(
  actions: PacksPageActions,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (i, n) => fetch(i, n),
): PacksPage {
  const el = document.createElement("div");
  el.className = "packs-page balance-page plain-editor";
  el.append(
    pageHeading(
      "Packs",
      "A pack is a bundle of game content: items, monsters, NPCs, spells, art and sounds. Your world runs the packs below, with your own changes on top. Save your changes as a pack file to keep or share, or add a pack from a file.",
    ),
  );
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");
  /** Shows a message, next to the part of the page it is about (`near`) when given. */
  const say = (text: string, ok = true, near?: HTMLElement) => {
    near?.after(status);
    status.textContent = text;
    status.className = ok ? "balance-status" : "balance-status balance-status-error";
  };
  const section = (title: string, intro: string, ...kids: HTMLElement[]) => {
    const s = document.createElement("section");
    s.className = "balance-row";
    const h = document.createElement("h2");
    h.className = "content-section-title";
    h.textContent = title;
    const p = document.createElement("p");
    p.className = "items-intro";
    p.textContent = intro;
    s.append(h, p, ...kids);
    return s;
  };
  /** Details folded under a summary line. */
  const fold = (title: string, ...kids: HTMLElement[]) => {
    const d = document.createElement("details");
    d.className = "items-more";
    const s = action(document.createElement("summary"), "packs-more-toggle");
    s.textContent = title;
    d.append(s, ...kids);
    return d;
  };
  const help = (text: string) => {
    const p = document.createElement("p");
    p.className = "control-panel-field-help";
    p.textContent = text;
    return p;
  };

  // ---- installed ----
  const leftOut = document.createElement("p");
  leftOut.className = "balance-stale";
  leftOut.hidden = true;
  type Row = ContentPacksView["packs"][number];
  const cards = document.createElement("div");
  cards.className = "packs-list";
  cards.setAttribute("role", "list");
  cards.setAttribute("aria-label", "Installed packs");
  /** What a pack is, in a sentence. */
  const describe = (p: Row) =>
    p.source === "release"
      ? p.id === "classic"
        ? "First Star Online 1.6's world, remade. It comes with every release and can't be removed."
        : "It comes with every release and can't be removed."
      : "Added from a pack file. Remove it to stop using it.";
  const card = (p: Row) => {
    const box = document.createElement("div");
    box.className = "items-list-editor packs-card";
    box.setAttribute("role", "listitem");
    box.dataset.pack = p.id;
    const head = document.createElement("h3");
    head.className = "items-list-title";
    head.textContent = `${p.name} v${p.version}`;
    const tags = document.createElement("div");
    tags.className = "balance-tags";
    const tag = (text: string, kind: string) => {
      const t = document.createElement("span");
      t.className = `balance-tag items-tag-${kind}`;
      t.textContent = text;
      return t;
    };
    tags.append(
      tag(STATE_TEXT[p.state], p.state === "loaded" ? "original" : "pending"),
      tag(
        p.source === "release" ? "Comes with the game" : "Added by you",
        p.source === "release" ? "original" : "changed",
      ),
    );
    box.append(head, tags, help(describe(p)));
    box.append(
      fold(
        "More details",
        help(
          [`Pack ID: ${p.id}`, p.sso ? `made for Second Star Online ${p.sso}` : ""]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
    );
    if (p.source === "imported" && p.state !== "removed at next start") {
      box.append(
        panelButton(
          "packs-remove",
          "Remove…",
          async () => {
            const yes = await confirmBox(el, {
              text: `Remove ${p.name}? It stops being used when the server next restarts. Your own changes stay, including any change you made to something from this pack.`,
              confirm: "Remove it",
              cancel: "Keep it",
              danger: true,
            });
            if (yes) {
              seq += 1;
              actions.remove(seq, p.id);
            }
          },
          "danger",
        ),
      );
    }
    return box;
  };
  const table = {
    el: cards,
    setRows(rows: readonly Row[]) {
      if (rows.length === 0) {
        const none = document.createElement("p");
        none.className = "items-empty-form";
        none.textContent = "No packs yet.";
        cards.replaceChildren(none);
        return;
      }
      cards.replaceChildren(...rows.map(card));
    },
  };
  const release = help("");

  // ---- export ----
  const idIn = noAutofill(action(document.createElement("input"), "packs-export-id"));
  idIn.value = "my-server";
  const nameIn = noAutofill(action(document.createElement("input"), "packs-export-name"));
  nameIn.value = "My server";
  nameIn.maxLength = 60;
  const versionIn = noAutofill(action(document.createElement("input"), "packs-export-version"));
  versionIn.value = "1.0.0";
  const exportBtn = panelButton(
    "packs-export",
    "Download my changes as a pack",
    () => void download(),
    "primary",
  );

  // ---- import ----
  const fileIn = action(document.createElement("input"), "packs-import-file");
  fileIn.type = "file";
  fileIn.accept = ".json,application/json";
  const checkBtn = panelButton(
    "packs-import-check",
    "Check this file",
    () => void check(),
    "primary",
  );
  const preview = document.createElement("div");
  preview.className = "packs-preview";
  preview.hidden = true;

  el.append(
    status,
    section(
      "Packs in this world",
      "In the order they are applied: a pack can change what the packs before it set, and your own changes come last, on top of them all. Adding or removing a pack takes effect when the server restarts.",
      leftOut,
      table.el,
      release,
    ),
    section(
      "Save your changes as a pack",
      "Puts every published change you've made (not unpublished ones) into one file: edits, additions and removals, NPC changes, and the art and sounds you uploaded. Use it as a backup, or to share your content with another server. Maps, server settings and characters aren't included.",
      formField("Name", nameIn, "What the pack is called when someone adds it."),
      formField(
        "Version",
        versionIn,
        "Three numbers, such as 1.0.0. Raise it each time you save a new version: adding a newer version updates the old one.",
      ),
      fold(
        "More options",
        formField(
          "Pack ID",
          idIn,
          "Lower-case letters, digits and dashes. Keep it the same for every version of this pack, so a newer one replaces the older.",
        ),
      ),
      exportBtn,
    ),
    section(
      "Add a pack from a file",
      "A pack file from another server, or a backup of this one. It's checked and you see what it would change first: nothing changes until you choose.",
      formField("Pack file", fileIn),
      checkBtn,
      preview,
    ),
  );

  // ---- state ----
  let seq = SEQ_BASE;
  const tickets = new Map<number, (t: string) => void>();
  let pending: ContentPackPreview | null = null;
  let busy = false;
  /** The request an apply's answer comes back to (a removal's answer leaves the preview alone). */
  let applySeq = -1;

  const ticket = (): Promise<string> =>
    new Promise((resolve, reject) => {
      seq += 1;
      const s = seq;
      tickets.set(s, resolve);
      actions.ticket(s);
      setTimeout(() => {
        if (tickets.delete(s)) {
          reject(new Error("the server did not answer"));
        }
      }, 15_000);
    });

  const setBusy = (b: boolean) => {
    busy = b;
    for (const b2 of [exportBtn, checkBtn]) {
      b2.disabled = b;
    }
    for (const b2 of preview.querySelectorAll<HTMLButtonElement>("button")) {
      b2.disabled = b || (b2.dataset.action === "packs-install" && !pending?.install.ok);
    }
  };

  const download = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    say("Making the pack file…", true, exportBtn);
    try {
      const t = await ticket();
      const q = new URLSearchParams({
        id: idIn.value.trim(),
        name: nameIn.value.trim(),
        version: versionIn.value.trim(),
      });
      const res = await fetchImpl(`${PACK_DOWNLOAD_PATH}?${q}`, {
        headers: { [UPLOAD_TICKET_HEADER]: t },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        say(body?.error ?? `The server answered ${res.status}.`, false);
        return;
      }
      const name =
        /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ??
        "pack.ssopack.json";
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      say(`Downloaded ${name}.`, true, exportBtn);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const list = (title: string, rows: readonly string[], words = (r: string) => r, note = "") => {
    const d = document.createElement("details");
    d.className = "items-more";
    const s = action(document.createElement("summary"), "packs-more-toggle");
    s.textContent = `${title} (${rows.length})`;
    d.append(s);
    if (note) {
      d.append(help(note));
    }
    const ul = document.createElement("ul");
    ul.append(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.textContent = words(r);
        return li;
      }),
    );
    d.append(ul);
    return d;
  };

  const drawPreview = () => {
    const p = pending;
    preview.hidden = p === null;
    if (!p) {
      preview.replaceChildren();
      return;
    }
    const m = p.manifest;
    const head = document.createElement("h3");
    head.className = "balance-row-title";
    head.textContent = `${m.name} v${m.version}`;
    const summary = help(
      p.added.length + p.changed.length + p.removed.length === 0
        ? "It wouldn't change anything: your world already has everything in it."
        : `It would add ${plural(p.added.length, "thing")}, change ${p.changed.length}, and remove ${p.removed.length}${p.files > 0 ? `, with ${plural(p.files, "picture or sound", "pictures and sounds")}` : ""}.`,
    );
    const facts = help(
      [
        `Pack ID: ${m.id}`,
        `made for Second Star Online ${m.sso}`,
        m.exportedAt ? `saved ${m.exportedAt.replace("T", " ").slice(0, 16)} UTC` : "",
        m.builtOn.length > 0
          ? `built on ${m.builtOn.map((b) => `${b.id} v${b.version}`).join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
    const kids: HTMLElement[] = [head, summary];
    if (p.added.length > 0) {
      kids.push(list("What it adds", p.added, rowText));
    }
    if (p.changed.length > 0) {
      kids.push(list("What it changes", p.changed, rowText));
    }
    if (p.removed.length > 0) {
      kids.push(list("What it removes", p.removed, rowText));
    }
    if (p.overYourChanges.length > 0) {
      kids.push(
        list(
          "Things you've changed yourself",
          p.overYourChanges,
          rowText,
          "If you install it as a pack, your change stays on top. If you add it to your changes, the pack's version replaces yours.",
        ),
      );
    }
    if (p.overTheDraft.length > 0) {
      kids.push(
        list(
          "Things with unpublished changes",
          p.overTheDraft,
          rowText,
          "Adding it to your changes replaces these unpublished changes.",
        ),
      );
    }
    kids.push(fold("More details", facts));
    const install = document.createElement("div");
    install.className = "packs-choice";
    const installHead = document.createElement("h4");
    installHead.className = "items-list-title";
    installHead.textContent = p.install.updates
      ? `Update ${m.name} to v${m.version}`
      : "Install it as a pack";
    install.append(
      installHead,
      help(
        p.install.ok
          ? `${p.install.updates ? `Replaces v${p.install.updates}. ` : ""}It becomes one of this world's packs, under your own changes, and is used once the server restarts. Best for content someone else keeps updating.`
          : "It can't be installed as a pack:",
      ),
    );
    if (!p.install.ok) {
      install.append(list("Why not", p.install.errors));
    }
    const merge = document.createElement("div");
    merge.className = "packs-choice";
    const mergeHead = document.createElement("h4");
    mergeHead.className = "items-list-title";
    mergeHead.textContent = "Add it to my unpublished changes";
    merge.append(
      mergeHead,
      help(
        "Everything in it becomes your own change, to look over and publish on the Content page like any other change. Best for a backup of this server, or content you'll keep editing.",
      ),
    );
    if (p.merge.problems.length > 0) {
      merge.append(list("Problems to fix before you can publish", p.merge.problems));
    }
    const buttons = document.createElement("div");
    buttons.className = "items-actions";
    const left = document.createElement("div");
    left.className = "content-buttons";
    const right = document.createElement("div");
    right.className = "content-buttons";
    const installBtn = panelButton(
      "packs-install",
      p.install.updates ? `Update to v${m.version}` : "Install as a pack",
      () => apply("install"),
    );
    installBtn.disabled = !p.install.ok;
    left.append(
      panelButton("packs-merge", "Add to my unpublished changes", () => apply("merge"), "primary"),
      installBtn,
    );
    right.append(
      panelButton("packs-cancel", "Don't add it", () => {
        // The server lets the file go too (it holds it for a while otherwise).
        if (pending) {
          seq += 1;
          actions.apply(seq, pending.importId, "cancel");
        }
        pending = null;
        drawPreview();
        say("Nothing was added.", true, checkBtn);
      }),
    );
    buttons.append(left, right);
    // The choices in the order of their buttons.
    preview.replaceChildren(...kids, merge, install, buttons);
  };

  const check = async () => {
    const file = fileIn.files?.[0];
    if (busy || !file) {
      if (!file) {
        say("Choose a pack file first.", false, checkBtn);
      }
      return;
    }
    setBusy(true);
    pending = null;
    drawPreview();
    say("Checking the file…", true, checkBtn);
    try {
      const t = await ticket();
      const res = await fetchImpl(`${UPLOAD_PATH}pack`, {
        method: "POST",
        headers: { [UPLOAD_TICKET_HEADER]: t },
        body: file,
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: true; preview: ContentPackPreview }
        | { ok: false; error: string }
        | null;
      if (!body) {
        say(`The server answered ${res.status}.`, false);
      } else if (!body.ok) {
        say(`That file can't be used: ${body.error}`, false, checkBtn);
      } else {
        pending = body.preview;
        drawPreview();
        say("Checked. Nothing has changed yet: choose what to do below.", true, checkBtn);
      }
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const apply = (mode: "merge" | "install") => {
    if (!pending || busy) {
      return;
    }
    setBusy(true);
    seq += 1;
    applySeq = seq;
    actions.apply(seq, pending.importId, mode);
    say(mode === "merge" ? "Adding it to your changes…" : "Installing…", true, preview);
  };

  const show = (v: ContentPacksView) => {
    table.setRows(v.packs);
    leftOut.hidden = v.leftOut === null;
    leftOut.textContent = v.leftOut ?? "";
    release.textContent = `This server runs Second Star Online ${v.release}.`;
  };

  return {
    el,
    onShow() {
      seq += 1;
      actions.view(seq);
    },
    receive(msg) {
      if (msg.seq <= SEQ_BASE) {
        return false;
      }
      if (msg.t === "contentUploadTicket") {
        const done = tickets.get(msg.seq);
        tickets.delete(msg.seq);
        done?.(msg.ticket);
        return true;
      }
      show(msg.view);
      if (msg.result) {
        say(msg.result.text, msg.result.ok, msg.seq === applySeq ? preview : table.el);
        if (msg.seq === applySeq) {
          setBusy(false);
        }
        if (msg.result.ok && msg.seq === applySeq) {
          pending = null;
          fileIn.value = "";
          drawPreview();
        }
      }
      return true;
    },
    reset() {
      tickets.clear();
      pending = null;
      applySeq = -1;
      setBusy(false);
      drawPreview();
      say("");
      table.setRows([]);
    },
  };
}
