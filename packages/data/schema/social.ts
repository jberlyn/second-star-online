/**
 * Schema for the social tables `data:build` emits from `packages/data/content/social.json`:
 * the factions, their perks, texts and rules, the murder flag's lines, the quest replies,
 * Assassin's game, guilds, IM, rooms and ignore, and buddies, bios, profiles and medals.
 * Texts keep 1.6's wording; `{NAME}`, `{NPC}` and `{ITEM}` stand for the names they are built from.
 *
 */
import { z } from "zod";

const rule = z.string().min(1);

/**
 * What a faction does for its members, each by tier (`values[tier]`; a tier past the end reads the
 * last value). The kinds are engine: what each one changes is fixed, how much is content.
 */
export const FACTION_PERKS = [
  /** Added to spell power. */
  "spellPower",
  /** Added to melee attack power. */
  "melee",
  /** Taken off the damage a member takes, from players and monsters. */
  "defence",
  /** The kill skill gain's skill cap. */
  "skillCap",
  /** The Mage skill cap: Magery, the spell schools, Staff Fighting and Unholy Combat. */
  "mageCap",
  /** Frames taken off the HP and SP regeneration period. */
  "regeneration",
  /** Taken off the parry roll against a player's swing (lower parries more). */
  "pvpParry",
  /** Taken off the block roll against a player's swing. */
  "pvpBlock",
  /** Taken off the parry and block rolls against a monster. */
  "monsterDodge",
] as const;
export type FactionPerkKind = (typeof FACTION_PERKS)[number];

export const factionPerkSchema = z.strictObject({
  kind: z.enum(FACTION_PERKS),
  values: z.array(z.number().int()).min(1),
});

export const factionSchema = z.strictObject({
  /** The faction's permanent key, which characters and maps save (Classic: mage, warrior, adventurer). */
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  name: z.string().min(1),
  leader: z.string().min(1),
  /** The head a member drops and a rival leader takes (the item, matched exactly). */
  head: z.string().min(1),
  /** The species a map's faction spawn puts in a slot (Classic: "Mage Faction Member"). */
  member: z.string().min(1),
  /** The faction's power on a server that has saved none for it. */
  startPower: z.number().int(),
  /** The faction line of a member's Bio. */
  bio: z.string(),
  perks: z.array(factionPerkSchema),
  /** A join needs `HPmax > joinHpMaxAbove`. */
  joinHpMaxAbove: z.number().int(),
  /** Loyalty counter set on joining, in frames. */
  joinCount: z.number().int().positive(),
  /** Added to the loyalty counter by a rejoin. */
  rejoinAdds: z.number().int().positive(),
  texts: z.strictObject({
    join: z.string(),
    weak: z.string(),
    rejoin: z.string(),
    other: z.string(),
    announce: z.string(),
    announceOther: z.string(),
  }),
  /** Exiled at a death when `HPmax < exileHpMaxBelow`. */
  exileHpMaxBelow: z.number().int(),
  exileText: z.string(),
  loyalty: z.array(
    z.strictObject({ count: z.number().int().positive(), text: z.string(), kick: z.boolean() }),
  ),
});

const band = z.strictObject({
  below: z.number().int().positive(),
  points: z.number().int().positive(),
});

export const assassinSchema = z.strictObject({
  commands: z.strictObject({ rule }),
  start: z.strictObject({ rule, normal: z.array(z.string()), lightning: z.array(z.string()) }),
  score: z.strictObject({
    rule,
    text: z.string(),
    /** Points for any kill while the mode is Lightning. */
    lightningPoints: z.number().int().positive(),
    tableSize: z.number().int().positive(),
  }),
  /** The skills summed with HPmax into the combat rating. */
  rating: z.strictObject({ rule, skills: z.array(z.string()).min(1) }),
  /** Assassin comparison ladders, lowest band first. */
  compare: z.strictObject({
    rule,
    stronger: z.array(band).min(1),
    weaker: z.array(band).min(1),
  }),
  // Four lines: rules/social/assassin.ts reads them by position.
  end: z.strictObject({ rule, lines: z.array(z.string()).length(4) }),
  prizes: z.strictObject({ archived: z.string(), awarded: z.number().int().positive() }),
  statue: z.strictObject({
    item: z.string(),
    text: z.string(),
    pause: z.number().int().positive(),
    allTimeHeader: z.string(),
    currentHeader: z.string(),
    entry: z.string(),
    separator: z.string(),
    perLine: z.number().int().positive(),
  }),
});

