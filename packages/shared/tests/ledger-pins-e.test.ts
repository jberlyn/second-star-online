/**
 * Pins for docs/differences-from-fso.md on the client → server protocol: no message names an item
 * to create, and none carries a file path or asks to view a character.
 */
import { describe, expect, test } from "bun:test";

import { inGameSchema, preAuthSchema } from "../src/protocol/messages.ts";

/** Zod's internal definitions, walked by hand. */
type Def = any;

/** Every leaf of a schema as `path:type` (`text:string`, `slot:number`, `items[].qty:number`). */
function leaves(schema: Def, path: string, out: string[]): void {
  const d = schema._zod.def;
  switch (d.type) {
    case "object":
      for (const [k, v] of Object.entries(d.shape)) {
        leaves(v, path ? `${path}.${k}` : k, out);
      }
      return;
    case "optional":
    case "nullable":
    case "default":
    case "readonly":
    case "nonoptional":
      leaves(d.innerType, path, out);
      return;
    case "array":
      leaves(d.element, `${path}[]`, out);
      return;
    case "tuple":
      for (const x of d.items) {
        leaves(x, `${path}[]`, out);
      }
      return;
    case "union":
      for (const x of d.options) {
        leaves(x, path, out);
      }
      return;
    case "record":
      leaves(d.valueType, `${path}{}`, out);
      return;
    case "pipe":
      leaves(d.in, path, out);
      return;
    default:
      out.push(`${path}:${d.type === "string" && d.format ? d.format : d.type}`);
  }
}

const messages: { t: string; schema: Def }[] = [preAuthSchema, inGameSchema].flatMap((u) =>
  (u as Def)._zod.def.options.map((o: Def) => ({
    t: o._zod.def.shape.t._zod.def.values[0] as string,
    schema: o,
  })),
);

const fields = (t: string): string[] => {
  const m = messages.find((x) => x.t === t);
  if (!m) {
    throw new Error(`no message ${t}`);
  }
  const out: string[] = [];
  leaves(m.schema, "", out);
  return [...new Set(out)].filter((f) => !f.startsWith("t:"));
};

/** Every free-text field a client can send, by message. */
const stringFields = (): Record<string, string[]> =>
  Object.fromEntries(
    messages
      .map((m) => [m.t, fields(m.t).filter((f) => f.endsWith(":string"))] as const)
      .filter(([, f]) => f.length > 0),
  );

