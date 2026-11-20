# Performance

What SSO costs to run, measured with `bun run perf` on 2026-11-10. For an operator deciding what machine to rent, and for a developer who wants to know whether a change made things worse.

## The short answer

**One core of a 2014 desktop CPU runs 200 online players over 20 maps, 40 of them on one map, inside the 25 ms target (half the 50 ms tick) with no dropped tick, at 0, 100, 150 and 250 ms of network delay.** The server uses about 30 % of that core on average; what limits it is the worst ticks, not the average. Nothing above 200 online was measured, so 200 per core is what has been shown, not a ceiling.

- **Players per core: 200** (tick p99 20.9-24.5 ms at `world200`; p99 is 13.9 ms at 100 players, so most of the headroom is below 150).
- **Memory:** about 160 MB resident at 200 online (245 MB right after a 200-player login burst).
- **Network out:** about 1.2 MB/s in total at 200 online (6 KB/s per player on average). Traffic on one map grows with the square of the crowd (an earlier measurement: 20 walkers 84 KB/s, 40 walkers 331 KB/s, 80 walkers 1.2 MB/s in total).
- **Database writes:** about 55 rows a second at 200 online (saves every 30 s per player and on every change).

## The host and how the numbers were taken

Intel i5-4690 (4 cores, 3.5 GHz, no SMT), 31 GB, Linux, Bun 1.4.0. The server ran pinned to **core 0** (`taskset`), the three bot processes and the delay relay on cores 1-3, so the bots' CPU never counts against the server. A machine with one or two cores of similar speed should therefore read the same. The bots are real clients: the real client model, a 50 ms tick, `move`/`step` sent as the browser sends them, think-time between actions, a seeded role mix (walkers, fighters, casters, gatherers, traders; PvP fighters in `pvp`). A TCP relay between bots and server adds a fixed delay each way plus jitter: `lan` 0 ms, `home` 100 ms round trip ±30, `p150` 150 ms ±40, `mobile` 250 ms ±80 with a 1-3 s stall about every two minutes.

**What the bots do not do:** buy, sell, craft (needs authored stations), use houses, vehicles or the casino, or play PvP outside the `pvp` scenario (PvP is off on every other map, because one Fireball that kills a player is announced to everyone online, and a crowd of bots doing that measures the kill message, not the server). Gatherers swing at a tree and pick up what falls. Monsters: four Slime slots on the maps of `hunt`, `world100`, `world200` and `burst`; none elsewhere.

## Results (3 minutes measured after the ramp)

Each run logs in its bots over a ramp (60 s for `town`, `world100` and `world200`; 30 s for `hunt`, `pvp` and `craft`; 5 s for `burst`), then measures for 3 minutes. Tick time is the whole `game.tick()`: the sim, encoding and sending every message, the SQL writes and the commit.

| scenario | players | profile | tick p50 / p99 / worst ms | dropped | snaps per minute of walking while predicting |
|---|---|---|---|---|---|
| town (40 on one map) | 40 | lan / home / mobile / 150 ms | 2.3 / 5.9-6.4 / 10-19 | 0 | 0.2 / 0.5 / 0.7 / 0.3 |
| hunt (10 fighters, 10 casters) | 20 | lan / home / mobile | 1.4 / 4.4-4.6 / 8-11 | 0 | 1.1 / 2.0 / 3.4 |
| pvp (10 v 10) | 20 | lan / home / mobile | 0.8-1.3 / 16-20 / 26-32 | 0 | 6.1 / 8.6 / 36.7 |
| craft (30 on trees) | 30 | lan / home / mobile | 2.0 / 4.0-4.6 / 11-15 | 0 | no walking |
| world100 | 100 | lan / home / mobile | 6.2-6.5 / 13.5-13.9 / 20-28 | 0 | 0.5 / 0.7 / 1.2 |
| world200 | 200 | lan | 12.7 / 24.5 / 49 | 0 | 0.3 |
| world200 | 200 | home | 12.0 / 23.6 / 35 | 0 | 0.7 |
| world200 | 200 | 150 ms | 10.5 / 21.7 / 102 | 0 | 0.8 |
| world200 | 200 | mobile | 10.5 / 20.9 / 95 | 0 | 1.6 |
| burst (200 logins in 5 s) | 193 | home | 11.0 / 22.1 / 28.5 | 0 | 0.9 |

