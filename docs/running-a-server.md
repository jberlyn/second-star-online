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
- Release image tags omit the Git tag's leading `v`. Prereleases use their full version (for example, `1.1.0-rc.1`) and do not move `latest`.
- `edge` is the newest build of `main`, published after it passes the image healthcheck. It is unreleased, untested beyond CI, and **not recommended for production servers**. It moves with every commit to `main` and keeps no history: earlier `edge` images are deleted, so you cannot pin or roll back to one.

**Moving to `edge` is one way.** An `edge` build can migrate your world database ahead of any release, and going back to `latest` or a version tag is not supported. If you try `edge`, back up your world first (see [Docker volume backup, restore, and upgrade](#docker-volume-backup-restore-and-upgrade)); any return to a stable image is at your own risk.

Find available tags and digests on the [container package page](https://github.com/jberlyn/second-star-online/pkgs/container/second-star-online). Back up your world before upgrading; see [Docker volume backup, restore, and upgrade](#docker-volume-backup-restore-and-upgrade).

### Container operations

- **Named volumes:** Compose normally prefixes the volume name with the project directory, such as `myserver_sso-data`. Use `docker volume ls` to find the actual name. Docker initializes it with ownership for UID/GID `1000`.
- **Existing installations:** Renaming a Compose volume key does not migrate data. If your server already uses a volume such as `<project>_world`, preserve it with `sso-data: { external: true, name: <existing-volume-name> }` in the top-level `volumes` section. Stop the old server before reusing its volume.
- **Migrating an existing database:** Mount the entire directory containing `sso.sqlite` (and any `-wal`/`-shm` sidecars) at `/data`. Existing migrations run automatically on startup. Never run two game processes against the same database directory.
- **Health and restarts:** The container uses `restart: unless-stopped`, `stop_grace_period: 30s`, and a dependency-free Bun healthcheck (`GET /`, an emitted JS bundle, and a generated asset every 30 s with a 5 s timeout, 30 s start period, and 3 retries). Docker health status alone does not restart an unhealthy container; verify player readiness over `/ws` after major changes.
- **Customization:** In-game map, NPC, settings and [content](#the-content-page) edits persist in the database. Changes to the Classic pack's source, art, or the client require a custom image; see [Modding](modding.md).

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
| `NODE_ENV` | unset | Only `development` selects development serving (Bun's live-reloading page, which carries no CSP). Any other value (or unset) serves the prebuilt `dist/client` bundle, and every response carries `X-Content-Type-Options: nosniff` and a CSP of `script-src 'self'; object-src 'none'; base-uri 'none'` (plus `frame-ancestors` when `SSO_FRAME_ANCESTORS` is set). |
| `SSO_CLIENT_DIR` | `dist/client` | Optional override for the prebuilt production client directory (used by tests). |
| `SSO_PROXY_HOPS` | `0` | Number of trusted reverse proxies in front of the server (whole number `>= 0`; invalid values refuse startup). The recommended Compose example sets `0`; use `1` behind a single reverse proxy. |
| `SSO_FRAME_ANCESTORS` | unset | Optional CSP `frame-ancestors` directive value. Unset adds no `frame-ancestors` directive. |
| `SSO_SAVE_INTERVAL` | `30s` | How often online characters are saved, besides saves on logout and map change. A time from `1s` to `1h`, written like the Server Settings page's times (`30s`, `2m`). |
| `SSO_RECONNECT_GRACE` | `30s` | How long a dropped connection can resume with its token without logging in again. `0` to `5m`; `0` turns resuming off. |
| `SSO_SOCKETS_PER_IP` | `10` | Open connections one address (IPv6 `/64`) may hold at once. Whole number `0`–`1000`; `0` turns the limit off. Connections of roles with the login-limit bypass (moderators and administrators by default) stop counting once logged in. |
| `SSO_PERF_OUT` | unset | Path to append once-a-second JSON performance samples (see [performance.md](performance.md)). |
| `SSO_CRASH_AT` | unset | Test hook that kills the process at a named crash point; not an operator setting. |

A value of `SSO_SAVE_INTERVAL`, `SSO_RECONNECT_GRACE` or `SSO_SOCKETS_PER_IP` that does not read, or is out of range, refuses startup with a message naming the variable. A bare number is not a time: write `30s`, not `30`.

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

Staff are accounts with a **role**. A role has an id (such as `moderator`), a display name (`Moderator`), a rank and a set of permissions. An account holds at most one role, and an account with none is an ordinary player. Roles belong to the account, not to a character name. The roles are kept in the database's `roles` table, and you edit them in the game, not in files.

A new server starts with two roles:

- **`moderator`** (Moderator, rank 1): an ordinary player who moderates others. A moderator can `/kick`, `/ban`, `/unban`, `/jail`, `/unjail`, `/mute`, `/unmute` and `/banlist`, plus `/location` and `/inventory`, and can read and post staff chat (`-text`). Bans, jails and mutes reach players only, never another moderator, an administrator or themselves; a moderator also cannot kick an administrator. A moderator has no warps (`/warp`, `/warptome`, `/warpmeto`, `/warpscript`) and plays by the same rules as everyone else, except for the login-limit bypass (see `loginFailsPerIp`). `/pardon`, `/iplookup`, `/save`, `/refresh`, `/BanIP`, `/unbanip`, `/chatlog`, `/auditlog`, `/cheatfile`, `/drop`, `/setclass`, `/roster`, `/spawn`, the Admin Chat room, the Assassin's Game controls, the editors and the Control Panel are administrators'.
- **`administrator`** (Admin, rank 2): every permission. Full command access, staff chat, the Admin Chat room, World Editor, NPC Editor, the Control Panel with Server Settings (including the roles), and Assassin's Game controls. An administrator can ban, jail or mute anyone but themselves and change or lift any ban, IP ban, jail or mute, and IP bans never stop an administrator's login. Administrators take no damage of any kind, never get hungry, cannot be pushed, stay off the high scores, drop on every death and skip the chat and broadcast waits.

Every one of these is a permission you can turn on or off for each role, and you can add roles of your own, such as a helper who can only `/mute`. Any role makes an account staff: it reads and posts staff chat and can be sent IMs by jailed and muted players, so roles are for staff, not for perks. Bans, jails, mutes and pardons reach only accounts of lower rank, unless the staff member's role has the **Overrule** permission. `/kick`, `/iplookup`, `/warp` and `/warptome` are looser: they refuse only a target whose rank is higher than yours, so a moderator can kick or look up another moderator. `/warpmeto` has no rank check (it refuses only a jailed caller), and `/warpscript` never warps a speaker whose rank is higher than the staff member's.

### Editing roles and giving them out

Open **Admin → Control Panel**, then **Server Settings**, and choose:

- **Roles** to edit a role's display name, rank and permissions, add a role (**New role…**) or delete one. **Save** applies the role at once to everyone online who holds it. Deleting a role leaves its accounts with no role. At least one role must keep every permission, so the server can always be run.
- **Staff** to see every account with a role, change one with its picker (or **No role** to take it away), or type a character's name and **Give role**. Changes apply at once, also to anyone online. You cannot change your own role here.

Both pages need the **Server Settings, roles and staff** permission (administrators by default). There is no in-game chat command for roles. Every role edit, deletion and assignment is recorded in the audit log.

**Upgrading from 1.10.0 or earlier:** `immortal` accounts become `administrator`, `player` accounts have no role, and moderators keep their role with the permissions v1.11.0 gave it, so they lose the warps and `/pardon` or `/warp` on themselves. `/role` is gone: give roles on the Staff page or with `bun run admin:role`. Scripts that set `accounts.role` must write a role id (`administrator`, `moderator`) or `NULL`. The moderation tables' `actor_rank` column is now `actor_role` and holds the role's display name (`Admin`, `Moderator`).

**Upgrading from 1.11.0:** `/pardon`, `/iplookup`, `/save` and `/refresh` are now administrators' by default. If you never changed the Moderator role's permissions, the upgrade takes these four commands away from it. If you did change them, the upgrade leaves the role alone; untick the four on the Roles page if you want the new defaults.

The Chat and mail page's `roleTags` setting (off by default) shows the speaker's role name before their name in chat, as in `[Admin] Berlyn says "hi"`.

### Bootstrapping an administrator

1. Start the server and create an account and character on the title screen.
2. Give the account (by its account name or its character's name) the `administrator` role against the same database file:

   ```sh
   # Docker Compose:
   docker compose exec -T second-star-online bun run admin:role <name> administrator

   # From source:
   SSO_DB=sso.sqlite bun run admin:role <name> administrator
   ```

   `bun run admin:role <name> none` takes a role away, and `bun run admin:role --list` lists the roles, their permissions and who holds them.
3. Log out and log in again in the browser. Command-line role changes take effect at the account's next login, whereas the Staff page updates an online account immediately.

The command line is also the way back in if you ever leave no one able to open Server Settings.

### The Control Panel

Administrators open **Admin → Control Panel** from the top menu bar. The game gives way to a full-page dashboard; **Return to Game** at the top brings you back where you stood. While you are in the Control Panel you stay online but are off the map, as in the World Editor: other players see you leave, and trades, shops and held actions are cancelled. The header also opens Friends, Who's Online, Send IM (with a count of IMs that came in), the chat rooms and Player Settings as floating windows over the dashboard, and Return To Title Screen logs out. The sidebar lists the admin pages your role may use, with the World Editor and NPC Editor under **Classic tools** until their Control Panel pages arrive.

The Control Panel shows for a role with a permission that has a page there: today **Server Settings, roles and staff**, **Control Panel: look up characters (the player hub)** (the [Characters](#the-player-hub) page), **Control Panel: read the player activity log** (the [Activity Log](#the-activity-log) page) and **Control Panel: edit items, monsters and NPCs** (the [Content](#the-content-page) page). **Control Panel: edit characters** adds the hub's [Edit tab](#editing-a-character).

### The content page

Everything the game knows about items, monsters, NPCs, spells, rules and texts comes from the **installed packs** plus **your changes**. Every server runs the **Classic pack** (1.6's content, shipped inside each release and read from it, never copied into your database), so a server with no changes plays exactly as before. **Control Panel → Content** (permission **Control Panel: edit items, monsters and NPCs**) lists:

- **Installed packs**, with the version each runs at. A release that brings a newer Classic says so here once.
- **Pack updates:** when a newer pack version changes a row you have customised, your version stays live and the row is listed with what the pack changed and how yours differs. **Use Classic's version** replaces yours (as a publish you can undo); **Keep mine** stops the notice. Rows you never changed take the new version on their own.
- **Draft:** pending changes, shared by every admin and tagged with who made them. Before publishing, the whole store is checked: each dataset against its schema, then the key and name rules (a new item's key is the name it was created with and never changes; display names are unique; a key may not contain `#`, start with a number and a space, or end in `+N`), then the skills (every character's saved skills are read by each skill's index, so a skill keeps its index and cannot be removed, a new skill takes the next number, the skills are listed in index order, and no two skills may read the same with case and spaces ignored), then references between rows (a deed, quest, quest pool, crafting recipe, gathering find, editor list, NPC shop or drop, or summon naming something that no longer exists, or a medal, title, platform, book, tool, weapon or promotion naming a skill that does not). NPC files are checked as they play: where the NPC Editor has saved an NPC, its save is what is checked, so removing an item a saved shop still sells is refused. **Publish** makes the draft live for every player at once, without a restart; it is refused if another admin changed the draft since you last looked.
- **Rows:** pick a dataset and field to list its rows (an item, a monster, an NPC file, or a whole field such as a text table), with whether each is as the pack has it, changed, added or removed. Opening a row shows the pack's version and an editor for its JSON. **Save to draft**, **Remove** (keyed rows) and **Back to the pack's version** all go into the draft. To rename an item or monster, set its `"display"`; players then see the new name everywhere while their copies keep working. Admin `/drop`, NPC file lines, quest rows and the quest pools accept a display name and store the key. `quests/current` only seeds a new world: once a world has started it keeps its own quests (each finished quest rolls the next from `quests/pools`), so edit the pools to change what NPCs ask for. An NPC file saved here gets the NPC Editor's checks; if the NPC Editor has saved that NPC, its save is what plays and the row says so. The collision rects are built from the art and cannot be changed here.
- **Where it is used:** opening an item or a monster shows where it is used, for example "Held by 14 characters · on the ground on 3 maps · named in 5 places in content": each row that names it (click to open it), and each place in the world, with the characters who hold copies (click a name to open their player hub).
- **Removing an item or a monster** asks what to clean up, and puts the cleanup into the draft with the removal:
  - **References in content** (shop and drop lines in NPC files, recipes, gathering finds, quest rows, quest chest refills, Oraku's orb and reward, faction heads, deeds, editor lists; a deed's row always goes with its item; mining's crystal colours and the Assassin's prize line are listed for you to edit by hand): **remove the entries that name it** (the default: the recipe, shop line, drop or list entry goes), **replace it with another**, or **leave them for me to fix**. A few entries cannot go without breaking their row (a station's one tool, an entry in a quest pool's or carpentry's roll table, one of mining's three ores, the last entry of a list that needs one): they can only be replaced, and the draft's checks name them until they are. NPCs the NPC Editor has saved get the same cleanup as their rows, when the draft is published, and the text each had is kept in its versions.
  - **Copies players hold** (bags, gear, vaults, containers, the ground): **retire it** (the default: copies stay and keep working, but no more can be made: no content may name it, `/drop` refuses it, and the character editor can move its copies but not add any; an item nobody holds when the draft is published is simply removed, and removing an item that is already retired takes it out once nobody holds a copy), **purge every copy** (asked twice; you can give gold back for each copy a character held), or **replace every copy** with another item. World quest lines that want or give it are rolled again, or name the replacement. A storage item (a Crate, a Cabinet) can only be replaced with another storage item, and what each copy holds goes with it, under a new storage number of its own, wherever the copy is (a bag, a vault, the ground or another container); purging one deletes what it holds too. Stock on sale in player shops counts as copies: it stays when retired (players can still buy and sell copies they already have, there as in a trade, but no NPC shop sells it), goes when purged, and becomes the replacement when replaced; a player shop never stops a publish. A pile of crystals replaced by an item that is not crystals becomes a pile of that many. Removing a colour of crystals (Blue Crystals) leaves the single crystal of that colour (Blue Crystal, an item of its own) and its copies alone; only the player-shop list's entry, which names crystals in the singular, goes with it.
  - **A monster or NPC:** its roster slots are cleared or spawn another monster; live ones despawn when published or stay until they die; its own NPC file goes with it or stays, unattached. Quest lines that name an NPC are listed for you to look at.

  The draft lists each removal and what publishing it will do ("This draft removes 2 items still used in 5 places"). Copies, spawns and live monsters change only when the draft is published, in the same step as the content (a failure part-way changes nothing, and players are told nothing until the publish is through), and the publish history keeps a line for each thing done. **Undoing a publish brings removed content back, but not purged or replaced copies, cleared spawns or despawned monsters.** Changing an item's wear rules leaves it on anyone already wearing it; once taken off, it goes back on only if they meet the new rules. Changing a monster's HP applies to new spawns (live ones keep the HP they have); its attack and defence apply at once.
- **Problems:** **Look for problems** lists references nothing resolves: stored items no catalogue has (left by a database edit or an older server), roster slots naming no monster, and content's own (some come with Classic as 1.6 shipped them). None of them stops the game: an unknown item shows by its name with no picture and does nothing, and an unknown monster spawns as a stand-in. The server also prints the world's at start.
- **Publish history:** each publish with its rows. **Undo** takes a whole publish back, and is refused, naming the rows, if a later publish touched any of them (even to put one back) or if the result would not pass the same checks as a publish (a later publish may refer to something this one added). Every publish, undo and pack-update answer is also tried out first: if any part of the game cannot read the result (a text a rule needs has gone, say), it is refused with the reason and nothing changes.

Publishes, undos and pack-update answers are in the audit log. Connected players pick up a publish within a moment; a player who was away picks it up at their next login. A browser that cannot fetch the new content tries again a few times before carrying on, and keeps trying in the background until it has it.

**Upgrading to the content store:** back up your database first: migrations only run forward. The upgrade records your server as having the Classic pack installed; your world, characters and bags are unchanged. The server also records which index each skill is saved at in characters; a later release or imported pack that would move or drop a skill stops the server at start with the skills it would move, instead of shifting everyone's training onto other skills.

**Upgrading from 1.13.0 or earlier:** **Admin → Server Settings** moved into the Control Panel, and the floating Server Settings window is gone. A role that held every permission gets the three new Control Panel permissions, so it still holds every permission; other roles are left as they are.

### Bans, jails, mutes and IP bans

Every ban, unban, IP ban, IP unban, jail, `/unjail`, mute, `/unmute` and pardon is written to the `moderation_log` table with its reason, who made it, the name of their role at that moment and when it ends. The in-force bans, IP bans, jails and mutes are in `account_bans`, `ip_bans`, `jails` and `mutes`; a row whose `expires_at` has passed no longer applies. A ban, jail or mute that runs out by itself is logged too, as an `unban`, `unipban`, `unjail` or `unmute` row by `system` with the reason "Expired", dated when it ended (the server checks once a minute and at startup, so this happens whether or not the player is online).

- **Duration and reason.** `/ban`, `/jail`, `/mute` and `/banip` take an optional duration after the name, then an optional reason: `/ban Berlyn 3d being a rude person`. A duration is a number with `m`, `h`, `d` or `w` (`30m`, `12h`, `7d`, `2w`, or combined, such as `1d12h`), up to 10 years, or `perm`. Without one, the `banLength`, `ipBanLength`, `jailSentence` and `muteLength` settings apply. Write `perm` or a duration first if a reason starts with something like `1d`. `/unban`, `/unjail`, `/unmute`, `/unbanip` and `/pardon` take a reason too.
- **What the player sees.** A banned player reads the original alert and the ban's end, such as `Banned until 2026-11-20 14:00 UTC.` or `This ban is permanent.` A jailed or muted player is told in the chat box until when, at once and at each login. The reason is never shown to the player; it is for staff, through `/banlist`.
- **Who may change an action.** Only the staff member who made a ban, jail or mute, or a role with **Overrule** (administrators), can change its length or lift it. Re-running `/ban`, `/jail` or `/mute` on someone already banned, jailed or muted replaces the length. Moderators who disagree with each other's bans settle it with the team.
- **Jail.** A sentence runs in real time, including while the prisoner is offline, and works on offline characters: they arrive in jail at their next login, and a sentence that ended while they were away sends them to their respawn point (see [Respawn points](#respawn-points)). A prisoner can talk only with local chat and `/me`, which reach the jail map, and send IMs to staff; broadcasts, IMs to other players, guild chat, chat rooms, mail and board posts are refused. Staff warps cannot take a prisoner out or put a player in; use `/jail` and `/unjail`.
- **Mutes.** A muted player cannot talk at all (local chat, `/me`, broadcasts, IMs, guild chat, chat rooms, staff chat, mail and board posts), except to send an IM to staff to ask why. Player-shop commands are refused too. A mute is on the account, runs in real time, works on offline characters, and ends by itself or with `/unmute`.
- **Staff.** Any account with a role is staff: staff read and post staff chat and can receive IMs from jailed and muted players.
- **IP bans.** `/banip <name>` bans the address the character last logged in from, `/banip <name> all` every address it has used, and `/banip <address>` an address you type. `/banip <name>` refuses your own account and a character whose role has the IP-ban bypass ("IP bans do not apply to that player's role."). An IPv6 address bans its whole /64. A new IP ban disconnects every session from that address at once, and the address can no longer log in or create characters. Administrators (any role with the IP-ban bypass) are never stopped by IP bans, so an operator cannot lock themselves out.
- **Login addresses.** The server keeps the addresses each account logs in from for `addressHistory` (default 180 days after last use) so that `/banip <name>` and `/banlist` can use them. Only roles with `/banip` (administrators) can read them.
- **Upgrading an older server.** The upgrade carries existing bans over as permanent bans with no reason, recorded under the role the banner held then (`Moderator` or `Admin` in `actor_role`; `Admin` if that account is gone). Existing IP bans are kept in their standard form and stay permanent; any that are not valid addresses are lifted and logged. A player saved in the jail receives a 10-minute sentence. The old `jailFrames` setting is removed: set the jail sentence again if you had changed it.

### The player hub

Open **Admin → Control Panel → Characters** (the **Control Panel: look up characters** permission, administrators by default) and type part of a name; an empty search lists the most recently saved characters. Choose a row to open their hub:

- **Overview:** class, level, experience, HP, SP, hunger, faction, wanted, stats and skills, where they are, their respawn point and what they ride, and when the account was made and the character last saved.
- **Items:** gold carried and in the bank, the bag, worn gear, vault, spellbook and the houses they own.
- **Edit:** change the character (see [Editing a character](#editing-a-character)), for a role with **Control Panel: edit characters**.
- **Edits:** every edit an admin made to them, with who, when, why and each value before and after, and **Undo**.
- **Moderation:** any ban, jail or mute in force, with who made it and why, and the moderation history. A role with `/banip` also sees the addresses the account logged in from and any IP ban in force on them (noting a role that IP bans do not stop); without it, an IP ban in the history shows without its address, as on `/banlist`. The **Act** form kicks, bans, jails or mutes (a ban, jail or mute needs a reason; a kick takes none, as `/kick` does; the length is typed as for the commands, such as `30m`, `7d` or `perm`, or left empty for the server's default) and lifts each. Each action needs the same permission as its command and follows the same rules: who may act on whom, and who may change or lift someone else's ban.
- **Chat:** their newest 50 chat lines, for a role with `/chatlog`.
- **Activity Log** opens their timeline, for a role with the activity log permission.

An online character is read from the game as it stands, not from their last save. Every hub opened is recorded in the audit log.

**Upgrading from 1.13.0 or earlier:** a role that held every permission gets the new **Control Panel: look up characters** permission; give it to any other role that should use the hub.

#### Editing a character

The hub's **Edit** tab (the **Control Panel: edit characters** permission, administrators by default) changes a character online or offline. It covers class, level, experience, HP, SP, hunger, faction, wanted, stats, skills, gold, bank, bag, worn gear, vault, spellbook, position, respawn point, sex and head. Change what you need, give a reason, and choose **Save changes**. The page lists the changes and asks before it sends them.

- **Online or offline.** An online player's character changes at once, their screen updates, and the change is saved straight away. Moving them warps them and keeps their respawn point as the editor shows it; a new head redraws for everyone on their map. An offline character's saved record is changed, and they see it at their next login.
- **Checked like play.** Every value must be one the game could hold: stats 1–20, skills 1–100, items and spells that exist, maps that exist, at most 15 vault lines, and gold up to 2,000,000,000. Experience needed and HP and SP max are not typed: they follow the level, one point of HP and SP max for each level up or down. Worn gear must fit its slot, the character's strength and the two-handed weapon rule. To save gear that breaks those rules, tick **Override the wear rules**; the override is logged.
- **Refused while busy.** Gold, items and position can't be changed while the player is trading or seated at a casino table, including a seat kept for them after they dropped mid-hand. A player can't be moved while they are in jail (use Jail and Release from jail) or in an editor, and only staff can be put on the jail map. The bank can be edited only once they have an account.
- **Stale pages.** If anything you changed has moved since the hub was read (the player spent the gold you are correcting, say), the edit is refused. Refresh and make it again.
- **Undo.** **Edits** lists each edit, newest first. **Undo** puts an edit's old values back, with a reason of its own. It is refused if any value the edit set has changed since, if what it puts back no longer fits the character (an HP max below the HP they have now, say), or if it would put back gear that breaks the wear rules; make a new edit instead.
- **Items with their own storage.** A Crate, Cabinet or Cauldron added in the editor gets its own storage, as one bought does. One the character already has can be moved to another line but not copied, and an `#id` can't be typed in. As in play, the vault takes no containers and gold is never a bag or vault item.
- **Logs.** Each edit is kept in the `character_edits` table and the audit log. Gold and items it added or removed are `Admin` events in the Activity Log, so they never show as unlogged; bank and vault changes are logged with their amounts.

Houses can't be revoked or transferred here yet (issue #36).

### The activity log

The server logs what players do in the `activity_log` table, for tracing dupes, scams and real-money trading:

- **Items and gold:** trades (both sides), drops, pickups (naming the player who dropped the item), gives, NPC and player shops, the bank, the vault, house vaults, chests and crates, crafting, gathering, items used up (food, potions, books, keys, deeds, seeds, the crystals a bow shoots, cannonballs and spell reagents), quest hand-ins, training, casino bets and wins, prizes, death drops, items breaking in a fight, monster loot, a new character's starting items, admin `/drop`, and items and gold placed or removed by a World Editor save.
- **Combat:** monster kills, player kills and deaths, naming the killer.
- **Progression:** levels, skill gains, class changes and quest hand-ins.
- **Sessions:** logins and logouts with the address, and map changes (with how: an edge, an exit, a portal, a warp or a respawn). Single steps are not logged.

Items are recorded by name and quantity. Each event is one character's view of it: a trade writes a row for each side, and a quantity or gold amount is the change to what that character carries (bag, worn gear and gold in hand), so a bank deposit is `-500 gold`. Once a tick the server also compares what each player carries with what the log says they should carry; any difference is written as an **Unlogged change**. One means a bug or a dupe, so report it.

Open **Admin → Control Panel → Activity Log** (the `activityLog` permission, administrators by default). **Player timeline** shows a character's events, newest first; a deleted character is still found by name. **Item flow** shows every movement of one item, with totals gained and lost by type. Filter either by event type or group and by UTC day, and choose **Show older** for more. A player or item in a row opens their timeline or flow. Every read, each further page included, is recorded in the audit log. An item's totals add up at most its newest 20,000 events, and the page says when older ones were left out.

Events are written once a tick in a batch. Rows older than `activityLogRetention` (default 180 days) are deleted at startup and every hour; `0` keeps them forever. The log grows quickly on a busy server, so keep an eye on the database size if you raise it.

### The chat log

The server logs every line a player writes to other players in the `chat_log` table, including lines that were refused: local say, `/me`, broadcasts, IMs (from `/msg`, the IMsend window and IM windows), the automatic away replies, away texts, guild chat (`/g`), chat rooms (Guild Chat, Admin Chat and the Game menu rooms), staff chat (`-text`) and saved Bio profiles. Commands and `Password=` lines are not logged, except that a muted player's player-shop command is logged as a refused say line (outcome `muted`). Mail, board posts, art and newspapers are already stored in their own tables.

Each line records the time (UTC, to the second), the channel, the sender's account and character, where it went (the map, the IM's recipient, the guild or the room), the exact text, and what became of it: delivered, refused by the cooldown, the house rule, jail or a mute, an IM dropped by the recipient's ignore list or sent to someone not online, `/g` with no guild, a room line out of a room, staff chat from a player, or a Bio refused for a `:` or `/`. For say, `/me` and broadcasts it also counts how many others read the line, how many ignore the speaker, and how many heard only the muffled voice.

- **In game.** `/chatlog <name> [count] [channel]` shows a character's newest lines (20 by default, up to 100), including the IMs sent to them. Only roles with `/chatlog` (administrators) can use it, and they can read every channel, IMs and staff chat included. Every lookup is recorded in the audit log.
- **Command line.** `admin:chatlog` reads the same log with filters for name, channel and time:

  ```sh
  # Docker Compose:
  docker compose exec -T second-star-online bun run admin:chatlog Berlyn --channel im --since 2026-11-01

  # From source:
  SSO_DB=sso.sqlite bun run admin:chatlog --since 2026-11-18T09:00Z --until 2026-11-18T10:00Z -n 200
  ```

- **Retention.** Lines older than `chatLogRetention` (default 90 days) are deleted at startup and every hour; `0` keeps them forever.
- **Telling your players.** SSO does not show players a notice that their chat is logged. If you run a public server, say so in your privacy policy or terms of service, including that private messages are logged and readable by your staff, and how long you keep them.

### Checking content and maps

Two more command-line checks help when editing the world (see [scripts](scripts.md)):

```sh
# Docker Compose:
docker compose exec -T second-star-online bun run maps:check
# From source:
SSO_DB=sso.sqlite bun run maps:check
bun run content:report "<name>"
```

`maps:check` lists exits whose target map does not exist, `Exit` or `Exit2` tiles on a map with no such exit set, and start point, fallback point or Portal target settings whose map does not exist, and exits non-zero when it finds any. `content:report` shows which content rules and NPC seed text match a name (it reads the generated data, not your database).

### Reading the audit log

Actions that change state or reveal privileged information (effective admin commands, World Editor and NPC Editor saves, setting changes, and role edits and assignments) are recorded in `audit_log`, as is each `/cheatfile` look, since its lines show players' addresses. `/location` and `/inventory`, which show only the staff member's own place and bag, `/banlist`, and refused or no-target command attempts are not logged. Administrators read it in game, merged with the moderation log, with `/auditlog <name> [count]`. From the command line, inspect the newest entries (default `50`):

```sh
# Docker Compose:
docker compose exec -T second-star-online bun run admin:audit 50

# From source:
SSO_DB=sso.sqlite bun run admin:audit 50
```

Audit rows are kept forever by default. Set `auditLogRetention` to delete rows older than that, at startup and every hour. Bans, IP bans, jails, mutes and pardons also live in their own moderation log, which `/banlist` and `/auditlog` read and which is never pruned, since current bans refer back to it. They are written to `audit_log` too, so `admin:audit` prints them; `/auditlog` shows them once, from the moderation log.

## In-game commands

Chat commands are parsed on the server. Most single-target commands read word 2 (space-delimited) as the target name, so character names containing spaces cannot be targeted by those commands; `/drop`, `/roster`, `/setclass`, and `/warp` parse further arguments as noted below.

Anyone whose role lacks a command's permission gets “Unknown command "/word".”, the same reply as a typo, so players cannot discover staff commands by trying them.

See [Admin guide](guides/admin.md) and [Chat guide](guides/chat.md) for parser details, house/muffle quirks, and staff chat (`-text`, which every staff role can read and post).

| Command | Default role | Target / arguments | Observable result |
|---|---|---|---|
| `/location` | `moderator` | None | Prints `You are at map: <map> at position: <x>-<y>`. |
| `/iplookup <name>` | `administrator` | Online player (word 2) | Prints the target's IP address (refuses a target who outranks you). |
| `/kick <name>` | `moderator` | Online player (word 2) | Sends kick notice and disconnects the target (refuses a target who outranks you). |
| `/warp <name> <map> <x> <y>` | `administrator` | Online player, `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Warps target to `<map>` at `(x, y)` (single-space split, cut at `*`). A map that does not exist is refused: "There is no map …". |
| `/jail <name> [duration] [reason]` | `moderator` | Character name (word 2), online or offline | Jails the player in the seeded jail (`x0y0` at `4, 4`) for the duration or `jailSentence`, then sends them to their respawn point. Moderators can jail players only. |
| `/unjail <name> [reason]` | `moderator` | Character name (word 2) | Ends the sentence early and sends an online prisoner to their respawn point, as a sentence's end does (only the jailer or an administrator). |
| `/mute <name> [duration] [reason]` | `moderator` | Character name (word 2), online or offline | Mutes the account for the duration or `muteLength` (moderators can mute players only): no chat, IMs except to staff, mail or board posts. Re-muting replaces the length (only the staff member who muted them or an administrator). |
| `/unmute <name> [reason]` | `moderator` | Character name (word 2) | Lifts the mute (only the staff member who muted them or an administrator). |
| `/warptome <name>` | `administrator` | Online player (word 2) | Warps target to your current map and tile. |
| `/warpmeto <name>` | `administrator` | Online player (word 2) | Warps you to the target's current map and tile. |
| `/save` | `administrator` | None | Saves all online characters and dirty maps immediately. |
| `/refresh` | `administrator` | None | Reloads settings overrides from the database and applies them to everyone online. |
| `/cheatfile` | `administrator` | None | Prints `* Cheater Log:` followed by up to 300 entries from `cheat_log`. Each look is audited. |
| `/inventory` | `moderator` | None | Prints your 15 bag lines as held by the server (`Name-qty`). |
| `/banip <name\|ip> [latest\|all] [duration] [reason]` | `administrator` | Character name, else an IPv4 or IPv6 address (word 2) | Bans the character's last address (`latest`, the default) or every address it has used, or the typed address (an IPv6 address bans its /64), for the duration or `ipBanLength`. Disconnects matching sessions except administrators'. Refuses your own account and a character whose role bypasses IP bans. |
| `/unbanip <name\|ip> [reason]` | `administrator` | Character name or address (word 2) | With a name, lifts the IP bans made with `/banip <name>` on that character; a ban typed as an address stays, even on an address the character used (lift it with `/unbanip <address>`). With an address, lifts the ban on that address. |
| `/ban <name> [duration] [reason]` | `moderator` | Character name (word 2), online or offline | Bans the target's account for the duration or `banLength` (cannot ban yourself; moderators can ban players only) and kicks if online. Re-banning replaces the length (only the banner or an administrator). |
| `/unban <name> [reason]` | `moderator` | Character name (word 2) | Lifts the ban on the target's account (only the banner or an administrator). |
| `/banlist [page\|name\|ip]` | `moderator` | None, a page number, a character name, or (administrators) an address | Lists the bans in force, 10 a page, then the first 10 jails, mutes and (administrators) IP bans, which do not page; with a name, that character's standing, last 10 actions and (administrators) addresses; with an address, its ban and the characters seen there. |
| `/chatlog <name> [count] [channel]` | `administrator` | Character name (word 2), online or offline; a count up to `100` and a channel (`say`, `emote`, `broadcast`, `im`, `awayReply`, `away`, `guild`, `room`, `staff`, `bio`) in either order | Prints the character's newest logged lines (default 20) and the IMs sent to them, oldest first. Each lookup is audited. See [The chat log](#the-chat-log). |
| `/auditlog <name> [count]` | `administrator` | Character name (word 2), online or offline; a count (default `10`, up to `100`) | Prints the newest staff actions by that character's account or done to that character, oldest first: admin commands, editor saves, setting changes, role edits and assignments, and bans, jails, mutes, IP bans and pardons (and their lifting) with their reasons and ends. Each lookup is audited. |
| `/pardon <name> [reason]` | `administrator` | Online player (word 2) | Clears the target's murder/wanted flag and saves the character (only someone you outrank; never yourself without the `pardonSelf` permission). Does not end a jail sentence. |
| `/warpscript <word\|OFF>` | `administrator` | Keyword (word 2) or `OFF` | Matches `<word>` as a whole token in broadcast message content, ignoring case; the first matching staff member in login order warps the speaker (`OFF` disables). |
| `/setclass <name> <class>` | `administrator` | Character name, class name or number `1`–`26` | Changes the character's class in the database. |
| `/drop <item>` | `administrator` | `<n> gold`, item name, or `<n> <item>` (1–9999) | Places the pile on the tile you face; admin drops never decay. |
| `/roster [slot species\|clear]` | `administrator` | None, or slot `1`–`4` + species name or `clear` | Lists the current map's 4 monster/NPC slots, or sets/clears a slot (saving the map). |
| `/spawn <1-4>` | `administrator` | Slot `1`–`4` | Immediately spawns the rostered creature in that slot on the tile you face. |

## Server settings

Administrators open **Admin → Control Panel** from the top menu bar and choose **Server Settings**. The page has its own sidebar of pages (World, Chat and mail, Items, Moderation, Logins, Logs, and the [Roles and Staff](#editing-roles-and-giving-them-out) pages) and a search box that finds a setting on any page by its label, explanation or key; choosing a result opens its page at that setting.

Each page is saved on its own. Clicking **SAVE** validates the page's fields on the client and server, writes changed values as JSON overrides in the `settings` table, records each change in `audit_log`, and applies the new settings to everyone online immediately (without requiring `/refresh`). **REVERT** reloads the server's current values. Only the open page can hold unsaved changes: leaving it for another page, a search result, another Control Panel page, a classic editor or the game asks first, and the changes are discarded if you go on.

Server infrastructure (save interval, reconnect grace, open connections per address) is not in Server Settings; set it with [environment variables](#environment-variables).

Lengths of time are typed as time: a number and a unit, `s`, `m`, `h`, `d` or `w` (or words such as `5 min` or `2 hours`), several in a row if needed (`1h 30m`, `1d12h`). The page shows them the same way. Each is stored in whole seconds, so a value in the `settings` table or an audit row is a number of seconds. Where `0` is allowed, the page says what it means (`off`, `permanent` or `forever`). For rate limits, `0` disables the limit; rate-limit counters live in memory and reset on server restart, grouping IPv6 addresses by `/64` prefix.

**Upgrading from 1.7.0 or earlier:** the duration settings were renamed to drop their unit, and their stored values are converted to seconds when the server starts: `saveIntervalTicks` → `saveInterval`, `broadcastCooldownFrames` → `broadcastCooldown`, `chatCooldownFrames` → `chatCooldown`, `resumeGraceMs` → `resumeGrace`, `npcChatterSeconds` → `npcChatter`, `lootDecayMinutes` → `lootDecay`, `jailMinutes` → `jailSentence`, `banMinutes` → `banLength`, `ipBanMinutes` → `ipBanLength`, `addressHistoryDays` → `addressHistory`, `chatLogRetentionDays` → `chatLogRetention` and `auditLogRetentionDays` → `auditLogRetention`. A frame count rounds to the nearest second (a wait that was on stays at least `1s`), and milliseconds round to the nearest second. Update any scripts that write these keys to the `settings` table.

**Upgrading from 1.7.0 or earlier:** the save interval, reconnect grace and open connections per address are server infrastructure, so they left the Server Settings window for environment variables: `saveIntervalTicks`/`saveInterval` → `SSO_SAVE_INTERVAL`, `resumeGraceMs`/`resumeGrace` → `SSO_RECONNECT_GRACE` and `socketsPerIp` → `SSO_SOCKETS_PER_IP` (see [Environment variables](#environment-variables)). Their rows are removed from the `settings` table when the server starts. If you had changed one, set its variable to keep your value.

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

### Chat and mail

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `chatMaxChars` | Longest chat line | `200` | `1`–`500` chars | Maximum typed chat line length; longer lines are truncated. |
| `broadcastCooldown` | Broadcast wait | `50s` | `0`–`1h` | Minimum wait between `'` broadcasts (`0` disables). Roles with the matching skip permission (administrators) skip it. |
| `chatCooldown` | Chat wait | `3s` | `0`–`1h` | Minimum wait between local chat lines and emotes, also applied to IMs, guild and room lines, mail and board posts (`0` disables). Roles with the matching skip permission (administrators) skip it. |
| `mailBodyMax` | Longest mail | `2000` | `1`–`4000` chars | Maximum mail body length; longer bodies are truncated. |
| `mailboxMax` | Messages per mailbox | `50` | `1`–`1000` | Maximum messages kept per mailbox; newer mail drops the oldest. |
| `boardPostsMax` | Posts per board | `200` | `1`–`1000` | Maximum posts kept per message board; newer posts evict the oldest (there is no board moderation tool). |
| `boardPostMax` | Longest board post | `300` | `1`–`4000` chars | Maximum message board post length; longer posts are truncated. |
| `artBytesMax` | Largest painting or photo | `16384` | `1024`–`16384` bytes | Maximum byte size for a saved 64×64 PNG painting or photo. |
| `roleTags` | Role tags in chat | `false` | `true` / `false` | Puts a staff member's role name before their name in local chat, `/me`, broadcasts, chat rooms, guild chat and staff chat (`[Admin] Berlyn says "hi"`). IMs keep the plain name; players get no tag. |
| `news` | Login news | `Welcome to First Star Online!` | Up to `1000` chars | Printed on login once per browser whenever the text changes; empty disables. |

### Items

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `lootDecay` | Loot lasts | `30m` | `1m`–`7d` | How long before monster loot disappears from the ground (player drops and `/drop` items never decay). |
| `deathDrops` | Drops on death | `wanted` | `off`, `wanted`, `pvp`, `everyone` | Whose deaths drop some gold or one random bag item (never crystals) where they died. `off`: nobody. `wanted` (Wanted only): characters wanted for murder. `pvp` (Killed by a player): anyone another player kills, and wanted characters however they die. `everyone`: every death outside an arena, as in 1.6. Faction heads on PvP maps drop regardless, and a role with the drop-on-every-death permission (administrators) always drops. Replaces the old on/off `dropOnDeath`; a server that had it off is set to `off`. |
| `deathDropKind` | What drops on death | `either` | `either`, `gold`, `items` | `either` (Gold or an item): a coin toss when the character carries gold, as in 1.6. `gold`: gold only; a death without gold drops nothing. `items`: bag items only. |
| `deathDropGoldCap` | Most gold dropped on death | `200` | `0`–`1000000000` | The most gold a death drops unless the character is wanted (a wanted character can drop up to all they carry). `0` means no cap. |
| `deathDropMinLevel` | No drops below level | `0` | `0`–`100000` | Characters below this level drop nothing on death unless wanted, so new players keep their first gear. `0` protects no one. |
| `assassinPrizes` | Assassin prizes | `Long Sword`, `1000 Gold`, `500 Gold`, `Knife` | 4 lines, each <= 60 chars (item, `<n> Gold`, or empty) | 1st–4th place prizes when an Assassin's Game ends. |

### Moderation

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `jailSentence` | Jail sentence | `10m` | `1m`–`3650d` (10 years) | Length of a `/jail` without a duration. Sentences run in real time, offline too, then send the prisoner to their respawn point. |
| `muteLength` | Mute length | `10m` | `1m`–`3650d` (10 years) | Length of a `/mute` without a duration. Mutes run in real time, offline too. |
| `banLength` | Ban length | `0` (permanent) | `0`–`3650d` | Length of a `/ban` without a duration (`0` is permanent until `/unban`). |
| `ipBanLength` | IP ban length | `30d` | `0`–`3650d` | Length of a `/banip` without a duration (`0` is permanent). Addresses are reassigned, so permanent IP bans can catch someone else later. |
| `addressHistory` | Keep login addresses | `180d` | `0`–`3650d` | How long an account's login addresses are kept after their last use, for `/banip <name>` and `/banlist` (`0` keeps them forever). |

### Logins

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `loginFailsPerIp` | Failed logins per address | `20` | `0`–`1000` | Failed logins per address (IPv6 `/64`) in 5 minutes before refusal (`0` disables). A role with the login-limit bypass (moderators and administrators by default) still gets one try per account from an address over the limit, so an operator behind a shared address can log in, but a wrong password ends that too until the window passes. |
| `loginFailsPerAccount` | Failed logins per account | `5` | `0`–`1000` | Wrong passwords per address+account pair in 5 minutes before refusal (`0` disables; no role exemption). |
| `createsPerIp` | New characters per address | `3` | `0`–`1000` | Character creations per address (IPv6 `/64`) per hour (`0` disables; no role exemption). |

### Logs

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `chatLogRetention` | Keep chat log | `90d` | `0`–`3650d` | How long the chat log keeps each line, for `/chatlog` and `admin:chatlog` (`0` keeps them forever). See [The chat log](#the-chat-log). |
| `activityLogRetention` | Keep activity log | `180d` | `0`–`3650d` | How long the activity log keeps each player action, for the Control Panel's Activity Log (`0` keeps them forever). See [The activity log](#the-activity-log). |
| `auditLogRetention` | Keep audit log | `0` (forever) | `0`–`3650d` | How long the audit log keeps each staff action, for `admin:audit` (`0` keeps them forever). Bans, jails and pardons are kept regardless. See [Reading the audit log](#reading-the-audit-log). |

## World Editor and NPC Editor

Both editors are accessed from **Admin → World Editor** or **Admin → NPC Editor** and remove your character from the map until you choose **Admin → Return To Game**.

### World Editor

- **Coordinates and loading:** Enter `X` and `Y` or click the edge map arrows, then click **LOAD** to open a map (or a blank template if none exists yet).
- **Layers and brushes:** Choose layers `1` (floor), `2` (transparent objects), `3` (over characters), or `S` (shadow), and paint with **Pencil** (1 tile), **Bucket** (fill layer), or **Fat brush** (plus shape).
- **Palette:** Pages `1`–`10` hold original tiles; added tiles fill page `10` slots `50`–`60` first, then pages `11+` (see [Modding](modding.md#tiles-tilesjson)).
- **Carpentry.** In new and existing worlds, choose **Carpentry Bench** from the World Editor’s **Items** list, place it next to a tile players can stand on, and save the map. Players must face the Carpentry Bench to build furniture.
- **Airship landing pads:** Paint `J2` on **layer 1** on any row and leave the faced tile free of blocking items. See [Vehicles guide](guides/vehicles.md).
- **Water for Boats and Battleships:** A ship is built on, and sails over, layer-1 sea tiles (`W1`, `N1`, `D2`, `I2`, `V2`); the shoreline art on layer 2 does not block it. Its rider gets off onto any land tile a walker could step onto, so no dock is needed. Ships cross a map edge only onto water. No stock NPC sells the Boat or Battleship Deed (the Airship Deed is a quest reward), so add them to a shop or give them out if your players should have ships.
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
