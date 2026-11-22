/**
 * Player bios and profiles. Pure rules over the content store's `social.bios`
 * (the social data).
 *
 * In 1.6 the target's client composed the reply as one `*@*` string of 11 ":"-items and
 * the viewer's client drew it. The server composes the same items from its own
 * state (`giveBio`) and draws them for the viewer (`drawProfile`), so a forged reply cannot exist.
 */
import { type ContentStore, content, onContent } from "../../content/store.ts";
import { skillValue } from "../core/fighter.ts";
import { lingoEq, lingoWord } from "../core/lingo.ts";

let B: ContentStore["social"]["bios"];
const tx = (k: keyof typeof B.texts) => B.texts[k].text;
const fill = (s: string, k: string, v: string) => s.replace(`{${k}}`, v);

/** The bio lines printed by the requester's own client. */
const bioTextOf = () =>
  ({
    /** The player menu's Bio. */
    viewBio: tx("viewBio"),
    /** The Who window's Profile. */
    loadingProfile: tx("loadingProfile"),
    /** The window's title before item 1 replaces it. */
    windowTitle: tx("windowTitle"),
  }) as const;
export let BIO_TEXT: ReturnType<typeof bioTextOf>;

/** Every character receives this last name at creation. */
export let LAST_NAME: typeof B.lastName;

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
 * The score: every skill on its list (`bios.score.counted`: 33 skills), HPmax and SPmax summed,
 * with no cap. 1.6's second sum line assigned to a
 * misspelt variable, so Lumberjacking, Archery, Blessing, Musicianship, Illusion, Punch, Fire and
 * Wind never counted (a bug fixed).
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
 * The medal strip's member per slot after drawing `medals`: every slot gets the
 * empty medal member, then each medal its own member from slot 1 on. 1.6 cleared only slots 1-10,
 * so slots 11-14 kept the previous bio's medals (a bug fixed). Medals past slot 14 fall outside
 * the image.
 */
export function medalStrip(medals: readonly string[]): number[] {
  const S = B.medalStrip;
  const out: number[] = Array.from({ length: S.slots }, () => S.blankMember);
  let slot = 0;
  for (const id of medals) {
    if (slot < S.slots) {
      // An id with no matching medal image draws nothing in 1.6 (the default reading) and
      // the slot stays empty.
      const award = content().social.medals.awards.find((a) => String(a.id) === id);
      if (award) {
        out[slot] = award.member;
      }
    }
    slot += 1;
  }
  return out;
}

/** One medal slot's width in the strip (each slot's left is 16 times its start pixel). */
export let MEDAL_SLOT_WIDTH: typeof B.medalStrip.slotWidth;

/** The profile box's cap (1.6's box stopped typing when full). */
export const PROFILE_MAX = 500;

/**
 * Saving the profile, on closing your own Bio window: the text cut to 500 characters; a ":" or "/"
 * refuses the save with its alert, and anything else is saved as typed. 1.6 first ran one forward
 * pass each deleting ":", "/", "." and ";", so every close lost the profile's periods and
 * semicolons and most of its colons and slashes, even unedited (a bug fixed).
 */
export function saveProfile(text: string): { profile: string | null; alert: string | null } {
  const out = [...text].slice(0, PROFILE_MAX).join("");
  if (out.includes(":")) {
    return { profile: null, alert: B.profile.alerts[":"].text };
  }
  if (out.includes("/")) {
    return { profile: null, alert: B.profile.alerts["/"].text };
  }
  return { profile: out, alert: null };
}

onContent((c) => {
  B = c.social.bios;
  LAST_NAME = B.lastName;
  MEDAL_SLOT_WIDTH = B.medalStrip.slotWidth;
  BIO_TEXT = bioTextOf();
});
