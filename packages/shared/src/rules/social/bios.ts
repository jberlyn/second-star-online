/**
 * Player bios and profiles. Pure rules over the generated `socialData.bios`
 * (the generated social data).
 *
 * In 1.6 the target's client composed the reply as one `*@*` string of 11 ":"-items and
 * the viewer's client drew it. The server composes the same items from its own
 * state (`giveBio`) and draws them for the viewer (`drawProfile`), so a forged reply cannot exist.
 */
import { socialData } from "@secondstaronline/data";

import { skillValue } from "../core/fighter.ts";
import { lingoEq, lingoWord } from "../core/lingo.ts";

const B = socialData.bios;
const tx = (k: keyof typeof B.texts) => B.texts[k].text;
const fill = (s: string, k: string, v: string) => s.replace(`{${k}}`, v);

/** The bio lines printed by the requester's own client. */
export const BIO_TEXT = {
  /** The player menu's Bio. */
  viewBio: tx("viewBio"),
  /** The Who window's Profile. */
  loadingProfile: tx("loadingProfile"),
  /** The window's title before item 1 replaces it. */
  windowTitle: tx("windowTitle"),
} as const;

/** Every character receives this last name at creation. */
export const LAST_NAME = B.lastName;

/** The bio's title: "Adventurer", then each row in order whose tests all hold. */
export function bioTitle(skills: readonly number[]): string {
  let title = B.firstTitle;
  for (const row of B.titles) {
    if (row.tests.every((t) => skillValue(skills, t.skill) > t.over)) {
      title = row.title;
    }
  }
  return title;
}

/**
 * The score: the original's points sum. Its second line assigns to a misspelt variable, so
 * Lumberjacking, Archery, Blessing, Musicianship, Illusion, Punch, Fire and Wind never count (a
 * kept bug: 1.6 did this); HPmax and SPmax do. No cap.
 */
export function bioScore(skills: readonly number[], hpMax: number, spMax: number): number {
  let sum = 0;
  for (const name of B.score.counted) {
    if (name === "HPmax") {
      sum += hpMax;
    } else if (name === "SPmax") {
      sum += spMax;
    } else {
      sum += skillValue(skills, name);
    }
  }
  return sum;
}

/** What the target's state gives the bio reply. */
export interface BioSource {
  name: string;
  /** 1 male, 2 female (`sex`). */
  sex: number;
  level: number;
  profile: string;
  /** The held medals, `id-id-…`, from the skills (`medalField`). */
  medals: string;
  skills: readonly number[];
  hpMax: number;
  spMax: number;
  /** The guild and whether the target leads it (the guild record contains `*<me>*`). */
  guild: { name: string; leader: boolean } | null;
  /** `Fctnme`: 0 none, 1 Mage, 2 Warrior, 3 Adventurer. */
  faction: number;
  wanted: boolean;
  /** The current body (morphs included); sent but never shown. */
  body: number | null;
  /** Nature Shift's tree: sprite 112's member name contains "80-" (body 80). */
  tree: boolean;
  /** `BodyE`, the equipped body item. */
  bodyItem: string;
  /** The TempSave `Vehicle` field is not empty. */
  inVehicle: boolean;
}

/** The 11 ":"-items of the `*@*` reply after its first word. */
export type BioItems = readonly string[];

/**
 * The bio reply: `<name> <lastname>:<title>:<sex>:<level>:<profile>:<body>:<medals>:<score>:<guild
 * line>:<faction line>:<murder line>`. Then the disguises, the later winning: a tree body is
 * `A Tree:::::80`; out of a vehicle the Robe of Invisibility is `????::::::`.
 */
export function giveBio(s: BioSource): BioItems {
  if (!s.inVehicle && s.bodyItem === B.disguise.robeItem) {
    return [tx("robe"), "", "", "", "", "", ""];
  }
  if (s.tree) {
    return [tx("tree"), "", "", "", "", "80"];
  }
  const guild = s.guild
    ? fill(tx(s.guild.leader ? "leader" : "member"), "GUILD", s.guild.name)
    : "";
  const faction =
    s.faction === 1
      ? tx("mages")
      : s.faction === 2
        ? tx("warriors")
        : s.faction === 3
          ? tx("adventurers")
          : "";
  return [
    `${s.name} ${LAST_NAME}`,
    bioTitle(s.skills),
    String(s.sex),
    String(s.level),
    s.profile,
    s.body === null ? "" : String(s.body),
    s.medals,
    String(bioScore(s.skills, s.hpMax, s.spMax)),
    guild,
    faction,
    s.wanted ? tx("murderer") : "",
  ];
}

