import { expect, test } from "bun:test";

import { MAP_HEIGHT, MAP_WIDTH } from "@secondstaronline/shared";

test("server resolves the shared workspace package", () => {
  expect([MAP_WIDTH, MAP_HEIGHT]).toEqual([17, 12]);
});
