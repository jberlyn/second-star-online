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
 *   optional refund, or replaced), to a monster's spawns, live ones and NPC file, and to a
 *   vehicle's riders and parked ones (issue #44: landed and turned back into their deed, or switched
 *   to another vehicle). It goes into the draft with the removal; the world's part runs when the
 *   draft is published.
 */
import type {
  ContentPlaceView,
  ContentRemovalView,
  ContentRowRef,
  ContentUsageView,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";
import { confirmBox, formField, panelButton } from "./control-panel-kit.ts";

/** What each dataset holds, in words. */
export const DATASET_TEXT: Record<string, string> = {
  attPower: "Attack power",
  bindings: "Game bindings",
  casino: "Casino",
  classes: "Classes and skills",
  craft: "Crafting",
  gather: "Gathering",
  help: "Help",
  houses: "Houses and vehicles",
  itemRules: "Item rule tables",
  items: "Items",
  monsters: "Monsters",
  quests: "Quests",
  social: "Social",
  spells: "Spells",
  tiles: "Tiles",
  npcFiles: "NPC files",
  rects: "Picture positions",
  art: "Pictures and sounds",
  balance: "Balance",
};

/** The rows most often met, named as the editor pages name them ("Item: Ale"). */
const ROW_TEXT: Record<string, string> = {
  "items/items": "Item",
  "items/definitions": "Item rules",
  "monsters/monsters": "Monster",
  "monsters/definitions": "Monster rules",
  "spells/spells": "Spell",
  "npcFiles/files": "NPC file",
  "classes/skills": "Skill",
  "houses/vehicles": "Vehicle",
  "houses/deeds": "Deed",
  "art/items": "Item picture",
  "art/paperdoll": "Worn picture",
  "art/bodies": "Monster body",
  "art/fx": "Spell effect",
  "art/tiles": "Tile picture",
  "art/sounds": "Sound",
  "tiles/catalogue": "Tile",
};

/** `spellEffects` → `spell effects`. */
export const words = (id: string) => id.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/** A row in words: "Item: Ale", "Balance › spell effects › Firebolt". */
export function rowName(r: ContentRowRef): string {
  const named = ROW_TEXT[`${r.dataset}/${r.part}`];
  if (named && r.key !== null) {
    return `${named}: ${r.key}`;
  }
  const area = DATASET_TEXT[r.dataset] ?? r.dataset;
  const part = r.part === r.dataset ? "" : ` › ${words(r.part)}`;
  return `${area}${part}${r.key === null ? "" : ` › ${r.key}`}`;
}

/** Where in a row a reference sits, in words: `cook.recipes[3].output` → `cook › recipes 4 › output`. */
export function placeText(at: string): string {
  if (/^line \d+$/.test(at)) {
    return at;
  }
  return at
    .split(".")
    .filter((x) => x !== "")
    .map((seg) => {
      const m = /^([^[]*)((?:\[\d+\])*)$/.exec(seg);
      if (!m) {
        return seg;
      }
      const nums = [...(m[2] ?? "").matchAll(/\[(\d+)\]/g)].map((n) => Number(n[1]) + 1);
      // A bare list index (a list row's `[16]`) is its entry: "entry 17".
      const name = words(m[1] ?? "") || "entry";
      return [name, ...nums.map(String)].join(" ");
    })
    .join(" › ");
}

/**
 * A reference in words: "Amber's NPC file, line 6", "Crafting › stations › cook: cook › recipes
 * 4 › output". `where` is the server's `<row> → <place>`; only the place after the arrow is used.
 */
export function useText(use: { row: ContentRowRef; where: string }): string {
  const arrow = use.where.indexOf(" → ");
  const at = arrow >= 0 ? use.where.slice(arrow + 3) : "";
  const r = use.row;
  const row =
    r.dataset === "npcFiles" && r.part === "files" && r.key !== null
      ? `${r.key}'s NPC file`
      : rowName(r);
  return at ? `${row}, ${placeText(at)}` : row;
}

/** A removal as the `contentRemove` intent carries it (without its `t` and `seq`). */
export interface RemovalPlan {
  kind: "item" | "monster" | "vehicle";
  key: string;
  content: "remove" | "replace" | "leave";
  replacement: string | null;
  copies?: "retire" | "purge" | "replace";
  refundGold?: number;
  spawns?: "remove" | "replace";
  live?: "despawn" | "leave";
  /** The monster's own NPC file row. */
  npcRow?: "delete" | "keep";
  /** A vehicle's riders and parked ones. */
  riders?: "land" | "switch";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The places that are copies players or the world hold. */
const COPY_PLACES: readonly ContentPlaceView["place"][] = [
  "bag",
  "worn",
  "vault",
  "container",
  "ground",
  "shop",
];

/** How many copies the world holds. */
export const copyCount = (u: ContentUsageView): number =>
  u.world.filter((p) => COPY_PLACES.includes(p.place)).reduce((n, p) => n + p.count, 0);

/** "Held by 14 characters · on 3 maps · named in 5 places in content". */
export function usageSummary(u: ContentUsageView): string {
  const parts: string[] = [];
  if (u.kind === "item") {
    if (u.characters > 0) {
      parts.push(`Held by ${plural(u.characters, "character")}`);
    }
    const shops = u.world.find((p) => p.place === "shop");
    if (shops) {
      parts.push(`on sale in ${plural(shops.holderCount, "player shop")}`);
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
  } else if (u.kind === "vehicle") {
    const aboard = u.world.find((p) => p.place === "aboard");
    if (aboard) {
      parts.push(`ridden by ${plural(aboard.count, "character")}`);
    }
    const parked = u.world.find((p) => p.place === "parked");
    if (parked) {
      parts.push(
        `${plural(parked.count, "parked one", "parked ones")} on ${plural(parked.holderCount, "map")}`,
      );
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
  shop: (p) => `On sale in player shops: ${plural(p.count, "copy", "copies")}`,
  aboard: (p) => `Aboard: ${plural(p.count, "character")}`,
  parked: (p) => `Parked: ${p.count}`,
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
        const people =
          p.place === "bag" || p.place === "worn" || p.place === "vault" || p.place === "aboard";
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
      b.textContent = useText(use);
      // The row's own path, for anyone who knows the files.
      b.title = use.where;
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
  const intro = document.createElement("p");
  intro.className = "items-intro";
  intro.textContent =
    "Choose what happens to everything that uses it. Nothing changes for players until you publish.";
  box.append(head, intro);
  const removable = u.uses.filter((x) => x.removable).length;
  const contentSel = choice(
    "content-removal-content",
    [
      ["remove", "Take out the lines that name it"],
      ["replace", "Use another one instead"],
      ["leave", "Leave them for me to fix"],
    ],
    "remove",
  );
  if (u.uses.length > 0) {
    box.append(
      formField(
        "Where content names it",
        contentSel,
        `${plural(u.uses.length, "place names", "places name")} it: ${removable} can be taken out with the recipe, shop line, drop or list entry that holds ${removable === 1 ? "it" : "them"}${u.uses.length > removable ? `; ${u.uses.length - removable} can only be swapped for another, and publishing waits until they are` : ""}.`,
      ),
    );
  }
  const copies = copyCount(u);
  // An item already retired can only be taken out by purging or replacing the copies left.
  const copiesSel = choice<"retire" | "purge" | "replace">(
    "content-removal-copies",
    [
      ...(u.retired
        ? []
        : ([["retire", "Retire it: players keep their copies, no new ones can be made"]] as [
            "retire",
            string,
          ][])),
      ["purge", "Delete every copy"],
      ["replace", "Swap every copy for another item"],
    ],
    u.retired ? "purge" : "retire",
  );
  const refund = gameInput("content-removal-refund");
  refund.type = "number";
  refund.min = "0";
  refund.max = "1000000";
  refund.step = "1";
  refund.value = "0";
  const refundRow = formField(
    "Gold back for each deleted copy",
    refund,
    "Given to each character for every copy taken from their bag, gear or vault.",
  );
  if (u.kind === "item" && copies > 0) {
    box.append(
      formField(
        "Copies players have",
        copiesSel,
        `${plural(copies, "copy", "copies")} exist. Retiring keeps them working; deleting them can't be undone, even by undoing the publish.`,
      ),
      refundRow,
    );
  }
  const spawnsSel = choice(
    "content-removal-spawns",
    [
      ["remove", "Stop it appearing there"],
      ["replace", "Put another monster there instead"],
    ],
    "remove",
  );
  const liveSel = choice(
    "content-removal-live",
    [
      ["despawn", "Remove them when you publish"],
      ["leave", "Leave them until they die"],
    ],
    "despawn",
  );
  const fileSel = choice(
    "content-removal-npcfile",
    [
      ["delete", "Delete it too"],
      ["keep", "Keep it"],
    ],
    "delete",
  );
  if (u.kind === "monster") {
    if (u.world.some((p) => p.place === "spawn")) {
      box.append(formField("Where it appears on maps", spawnsSel));
    }
    if (u.world.some((p) => p.place === "live")) {
      box.append(formField("Ones alive now", liveSel));
    }
    if (u.npcFile) {
      box.append(formField("Its NPC file", fileSel));
    }
  }
  const ridersSel = choice(
    "content-removal-riders",
    [
      ["land", "Land them where they are (parked ones become their deed)"],
      ["switch", "Switch them to another vehicle"],
    ],
    "land",
  );
  const inUse = u.world.some((p) => p.place === "aboard" || p.place === "parked");
  if (u.kind === "vehicle" && inUse) {
    box.append(
      formField(
        "Riders and parked ones",
        ridersSel,
        "Landed riders stand where they were; a parked one becomes the deed that builds it, or goes if none does.",
      ),
    );
  }
  const replacement = gameInput("content-removal-replacement");
  replacement.type = "text";
  replacement.maxLength = 80;
  const replaceRow = formField(
    u.kind === "item"
      ? "The item to use instead"
      : u.kind === "vehicle"
        ? "The vehicle to use instead"
        : "The monster to use instead",
    replacement,
    "Its ID or the name players see.",
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
        spawnsSel.value === "replace") ||
      (u.kind === "vehicle" && inUse && ridersSel.value === "switch")
    );
  };
  for (const el of [contentSel, copiesSel, spawnsSel, ridersSel]) {
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
    if (u.kind === "vehicle") {
      return {
        ...base,
        riders: (inUse ? ridersSel.value : "land") as NonNullable<RemovalPlan["riders"]>,
      };
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
  const submit = panelButton(
    "content-removal-submit",
    "Remove it",
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
      const who = u.characters;
      void confirmBox(host, {
        text: `Delete every copy of ${u.name}? When you publish, ${plural(copies, "copy", "copies")}${who > 0 ? ` (${plural(who, "character")} among the holders)` : ""} ${copies === 1 ? "is" : "are"} deleted from bags, gear, vaults, containers, the ground and player shops. Undoing the publish brings the item back, not the copies.`,
        confirm: "Delete every copy",
        cancel: "Keep them",
        danger: true,
      }).then((yes) => {
        if (yes) {
          on.submit(p);
        }
      });
    },
    "danger",
  );
  // Retiring keeps the item for the copies players hold: the button says which it does.
  const label = () => {
    submit.textContent =
      u.kind === "item" && copies > 0 && copiesSel.value === "retire" ? "Retire it" : "Remove it";
  };
  copiesSel.addEventListener("change", label);
  label();
  const note = document.createElement("p");
  note.className = "control-panel-field-help";
  note.textContent = "It goes with your other unpublished changes.";
  buttons.append(
    submit,
    panelButton("content-removal-cancel", "Cancel", () => on.cancel()),
  );
  box.append(error, buttons, note);
  return box;
}

/** "This draft removes 2 items and 1 monster still used in 5 places." */
export function removalHeadline(removals: readonly ContentRemovalView[]): string {
  if (removals.length === 0) {
    return "";
  }
  const items = removals.filter((r) => r.kind === "item").length;
  const vehicles = removals.filter((r) => r.kind === "vehicle").length;
  // A class's removal moves the characters in it (issue #15).
  const classes = removals.filter((r) => r.kind === "class").length;
  const monsters = removals.length - items - vehicles - classes;
  const what = [
    items > 0 ? plural(items, "item") : "",
    monsters > 0 ? plural(monsters, "monster") : "",
    vehicles > 0 ? plural(vehicles, "vehicle") : "",
    classes > 0 ? plural(classes, "class", "classes") : "",
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
    h.textContent = `${r.kind === "item" ? "Item" : r.kind === "vehicle" ? "Vehicle" : r.kind === "class" ? "Class" : "Monster"} ${r.key}:`;
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
