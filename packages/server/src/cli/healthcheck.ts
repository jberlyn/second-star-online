/**
 * Container healthcheck: verifies `/`, an emitted JS bundle, and one generated asset from
 * `packages/data/assets/index.json` return HTTP 200 with non-empty bodies without logging in or
 * modifying world state.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ASSETS_DIR = join(import.meta.dir, "..", "..", "..", "data", "assets");
const TIMEOUT_MS = 4000;

async function fetchOk(url: string, expectHtml = false): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  if (expectHtml) {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) {
      throw new Error(`${url} returned non-HTML content-type: ${ct}`);
    }
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) {
    throw new Error(`${url} returned an empty body`);
  }
  return expectHtml ? new TextDecoder().decode(buf) : "";
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const base = `http://127.0.0.1:${port}`;

  const html = await fetchOk(`${base}/`, true);
  const jsMatch = /<script[^>]+src="([^"]+\.js)"/i.exec(html);
  if (!jsMatch?.[1]) {
    throw new Error("no emitted JS script tag found in /");
  }
  const jsUrl = new URL(jsMatch[1], base).href;
  await fetchOk(jsUrl);

  const index = JSON.parse(readFileSync(join(ASSETS_DIR, "index.json"), "utf8")) as {
    ui?: Record<string, { file?: string }>;
    atlases?: Record<string, { sheets?: string[] }>;
  };
  const uiFile = Object.values(index.ui ?? {}).find((u) => typeof u.file === "string")?.file;
  const sheetFile = Object.values(index.atlases ?? {}).find((a) => a.sheets?.[0])?.sheets?.[0];
  const assetRel = uiFile ?? sheetFile;
  if (!assetRel) {
    throw new Error("no generated asset found in index.json");
  }
  await fetchOk(`${base}/assets/${assetRel}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
