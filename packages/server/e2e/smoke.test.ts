import { afterAll, beforeAll, expect, test } from "bun:test";

import { connectBot, startTestServer, type TestServer } from "./harness.ts";

// Boot, serve the page, connect, shut down.
let server: TestServer;

beforeAll(() => {
  server = startTestServer();
});

afterAll(async () => {
  await server.stop();
});

test("serves the client page from the same origin", async () => {
  const res = await fetch(server.url);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<title>Second Star Online</title>");
});

test("a WebSocket on /ws accepts a login attempt", async () => {
  const bot = await connectBot(server.wsUrl);
  bot.send({ t: "login", name: "nobody", password: "x" });
  const reply = await bot.waitFor((m) => m.t === "denied");
  expect(reply).toEqual({
    t: "denied",
    text: "That character name does not exist on this server. You must create the character to play.",
  });
  bot.close();
});

test("unknown paths and asset paths that escape the folder are 404", async () => {
  expect((await fetch(new URL("/nope", server.url))).status).toBe(404);
  expect((await fetch(new URL("/assets/../package.json", server.url))).status).toBe(404);
});