const guildText = z.strictObject({ text: z.string().min(1) });
const guildTexts = [
  "notInFront",
  "taken",
  "created",
  "hail",
  "kicked",
  "disbanded",
  "sending",
  "notLeader",
  "alreadyIn",
  "invited",
  "accepted",
  "rejected",
  "declined",
  "joined",
  "quitting",
  "quit",
  "exiled",
  "abdicating",
  "promoted",
  "notMember",
  "noGuild",
  "chat",
] as const;

/** Guilds: every text, the name sanitiser and the list limits. */
export const guildsSchema = z.strictObject({
  texts: z.strictObject(
    Object.fromEntries(guildTexts.map((k) => [k, guildText])) as {
      [K in (typeof guildTexts)[number]]: typeof guildText;
    },
  ),
  sanitiser: z.strictObject({
    rule,
    strip: z.array(z.string().length(1)).min(1),
    scan: z.number().int().positive(),
  }),
  defaultName: z.string(),
  alignments: z.tuple([z.literal("G"), z.literal("N"), z.literal("E")]),
  colour: z.literal(0),
  listMax: z.number().int().positive(),
  memberLines: z.tuple([z.number().int(), z.number().int()]),
});

const chatTexts = [
  "imEcho",
  "imLine",
  "imTitle",
  "imSendTitle",
  "awayTitle",
  "awayOn",
  "awayOff",
  "awayLog",
  "roomWindowTitle",
  "roomLine",
  "noGuild",
  "ignoreAdded",
  "ignoreRemoved",
  "ignoreListHeader",
  "logging",
] as const;

/** IM, away, chat rooms, ignore and `/logchat`. */
export const chatSchema = z.strictObject({
  texts: z.strictObject(
    Object.fromEntries(chatTexts.map((k) => [k, guildText])) as {
      [K in (typeof chatTexts)[number]]: typeof guildText;
    },
  ),
  rooms: z
    .array(
      z.strictObject({
        key: z.enum(["general", "newPlayer", "tradingPost", "guild", "admin"]),
        handler: z.string(),
        group: z.string(),
        title: z.string(),
        entering: z.string(),
      }),
    )
    // Five rooms: the RoomKey union, the protocol enum and one menu item per room, each once.
    .length(5)
    .refine((rooms) => new Set(rooms.map((r) => r.key)).size === rooms.length, {
      message: "each room is listed once",
    }),
  windows: z.strictObject({
    imSlots: z.literal(10),
    /** 1.6's chat ignore window. SSO keeps the archive value but checks every entry. */
    chatIgnoreLines: z.number().int().positive(),
    /** 1.6's IM ignore window. SSO keeps the archive value but checks every entry. */
    imIgnoreLines: z.number().int().positive(),
    /** 1.6's `/unignore` scan. SSO removes every matching entry. */
    unignoreScan: z.number().int().positive(),
    returnScan: z.number().int().positive(),
  }),
});

const textsOf = <const K extends readonly string[]>(keys: K) =>
  z.strictObject(
    Object.fromEntries(keys.map((k) => [k, guildText])) as { [P in K[number]]: typeof guildText },
  );

/** Buddies and the Friends window. */
export const buddiesSchema = z.strictObject({
  texts: textsOf(["added", "already", "removed", "notOn", "title"] as const),
  /** Lines 1-100 of the window are searched on a removal or logoff. */
  windowLines: z.number().int().positive(),
  /** Initial buddy check adds from the first 200 online names. */
  entryNames: z.number().int().positive(),
});

const skillTest = z.strictObject({ skill: z.string(), over: z.number().int() });