/** What the bio drawing puts in the Bio window for one viewer. */
export interface DrawnBio {
  /** The window title: item 1. */
  title: string;
  /** The bio lines. */
  bio: string[];
  /** The profile text: item 5. */
  profile: string;
  /** The medal ids, in order, from the first 20 parts of field 7 split on "-". */
  medals: string[];
  /** Word 1 of item 1 is the viewer's name: the editable layout (sprite 6). */
  own: boolean;
}

/** The bio drawing for the viewer named `viewer`. A missing item reads as empty. */
export function drawProfile(items: BioItems, viewer: string): DrawnBio {
  const item = (n: number) => items[n - 1] ?? "";
  // The third field selects male for 1 and female for 2; any other value leaves the sex text
  // empty (the default reading).
  const sex = item(3) === "1" ? tx("male") : item(3) === "2" ? tx("female") : "";
  const bio = [
    fill(tx("name"), "TEXT", item(1)),
    fill(tx("class"), "TEXT", item(2)),
    fill(tx("sex"), "TEXT", sex),
    fill(tx("score"), "TEXT", item(8)),
  ];
  for (const n of [9, 10, 11]) {
    if (item(n) !== "") {
      bio.push(item(n));
    }
  }
  const medals = item(7)
    .split("-")
    .slice(0, B.medalStrip.items)
    .filter((m) => m !== "");
  return {
    title: item(1),
    bio,
    profile: item(5),
    medals,
    own: lingoEq(lingoWord(item(1), 1), viewer),
  };
}

/**
 * The medal strip's member per slot after drawing `medals` over `before`: slots 1-10 get the
 * empty medal member, then each medal its own member from slot 1 on; slots 11-14 keep what they
 * showed (a kept bug: 1.6 did this). Medals past slot 14 fall outside the image. `null` is a
 * slot never drawn (the member's stored image is clear there).
 */
export function medalStrip(before: readonly (number | null)[], medals: readonly string[]) {
  const S = B.medalStrip;
  const out: (number | null)[] = Array.from({ length: S.slots }, (_, i) => before[i] ?? null);
  for (let i = 0; i < S.cleared; i++) {
    out[i] = S.blankMember;
  }
  let slot = 0;
  for (const id of medals) {
    if (slot < S.slots) {
      // An id with no matching medal image draws nothing in 1.6 (the default reading) and
      // the slot keeps what it had.
      const award = socialData.medals.awards.find((a) => String(a.id) === id);
      if (award) {
        out[slot] = award.member;
      }
    }
    slot += 1;
  }
  return out;
}

/** One medal slot's width in the strip (each slot's left is 16 times its start pixel). */
export const MEDAL_SLOT_WIDTH = B.medalStrip.slotWidth;

/** The profile box's cap (1.6's box stopped typing when full). */
export const PROFILE_MAX = 500;

/**
 * Saving the profile, on closing your own Bio window: the text cut to 500 characters, then one
 * forward pass each over characters 1-500 deleting ":", "/", "." and ";" in that order; after a
 * deletion the next character moves into the place and is not tested, so of two adjacent ones
 * the second survives. A remaining ":" or "/" refuses the save with its alert; "." and ";" are
 * simply lost (a kept bug: 1.6 did this).
 */
export function saveProfile(text: string): { profile: string | null; alert: string | null } {
  const chars = [...text].slice(0, PROFILE_MAX);
  for (const ch of B.profile.strip) {
    if (!chars.includes(ch)) {
      continue;
    }
    for (let x = 1; x <= B.profile.scan; x++) {
      if (chars[x - 1] === ch) {
        chars.splice(x - 1, 1);
      }
    }
  }
  const out = chars.join("");
  if (out.includes(":")) {
    return { profile: null, alert: B.profile.alerts[":"].text };
  }
  if (out.includes("/")) {
    return { profile: null, alert: B.profile.alerts["/"].text };
  }
  return { profile: out, alert: null };
}