describe("Only server systems create items", () => {
  test("SSO: every item intent names bag slots, counts or ground ids, never an item", () => {
    expect(
      Object.fromEntries(
        [
          "use",
          "equip",
          "drop",
          "give",
          "arrange",
          "craft",
          "storage",
          "placeHouse",
          "unequip",
          "pickup",
          "crystals",
          "gold",
          "buy",
          "sell",
          "train",
          "vaultTake",
          "tradeOffer",
        ].map((t) => [t, fields(t)]),
      ),
    ).toEqual({
      use: ["slot:number"],
      equip: ["slot:number"],
      drop: ["slot:number", "n:number"],
      give: ["slot:number", "n:number"],
      arrange: ["from:number", "to:number"],
      craft: ["slot:number"],
      storage: ["slot:number"],
      placeHouse: ["slot:number", "x:number", "y:number"],
      unequip: ["slot:enum"],
      pickup: ["id:uuid"],
      crystals: ["slot:number", "n:number", "mode:enum"],
      gold: ["n:number"],
      buy: ["line:number", "count:number"],
      sell: ["line:number", "count:number"],
      train: ["line:number"],
      vaultTake: ["index:number"],
      tradeOffer: ["gold:number", "items[].slot:number", "items[].qty:number"],
    });
    // Strict schemas: an item name added to an intent is refused, not ignored.
    for (const msg of [
      { t: "drop", slot: 1, item: "Rune Sword" },
      { t: "give", slot: 1, item: "Rune Sword" },
      { t: "use", slot: 1, item: "Rune Sword" },
      { t: "pickup", id: "00000000-0000-4000-8000-000000000000", item: "Rune Sword" },
      { t: "tradeOffer", gold: 0, items: [{ slot: 1, qty: 1, item: "Rune Sword" }] },
    ]) {
      expect(inGameSchema.safeParse(msg).success).toBe(false);
    }
  });

  test("SSO: the only free text a client sends is chat, mail, names and the editors' fields", () => {
    // A new string field must be added here deliberately. Of these, only the World Editor's placed
    // items (`contentMapSave`, worldEditor permission) and an administrator's `/drop` in `chat` text name
    // an item for the server to create, each checked by the server.
    expect(stringFields()).toEqual({
      login: ["name:string", "password:string"],
      create: ["name:string", "password:string"],
      step: ["at.map:string"],
      chat: ["text:string"],
      cast: ["spell:string"],
      // The Activity Log's query (activityLog permission): read-only filters, never an item made.
      activityQuery: [
        "name:string",
        "types[]:string",
        "since:string",
        "until:string",
        "before.at:string",
        "before.id:string",
      ],
      // The player hub (characterView permission): a character by name, and a moderation button's
      // length and reason, each read by the chat command's own code. Nothing names an item.
      // The Content page (contentEditor permission): rows of the content store by dataset, field and
      // key, a publish's summary and the draft revision it saw, a publish id. `contentDraft` also carries a
      // row's JSON (`data`), which changes what an item is, never makes one: the server validates
      // it against the dataset's schema and the pre-publish checks, and every publish can be undone.
      contentList: ["dataset:string", "part:string"],
      contentRow: ["dataset:string", "part:string", "key:string"],
      // `expect` is a balance row's revision as the page saw it (issue #19), compared, never stored.
      contentDraft: ["dataset:string", "part:string", "key:string", "expect:string"],
      contentDiscard: ["dataset:string", "part:string", "key:string", "expect:string"],
      contentPublish: ["summary:string", "draftRev:string"],
      contentUndo: ["id:string"],
      contentNotice: ["dataset:string", "part:string", "key:string"],
      // Where-used and removal (issue #28): an item or monster by key, and the item or monster its
      // copies, spawns and references become. The server resolves both against the content store.
      contentUsage: ["key:string"],
      contentRemove: ["key:string", "replacement:string"],
      // A picture change (issue #29): an item by key, an uploaded file by its SHA-256 (64 hex
      // digits, checked by the schema), a picture's name. The server resolves the item and the
      // picture against the draft and changes only the item's `sprite` and its upload.
      // The Packs page (issue #34): a checked pack file by its import id, a pack by its id.
      contentPackApply: ["importId:string"],
      contentPackRemove: ["id:string"],
      // A house type's placement preview (issue #10) names the house type, checked by the server.
      contentPicture: [
        "change.item:string",
        "change.art.file:string",
        "change.picture:string",
        "change.house:string",
      ],
      // A worn layer change (issue #29, stage 3): a layer's name, its frames' uploaded files by
      // SHA-256 (checked by the schema), an item by key. A sheet to cut into frames, by SHA-256.
      contentWorn: ["change.layer:string", "change.frames{}:string", "change.item:string"],
      contentWornSheet: ["sheet:string"],
      // A body change (issue #29, stage 4): a monster by key, its frames' uploaded files by
      // SHA-256 (checked by the schema), and `owner`, the monster (by key) whose own body a
      // replacement is for. A body sheet to cut into frames, by SHA-256.
      contentBody: ["change.owner:string", "change.frames{}.file:string", "change.monster:string"],
      contentBodySheet: ["sheet:string"],
      // An effect run change (issue #29, stage 5): a run by name, its frames' and trail's uploaded
      // files by SHA-256 (checked by the schema), and `seen`, who the panel said draws the run (the
      // change is refused if that changed), and `expect`, the upload's 8-hex-digit fingerprint as the
      // panel saw it. A strip to cut into frames, by SHA-256.
      contentFx: [
        "change.run:string",
        "change.frames[].file:string",
        "change.trail[].file:string",
        "change.seen[]:string",
        "change.expect:string",
      ],
      contentFxSheet: ["sheet:string"],
      // A tile change (issue #29, stage 6): tiles by code, their uploaded files by SHA-256 (checked
      // by the schema), a tile's name (what the hover tip calls it), and `expect` and `seen`, the
      // upload's and the tile's 8-hex-digit fingerprints as the panel saw them. A tileset to cut
      // into tiles, by SHA-256. The server gives new tiles their codes; nothing here names an item.
      contentTile: [
        "change.tiles[].file:string",
        "change.tiles[].name:string",
        "change.code:string",
        "change.file:string",
        "change.expect:string",
        "change.name:string",
        "change.seen:string",
      ],
      contentTileSheet: ["sheet:string"],
      // A sound change (issue #29, stage 7, contentEditor permission): the name content plays the
      // sound by, the uploaded file by SHA-256, and its upload's fingerprint as the panel saw it.
      // A sound is never an item, and the server checks the file's bytes before writing the row.
      contentSound: ["change.name:string", "change.file:string", "change.expect:string"],
      // A Balance page change (issue #19, contentEditor permission): a row of the balance dataset
      // by field and key (the server accepts only the rows the page edits), and the row's
      // fingerprint as the page saw it. Its `data` is the row's numbers, checked against the
      // dataset's schema and limits; nothing here names an item.
      contentBalanceSet: ["part:string", "key:string", "expect:string"],
      // The Items page (issue #30, contentEditor permission): an item by key, a new item's key and
      // display name, the item a new one copies, and the item's fingerprint as the page saw it.
      // A definition (`data`) changes what an item does, never makes one: the server checks it
      // against the schema and the pre-publish checks; a new item goes into the draft, published
      // and undone like any other row.
      contentItems: ["name:string"],
      contentItemSet: ["name:string", "display:string", "copyFrom:string", "expect:string"],
      // The Monsters page (issue #31): a monster's key, display name and the monster it copies,
      // each checked by the server like the Items page's.
      contentMonsters: ["name:string"],
      contentMonsterSet: ["name:string", "display:string", "copyFrom:string", "expect:string"],
      contentMonsterSpells: ["expect:string"],
      // The Skills and Gathering pages (issue #38): a skill's key (a new one's is checked as a
      // key), the skill's or gathering part's revision as the page saw it. A form's `data` and a
      // removal's `refs` are checked by the server field by field; nothing here names an item.
      contentSkills: ["key:string"],
      contentSkillSet: ["key:string", "expect:string"],
      contentSkillUsage: ["key:string"],
      contentSkillRemove: ["key:string", "expect:string"],
      contentGatheringSet: ["expect:string"],
      // The NPCs page (issue #32): a whole NPC file's text, checked by the server as the NPC
      // Editor's SAVE is (contentEditor permission).
      contentNpcs: ["name:string"],
      contentNpcSave: ["name:string", "text:string", "expect:string"],
      // A monster's NPC file sections (issue #31): the server checks each loot item and spell tag,
      // and writes the file through the NPC Editor's own check.
      contentNpcFile: ["name:string"],
      contentNpcFileSet: [
        "name:string",
        "expect:string",
        "sections.loot[].item:string",
        "sections.spells[]:string",
        "sections.flags[]:string",
      ],
      characterSearch: ["query:string"],
      characterOpen: ["name:string"],
      characterModerate: ["name:string", "duration:string", "reason:string"],
      // The character editor (characterEditor permission): an admin's new values for one
      // character, with what the hub showed for them. The server checks every item, spell and map
      // against the game's own lists and limits; the edit is logged and can be undone.
      characterEdit: [
        "name:string",
        "set.faction:string",
        "set.respawn.map:string",
        "set.bag[].item:string",
        "set.equip.weapon:string",
        "set.equip.offHand:string",
        "set.equip.head:string",
        "set.equip.body:string",
        "set.equip.feet:string",
        "set.equip.ring:string",
        "set.vault[]:string",
        "set.spellbook[]:string",
        "set.position.map:string",
        "seen.faction:string",
        "seen.respawn.map:string",
        "seen.bag[].item:string",
        "seen.equip.weapon:string",
        "seen.equip.offHand:string",
        "seen.equip.head:string",
        "seen.equip.body:string",
        "seen.equip.feet:string",
        "seen.equip.ring:string",
        "seen.vault[]:string",
        "seen.spellbook[]:string",
        "seen.position.map:string",
        "reason:string",
      ],
      characterUndo: ["name:string", "id:string", "reason:string"],
      // The hub's houses (issue #36): a house by its interior's map name and a new owner by
      // character name; the server reads what the house holds itself and refuses a change made
      // over a stale preview (`expect`).
      characterHousePreview: ["name:string", "interior:string", "to:string"],
      characterHouseRevoke: ["name:string", "interior:string", "expect:string", "reason:string"],
      characterHouseTransfer: [
        "name:string",
        "interior:string",
        "to:string",
        "expect:string",
        "reason:string",
      ],
      // The World page (issue #33): a map as the World Editor's SAVE sent it, and the revision.
      contentMapSave: [
        "map.layers[][]:string",
        "map.flags.canFight:string",
        "map.flags.fctSpwn:string",
        "map.flags.isIndoors:string",
        "map.flags.canPvp:string",
        "map.header:string",
        "map.signs[]:string",
        "map.fog.tex:string",
        "map.mobs[].name:string",
        "map.items[].name:string",
        "expect:string",
      ],
      contentMapRestore: ["version:string", "expect:string"],
      roleSave: ["role.id:string", "role.name:string", "role.permissions[]:string"],
      roleDelete: ["id:string"],
      roleAssign: ["name:string", "role:string"],
      // The crafting window's Make (issue #45): a recipe of the open station, by name, which the
      // server looks up; it creates only what that recipe makes.
      recipeMake: ["recipe:string"],
      guildCreate: ["name:string"],
      bjBid: ["text:string"],
      guildView: ["name:string"],
      guildAction: ["viewing:string", "member:string"],
      mailSend: ["to:string", "subject:string", "body:string"],
      boardPost: ["text:string"],
      artSave: ["png:string"],
      newspaperSave: ["photos[]:string", "texts[]:string"],
      im: ["to:string", "text:string"],
      away: ["text:string"],
      roomSay: ["text:string"],
      bioRequest: ["id:string", "name:string"],
      profileSave: ["text:string"],
      friendRemove: ["name:string"],
      prefsSave: [
        "prefs.keyBindings.moveUp[]:string",
        "prefs.keyBindings.moveDown[]:string",
        "prefs.keyBindings.moveLeft[]:string",
        "prefs.keyBindings.moveRight[]:string",
        "prefs.keyBindings.turn[]:string",
        "prefs.keyBindings.attack[]:string",
        "prefs.keyBindings.action[]:string",
        "prefs.keyBindings.chat[]:string",
        "prefs.keyBindings.commandChat[]:string",
        "prefs.keyBindings.tabStats[]:string",
        "prefs.keyBindings.tabInventory[]:string",
        "prefs.keyBindings.tabSkills[]:string",
        "prefs.keyBindings.tabSpellbook[]:string",
        "prefs.keyBindings.windowFriends[]:string",
        "prefs.keyBindings.windowWho[]:string",
      ],
      ignoreAdd: ["name:string"],
      ignoreRemove: ["name:string"],
    });
  });
});