/** Player bios and profiles. */
export const biosSchema = z.strictObject({
  texts: textsOf([
    "viewBio",
    "loadingProfile",
    "windowTitle",
    "leader",
    "member",
    "murderer",
    "name",
    "class",
    "sex",
    "score",
    "tree",
    "robe",
  ] as const).extend({
    /**
     * Unused since issue #37 stage 7: the Bio shows the sex's `label` (`classes.json`
     * `creation.sexes`). Kept so packs made before still load.
     */
    male: guildText.optional(),
    female: guildText.optional(),
  }),
  firstTitle: z.string(),
  /**
   * In script order; a row applies when every test holds (and, with `classes`, the character is in
   * one of them, by code: issue #15); the last one that applies wins.
   */
  titles: z.array(
    z.strictObject({
      tests: z.array(skillTest),
      classes: z.array(z.number().int().min(1)).min(1).max(100).optional(),
      title: z.string(),
    }),
  ),
  /**
   * What the Bio's "Class:" line shows (issue #15): the title worked out from `titles` (1.6, the
   * default), the character's class, or both ("Barbarian, Grunt").
   */
  classLine: z.enum(["title", "class", "both"]).optional(),
  /** The skills (and `HPmax`, `SPmax`) a bio's score adds up. */
  score: z.strictObject({ counted: z.array(z.string()) }),
  /** Every character's last name: castLib 2 member 6's stored text, never placed or written. */
  lastName: z.string(),
  disguise: z.strictObject({ treeMember: z.string(), robeItem: z.string() }),
  medalStrip: z.strictObject({
    slots: z.number().int().positive(),
    items: z.number().int().positive(),
    slotWidth: z.number().int().positive(),
    /** `Medal00`, drawn into every slot first. */
    blankMember: z.number().int().positive(),
    /** `DrawMedal`, the strip's own member (sprite 7). */
    stripMember: z.number().int().positive(),
  }),
  profile: z.strictObject({
    alerts: z.strictObject({ ":": guildText, "/": guildText }),
  }),
});

/** Medal awards at skill 90. */
export const medalsSchema = z.strictObject({
  rule,
  at: z.literal(90),
  awards: z.array(
    z.strictObject({
      skill: z.string(),
      id: z.number().int().positive(),
      text: z.string(),
      /** Its BioWindow member, `Medal<id>`. */
      member: z.number().int().positive(),
      stats: z.partialRecord(
        z.enum(["str", "sta", "dex", "int", "wis"]),
        z.number().int().positive(),
      ),
    }),
  ),
});

const mailTexts = [
  "notInFront",
  "notYours",
  "checking",
  "sending",
  "newMail",
  "reply",
  "tooMany",
] as const;
const boardTexts = ["view", "notInFront", "notMember", "empty", "from"] as const;

/** Mail: the texts and the send limits. */
export const mailSchema = z.strictObject({
  texts: z.strictObject(
    Object.fromEntries(mailTexts.map((k) => [k, guildText])) as {
      [K in (typeof mailTexts)[number]]: typeof guildText;
    },
  ),
  /** A message goes to at most this many different names. */
  recipients: z.literal(7),
  /** Sorting mail scans items 1-100. */
  listScan: z.literal(100),
});

/** Message boards. */
export const boardsSchema = z.strictObject({
  texts: z.strictObject(
    Object.fromEntries(boardTexts.map((k) => [k, guildText])) as {
      [K in (typeof boardTexts)[number]]: typeof guildText;
    },
  ),
  /** The rule between posts. */
  rule: z.string().min(1),
  townSquare: z.string().min(1),
});

const artTexts = [
  "paintFull",
  "paintSaving",
  "photoFull",
  "photoSaving",
  "saved",
  "viewPhoto",
  "viewItem",
  "author",
  "needCamera",
  "noPicture",
  "notInFront",
] as const;
const intPair = z.number().int();

/** Paintings and photos: the texts and the paint rules. */
export const artSchema = z.strictObject({
  texts: z.strictObject(
    Object.fromEntries(artTexts.map((k) => [k, guildText])) as {
      [K in (typeof artTexts)[number]]: typeof guildText;
    },
  ),
  /** The bag test counts non-empty lines among 1-`bagLines`; more than `bagMax` is full. */
  bagLines: z.literal(15),
  bagMax: z.literal(14),
  /** The camera lens bounds, exclusive. */
  lens: z.strictObject({ hMin: intPair, hMax: intPair, vMin: intPair, vMax: intPair }),
  size: z.literal(64),
  scale: z.literal(4),
  /** Tools 1-4: blend per brush used, and the four brush masks `[l, t, r, b]`. */
  tools: z
    .array(
      z.strictObject({
        blends: z.array(z.number().int().min(1).max(255)).min(1).max(4),
        rects: z.array(z.tuple([intPair, intPair, intPair, intPair])).length(4),
      }),
    )
    // Four tools: PaintTool 1-8 and the client's eight buttons.
    .length(4),
  /** Darken/lighten tools: the centre pixel's change and the four arms'. */
  shade: z.strictObject({ centre: intPair, arm: intPair }),
});

/** The High Score Statue: the server's top-ten ranking of player scores. */
export const highScoresSchema = z.strictObject({
  item: z.strictObject({ text: z.string().min(1) }),
  text: z.string().min(1),
  pause: z.number().int().positive(),
  header: z.string().min(1),
  entry: z.string().min(1),
  perLine: z.number().int().positive(),
  separator: z.string().min(1),
  tableSize: z.number().int().positive(),
  /** 1.6 rolled `random(3) = 1` on character save (recorded; SSO submits the score on every save). */
  oneSaveIn: z.number().int().positive(),
});

