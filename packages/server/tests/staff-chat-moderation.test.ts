/**
 * Staff chat under a mute or the jail, and `Password=` lines longer than the chat cap.
 */
import { describe, expect, test } from "bun:test";

import {
  ADMINISTRATOR,
  CHAT_COLOR,
  endIso,
  MODERATION_TEXT,
  MODERATOR,
  PASSWORD_TEXT,
  type ServerMsg,
} from "@secondstaronline/shared";

import { helpLines } from "../src/game.ts";
import { type ChatDeps, handleChat } from "../src/systems/chat/chat.ts";
import { player, setup, testMap } from "./helpers/sim.ts";

type Out = { to: string; msg: ServerMsg }[];
const texts = (out: Out, id: string) =>
  out.flatMap((o) => (o.to === id && o.msg.t === "chat" ? [o.msg.text] : []));

function staff() {
  const map = testMap("x1000y992");
  const s = setup([map]);
  const adm = player("Adm", map, 5, 5);
  adm.role = ADMINISTRATOR;
  const mod = player("Mod", map, 6, 6);
  mod.role = MODERATOR;
  s.join(adm);
  s.join(mod);
  return { world: s.world, adm, mod };
}

describe("staff chat and moderation", () => {
  const deps: ChatDeps = {
    maxChars: 200,
    broadcastCooldownFrames: 0,
    chatCooldownFrames: 0,
    helpLines,
  };

  test("SSO: a muted staff member cannot post staff chat", () => {
    const { world, mod } = staff();
    mod.muteUntil = Date.parse("2030-01-01T00:00:00.000Z");
    const out = handleChat(world, mod, "-hello", deps);
    expect(texts(out, "Mod")).toEqual([MODERATION_TEXT.youAreMuted(endIso(mod.muteUntil))]);
    expect(texts(out, "Adm")).toEqual([]);
  });

  test("a jailed staff member keeps staff chat, like an IM to staff", () => {
    const { world, mod } = staff();
    mod.jailUntil = Date.parse("2030-01-01T00:00:00.000Z");
    const out = handleChat(world, mod, "-hello", deps) as Out;
    expect(
      out.some((o) => o.to === "Adm" && o.msg.t === "chat" && o.msg.color === CHAT_COLOR.staff),
    ).toBe(true);
  });
});

describe("Password= and the chat cap", () => {
  test("SSO: a Password= line longer than the chat cap is refused, not cut", () => {
    const { world, adm } = staff();
    const changed: string[] = [];
    const deps: ChatDeps = {
      maxChars: 20,
      broadcastCooldownFrames: 0,
      chatCooldownFrames: 0,
      helpLines,
      changePassword: (_p, pw) => {
        changed.push(pw);
      },
    };
    expect(texts(handleChat(world, adm, `Password=${"x".repeat(20)}`, deps), "Adm")).toEqual([
      PASSWORD_TEXT.refused,
    ]);
    expect(changed).toEqual([]);
    expect(handleChat(world, adm, "Password=short", deps)).toEqual([]);
    expect(changed).toEqual(["short"]);
  });
});
