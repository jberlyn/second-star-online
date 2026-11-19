# Running a server

The recommended way to host Second Star Online is with the [public container image](https://github.com/jberlyn/second-star-online/pkgs/container/second-star-online): `ghcr.io/jberlyn/second-star-online`. It includes the server, browser client, and game assets. You need Docker and Docker Compose, with no repository checkout, Bun installation, or local build required. Published images target **Linux AMD64**.

One Bun process inside the container serves the client page, generated assets, and game WebSocket on port `3000`.

## Quick start

### Docker Compose (recommended)

Create a directory for your server and save the following as `docker-compose.yml` inside it:

```yaml
services:
  second-star-online:
    image: ghcr.io/jberlyn/second-star-online:latest
    platform: linux/amd64
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      SSO_PROXY_HOPS: "0"
    volumes:
      - sso-data:/data
    restart: unless-stopped
    stop_grace_period: 30s

volumes:
  sso-data:
```

From that directory, download the image and start the server:

```sh
docker compose pull second-star-online
docker compose up -d second-star-online
```

Open [http://localhost:3000](http://localhost:3000) on the Docker host and create an account. The image runs as the non-root `bun` user (UID/GID `1000`) and stores the database in the named `sso-data` volume at `/data` (`SSO_DB=/data/sso.sqlite`). This example binds the service to loopback for local access; for public hosting, add a TLS reverse proxy and set `SSO_PROXY_HOPS` to the number of proxies in front of the game (see [Reverse proxies and TLS](#reverse-proxies-and-tls)).

If you used the README's `docker run` quick start, it uses a volume named `sso-data`. To keep that world when switching to Compose, replace the final `sso-data:` declaration above with `sso-data: { external: true, name: sso-data }` and stop the old container before starting Compose.

### Choosing an image version

- `latest` follows the newest stable release. Pulling it downloads an update; an already running container keeps its current image until you recreate it.
- For controlled upgrades, replace `latest` with a published version, such as `ghcr.io/jberlyn/second-star-online:1.0.0`, or pin a digest with `ghcr.io/jberlyn/second-star-online@sha256:<digest>`.
- Release image tags omit the Git tag's leading `v`. Prereleases use their full version (for example, `1.1.0-rc.1`) and do not move `latest`. Builds of `main` are checked in CI but are not published.

Find available tags and digests on the [container package page](https://github.com/jberlyn/second-star-online/pkgs/container/second-star-online). Back up your world before upgrading; see [Docker volume backup, restore, and upgrade](#docker-volume-backup-restore-and-upgrade).

### Container operations

- **Named volumes:** Compose normally prefixes the volume name with the project directory, such as `myserver_sso-data`. Use `docker volume ls` to find the actual name. Docker initializes it with ownership for UID/GID `1000`.
- **Existing installations:** Renaming a Compose volume key does not migrate data. If your server already uses a volume such as `<project>_world`, preserve it with `sso-data: { external: true, name: <existing-volume-name> }` in the top-level `volumes` section. Stop the old server before reusing its volume.
- **Migrating an existing database:** Mount the entire directory containing `sso.sqlite` (and any `-wal`/`-shm` sidecars) at `/data`. Existing migrations run automatically on startup. Never run two game processes against the same database directory.
- **Health and restarts:** The container uses `restart: unless-stopped`, `stop_grace_period: 30s`, and a dependency-free Bun healthcheck (`GET /`, an emitted JS bundle, and a generated asset every 30 s with a 5 s timeout, 30 s start period, and 3 retries). Docker health status alone does not restart an unhealthy container; verify player readiness over `/ws` after major changes.
- **Customization:** In-game map, NPC, and settings edits persist in the database. Changes to content JSON, generated modules, art, or the client require a custom image; see [Modding](modding.md).

### Bind mounts (alternative to named volumes)

Use a bind mount if you prefer to keep the database in a visible host directory. On a Linux Docker host, create the directory next to `docker-compose.yml` and give the image’s non-root user write access:

```sh
mkdir -p ./sso-data
sudo chown 1000:1000 ./sso-data
```

Replace the `second-star-online` service’s volume mapping with the following, and remove the top-level `volumes` section:

```yaml
    volumes:
      - type: bind
        source: ./sso-data
        target: /data
        bind:
          create_host_path: false
```

Then run `docker compose pull second-star-online` and `docker compose up -d second-star-online` as above. For `docker run`, replace `-v sso-data:/data` with `--mount type=bind,src="$PWD/sso-data",dst=/data`. Use the directory prepared above; do not run the game as root or use `chmod 777` to bypass ownership requirements. Hosts enforcing SELinux may also require an appropriate container file label on the directory.

Changing the mount does not copy an existing world. Stop the server and copy the entire old data directory, including SQLite sidecars, into the new directory before starting it. For backups, stop the server and copy the entire `sso-data` directory; restore into an empty directory and preserve UID/GID `1000` ownership. The Docker volume backup commands below apply to named volumes.

### From source (development and host production)

For development or a custom build, clone the repository and install [Bun](https://bun.sh/). From the repository root:

```sh
bun install --frozen-lockfile
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

On first start against a new SQLite file, the server runs database migrations automatically and starts with Willowbrook Wilds: a forest-and-lake starting map with rocks for mining, trees for woodcutting, and water for fishing, plus the seed NPC files, the enclosed Jail at x0y0, and the Church of the Bells at x999y999. Spawn and respawn tiles remain clear. Existing databases keep their saved maps when upgraded; the Jail and Church of the Bells are added only where those coordinates are empty. An operator builds maps in-game with the World Editor rather than importing an archived world.

### Building a custom Docker image

The repository’s `docker-compose.yml` builds `second-star-online:local` from source. Use it when changing game content, assets, or code:

```sh
docker compose up -d --build
```

That source-build configuration sets `SSO_PROXY_HOPS=1` for a host reverse proxy. Set it to `0` for direct local access. Keep your deployment configuration and volume selection consistent when switching between custom and public images.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP and WebSocket listening port. |
| `SSO_DB` | `sso.sqlite` | SQLite database path relative to the working directory (`/data/sso.sqlite` in the container). `:memory:` runs a throwaway database that is lost on exit. |
| `NODE_ENV` | unset | Only `development` selects development serving. Any other value (or unset) serves the prebuilt `dist/client` bundle with strict security headers. |
| `SSO_CLIENT_DIR` | `dist/client` | Optional override for the prebuilt production client directory (used by tests). |
| `SSO_PROXY_HOPS` | `0` | Number of trusted reverse proxies in front of the server (whole number `>= 0`; invalid values refuse startup). The recommended Compose example sets `0`; use `1` behind a single reverse proxy. |
| `SSO_FRAME_ANCESTORS` | unset | Optional CSP `frame-ancestors` directive value. Unset adds no `frame-ancestors` directive. |
| `SSO_PERF_OUT` | unset | Path to append once-a-second JSON performance samples (see [performance.md](performance.md)). |
| `SSO_CRASH_AT` | unset | Test hook that kills the process at a named crash point; not an operator setting. |

### Reverse proxies and TLS

Keep `SSO_PROXY_HOPS=0` when the server is exposed directly; the gateway uses the socket's IP address. When running behind reverse proxies, set `SSO_PROXY_HOPS` to the number of proxies in front of Bun (`1` for a single host proxy): the gateway reads the `SSO_PROXY_HOPS`-th entry from the right of `X-Forwarded-For` (falling back to the socket address if fewer entries are present), so earlier client-supplied entries cannot spoof the address. The Compose examples publish port `3000` on `127.0.0.1` (loopback) so clients cannot connect directly; when running the server from source instead of Compose, Bun listens on `0.0.0.0` (all interfaces) on `PORT`, so firewall `PORT` externally when placing it behind a reverse proxy.

Terminate TLS at your reverse proxy, serve the same host, and forward WebSocket upgrades on `/ws`. Public automatic HTTPS requires a public DNS record pointing at your host and reachable ports `80` and `443`. The client automatically selects `wss://` when loaded over `https://` and `ws://` otherwise. The server accepts WebSocket connections from any `Origin`; if your deployment requires an origin policy, enforce it at the reverse proxy. Authentication is carried in WebSocket frames rather than cookies.

For either host proxy example below, set `SSO_PROXY_HOPS: "1"` in your Compose environment and apply it with `docker compose up -d second-star-online`.

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

**Existing containerised reverse proxy:** Attach both your proxy container and `second-star-online` to a shared private Docker network and proxy to `http://second-star-online:3000` (never `127.0.0.1:3000`, which refers to the proxy container itself). Omit or keep `ports:` bound to `127.0.0.1` so Bun is never exposed on a public host interface.

## Accounts, roles, and auditing

Roles live on the `accounts` table, not on character names:

- **`player`**: standard gameplay.
- **`moderator`**: can run the original moderation commands, `/unban`, `/unjail` and `/banlist`, and can read and post staff chat (`-text`). Bans, jails and pardons reach players only, never another moderator or an immortal; a moderator also cannot kick, warp, or look up the IP of an immortal. `/BanIP`, `/unbanip`, `/chatlog`, `/drop`, `/role`, `/setclass`, `/roster`, `/spawn`, and the editor and settings windows remain immortal-only.
- **`immortal`**: full command access, staff chat (`-text`), the immortals-only Admin Chat room, World Editor, NPC Editor, Settings, Newspaper editor, and Assassin's Game controls. An immortal can ban or jail anyone but themselves and change or lift any ban, IP ban or jail, and IP bans never stop an immortal's login.

### Bootstrapping an immortal

1. Start the server and create an account and character on the title screen.
2. Grant the **account name** (not the character display name) the `immortal` role against the same database file:

   ```sh
   # Docker Compose:
   docker compose exec -T second-star-online bun run admin:role <account-name> immortal

   # From source:
   SSO_DB=sso.sqlite bun run admin:role <account-name> immortal
   ```

3. Log out and log in again in the browser. CLI role changes take effect at the account's next login, whereas the in-game `/role` command updates an online target immediately.

### Bans, jails and IP bans

Every ban, unban, IP ban, jail, release and pardon is written to the `moderation_log` table with its reason, who made it, their rank at that moment and when it ends. The in-force bans, IP bans and jails are in `account_bans`, `ip_bans` and `jails`; a row whose `expires_at` has passed no longer applies.

- **Duration and reason.** `/ban`, `/jail` and `/banip` take an optional duration after the name, then an optional reason: `/ban Berlyn 3d being a rude person`. A duration is a number with `m`, `h`, `d` or `w` (`30m`, `12h`, `7d`, `2w`, or combined, such as `1d12h`), up to 10 years, or `perm`. Without one, the `banLength`, `ipBanLength` and `jailSentence` settings apply. Write `perm` or a duration first if a reason starts with something like `1d`. `/unban`, `/unjail`, `/unbanip` and `/pardon` take a reason too.
- **What the player sees.** A banned player reads the original alert and the ban's end, such as `Banned until 2026-11-20 14:00 UTC.` or `This ban is permanent.` The reason is never shown to the player; it is for staff, through `/banlist`.
- **Who may change an action.** Only the staff member who made a ban or jail, or an immortal, can change its length or lift it. Re-running `/ban` or `/jail` on someone already banned or jailed replaces the length. Moderators who disagree with each other's bans settle it with the team.
- **Jail.** A sentence runs in real time, including while the prisoner is offline, and works on offline characters: they arrive in jail at their next login, and a sentence that ended while they were away sends them to their respawn point (see [Respawn points](#respawn-points)). Staff warps cannot take a prisoner out or put a player in; use `/jail` and `/unjail`.
- **IP bans.** `/banip <name>` bans the address the character last logged in from, `/banip <name> all` every address it has used, and `/banip <address>` an address you type. An IPv6 address bans its whole /64. A new IP ban disconnects every session from that address at once, and the address can no longer log in or create characters. Immortals are never stopped by IP bans, so an operator cannot lock themselves out.
- **Login addresses.** The server keeps the addresses each account logs in from for `addressHistory` (default 180 days after last use) so that `/banip <name>` and `/banlist` can use them. Only immortals can read them.
- **Upgrading an older server.** The upgrade carries existing bans over as permanent bans with no reason, made at the rank the banner has now (at least moderator, or immortal if that account is gone). Existing IP bans are kept in their standard form and stay permanent; any that are not valid addresses are lifted and logged. A player saved in the jail receives a 10-minute sentence. The old `jailFrames` setting is removed: set the jail sentence again if you had changed it.

### The chat log

The server logs every line a player writes to other players in the `chat_log` table, including lines that were refused: local say, `/me`, broadcasts, IMs (from `/msg`, the IMsend window and IM windows), the automatic away replies, away texts, guild chat (`/g`), chat rooms (Guild Chat, Admin Chat and the Game menu rooms), staff chat (`-text`) and saved Bio profiles. Commands and `Password=` lines are not logged. Mail, board posts, art and newspapers are already stored in their own tables.

Each line records the time (UTC, to the second), the channel, the sender's account and character, where it went (the map, the IM's recipient, the guild or the room), the exact text, and what became of it: delivered, refused by the cooldown, the house rule or jail, an IM dropped by the recipient's ignore list or sent to someone not online, `/g` with no guild, a room line out of a room, staff chat from a player, or a Bio refused for a `:` or `/`. For say, `/me` and broadcasts it also counts how many others read the line, how many ignore the speaker, and how many heard only the muffled voice.

- **In game.** `/chatlog <name> [count] [channel]` shows a character's newest lines (20 by default, up to 100), including the IMs sent to them. Only immortals can use it, and they can read every channel, IMs and staff chat included. Every lookup is recorded in the audit log.
- **Command line.** `admin:chatlog` reads the same log with filters for name, channel and time:

  ```sh
  # Docker Compose:
  docker compose exec -T second-star-online bun run admin:chatlog Berlyn --channel im --since 2026-11-01

  # From source:
  SSO_DB=sso.sqlite bun run admin:chatlog --since 2026-11-18T09:00Z --until 2026-11-18T10:00Z -n 200
  ```

- **Retention.** Lines older than `chatLogRetention` (default 90 days) are deleted at startup and every hour; `0` keeps them forever.
- **Telling your players.** SSO does not show players a notice that their chat is logged. If you run a public server, say so in your privacy policy or terms of service, including that private messages are logged and readable by your staff, and how long you keep them.

### Reading the audit log

Actions that change state or reveal privileged information (effective admin commands, World Editor and NPC Editor saves, setting changes, and role changes) are recorded in `audit_log`, as is each `/cheatfile` look, since its lines show players' addresses. `/location` and `/inventory`, which show only the staff member's own place and bag, and refused or no-target command attempts are not logged. Immortals read it in game, merged with the moderation log, with `/auditlog <name> [count]`. From the command line, inspect the newest entries (default `50`):

```sh
# Docker Compose:
docker compose exec -T second-star-online bun run admin:audit 50

# From source:
SSO_DB=sso.sqlite bun run admin:audit 50
```

Audit rows are kept forever by default. Set `auditLogRetention` to delete rows older than that, at startup and every hour. Bans, jails and pardons live in their own moderation log, which `/banlist` reads and which is never pruned, since current bans refer back to it.

## In-game commands

Chat commands are parsed on the server. Most single-target commands read word 2 (space-delimited) as the target name, so character names containing spaces cannot be targeted by those commands; `/drop`, `/roster`, `/setclass`, and `/warp` parse further arguments as noted below.

Anyone whose role is below a command's minimum gets “Unknown command "/word".”, the same reply as a typo, so players cannot discover staff commands by trying them.

See [Admin guide](guides/admin.md) and [Chat guide](guides/chat.md) for parser details, house/muffle quirks, and staff chat (`-text`, which both staff roles can read and post).

| Command | Min role | Target / arguments | Observable result |
|---|---|---|---|
| `/location` | `moderator` | None | Prints `You are at map: <map> at position: <x>-<y>`. |
| `/iplookup <name>` | `moderator` | Online player (word 2) | Prints the target's IP address (refuses if a moderator targets an immortal). |
| `/kick <name>` | `moderator` | Online player (word 2) | Sends kick notice and disconnects the target (refuses if a moderator targets an immortal). |
| `/warp <name> <map> <x> <y>` | `moderator` | Online player, `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Warps target to `<map>` at `(x, y)` (single-space split, cut at `*`). A map that does not exist is refused: "There is no map …". |
| `/jail <name> [duration] [reason]` | `moderator` | Character name (word 2), online or offline | Jails the player in the seeded jail (`x0y0` at `4, 4`) for the duration or `jailSentence`, then sends them to their respawn point. Moderators can jail players only. |
| `/unjail <name> [reason]` | `moderator` | Character name (word 2) | Ends the sentence early and sends an online prisoner to their respawn point, as a sentence's end does (only the jailer or an immortal). |
| `/warptome <name>` | `moderator` | Online player (word 2) | Warps target to your current map and tile (refuses if a moderator targets an immortal). |
| `/warpmeto <name>` | `moderator` | Online player (word 2) | Warps you to the target's current map and tile. |
| `/save` | `moderator` | None | Saves all online characters and dirty maps immediately. |
| `/refresh` | `moderator` | None | Reloads settings overrides from the database and applies them to everyone online. |
| `/cheatfile` | `immortal` | None | Prints `* Cheater Log:` followed by up to 300 entries from `cheat_log`. Each look is audited. |
| `/inventory` | `moderator` | None | Prints your 15 bag lines as held by the server (`Name-qty`). |
| `/banip <name\|ip> [latest\|all] [duration] [reason]` | `immortal` | Character name, else an IPv4 or IPv6 address (word 2) | Bans the character's last address (`latest`, the default) or every address it has used, or the typed address (an IPv6 address bans its /64), for the duration or `ipBanLength`. Disconnects matching sessions except immortals'. |
| `/unbanip <name\|ip> [reason]` | `immortal` | Character name or address (word 2) | Lifts every IP ban made on the character's addresses, or the ban on that address. |
| `/ban <name> [duration] [reason]` | `moderator` | Character name (word 2), online or offline | Bans the target's account for the duration or `banLength` (cannot ban yourself; moderators can ban players only) and kicks if online. Re-banning replaces the length (only the banner or an immortal). |
| `/unban <name> [reason]` | `moderator` | Character name (word 2) | Lifts the ban on the target's account (only the banner or an immortal). |
| `/banlist [page\|name\|ip]` | `moderator` | None, a page number, a character name, or (immortals) an address | Lists the bans and jails in force, 10 a page, and for immortals the IP bans; with a name, that character's standing, last 10 actions and (immortals) addresses; with an address, its ban and the characters seen there. |
| `/chatlog <name> [count] [channel]` | `immortal` | Character name (word 2), online or offline; a count up to `100` and a channel (`say`, `emote`, `broadcast`, `im`, `awayReply`, `away`, `guild`, `room`, `staff`, `bio`) in either order | Prints the character's newest logged lines (default 20) and the IMs sent to them, oldest first. Each lookup is audited. See [The chat log](#the-chat-log). |
| `/auditlog <name> [count]` | `immortal` | Character name (word 2), online or offline; a count (default `10`, up to `100`) | Prints the newest staff actions by that character's account or done to that character, oldest first: admin commands, editor saves, setting and role changes, and bans, jails, IP bans and pardons with their reasons and ends. Each lookup is audited. |
| `/pardon <name> [reason]` | `moderator` | Online player (word 2) | Clears the target's murder/wanted flag and saves the character (moderators can pardon players only). Does not end a jail sentence. |
| `/warpscript <word\|OFF>` | `moderator` | Keyword (word 2) or `OFF` | Matches `<word>` as a whole token in broadcast message content, ignoring case; the first matching staff member in login order warps the speaker (`OFF` disables). |
| `/role <name> <role>` | `immortal` | Character name, `player` / `moderator` / `immortal` | Updates the account's role (cannot change your own) and applies immediately if online. |
| `/setclass <name> <class>` | `immortal` | Character name, class name or number `1`–`26` | Changes the character's class in the database. |
| `/drop <item>` | `immortal` | `<n> gold`, item name, or `<n> <item>` (1–9999) | Places the pile on the tile you face; admin drops never decay. |
| `/roster [slot species\|clear]` | `immortal` | None, or slot `1`–`4` + species name or `clear` | Lists the current map's 4 monster/NPC slots, or sets/clears a slot (saving the map). |
| `/spawn <1-4>` | `immortal` | Slot `1`–`4` | Immediately spawns the rostered creature in that slot on the tile you face. |

## Server settings

Immortals open **Admin → Settings** from the top menu bar. Clicking **SAVE** validates every field on the client and server, writes changed values as JSON overrides in the `settings` table, records each change in `audit_log`, and applies the new settings to everyone online immediately (without requiring `/refresh`). **REVERT** reloads the server's current values.

Lengths of time are typed as time: a number and a unit, `s`, `m`, `h`, `d` or `w` (or words such as `5 min` or `2 hours`), several in a row if needed (`1h 30m`, `1d12h`). The window shows them the same way. Each is stored in whole seconds, so a value in the `settings` table or an audit row is a number of seconds. Where `0` is allowed, the window says what it means (`off`, `permanent` or `forever`). For rate limits, `0` disables the limit; rate-limit counters live in memory and reset on server restart, grouping IPv6 addresses by `/64` prefix.

**Upgrading from 1.7.0 or earlier:** the duration settings were renamed to drop their unit, and their stored values are converted to seconds when the server starts: `saveIntervalTicks` → `saveInterval`, `broadcastCooldownFrames` → `broadcastCooldown`, `chatCooldownFrames` → `chatCooldown`, `resumeGraceMs` → `resumeGrace`, `npcChatterSeconds` → `npcChatter`, `lootDecayMinutes` → `lootDecay`, `jailMinutes` → `jailSentence`, `banMinutes` → `banLength`, `ipBanMinutes` → `ipBanLength`, `addressHistoryDays` → `addressHistory`, `chatLogRetentionDays` → `chatLogRetention` and `auditLogRetentionDays` → `auditLogRetention`. A frame count rounds to the nearest second (a wait that was on stays at least `1s`), and milliseconds round to the nearest second. Update any scripts that write these keys to the `settings` table.

### World

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `startPoint` | Starting map | `x1000y992 6 4` | Map `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Where new characters appear, and their first respawn point (see [Respawn points](#respawn-points)). |
| `fallbackPoint` | Fallback map | `x1000y992 5 5` | Map `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Where a character goes when their place is gone: their saved map was deleted or their house decayed. Also where a death or jail release goes if the character's respawn map was deleted. Never point it at a tutorial map. Exits, edges, `/warp` and Portal never fall back here: travel to a missing map is refused. Run `bun run maps:check` to find exits and points that lead nowhere. |
| `portalTargets` | Portal targets | `[]` | Up to 30 points (`map x y`) | Random destinations for the Portal spell, among those whose map exists; with none, Portal cannot be cast and costs nothing. |
| `hazardMap` | Server Spirit map | `null` | Map `x<mx>y<my>` or empty | Map where the Server Spirit throws fireballs and lightning bolts every 0.35 s. |
| `treasureMaps` | Treasure maps | `[]` | Up to 100 map names (`x<mx>y<my>`) | Maps where buried treasure can spawn for a Shovel; empty disables buried treasure. |
| `houseDecayTimeZone` | House decay time zone | `UTC` | Valid IANA time zone | Calendar time zone used for monthly house-decay checks. |
| `npcChatter` | NPC chatter every | `2m 30s` | `10s`–`1h` | How often an NPC with `RND\|` lines in its NPC file, such as a God, says one of them; everyone on the map sees it. |

### Chat

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `chatMaxChars` | Longest chat line | `200` | `1`–`500` chars | Maximum typed chat line length; longer lines are truncated. |
| `broadcastCooldown` | Broadcast wait | `50s` | `0`–`1h` | Minimum wait between `'` broadcasts (`0` disables). |
| `chatCooldown` | Chat wait | `3s` | `0`–`1h` | Minimum wait between local chat lines and emotes, also applied to IMs, guild and room lines, mail and board posts (`0` disables). |
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
| `lootDecay` | Loot lasts | `30m` | `1m`–`7d` | How long before monster loot disappears from the ground (player drops and `/drop` items never decay). |
| `dropOnDeath` | Drop an item on death | `true` | `true` / `false` | Whether dying characters may drop one random item from their bag, never crystals (immortals always drop). |
| `assassinPrizes` | Assassin prizes | `Long Sword`, `1000 Gold`, `500 Gold`, `Knife` | 4 lines, each <= 60 chars (item, `<n> Gold`, or empty) | 1st–4th place prizes when an Assassin's Game ends. |

### Server

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `saveInterval` | Save every | `30s` | `1s`–`1h` | Periodic save interval for online characters, besides saves on logout and map change. |
| `resumeGrace` | Reconnect grace | `30s` | `0`–`5m` | How long a dropped connection can resume with its token without logging in again (`0` disables). |

### Moderation and security

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `jailSentence` | Jail sentence | `10m` | `1m`–`3650d` (10 years) | Length of a `/jail` without a duration. Sentences run in real time, offline too, then send the prisoner to their respawn point. |
| `banLength` | Ban length | `0` (permanent) | `0`–`3650d` | Length of a `/ban` without a duration (`0` is permanent until `/unban`). |
| `ipBanLength` | IP ban length | `30d` | `0`–`3650d` | Length of a `/banip` without a duration (`0` is permanent). Addresses are reassigned, so permanent IP bans can catch someone else later. |
| `addressHistory` | Keep login addresses | `180d` | `0`–`3650d` | How long an account's login addresses are kept after their last use, for `/banip <name>` and `/banlist` (`0` keeps them forever). |
| `chatLogRetention` | Keep chat log | `90d` | `0`–`3650d` | How long the chat log keeps each line, for `/chatlog` and `admin:chatlog` (`0` keeps them forever). See [The chat log](#the-chat-log). |
| `auditLogRetention` | Keep audit log | `0` (forever) | `0`–`3650d` | How long the audit log keeps each staff action, for `admin:audit` (`0` keeps them forever). Bans, jails and pardons are kept regardless. See [Reading the audit log](#reading-the-audit-log). |
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

### Respawn points

Every character has a respawn point, where a death or the end of a jail sentence sends them. A new character's respawn point is the `startPoint` tile. Entering a map with **SAFE AREA**, **INDOOR** and **NO PVP** all ticked replaces it with the tile they arrive on; the jail never does. The seed map and a new map's default toggles do not. A respawn point whose map is later deleted is replaced by `fallbackPoint`.

`fallbackPoint` is only for a character whose place is gone: logging in when their saved map was deleted, or being saved inside a house interior that decayed. It never uses the character's respawn point, so it cannot send a player somewhere they chose.

**Shrines.** To let players set a respawn point outdoors, build a small hidden map with all three toggles ticked and an `Exit` item on its arrival tile that leads back beside the shrine's entrance. Point an exit on the outdoor map at that arrival tile. Walking into the shrine saves the hidden tile and bounces the player straight back; a later death lands on the hidden tile and bounces them out beside the shrine again. A hidden map has two exits, so it can serve two shrines.

**Tutorial island.** Set `startPoint` to the island, so new characters start there and die back there. Make the way off the island go through a main-world shrine, which replaces their respawn point, and set `fallbackPoint` to a safe main-world tile. Nothing then sends a player back to the island once they have left it.

### NPC Editor

- **Selection:** Pick a species from the **Monsters** or **NPCs** list and click **LOAD** to view its script (with live shop stock and gold merged in).
- **Line tags:** Supported tags are `BIO|`, `PRO|`, `SEL|`, `BUY|`, `GLD|`, `INV|`, `OWN|`, `FLG|`, `TRN|`, `RND|`, `SPL|`, and `BNK|` (see [Monsters guide](guides/monsters.md)).
- **Save and overrides:** **SAVE** validates every line, writes the script to the `npc_files` database table (which overrides the seed data in `packages/data/content/npc-files.json`), resets that NPC's live shop stock/gold ledger to the saved numbers, and closes any open shop or bio windows for that NPC.

## Stopping, backing up, and restoring

### Graceful stop

Send one `SIGINT` (Ctrl+C) or `SIGTERM` to the server process. The server stops the tick loop, saves all online characters and dirty maps, closes the WebSocket gateway, and closes the SQLite database cleanly. Wait for it to exit; a second signal forces an immediate exit without waiting.

### Offline backup (recommended)

1. Stop the server cleanly (and ensure no CLI such as `admin:role`, `admin:audit` or `admin:chatlog` is running against the database).
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

> **Warning:** `docker compose down -v` **deletes the named `sso-data` volume and all world data**. Use `docker compose stop`, `docker compose down` (without `-v`), or `docker compose up -d second-star-online` for normal stops and container recreation.

1. Stop the game container cleanly (waits up to `stop_grace_period: 30s` for `SIGTERM` save and exit):

   ```sh
   docker compose stop second-star-online
   ```

2. Back up the entire `/data` directory from the stopped volume (replace `<project>_sso-data` with your Compose project's volume name from `docker volume ls`, or `sso-data` for the README quick start). Use your deployed image reference in place of `latest` below if you pinned a version or use a custom image:

   ```sh
   mkdir -p ./world-backup
   docker run --rm -u 0:0 -v <project>_sso-data:/data:ro -v "$PWD/world-backup:/backup" --entrypoint sh ghcr.io/jberlyn/second-star-online:latest -c 'cp -a /data/. /backup/'
   ```

3. To upgrade, change the image reference in `docker-compose.yml` if you pinned a version, then pull and recreate the container. Migrations run automatically on startup:

   ```sh
   docker compose pull second-star-online
   docker compose up -d second-star-online
   docker compose ps
   docker compose logs --tail 50 second-star-online
   ```

   Check health, logins, and world state after the update. Rolling back an image may also require restoring the matching pre-upgrade database backup.
4. To restore into a clean volume, stop `second-star-online`, clear `/data`, copy the backup in, restore `1000:1000` ownership, and start `second-star-online`:

   ```sh
   docker run --rm -u 0:0 -v <project>_sso-data:/data -v "$PWD/world-backup:/backup:ro" --entrypoint sh ghcr.io/jberlyn/second-star-online:latest -c 'rm -rf /data/* && cp -a /backup/. /data/ && chown -R 1000:1000 /data'
   docker compose up -d second-star-online
   ```
