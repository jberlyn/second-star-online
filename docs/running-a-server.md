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
      # The world's starting content, read only when the database is first created:
      # classic (the default) or minimal. See "Choosing your starting content".
      # SSO_CONTENT: classic
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

### Choosing your starting content

A new world starts from one of the two content packs shipped in each release:

- **Classic** (the default): 1.6's items, monsters, NPCs, spells, skills and classes, its art and sounds, and its 27 distributed maps (the Test map at `x1000y992`, where characters start, Brinkston, the Meldein Sea and the Jail at `x0y0`). This is the game as SSO plays it; you do not need to set anything.
- **Minimal**: the blank pack you build your own game from. It holds the least a world needs to run and nothing else: the start class Novice, one skill (Fighting), the currency Gold, the plain grass tile, a bare body with one head for each of its two sexes, and two all-grass maps: the start at `x0y0` (start and fallback points at `1, 1`) and a jail at `x50y50` (`1, 1`). There are no monsters, NPCs, spells, shops or quests until you add them on the [Content page](#the-content-page). Its few pictures are copies of 1.6's. It is the supported way to start a game of your own: every picture, body, effect, tile and sound you need is uploaded on the Content page (see [Art and sounds](#art-and-sounds) and [Sounds](#sounds)).

Set `SSO_CONTENT` to `minimal` (or `classic`) before the **first** start:

```yaml
    environment:
      SSO_CONTENT: minimal
```

**The choice is read only when the server creates its database.** That first start seeds the world from the chosen pack: the pack itself, its maps, and its start, fallback and jail points. From then on the maps and points are your world's (edit them in the World Editor and Server Settings), and `SSO_CONTENT` does nothing, whatever it is set to later, so restarting with another value can never wipe a world people play in. The server says which world it created (`content: created a new world with the minimal pack`), and on a later start it says when the variable disagrees with the world (`SSO_CONTENT=classic ignored: this world was created with minimal …`).

To choose again, start from a new database: with Compose, a new volume (`docker compose down -v` deletes the `sso-data` volume, **and the world in it**, so back it up first if you may want it); from source, another `SSO_DB` file. While a world is being created, an unknown value refuses to start and names the choices; on an established world it is only logged and ignored, like any other value. If that first start is interrupted (the container is stopped mid-way), the next start finishes creating the world with the pack first chosen.

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

On first start against a new SQLite file, the server runs database migrations automatically and creates the world from the chosen pack. A Classic world is 1.6's 27 distributed maps: the Test map at x1000y992 (with its Slime, a little gold, Apples and a Knife), Brinkston, the Meldein Sea, the Jail at x0y0 and the rest, plus the seed NPC files. As in 1.6, the church bell names x999y999, which does not exist until you build it, and none of 1.6's exits works yet: an exit needs an `Exit` or `Exit2` item on its map, which the archive does not keep. Nine lead to shipped maps (the Test map's to Brinkston, for one) and work once you place the Exit item in the World Editor; the rest lead to maps 1.6 never shipped, which `bun run maps:check` lists. Existing databases keep their saved maps when upgraded (servers created before Classic carried 1.6's maps keep SSO's Willowbrook Wilds, and get its Jail and Church of the Bells where those coordinates are empty). The jail and the bell's map are the Server Settings **Jail** point and **Church bell map** (World), so either can move to a map of your own. Build further maps in-game with the World Editor.

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
| `SSO_CONTENT` | `classic` | The content pack a **new** world starts from: `classic` or `minimal`. Read only when the server creates its database, where any other value refuses startup; ignored (and logged) afterwards (see [Choosing your starting content](#choosing-your-starting-content)). |
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
- **`administrator`** (Admin, rank 2): every permission. Full command access, staff chat, the Admin Chat room, the Control Panel with Server Settings and its World and NPCs pages (including the roles), and Assassin's Game controls. An administrator can ban, jail or mute anyone but themselves and change or lift any ban, IP ban, jail or mute, and IP bans never stop an administrator's login. Administrators take no damage of any kind, never get hungry, cannot be pushed, stay off the high scores, drop on every death and skip the chat and broadcast waits.

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

Administrators open **Admin → Control Panel** from the top menu bar. The game gives way to a full-page dashboard; **Return to Game** at the top brings you back where you stood. While you are in the Control Panel you stay online but are off the map, as in the World Editor: other players see you leave, and trades, shops and held actions are cancelled. The header also opens Friends, Who's Online, Send IM (with a count of IMs that came in), the chat rooms and Player Settings as floating windows over the dashboard, and Return To Title Screen logs out. The sidebar lists the admin pages your role may use, with no classic tools left: the World and NPC editors are its World and NPCs pages.

The Control Panel shows for a role with a permission that has a page there: today **Server Settings, roles and staff**, **Control Panel: look up characters (the player hub)** (the [Characters](#the-player-hub) page), **Control Panel: read the player activity log** (the [Activity Log](#the-activity-log) page) and **Control Panel: edit items, monsters and NPCs** (the [Content](#the-content-page), [Balance](#the-balance-page), [Items](#the-items-page) and [Monsters](#the-monsters-page) pages), **NPC Editor** (the [NPCs](#the-npcs-page) page) and **World Editor** (the [World](#the-world-page) page). **Control Panel: edit characters** adds the hub's [Edit tab](#editing-a-character).

### The content page

Everything the game knows about items, monsters, NPCs, spells, rules and texts comes from the **installed packs** plus **your changes**. Every server runs one of the packs shipped inside each release, read from it and never copied into your database: the **Classic pack** (1.6's content, the default), so a server with no changes plays exactly as before, or the **Minimal pack**, for a world [created with it](#choosing-your-starting-content). **Control Panel → Content** (permission **Control Panel: edit items, monsters and NPCs**) lists:

- **Installed packs**, with the version each runs at. A release that brings a newer Classic says so here once.
- **Pack updates:** when a newer pack version changes a row you have customised, your version stays live and the row is listed with what the pack changed and how yours differs. **Use Classic's version** replaces yours (as a publish you can undo); **Keep mine** stops the notice. Rows you never changed take the new version on their own. An item definition (dataset `items`, part `definitions`: one item's rules in one record, see [Item definitions](modding.md#item-definitions)) is noticed when the pack changes what its own rules play for that item: the notice says your definition still plays, and **Use Classic's version** drops the definition so the item plays the pack's rules again.
- **Draft:** pending changes, shared by every admin and tagged with who made them. Before publishing, the whole store is checked: each dataset against its schema, then the key and name rules (a new item's key is the name it was created with and never changes; display names are unique; a key may not contain `#`, start with a number and a space, or end in `+N`), then the skills (characters save each skill under its key, so skills may be added, removed or reordered and a removed skill's values wait for it to return, but no two skills may read the same with case and spaces ignored), then references between rows (a deed, quest, quest pool, crafting recipe, gathering find, editor list, NPC shop or drop, or summon naming something that no longer exists, or a medal, title, platform, book, tool, weapon, promotion, start class or binding naming a skill that does not). NPC files are checked as they play: where the NPC Editor has saved an NPC, its save is what is checked, so removing an item a saved shop still sells is refused. **Publish** makes the draft live for every player at once, without a restart; it is refused if another admin changed the draft since you last looked.
- **Rows:** pick a dataset and field to list its rows (an item, a monster, an NPC file, or a whole field such as a text table), with whether each is as the pack has it, changed, added or removed. Opening a row shows the pack's version and an editor for its JSON. **Save to draft**, **Remove** (keyed rows) and **Back to the pack's version** all go into the draft. To rename an item or monster, set its `"display"`; players then see the new name everywhere while their copies keep working. Admin `/drop`, NPC file lines, quest rows and the quest pools accept a display name and store the key. `quests/current` only seeds a new world: once a world has started it keeps its own quests (each finished quest rolls the next from `quests/pools`), so edit the pools to change what NPCs ask for. An NPC file saved here gets the NPC Editor's checks; if the NPC Editor has saved that NPC, its save is what plays and the row says so. The collision rects are built from the art and cannot be changed here.
- **Where it is used:** opening an item or a monster shows where it is used, for example "Held by 14 characters · on the ground on 3 maps · named in 5 places in content": each row that names it (click to open it), and each place in the world, with the characters who hold copies (click a name to open their player hub).
- **Removing an item or a monster** asks what to clean up, and puts the cleanup into the draft with the removal:
  - **References in content** (shop and drop lines in NPC files, recipes, gathering finds, quest rows, quest chest refills, Oraku's orb and reward, faction heads, deeds, editor lists; a deed's row always goes with its item; mining's crystal colours and the Assassin's prize line are listed for you to edit by hand): **remove the entries that name it** (the default: the recipe, shop line, drop or list entry goes), **replace it with another**, or **leave them for me to fix**. A few entries cannot go without breaking their row (a station's one tool, an entry in a quest pool's or carpentry's roll table, one of mining's three ores, the last entry of a list that needs one): they can only be replaced, and the draft's checks name them until they are. NPCs the NPC Editor has saved get the same cleanup as their rows, when the draft is published, and the text each had is kept in its versions.
  - **Copies players hold** (bags, gear, vaults, containers, the ground): **retire it** (the default: copies stay and keep working, but no more can be made: no content may name it, `/drop` refuses it, and the character editor can move its copies but not add any; an item nobody holds when the draft is published is simply removed, and removing an item that is already retired takes it out once nobody holds a copy), **purge every copy** (asked twice; you can give gold back for each copy a character held), or **replace every copy** with another item. World quest lines that want or give it are rolled again, or name the replacement. A storage item (a Crate, a Cabinet) can only be replaced with another storage item, and what each copy holds goes with it, under a new storage number of its own, wherever the copy is (a bag, a vault, the ground or another container); purging one deletes what it holds too. Stock on sale in player shops counts as copies: it stays when retired (players can still buy and sell copies they already have, there as in a trade, but no NPC shop sells it), goes when purged, and becomes the replacement when replaced; a player shop never stops a publish. A pile of crystals replaced by an item that is not crystals becomes a pile of that many. Removing a colour of crystals (Blue Crystal) takes every copy of it, piles included, and its entry on the player-shop list.
  - **A monster or NPC:** its roster slots are cleared or spawn another monster; live ones despawn when published or stay until they die; its own NPC file goes with it or stays, unattached. Quest lines that name an NPC are listed for you to look at.

  The draft lists each removal and what publishing it will do ("This draft removes 2 items still used in 5 places"). Copies, spawns and live monsters change only when the draft is published, in the same step as the content (a failure part-way changes nothing, and players are told nothing until the publish is through), and the publish history keeps a line for each thing done. **Undoing a publish brings removed content back, but not purged or replaced copies, cleared spawns or despawned monsters.** Changing an item's wear rules leaves it on anyone already wearing it; once taken off, it goes back on only if they meet the new rules. Changing a monster's HP applies to new spawns (live ones keep the HP they have); its attack and defence apply at once.
- **Problems:** **Look for problems** lists references nothing resolves: stored items no catalogue has (left by a database edit or an older server), roster slots naming no monster, and content's own. Stock Classic has none. A tool matched by part of its name (fishing's `Fishing`, the `Axe`) counts while any item's name contains it, and a treasure such as `300 Gold` is a pile of gold, not an item. None of them stops the game: an unknown item shows by its name with no picture and does nothing, and an unknown monster spawns as a stand-in. The server also prints the world's at start.
- **Publish history:** each publish with its rows. **Undo** takes a whole publish back, and is refused, naming the rows, if a later publish touched any of them (even to put one back) or if the result would not pass the same checks as a publish (a later publish may refer to something this one added). Every publish, undo and pack-update answer is also tried out first: if any part of the game cannot read the result (a text a rule needs has gone, say), it is refused with the reason and nothing changes.

Publishes, undos and pack-update answers are in the audit log. Connected players pick up a publish within a moment; a player who was away picks it up at their next login. A browser that cannot fetch the new content tries again a few times before carrying on, and keeps trying in the background until it has it.

**Upgrading to the content store:** back up your database first: migrations only run forward. The upgrade records your server as having the Classic pack installed; your world, characters and bags are unchanged. The server also records which index each skill is saved at in characters; a later release or imported pack that would move or drop a skill stops the server at start with the skills it would move, instead of shifting everyone's training onto other skills.

**Upgrading from 1.13.0 or earlier (Classic v1.0.1):** back up your database first. Crystals are now named in the singular, like every other item ("Blue Crystal", not "Blue Crystals"), and the Classic pack drops the items nobody could get or that had no picture. The upgrade renames every saved crystal (bags, worn gear, vaults, containers, the ground, NPC files and their versions, shop ledgers, quest lines, map versions, your content changes and draft) and merges two stacks of one colour into one. Copies of 1.6's broken "Damaged Sword, Knight's" become "Damaged Sword, Knight", which repairs into the same sword. Damaged Armor, the Scimitar, the Hammer, the Laser Sword, the Green Laser Sword and the Magic Shield item are retired: copies players hold stay and work, but no shop, chest, recipe or quest makes more. A stored quest line that asks for or gives an item the catalogue no longer has, or has retired (Dantan's Water Orb), is rolled again at start. If you typed the old plural into your own NPC files or content, the upgrade rewrites the usual spellings; any other spelling still works and picks up singular.

**Upgrading from 1.13.0 or earlier:** **Admin → Server Settings** moved into the Control Panel, and the floating Server Settings window is gone. A role that held every permission gets the three new Control Panel permissions, so it still holds every permission; other roles are left as they are.

#### Art and sounds

The Content page's **Art and sounds** section uploads PNG pictures and WAV, MP3 or OGG sounds (older Safari versions cannot play OGG). Each file is checked as it arrives (a real PNG of at most 2048×2048 pixels, or a real sound, at most 5 MB) and stored in the `<database name>-content/` folder beside the database (`sso-content/` for `sso.sqlite`) under the SHA-256 hash of its bytes, which the table shows with a preview. A stored file does nothing until an **art row** in the draft names it and the draft is published; then every player sees or hears it at once, without a restart or a new client, and undoing the publish takes it back. Rows live under the `art` dataset, one field per kind:

| Field | A row | Notes |
|---|---|---|
| `items` | `{"name": "Frost Sword", "file": "<hash>", "regX": 8, "regY": 8}` | An item's picture in the bag, the equipment boxes and on the ground: `name` is the item's key or its `sprite`. At most 512×512; trimmed to its visible pixels. The [Picture panel](#item-pictures) writes these for you. |
| `paperdoll` | `{"name": "Frost Sword", "frames": {"f1-s": {"file": "<hash>"}, …}}` | A worn layer, by the worn item's key after `paperdoll.aliases` (or an engine layer: `DEFBOD`, `Bare Feet`, `Head<n>`). Frames `f1`-`f4` with a facing `n`, `e`, `s` or `w` (no `f4-s`: attacking south shows `f3-s`), each at most 46×45 and drawn from the character's top-left. The [Worn layers](#worn-layers) panels write these for you. |
| `bodies` | `{"name": "1000", "frames": {"f1-n": {"file": "<hash>", "regX": 18, "regY": 30}, …}}` | A monster or Morph body, by number: all 16 frames. Uploaded bodies are numbered from 1000; body numbers go up to 9999 everywhere. The [Bodies](#bodies) panels write these for you and pick the number. |
| `fx` | `{"name": "Frost", "frames": [{"file": "<hash>", "regX": 4, "regY": 4}, …], "trail": […]}` | A spell effect run, `Frost-1` … `Frost-n`, and its trail `xFrost-n`, as a spell's FX run names it. The [Spell effects](#spell-effects) panels write these for you. |
| `tiles` | `{"code": "Q1", "file": "<hash>"}` | A map tile, by its code: exactly 32×32, pasted at its square's top-left (it also needs its `tiles/catalogue` row). The [Tiles](#tiles) section writes these for you and picks new tiles' codes. |
| `sounds` | `{"name": "crack", "file": "<hash>", "format": "wav"}` | A sound, played where a content row or the engine names it ([Sounds](#sounds) uploads them without JSON). |

Pictures use their own transparency; add `"transparency": "green"` for 1.6-style art drawn on pure green. A `paperdoll` or `bodies` row drawn with 1.6's mirrored back views takes `"mirrored": true`, and its north frames are flipped. A row may name a pack's picture or sound to replace it; removing the row brings the pack's back. A publish is refused while a row names a missing or misshapen file, while an uploaded worn layer lacks a frame something wearing it is drawn with, or while it takes away a picture or sound that content still uses and no pack supplies. A spell that gives a body (Morph, Nature Shift, Smoke Bomb) lasts its row's `lasts` seconds, 65 when unset, whatever the body's number. Files nothing names are removed a day after their upload, when the server starts (only from the upload folder: a pack's own files are never touched).

A pack can carry art rows and their files too (see [Pack format](modding.md#pack-format)). They count as the pack's art: your upload of the same name replaces one, and removing your upload brings the pack's back. A pack file that is missing, or whose content does not match its name, draws nothing and is listed under **Problems → In content**; it never blocks a publish.

What can be uploaded, and where:

| Kind | Where on the Content page | Shape |
|---|---|---|
| Item pictures | An item row's **Picture** panel; **Item pictures** for many at once | One PNG, at most 512×512 |
| Worn layers | A worn item's **Worn picture** panel; **Worn layers** | 15 frames at most, each within 46×45, or one 184×180 sheet |
| Monster bodies | A monster row's **Body** panel; **Bodies** | 16 frames, or one 4×4 sheet of equal cells up to 512×512 |
| Spell effects | A spell row's **Effect** panel; **Spell effects** | A run of frames (and its trail), or one strip |
| Tiles | **Tiles** | 32×32 PNGs, or tileset sheets cut into 32×32 tiles |
| Sounds | **Sounds** | WAV, MP3 or OGG, at most 5 MB |

#### Item pictures

Item pictures need no JSON. Open an item's row (dataset `items`, field `items`) and its **Picture** panel shows what it draws now, with previews in the bag, in the equipment box it is worn in and on the ground:

- **Upload a PNG** to give the item a picture of its own. The page fills in the rest: the transparency (the picture's own see-through pixels, or "pure green is see-through" when it is fully opaque and holds pure green, as 1.6's art does) and the anchor, which centres the visible pixels on the item's tile as Classic's icons sit. Drag the picture on the ground preview, or type the anchor, to move it. The ground preview draws the hit box (the box round the visible pixels) and the anchor. The panel refuses what the server would (nothing visible, larger than 512×512) and warns about a picture bigger than a bag slot (32×32) or an equipment box (35×35), one with no see-through pixels, and an edge whose every pixel is nearly invisible (fainter than 32 of 255), which still counts in the hit box. **Download a 32×32 template** gives a pure green square to paint on.
- **Use this picture** makes the item draw a picture the game already has, a pack's or an upload, by setting its `sprite`. Nothing is uploaded.
- **Save the picture to the draft** writes the item's `art/items` row, named by its key. Each change is made as a whole against the draft as it is at that moment: only the item's `sprite` and its upload change, so another admin's edit to the row is kept. An item that borrowed another picture through `sprite` stops borrowing it, so the upload is what it draws. **Remove the upload** takes the row out; a pack picture of the same name shows again.

Some views show a shared picture in place of an item's own, and the panel says so: containers in the bag (`CabinetBag`, `CrateBag` …) and once placed, crystals on the ground, maps (the `map` [behaviour](modding.md#item-behaviours)), clocks, and a player's paintings and photos. The currency's panel also offers its three ground piles, `SmallGold`, `MediumGold` and `LargeGold`, whatever the currency is called. A pile is pasted by its top-left corner, 1 px inside its tile, as 1.6 did, so draw it on the template where it should sit.

The **Item pictures** section uploads many at once: choose PNGs named after their items (`Iron Sword.png`), and each is matched to an item key, then to the name players see, ignoring case (retired items take none). Files that match nothing are listed with a box to pick their item. A file for an item that already has a picture replaces it only while its **Replaces** box is ticked (it starts ticked). **Attach to their items** puts each picture in the draft with the page's transparency and anchor. Two files for the same item wait until you pick a different item for one of them. Below, **Items without a picture** lists every item that is not retired and will have no picture once the draft is published; choose one to open its row.

An item has a picture when the art draws its `sprite`, or its key: only those can be made with `/drop` and the World Editor. Removing an item from the Content page also removes its upload, unless another item still draws it; retiring it keeps the picture, since players still hold copies.

#### Worn layers

What a character wears is drawn from **worn layers** (1.6's paperdoll), one 46×45 picture per frame pasted at the character's top-left. An item draws the layer named by its key, unless a `paperdoll.aliases` row in the item rules renames it (Classic draws the Knight's Sword as the Broad Sword, and every ring as nothing). The engine draws `DEFBOD` (the bare body), `Bare Feet` and each sex's `Head<n>` itself. The frames a layer needs depend on where it is worn:

| Worn | Frames |
|---|---|
| On the head, body, feet or hands (gloves are worn in the ring slot), and the engine's layers | 15: F1-F3 facing north, east, south and west, and F4 (attacking) facing north, east and west |
| As a weapon | 12: no F1-F3 facing north (a weapon facing north shows only when it swings) |
| In the off hand (a shield or a quiver) | 11: nothing facing east |
| In the off hand, hidden facing north (the `hiddenFacingNorth` behaviour, Classic's Torch) | 7: south and west only |

A worn item's row has a **Worn picture** panel, and the **Worn layers** section lists every layer the content draws, with who draws it and whether its frames come from your upload or a pack; choose one to open its panel. The panel says which layer the item draws, through which alias rule, and which other items share it (an upload repaints them all). When only exact alias rows name the item and taking them out changes no other item's layer, **Give it a layer of its own** takes them out of the draft's item rules; anything else (a rule that matches other items too, such as a name containing "Ring", or an upgraded copy like `Knight's Sword +1`, which draws its base item's layer) is changed by hand.

- **Upload** separate PNGs named like `Moonblade-f1-e.png` (added to the frames the layer already has), or one 184×180 sheet: four rows, north, east, south and west, of four frames, F1 to F4, each a 46×45 cell. The server cuts a sheet into frames and leaves out blank cells and F4-S; a sheet replaces every frame. **Download a guide sheet** gives the bare character in each frame the layer needs, with the frames the game never draws greyed out: draw on a layer of your own above it and export only that layer.
- The preview walks and attacks the character facing all four ways, with the layer stacked where the game stacks it (a weapon facing west goes behind the body), shows it as the inventory's paperdoll does, and lays out every frame: a frame the layer's wearers need and it lacks is outlined red, and one the game never draws is hatched grey. The panel refuses a frame larger than 46×45 and warns about one that shows nothing or is never drawn.
- **North frames are drawn 1.6-style** starts ticked. 1.6 drew back views as if seen from the front (from behind, the weapon looks to be in the left hand), and old 1.6 art is drawn that way, so the game flips each north frame about the body's centre line when it builds the art. Untick it for back views drawn the right way round. A flipped north frame must leave its last column (column 45) empty.
- **Save the frames to the draft** writes the layer's `art/paperdoll` row with every frame it keeps (a frame the layer's wearers never draw, and F4-S, is left out); **Remove the upload** takes the row out, and a pack's layer of the same name shows again. A draft may hold a set that is not finished yet, but publishing waits until it has every frame its wearers need.

The section's bulk upload takes many layers at once: frames named `<layer>-f1-e.png` and sheets named `<layer>.png`, where the name is an item's key, the name players see (each standing for the layer the item draws) or a layer's own name, ignoring case. Files that match nothing are listed with a box to pick their layer (a new name starts a layer nothing wears yet); a layer that already has frames is replaced only while its **Replaces** box is ticked. The list checks every frame before anything is attached. Frames added to an upload keep its transparency and its 1.6-style setting; a sheet replaces them with its own and the section's box. Removing an item also removes its own worn layer, unless something else still draws it; retiring it keeps the layer.

#### Bodies

A monster (and a Morph, the tree a Nature Shift makes, a rider of each vehicle) is drawn from a **body**, named by its number: 16 frames, walking F1 to F3 and attacking F4, facing north, east, south and west. Monsters only walk; F4 shows when a player morphed into the body attacks. A frame stands where a player stands: its middle on the tile's middle and its bottom 5 px below the tile, so a 46×45 frame lines up exactly with a player's character. What shows of each frame is its hit box.

A monster's row has a **Body** panel, and the **Bodies** section lists every body the content draws, with who draws it and whether its frames come from your upload or a pack; choose one to open its panel, or **New body** to make one. Operators never type a body number: the server gives a new body the first free number from 1000 when it is saved (with a clear message once 1000 to 9999 are all taken).

- **Upload** separate PNGs named like `Orc-f1-e.png`, or one sheet: four rows, north, east, south and west, of four frames, F1 to F4, every cell the same size (up to 512×512), so the sheet's width and height divide by 4. The server cuts a sheet into its 16 frames. **Download a guide sheet** gives 46×45 cells with a player and their tile drawn faintly.
- The preview walks and attacks the body facing all four ways on its tile with the hit box drawn, stands it beside a player for scale, and lays out every frame. Drag the body beside the player (or type **Move right** and **Move down**) to move every frame together. A body needs all 16 frames; the panel refuses a frame larger than 512×512 or one that shows nothing, and warns about a nearly invisible edge (it is still clickable).
- **North frames are drawn 1.6-style** starts ticked, as for worn layers: the game flips each north frame about the body's centre line (taken from F2 facing north). Untick it for back views drawn the right way round.
- On a monster's row: when the monster's body is your upload and nothing else draws it, saving replaces it. When its body is a pack's, or shared with other monsters, **Save as a new body for** the monster makes a new body and gives it to the monster in the same change, and **Repaint body N for all who draw it** replaces that body's picture for everyone (over a pack's body, the pack's comes back when the upload is removed). **Or give it another body** picks any body there is, with a preview. Before either repaint, the panel names everyone who draws the body. Replacing a monster's own body is refused if another admin has given that body to something else meanwhile. **Remove the upload** takes a body's upload out; a publish is refused while content draws a body that no pack or upload supplies (a gap the published content already had, such as a pack's monster with no art, is left alone). The server checks every frame again before saving it (a stored PNG, at most 512×512, with something showing), and players already on a map see a monster's new body as soon as the publish goes live.

The section's bulk upload takes many bodies at once: sheets named `<monster>.png` and frames named `<monster>-f1-e.png`, where the name is a monster's key or the name players see (ignoring case), make that monster a new body, or replace its own upload while the box is ticked; files named after a body's number (`55.png`, `55-f1-e.png`) repaint that body. The list checks every frame before anything is attached. Removing a monster also removes its uploaded body, unless something else still draws it.

#### Spell effects

A spell's effect is drawn from **effect runs**, named by their member: `Crush` draws `Crush-1` … `Crush-30`. A run steps two frames a tick and the screen draws once a tick, as in 1.6, so players see frames 1, 3, 5 … (20 a second); every frame still counts for hits. How many frames show is set by the run's row in the spell's `fx` list: a run placed at the click shows frames 1 to its `lastFrame`, then goes; a projectile (a row with `projectile`) cycles frames 1 to 3 as it flies. Firebolt, Hold and Smoke Bomb's effects are followed by a **trail**, `xFirebolt-1` …, for as many frames as the run shows (up to 16, 7 and 15). The engine draws a few runs of its own with fixed lengths: fishing's splash (`Fishing`, 13), smithing's sparks (`BSmith`, 13), the slot machine's (52) and gathering's sprinkle (5), an arrow in flight (`<colour> Arrows<L|R|U|D>`, 1) and the Battleship's shot (`CannonballShot<L|R|U|D>`, 4). What shows of each frame is its hit box, so a spell's frames are also where it can hit. Each spell's effect acts on one set frame of its run, so a run must show at least that many: heals, buffs, Portal, Morph, Nature Shift, Smoke Bomb, Hold, Firesword, Inxition, Create Food, Diminish Hunger, Magic Shield and Argon's Fist act on frame 3, Radar on 5, Dispel Illusions on 8, Stone Skin on 9, Firebolt on 12, Meteor on 13 and 19, Crush and Splash on 18, and the projectiles (Fireball, Bolt, Wind Wave) on frame 1.

A spell's row has an **Effect** panel (with a choice of run when the spell has several, such as Fireball's four directions), and the **Spell effects** section lists every run the content and the engine draw, with who draws it, how many frames show, and whether they come from your upload or a pack; choose one to open its panel, or **New effect** to name and upload a run no spell uses yet.

- **Upload** separate PNGs named like `Crush-1.png` (a trail's like `xCrush-1.png`), or one strip of equal cells, each up to 512×512, read left to right and top to bottom: the run's frames on its first rows, wrapping onto as many rows as it needs, then the trail's frames starting on the row after. An upload may be at most 2048 px a side, so a long run wraps (21 cells of 96 px fit across). The page guesses the layout from square cells and the frames the run shows; type **Frames across**, **Rows of the run** and **Rows of its trail** and **Cut the strip again** for any other. Trailing blank cells are dropped, so a trail can be shorter than its run, but a blank frame inside a row is refused. Frames named by number replace only themselves (in a run's panel, `x<run>-<n>.png` is always its trail's frame); a set that starts at frame 1 replaces the whole run. **Download a guide sheet** gives a strip in that layout (96 px cells, up to 21 across), with the target tile, a player standing on it faintly and the effect's point marked in each cell.
- Every frame of a run is anchored at the same spot. By default the first frame's middle lands where the run it behaves as (its row's `effect`) lands, or on the target tile's middle when there is no such art. Drag the frame beside the player (or type **Move right** and **Move down**) to move them all. The preview plays the run as the game shows it (every other frame, 20 a second) beside a player, flying along its axis when it is a projectile, with each frame's hit box; below, every frame is laid out, with a frame that is wrong outlined red and one that is never shown greyed out.
- From a spell's row, **Spell plays all N frames** (ticked) sets the run's row to show every uploaded frame (`lastFrame` and `frames`) in the same change; the panel says this also changes how long the effect shows, and can hit. It is refused below the frame the spell's effect acts on, and so is a publish that leaves a spell's `lastFrame` below it. Unticked, the upload needs at least as many frames as the row shows, and frames past them are never shown. A projectile still cycles frames 1 to 3.
- **Save the frames to the draft** writes the run's `art/fx` row (with its trail, if one was uploaded; without one, a pack's trail of the same name keeps showing). Before a save that repaints a run something draws, the panel names everyone who draws it, and the save is refused if that has changed meanwhile, or if another admin saved the run's upload since the panel opened (reopen it to see theirs). The server checks every frame again before saving it (a stored PNG, at most 512×512, with something showing). **Remove the upload** takes the row out; a pack's run of the same name shows again. An uploaded run, and an uploaded trail, is the whole of it: a pack's frames of the same name after its last are neither drawn nor hit.
- A publish is refused while a spell shows frames that no upload or pack has (a new spell whose run has no art yet, or an upload with fewer frames than its row now shows; a pack's frames never fill in after an upload's last). A gap the published content already had is left alone. An effect already playing when a publish shortens its run stops at the new last frame.

The section's bulk upload takes many runs at once: strips named `<run>.png` (square cells only) and frames named `<run>-1.png`, with the trail's `x<run>-1.png` beside them, matched to runs by name, ignoring case; files that match nothing are listed with a box to pick their run. For a spell's run, **spell … plays every frame** starts ticked. The list checks every frame before anything is attached. When a spell's removal is published, the uploads of the runs only it drew go with it (discarding the removal leaves them as they were). Files chosen in the list and not yet attached count as unsaved changes, and **Discard** stops a batch still attaching.

#### Tiles

A map is painted with **tiles**, each a 32×32 picture pasted at its square's top-left on any of the map's layers and named by a code. The **Tiles** section lists every tile in the catalogue with its picture, code and name; type in **Find a tile** to narrow it by code or name, and choose one to open its panel:

- The panel says where its picture comes from (your upload or a pack's), where it is used (every map that has it, and the content rows that name it: the blank map's tiles, gathering nodes, fishing water, farming, regrowth, houses, the newspaper stand), and previews it in a 3×3 patch of itself and between two squares of the map's ground tile, with a player standing on it when it is walkable.
- **Name** is what the playfield's hover tip calls it on layer 2; leave it empty for ground and scenery, so most of the map shows no tip. **Walkable** puts it on the walk list (players on foot can stand on it), and the flags give it the meanings in [tile flags](modding.md#tile-flags-and-defaults). **Save changes** puts them in the draft; once published, the server's walk checks, the maps players are on and their clients use the new rules at once.
- **New picture** takes a 32×32 PNG (the panel refuses any other size, or one that shows nothing with its transparency, before it uploads); **Save the picture** repaints the tile everywhere it is used, as the panel lists. Over a pack's tile, **Take the upload out** brings the pack's picture back. A save or a removal is refused if another admin changed the tile since the panel opened (reopen it to see theirs); a panel you have not touched catches up by itself. A publish is refused while any tile picture shows nothing, however it was written.
- **Take the tile out of the catalogue** works only for a tile no map and no content row uses; the panel names what still does. Its walkable row and upload go with it when the draft is published (discarding the change keeps them; a tile added and taken out before it was ever published leaves nothing behind), and a publish is refused while a map or content row still has a tile the draft takes out. The Content page's checks show that before you publish, and the same check refuses an **Undo**, or taking a pack's version of the catalogue, that would take out a tile a map now uses. A code is never given out again once a publish has had it, even after an undo. A tile added and taken out before it was ever published leaves the draft as it was. Classic's catalogue also lists a few engine fixtures by longer names (`CHURCH`, `BTileX`): they can be named and flagged, but not made walkable or given a picture.

**Add tiles** makes new tiles from PNGs. A file may be a single 32×32 tile or a tileset whose sides are multiples of 32 (at most 2048): every square that shows something becomes a tile of its own (at most 512 a file), and blank squares are left out. The page checks each file's size before it uploads it, guesses its transparency (its own, or 1.6's pure green), and lists every tile it found with a box to leave it out, a name (empty by default) and whether it is walkable (from **New tiles are walkable**). A one-tile file named after an existing tile's code or name (`S3.png`, `Tree.png`) repaints that tile instead; a name several tiles share matches none of them (name the file after the code), and two files for the same tile wait until you untick one. **Download a 32×32 template** gives one tile of pure green. **Add the tiles** puts them in the draft: the server gives each new tile a code, two capital letters or digits that no pack, content row, upload or map uses (so a code left on a map after its tile was taken out never comes back as another tile), and adds its catalogue, walkable and picture rows in the same change. Codes never change. A big tileset goes in as several changes, each small enough for one message; lines that were not saved stay in the list with the reason, to try again. A publish is refused while the catalogue has a new tile no pack or upload draws.

New tiles have no `member`; the World page's palette lists them with Classic's, in catalogue order (find them by code or name). A publish redraws the open palette and the maps on screen with the new tiles, with no reload.

#### Sounds

The **Sounds** section lists every sound the world plays: the ones content rows name (spell runs, gathering's hit and success sounds, weapon swings, the casino) and the ones the engine plays by name (a hit, a kill, the shop's cash, the slot machine, the blackjack cards, a cannon shot, fishing's splash, smithing, mixing and building, the church bell, a class promotion). Each line says where the sound comes from (your upload, a pack's, or **Missing**, which plays nothing), who plays it, and has **Play**. Type in **Find a sound** to narrow it by name or by who plays it. The game frame's own clicks (`Clicksound`, `Clicksound2`) are the engine's: they are not listed, and no sound may take their names.

- Open a sound to hear it as the draft would publish it (and the pack's, while your upload replaces it). **New file** takes a WAV, MP3 or OGG of at most 5 MB; the page checks its type, its size and that the browser can play it before uploading it, and the server checks its opening bytes again. **Save the file** puts it in the draft, replacing the sound for everyone the panel lists. **Take the upload out** brings a pack's sound back; it is refused when no pack has the sound and something plays it, since that would leave it silent. A save or a removal is refused if another admin changed the sound since the panel opened (open it again to hear theirs).
- **A new sound** takes the name content will play it by (case is ignored, so `Boom` and `boom` are one sound) and opens its panel to give it a file. Name it in a content row (a spell run's `sounds`, a gathering node's `hitSound`, …) to use it.
- **Add sounds** uploads many files at once: a file named like a listed sound (`fireballs.wav`) replaces it, any other name makes a new sound under that name, which you can change before adding. Two files for the same sound wait until you untick one. Each line keeps the upload it saw when its file was read, so one another admin replaced meanwhile is refused, not overwritten; lines that were not saved stay, with the reason, to try again.

A publish is refused while content newly plays a sound nothing supplies (no pack has it and no upload will), and while it takes away an upload something still plays with no pack sound behind it. What already played a sound without a file is not held up by it (a Minimal world has none of the engine's sounds), but anything newly set to play it is: adding Classic's slot machine to a Minimal world asks for its `SlotMachine` and `cash` sounds first. The same checks refuse an **Undo** or taking a pack's version that would leave something silent. Players online load the new sounds with the publish: a replaced sound plays its new file from then on and never its old one (it is silent while the new file decodes, or if their browser cannot play it), and a sound already playing finishes. Older Safari cannot play OGG, so WAV or MP3 reach every player.

### The balance page

**Control Panel → Balance** (permission **Control Panel: edit items, monsters and NPCs**) edits the game's global numbers, the ones that are not one item's or one monster's. **Find** at the top narrows the page to the rows whose names hold every word typed ("cannon", "parry", "hunger"). It has eight cards:

- **Spell amounts:** what each spell effect deals or heals (Firebolt, Fireball, Bolt, Meteor, Splash, Crush, Wind Wave, Arrows, Minor Heal and Major Heal), on a monster, on a species the effect heals, on an undead monster (the heals) and on a player. An amount is a fixed part, plus the caster's spell power times a multiple (`× power`, 0 for none), plus `random(n)`, a roll of 1 to n (0 rolls nothing): 1.6's Firebolt on a monster, `6 + P + random(3)`, is 6, 1 and 3. Beside each amount the page previews its range at powers 1, 10 and 50 as you type. A species' amount when the effect heals it may be left empty, and it is then healed by the amount on a monster. **Spell hits** holds Dispel Illusions' amount on a dispellable monster, the roll a monster takes from an effect it resists, and an arrow's roll when the monster's Defense leaves it under 1.
- **Buffs and cast power:** the frames Magic Shield, Stone Skin, Firesword and Hold last for each point of power, Stone Skin's defense bonus, Argon's Fist's frames (a Purple Potion's too), Diminish Hunger's hunger and the hunger it works below, Morph's roll (which picks the body), and the power of the Fire Staff's and Firesword's free fireballs. A buff set to last 0 frames does nothing at all, and Diminish Hunger adding 0 says nothing.
- **Regeneration, hunger and death:** what the regeneration counter counts up to (a faction's regeneration perk comes off it; the counter starts at 1, so regeneration acts every that − 1 frames, which the page shows: Classic's 149 is every 148 frames) and the HP and SP each period regenerates or starves; the chance of losing 1 hunger each frame, the hunger above which you regenerate and below which you starve, where you are stuffed (food and potions are refused and kept) and hunger after a death; and the HP, SP and pause a death leaves. Hunger's thresholds must stay in order: starve below regenerate, and regenerate at most stuffed. The card also shows resting in a house, which is the `houses` dataset's `restRegen` row, with a button that opens it on the Content page. The [character editor](#editing-a-character) takes hunger up to the most the game gives (a new character's, the stuffed level or the hunger after a death, whichever is highest).
- **Death drops and loot:** whose deaths drop gold or one random bag item (never crystals) where they died (Off, Wanted only, Killed by a player, or Everyone as in 1.6; a faction member killed on a PvP map drops the faction's head whatever this says, and a role with the drop-on-every-death permission always drops), whether that is gold or an item (1.6's coin toss), gold only or items only, the most gold a death drops unless the character is wanted (0 for no cap), the level below which nothing drops unless wanted, and how long monster loot stays on the ground, in seconds (player drops and `/drop` items never decay). These were Server Settings before; see [Moved from Server Settings](#moved-from-server-settings).
- **Timings:** the hit flicker (no other hit lands meanwhile), the wait after a cast, the swing cooldown with no gear that sets one (at least 1 frame), how long a hit still counts as the kill, the wait between pig grabs, how long before a give is picked up, and the wait between monster spells hitting the same players.
- **Combat rolls:** melee damage on a monster below a floor rolls `random(n)` instead, as does a hit on a player (a monster's or another player's) below its floor (each floor at least 1, so a hit always does at least 1); the base roll of a parry or block (it succeeds on a 1, before a little skill moves it onto its ladder); and the chance of 1 in N that a monster next to you attacks each frame, and that walking into a player pushes them.
- **Monsters:** how often a map's monsters move and spawn, by the players on the map. Both rolls are made twice each frame for each player on the map (at most 15 players roll): a slot is picked to move by a roll of 1 to n (a monster moves when the roll lands on its slot, 1 to 4, so a larger n moves monsters less often; n is at least 4, so every slot can be picked), with n for 1, 2, … 8 or more players, and a spawn pass goes ahead with a chance of 1 in n for 1, 2, … 7 or more players. Then a walk's length (`random(n)` steps), each empty slot's chance to spawn in a pass, the slot a faction's member takes on its map (`random(n)`, at least 4; above 4 it takes none), and an NPC's spawn roll (it spawns when `random(n)` is at most the second number, so 2 in 60 of a monster's rate in 1.6). Every roll is at least 1, so each is drawn as before. The card also shows the generic stand-in (the body and defense of a name no species has, such as a player shop's shopkeeper; such a name always starts with 1 HP, whatever the row's `hp` says), which is the `monsters` dataset's `generic` row, with a button that opens it on the Content page. What each species does is on the [Monsters page](#the-monsters-page).
- **Vehicles:** each vehicle's full hull, the hull one hit takes and the hull a parked vehicle mends each minute, and the Battleship cannon's damage and reload.

A new spell that runs an effect plays its amounts; one that should hit differently from the spell it copies sets its own on its row on the Content page (`amount` in the `spells` dataset; see [balance.json](modding.md#balance-balancejson)), which replaces the effect's when that spell is cast from a spellbook (a free fireball, a monster's cast or a map hazard running the same effect keeps the effect's).

- Each value shows what plays **now**, the installed **pack**'s value ("no pack value" in a Minimal world, which plays the engine's defaults) and the **engine default**, with its limits. Times are in frames, 20 a second, with the seconds beside them. A value outside its limits, or not a whole number, can't be saved. An amount left part-filled can't be saved either: fill all three parts or none.
- **Save to the draft** puts the row in the content store's shared draft, as a row of the `balance` dataset; it is published, undone and listed like any other change, from the [Content](#the-content-page) page (the Balance page says how many balance changes the draft holds and links there). The change plays for everyone the moment it is published, with no restart: a lowered full hull lowers a rider's hull at once.
- **Reset to the pack** (or **to the engine default**, when no pack sets the value) puts the pack's value back when published; **Drop the draft's change** takes the row's change out of the draft; **Drop my edit** puts the fields back as they were.
- A row someone else changed while you were editing it says so, and saving it is refused: drop your edit to see theirs. A row being edited is never overwritten by a refresh.
- When a pack update changes a value you have changed, the row says so; answer it under **Pack updates** on the Content page.

Classic's numbers are 1.6's (and SSO's own for the hulls, the cannon and the death drops, where SSO's defaults are the old Server Settings defaults: only wanted characters drop), so a server that changes nothing plays as before. The Content page's JSON editor edits the same rows (dataset `balance`); a save or discard there is refused, as on the Balance page, when someone changed the row since it was opened. Saving a row back to the value that plays drops its draft change rather than staging an override.

#### Moved from Server Settings

The Items page of Server Settings held the death drops (`deathDrops`, `deathDropKind`, `deathDropGoldCap`, `deathDropMinLevel`) and how long monster loot lasts (`lootDecay`). They are now the Balance page's **Death drops and loot** card (the `balance` dataset's `drops` row), and the Items page says so. On the first start after the upgrade, a server whose operator changed any of them gets those values as a published change, listed on the Content page as "Moved from Server Settings: death drops and loot decay" by `system`, and the settings rows are deleted; the values it did not change take the pack's (the same defaults as before). Undoing that publish puts back what played before it: the pack's values (on a world with no pack value, such as Minimal, the engine defaults). Values equal to what already plays move nothing and are just deleted. If the server has a `drops` row of its own by then, the old settings are deleted without a publish, since the row already says what plays. An open draft of the row is rebased: a value the draft left alone takes the moved one, and a value both the draft and the move changed keeps the draft's, which the server log names ("the draft also changes balance/drops: who …"), so publishing that draft replaces the moved value; check it first. If the move cannot publish, the settings rows stay, their values keep playing, the log names why, and the next start tries again. A stored value the old setting ignored (outside its limits, or not valid) never played, so it is dropped. Scripts that wrote these keys to the `settings` table should edit the `balance` row instead.

### The items page

**Control Panel → Items** (permission **Control Panel: edit items, monsters and NPCs**) edits one item's rules in one form, instead of the rows of a dozen rule tables that match it by name. It lists every item, with **Find** (any words of its name or display name) and **Show** (weapons, armour, food, other, the items changed or added, or the retired ones); click one to open it.

- **What the form shows.** The item's slot (1.6's weapon hand is LeftHand; RightHand holds a shield), the Strength it needs, whether it takes both hands and its behaviours (a bow, a key, a sword for Firesword…); its attack rolls (a fixed part plus `random(n)`, and the Gold Axe's `+ random(Strength) / 2`: each roll draws in turn and the last stands), override rolls, skill tiers (as JSON) and the skills a kill with it trains; its armour, elemental armour, spell defence, gear bonuses, swing cooldowns and swing sound; what Use does (whether Use accepts it, its effects on HP, SP and Hunger, its eat or drink line and its refusal line, the Mysticism a spell book needs, a skill book's skill, and the menu button in place of Equip); what it does as a tool (chop, mine, dig, fish, farm or water, at a tier, and its swing ladder) and what it needs before it is equipped or used; what it breaks into, the slots it breaks in (armour in the body, head or shield slot, a weapon in the weapon hand) and the item a worn layer draws it as; and how it sits on the ground (blocks walkers, its skill platform rows, its overlay, layer, offset and hover-tip name, its Ctrl line), the lines it holds as a container and whether it gets a `#id`, and whether it is on the World Editor's item list and the list player shops accept. Each group says where its rules come from: the pack's rows that match the item (`the pack's contains "Long Sword" (row 90)`) or the item's own definition. An attack roll and a use effect show their range as you type ("Rolls 7 to 12").
- **Save to the draft** gives the item a **definition**: one record of its rules (dataset `items`, part `definitions`; see [Item definitions](modding.md#item-definitions)), which plays instead of the pack's rows that match it, in every table the form covers. A Classic item you change stops following Classic's later rule changes for it; when a Classic update changes what Classic's rules play for it, the form says so and **Answer it on the Content page** opens the notice. A form saved with nothing changed stages nothing ("already plays that"), and one saved back to what plays drops its draft change.
- **Use the pack's rules here** puts one group back to what the pack's rules play for the item (save to keep it). **Play the pack's rules again** drops the item's definition when published (on an item of your own, **Drop its definition** leaves it with no rules). **Drop the draft's changes** takes the item's definition and name changes out of the draft; **Drop my edit** puts the form back.
- **Name and pictures.** **Rename in the draft** changes the name players see (its key, which rules, maps and saved characters use, never changes). The picture and worn panels are the Content page's ([Item pictures](#item-pictures), [Worn layers](#worn-layers)): upload or pick the item's picture and its worn frames here.
- **New item** makes an item in the draft by its key and display name. **Copy the rules and picture of** another item starts it as that item plays (the safe way to make a new sword), drawing that item's picture, and drawn when worn as that item, until you upload its own. A name the game keeps for its own things (a door, a sign, a `+N` masterwork, a `#id`) or a map fixture's (`Wooden Door`, `Gold Chest`, `Open Gold Door`) is refused. A copy of a spell book teaches no spell until a spell's book is set to it, so it is made without the Mysticism; a copy of a tool that a gathering node names by name (only the Ice Hammer mines ice) works there only once it is added to that node's tools. The page says so when it makes the copy.
- **Remove or retire…** opens the item's row on the Content page, with where it is used and the removal form ([Where it is used](#the-content-page)); its definition goes with it.
- A value outside its limits can't be saved, and a refusal names the form's field (`Trains: names a skill that does not exist`). An item someone else changed while you were editing it says so, and saving it is refused: drop your edit to see theirs. The Content page's JSON editor edits the same definition rows and is refused in the same way. A form being saved is locked until the answer comes, a refresh never overwrites a form being edited, and you can't open another item with unsaved changes.

Changes are published, undone and listed from the [Content](#the-content-page) page like any other row, and play for everyone the moment they are published.

### The monsters page

**Control Panel → Monsters** (permission **Control Panel: edit items, monsters and NPCs**) edits one monster's stats and rules in one form, instead of its species row and the rows of the monster rule tables that match it by name. It lists every species, with **Find** (any words of its name or display name) and **Show** (hostile, sea creatures, those that cast spells, those with loot, NPCs, or the monsters changed or added); click one to open it.

- **What the form shows.** **Stats:** hit points, attack (empty: it never melees), defense, and the server minutes it spawns between (Classic's Zombie and Skeleton). **Behaviour:** whether it walks toward players though off the World Editor's monster list, attacks wanted players, spares the innocent, is a sea creature or 3×2 wide, clears its block, says its name when clicked, gives no quests or never casts; whether it is immobile, unclickable, a trap (it must then be immobile, one tile and on land), destroyed by Dispel Illusions, shields an innocent player standing on it, or hurt by healing; the item it is picked up as (a Pig); the spell hits that heal it and those it resists. **Combat:** weapon affinities (a weapon whose name contains the family adds a fixed amount plus `random(n)` against it; every matching row adds, in order) and its kill skill cap (empty: the world's default). **XP:** its melee and spell kill XP, the XP a kill gives each XP-model skill, a kill XP after the ring and a kill broadcast. **Lists:** the World Editor's and NPC Editor's monster and NPC lists (a monster on the World Editor's monster list is placed as a monster and walks toward players). The Behaviour, Combat and XP groups say where their rules come from: the pack's rows that match the monster, or its own definition. The two spawn minutes go together: fill both, or neither for any time.
- **Save to the draft** writes its species row and gives it a **definition** (dataset `monsters`, part `definitions`; see [Monster definitions](modding.md#monster-definitions)), which plays instead of the pack's rows that match it. As on the Items page, a Classic monster you change stops following Classic's later rule changes for it, and a Classic update that changes them raises a notice. **Use the pack's rules here**, **Play the pack's rules again**, **Drop the draft's changes** and **Drop my edit** work as on the [Items page](#the-items-page). Changes play for everyone once published; a monster already standing keeps the hit points it has, and a new hit point total applies from its next spawn.
- **Name and body.** **Rename in the draft** changes the name players see (its key, which map rosters and NPC files use, never changes; a name another monster has is refused). The body panel is the Content page's ([Bodies](#bodies)): repaint its body, give it a body of its own, or upload a new one, with the walking and attacking preview.
- **Loot, spells and NPC flags** live in the monster's NPC file, so they **save at once**, for everyone, like an NPCs page save, and do not wait for the draft. **Loot:** each line is an item (a count before it drops a pile, `15 Gold`) and a chance of 1 in N; a kill picks one line at random, then drops it 1 in N times, so the page shows each line's odds (1 in lines × N). **Spells it casts:** the monster spells it casts (below). **NPC flags:** one per line (`Passive`: it fights only once attacked; `Still`: it never walks). Every other line of the file (its Bio, its shop, its chatter) stays exactly as it was. A monster with no NPC file gets one on its first save. A monster only in the draft gets its NPC file once published. A file the NPCs page (or another admin) saved since you opened it refuses the save: open the monster again. A file with a line read two ways (a drop line inside a Bio line) must be fixed as text on the NPCs page first (**Open the whole NPC file**).
- **New monster** makes a monster in the draft by its key and display name. **Copy** another starts it as that monster: its stats, rules, body, lists and a copy of its NPC file (its loot, spells and flags). A monster made from nothing is on the World Editor's monster list with the generic stand-in's body and stats: give it stats and a body, publish, then add it to a map's roster in the World Editor. A key that is an item's, a fixture's (a door, a sign, an exit), an NPC's on an editor's NPC list or a faction's is refused.
- **Remove…** opens the monster's row on the Content page, with where it is used and the removal form (its spawns, the ones alive now, and its NPC file); its definition goes with it.
- **Monster spells**, at the top of the page, edits the spells monsters cast (dataset `monsters`, part `casting`): each one's tag (what an NPC file's `SPL|` line names), the spell effect it draws, how it aims, its power, its ladder (a cast rolls 1 in the step for the players on the map, 1 to 7 or more; each step at least 1) and whether it is cast as an "a" monster. Two spells may not share a tag. Saving puts them in the draft.
- A value outside its limits can't be saved, and a refusal names the form's field (`Hit points`, `Weapon affinity 2`). A monster someone else changed while you were editing it says so, and saving it is refused. The Content page's JSON editor edits the same rows (`monsters/monsters/<name>`, `monsters/definitions/<name>`) and is refused in the same way.

Monster levels and a configurable kill XP curve are not on this page yet.

### The world page

**Control Panel → World** (permission **World Editor**; **Admin → World Editor** opens it too) builds the world one map at a time. Saving applies at once, for everyone on the map, and keeps the map it replaced as a version; it does not wait for the content draft.

- **Picking a map.** Type its **Map X** and **Map Y** and **Open**, or step to a neighbour with the arrows. **Find** lists the saved maps by position, header, or the monsters, NPCs and items placed on them (where a monster or item is used in the world); the list is read when the page is shown, so it can take a moment on a big world. While another map opens, or a save or restore is on its way, the map cannot be edited. A position with no map opens a blank one; **Make this map now** saves it.
- **Painting.** Pick a tile from **Tiles** (find it by code or name; a tile that blocks walkers says so) and a layer under **Paint on**, then a tool: **Pencil** (one tile, or drag), **Fat brush** (a plus of five), **Fill layer** (the whole layer), **Flood fill** (the joined tiles of one kind), **Rectangle** (drag a box), **Eyedropper** (take the tile under the pointer). **Show layers** hides layers while you work (it does not change the map). Tiles a walker cannot step on (by layers 1 and 2, as the game decides) are marked with a red corner, and the fog is drawn as players see it. The tile under the pointer is named under the map.
- **Select, copy and paste.** **Select** a box, then **Copy**, **Cut** or **Delete** it (the active layer, or every layer when **Select, copy and cut take every layer** is ticked); **Paste** puts the copy with its top-left on the tile you click. **Keep the copy as a stamp** names it, so it can be pasted again from **Stamps** while the page is open. **Undo** and **Redo** (Ctrl+Z, Ctrl+Y) walk every change since the map was opened, the forms' too, and reach back past a save of the same map.
- **Spawns.** Four roster slots, each a monster or NPC from the World Editor's lists (monsters with no walking art are not offered), and the tile it spawns on (**Pick on map**, then click). A slot set by `/roster` has no tile: it spawns anywhere, is marked faintly on row 1, and stays so until you pick a tile for it.
- **Items.** Up to 200 placed items, `/drop`s included (a count before the name places a pile: `50 Gold`), each on a tile (**Pick on map**); **Remove** takes one out.
- **Exits, header, signs, flags, fog.** Up to two exits (a map's X and Y, `H1<mx>`/`H2<mx>` for a house interior, and the tile you arrive on; all four empty for none), the header, three sign texts, **Safe area**, **No player killing**, **Indoors**, the **Faction spawn** (one faction, or none; a faction the world no longer has stays on the map until you change it) and the fog's texture, blend and colour.
- **Saving.** **Save now** checks all four layers (12 rows of 17 palette tiles), the flags, the header and sign lengths, the exits, the fog, the placed monsters and items, as the World Editor did, then saves the map, its roster and placed items and refreshes everyone on it: its monsters respawn where placed. A map someone else saved since you opened it (even unchanged), or changed in play (`/roster`, `/drop`), refuses the save: drop your edit and open it again. If the connection drops before a save's answer comes, the page stops waiting and keeps your edit; reopening shows whether the save landed. **Drop my edit** puts the map back as it was opened.
- **Saved versions** lists the maps each save replaced, newest first, with who saved over them. **Restore** puts one back, as a save of its own (so it can be restored over in turn). A version the content no longer allows (a tile or item since removed) says why instead of offering **Restore**. The newest 50 are listed.

### The NPCs page

**Control Panel → NPCs** (permission **NPC Editor**; **Admin → NPC Editor** opens it too) edits NPC files: what an NPC says and sells, whether it banks or trains, and what a monster drops, casts and does. It lists every NPC file and every name on the editor lists or a monster species, with **Find** and **Show** (shopkeepers, bankers, trainers, those that drop loot, monsters); a player shop's file is its owner's and is not listed. Click one to open it.

- **Sections.** The file as forms: **Bio**, **Profile** and **Chatter** (one line each), **Sells** (item, price and the stock it starts with; the live stock shows), **Buys** (item and price), **Till** (the gold it pays with; the live till shows), **A banker**, **Promotes to** (a class and its price), **Loot** (item and 1 in N; a count before the item drops a pile), **Spells it casts** and **Flags** (`Passive`, `Still`). Lines no section holds (`OWN|`, blank lines, an unknown tag) are listed and kept where they are.
- **Text.** **Edit as → Text** shows the file itself, one `TAG|data` line per entry (`BIO|`, `PRO|`, `RND|`, `SEL|item:price:stock`, `BUY|item:price`, `GLD|gold`, `TRN|class:price`, `BNK|`, `INV|item:1 in N`, `SPL|spell`, `FLG|flag`, `OWN|`). Switching between Sections and Text carries the edit across. A file with a line read two ways (a drop line inside a Bio line) opens as text.
- **As you type**, the page runs the server's own check: a line the save would refuse (an unknown item, a bad number, a second till, more than 100 lines) says why and holds the save back; lines that do nothing in play are named as warnings.
- **Save now** applies at once, for everyone: it does not wait for the content draft. The file goes into the `npc_files` table (over the pack's), the file it replaced is kept as a version, the NPC's shop starts again from the stock saved here, and any open shop or Bio window for it closes. A file someone changed since you opened it (another admin, the Monsters page or a publish) refuses the save: drop your edit and open it again. **Drop my edit** puts the file back.
- A monster's file links to its stats on the [Monsters page](#the-monsters-page), and the Monsters page's NPC file section links here.

### Bans, jails, mutes and IP bans

Every ban, unban, IP ban, IP unban, jail, `/unjail`, mute, `/unmute` and pardon is written to the `moderation_log` table with its reason, who made it, the name of their role at that moment and when it ends. The in-force bans, IP bans, jails and mutes are in `account_bans`, `ip_bans`, `jails` and `mutes`; a row whose `expires_at` has passed no longer applies. A ban, jail or mute that runs out by itself is logged too, as an `unban`, `unipban`, `unjail` or `unmute` row by `system` with the reason "Expired", dated when it ended (the server checks once a minute and at startup, so this happens whether or not the player is online).

- **Duration and reason.** `/ban`, `/jail`, `/mute` and `/banip` take an optional duration after the name, then an optional reason: `/ban Berlyn 3d being a rude person`. A duration is a number with `m`, `h`, `d` or `w` (`30m`, `12h`, `7d`, `2w`, or combined, such as `1d12h`), up to 10 years, or `perm`. Without one, the `banLength`, `ipBanLength`, `jailSentence` and `muteLength` settings apply. Write `perm` or a duration first if a reason starts with something like `1d`. `/unban`, `/unjail`, `/unmute`, `/unbanip` and `/pardon` take a reason too.
- **What the player sees.** A banned player reads the original alert and the ban's end, such as `Banned until 2026-11-20 14:00 UTC.` or `This ban is permanent.` A jailed or muted player is told in the chat box until when, at once and at each login. The reason is never shown to the player; it is for staff, through `/banlist`.
- **Who may change an action.** Only the staff member who made a ban, jail or mute, or a role with **Overrule** (administrators), can change its length or lift it. Re-running `/ban`, `/jail` or `/mute` on someone already banned, jailed or muted replaces the length. Moderators who disagree with each other's bans settle it with the team.
- **Jail.** The jail is the **Jail** point in Server Settings (World), x0y0 (4, 4) unless you move it; a save that puts it on a missing map or a tile nobody can stand on is refused, and so is one for the Starting map or Fallback map. Moving the jail to another map takes the prisoners who are online with it; the others arrive at the new jail at their next login. A sentence runs in real time, including while the prisoner is offline, and works on offline characters: they arrive in jail at their next login, and a sentence that ended while they were away sends them to their respawn point (see [Respawn points](#respawn-points)). A prisoner can talk only with local chat and `/me`, which reach the jail map, and send IMs to staff; broadcasts, IMs to other players, guild chat, chat rooms, mail and board posts are refused. Staff warps cannot take a prisoner out or put a player in; use `/jail` and `/unjail`.
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

These commands (`maps:check`, `admin:role`, `admin:audit`, `admin:chatlog`) read an existing world: run against a database the server has not created yet (a wrong `SSO_DB`, or before the first start), they refuse and leave the file alone, since only the server creates a world from its pack. `maps:check` lists exits whose target map does not exist, `Exit` or `Exit2` tiles on a map with no such exit set, and start point, fallback point or Portal target settings whose map does not exist, and exits non-zero when it finds any. `content:report` shows which content rules and NPC seed text match a name (it reads the generated data, not your database).

### Reading the audit log

Actions that change state or reveal privileged information (effective admin commands, map and NPC file saves, setting changes, and role edits and assignments) are recorded in `audit_log`, as is each `/cheatfile` look, since its lines show players' addresses. `/location` and `/inventory`, which show only the staff member's own place and bag, `/banlist`, and refused or no-target command attempts are not logged. Administrators read it in game, merged with the moderation log, with `/auditlog <name> [count]`. From the command line, inspect the newest entries (default `50`):

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
| `startPoint` | Starting map | `x1000y992 6 4` | Map `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Where new characters appear, and their first respawn point (see [Respawn points](#respawn-points)). This point, `fallbackPoint` and `jailPoint` must each be a walkable tile with nothing in the way on a map that exists, or the save is refused (the content contract, see [docs/modding.md](modding.md#the-content-contract)). |
| `fallbackPoint` | Fallback map | `x1000y992 5 5` | Map `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Where a character goes when their place is gone: their saved map was deleted or their house decayed. Also where a death or jail release goes if the character's respawn map was deleted. Never point it at a tutorial map. Exits, edges, `/warp` and Portal never fall back here: travel to a missing map is refused. Run `bun run maps:check` to find exits and points that lead nowhere. |
| `jailPoint` | Jail | `x0y0 4 4` | Map `x<mx>y<my>`, `x` 1–17, `y` 1–12 | Where `/jail` sends a player; a prisoner stays on its map until their sentence ends, and only staff may go there any other way. |
| `portalTargets` | Portal targets | `[]` | Up to 30 points (`map x y`) | Random destinations for the Portal spell, among those whose map exists; with none, Portal cannot be cast and costs nothing. |
| `hazardMap` | Server Spirit map | `null` | Map `x<mx>y<my>` or empty | Map where the Server Spirit throws fireballs and lightning bolts every 0.35 s. |
| `bellMap` | Church bell map | `null` (Classic servers start with `x999y999`) | Map `x<mx>y<my>` or empty | Map where the church bell rings for everyone on it, about every 2 minutes 40 seconds; empty means no bell. |
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

Death drops and how long monster loot lasts moved to the Control Panel's [Balance page](#the-balance-page) (see [Moved from Server Settings](#moved-from-server-settings)).

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
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

## Building the world

Maps are built on the Control Panel's [World page](#the-world-page) (**Admin → World Editor** opens it); NPC files on its [NPCs page](#the-npcs-page) (**Admin → NPC Editor** opens it). A few things to know when painting:

- **Layers:** `1` (floor), `2` (transparent objects), `3` (over characters) and `S` (shadow).
- **Added tiles** (uploaded on the Content page, or `assets/added/`) are in the palette with the original ones; find them by code or name (see [Modding](modding.md#tiles-tilesjson)).
- **Carpentry.** Place a **Carpentry Bench** from the items next to a tile players can stand on, and save the map. Players must face the Carpentry Bench to build furniture.
- **Airship landing pads:** Paint `J2` on **layer 1** on any row and leave the faced tile free of blocking items. See [Vehicles guide](guides/vehicles.md).
- **Water for Boats and Battleships:** A ship is built on, and sails over, layer-1 sea tiles (`W1`, `N1`, `D2`, `I2`, `V2`); the shoreline art on layer 2 does not block it. Its rider gets off onto any land tile a walker could step onto, so no dock is needed. Ships cross a map edge only onto water. No stock NPC sells the Boat or Battleship Deed (the Airship Deed is a quest reward), so add them to a shop or give them out if your players should have ships.

### Respawn points

Every character has a respawn point, where a death or the end of a jail sentence sends them. A new character's respawn point is the `startPoint` tile. Entering a map with **SAFE AREA**, **INDOOR** and **NO PVP** all ticked replaces it with the tile they arrive on; the jail never does. The seed map and a new map's default toggles do not. A respawn point whose map is later deleted is replaced by `fallbackPoint`.

`fallbackPoint` is only for a character whose place is gone: logging in when their saved map was deleted, or being saved inside a house interior that decayed. It never uses the character's respawn point, so it cannot send a player somewhere they chose.

**Shrines.** To let players set a respawn point outdoors, build a small hidden map with all three toggles ticked and an `Exit` item on its arrival tile that leads back beside the shrine's entrance. Point an exit on the outdoor map at that arrival tile. Walking into the shrine saves the hidden tile and bounces the player straight back; a later death lands on the hidden tile and bounces them out beside the shrine again. A hidden map has two exits, so it can serve two shrines.

**Tutorial island.** Set `startPoint` to the island, so new characters start there and die back there. Make the way off the island go through a main-world shrine, which replaces their respawn point, and set `fallbackPoint` to a safe main-world tile. Nothing then sends a player back to the island once they have left it.

## Stopping, backing up, and restoring

### Graceful stop

Send one `SIGINT` (Ctrl+C) or `SIGTERM` to the server process. The server stops the tick loop, saves all online characters and dirty maps, closes the WebSocket gateway, and closes the SQLite database cleanly. Wait for it to exit; a second signal forces an immediate exit without waiting.

A world is the database file **and** the `<database name>-content/` folder beside it (`sso-content/` for `sso.sqlite`), which holds the art and sounds operators upload on the Content page (files named by their content's hash; the database names them). Back up and restore both together. A world that never had an upload has no such folder. Each database has its own, so a second world beside the first never touches its uploads.

### Offline backup (recommended)

1. Stop the server cleanly (and ensure no CLI such as `admin:role`, `admin:audit` or `admin:chatlog` is running against the database).
2. Copy the configured database file and the `sso-content/` folder beside it to a separate backup path, for example:

   ```sh
   mkdir -p /path/to/scratch/sso-backup
   cp sso.sqlite /path/to/scratch/sso-backup/sso.sqlite
   cp -a sso-content /path/to/scratch/sso-backup/ 2>/dev/null || true
   ```

3. Restart the server.

### Live backup (optional `sqlite3` CLI)

Because SSO opens SQLite in WAL mode, **never copy only the live `sso.sqlite` file while the server is running**—doing so can omit committed pages still in `-wal` and produce a corrupt copy.

If the external `sqlite3` CLI is installed, you can take an online backup of committed database state (this does not include unsaved in-memory play):

```sh
sqlite3 sso.sqlite ".backup '/path/to/scratch/sso-backup.sqlite'"
```

Then copy the `sso-content/` folder too. Uploaded files are never changed once written, so copying it while the server runs is safe; copy it after the database backup, so every file the backup names is there.

See the official SQLite [Online Backup](https://sqlite.org/backup.html) and [CLI `.backup`](https://sqlite.org/cli.html#backup) documentation for details.

### Restoring from a backup

1. Stop the server and any other database users cleanly.
2. Preserve the old database and its `-wal` and `-shm` sidecars together in another location if you want to keep them.
3. Copy the backup into a clean destination path with no stale `-wal` or `-shm` files, with its `sso-content/` folder beside it.
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
