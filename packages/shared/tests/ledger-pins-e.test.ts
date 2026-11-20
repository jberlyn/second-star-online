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
    // items (`editSave`, worldEditor permission) and an administrator's `/drop` in `chat` text name
    // an item for the server to create, each checked by the server.
    expect(stringFields()).toEqual({
      login: ["name:string", "password:string"],
      create: ["name:string", "password:string"],
      step: ["at.map:string"],
      chat: ["text:string"],
      cast: ["spell:string"],
      editSave: [
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
      ],
      npcLoad: ["name:string"],
      npcSave: ["name:string", "text:string"],
      roleSave: ["role.id:string", "role.name:string", "role.permissions[]:string"],
      roleDelete: ["id:string"],
      roleAssign: ["name:string", "role:string"],
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
    });
  });
});

describe("File editor and path-based file access removed", () => {
  test("SSO: no client message carries a file path or asks to view a character", () => {
    const keys = messages.flatMap((m) => fields(m.t).map((f) => `${m.t}: ${f.split(":")[0]}`));
    expect(keys.filter((k) => /path|file|folder|directory/i.test(k.split(": ")[1] ?? ""))).toEqual(
      [],
    );
    const types = messages.map((m) => m.t);
    // 1.6's file transfer, file editor and character loading/viewing have no message. What the
    // names match: two editor loads, a guild page, closing a painting, a newspaper, the profile.
    expect(types.filter((t) => /file|transfer|char|view|load/i.test(t))).toEqual([
      "editLoad",
      "npcLoad",
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
    expect(fields("editLoad")).toEqual(["mx:number", "my:number"]);
    expect(fields("newspaperLoad")).toEqual([]);
    expect(fields("npcLoad")).toEqual(["name:string"]);
    expect(
      inGameSchema.safeParse({ t: "editLoad", mx: 1000, my: 992, path: "maps/x1000y992.txt" })
        .success,
    ).toBe(false);
  });
});
