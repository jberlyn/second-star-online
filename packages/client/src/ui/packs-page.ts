/**
 * The Control Panel's Packs page (issue #34): the installed packs, exporting the operator's
 * published changes as a pack file, and importing one: checked and reviewed first, then merged
 * into the draft or installed as a pack (in play from the next start). Files go over HTTP with an
 * upload ticket (`/upload/pack`, `PACK_DOWNLOAD_PATH`); the rest over the socket.
 */
import {
  type ContentPackPreview,
  type ContentPacksView,
  PACK_DOWNLOAD_PATH,
  UPLOAD_PATH,
  UPLOAD_TICKET_HEADER,
} from "@secondstaronline/shared";

import { action, noAutofill } from "./action.ts";
import {
  confirmBox,
  createTable,
  formField,
  pageHeading,
  panelButton,
} from "./control-panel-kit.ts";

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
  loaded: "In play",
  "next start": "In play from the next start",
  "removed at next start": "Leaves at the next start",
  "left out": "Left out at start",
};

export function createPacksPage(
  actions: PacksPageActions,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (i, n) => fetch(i, n),
): PacksPage {
  const el = document.createElement("div");
  el.className = "packs-page balance-page";
  el.append(
    pageHeading(
      "Packs",
      "The content packs this server runs, in the order they lay over each other, with your own changes on top. Export your published changes as a pack file to keep or share; import one from another server, into your draft or as a pack of its own.",
    ),
  );
  const status = document.createElement("p");
  status.className = "balance-status";
  status.setAttribute("role", "status");
  const say = (text: string, ok = true) => {
    status.textContent = text;
    status.className = ok ? "balance-status" : "balance-status balance-status-error";
  };
  const section = (title: string, ...kids: HTMLElement[]) => {
    const s = document.createElement("section");
    s.className = "balance-row";
    const h = document.createElement("h2");
    h.className = "content-section-title";
    h.textContent = title;
    s.append(h, ...kids);
    return s;
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
  const table = createTable<Row>({
    label: "Installed packs",
    empty: "No packs.",
    key: (p) => p.id,
    columns: [
      { label: "Pack", cell: (p) => p.name },
      { label: "Version", cell: (p) => p.version },
      { label: "From", cell: (p) => (p.source === "release" ? "This release" : "Imported") },
      { label: "Made for", cell: (p) => (p.sso ? `SSO ${p.sso}` : "") },
      { label: "State", cell: (p) => STATE_TEXT[p.state] },
      {
        label: "",
        cell: (p) => {
          if (p.source !== "imported" || p.state === "removed at next start") {
            return "";
          }
          return panelButton("packs-remove", "Remove", async () => {
            const yes = await confirmBox(el, {
              text: `Remove ${p.name}? It leaves play when the server next starts. Your own changes stay; a change you made to one of its rows stays as your change.`,
              confirm: "Remove",
              cancel: "Keep it",
              danger: true,
            });
            if (yes) {
              seq += 1;
              actions.remove(seq, p.id);
            }
          });
        },
      },
    ],
  });
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
    "Download the pack file",
    () => void download(),
    "primary",
  );

  // ---- import ----
  const fileIn = action(document.createElement("input"), "packs-import-file");
  fileIn.type = "file";
  fileIn.accept = ".json,application/json";
  const checkBtn = panelButton("packs-import-check", "Check the file", () => void check());
  const preview = document.createElement("div");
  preview.className = "packs-preview";
  preview.hidden = true;

  el.append(
    status,
    section("Installed", leftOut, table.el, release),
    section(
      "Export",
      help(
        "Your published changes (not the draft) as one file: every edit, addition and removal, the NPCs page's saves, and the art and sounds you uploaded for them. It records the packs it was built on and this server's release. Maps, settings and characters are not in it.",
      ),
      formField(
        "Pack id",
        idIn,
        "Lower-case letters, digits and dashes. Keep it the same for every version of this pack.",
      ),
      formField("Name", nameIn),
      formField(
        "Version",
        versionIn,
        "Three numbers. Another version of the same id, installed over this one, updates it.",
      ),
      exportBtn,
    ),
    section(
      "Import",
      help(
        "A pack file from another server, or a backup of this one. It is checked and shown to you first; nothing changes until you choose.",
      ),
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
    say("Making the pack file…");
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
      say(`Downloaded ${name}.`);
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), false);
    } finally {
      setBusy(false);
    }
  };

  const list = (title: string, rows: readonly string[], more = 0) => {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = `${title} (${rows.length + more})`;
    const ul = document.createElement("ul");
    ul.append(
      ...rows.map((r) => {
        const li = document.createElement("li");
        li.textContent = r;
        return li;
      }),
    );
    d.append(s, ul);
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
    head.textContent = `${m.name} v${m.version} (${m.id})`;
    const facts = help(
      [
        `Made for SSO ${m.sso}`,
        m.exportedAt ? `exported ${m.exportedAt.replace("T", " ").slice(0, 16)} UTC` : "",
        m.builtOn.length > 0
          ? `built on ${m.builtOn.map((b) => `${b.id} v${b.version}`).join(", ")}`
          : "",
        `${p.files} art and sound file${p.files === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(" · "),
    );
    const kids: HTMLElement[] = [
      head,
      facts,
      list("Adds", p.added),
      list("Changes", p.changed),
      list("Removes", p.removed),
      help(`${p.unchanged} row${p.unchanged === 1 ? "" : "s"} already as the pack has them.`),
    ];
    if (p.overYourChanges.length > 0) {
      kids.push(
        list(
          "Rows you have changed too: installed, your change stays on top; merged, the pack's replaces it in the draft",
          p.overYourChanges,
        ),
      );
    }
    if (p.overTheDraft.length > 0) {
      kids.push(list("Rows in the draft now: a merge replaces them", p.overTheDraft));
    }
    const install = document.createElement("div");
    install.className = "packs-choice";
    install.append(
      help(
        p.install.ok
          ? `Install as a pack: it lays over the installed packs (your changes stay on top) and comes into play when the server next starts.${p.install.updates ? ` It updates v${p.install.updates}.` : ""}`
          : "It cannot be installed as a pack:",
      ),
    );
    if (!p.install.ok) {
      install.append(list("Why", p.install.errors));
    }
    const merge = document.createElement("div");
    merge.className = "packs-choice";
    merge.append(
      help(
        "Merge into the draft: its rows and removals become your own changes, to review, see where they are used and publish on the Content page.",
      ),
    );
    if (p.merge.problems.length > 0) {
      merge.append(
        list("Problems the draft would then have (the publish names them)", p.merge.problems),
      );
    }
    const buttons = document.createElement("div");
    buttons.className = "content-buttons";
    const installBtn = panelButton("packs-install", "Install as a pack", () => apply("install"));
    installBtn.disabled = !p.install.ok;
    buttons.append(
      panelButton("packs-merge", "Merge into the draft", () => apply("merge"), "primary"),
      installBtn,
      panelButton("packs-cancel", "Cancel", () => {
        // The server lets the file go too (it holds it for a while otherwise).
        if (pending) {
          seq += 1;
          actions.apply(seq, pending.importId, "cancel");
        }
        pending = null;
        drawPreview();
        say("");
      }),
    );
    preview.replaceChildren(...kids, install, merge, buttons);
  };

  const check = async () => {
    const file = fileIn.files?.[0];
    if (busy || !file) {
      if (!file) {
        say("Choose a pack file first.", false);
      }
      return;
    }
    setBusy(true);
    pending = null;
    drawPreview();
    say("Checking the file…");
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
        say(`The file was refused: ${body.error}`, false);
      } else {
        pending = body.preview;
        drawPreview();
        say("Checked. Nothing has changed yet: choose below.");
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
    say(mode === "merge" ? "Merging…" : "Installing…");
  };

  const show = (v: ContentPacksView) => {
    table.setRows(v.packs);
    leftOut.hidden = v.leftOut === null;
    leftOut.textContent = v.leftOut ?? "";
    release.textContent = `This server runs SSO ${v.release}; an export records it.`;
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
        say(msg.result.text, msg.result.ok);
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
