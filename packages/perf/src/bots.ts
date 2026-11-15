/**
 * One bot process: `bun src/bots.ts <spec.json>`. Starts its share of the
 * bots staggered over the ramp and appends one aggregate JSON line a second to `out`. The
 * orchestrator (`main.ts`) starts three of these on the cores the server does not use.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { type Bot, type BotWindow, startBot } from "./bot.ts";
import type { BotPlan } from "./scenarios.ts";
import { PASSWORD } from "./stage.ts";

export interface BotsSpec {
  /** Game socket URL by relay profile name ("default" for bots with no profile of their own). */
  urls: Record<string, string>;
  bots: BotPlan[];
  seed: number;
  rampSeconds: number;
  out: string;
  /** Soak: each bot leaves for 30-120 s once every 20-40 min. */
  churn?: boolean;
  /** Where to write every bot's last inventory (on exit and once a minute). */
  inventoryOut?: string;
}

/** One line of a bot process's output: the sum of its bots' windows for one second. */
export interface BotsLine {
  t: number;
  bots: number;
  online: number;
  messagesIn: number;
  bytesIn: number;
  messagesOut: number;
  snapsPredicting: number;
  snapsServer: number;
  snapsTimeout: number;
  walkTicks: number;
  delays: number[];
  closes: Record<string, number>;
  logins: number;
  denied: number;
  deaths: number;
  actions: Record<string, number>;
}

export function sumWindows(t: number, online: number, windows: BotWindow[]): BotsLine {
  const line: BotsLine = {
    t,
    bots: windows.length,
    online,
    messagesIn: 0,
    bytesIn: 0,
    messagesOut: 0,
    snapsPredicting: 0,
    snapsServer: 0,
    snapsTimeout: 0,
    walkTicks: 0,
    delays: [],
    closes: {},
    logins: 0,
    denied: 0,
    deaths: 0,
    actions: {},
  };
  for (const w of windows) {
    line.messagesIn += w.messagesIn;
    line.bytesIn += w.bytesIn;
    line.messagesOut += w.messagesOut;
    line.snapsPredicting += w.snapsPredicting;
    line.snapsServer += w.snapsServer;
    line.snapsTimeout += w.snapsTimeout;
    line.walkTicks += w.walkTicks;
    line.logins += w.logins;
    line.denied += w.denied;
    line.deaths += w.deaths;
    for (const d of w.delays) {
      line.delays.push(Math.round(d));
    }
    for (const [a, n] of Object.entries(w.actions)) {
      line.actions[a] = (line.actions[a] ?? 0) + n;
    }
    for (const [code, n] of Object.entries(w.closes)) {
      line.closes[code] = (line.closes[code] ?? 0) + n;
    }
  }
  return line;
}

if (import.meta.main) {
  const spec = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8")) as BotsSpec;
  const started: { plan: BotPlan; bot: Bot }[] = [];
  const n = spec.bots.length;
  spec.bots.forEach((plan, i) => {
    const delay = n > 1 ? (i / n) * spec.rampSeconds * 1000 : 0;
    setTimeout(() => {
      const url = spec.urls[plan.profile ?? "default"] ?? spec.urls.default ?? "";
      const bot = startBot({
        url,
        name: plan.name,
        password: PASSWORD,
        role: plan.role,
        seed: spec.seed * 1000 + i,
        team: plan.team,
        partner: plan.partner,
        faceDir: plan.faceDir,
        spell: plan.spell,
      });
      started.push({ plan, bot });
      if (spec.churn) {
        const loop = () => {
          setTimeout(
            () => {
              bot.leaveFor(30_000 + Math.random() * 90_000);
              loop();
            },
            (20 + Math.random() * 20) * 60_000,
          );
        };
        loop();
      }
    }, delay);
  });

  const saveInventories = () => {
    if (!spec.inventoryOut) {
      return;
    }
    const inv: Record<string, unknown> = {};
    for (const s of started) {
      inv[s.plan.name] = s.bot.inventory();
    }
    writeFileSync(spec.inventoryOut, JSON.stringify(inv));
  };
  setInterval(saveInventories, 60_000);

  setInterval(() => {
    const windows = started.map((s) => s.bot.takeWindow());
    const online = started.filter((s) => s.bot.model.self && !s.bot.model.loading).length;
    appendFileSync(spec.out, `${JSON.stringify(sumWindows(Date.now(), online, windows))}\n`);
  }, 1000);

  const stop = () => {
    saveInventories();
    for (const s of started) {
      s.bot.stop();
    }
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