/** The newspaper. */
export const newspaperSchema = z.strictObject({
  view: guildText,
  notInFront: guildText,
  saved: guildText,
  noStand: guildText,
  standTile: guildText,
  suffix: guildText,
  /** The editor's cast text before a reply fills it. */
  defaults: z.strictObject({
    title: z.string(),
    photoName: z.string(),
    photo3: z.string(),
  }),
});

export const socialDataSchema = z
  .strictObject({
    factions: z.array(factionSchema).superRefine((rows, ctx) => {
      const keys = new Set<string>();
      rows.forEach((f, i) => {
        if (keys.has(f.key.toLowerCase())) {
          ctx.addIssue({ code: "custom", path: [i, "key"], message: `duplicate faction ${f.key}` });
        }
        keys.add(f.key.toLowerCase());
        const kinds = new Set<string>();
        f.perks.forEach((p, j) => {
          if (kinds.has(p.kind)) {
            ctx.addIssue({
              code: "custom",
              path: [i, "perks", j, "kind"],
              message: `duplicate perk ${p.kind}`,
            });
          }
          kinds.add(p.kind);
        });
      });
    }),
    factionRules: z.strictObject({
      /**
       * A member's tier from its faction's power: `top`, then each row whose `below` the power is
       * under sets its `tier`, the last one winning.
       */
      tiers: z.strictObject({
        top: z.number().int().nonnegative(),
        below: z.array(
          z.strictObject({ below: z.number().int(), tier: z.number().int().nonnegative() }),
        ),
      }),
      /** A perk's value for anyone whose faction has no such perk, or who is in none. Absent = 0. */
      perkDefaults: z.partialRecord(z.enum(FACTION_PERKS), z.number().int()),
      /** The factions the World Editor's three spawn boxes pick, in box order (W, M, A in Classic). */
      editorBoxes: z.array(z.string().min(1)).max(3),
      loyaltyPerFrame: z.strictObject({ rule }),
      headDrop: z.strictObject({ rule }),
      exile: z.strictObject({ rule }),
      loginJoin: z.strictObject({ rule }),
      turnIn: z.strictObject({
        rule,
        ownHead: z.string(),
        rivalHead: z.string(),
        missingPowers: z.string(),
      }),
      sayFaction: z.strictObject({
        rule,
        fine: z.string(),
        weak: z.string(),
        absolute: z.string(),
      }),
    }),
    murder: z.strictObject({
      wanted: z.strictObject({ text: z.string(), sender: z.string() }),
      pardoned: z.strictObject({ text: z.string(), sender: z.string() }),
      pardoning: z.strictObject({ text: z.string(), rule }),
      flagRule: z.strictObject({ rule }),
    }),
    questReplies: z.strictObject({
      give: z.strictObject({
        rule,
        thanks: z.string(),
        sorry: z.string(),
        lines: z.number().int().positive(),
      }),
      /** Oraku's orb quest; left out, no NPC takes an orb. */
      oraku: z
        .strictObject({
          npc: z.string(),
          item: z.string(),
          reward: z.string(),
          text: z.string(),
        })
        .optional(),
      say: z.strictObject({ rule, bring: z.string(), nothing: z.string() }),
    }),
    /** The Assassin's game; left out, there is none (no /assassin, no score, no statue). */
    assassin: assassinSchema.optional(),
    highScores: highScoresSchema,
    guilds: guildsSchema,
    chat: chatSchema,
    buddies: buddiesSchema,
    bios: biosSchema,
    medals: medalsSchema,
    mail: mailSchema,
    boards: boardsSchema,
    art: artSchema,
    newspaper: newspaperSchema,
  })
  .superRefine((data, ctx) => {
    const keys = new Set(data.factions.map((f) => f.key.toLowerCase()));
    data.factionRules.editorBoxes.forEach((k, i) => {
      if (!keys.has(k.toLowerCase())) {
        ctx.addIssue({
          code: "custom",
          path: ["factionRules", "editorBoxes", i],
          message: `editorBoxes names no faction ${JSON.stringify(k)}`,
        });
      }
    });
  });

export type Faction = z.infer<typeof factionSchema>;
export type FactionPerk = z.infer<typeof factionPerkSchema>;
export type SocialData = z.infer<typeof socialDataSchema>;
