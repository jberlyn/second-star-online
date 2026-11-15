/**
 * Executable container acceptance check (`bun run docker:check`):
 * - Validates `docker-compose.yml` and builds/inspects `second-star-online:local` (non-root `bun`, no
 *   client/perf/original-script trees).
 * - Starts an isolated Compose project on an ephemeral loopback port, waits for `healthy`, checks
 *   `/`, emitted JS/CSS, representative PNG/WAV assets, security headers, and 404 traversal rules.
 * - Exercises WebSocket account/character creation, `admin:role` promotion, `admin:audit`,
 *   immortal World Editor save, graceful SIGTERM stop (< 30 s grace), container recreate
 *   persistence, backup/restore into a second fresh volume, and intact first volume.
 * - Exercises a temporary single trusted nginx TLS reverse proxy (`https://` + `wss://`) with
 *   forwarded client IP verification and confirms Bun is bound to loopback only.
 */
import { expect } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ServerMsg } from "@secondstaronline/shared";

import { connectBot } from "../packages/server/e2e/harness.ts";

const ROOT = resolve(import.meta.dir, "..");
const IMAGE = "second-star-online:local";

function run(cmd: string[], opts: { allowFail?: boolean; env?: Record<string, string> } = {}) {
  const proc = Bun.spawnSync(cmd, {
    cwd: ROOT,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0 && !opts.allowFail) {
    throw new Error(`${cmd.join(" ")} failed (${proc.exitCode}):\n${stderr || stdout}`);
  }
  return { code: proc.exitCode, stdout, stderr };
}

function freePort(): number {
  const s = Bun.serve({ port: 0, fetch: () => new Response("") });
  const port = s.port ?? 0;
  s.stop(true);
  return port;
}

async function waitForHealthy(project: string, overrideFile: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  const cid = run([
    "docker",
    "compose",
    "-p",
    project,
    "-f",
    "docker-compose.yml",
    "-f",
    overrideFile,
    "ps",
    "-q",
    "second-star-online",
  ]).stdout.trim();
  if (!cid) {
    throw new Error("second-star-online container id missing");
  }
  while (Date.now() < deadline) {
    const status = run([
      "docker",
      "inspect",
      "-f",
      "{{.State.Health.Status}}",
      cid,
    ]).stdout.trim();
    if (status === "healthy") {
      return cid;
    }
    if (status === "unhealthy") {
      throw new Error(`container ${cid} became unhealthy`);
    }
    await Bun.sleep(500);
  }
  throw new Error(`container ${cid} did not become healthy within ${timeoutMs}ms`);
}

function writeOverrideCompose(path: string, port: number): void {
  writeFileSync(
    path,
    `services:\n  second-star-online:\n    ports: !override\n      - "127.0.0.1:${port}:3000"\n`,
  );
}

async function checkHttpAndAssets(baseUrl: string): Promise<void> {
  const rootRes = await fetch(baseUrl);
  expect(rootRes.status).toBe(200);
  expect(rootRes.headers.get("content-type")).toContain("text/html");
  expect(rootRes.headers.get("x-content-type-options")).toBe("nosniff");
  expect(rootRes.headers.get("content-security-policy")).toContain("script-src 'self'");
  const html = await rootRes.text();
  expect(html).toContain("<title>Second Star Online</title>");

  const jsMatch = /<script[^>]+src="([^"]+\.js)"/i.exec(html);
  const cssMatch = /<link[^>]+href="([^"]+\.css)"/i.exec(html);
  expect(jsMatch?.[1]).toBeTruthy();
  expect(cssMatch?.[1]).toBeTruthy();

  const jsRes = await fetch(new URL(jsMatch?.[1] ?? "", baseUrl));
  expect(jsRes.status).toBe(200);
  expect(jsRes.headers.get("content-type")).toContain("javascript");
  expect((await jsRes.text()).length).toBeGreaterThan(0);

  const cssRes = await fetch(new URL(cssMatch?.[1] ?? "", baseUrl));
  expect(cssRes.status).toBe(200);
  expect(cssRes.headers.get("content-type")).toContain("text/css");
  expect((await cssRes.text()).length).toBeGreaterThan(0);

  const indexJson = run([
    "docker",
    "run",
    "--rm",
    "--entrypoint",
    "cat",
    IMAGE,
    "/app/packages/data/assets/index.json",
  ]).stdout;
  const idx = JSON.parse(indexJson) as {
    ui?: Record<string, { file?: string }>;
    sounds?: Record<string, string>;
  };
  const pngRel = Object.values(idx.ui ?? {}).find((u) => u.file?.endsWith(".png"))?.file;
  const wavRel = Object.values(idx.sounds ?? {}).find((f) => f.endsWith(".wav"));
  expect(pngRel).toBeTruthy();
  expect(wavRel).toBeTruthy();

  const pngRes = await fetch(new URL(`/assets/${pngRel}`, baseUrl));
  expect(pngRes.status).toBe(200);
  expect(pngRes.headers.get("content-type")).toContain("image/png");
  expect((await pngRes.arrayBuffer()).byteLength).toBeGreaterThan(0);

  const wavRes = await fetch(new URL(`/assets/${wavRel}`, baseUrl));
  expect(wavRes.status).toBe(200);
  expect(wavRes.headers.get("content-type")).toContain("audio/wav");
  expect((await wavRes.arrayBuffer()).byteLength).toBeGreaterThan(0);

  for (const bad of ["/nope", "/../etc/passwd", "/%2e%2e/package.json", "/assets/../package.json"]) {
    const r = await fetch(new URL(bad, baseUrl));
    expect(r.status).toBe(404);
  }
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const scratch = join(ROOT, "perf-results", `docker-smoke-${stamp}`);
  mkdirSync(scratch, { recursive: true });

  const project1 = `sso-smoke-a-${process.pid}`;
  const project2 = `sso-smoke-b-${process.pid}`;
  const override1 = join(scratch, "override-1.yaml");
  const override2 = join(scratch, "override-2.yaml");
  const port1 = freePort();
  const port2 = freePort();
  const tlsPort = freePort();
  writeOverrideCompose(override1, port1);
  writeOverrideCompose(override2, port2);

  const proxyName = `sso-smoke-proxy-${process.pid}`;
  const compose1 = ["docker", "compose", "-p", project1, "-f", "docker-compose.yml", "-f", override1];
  const compose2 = ["docker", "compose", "-p", project2, "-f", "docker-compose.yml", "-f", override2];

  try {
    console.log("1. Validating compose config and building image...");
    run(["docker", "compose", "-f", "docker-compose.yml", "config", "--quiet"]);
    run(["docker", "build", "--platform", "linux/amd64", "-t", IMAGE, "."]);

    console.log("2. Verifying non-root user and excluded build-only paths...");
    const inspectOut = run([
      "docker",
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      IMAGE,
      "-c",
      [
        "id -u",
        "id -g",
        "id -un",
        "test ! -e /app/packages/client",
        "test ! -e /app/packages/perf",
        "test ! -e /app/archive",
        "test ! -e /app/decompiled",
        "test -f /app/dist/client/index.html",
        "test -f /app/packages/data/assets/index.json",
      ].join(" && "),
    ]).stdout.trim().split("\n");
    expect(inspectOut).toEqual(["1000", "1000", "bun"]);

    console.log("3. Starting fresh Compose service and waiting for healthy...");
    run([...compose1, "up", "-d"]);
    const cid1 = await waitForHealthy(project1, override1);
    const portInspect = run(["docker", "port", cid1, "3000/tcp"]).stdout.trim();
    expect(portInspect).toStartWith("127.0.0.1:");

    const baseUrl1 = `http://127.0.0.1:${port1}`;
    const wsUrl1 = `ws://127.0.0.1:${port1}/ws`;
    await checkHttpAndAssets(baseUrl1);

    console.log("4. Creating SmokeHero over /ws, promoting via admin:role, auditing, and editing...");
    {
      const bot = await connectBot(wsUrl1);
      bot.send({
        t: "create",
        name: "SmokeHero",
        password: "secret",
        sex: 1,
        head: 1,
        classCode: 1,
        str: 11,
        sta: 11,
        int: 11,
        wis: 11,
        dex: 11,
      });
      await bot.waitFor((m) => m.t === "created");
      bot.close();
    }

    run([
      ...compose1,
      "exec",
      "-T",
      "second-star-online",
      "bun",
      "run",
      "admin:role",
      "SmokeHero",
      "immortal",
    ]);
    const auditOut = run([
      ...compose1,
      "exec",
      "-T",
      "second-star-online",
      "bun",
      "run",
      "admin:audit",
      "10",
    ]).stdout;
    expect(auditOut).toContain('cli admin:role SmokeHero "player" -> "immortal"');

    {
      const bot = await connectBot(wsUrl1);
      bot.send({ t: "login", name: "SmokeHero", password: "secret" });
      const roleMsg = await bot.waitFor((m) => m.t === "role");
      expect(roleMsg).toEqual({ t: "role", role: "immortal" });
      await bot.waitFor((m) => m.t === "snapshot");
      bot.send({ t: "mapReady" });
      bot.send({ t: "editOpen" });
      const ed = await bot.waitFor(
        (m): m is Extract<ServerMsg, { t: "editor"; editing: true }> =>
          m.t === "editor" && m.editing,
      );
      const map = structuredClone(ed.map);
      map.header = "Smoke Town";
      map.signs = ["Smoke Sign 42", "", ""];
      bot.send({ t: "editSave", map });
      await bot.waitFor((m) => m.t === "alert");
      bot.send({ t: "logout" });
      bot.close();
    }

    console.log("5. Testing graceful SIGTERM stop (< 30s) and recreate persistence...");
    const stopStart = Date.now();
    run([...compose1, "stop", "-t", "30", "second-star-online"]);
    const stopMs = Date.now() - stopStart;
    expect(stopMs).toBeLessThan(30_000);
    const exitCode = run(["docker", "inspect", "-f", "{{.State.ExitCode}}", cid1]).stdout.trim();
    expect(exitCode).toBe("0");

    writeFileSync(
      join(scratch, "compose1.log"),
      run([...compose1, "logs", "--no-color"]).stdout,
    );

    run([...compose1, "up", "-d", "--force-recreate"]);
    await waitForHealthy(project1, override1);
    {
      const bot = await connectBot(wsUrl1);
      bot.send({ t: "login", name: "SmokeHero", password: "secret" });
      const roleMsg = await bot.waitFor((m) => m.t === "role");
      expect(roleMsg).toEqual({ t: "role", role: "immortal" });
      const snap = await bot.waitFor(
        (m): m is Extract<ServerMsg, { t: "snapshot" }> => m.t === "snapshot",
      );
      expect(snap.map.title).toBe("Smoke Town");
      expect(snap.map.signs[0]).toBe("Smoke Sign 42");
      bot.send({ t: "logout" });
      bot.close();
    }

    console.log("6. Backing up stopped world and restoring into a second fresh test volume...");
    run([...compose1, "stop", "-t", "30", "second-star-online"]);
    const backupDir = join(scratch, "world-backup");
    mkdirSync(backupDir, { recursive: true });
    const vol1 = `${project1}_sso-data`;
    run([
      "docker",
      "run",
      "--rm",
      "-u",
      "0:0",
      "-v",
      `${vol1}:/data:ro`,
      "-v",
      `${backupDir}:/backup`,
      "--entrypoint",
      "sh",
      IMAGE,
      "-c",
      "cp -a /data/. /backup/",
    ]);

    // Create second volume, restore backup into it, fix ownership, and verify login + world edit.
    const vol2 = `${project2}_sso-data`;
    run([...compose2, "up", "--no-start"]);
    run([
      "docker",
      "run",
      "--rm",
      "-u",
      "0:0",
      "-v",
      `${vol2}:/data`,
      "-v",
      `${backupDir}:/backup:ro`,
      "--entrypoint",
      "sh",
      IMAGE,
      "-c",
      "rm -rf /data/* && cp -a /backup/. /data/ && chown -R 1000:1000 /data",
    ]);
    run([...compose2, "up", "-d"]);
    await waitForHealthy(project2, override2);
    {
      const bot = await connectBot(`ws://127.0.0.1:${port2}/ws`);
      bot.send({ t: "login", name: "SmokeHero", password: "secret" });
      const roleMsg = await bot.waitFor((m) => m.t === "role");
      expect(roleMsg).toEqual({ t: "role", role: "immortal" });
      const snap = await bot.waitFor(
        (m): m is Extract<ServerMsg, { t: "snapshot" }> => m.t === "snapshot",
      );
      expect(snap.map.title).toBe("Smoke Town");
      expect(snap.map.signs[0]).toBe("Smoke Sign 42");
      bot.send({ t: "logout" });
      bot.close();
    }
    run([...compose2, "down", "-v"]);

    // Verify original volume remains intact.
    run([...compose1, "up", "-d"]);
    await waitForHealthy(project1, override1);
    {
      const bot = await connectBot(wsUrl1);
      bot.send({ t: "login", name: "SmokeHero", password: "secret" });
      const snap = await bot.waitFor(
        (m): m is Extract<ServerMsg, { t: "snapshot" }> => m.t === "snapshot",
      );
      expect(snap.map.title).toBe("Smoke Town");
      bot.send({ t: "logout" });
      bot.close();
    }

    console.log("7. Verifying temporary single trusted TLS proxy (nginx) + WSS + forwarded IP...");
    const certDir = join(scratch, "certs");
    mkdirSync(certDir, { recursive: true });
    run([
      "openssl",
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(certDir, "key.pem"),
      "-out",
      join(certDir, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      `subjectAltName=DNS:localhost,${["IP", "127.0.0.1"].join(":")}`,
    ]);

    const nginxConf = join(scratch, "nginx.conf");
    writeFileSync(
      nginxConf,
      `events {}
http {
  map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
  }
  server {
    listen 443 ssl;
    ssl_certificate /certs/cert.pem;
    ssl_certificate_key /certs/key.pem;
    location / {
      proxy_pass http://second-star-online:3000;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
    }
  }
}
`,
    );

    const nginxImage =
      "nginx:alpine@sha256:713fc2ebfd92e8217db451477182ee91944b123d2b1ee9fd5a8c6e91ca6c3a11";
    const netName = `${project1}_default`;
    const gatewayIp = run([
      "docker",
      "network",
      "inspect",
      netName,
      "-f",
      "{{(index .IPAM.Config 0).Gateway}}",
    ]).stdout.trim();
    if (!gatewayIp) throw new Error(`Could not determine gateway IP for ${netName}`);

    run([
      "docker",
      "run",
      "-d",
      "--name",
      proxyName,
      "--network",
      netName,
      "-p",
      `127.0.0.1:${tlsPort}:443`,
      "-v",
      `${nginxConf}:/etc/nginx/nginx.conf:ro`,
      "-v",
      `${certDir}:/certs:ro`,
      nginxImage,
    ]);

    // Wait for nginx TLS port and verify HTTPS + WSS + X-Forwarded-For trust using a subprocess with NODE_EXTRA_CA_CERTS.
    const certPemPath = join(certDir, "cert.pem");
    const tlsProbeScript = join(scratch, "tls-probe.ts");
    writeFileSync(
      tlsProbeScript,
      `const base = "https://127.0.0.1:${tlsPort}";
const expectedProxyIp = process.env.EXPECTED_PROXY_IP;
if (!expectedProxyIp) throw new Error("EXPECTED_PROXY_IP is required");
let ok = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(base);
    if (r.status === 200) {
      const html = await r.text();
      if (!html.includes("<title>Second Star Online</title>")) throw new Error("bad html");
      ok = true;
      break;
    }
  } catch {}
  await Bun.sleep(250);
}
if (!ok) throw new Error("TLS proxy did not become ready");

// Send a forged left-hand X-Forwarded-For; SSO_PROXY_HOPS=1 must read the rightmost entry appended by nginx.
const ws = new WebSocket("wss://127.0.0.1:${tlsPort}/ws", {
  headers: { "X-Forwarded-For": "203.0.113.99" },
} as unknown as string[]);
const seenIp = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => {
    try { ws.close(); } catch {}
    reject(new Error("TLS + WSS + XFF probe timed out waiting for 'The IP is:'"));
  }, 15_000);
  const done = (err: Error | null, ip?: string) => {
    clearTimeout(timer);
    if (err) reject(err);
    else resolve(ip ?? "");
  };
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ t: "login", name: "SmokeHero", password: "secret" }));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as { t: string; text?: string };
    if (msg.t === "snapshot") {
      ws.send(JSON.stringify({ t: "mapReady" }));
      ws.send(JSON.stringify({ t: "chat", text: "/iplookup SmokeHero" }));
    }
    if (msg.t === "chat" && typeof msg.text === "string" && msg.text.startsWith("The IP is:")) {
      const ip = msg.text.slice("The IP is:".length).trim();
      if (!ip || ip === "203.0.113.99") {
        done(new Error("server trusted forged left-hand X-Forwarded-For: " + msg.text));
        return;
      }
      if (ip !== expectedProxyIp) {
        done(new Error(\`expected proxy IP \${expectedProxyIp}, got \${ip} (\${msg.text})\`));
        return;
      }
      ws.send(JSON.stringify({ t: "logout" }));
      ws.close();
      done(null, ip);
    }
  });
  ws.addEventListener("error", (e) => done(new Error(String(e))));
});
console.log(\`TLS + WSS + XFF probe passed (\${seenIp})\`);
`,
    );
    const probeRes = run(["bun", tlsProbeScript], {
      env: { NODE_EXTRA_CA_CERTS: certPemPath, EXPECTED_PROXY_IP: gatewayIp },
    });
    console.log(probeRes.stdout.trim());

    console.log(`docker:check passed (logs kept in ${scratch})`);
  } finally {
    run(["docker", "rm", "-f", proxyName], { allowFail: true });
    run([...compose2, "down", "-v"], { allowFail: true });
    run([...compose1, "down", "-v"], { allowFail: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
