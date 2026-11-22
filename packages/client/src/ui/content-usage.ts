/**
 * Where an item or a monster is used, and the form that removes it with its cleanup (issue #28),
 * for the Content page's row editor. 1.6 had nothing like it: an item was removed by deleting its
 * file, and copies players held, shops that sold it and maps that spawned it were left broken.
 *
 * - **Where it is used**: "Held by 14 characters · on 3 maps · named in 5 places in content", then
 *   each place: the rows that name it (each opens the row) and the world's places, with the
 *   characters who hold it (each opens their hub).
 * - **Remove**: what happens to the references content holds (removed with the entries that hold
 *   them, replaced, or left for the operator), to the copies players hold (retired, purged with an
 *   optional refund, or replaced), and to a monster's spawns, live ones and NPC file. It goes into
 *   the draft with the removal; the world's part runs when the draft is published.
 */
import type {
  ContentPlaceView,
  ContentRemovalView,
  ContentRowRef,
  ContentUsageView,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import { confirmBox, formField, panelButton } from "./control-panel-kit.ts";

/** A removal as the `contentRemove` intent carries it (without its `t` and `seq`). */
export interface RemovalPlan {
  kind: "item" | "monster";
  key: string;
  content: "remove" | "replace" | "leave";
  replacement: string | null;
  copies?: "retire" | "purge" | "replace";
  refundGold?: number;
  spawns?: "remove" | "replace";
  live?: "despawn" | "leave";
  /** The monster's own NPC file row. */
  npcRow?: "delete" | "keep";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The places that are copies players or the world hold. */
const COPY_PLACES: readonly ContentPlaceView["place"][] = [
  "bag",
  "worn",
  "vault",
  "container",
  "ground",
];

/** The characters who hold copies, counted once each. */
function holderNames(u: ContentUsageView): Set<string> {
  return new Set(
    u.world
      .filter((p) => p.place === "bag" || p.place === "worn" || p.place === "vault")
      .flatMap((p) => p.holders),
  );
}

/** How many copies the world holds. */
export const copyCount = (u: ContentUsageView): number =>
  u.world.filter((p) => COPY_PLACES.includes(p.place)).reduce((n, p) => n + p.count, 0);

/** "Held by 14 characters · on 3 maps · named in 5 places in content". */
export function usageSummary(u: ContentUsageView): string {
  const parts: string[] = [];
  if (u.kind === "item") {
    const characters = Math.max(
      holderNames(u).size,
      ...u.world
        .filter((p) => p.place === "bag" || p.place === "worn" || p.place === "vault")
        .map((p) => p.holderCount),
    );
    if (characters > 0) {
      parts.push(`Held by ${plural(characters, "character")}`);
    }
    const ground = u.world.find((p) => p.place === "ground");
    if (ground) {
      parts.push(`on the ground on ${plural(ground.holderCount, "map")}`);
    }
    const containers = u.world.find((p) => p.place === "container");
    if (containers) {
      parts.push(`in ${plural(containers.holderCount, "container")}`);
    }
    const quests = u.world.find((p) => p.place === "quest");
    if (quests) {
      parts.push(`wanted or given by ${plural(quests.count, "quest")}`);
    }
  } else {
    const spawn = u.world.find((p) => p.place === "spawn");
    if (spawn) {
      parts.push(`spawns on ${plural(spawn.holderCount, "map")}`);
    }
    const live = u.world.find((p) => p.place === "live");
    if (live) {
      parts.push(`${plural(live.count, "alive now", "alive now")}`);
    }
  }
  if (u.uses.length > 0) {
    parts.push(`named in ${plural(u.uses.length, "place")} in content`);
  }
  if (u.npcFile) {
    parts.push("has its own NPC file");
  }
  return parts.length > 0 ? parts.join(" · ") : "Not used anywhere.";
}

const PLACE_TEXT: Record<ContentPlaceView["place"], (p: ContentPlaceView) => string> = {
  bag: (p) => `In bags: ${plural(p.count, "copy", "copies")}`,
  worn: (p) => `Worn: ${plural(p.count, "copy", "copies")}`,
  vault: (p) => `In vaults: ${plural(p.count, "copy", "copies")}`,
  container: (p) => `In containers: ${plural(p.count, "copy", "copies")}`,
  ground: (p) => `On the ground: ${plural(p.count, "copy", "copies")}`,
  quest: (p) => `Quest lines: ${p.count}`,
  spawn: (p) => `Roster slots: ${p.count}`,
  live: (p) => `Alive now: ${p.count}`,
};

/** The usage report: the summary, the rows that name it and the world's places. */
export function drawUsage(
  u: ContentUsageView,
  on: { openRow(r: ContentRowRef): void; openCharacter(name: string): void },
): HTMLElement {
  const box = document.createElement("div");
  box.className = "content-usage";
  const head = document.createElement("h4");
  head.className = "content-usage-title";
  head.textContent = u.retired ? "Where it is used (retired)" : "Where it is used";
  const sum = document.createElement("p");
  sum.className = "content-usage-summary";
  sum.textContent = usageSummary(u);
  box.append(head, sum);
  if (u.retired) {
    const note = document.createElement("p");
    note.className = "content-usage-note";
    note.textContent =
      "Retired: copies players hold stay and work, but no more can be made. Content may not name it, and admins cannot create it.";
    box.append(note);
  }
  if (u.world.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "content-usage-list";
    for (const p of u.world) {
      const li = document.createElement("li");
      li.append(`${PLACE_TEXT[p.place](p)}`);
      if (p.holders.length > 0) {
        li.append(" — ");
        const people = p.place === "bag" || p.place === "worn" || p.place === "vault";
        p.holders.forEach((h, i) => {
          if (i > 0) {
            li.append(", ");
          }
          if (people) {
            const b = action(document.createElement("button"), "content-holder-open");
            b.type = "button";
            b.className = "content-link";
            b.textContent = h;
            b.addEventListener("click", () => on.openCharacter(h));
            li.append(b);
          } else {
            li.append(h);
          }
        });
        if (p.holderCount > p.holders.length) {
          li.append(` and ${p.holderCount - p.holders.length} more`);
        }
      }
      ul.append(li);
    }
    box.append(ul);
  }
  if (u.uses.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "content-usage-list";
    for (const use of u.uses) {
      const li = document.createElement("li");
      const b = action(document.createElement("button"), "content-use-open");
      b.type = "button";
      b.className = "content-link";
      b.textContent = use.where;
      b.addEventListener("click", () => on.openRow(use.row));
      li.append(b);
      if (use.name.toLowerCase() !== u.key.toLowerCase()) {
        li.append(` (as "${use.name}")`);
      }
      if (!use.removable) {
        li.append(" — cannot be removed, only replaced");
      }
      ul.append(li);
    }
    box.append(ul);
  }
  return box;
}

function choice<T extends string>(
  id: string,
  options: readonly [T, string][],
  value: T,
): HTMLSelectElement {
  const sel = action(document.createElement("select"), id);
  for (const [v, text] of options) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = text;
    sel.append(o);
  }
  sel.value = value;
  return sel;
}

/** The removal form: the cleanup's choices with their defaults, and its two buttons. */
export function removalForm(
  u: ContentUsageView,
  host: HTMLElement,
  on: { submit(plan: RemovalPlan): void; cancel(): void },
): HTMLElement {
  const box = document.createElement("div");
  box.className = "content-removal";
  const head = document.createElement("h4");
  head.className = "content-usage-title";
  head.textContent = `Remove ${u.name}`;
  box.append(head);
  const removable = u.uses.filter((x) => x.removable).length;
  const contentSel = choice(
    "content-removal-content",
    [
      ["remove", "Remove the entries that name it"],
      ["replace", "Replace it with another"],
      ["leave", "Leave them for me to fix"],
    ],
    "remove",
  );
  if (u.uses.length > 0) {
    box.append(
      formField(
        "References in content",
        contentSel,
        `${plural(u.uses.length, "row entry", "row entries")} name it: ${removable} can be removed with the recipe, shop line, drop or list entry that holds ${removable === 1 ? "it" : "them"}${u.uses.length > removable ? `; ${u.uses.length - removable} can only be replaced, and stop the publish until then` : ""}.`,
      ),
    );
  }
  const copies = copyCount(u);
  const copiesSel = choice(
    "content-removal-copies",
    [
      ["retire", "Retire it: copies stay, no more can be made"],
      ["purge", "Purge every copy"],
      ["replace", "Replace every copy with another item"],
    ],
    "retire",
  );
  const refund = gameInput("content-removal-refund");
  refund.type = "number";
  refund.min = "0";
  refund.max = "1000000";
  refund.step = "1";
  refund.value = "0";
  const refundRow = formField(
    "Gold back for each purged copy",
    refund,
    "Given to each character for every copy taken from their bag, gear or vault.",
  );
  if (u.kind === "item" && copies > 0) {
    box.append(
      formField(
        "Copies in the world",
        copiesSel,
        `${plural(copies, "copy", "copies")} exist. Retiring keeps them working; purging cannot be undone, even by undoing the publish.`,
      ),
      refundRow,
    );
  }
  const spawnsSel = choice(
    "content-removal-spawns",
    [
      ["remove", "Clear its roster slots"],
      ["replace", "Spawn another monster instead"],
    ],
    "remove",
  );
  const liveSel = choice(
    "content-removal-live",
    [
      ["despawn", "Despawn them when published"],
      ["leave", "Leave them until they die"],
    ],
    "despawn",
  );
  const fileSel = choice(
    "content-removal-npcfile",
    [
      ["delete", "Remove it with the NPC"],
      ["keep", "Keep it, unattached"],
    ],
    "delete",
  );
  if (u.kind === "monster") {
    if (u.world.some((p) => p.place === "spawn")) {
      box.append(formField("Roster slots", spawnsSel));
    }
    if (u.world.some((p) => p.place === "live")) {
      box.append(formField("Alive now", liveSel));
    }
    if (u.npcFile) {
      box.append(formField("Its NPC file", fileSel));
    }
  }
  const replacement = gameInput("content-removal-replacement");
  replacement.type = "text";
  replacement.maxLength = 80;
  const replaceRow = formField(
    u.kind === "item" ? "Replace with item" : "Replace with monster",
    replacement,
    "Its key or the name players see.",
  );
  box.append(replaceRow);
  const error = document.createElement("p");
  error.className = "content-editor-error";
  error.setAttribute("role", "alert");
  const sync = () => {
    refundRow.hidden = !(u.kind === "item" && copies > 0 && copiesSel.value === "purge");
    replaceRow.hidden = !(
      (u.uses.length > 0 && contentSel.value === "replace") ||
      (u.kind === "item" && copies > 0 && copiesSel.value === "replace") ||
      (u.kind === "monster" &&
        u.world.some((p) => p.place === "spawn") &&
        spawnsSel.value === "replace")
    );
  };
  for (const el of [contentSel, copiesSel, spawnsSel]) {
    el.addEventListener("change", sync);
  }
  sync();
  const plan = (): RemovalPlan | null => {
    const rep = replaceRow.hidden ? null : replacement.value.trim() || null;
    if (!replaceRow.hidden && !rep) {
      error.textContent = `Name the ${u.kind} to replace it with.`;
      return null;
    }
    const base = {
      kind: u.kind,
      key: u.key,
      content: (u.uses.length > 0 ? contentSel.value : "remove") as RemovalPlan["content"],
      replacement: rep,
    };
    if (u.kind === "item") {
      const gold = Number(refund.value || "0");
      if (!Number.isInteger(gold) || gold < 0 || gold > 1_000_000) {
        error.textContent = "The refund is a whole number of gold from 0 to 1,000,000.";
        return null;
      }
      const c = (copies > 0 ? copiesSel.value : "retire") as NonNullable<RemovalPlan["copies"]>;
      return { ...base, copies: c, refundGold: c === "purge" ? gold : 0 };
    }
    return {
      ...base,
      spawns: spawnsSel.value as NonNullable<RemovalPlan["spawns"]>,
      live: liveSel.value as NonNullable<RemovalPlan["live"]>,
      npcRow: (u.npcFile ? fileSel.value : "keep") as NonNullable<RemovalPlan["npcRow"]>,
    };
  };
  const buttons = document.createElement("div");
  buttons.className = "content-buttons";
  buttons.append(
    panelButton(
      "content-removal-submit",
      "Add the removal to the draft",
      () => {
        error.textContent = "";
        const p = plan();
        if (!p) {
          return;
        }
        if (p.copies !== "purge") {
          on.submit(p);
          return;
        }
        // Purging is the strong option: it says what goes, and that no undo brings it back.
        const who = holderNames(u).size;
        void confirmBox(host, {
          text: `Purge ${u.name}? When the draft is published, ${plural(copies, "copy", "copies")}${who > 0 ? ` held by ${plural(who, "character")} and more` : ""} are deleted from bags, gear, vaults, containers and the ground. Undoing the publish brings the item back, not the copies.`,
          confirm: "Purge every copy",
          cancel: "Keep them",
          danger: true,
        }).then((yes) => {
          if (yes) {
            on.submit(p);
          }
        });
      },
      "danger",
    ),
    panelButton("content-removal-cancel", "Cancel", () => on.cancel()),
  );
  box.append(error, buttons);
  return box;
}

/** "This draft removes 2 items and 1 monster still used in 5 places." */
export function removalHeadline(removals: readonly ContentRemovalView[]): string {
  if (removals.length === 0) {
    return "";
  }
  const items = removals.filter((r) => r.kind === "item").length;
  const monsters = removals.length - items;
  const what = [
    items > 0 ? plural(items, "item") : "",
    monsters > 0 ? plural(monsters, "monster") : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const used = removals.reduce((n, r) => n + r.stillUsed, 0);
  return used > 0
    ? `This draft removes ${what} still used in ${plural(used, "place")}.`
    : `This draft removes ${what}.`;
}

/** The draft's removals, each with what publishing it does. */
export function drawRemovals(removals: readonly ContentRemovalView[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "content-removals";
  if (removals.length === 0) {
    box.hidden = true;
    return box;
  }
  const p = document.createElement("p");
  p.className = "content-removals-headline";
  p.textContent = removalHeadline(removals);
  box.append(p);
  for (const r of removals) {
    const h = document.createElement("p");
    h.className = "content-removals-entry";
    h.textContent = `${r.kind === "item" ? "Item" : "Monster"} ${r.key}:`;
    const ul = document.createElement("ul");
    ul.className = "content-usage-list";
    for (const line of r.lines.length > 0 ? r.lines : ["Not used anywhere in the world."]) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.append(li);
    }
    box.append(h, ul);
  }
  return box;
}