describe("File editor and path-based file access removed", () => {
  test("SSO: no client message carries a file path or asks to view a character", () => {
    const keys = messages.flatMap((m) => fields(m.t).map((f) => `${m.t}: ${f.split(":")[0]}`));
    // A picture change names an uploaded file by its SHA-256, which the schema checks is 64 hex
    // digits: a hash, never a path (issue #29).
    expect(keys.filter((k) => /path|file|folder|directory/i.test(k.split(": ")[1] ?? ""))).toEqual([
      "contentPicture: change.art.file",
      "contentBody: change.frames{}.file",
      "contentFx: change.frames[].file",
      "contentFx: change.trail[].file",
      "contentTile: change.tiles[].file",
      "contentTile: change.file",
      "contentSound: change.file",
    ]);
    const types = messages.map((m) => m.t);
    // 1.6's file transfer, file editor and character loading/viewing have no message. What the
    // names match: the World Editor's load, the Control Panel's player hub (a character by name, read
    // through the server for a role with characterView, never a file), a guild page, closing a
    // painting, a newspaper, the profile. The hub's editor (characterEditor) changes a character
    // through the server's own checks, never by writing a file; its houses (issue #36) name a
    // house by its interior map and a new owner by name. The Content page's overview
    // (contentEditor) reads the content store's draft and history, not a file. Its upload ticket
    // (issue #29) carries nothing: an upload is stored under the hash of its bytes, never a path.
    // The Monsters page's NPC file sections (issue #31) name an NPC file by monster name, never a
    // path, and write it through the NPC file check. (The NPC Editor's load went with its window,
    // issue #32; the NPCs page names an NPC by name too.)
    expect(types.filter((t) => /file|transfer|char|view|load/i.test(t))).toEqual([
      "contentOverview",
      "contentUploadTicket",
      "contentNpcFile",
      "contentNpcFileSet",
      "characterSearch",
      "characterOpen",
      "characterModerate",
      "characterEdit",
      "characterUndo",
      "characterHousePreview",
      "characterHouseRevoke",
      "characterHouseTransfer",
      "guildView",
      "viewClose",
      "newspaperLoad",
      "profileSave",
    ]);
    expect(fields("guildView")).toEqual(["name:string"]);
    expect(fields("viewClose")).toEqual([]);
    for (const t of ["fileRead", "fileWrite", "fileEditor", "viewChar", "view", "charLoad"]) {
      expect(types).not.toContain(t);
      expect(inGameSchema.safeParse({ t, path: "../sso.sqlite" }).success).toBe(false);
    }
    // The loads that remain address data by id: map coordinates and an NPC's name.
    expect(fields("contentMaps")).toEqual(["seq:number", "mx:number", "my:number", "list:boolean"]);
    expect(fields("newspaperLoad")).toEqual([]);
    expect(fields("contentNpcs")).toEqual(["seq:number", "name:string"]);
    expect(
      inGameSchema.safeParse({
        t: "contentMaps",
        seq: 1,
        mx: 1000,
        my: 992,
        path: "maps/x1000y992.txt",
      }).success,
    ).toBe(false);
  });

  test("SSO: no client message field carries a result: hit points, damage, XP, level, a kill or a score", () => {
    const named = messages.flatMap(({ t, schema }) => {
      const out: string[] = [];
      leaves(schema, "", out);
      return out.map((leaf) => `${t}.${leaf.split(":")[0]}`);
    });
    const last = (f: string) =>
      f
        .split(".")
        .pop()
        ?.replace(/\[\]|\{\}/g, "") ?? "";
    // Only the character editor's admin edit (characterEditor permission) names a level, XP, HP or
    // SP: an admin's correction, checked against the game's limits and logged, never a result of
    // play reported by a client.
    const admin = (f: string) => f.startsWith("characterEdit.");
    expect(
      named.filter(
        (f) =>
          !admin(f) &&
          /^(hp|hpmax|sp|spmax|health|dmg|damage|xp|exp|level|kill|kills|score)$/i.test(last(f)),
      ),
    ).toEqual([]);
    expect(named.filter(admin).filter((f) => /^(hp|sp|exp|level)$/.test(last(f)))).toEqual([
      "characterEdit.set.level",
      "characterEdit.set.exp",
      "characterEdit.set.hp",
      "characterEdit.set.sp",
      "characterEdit.seen.level",
      "characterEdit.seen.exp",
      "characterEdit.seen.hp",
      "characterEdit.seen.sp",
    ]);
  });

  test("SSO: no client message field sets a body, makes food or fires an effect", () => {
    const named = messages.flatMap(({ t, schema }) => {
      const out: string[] = [];
      leaves(schema, "", out);
      return out.map((leaf) => `${t}.${leaf.split(":")[0]}`);
    });
    const last = (f: string) =>
      f
        .split(".")
        .pop()
        ?.replace(/\[\]|\{\}/g, "") ?? "";
    expect(
      named.filter(
        // `mailSend.body` is a letter's text, not a character's body; the character editor's
        // `equip.body` is the worn armour's name; `contentBody`'s body is the content body an
        // operator paints or gives a monster (contentEditor permission), never the sender's own.
        (f) =>
          f !== "mailSend.body" &&
          f !== "contentBody.change.body" &&
          !/^characterEdit\.(set|seen)\.equip\.body$/.test(f) &&
          /^(body|food|fx|effect|fireball|summon|portal)$/i.test(last(f)),
      ),
    ).toEqual([]);
  });
});
