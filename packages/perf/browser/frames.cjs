// Run inside the Playwright MCP image: node frames.cjs <url> <name> <password> <seconds> <throttle>
// Logs in through the title screen's DOM labels, waits for the map, then records
// requestAnimationFrame intervals unthrottled and with the CPU throttled <throttle>x.
const { chromium } = require("playwright");

const [, , url, name, password, secondsArg = "30", throttleArg = "4"] = process.argv;
const seconds = Number(secondsArg);
const throttle = Number(throttleArg);

function stats(intervals) {
  const sorted = [...intervals].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
  const total = intervals.reduce((a, b) => a + b, 0);
  return {
    frames: intervals.length,
    avgFps: Math.round((intervals.length / (total / 1000)) * 10) / 10,
    p50: Math.round(pct(0.5) * 10) / 10,
    p95: Math.round(pct(0.95) * 10) / 10,
    p99: Math.round(pct(0.99) * 10) / 10,
    overFiftyMsPercent:
      Math.round((intervals.filter((x) => x > 50).length / intervals.length) * 1000) / 10,
  };
}

(async () => {
  const browser = await chromium.launch({ channel: "chromium", args: ["--no-sandbox"] });
  const page = await browser.newPage({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url);
  await page.locator('[aria-label="Load Character"]').click();
  await page.locator('[aria-label="Name"]').fill(name);
  await page.locator('[aria-label="Password"]').fill(password);
  await page.locator('[aria-label="OK"]').last().click();
  await page.waitForTimeout(8000); // the map loads and the crowd arrives
  await page.screenshot({ path: "/out/browser-town-40.png" });

  const measure = (ms) =>
    page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const intervals = [];
          let last = performance.now();
          const end = last + ms;
          const frame = (now) => {
            intervals.push(now - last);
            last = now;
            if (now < end) {
              requestAnimationFrame(frame);
            } else {
              resolve(intervals);
            }
          };
          requestAnimationFrame(frame);
        }),
      ms,
    );

  const cdp = await page.context().newCDPSession(page);
  const result = { throttle, seconds };
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  result.unthrottled = stats(await measure(seconds * 1000));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  result.throttled = stats(await measure(seconds * 1000));
  result.pageErrors = errors;
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