- **The targets** are all met: tick p99 under 25 ms and no dropped ticks at 200 online; fewer than one snap-back a minute of walking at 150 ms (0.8 at `world200`, 0.3 at `town`); 30 frames a second on a throttled browser (60 measured, below).
- **`world200` at `lan` sits at 24.5 ms p99, 0.5 ms under the target.** A busier mix, or a slower core, would miss it. The cost is spread: per tick at `world200`, `rooms` (the maps' passes and their delta messages) about 4 ms, `deliver` (encoding and sending) 3-4 ms, the rest under 1 ms, with rare ticks several times that. These are medians; the p99 is set by ticks that coincide with many players acting at once.
- **A snap-back while predicting** is your own walk being undone by the server (another player or a monster took the tile first). Pushes and warps ("server moved me") are reported but not targeted, because pushing is a 1.6 rule. 10 v 10 PvP snaps far more (8.6 a minute at 100 ms, 37 on `mobile`): twenty fighters pushing each other in a small space. That is the game, not lag, but a player in a brawl on a bad connection will feel it.
- **Worst ticks.** `world200` shows a worst tick of 95-102 ms at 150 ms and `mobile` with no dropped tick (the loop catches up inside its 0.5 s window). Those spikes are rare (the p99 is 21 ms) and were not chased: no target was missed.
- **The browser.** 40 other players on screen, Chromium in the pinned Playwright image, CPU throttled 4×: 60 frames a second, 0 % of frames over 50 ms, identical to unthrottled. The playfield is cheap (the static map is drawn once). This does not cover a real phone, Safari, or a GPU-less device slower than a throttled desktop.

## What an operator sees

- **A log line when the server falls behind.** At most once a minute, only when the last minute dropped a tick or had a tick over 25 ms: `tick lag in the last minute: p99 4.1 ms, worst 31.2 ms, 3 ticks dropped, 87 online`. Silence means the server kept up. There is no admin command and no setting.
- **A player on a bad connection is reconnected.** When more than about 1 MB of updates waits to be sent to one connection, the server closes it (code 4007, "fell behind") and the client resumes with a fresh view of the map. Bun keeps the unsent bytes in the server, but the operating system's socket buffers (megabytes on Linux) fill first, so on a fast host a stalled phone takes minutes to reach the limit. See [differences from 1.6](differences-from-fso.md#a-connection-that-falls-far-behind-is-reconnected).
- **`SSO_PERF_OUT=<file>`** makes the server append one JSON line a second: tick times (raw, total and by phase), traffic, backlog, memory, database and WAL size and rows written. The perf rig sets it; set it by hand to watch a live server. Without it nothing is timed or written.

## Running it

`bun run perf <scenario> [--profile lan|home|p150|mobile] [--seconds s] [--ramp s] [--seed n] [--docker | --image <ref>]` runs one scenario (at the `home` profile unless `--profile` says otherwise; with no scenario it runs `town`); `bun run perf all` runs the whole matrix (about 90 minutes); `bun run perf soak [--hours h]` runs the soak; `bun run perf browser` runs the frame-time check (needs Docker). Scenarios: `town`, `hunt`, `pvp`, `craft`, `world100`, `world200`, `burst`, `behind`. `behind` gives one of its bots the `slow` profile (the `home` delay with downloads capped at 4 KB/s); `--profile slow` also works for a whole run. Output goes to `perf-results/<time>/` (git-ignored): `report.md`, `report.json` and the raw lines. `PERF_SERVER_CORE` and `PERF_BOT_CORES` move the pinning; `PERF_GC_LOG=1` logs the JavaScript collector.

Passing `--docker` (or `--image <ref>`, default `second-star-online:local`) runs the game server inside the container image instead of as a host process: it stages a fresh scratch database only under `perf-results/`, sets ownership for the non-root `bun` user (`1000:1000`) via a disposable helper container, pins the container with `--cpuset-cpus` from `PERF_SERVER_CORE`, keeps bots and the delay relay on host `PERF_BOT_CORES`, and stops (`SIGTERM`) and removes the scratch container on exit. `soak` and `browser` refuse `--docker` and `--image`.

## Container check (2026-11-14)

Short environment check (`town @ home`, 15 s ramp, 30 s measured) comparing host execution against `second-star-online:local` (`0ffe809dce62`) on Intel i5-4690 (4 cores, 3.5 GHz), Bun 1.4.0, Docker 29.9.3, server pinned to core 0 (`taskset` / `--cpuset-cpus 0`), bots and relay on cores 1–3. This is a container parity check, not new 200-player capacity evidence; the historical results above remain the capacity baseline.

| mode | scenario | profile | online | tick p50 / p99 / worst ms | dropped | cpu % | rss MB | snaps/min walking (pred / server / timeout) | answer p50 / p99 ms |
|---|---|---|---|---|---|---|---|---|---|
| Host | town | home | 40 | 2.4 / 7.1 / 18.8 | 0 | 9.4 | 86.6 | 0.1 / 12 / 1.1 | 122 / 351 |
| Image (`0ffe809dce62`) | town | home | 40 | 2.8 / 8.7 / 13 | 0 | 10.4 | 95.5 | 0.1 / 15.4 / 1.2 | 122 / 377 |

Wall-clock numbers are never in the test gate (they would flake). The gate pins what does not depend on the machine: `packages/server/e2e/traffic.test.ts` runs a seeded 20-player crowd for 200 ticks in process and fails when messages, bytes or rows written go over 120 % of the recorded 4,830 messages, 1.136 MB and 163 rows (re-recorded 2026-11-18, when each chat line became a chat-log row). A change that lowers them passes; lower the pin in the same change.

## The soak

Three hours (2026-11-10 23:31 to 02:30), 200 bots on `world200` at the `home` profile, on the file database. Each bot left for 30-120 s about once every 20-40 minutes, so sessions and resume tokens churned. Sampled every second (server) and every minute (table row counts).

- **Memory and tick time stay flat.** After the first 30 minutes, resident memory changed by -0.9 % an hour and tick p99 by -2.8 % an hour (limit: under 10 %). Steady-state tick p50 / p99 / worst: 7.8 / 22.5 / 54 ms, no dropped tick.
- **The database stays bounded.** The WAL file never passed 4 MB (checkpoints happen). Only one table grew over the run, `container_items` (2 to 3 rows): chest contents keyed by chest name, so it is bounded by the number of chests, not a log. Ground items rise and fall with loot decay (30 minutes).
- **Crash recovery.** The server was killed with SIGKILL while all 200 bots were playing, then restarted on the same file: `PRAGMA integrity_check` ok, 200 of 200 characters present, every bot's last-seen inventory equal to what SQL held (0 differ; a change made in the last 30 s before the kill could differ, none did), and 200 of 200 bots logged in again. Item conservation (`packages/server/e2e/conservation.ts`) is not checked here: it only holds in a scene with no monsters, loot or gathering, which this is not (`packages/server/e2e/crash-and-stop.test.ts` covers it).

## Caveats

- One host, one run per cell. Differences of a millisecond or two between profiles are noise; the target cells are close enough to 25 ms that a rerun can flip `world200` at `lan`.
- The `behind` scenario (one player on a 4 KB/s link) cannot reach the 1 MB limit within a run on loopback, for the reason above; the close and the resume are pinned by `fell-behind.test.ts`, which makes one socket look behind.
- The bots keep the town busy: players wander across the grid's edges, so the town ends up with 90-100 players, more than the 40 planned. That makes `world200` a harder test than 40-in-town.

Load scenarios replace the ground and object layers (`layer1`, `layer2`) of the seed map with a fixed grass-and-trees arena, so scenario placements and historical measurements stay comparable when the seed map's landscape changes. The seed map's other layers, settings and monster roster are still copied as they are (the `Slime` fill only takes empty slots), so a change to those can still move the numbers.
