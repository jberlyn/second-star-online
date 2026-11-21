/**
 * Configurable roles (issue #7): the roles migration, the Server Settings window's Roles and Staff
 * pages through the real database, and role tags in chat.
 */
import { beforeEach, describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  CHAT_COLOR,
  LOCKOUT_TEXT,
  MODERATOR,
  PERMISSIONS,
  ROLE_TEXT,
  type RoleData,
  type RoleDef,
  roleToData,
  type ServerMsg,
} from "@secondstaronline/shared";

import { createGame } from "../src/game.ts";
import { findAccountByUsername, insertAccount, setRole } from "../src/persistence/accounts.ts";
import { recentAudit, recentCheats } from "../src/persistence/admin.ts";
import { type Db, openDatabase } from "../src/persistence/database.ts";
import { loadMigrations, migrate, runMigrations } from "../src/persistence/migrations.ts";
import { loadRoles } from "../src/persistence/roles.ts";
import { NEVER_PUSH } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const NOW = "2026-11-20T00:00:00.000Z";
const ROLES = "20261120_42_roles.sql";

describe("the roles migration", () => {
  test("immortal becomes administrator, player no role, and moderation rows keep role names", () => {
    const db = openDatabase();
    runMigrations(
      db,
      loadMigrations().filter((m) => m.name < ROLES),
    );
    const acct = (username: string, role: string) =>
      insertAccount(db, { username, passwordHash: "h", now: NOW, role }).id;
    const imm = acct("imm", "immortal");
    const mod = acct("mod", "moderator");
    const bob = acct("bob", "player");
    db.run(
      `INSERT INTO account_bans (account_id, log_id, actor_id, actor_name, actor_rank, created_at)
       VALUES (?, 'l1', ?, 'imm', 'immortal', ?)`,
      [bob, imm, NOW],
    );
    db.run(
      `INSERT INTO moderation_log (id, action, account_id, actor_id, actor_name, actor_rank, created_at)
       VALUES ('l1', 'ban', ?, ?, 'imm', 'immortal', ?), ('l2', 'mute', ?, ?, 'mod', 'moderator', ?)`,
      [bob, imm, NOW, bob, mod, NOW],
    );
    migrate(db);
    const role = (id: string) =>
      db.query<{ role: string | null }, [string]>("SELECT role FROM accounts WHERE id = ?").get(id)
        ?.role;
    expect([role(imm), role(mod), role(bob)]).toEqual(["administrator", "moderator", null]);
    expect(loadRoles(db).map(roleToData)).toEqual([ADMINISTRATOR, MODERATOR].map(roleToData));
    expect(db.query("SELECT actor_role FROM account_bans").all()).toEqual([
      { actor_role: "Admin" },
    ]);
    expect(db.query("SELECT actor_role FROM moderation_log ORDER BY id").all()).toEqual([
      { actor_role: "Admin" },
      { actor_role: "Moderator" },
    ]);
    // Characters, bans and the rest still point at the rebuilt accounts table.
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("the moderator defaults migration", () => {
  const DEFAULTS = "20261121_45_moderator_defaults.sql";
  const V1_11 = [
    "save",
    "refresh",
    "inventory",
    "location",
    "iplookup",
    "kick",
    "ban",
    "jail",
    "pardon",
    "unban",
    "unjail",
    "banlist",
    "mute",
    "unmute",
    "bypassLoginLimits",
  ];
  const before = (permissions: string[]) => {
    const db = openDatabase();
    runMigrations(
      db,
      loadMigrations().filter((m) => m.name < DEFAULTS),
    );
    db.run("UPDATE roles SET permissions = ? WHERE id = 'moderator'", [
      JSON.stringify(permissions),
    ]);
    migrate(db);
    return loadRoles(db).find((r) => r.id === "moderator");
  };

  test("divergence: an untouched moderator role loses /pardon, /iplookup, /save and /refresh", () => {
    expect(roleToData(before(V1_11) as RoleDef)).toEqual(roleToData(MODERATOR));
    // Saved again from the Roles page, the same permissions may be stored in another order.
    expect(roleToData(before([...V1_11].reverse()) as RoleDef)).toEqual(roleToData(MODERATOR));
  });

  test("a moderator role the operator has edited is left as it is", () => {
    const edited = V1_11.filter((p) => p !== "kick");
    expect(roleToData(before(edited) as RoleDef).permissions.sort()).toEqual(edited.sort());
    const added = [...V1_11, "drop"];
    expect(roleToData(before(added) as RoleDef).permissions.sort()).toEqual(added.sort());
  });
});

describe("the Roles and Staff pages (real SQLite)", () => {
  let db: Db;
  const sent: Out = [];

  beforeEach(() => {
    db = openDatabase();
    migrate(db);
    sent.length = 0;
  });

  async function start() {
    const game = createGame({
      db,
      send: (to, msg) => sent.push({ to, msg }),
      isoNow: () => NOW,
      rng: NEVER_PUSH,
    });
    const make = async (name: string, role?: string) => {
      await game.create({
        t: "create",
        name,
        password: "pw",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 10,
        sta: 10,
        int: 10,
        wis: 10,
        dex: 10,
      });
      const l = await game.login(name, "pw", "10.0.0.1");
      if (!l.ok) {
        throw new Error(l.text);
      }
      if (role) {
        setRole(db, l.accountId, role, NOW);
      }
      game.enter(l.characterId, false, "10.0.0.1");
      return l.characterId;
    };
    const to = (id: string, t: ServerMsg["t"]) =>
      sent.filter((o) => o.to === id && o.msg.t === t).map((o) => o.msg);
    const last = (id: string, t: ServerMsg["t"]) => to(id, t).at(-1);
    const texts = (id: string) =>
      sent.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));
    const audit = () =>
      recentAudit(db, 50)
        .filter((r) => r.command.startsWith("role"))
        .map((r) => `${r.actor === "cli" ? "cli" : "x"} ${r.command} ${r.target}`);
    return { game, make, to, last, texts, audit };
  }

  const moderatorWith = (...extra: string[]): RoleData => {
    const d = roleToData(MODERATOR);
    return { ...d, permissions: [...d.permissions, ...extra] };
  };

  test("the window carries the roles, how many hold each, and the staff", async () => {
    const { game, make, last } = await start();
    const alice = await make("Alice", "administrator");
    await make("Mo", "moderator");
    await make("Bob");
    game.intent(alice, { t: "settingsOpen" });
    const msg = last(alice, "settings");
    expect(msg).toMatchObject({
      roles: [
        { ...roleToData(ADMINISTRATOR), holders: 1 },
        { ...roleToData(MODERATOR), holders: 1 },
      ],
      staff: [
        { name: "Alice", role: "administrator" },
        { name: "Mo", role: "moderator" },
      ],
    });
    expect(msg?.t === "settings" && msg.pages.map((p) => p.kind).slice(-2)).toEqual([
      "roles",
      "staff",
    ]);
  });

  test("a role edit applies to everyone online who holds it at once, and is audited", async () => {
    const { game, make, last, texts, audit } = await start();
    const alice = await make("Alice", "administrator");
    const mo = await make("Mo", "moderator");
    await make("Bob");
    game.intent(mo, { t: "chat", text: "/warp Bob x1000y992 3 3" });
    expect(texts(mo).at(-1)).toBe('Unknown command "/warp".');
    game.intent(alice, {
      t: "roleSave",
      role: { ...moderatorWith("warp"), name: "Warden" },
      create: false,
    });
    expect(last(alice, "roleResult")).toEqual({
      t: "roleResult",
      ok: true,
      text: ROLE_TEXT.saved("Warden"),
    });
    expect(last(mo, "permissions")).toEqual({
      t: "permissions",
      permissions: PERMISSIONS.filter((p) => moderatorWith("warp").permissions.includes(p)),
    });
    expect(game.world.players.get(mo)?.role?.name).toBe("Warden");
    game.intent(mo, { t: "chat", text: "/warp Bob x1000y992 3 3" });
    expect(texts(mo).at(-1)).toBe("*** Warping Bob...");
    expect(
      loadRoles(db)
        .find((r) => r.id === "moderator")
        ?.permissions.has("warp"),
    ).toBe(true);
    expect(audit()).toEqual(["x role edit moderator"]);
  });

  test("a new role is given on the Staff page; it makes a player staff at once", async () => {
    const { game, make, last, texts, audit } = await start();
    const alice = await make("Alice", "administrator");
    const bob = await make("Bob");
    const helper = { id: "helper", name: "Helper", rank: 1, permissions: ["kick"] };
    game.intent(alice, { t: "roleSave", role: helper, create: true });
    expect(last(alice, "roleResult")).toMatchObject({ ok: true });
    // The same id again is refused.
    game.intent(alice, { t: "roleSave", role: helper, create: true });
    expect(last(alice, "roleResult")).toEqual({
      t: "roleResult",
      ok: false,
      text: ROLE_TEXT.taken("helper"),
    });
    game.intent(alice, { t: "roleAssign", name: "bob", role: "helper" });
    expect(last(alice, "roleResult")).toMatchObject({ ok: true, text: "Bob is now Helper." });
    expect(last(bob, "permissions")).toEqual({ t: "permissions", permissions: ["kick"] });
    expect(findAccountByUsername(db, "Bob")?.role).toBe("helper");
    // Any role is staff: Bob reads and posts staff chat.
    game.intent(bob, { t: "chat", text: "-hello" });
    expect(texts(alice).at(-1)).toBe('<... Bob tells the staff "hello"');
    game.intent(alice, { t: "roleAssign", name: "Bob", role: null });
    expect(last(bob, "permissions")).toEqual({ t: "permissions", permissions: [] });
    expect(game.world.players.get(bob)?.role).toBeNull();
    expect(audit()).toEqual(["x role create helper", "x role assign Bob", "x role assign Bob"]);
  });

  test("deleting a role leaves its accounts with no role", async () => {
    const { game, make, last, audit } = await start();
    const alice = await make("Alice", "administrator");
    const mo = await make("Mo", "moderator");
    game.intent(alice, { t: "roleDelete", id: "moderator" });
    expect(last(alice, "roleResult")).toMatchObject({ ok: true });
    expect(last(mo, "permissions")).toEqual({ t: "permissions", permissions: [] });
    expect(findAccountByUsername(db, "Mo")?.role).toBeNull();
    expect(loadRoles(db).map((r) => r.id)).toEqual(["administrator"]);
    expect(audit()).toEqual(["x role delete moderator"]);
    expect(recentAudit(db, 5).at(-1)?.before).toContain('"accounts":["Mo"]');
  });

  test("some role always keeps every permission; your own role is not yours to change", async () => {
    const { game, make, last } = await start();
    const alice = await make("Alice", "administrator");
    const lessAdmin = { ...roleToData(ADMINISTRATOR), permissions: ["kick"] };
    const refused = (text: string): ServerMsg => ({ t: "roleResult", ok: false, text });
    game.intent(alice, { t: "roleSave", role: lessAdmin, create: false });
    expect(last(alice, "roleResult")).toEqual(refused(LOCKOUT_TEXT));
    game.intent(alice, { t: "roleDelete", id: "administrator" });
    expect(last(alice, "roleResult")).toEqual(refused(LOCKOUT_TEXT));
    game.intent(alice, { t: "roleAssign", name: "Alice", role: null });
    expect(last(alice, "roleResult")).toEqual(refused(ROLE_TEXT.self));
    game.intent(alice, { t: "roleSave", role: { ...lessAdmin, id: "Bad Id" }, create: true });
    expect(last(alice, "roleResult")).toMatchObject({ ok: false });
    game.intent(alice, { t: "roleAssign", name: "Nobody", role: "moderator" });
    expect(last(alice, "roleResult")).toEqual(refused("There is no character called Nobody."));
    // With a second full role, the administrator role may lose permissions.
    game.intent(alice, {
      t: "roleSave",
      role: { ...roleToData(ADMINISTRATOR), id: "owner", name: "Owner", rank: 3 },
      create: true,
    });
    game.intent(alice, { t: "roleSave", role: lessAdmin, create: false });
    expect(last(alice, "roleResult")).toMatchObject({ ok: true });
    // Alice held administrator, so she loses Server Settings and her window closes.
    expect(last(alice, "permissions")).toEqual({ t: "permissions", permissions: ["kick"] });
    expect(game.world.players.get(alice)?.role?.permissions.has("settings")).toBe(false);
  });

  test("a role change from anyone without the settings permission is refused and logged", async () => {
    const { game, make, last } = await start();
    const mo = await make("Mo", "moderator");
    game.intent(mo, { t: "roleAssign", name: "Mo", role: "administrator" });
    game.intent(mo, { t: "roleSave", role: moderatorWith("warp"), create: false });
    game.intent(mo, { t: "roleDelete", id: "administrator" });
    expect(last(mo, "roleResult")).toBeUndefined();
    expect(findAccountByUsername(db, "Mo")?.role).toBe("moderator");
    expect(loadRoles(db).map((r) => r.id)).toEqual(["administrator", "moderator"]);
    expect(recentCheats(db, 10).map((c) => c.reason)).toEqual([
      "Attempted Admin Access",
      "Attempted Admin Access",
      "Attempted Admin Access",
    ]);
  });

  test("role tags: off by default; on, staff speak as [Role] Name and players as themselves", async () => {
    const { game, make, texts } = await start();
    const alice = await make("Alice", "administrator");
    const bob = await make("Bob");
    game.intent(alice, { t: "chat", text: "hi" });
    expect(texts(bob).at(-1)).toBe('Alice says "hi"');
    game.intent(alice, { t: "settingsSave", values: { roleTags: true } });
    game.intent(alice, { t: "chat", text: "hi" });
    game.intent(alice, { t: "chat", text: "/me waves" });
    expect(texts(bob).slice(-2)).toEqual(['[Admin] Alice says "hi"', "[Admin] Alice  waves"]);
    game.intent(alice, { t: "chat", text: "'hear ye" });
    expect(sent.at(-1)?.msg).toMatchObject({ text: '[Admin] Alice broadcasts "hear ye"' });
    game.intent(alice, { t: "chat", text: "-staff only" });
    expect(sent.at(-1)?.msg).toEqual({
      t: "chat",
      text: '<... [Admin] Alice tells the staff "staff only"',
      color: CHAT_COLOR.staff,
    });
    game.intent(bob, { t: "chat", text: "hello" });
    expect(texts(alice).at(-1)).toBe('Bob says "hello"');
    // A renamed role's tag follows at once.
    game.intent(alice, {
      t: "roleSave",
      role: { ...roleToData(ADMINISTRATOR), name: "GM" },
      create: false,
    });
    game.intent(alice, { t: "chat", text: "now" });
    expect(texts(bob).at(-1)).toBe('[GM] Alice says "now"');
  });
});
