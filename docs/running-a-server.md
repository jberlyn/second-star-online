# Running a server

Second Star Online runs on [Bun](https://bun.sh/). One Bun process serves the client page, the generated assets, and the game WebSocket on `http://localhost:3000` by default.

## Quick start

### Docker (one-command local service)

Requires Docker and Docker Compose. From the repository root:

```sh
docker compose up -d --build
```

This builds the `second-star-online:local` image (non-root `bun` user, UID/GID `1000`), mounts the named `world` volume at `/data` (`SSO_DB=/data/sso.sqlite`), sets `SSO_PROXY_HOPS=1`, and binds `http://127.0.0.1:3000` on loopback for a local HTTP demo. Public servers must terminate TLS in front of this loopback binding (see [Reverse proxies and TLS](#reverse-proxies-and-tls)).

- **Named volume vs. bind mount:** The `world` named volume is initialized with ownership for UID/GID `1000`. If you mount a host directory instead, pre-create it and set ownership on the host (`chown -R 1000:1000 /path/to/world-data`) rather than running the container as root or opening permissions with `chmod 777`.
- **Migrating an existing database:** Mount the entire directory containing `sso.sqlite` (and any `-wal`/`-shm` sidecars) at `/data`. Existing migrations run automatically on startup. Never run two game processes against the same database directory.
- **Health and restarts:** The container uses `restart: unless-stopped`, `stop_grace_period: 30s`, and a dependency-free Bun healthcheck (`GET /`, an emitted JS bundle, and a generated asset every 30 s with a 5 s timeout, 30 s start period, and 3 retries). Docker health status alone does not restart an unhealthy container; verify player readiness over `/ws` after major changes.
- **Mod rebuilds:** Generated data modules, asset atlases, and `dist/client` are baked into the image at build time. After editing content or added assets (`bun run data:build`), rebuild with `docker compose up -d --build`.

### From source (development and host production)

From the repository root:

```sh
bun install
```

For development (builds assets, enables live reload, and serves the unminified client):

```sh
bun run dev
```

For host production serving (builds assets and the minified prebuilt client into `dist/client/`, then starts the server—`bun run start` refuses to start if `dist/client/index.html` is missing):

```sh
bun run build
bun run start
```

On first start against a new SQLite file, the server runs database migrations automatically and starts with a fresh seed world (including the starting map and seed NPC files). An operator builds maps in-game with the World Editor rather than importing an archived world.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP and WebSocket listening port. |
| `SSO_DB` | `sso.sqlite` | SQLite database path relative to the working directory (`/data/sso.sqlite` in the container). `:memory:` runs a throwaway database that is lost on exit. |
| `NODE_ENV` | unset | Only `development` selects development serving. Any other value (or unset) serves the prebuilt `dist/client` bundle with strict security headers. |
| `SSO_CLIENT_DIR` | `dist/client` | Optional override for the prebuilt production client directory (used by tests). |
| `SSO_PROXY_HOPS` | `0` | Number of trusted reverse proxies in front of the server (whole number `>= 0`; invalid values refuse startup). `docker-compose.yml` sets `1`. |
| `SSO_FRAME_ANCESTORS` | unset | Optional CSP `frame-ancestors` directive value. Unset adds no `frame-ancestors` directive. |
| `SSO_PERF_OUT` | unset | Path to append once-a-second JSON performance samples (see [performance.md](performance.md)). |
| `SSO_CRASH_AT` | unset | Test hook that kills the process at a named crash point; not an operator setting. |

### Reverse proxies and TLS

Keep `SSO_PROXY_HOPS=0` when the server is exposed directly; the gateway uses the socket's IP address. When running behind reverse proxies, set `SSO_PROXY_HOPS` to the number of proxies in front of Bun (default `1` in `docker-compose.yml`): the gateway reads the `SSO_PROXY_HOPS`-th entry from the right of `X-Forwarded-For` (falling back to the socket address if fewer entries are present), so earlier client-supplied entries cannot spoof the address. `docker-compose.yml` publishes port `3000` on `127.0.0.1` (loopback) so clients cannot connect directly; when running the server from source instead of Compose, Bun listens on `0.0.0.0` (all interfaces) on `PORT`, so firewall `PORT` externally when placing it behind a reverse proxy.

Terminate TLS at your reverse proxy, serve the same host, and forward WebSocket upgrades on `/ws`. Public automatic HTTPS requires a public DNS record pointing at your host and reachable ports `80` and `443`. The client automatically selects `wss://` when loaded over `https://` and `ws://` otherwise. The server accepts WebSocket connections from any `Origin`; if your deployment requires an origin policy, enforce it at the reverse proxy. Authentication is carried in WebSocket frames rather than cookies.

**Host Caddy example** (`/etc/caddy/Caddyfile`, forwards WebSockets and `X-Forwarded-For` automatically):

```caddyfile
game.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**Host nginx example** (includes WebSocket `Upgrade`/`Connection` headers and `$proxy_add_x_forwarded_for` so `SSO_PROXY_HOPS=1` reads the client's real address):

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 443 ssl;
    server_name game.example.com;
    # ssl_certificate / ssl_certificate_key ...

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

**Existing containerised reverse proxy:** Attach both your proxy container and `game` to a shared private Docker network and proxy to `http://game:3000` (never `127.0.0.1:3000`, which refers to the proxy container itself). Omit or keep `ports:` bound to `127.0.0.1` so Bun is never exposed on a public host interface.

## Accounts, roles, and auditing

Roles live on the `accounts` table, not on character names:

- **`player`**: standard gameplay.
- **`moderator`**: can run `/location`, `/iplookup`, `/kick`, `/warp`, `/jail`, `/warptome`, and `/warpmeto`, and can read admin chat (`-text`). Cannot target immortals with `/kick`, `/iplookup`, `/jail`, `/warp`, or `/warptome`.
- **`immortal`**: full command access, admin chat posting (`-text`), World Editor, NPC Editor, Settings, Newspaper editor, and Assassin's Game controls.

### Bootstrapping an immortal

1. Start the server and create an account and character on the title screen.
2. Grant the **account name** (not the character display name) the `immortal` role against the same database file:

   ```sh
   # Docker Compose:
   docker compose exec -T game bun run admin:role <account-name> immortal

   # From source:
   SSO_DB=sso.sqlite bun run admin:role <account-name> immortal
   ```

3. Log out and log in again in the browser. CLI role changes take effect at the account's next login, whereas the in-game `/role` command updates an online target immediately.

### Reading the audit log

Actions that change state or reveal privileged information (effective admin commands, World Editor and NPC Editor saves, setting changes, and role changes) are recorded in `audit_log`; `/location`, `/inventory`, `/cheatfile`, Newspaper editor saves, and refused or no-target command attempts are not logged. There is no in-game viewer; inspect the newest entries (default `50`):

```sh
# Docker Compose:
docker compose exec -T game bun run admin:audit 50

# From source:
SSO_DB=sso.sqlite bun run admin:audit 50
```

## In-game commands

Chat commands are parsed on the server. Most single-target commands read word 2 (space-delimited) as the target name, so character names containing spaces cannot be targeted by those commands; `/drop`, `/roster`, `/setclass`, and `/warp` parse further arguments as noted below.

See [Admin guide](guides/admin.md) and [Chat guide](guides/chat.md) for parser details, house/muffle quirks, and admin chat (`-text`, which immortals post and moderators read).

| Command | Min role | Target / arguments | Observable result |
|---|---|---|---|
| `/location` | `moderator` | None | Prints `You are at map: <map> at position: <x>-<y>`. |
| `/iplookup <name>` | `moderator` | Online player (word 2) | Prints the target's IP address (refuses if a moderator targets an immortal). |
| `/kick <name>` | `moderator` | Online player (word 2) | Sends kick notice and disconnects the target (refuses if a moderator targets an immortal). |
| `/warp <name> <map> <x> <y>` | `moderator` | Online player, `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Warps target to `<map>` at `(x, y)` (single-space split, cut at `*`; missing map falls back to `startPoint`). |
| `/jail <name>` | `moderator` | Online player (word 2) | Warps target to jail (`x0y0` at `4, 4`); requires map `x0y0` to exist. |
| `/warptome <name>` | `moderator` | Online player (word 2) | Warps target to your current map and tile (refuses if a moderator targets an immortal). |
| `/warpmeto <name>` | `moderator` | Online player (word 2) | Warps you to the target's current map and tile. |
| `/save` | `immortal` | None | Saves all online characters and dirty maps immediately. |
| `/refresh` | `immortal` | None | Reloads settings overrides from the database and applies them to everyone online. |
| `/cheatfile` | `immortal` | None | Prints `* Cheater Log:` followed by up to 300 entries from `cheat_log`. |
| `/inventory` | `immortal` | None | Prints your 15 bag lines as held by the server (`Name-qty`). |
| `/banip <ip>` | `immortal` | IP address (word 2) | Adds `<ip>` to `ip_bans` and refuses future logins from that address. |
| `/unbanip <ip>` | `immortal` | IP address (word 2) | Removes `<ip>` from `ip_bans`. |
| `/ban <name>` | `immortal` | Character name (word 2) | Bans the target's account (cannot ban yourself) and kicks if online. |
| `/unban <name>` | `immortal` | Character name (word 2) | Clears the ban on the target's account. (Said as local chat by non-immortals.) |
| `/pardon <name>` | `immortal` | Online player (word 2) | Clears the target's murder/wanted flag and saves the character. |
| `/warpscript <word\|OFF>` | `immortal` | Keyword (word 2) or `OFF` | Auto-warps any player whose broadcast contains `<word>` to you (`OFF` disables). |
| `/role <name> <role>` | `immortal` | Character name, `player` / `moderator` / `immortal` | Updates the account's role (cannot change your own) and applies immediately if online. (Local chat for non-immortals.) |
| `/setclass <name> <class>` | `immortal` | Character name, class name or number `1`–`26` | Changes the character's class in the database. (Local chat for non-immortals.) |
| `/drop <item>` | `immortal` | `<n> gold`, item name, or `<n> <item>` (1–9999) | Places the pile on the tile you face; admin drops never decay. |
| `/roster [slot species\|clear]` | `immortal` | None, or slot `1`–`4` + species name or `clear` | Lists the current map's 4 monster/NPC slots, or sets/clears a slot (saving the map). (Local chat for non-immortals.) |
| `/spawn <1-4>` | `immortal` | Slot `1`–`4` | Immediately spawns the rostered creature in that slot on the tile you face. (Local chat for non-immortals.) |

## Server settings

Immortals open **Admin → Settings** from the top menu bar. Clicking **SAVE** validates every field on the client and server, writes changed values as JSON overrides in the `settings` table, records each change in `audit_log`, and applies the new settings to everyone online immediately (without requiring `/refresh`). **REVERT** reloads the server's current values.

Time-based settings count in **frames** (`1/20` second; `20` frames = `1` second), milliseconds (`ms`), or minutes. For rate limits, `0` disables the limit; rate-limit counters live in memory and reset on server restart, grouping IPv6 addresses by `/64` prefix.

### World

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `startPoint` | Start point | `x1000y992 6 4` | Map `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Where new characters appear, and fallback when walking off an unlinked edge or missing map. |
| `respawnPoint` | Respawn point | `x1000y992 5 5` | Map `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Where characters reappear after dying unless overridden by a map respawn flag. |
| `portalTargets` | Portal targets | `[]` | Up to 30 points (`map x y`) | Random destinations for the Portal spell; empty falls back to `startPoint`. |
| `hazardMap` | Server Spirit map | `null` | Map `x<mx>y<my>` or empty | Map where the Server Spirit throws fireballs and lightning bolts every 0.35 s. |
| `treasureMaps` | Treasure maps | `[]` | Up to 100 map names (`x<mx>y<my>`) | Maps where buried treasure can spawn for a Shovel; empty disables buried treasure. |
| `houseDecayTimeZone` | House decay time zone | `UTC` | Valid IANA time zone | Calendar time zone used for monthly house-decay checks. |

### Chat

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `chatMaxChars` | Longest chat line | `200` | `1`–`500` chars | Maximum typed chat line length; longer lines are truncated. |
| `broadcastCooldownFrames` | Broadcast wait | `1000` (50 s) | `0`–`72000` frames (up to 1 h) | Minimum wait between `'` broadcasts (`0` disables). |
| `chatCooldownFrames` | Chat wait | `60` (3 s) | `0`–`72000` frames (up to 1 h) | Minimum wait between local chat lines and emotes (`0` disables). |
| `mailBodyMax` | Longest mail | `2000` | `1`–`4000` chars | Maximum mail body length; longer bodies are truncated. |
| `mailboxMax` | Messages per mailbox | `50` | `1`–`1000` | Maximum messages kept per mailbox; newer mail drops the oldest. |
| `boardPostsMax` | Posts per board | `200` | `1`–`1000` | Maximum posts kept per message board; newer posts evict the oldest (there is no board moderation tool). |
| `boardPostMax` | Longest board post | `300` | `1`–`4000` chars | Maximum message board post length; longer posts are truncated. |
| `artBytesMax` | Largest painting or photo | `16384` | `1024`–`65536` bytes | Maximum byte size for a saved 64×64 PNG painting or photo. |
| `announcePresence` | Announce logons | `true` | `true` / `false` | Broadcasts logon/logoff updates to clients (used by Friends list). |
| `presenceChatLines` | Logon lines in chat | `false` | `true` / `false` | Also prints `<name> has logged on/off.` in everyone's chat when `announcePresence` is on. |
| `news` | Login news | `Welcome to First Star Online!` | Up to `1000` chars | Printed on login once per browser whenever the text changes; empty disables. |

### Items

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `lootDecayMinutes` | Loot lasts | `30` | `1`–`10080` minutes | Minutes before monster loot disappears from the ground (player drops and `/drop` items never decay). |
| `dropOnDeath` | Drop an item on death | `true` | `true` / `false` | Whether dying characters may drop one item from their first 8 bag slots (immortals always drop). |
| `assassinPrizes` | Assassin prizes | `Long Sword`, `1000 Gold`, `500 Gold`, `Knife` | 4 lines, each <= 60 chars (item, `<n> Gold`, or empty) | 1st–3rd place prizes when an Assassin's Game ends (4th line is preserved but never awarded). |

### Server

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `saveIntervalTicks` | Save every | `600` (30 s) | `20`–`72000` frames (1 s–1 h) | Periodic save interval for online characters, besides saves on logout and map change. |
| `resumeGraceMs` | Reconnect grace | `30000` (30 s) | `0`–`300000` ms (up to 5 min) | How long a dropped connection can resume with its token without logging in again. |

### Moderation and security

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `jailFrames` | Jail sentence | `8000` (6 min 40 s) | `1`–`1728000` frames (up to 24 h) | Time a jailed player stays on `x0y0` before warping to `startPoint` (resets on re-entry/login). |
| `loginFailsPerIp` | Failed logins per address | `20` | `0`–`1000` | Failed logins per address (IPv6 `/64`) in 5 minutes before refusal (`0` disables; moderators and immortals are not refused). |
| `loginFailsPerAccount` | Failed logins per account | `5` | `0`–`1000` | Wrong passwords per address+account pair in 5 minutes before refusal (`0` disables; no role exemption). |
| `createsPerIp` | New characters per address | `3` | `0`–`1000` | Character creations per address (IPv6 `/64`) per hour (`0` disables; no role exemption). |
| `socketsPerIp` | Open connections per address | `10` | `0`–`1000` | Concurrent open connections per address (IPv6 `/64`, `0` disables; moderator/immortal connections stop counting after login). |

## World Editor and NPC Editor

Both editors are accessed from **Admin → World Editor** or **Admin → NPC Editor** and remove your character from the map until you choose **Admin → Return To Game**.

### World Editor

- **Coordinates and loading:** Enter `X` and `Y` or click the edge map arrows, then click **LOAD** to open a map (or a blank template if none exists yet).
- **Layers and brushes:** Choose layers `1` (floor), `2` (transparent objects), `3` (over characters), or `S` (shadow), and paint with **Pencil** (1 tile), **Bucket** (fill layer), or **Fat brush** (plus shape).
- **Palette:** Pages `1`–`10` hold original tiles; added tiles fill page `10` slots `50`–`60` first, then pages `11+` (see [Modding](modding.md#tiles-tilesjson)).
- **Airship landing pads:** Paint `J2` on **layer 1** in rows **`y` 1–9** (rows 10–12 are not checked by the Airship deed/parking logic) and leave the faced tile free of blocking items. See [Vehicles guide](guides/vehicles.md).
- **Exits, flags, signs, items, and mobs:** Configure up to two exits (`MX`, `MY`, `LX`, `LY`, or `H1<mx>`/`H2<mx>` for house interiors), toggles (`SAFE AREA`, `NO PVP`, `INDOOR`, `FACTION W/M/A`), three sign texts, up to `20` placed items (`Delete` removes a placed item), and up to `4` monster/NPC slots.
- **Validation and saving:** **SAVE** validates all 4 layers (12 rows × 17 palette tokens), flags, header/sign lengths, exit coordinates, fog settings, placed monster/NPC names, and item names; valid saves persist the map, roster, and admin items to SQLite and refresh players on that map.

### NPC Editor

- **Selection:** Pick a species from the **Monsters** or **NPCs** list and click **LOAD** to view its script (with live shop stock and gold merged in).
- **Line tags:** Supported tags are `BIO|`, `PRO|`, `SEL|`, `BUY|`, `GLD|`, `INV|`, `OWN|`, `FLG|`, `TRN|`, `RND|`, `SPL|`, and `BNK|` (see [Monsters guide](guides/monsters.md)).
- **Save and overrides:** **SAVE** validates every line, writes the script to the `npc_files` database table (which overrides the seed data in `packages/data/content/npc-files.json`), resets that NPC's live shop stock/gold ledger to the saved numbers, and closes any open shop or bio windows for that NPC.

## Stopping, backing up, and restoring

### Graceful stop

Send one `SIGINT` (Ctrl+C) or `SIGTERM` to the server process. The server stops the tick loop, saves all online characters and dirty maps, closes the WebSocket gateway, and closes the SQLite database cleanly. Wait for it to exit; a second signal forces an immediate exit without waiting.

### Offline backup (recommended)

1. Stop the server cleanly (and ensure no CLI such as `admin:role` or `admin:audit` is running against the database).
2. Copy the configured database file to a separate backup path, for example:

   ```sh
   cp sso.sqlite /path/to/scratch/sso-backup.sqlite
   ```

3. Restart the server.

### Live backup (optional `sqlite3` CLI)

Because SSO opens SQLite in WAL mode, **never copy only the live `sso.sqlite` file while the server is running**—doing so can omit committed pages still in `-wal` and produce a corrupt copy.

If the external `sqlite3` CLI is installed, you can take an online backup of committed database state (this does not include unsaved in-memory play):

```sh
sqlite3 sso.sqlite ".backup '/path/to/scratch/sso-backup.sqlite'"
```

See the official SQLite [Online Backup](https://sqlite.org/backup.html) and [CLI `.backup`](https://sqlite.org/cli.html#backup) documentation for details.

### Restoring from a backup

1. Stop the server and any other database users cleanly.
2. Preserve the old database and its `-wal` and `-shm` sidecars together in another location if you want to keep them.
3. Copy the backup into a clean destination path with no stale `-wal` or `-shm` files.
4. Point `SSO_DB` at that restored file, start the server, and verify logins and world state.

### Docker volume backup, restore, and upgrade

> **Warning:** `docker compose down -v` **deletes the named `world` volume and all world data**. Use `docker compose stop`, `docker compose down` (without `-v`), or `docker compose up -d --build` for normal stops and upgrades.

1. Stop the game container cleanly (waits up to `stop_grace_period: 30s` for `SIGTERM` save and exit):

   ```sh
   docker compose stop game
   ```

2. Back up the entire `/data` directory from the stopped volume (replace `<project>_world` with your Compose project's volume name from `docker volume ls`):

   ```sh
   mkdir -p ./world-backup
   docker run --rm -u 0:0 -v <project>_world:/data:ro -v "$PWD/world-backup:/backup" --entrypoint sh second-star-online:local -c 'cp -a /data/. /backup/'
   ```

3. To upgrade, rebuild and recreate the container (`docker compose up -d --build`); migrations run automatically on startup.
4. To restore into a clean volume, stop `game`, clear `/data`, copy the backup in, restore `1000:1000` ownership, and start `game`:

   ```sh
   docker run --rm -u 0:0 -v <project>_world:/data -v "$PWD/world-backup:/backup:ro" --entrypoint sh second-star-online:local -c 'rm -rf /data/* && cp -a /backup/. /data/ && chown -R 1000:1000 /data'
   docker compose up -d game
   ```
