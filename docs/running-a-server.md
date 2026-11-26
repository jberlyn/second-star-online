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
- **Minimal**: the blank pack you build your own game from. It holds the least a world needs to run and nothing else: the start class Novice, one skill (Fighting), the currency Gold, the plain grass tile, a bare body with one head for each of its two sexes, and two all-grass maps: the start at `x0y0` (start and fallback points at `1, 1`) and a jail at `x50y50` (`1, 1`). There are no monsters, NPCs, spells, shops or quests until you add them on the Control Panel's content pages (see [How the content pages work](#how-the-content-pages-work)). Its few pictures are copies of 1.6's. It is the supported way to start a game of your own: every picture, body, effect, tile and sound you need is uploaded on the [Pictures & Sounds](#the-pictures--sounds-page) page (see [Art and sounds](#art-and-sounds) and [Sounds](#sounds)).

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
- **Customization:** In-game map, NPC, settings and [content](#how-the-content-pages-work) edits persist in the database. Changes to the Classic pack's source, art, or the client require a custom image; see [Modding](modding.md).

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
- **`administrator`** (Admin, rank 2): every permission. Full command access, staff chat, the Admin Chat room, the Control Panel with Server Settings, its content pages, and its World page and NPC files (including the roles), and Assassin's Game controls. An administrator can ban, jail or mute anyone but themselves and change or lift any ban, IP ban, jail or mute, and IP bans never stop an administrator's login. Administrators take no damage of any kind, never get hungry, cannot be pushed, stay off the high scores, drop on every death and skip the chat and broadcast waits.

Every one of these is a permission you can turn on or off for each role, and you can add roles of your own, such as a helper who can only `/mute`. Any role makes an account staff: it reads and posts staff chat and can be sent IMs by jailed and muted players, so roles are for staff, not for perks. Bans, jails, mutes and pardons reach only accounts of lower rank, unless the staff member's role has the **Overrule** permission. `/kick`, `/iplookup`, `/warp` and `/warptome` are looser: they refuse only a target whose rank is higher than yours, so a moderator can kick or look up another moderator. `/warpmeto` has no rank check (it refuses only a jailed caller), and `/warpscript` never warps a speaker whose rank is higher than the staff member's.

### Editing roles and giving them out

Open **Admin → Control Panel**, then **Server Settings**, and choose:

- **Roles** to edit a role's display name, rank and permissions, add a role (**New role…**) or delete one. **Save** applies the role at once to everyone online who holds it. Deleting a role leaves its accounts with no role. At least one role must keep every permission, so the server can always be run.
- **Staff** to see every account with a role, change one with its picker (or **No role** to take it away), or type a character's name and **Give role**. Changes apply at once, also to anyone online. You cannot change your own role here.

Both pages need the **Server Settings, roles and staff** permission (administrators by default). There is no in-game chat command for roles. Every role edit, deletion and assignment is recorded in the audit log.

**Upgrading from 1.10.0 or earlier:** `immortal` accounts become `administrator`, `player` accounts have no role, and moderators keep their role with the permissions v1.11.0 gave it, so they lose the warps and `/pardon` or `/warp` on themselves. `/role` is gone: give roles on the Staff page or with `bun run admin:role`. Scripts that set `accounts.role` must write a role id (`administrator`, `moderator`) or `NULL`. The moderation tables' `actor_rank` column is now `actor_role` and holds the role's display name (`Admin`, `Moderator`).

**Upgrading from 1.13.0 or earlier:** the **World Editor** and **NPC Editor** permissions are gone: editing maps and NPC files is part of **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**, which now covers every kind of content. A role that held either of them gets the content permission instead, and with it every content page (items, creatures, spells and the rest), not only the World page or the NPC files. The Control Panel's separate **NPCs** page is gone too: NPC files are on the Creatures & NPCs page's Talk & Shops tab. **Admin → World Editor** and **Admin → NPC Editor** are gone from the menu: open them from the Control Panel's sidebar. If a role should not edit all content, untick that permission on the Roles page.

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

Administrators open **Admin → Control Panel** from the top menu bar. The game gives way to a full-page dashboard; **Return to Game** at the top brings you back where you stood. While you are in the Control Panel you stay online but are off the map, as in the World Editor: other players see you leave, and trades, shops and held actions are cancelled. The header also opens Friends, Who's Online, Send IM (with a count of IMs that came in), the chat rooms and Player Settings as floating windows over the dashboard, and Return To Title Screen logs out. The sidebar lists the admin pages your role may use under four headings, always in this order: **Server**, **Players**, **Content** and **Publishing**. The pages under each heading are in A–Z order, and the Control Panel first opens on the page at the top. There are no classic tools left: the World Editor is its World page, and the NPC Editor is the [Talk & Shops](#talk--shops) tab of its Creatures & NPCs page.

The Control Panel shows for a role with a permission that has a page there: today **Server Settings, roles and staff**, **Control Panel: look up characters (the player hub)** (the [Characters](#the-player-hub) page), **Control Panel: read the player activity log** (the [Activity Log](#the-activity-log) page), **Control Panel: edit content (items, creatures, NPCs, maps and the rest)** (the pages under **Content**, in the sidebar's order: [Community](#the-community-page), [Creatures & NPCs](#the-creatures--npcs-page) (with the NPC files on [Talk & Shops](#talk--shops)), [Game Rules](#the-game-rules-page), [Gathering & Crafting](#the-gathering--crafting-page), [Houses & Vehicles](#the-houses--vehicles-page), [Items](#the-items-page), [Pictures & Sounds](#the-pictures--sounds-page), [Quests](#the-quests-page), [Skills & Classes](#the-skills--classes-page), [Spells](#the-spells-page) and [World](#the-world-page), and the pages under **Publishing**: [Packs](#the-packs-page) and [Publish Changes](#the-publish-changes-page)). **Control Panel: edit characters** adds the hub's [Edit tab](#editing-a-character).

### How the content pages work

Everything the game knows about items, creatures, NPCs, spells, rules, texts, pictures and sounds comes from the **installed packs** plus **your changes**. Every server runs one of the packs shipped inside each release, read from it and never copied into your database: the **Classic pack** (1.6's content, the default), so a server with no changes plays exactly as before, or the **Minimal pack**, for a world [created with it](#choosing-your-starting-content). The content pages, under the sidebar's **Content** heading, make those changes (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**), in plain words: no page asks you to type JSON. [Publish Changes](#the-publish-changes-page) makes them live. Each part of the content has exactly one page that edits it, so there is one place to go for each thing, and a change listed on [Publish Changes](#the-publish-changes-page) opens on the page that edits it.

A content page shows one tab at a time. Its first tab is usually the list of its records (each item, each creature, each spell), and the tabs after it hold the rules those records share. A list sits on the left and the open record's form on the right; on a wide screen each scrolls on its own, so the list never scrolls away. Leaving a form with unsaved changes asks first.

The Items, Creatures, Talk & Shops, Skills and Gathering tabs are editors of their own, described under their pages. Their forms show one section at a time behind tabs (an item's **Basics**, **Picture**, **Weapon** and so on), each with a line saying what it is for, and a dot marks the tabs where the record has settings. The tab you chose stays open as you move from record to record, so you can step through every sword's **Weapon** tab without hunting for it. **All** shows every section at once. **Save changes** and the form's other buttons stay in view at the bottom of the form, whichever section is showing: saving on the left (**Save changes**, **Undo changes**), resetting on the right (**Restore the original**, **Cancel unpublished changes**). A section that saves on its own (an item's or creature's **Picture**, a creature's **Loot & spells**) has its own buttons instead. Where each tab's rules come from is folded at its foot (*Where these settings come from (4)*): click it to see the rows. **+ New item**, **+ New monster** and **+ New skill** sit at the top of their lists.

Every other tab (all of the Spells, Houses & Vehicles, Quests and Community pages, and the tabs after the first on Items, Creatures & NPCs, Skills & Classes, Gathering & Crafting and Game Rules) is drawn from the shape of the content it edits, and they all work the same way:

- **A list tab** (Spells, House types, Deeds, Vehicles, Classes, Starting classes, Factions, Help topics) lists its entries with **Search** and a count; click one to open its form beside the list. **+ New spell** (or house type, deed, faction…) starts an empty one, and **Copy as a new spell** starts one from the entry that is open. The name an entry is found by (a spell's name, a house type's) can't change once saved: make a new one instead.
- **A settings tab** shows a card for each part it covers, each with its title, a line saying what it is for, and its own form and buttons. The Items page's **Using and wearing** tab, for example, has cards for wearing and equipping, using items, armour, breaking gear, swinging weapons and requirements by name.
- **The forms** show every value as a plain control: a group of fields, a list whose rows you add, move up or down (**↑**, **↓**) and **Remove**, a drop-down for a pick from a fixed set, a tick box that shows an optional part's fields (tick it to give the entry one), and a **Kind** drop-down where a value can take one of several shapes. Where a field names something the game has (an item, a creature, a skill, a sound), names are suggested as you type. Rarely used fields are folded under **More options**, which opens by itself when one of them is set. A value outside its limits can't be saved, and the message names the field.
- Each form's header says whether it is the pack's **Original**, **Changed by you**, **Added by you** or **Removed**, and whether it has **Unpublished changes** (or is **Back to the original once published**, or **Removed once published**).
- **Save changes** puts the entry or card with the other unpublished changes. **Undo changes** puts the form back as it was opened. **Restore the original** puts the pack's version back once your changes are published. **Cancel unpublished changes** takes its change out of the unpublished changes, leaving what plays now. **Remove** (on a list entry) takes it out once published; the checks before publishing name anything that still uses it. A vehicle's is **Remove this vehicle…**, which opens its removal form (what happens to its riders, the parked ones and its deeds) on the Publish Changes page's **Where it is used** tab. A card for a section a world may leave out (a casino game, the Assassin's Game) has **Turn this off**, which leaves it out once published; a card for one the world goes without says so, with **Add it**, which starts a blank one to fill in and save.
- Each form remembers the revision of the row it opened: a save, restore, cancel or remove over a newer change someone else made meanwhile is refused, with the reason. Open it again to see theirs. A form being edited is never overwritten by a refresh.
- Nothing reaches players until it is published. The bar at the top of each page says so, and **Review and publish…** opens [Publish Changes](#the-publish-changes-page). The exceptions are NPC files (the [Talk & Shops](#talk--shops) tab and a creature's **Loot & spells**), which save at once, and the World page's maps.

### The Items page

**Control Panel → Items** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) has five tabs: **Items**, then the rules every item shares (below). The **Items** tab edits one item's rules in one form, instead of the rows of a dozen rule tables that match it by name. It lists every item, with **Search** (any words of its name or ID) and **Show** (weapons, armour, food, other, the items changed or added by you, or the retired ones); click one to open it. The form's header says whether the item is the pack's **Original**, **Changed by you** or **Added by you**, and whether it has **Unpublished changes**.

The form has a tab for each job an item can do. A dot on a tab means the item has settings there, so you can see at a glance what it does. Each tab starts with a line saying what it is for, and folds the rarely used fields under **More options** (open by itself when the item uses one of them).

- **Basics:** the name players see (empty shows its ID, which rules, maps and saved characters use and which never changes), where it is worn (weapon hand, off hand for shields and arrows, head, body, feet, ring, or nowhere, which Equip refuses), the Strength needed, whether it needs both hands, **Only these classes** (the classes whose characters may equip it, a +N masterwork of it included; none ticked: every class), its special abilities (a key opens doors, a bow shoots arrows, a crate holds items…; the ticked ones show, the rest are under **Add an ability…**), requirements (a skill or level needed before equipping or using it, with an optional message), and whether player shops take it and the World Editor lists it. **More options** borrows another item's worn picture. **Remove or retire this item…** opens it on the Publish Changes page's **Where it is used** tab, with every place it is used and the removal form ([Removing an item, a creature or a vehicle](#the-publish-changes-page)); its definition goes with it.
- **Picture:** the picture and worn panels, the same as the Pictures & Sounds page's ([Item pictures](#item-pictures), [Worn layers](#worn-layers)). They save with their own buttons, so the form's Save bar steps aside on this tab.
- **Weapon:** its damage, typed as a range (**7 to 12**; the same number twice is a fixed amount), with an optional bonus of up to half the wielder's Strength (Classic's Gold Axe); the skills a kill with it trains; its swing speed (the wait between attacks and between actions, in frames, 20 a second; the usual is 14); and its swing sound or silence. **More options** has the final damage override (rolled after every bonus; almost no item has one) and the **Skill bonuses**: damage added step by step as the wielder's skills rise, as a form (tick it on to give the weapon some; copying a weapon is the easy way to get these).
- **Armour:** protection, as how much less damage each hit does against players and against monsters while it is worn in a slot (a negative number makes hits hurt more); spell protection (metal armour usually makes spells hurt more); and bonuses while worn (attack, spell, Black Arts or Martial Arts power, or XP per kill). **More options** has protection against one attacker: a named weapon a player hits with, or a named monster (Ice Armor against an Ice Sword or a Yeti).
- **When used:** whether players can use it, whether a stuffed player can still use it (**Can be used when full**, for a healing potion, say), its effects (each changes HP, SP or Hunger by an amount in a range; a negative amount lowers it), the message when used and when it can't be, and the item menu's button in place of Equip (Cook, Mix, Build, Smith, Storage). **More options** has "does nothing and says nothing", the Mysticism a spell book needs, and **Skill book**: tick it on to make reading the item teach a skill (and use the item up), and pick the skill in its form.
- **Tool:** what players gather with it (chop trees, mine rock, dig, plant seeds, fish, water crops), at a tier (1 when empty), the skill its swing speed comes from, and another item it shares its hit count with.
- **Breaking:** the slots it can break in as armour or as a weapon, and the item it breaks into.
- **On the ground:** whether it blocks movement, its hover name (or none), how many lines it holds as a container, and whether each copy has its own storage (a `#id`). **More options** has a skill or level needed to cross it, its animated overlay (and whether it animates only while someone crafts at it), the layer it is drawn on, its position on its tile in pixels, and the line Ctrl says instead of picking it up.

Saving:

- **Save changes** saves the item's rules and its name together. The rules become its **definition**: one record of its rules (dataset `items`, part `definitions`; see [Item definitions](modding.md#item-definitions)), which plays instead of the pack's rows that match it, in every table the form covers. A Classic item you change stops following Classic's later rule changes for it; when a Classic update changes what Classic's rules play for it, the form says so and **Review it under Publish Changes** opens the notice. A form saved with nothing changed stages nothing ("already plays that"), and one saved back to what plays drops its draft change. **Undo changes** puts the form back to what was last saved.
- **Restore this tab to the original** (at the foot of a tab, shown only where the item differs from the pack) puts that tab back to what the pack's rules play for the item; save to keep it. **Restore the original** drops the item's definition when published, so it plays the pack's rules again (on an item of your own, **Clear all its rules** leaves it with none). **Cancel unpublished changes** takes the item's rule and name changes out of the draft.
- **Where these settings come from**, folded at the foot of each tab, names the pack's rows that decide each rule (`the pack's contains "Long Sword" (row 90)`) or the item's own rules.
- **+ New item** makes an item in the draft. **Copy an existing item** starts it as that item plays (the safe way to make a new sword), drawing that item's picture, and drawn when worn as that item, until you upload its own. Its **ID** is permanent; the name players see is optional. An ID the game keeps for its own things (a door, a sign, a `+N` masterwork, a `#id`) or a map fixture's (`Wooden Door`, `Gold Chest`, `Open Gold Door`) is refused. A copy of a spell book teaches no spell until a spell's book is set to it, so it is made without the Mysticism; a copy of a tool that a gathering node names by name (only the Ice Hammer mines ice) works there only once it is added to that node's tools. The page says so when it makes the copy.
- A value outside its limits can't be saved, and a refusal names the form's field (`Skills it trains: names a skill that does not exist`). An item someone else changed while you were editing it says so, and saving it is refused: undo your changes to see theirs. A form being saved is locked until the answer comes, a refresh never overwrites a form being edited, and you can't open another item with unsaved changes.

Changes are published, undone and listed on the [Publish Changes](#the-publish-changes-page) page like any other change, and play for everyone the moment they are published.

The other four tabs are cards for the rules every item shares (see [How the content pages work](#how-the-content-pages-work)):

- **Using and wearing:** wearing and equipping (where gear goes, the Strength it needs, what players are told), using items, armour, breaking gear, swinging weapons, and requirements by name (skills or levels needed for every item whose name matches).
- **Abilities by name:** rules that reach every item whose name matches, the way Classic gives its own items their abilities: special abilities (a key opens doors, a crate holds items…), tools, weapon skill ladders, gear bonuses and attack power. An item's own form overrides them.
- **On the ground and in bags:** how items on the ground behave, what players are told when they pick things up, containers, the item menu's choices, and which worn picture an item uses, by name.
- **Lists:** the items the World Editor can place, the items players may sell in their shops, and the map fixtures (doors, signs, chests and other things drawn on maps).

### The Creatures & NPCs page

**Control Panel → Creatures & NPCs** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) holds every monster, animal and NPC in three tabs: **Creatures** (each creature's stats, picture, behaviour, rewards, loot and spells), **Talk & Shops** (the NPC files) and **Rules for every creature**.

#### Creatures

The **Creatures** tab edits one monster's stats and rules in one form, instead of its species row and the rows of the monster rule tables that match it by name. It lists every monster, with **Search** (any words of its name or the name players see) and **Show** (those that attack players, live in water, cast spells or drop loot, NPCs, or those changed or added by you); click one to open it. Its form is in plain words, one tab at a time, and a dot on a tab marks the tabs where the monster has settings. Rarely used settings are folded under **More options**, which opens by itself when one of them is set.

- **What the form shows.** **Basics:** the name players see (its ID, which map rosters and NPC files use, never changes; a name another monster has is refused), hit points, attack (empty: it never attacks in melee) and defense; under More options, the minutes of each hour it only appears between (Classic's Zombies and Skeletons: fill both, or neither for any time). **Picture:** the body panel, the same as the Pictures & Sounds page's ([Bodies](#bodies)): repaint its body, give it a body of its own, or upload a new one, with the walking and attacking preview; it has its own Save button. **Behaviour:** whether it always attacks players (even off the World Editor's monster list), attacks wanted players, leaves innocent players alone, never moves, lives in water or never casts spells; under More options, whether it takes up 3×2 tiles, lets others walk through it, says its name when clicked, does nothing when clicked, never gives quests, is a trap (it must then never move, take one tile and live on land), is destroyed by Dispel Illusions, protects an innocent player standing on it, or is hurt by healing spells; the item it can be picked up as (a Pig); the spells that heal it and those it resists (they hit it for 1 to 3). **Fighting:** weapon bonuses (a melee weapon whose name contains the words adds extra damage, typed from … to …, against it; negative numbers mean less damage; every matching row counts) and its skill training limit (how far killing it trains the weapon's skills; empty: the world's default). **Rewards:** its level (empty: none; players see it only when the Game Rules page shows monster levels, and kill XP can compare it with the killer's level), the XP for a melee kill and for a spell kill (empty: worked out from its level, as the Game Rules page's **Levels and experience** card sets), and an announcement when it is killed (`{}` is the killer's name); under More options, the skill XP per kill (for skills that rise by XP) and a fixed kill XP (in place of the melee and spell kill XP and any XP gear's bonus). **Loot & spells:** below. **Editor lists:** the World Editor's and NPC Editor's monster and NPC lists (a monster on the World Editor's monster list is placed as a monster and attacks players). **Where these settings come from**, folded at the foot of the Behaviour, Fighting and Rewards tabs, names the pack's rows that match the monster, or its own rules.
- **Save changes** saves the monster's stats, rules and name together: its species row and a **definition** (dataset `monsters`, part `definitions`; see [Monster definitions](modding.md#monster-definitions)), which plays instead of the pack's rows that match it. As on the Items page, a Classic monster you change stops following Classic's later rule changes for it, and a Classic update that changes them raises a notice. **Undo changes** puts the form back to what was last saved. **Restore this tab to the original** (shown only where the monster differs from the pack) puts one tab back to what the pack plays for it (save to keep it); **Restore the original rules** drops its definition when published, so its Behaviour, Fighting, Rewards and Editor lists settings are the pack's again (its stats stay; on a monster of your own, **Clear all its rules**); **Cancel unpublished changes** takes its changes out of the draft. Changes play for everyone once published; a monster already out keeps the hit points it has, and a new hit point total applies from the next time it appears.
- **Loot & spells** live in the monster's NPC file, so they **save at once** (**Save loot & spells**), for everyone, like a Talk & Shops save, and do not wait for the draft. **Drops:** each line is an item (a number before it drops a pile, `15 Gold`) and a chance of 1 in N; a kill picks one line at random, then drops it 1 in N times, so the page shows each line's odds (1 in lines × N). **Spells it casts:** the monster spells it casts, ticked (below). **Only fights once someone attacks it** (`Passive`) and **Stays in one place** (`Still`) are tick boxes; any other flags are listed under More options, each with **Take it out** (they are kept for scripts and other tools; the game reads only those two). Every other line of the file (its Bio, its shop, its chatter) stays exactly as it was. A monster with no NPC file gets one on its first save (**Create its NPC file**). A monster not published yet gets its NPC file once published. A file saved on Talk & Shops (or by another admin) since you opened it refuses the save: undo your changes to see theirs. A file with a line read two ways (a drop line inside a Bio line) must have that line taken out on Talk & Shops first (**Open its whole NPC file**).
- **+ New monster** makes a monster in the draft. **Copy an existing monster** starts it as that monster: its stats, rules, picture, lists and a copy of its NPC file (its loot, spells and flags). Its **ID** is permanent; the name players see is optional. A monster made from nothing is on the World Editor's monster list with the generic stand-in's body and stats: give it stats and a picture, publish, then add it to a map's roster in the World Editor. An ID that is an item's, a fixture's (a door, a sign, an exit), an NPC's on an editor's NPC list or a faction's is refused.
- **Remove this monster…** (in Basics) opens it on the Publish Changes page's **Where it is used** tab, with every place it is used and the removal form (its spawns, the ones alive now, and its NPC file); its definition goes with it.
- **Monster spells (shared by every monster)**, at the top of the tab, edits the spells monsters cast (dataset `monsters`, part `casting`): each one's ID (what an NPC file's `SPL|` line names; it can't change once saved), the spell it draws, where it lands (near the player, on the player, out from the monster in a random direction, or on itself), its power, and how often it casts (1 in this many turns, for 1 to 7 or more players on the map; each at least 1), and whether messages call the caster "a" monster. Two spells may not share an ID. **Save monster spells** puts them in the draft.
- A value outside its limits can't be saved, and a refusal names the form's field (`Hit points`, `Weapon bonus 2`). A monster someone else changed while you were editing it says so, and saving it is refused: undo your changes to see theirs. A form being saved is locked until the answer comes, and you can't open another monster with unsaved changes.

Monster levels and a configurable kill XP curve are not on this page yet.

#### Talk & Shops

The **Talk & Shops** tab edits NPC files: what an NPC says and sells, and whether it runs a bank or trains players. A creature's loot, spells and behaviour are on the Creatures tab's **Loot & spells**; the lines they hold are kept as they are when the file is saved here. It lists every NPC file and every name on the editor lists or a monster species, with **Search** and **Show** (shopkeepers, bankers, trainers, those that drop loot, monsters); a player shop's file is its owner's and is not listed. Click one to open it.

The form has three tabs, each with a line saying what it is for; a dot on a tab means the file has something in it.

- **Talk.** **Bio window: top lines** (the short lines at the top of its Bio window, such as `Name: Amber`), **Bio window: description** (the larger box under them) and **Things it says** (it says one, picked at random, now and then). One line each.
- **Shop.** **Sells** (item, price in gold and how many it has in stock right now; saving sets the stock to these numbers), **Buys** (item and what it pays) and **Gold in its till** (the gold it has right now to pay players who sell to it; saving sets it, and empty means none).
- **Bank and training.** **Runs a bank** (talking to it opens the player's bank) and **Promotes players to** (a class and the price of the promotion).
- **There is no text view:** the form covers everything an NPC file does in play. Lines the game doesn't use (a player shop's owner line, an old or unknown line) are listed under the tabs, kept where they are, each with **Take it out**. A line read two ways at once (a drop line inside a Bio line) is listed the same way, and the form shows the NPC once it is taken out. A file with more than one till shows the first, with **Keep only this one**.
- **As you type**, the page runs the server's own check: a line the save would refuse (an unknown item, a bad number, a second till, more than 100 lines) says why and holds the save back; lines that do nothing in play are named as warnings.
- **Save changes** applies at once, for everyone: there is nothing to publish. The file goes into the `npc_files` table (over the pack's), the file it replaced is kept as a version, the NPC's shop starts again from the stock saved here, and any open shop or Bio window for it closes. A name with no file yet has **Create its NPC file** instead. A file someone saved since you opened it (another admin, the Creatures tab or a publish) refuses the save: **Undo changes** puts the file back as it is now.
- A monster's file links to its stats on the Creatures tab, and the Creatures tab's NPC file section links here.

#### Rules for every creature

Cards (see [How the content pages work](#how-the-content-pages-work)) for what every creature shares: **Behaviour** (rules that reach every creature whose name matches), **Weapon bonuses** (weapons that hit some creatures harder or softer), **Skill training limits** (how far killing creatures trains a weapon's skills), **Stand-in creature** (the body and defense of a name no creature has, such as a player shop's shopkeeper; such a name always starts with 1 HP, whatever its hit points say) and **Editor lists** (the creatures and NPCs the World Editor and NPC Editor offer). A creature's own form overrides the rules that match it by name.

### The Spells page

**Control Panel → Spells** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) has three tabs:

- **Spells:** a list of every spell players can learn and cast (see [How the content pages work](#how-the-content-pages-work)): its cost, its picture and sound, and what it does. An open spell shows its **Effect** panel above its form, the cast effect's frames with their preview ([Spell effects](#spell-effects)), which saves on its own buttons.
- **Damage and buffs:** the cards for what each spell effect deals or heals, and how long buffs last. A spell effect is shared: a spell, a staff's free fireball, a creature's cast and a map hazard running it all use these numbers, unless a spell sets its own.
- **Spell power:** a card for how strong a cast is: the power every spell starts from and each spell's power table, by the caster's skill.

The **Damage and buffs** cards:

- **Spell amounts:** what each spell effect deals or heals (Firebolt, Fireball, Bolt, Meteor, Splash, Crush, Wind Wave, Arrows, Minor Heal and Major Heal), on a monster, on a species the effect heals, on an undead monster (the heals) and on a player. An amount is a range typed **from … to …**, plus the caster's spell power times a number (**plus the caster's power ×**, 0 for none): 1.6's Firebolt on a monster, `6 + P + random(3)`, is 7 to 9 plus power × 1. The page stores the range as a fixed part and a roll (`flat` and `randomN`: a roll of 1 to n, so 7 to 9 is 6 plus 1 to 3; a range can't start at 0, since a roll never gives 0, but a fixed 0 can). Beside each amount the page previews its whole range at powers 1, 10 and 50 as you type. A species' amount when the effect heals it may be left empty, and it is then healed by the amount on a monster. **Spell hits** holds Dispel Illusions' amount on a dispellable monster, the roll a monster takes from an effect it resists, and an arrow's roll when the monster's Defense leaves it under 1.
- **Buffs and cast power:** the frames Magic Shield, Stone Skin, Firesword and Hold last for each point of power, Stone Skin's defense bonus, Argon's Fist's frames (a Purple Potion's too), Diminish Hunger's hunger and the hunger it works below, Morph's roll (which picks the body), and the power of the Fire Staff's and Firesword's free fireballs. A buff set to last 0 frames does nothing at all, and Diminish Hunger adding 0 says nothing.
- Each value shows its **Original** (the installed pack's value, or the engine's default in a Minimal world), and what **players have** now when that differs. A value outside its limits can't be saved, and the error says the limits. **Save changes**, **Undo changes**, **Restore the original** and **Cancel unpublished changes** work as on the Game Rules page's Numbers tab ([The Game Rules page](#the-game-rules-page)).

A new spell that runs an effect plays its amounts; one that should hit differently from the spell it copies sets its own in its form on the **Spells** tab (`amount` in the `spells` dataset; see [balance.json](modding.md#balance-balancejson)), which replaces the effect's when that spell is cast from a spellbook (a free fireball, a monster's cast or a map hazard running the same effect keeps the effect's).

The monster spells creatures cast (what an NPC file's `SPL|` line names) are on the [Creatures](#creatures) tab.

### The Skills & Classes page

**Control Panel → Skills & Classes** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) edits every skill and how it rises, the classes, and how a new character starts out.

#### Skills

The **Skills** tab edits the skills and how they go up. It lists every skill in the order players see them (hidden ones included and marked), with **Search**; click one to open it. The form's header says whether the skill is the pack's **Original**, **Changed by you** or **Added by you**, whether it is hidden, and whether it has **Unpublished changes**. Its form is in plain words, one tab at a time; a dot on a tab marks the tabs where the skill has settings of its own, and rarely used settings are folded under **More options**, which opens by itself when one of them is set.

- **Basics:** the name players see (empty shows its ID, which characters store their values under and which never changes), whether to hide it from players' Skills page (it still goes up and works), and its position on the page (1 is the top). **Remove this skill…** is here too (below).
- **Starting values:** the value each class starts with (empty: 1, as for any skill a class does not set), and the promotions that teach it (taking one raises it to a random 1 to 10, if it is lower).
- **How it goes up:** first how it improves: **a chance to go up by one each time** (1.6's) or **earns XP and goes up in levels**. Then, for each way it can be trained (killing a monster, shooting arrows, being attacked, casting spells, gathering, crafting, landing a hit), whether it follows **the normal rule** shared by every skill (described in a sentence under it), has **its own rule**, or **never goes up this way**. A chance rule has its **Chance to go up: 1 in…** (bigger is slower) and where it **stops going up** (no cap, a number, or the faction or mage cap, picked from a list); under More options, another skill that must be high enough first, the killed monster's skill cap (killing) and the lowest value that can still go up (gathering, crafting: empty is 0, so a player who has never used it can start learning). An XP rule has the **XP earned each time** and, under More options, another skill it needs first. Numbers that can depend on the character are typed as steps: **Set to**, **Add**, **Subtract** or **Multiply by** a value (a number, a roll such as `random(6)` or `2 + random(6)`, or a name such as `skill`, `level`, `strength`, `tier`, `damage`, a stat table such as `wisdomBonus`, or another skill's ID), each **only when** its conditions hold (`skill > 10`, comma-separated; empty is always); the line under them says what the steps work out as, and **What can I type?** lists the names. An XP skill also has its **Levels**: its level curve (skills on the same curve need the same XP for each level; a curve other skills use says so, since a change changes theirs too; a new name makes a curve of its own), its **Shape** (formula rows; **Grows by a percent each level**: a start, an amount per level raised to a power, and a growth percent, 10% being close to RuneScape's curve; **A list of XP for every level**, typed by hand; or **RuneScape's XP table (levels 1 to 99)**, its exact XP, 83 for level 2 and 13,034,431 for 99, with new characters best started at 1 in the skill), the XP needed to go up from each level, its highest level and where it stops levelling; under More options, whether the XP is counted from one level to the next or in total, and exact XP for the first levels. See [Progression](modding.md#progression).
- **Where it's used** lists, read-only, everything that trains or needs the skill (weapon skill rows, items, gathering spots, fishing, recipes, spells, skill books, promotions, the game's rules that name it, other skills' rules), each opening where it is set.
- **Try it out:** for the chance model, the chance it goes up each time at each value from 0 to 100 (or why it can't go up there); for the XP model, the total XP to reach each level, the XP to the next level, the XP each time and how many times each level takes (played from level 0, leftovers carried; dice in an XP rule are shown by their average, the counts as estimates). Pick the way it is trained; **The sample character** sets the stats, level, the other skills' value, tool tier, a hit's damage and a killed monster's skill cap. Both are worked out by the game's own rules from the form as it is, unsaved changes included. A faction or mage cap reads a character with no faction.
- **Save changes** puts the skill's changes in the draft; **Undo changes** puts the form back to what was last saved, and **Cancel unpublished changes** takes them out of the draft (a skill only the draft has takes its start values, promotions and place with it). On a pack's skill that plays something else (its name, place, start values, promotions or progression; unpublished changes count), **Restore the original** puts every one of them back to the pack's once published (rows only it changed go back to the pack's entirely; a start class or promotion other skills' changes share keeps theirs), and **Restore this tab to the original**, at the foot of Basics, Starting values and How it goes up (shown only where the skill differs), puts that tab's fields back in the form, to be saved. A skill of your own has no original. Choosing a curve another skill uses only names it; editing it saves the curve with the revision the form loaded, so another admin's newer edit of the curve refuses the save.
- **+ New skill** makes one in the draft by its permanent **ID** (one word: a letter, then letters, digits and underscores, so rules can name it), an optional name players see, and how it goes up (for XP, its level curve: an existing one, or a new one of 100 XP a level).
- **Remove this skill…** lists everything that uses the skill (weapon rows, items, gathering spots, requirements, start classes, promotions, spells, skill books, other skills' rules) and how many characters have a value of it stored. Choose for each whether it forgets the skill or uses another skill instead (a promotion's requirement or a gathering spot's skill can only be moved to another skill; a rule can't be moved to an ID with a space). If anything that uses it changes after the list was made, the removal is refused: look again. Characters keep their values: if the skill returns, so do they. A skill one of the game's rules names (parry, fishing, the crafts…) can't be removed until that rule points at another skill (the **Skills the game uses** tab).
- A save that would bring a new problem (an XP skill with no curve, a rule naming something that does not exist) is refused and named by the form's labels (`How it goes up, Killing a monster: Chance to go up, step 1`). A skill someone else changed while you were editing it says so, and saving it is refused.

#### Classes and new characters

The other tabs work as in [How the content pages work](#how-the-content-pages-work):

- **Classes:** the classes characters belong to and are promoted to, listed by name and number.
- **Starting classes:** the classes a new character can pick.
- **New characters:** making a character (the choices and limits on the creation screen), starting out (a new character's HP, SP and first bag), levels and XP (how characters level up), and weapon training (which skills each weapon trains).
- **Skills the game uses:** which skill each of the game's mechanics reads (parrying, fishing, the crafts…). A mechanic with no skill is off.

### The Gathering & Crafting page

**Control Panel → Gathering & Crafting** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) edits chopping, mining, fishing and farming, what the Classic crafting stations make, the recipe stations and recipes of the crafting window, and the masterworks every craft can make.

#### Gathering

The **Gathering** tab chooses what players can harvest with tools, and how fishing and farming work (dataset `gather`). The list on the left has the **harvestable tiles** (each a harvest node, named by its tool action and tile, such as *Chop Tree*, with the tile's picture) and, under **Other activities**, **Fishing**, **Farming** and **Swings per harvest**. Until you pick one, the right side asks you to. Each tab has a help line under its title, rarely used fields are folded under **More options** (open by themselves when one has a value), and a dot on a tab means it holds more than the basics.

- **A harvestable tile** has seven tabs. **Tile**: the tile and what it **turns into**, with both pictures, and whether it **grows back** by itself (each choice says about how long that takes on average); under More options, the ground it must stand on. **Tool**: the **tool action** (chop, mine, dig, farm), with the tools that can do it now; under More options, **Only these tools** (exact item names) and the **lowest tool tier**. **Skill**: the skill that sets the swings a harvest takes, whether each harvest trains it, and a requirement (a skill or the character level, with the message players get); under More options, **XP per harvest** for an XP skill. **Harvesting**: how a swing harvests, how many harvests the tile gives and when it comes back (below). **Drops**: the **drop table** it rolls (an item at **1 in N** per harvest, with **Better odds with more skill** rows; a table other tiles share says so; naming an existing table only points the tile at it, and editing it saves the table with the revision the form loaded) and whether a harvest can dig up the buried treasure. **Sounds and effect**: the swing and harvest sounds (their channels under More options), and the **strike effect** everyone nearby sees on the tile at each swing, with how many of its frames play (its pictures are uploaded on **Effects**). **Odds**: see below. **+ New harvestable tile** adds one; **Remove this harvestable tile** takes it out (its regrowth pair goes, unless another tile turns back the same way). See [Tools and gathering](modding.md#tools-and-gathering).
- **Grows back** offers the tile checks only: a check that drops farming produce (Classic's `DoVeg`) never takes a tile. A pair another tile still uses stays when a tile moves or goes.
- **Skill rows read "from skill N".** A row applies from that skill value on, and the last row the skill reaches wins. The data stores the row as "above N − 1", so a row the pack wrote as `gt: 10` shows as *from skill 11*; what is saved is the same.
- **Harvesting** says how a swing harvests: **after a set number of swings** (the shared **Swings per harvest** table, as in 1.6), or **by a chance on every swing, better with skill**: the chance at a few skill levels in percent (a straight line between two levels, flat past the ends, so 25% at 1 and 90% at 99 gets steadily quicker), and **Better tools add**, percentage points for each tier the tool is above the tile's lowest. **Used up 1 time in … harvests** lets a tile give several harvests before it turns (8: about eight logs from an oak; empty: every harvest turns it), and **Comes back after (seconds)** turns a used-up tile back on a timer, whether or not anyone is there, kept across a restart. Leave them as they are for the classic game; set them for RuneScape-style skills (see [the example](modding.md#example-runescape-style-gathering-and-crafting)).
- **Odds.** For every skill value from 0 to 100 (runs that read the same folded into one row) and each tier of the tools that can work it (only the tile's own tools, when it names them): whether it can be worked (a lower tier or a requirement refuses), the swings per harvest (an average, "about 8", for a tile harvested by chance), the harvest chance per swing, the drop chance per harvest, the drops per swing and the XP per harvest for an XP skill. Fishing's **Odds** tab gives the bite chance per cast and the fish caught at each Fishing value. Both are worked out from the form as it is, before you save.
- **Fishing** has **Fishing** (the water tiles, the catches before a spot runs out and the message then, and **What trains Fishing**: each cast, caught or not, as in 1.6, each catch, or both; the bound Fishing skill trains from its gather progression), **Splash and sound** (the effect everyone nearby sees on the water at each cast and how many of its frames play, its pictures uploaded on **Effects**; the sound everyone nearby hears; under More options, the sound's channel and where the splash lands, in pixels from the fisher, for each way they face), **Catches** (the catch pool: each fish, the Fishing skill it is caught **from** and, optionally, **below**, its **weight** among the fish in range, a fish of weight 3 caught three times as often as one of weight 1, **Only with** for fish only some fishing tools catch (a harpoon's sharks), and, for a Fishing that rises by XP and trains on catches, the **XP** a catch gives in place of the skill's own; ranges may overlap, so a skilled fisher can still catch small fish; the **Odds** tab shows each fish's share at every skill value) and **Bites** (the bite chance by skill). **Farming** has **Seeds** (the tilled-soil tiles seeds plant on, and each seed item's planted tile), **Watering** (the watering skill and what each planted tile grows into) and **Crops** (the item each grown tile gives). **Swings per harvest** is the swings a harvest takes by skill, shared by every harvestable tile and by watering.
- **Save changes** saves the open part to the draft and **Undo changes** puts the form back. The header says whether the open tile or activity is the pack's **Original**, **Changed by you** or **Added by you** (a tile is matched to the pack's by the tile it harvests). **Restore the original** saves the pack's version back (a tile's fields, drop table and regrowth; fishing, farming or the swings table), and **Restore this tab to the original**, at the foot of each tab that differs, puts that tab's fields back in the form, to be saved. A save that puts a whole row back to exactly the pack's leaves no change of yours behind. **Cancel unpublished gathering changes**, beside the draft line, takes every gathering change out of the draft. Saves are refused when someone changed the part since you opened it, or when they would bring a new problem (a skill or drop table that does not exist); a refusal names the field by its label (*Node 2: Only these tools 1*). New kinds of activity (swimming, say) need code.

#### Recipes and recipe stations

The **Recipes** and **Recipe stations** tabs build crafting that plays like RuneScape's smithing, cooking, fletching and herblore, through a crafting window, beside the Classic crafts below. Both are lists with Search and **New**, beside the open entry's form, and work as in [How the content pages work](#how-the-content-pages-work). Classic has none.

- A **recipe station** has a **Name** (the window's title), the station items players **Stand at** and press Ctrl to open it (an Anvil, a Furnace), or items they **use from the bag** to open it anywhere (a Knife), the **Tools** it takes, each with a **Tier** (held or in the bag; the best one counts), and whether **Recipes above the player's level** are **Hidden** or **Shown locked**. One item opens one station: the checks before publishing refuse an item named by two.
- A **recipe**'s form has tabs. **Recipe:** its name, where it is **Made at**, the **Group** it is listed under, and under More options whether it is hidden or shown locked above the player's level and the recipe book it is **Learned from** (a recipe with one must be learned by using the book; a quest teaches it by giving the book as its reward). **Materials:** what one craft uses up and what it **Also needs** but keeps, each with how many. **Tool:** the **Lowest tool tier**, and what each tier above it adds to the odds and takes off the time. **Skill:** the skill it needs and trains, the **Level needed**, and the **Skill XP** a success gives a skill that levels by XP. **Odds:** the **Chance of success by skill** (left off, it never fails) and **How long one craft takes**, in frames at a few levels. **Output:** what it **Makes** and what **A failure makes** (a burned fish; left off, nothing). Under the form, **Odds and time by level** shows the chance, the time and the XP at a range of levels, worked out from the form before you save.

In play, the window lists the station's recipes by group with a search box: those the player can make stand out, those missing materials or a good enough tool are greyed, and those above their level (or not learned) show a lock, unless the station hides them. Picking one shows its picture, level, XP, chance and materials (held/needed). **Make 1**, **5**, **10**, **Make X** and **All** make that many one after another; walking away, turning, attacking or **Stop** ends it, as do running out of materials and a full bag.

#### Masterworks

The **Masterworks** tab lists the better items any craft can make, as Classic smithing makes a `Plate Armor +1`. Each row names the **Item** a craft makes, its **Chance by skill** (in percent at a few levels of the crafting skill, in a straight line between them) and its **Masterworks**, each with a **Weight** (weight 3 comes up three times as often as weight 1). Whenever any craft makes the item (a recipe, cooking, a brew, a build, or a repair the Classic smithing table has no masterworks for) and succeeds, it may come out as one of them instead; a failure never does. Name each masterwork after its item with a +N ending (`Leather Armor +1`), and add it on the Items page with its picture: it keeps the item's abilities, needs and worn picture and adds N to its armour or attack. **Chance by level** under the form shows the chance at each level and each masterwork's share. A masterwork is made from one item only, and is not itself an item with masterworks: the checks before publishing refuse either. The crafting window shows a recipe's masterwork chance. Classic has none.

#### Classic crafting

The **Classic crafting** tab is a card of the Classic crafting stations (smithing, cooking, alchemy, carpentry and the rest): what each makes, from what, and at what skill. It works as in [How the content pages work](#how-the-content-pages-work). Each cooking recipe, potion, repair and set carpentry recipe can have its own **Skill needed** (a skill or the character level, refused before it starts), and each cooking recipe, potion and set carpentry recipe its own **Chance of success by skill** in percent at a few levels, in place of the shared **Chance of failing** (100 from a level: it never fails from there, as RuneScape's stop-burn level). **Set recipes** under Carpentry make exactly one item from the item built with (Oak Logs into an Oak Shortbow) in place of the bands' roll. A recipe's **Skill XP** pays a skill that levels by XP.

### The Houses & Vehicles page

**Control Panel → Houses & Vehicles** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) edits the houses players build, their doors, keys and chests, and the vehicles they sail. Its tabs work as in [How the content pages work](#how-the-content-pages-work):

- **House types:** each kind of house players can build: its size and tiles.
- **Deeds:** the deeds players use to build a house or a vehicle (the deed's item, and the house or vehicle it builds).
- **Vehicles:** each vehicle: its tiles, boarding, picture, rider, full hull and cannon.
- **Hull and cannon:** a card of the hull one hit takes and the hull a parked vehicle mends each minute, and the cannon's damage and reload. Each vehicle's full hull is set on the **Vehicles** tab with the rest of the vehicle; the card names each with a link to it. A lowered full hull lowers a rider's hull at once when it is published. Each value shows its **Original** (the installed pack's value, or the engine's default in a Minimal world), and what **players have** now when that differs. A value outside its limits can't be saved, and the error says the limits. **Save changes**, **Undo changes**, **Restore the original** and **Cancel unpublished changes** work as on the Game Rules page's Numbers tab ([The Game Rules page](#the-game-rules-page)).
- **Building:** placing a house (where it may go), building it, the outline shown while placing, what happens to its furniture, and how houses decay when not kept up.
- **Doors, keys and chests:** house keys, switches that open and close doors, when doors lock again, chests and other containers in houses, what clicking a fixture does, and how resting in a house heals.

### The Quests page

**Control Panel → Quests** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) edits the quests NPCs give, as cards (see [How the content pages work](#how-the-content-pages-work)): **Quest pools** (when a quest is finished, the next one is picked from these), **A new world's quests**, **Quest chest** (the chest quests fill) and **Quest replies** (what NPCs say about quests). A new world's quests only seed a brand-new world: once a world has started it keeps its own quests, and each finished quest rolls the next from the pools, so change the pools to change what NPCs ask for.

### The Community page

**Control Panel → Community** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) edits factions, guilds, chat, mail, the message boards, the newspaper, the casino and the help players read. Its tabs work as in [How the content pages work](#how-the-content-pages-work):

- **Factions:** the factions players can join, with their leaders, heads and perks.
- **Faction rules:** what every faction shares (tiers, perks and the World Editor's spawn boxes), player killing, the Assassin's Game, medals and the high score tables.
- **Guilds and friends:** making and running guilds, the buddy list and players' Bio windows.
- **Chat, mail and news:** chat rooms and their rules, mail, the message boards, the art tools and the newspaper.
- **Casino:** the Slot Machine's payouts and sounds, and Blackjack's and Checkers' rules.
- **Help topics:** the topics `/help` shows. The Help topic is also the greeting a character gets on logging in.

### The Game Rules page

**Control Panel → Game Rules** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) edits the rules for the whole game, the ones that are not one item's or one creature's, in plain words. Its **Numbers** tab shows one card at a time behind tabs (with **All** for every card); a dot on a tab marks a card with values changed by you. **Search** at the top looks across every card for the values whose names hold every word typed ("cannon", "parry", "hunger"), whichever tab is chosen, and the tab comes back once it is cleared. It has six cards (the spell amounts and buffs are on the [Spells](#the-spells-page) page, and the hull and cannon on [Houses & Vehicles](#the-houses--vehicles-page)):

- **Regeneration, hunger and death:** the regeneration timer (a faction's regeneration perk comes off it; the counter starts at 1, so regeneration acts every that − 1 frames, which the page shows: Classic's 149 is every 148 frames) and the HP and SP each period regenerates or starves; the chance hunger falls each frame and how much it falls (0: nobody gets hungry), the hunger above which you regenerate and below which you starve, where you are stuffed (Use is refused and the item kept) and whether that refuses every usable item, as in 1.6, or only food (an item that only lowers hunger, or one marked **Can be used when full** on the Items page, never is), the most hunger can be (nothing goes above it: food and spells stop there, a new character and a death start no higher, a character saved above it is brought down to it; Classic's 50000 is its starting hunger), hunger after a death, the warnings players are told as hunger falls (one a line: `1500: You are very hungry.`), how much a full stomach protects gear from breaking (one a line: `20000: 10` adds 10 to the break roll above 20000; empty: hunger makes no difference), and whether players see their own hunger on the Stats tab (never, as in 1.6, in words, as a percentage of full, or as a number; a percentage is of the most hunger can be); and the HP, SP and pause a death leaves. Hunger's thresholds must stay in order: starve below regenerate, regenerate at most stuffed, and stuffed and the hunger after a death at most the most hunger can be. A new character's hunger (Skills & Classes, **New characters**) above the most hunger can be starts at that. The card also shows resting in a house, which the Houses & Vehicles page's **Doors, keys and chests** tab edits, with **Change it on its page** to open it there. The [character editor](#editing-a-character) takes hunger up to the most the game gives (the Game Rules page's most hunger can be).
- **Death drops and loot:** whose deaths drop gold or one random bag item (never crystals) where they died (Off, Wanted only, Killed by a player, or Everyone as in 1.6; a faction member killed on a PvP map drops the faction's head whatever this says, and a role with the drop-on-every-death permission always drops), whether that is gold or an item (1.6's coin toss), gold only or items only, the most gold a death drops unless the character is wanted (0 for no cap), the level below which nothing drops unless wanted, and how long monster loot stays on the ground, in seconds (player drops and `/drop` items never decay). These were Server Settings before; see [Moved from Server Settings](#moved-from-server-settings).
- **Levels and experience** (issue #42): how kill experience follows levels and how character levels grow. **Experience from kills** picks what the killer's level does: takes its level off the XP (1.6's: a monster gives less as you level), changes nothing (every kill gives the same XP, as in games like RuneScape, which then need a steep level curve), or compares the monster's level with it (a percent more for each level the monster is above you and less for each level below, up to a most percent; a monster with no level counts as your level). Then the XP added to every kill and the extra XP for each threshold the XP is above (1.6: 10, and 10 more for each of 100, 150 … 400), what a monster with no XP of its own gives from its level, and what a name with no species gives. **Character levels** sets the XP for the first levels (a list, 1.6's 30, 400), the formula for the rest (start, plus a number times the level raised to a power, then growing by a percent each level: 1.6's 400 + 2 × level), whether XP is counted from one level to the next (the bar starts again each level, 1.6's) or as a total from level 1, an optional highest level, the HP and SP max each level gives, and whether players see monster levels ("Wolf (level 3)" in the hover tip and an NPC's Bio; monsters already on a map show the change once it is loaded again). A changed curve keeps every character's level and the XP they hold within it: only the XP their level takes is worked out again, at their next login or at once if online, and XP that now reaches it levels them up. A monster's own level and XP are on the Creatures & NPCs page's **Rewards** tab.
- **Timings:** the hit flicker (no other hit lands meanwhile), the wait after a cast, the swing cooldown with no gear that sets one (at least 1 frame), how long a hit still counts as the kill, the wait between pig grabs, how long before a give is picked up, and the wait between monster spells hitting the same players.
- **Combat rolls:** melee damage on a monster below a floor rolls `random(n)` instead, as does a hit on a player (a monster's or another player's) below its floor (each floor at least 1, so a hit always does at least 1); the base roll of a parry or block (it succeeds on a 1, before a little skill moves it onto its ladder); and the chance of 1 in N that a monster next to you attacks each frame, and that walking into a player pushes them.
- **Monsters:** how often a map's monsters move and spawn, by the players on the map. Both rolls are made twice each frame for each player on the map (at most 15 players roll): a slot is picked to move by a roll of 1 to n (a monster moves when the roll lands on its slot, 1 to 4, so a larger n moves monsters less often; n is at least 4, so every slot can be picked), with n for 1, 2, … 8 or more players, and a spawn pass goes ahead with a chance of 1 in n for 1, 2, … 7 or more players. Then a walk's length (`random(n)` steps), each empty slot's chance to spawn in a pass, the slot a faction's member takes on its map (`random(n)`, at least 4; above 4 it takes none), and an NPC's spawn roll (it spawns when `random(n)` is at most the second number, so 2 in 60 of a monster's rate in 1.6). Every roll is at least 1, so each is drawn as before. The card also shows the generic stand-in (the body and defense of a name no species has, such as a player shop's shopkeeper; such a name always starts with 1 HP, whatever the row's `hp` says), which the Creatures & NPCs page's **Rules for every creature** tab edits, with **Change it on its page** to open it there. What each species does is on the [Creatures & NPCs](#the-creatures--npcs-page) page.

On every card:

- Each value shows its **Original** (the installed pack's value, or the engine's default in a Minimal world, which plays the engine's defaults), and what **players have** now when that differs. Times are in frames (1/20ths of a second), with the seconds beside them. A value outside its limits, or not a whole number, can't be saved, and the error says the limits. An amount left part-filled can't be saved either: fill every part or none.
- **Save changes** puts the row in the content store's shared draft, as a row of the `balance` dataset; it is published, undone and listed like any other change, on the [Publish Changes](#the-publish-changes-page) page (**Review and publish…** at the top of the page opens it). The change plays for everyone the moment it is published, with no restart.
- **Restore the original** puts the pack's value back when published (the engine's default when no pack sets one); **Cancel unpublished changes** takes the row's change out of the draft; **Undo changes** puts the fields back as they were. A changed row is tagged **Changed by you**, **Unpublished changes** or **Back to the original once published**.
- A row someone else changed while you were editing it says so, and saving it is refused: undo your changes to see theirs. A row being edited is never overwritten by a refresh.
- When a pack update changes a value you have changed, the row says so; answer it under **Pack updates waiting for you** on the Publish Changes page.

Classic's numbers are 1.6's (and SSO's own for hull wear, the cannon and the death drops, where SSO's defaults are the old Server Settings defaults: only wanted characters drop), so a server that changes nothing plays as before. Saving a row back to the value that plays drops its draft change rather than staging an override.

The page's other tabs are cards (see [How the content pages work](#how-the-content-pages-work)):

- **Currency and bodies:** the item players carry as money, what a cannon shot spends, and the bodies Morph, Nature Shift and Smoke Bomb put on a player.
- **Tiles:** the tiles players can walk on, and the tile rules every map shares (what tiles do unless a tile says otherwise). Each tile's picture, name and flags are on the Pictures & Sounds page's [Tiles](#tiles).

#### Moved from Server Settings

The Items page of Server Settings held the death drops (`deathDrops`, `deathDropKind`, `deathDropGoldCap`, `deathDropMinLevel`) and how long monster loot lasts (`lootDecay`). They are now the Game Rules page's **Death drops and loot** card (the `balance` dataset's `drops` row), and the Items page says so. On the first start after the upgrade, a server whose operator changed any of them gets those values as a published change, listed under Publish Changes as "Moved from Server Settings: death drops and loot decay" by `system`, and the settings rows are deleted; the values it did not change take the pack's (the same defaults as before). Undoing that publish puts back what played before it: the pack's values (on a world with no pack value, such as Minimal, the engine defaults). Values equal to what already plays move nothing and are just deleted. If the server has a `drops` row of its own by then, the old settings are deleted without a publish, since the row already says what plays. An open draft of the row is rebased: a value the draft left alone takes the moved one, and a value both the draft and the move changed keeps the draft's, which the server log names ("the draft also changes balance/drops: who …"), so publishing that draft replaces the moved value; check it first. If the move cannot publish, the settings rows stay, their values keep playing, the log names why, and the next start tries again. A stored value the old setting ignored (outside its limits, or not valid) never played, so it is dropped. Scripts that wrote these keys to the `settings` table should edit the `balance` row instead.

### The Pictures & Sounds page

**Control Panel → Pictures & Sounds** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) holds every picture and sound the game uses: item pictures, worn pictures, creature bodies, spell effects, tiles and sounds. **Show** picks one kind at a time. To change one item's, creature's or spell's picture, its own page is easier: the same panels are on the Items page's **Picture** tab, the Creatures tab's **Picture** and above each spell's form on the Spells page.

#### Art and sounds

**Show: Upload files** uploads PNG pictures and WAV, MP3 or OGG sounds (older Safari versions cannot play OGG). Each file is checked as it arrives (a real PNG of at most 2048×2048 pixels, or a real sound, at most 5 MB) and stored in the `<database name>-content/` folder beside the database (`sso-content/` for `sso.sqlite`) under the SHA-256 hash of its bytes, which the table shows with a preview. A stored file does nothing until an **art row** in the draft names it and the draft is published; then every player sees or hears it at once, without a restart or a new client, and undoing the publish takes it back. Rows live under the `art` dataset, one field per kind:

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

| Kind | Where | Shape |
|---|---|---|
| Item pictures | An item's **Picture** panel (the Items page's Picture tab); **Item pictures** for many at once | One PNG, at most 512×512 |
| Worn layers | A worn item's **Worn picture** panel; **Worn pictures** | 15 frames at most, each within 46×45, or one 184×180 sheet |
| Monster bodies | A creature's **Body** panel (the Creatures tab's Picture tab); **Monster bodies** | 16 frames, or one 4×4 sheet of equal cells up to 512×512 |
| Spell effects | A spell's **Effect** panel (on the Spells page); **Spell effects** | A run of frames (and its trail), or one strip |
| Tiles | **Tiles** | 32×32 PNGs, or tileset sheets cut into 32×32 tiles |
| Sounds | **Sounds** | WAV, MP3 or OGG, at most 5 MB |

#### Item pictures

Open an item on the Items page and its **Picture** tab shows what it draws now, with previews in the bag, in the equipment box it is worn in and on the ground:

- **Upload a PNG** to give the item a picture of its own. The page fills in the rest: the transparency (the picture's own see-through pixels, or "pure green is see-through" when it is fully opaque and holds pure green, as 1.6's art does) and the anchor, which centres the visible pixels on the item's tile as Classic's icons sit. Drag the picture on the ground preview, or type the anchor, to move it. The ground preview draws the hit box (the box round the visible pixels) and the anchor. The panel refuses what the server would (nothing visible, larger than 512×512) and warns about a picture bigger than a bag slot (32×32) or an equipment box (35×35), one with no see-through pixels, and an edge whose every pixel is nearly invisible (fainter than 32 of 255), which still counts in the hit box. **Download a 32×32 template** gives a pure green square to paint on.
- **Use this picture** makes the item draw a picture the game already has, a pack's or an upload, by setting its `sprite`. Nothing is uploaded.
- **Save the picture to the draft** writes the item's `art/items` row, named by its key. Each change is made as a whole against the draft as it is at that moment: only the item's `sprite` and its upload change, so another admin's edit to the row is kept. An item that borrowed another picture through `sprite` stops borrowing it, so the upload is what it draws. **Remove the upload** takes the row out; a pack picture of the same name shows again.

Some views show a shared picture in place of an item's own, and the panel says so: containers in the bag (`CabinetBag`, `CrateBag` …) and once placed, crystals on the ground, maps (the `map` [behaviour](modding.md#item-behaviours)), clocks, and a player's paintings and photos. The currency's panel also offers its three ground piles, `SmallGold`, `MediumGold` and `LargeGold`, whatever the currency is called. A pile is pasted by its top-left corner, 1 px inside its tile, as 1.6 did, so draw it on the template where it should sit.

**Show: Item pictures** uploads many at once: choose PNGs named after their items (`Iron Sword.png`), and each is matched to an item key, then to the name players see, ignoring case (retired items take none). Files that match nothing are listed with a box to pick their item. A file for an item that already has a picture replaces it only while its **Replaces** box is ticked (it starts ticked). **Attach to their items** puts each picture in the draft with the page's transparency and anchor. Two files for the same item wait until you pick a different item for one of them. Below, **Items without a picture** lists every item that is not retired and will have no picture once the draft is published; choose one to open it on the Items page.

An item has a picture when the art draws its `sprite`, or its key: only those can be made with `/drop` and the World Editor. Removing an item also removes its upload, unless another item still draws it; retiring it keeps the picture, since players still hold copies.

#### Worn layers

What a character wears is drawn from **worn layers** (1.6's paperdoll), one 46×45 picture per frame pasted at the character's top-left. An item draws the layer named by its key, unless a `paperdoll.aliases` row in the item rules renames it (Classic draws the Knight's Sword as the Broad Sword, and every ring as nothing). The engine draws `DEFBOD` (the bare body), `Bare Feet` and each sex's `Head<n>` itself. The frames a layer needs depend on where it is worn:

| Worn | Frames |
|---|---|
| On the head, body, feet or hands (gloves are worn in the ring slot), and the engine's layers | 15: F1-F3 facing north, east, south and west, and F4 (attacking) facing north, east and west |
| As a weapon | 12: no F1-F3 facing north (a weapon facing north shows only when it swings) |
| In the off hand (a shield or a quiver) | 11: nothing facing east |
| In the off hand, hidden facing north (the `hiddenFacingNorth` behaviour, Classic's Torch) | 7: south and west only |

A worn item's **Picture** tab has a **Worn picture** panel, and **Show: Worn pictures** lists every layer the content draws, with who draws it and whether its frames come from your upload or a pack; choose one to open its panel. The panel says which layer the item draws, through which alias rule, and which other items share it (an upload repaints them all). When only exact alias rows name the item and taking them out changes no other item's layer, **Give it a layer of its own** takes them out of the draft's item rules; anything else (a rule that matches other items too, such as a name containing "Ring", or an upgraded copy like `Knight's Sword +1`, which draws its base item's layer) is changed by hand.

- **Upload** separate PNGs named like `Moonblade-f1-e.png` (added to the frames the layer already has), or one 184×180 sheet: four rows, north, east, south and west, of four frames, F1 to F4, each a 46×45 cell. The server cuts a sheet into frames and leaves out blank cells and F4-S; a sheet replaces every frame. **Download a guide sheet** gives the bare character in each frame the layer needs, with the frames the game never draws greyed out: draw on a layer of your own above it and export only that layer.
- The preview walks and attacks the character facing all four ways, with the layer stacked where the game stacks it (a weapon facing west goes behind the body), shows it as the inventory's paperdoll does, and lays out every frame: a frame the layer's wearers need and it lacks is outlined red, and one the game never draws is hatched grey. The panel refuses a frame larger than 46×45 and warns about one that shows nothing or is never drawn.
- **North frames are drawn 1.6-style** starts ticked. 1.6 drew back views as if seen from the front (from behind, the weapon looks to be in the left hand), and old 1.6 art is drawn that way, so the game flips each north frame about the body's centre line when it builds the art. Untick it for back views drawn the right way round. A flipped north frame must leave its last column (column 45) empty.
- **Save the frames to the draft** writes the layer's `art/paperdoll` row with every frame it keeps (a frame the layer's wearers never draw, and F4-S, is left out); **Remove the upload** takes the row out, and a pack's layer of the same name shows again. A draft may hold a set that is not finished yet, but publishing waits until it has every frame its wearers need.

The section's bulk upload takes many layers at once: frames named `<layer>-f1-e.png` and sheets named `<layer>.png`, where the name is an item's key, the name players see (each standing for the layer the item draws) or a layer's own name, ignoring case. Files that match nothing are listed with a box to pick their layer (a new name starts a layer nothing wears yet); a layer that already has frames is replaced only while its **Replaces** box is ticked. The list checks every frame before anything is attached. Frames added to an upload keep its transparency and its 1.6-style setting; a sheet replaces them with its own and the section's box. Removing an item also removes its own worn layer, unless something else still draws it; retiring it keeps the layer.

#### Bodies

A monster (and a Morph, the tree a Nature Shift makes, a rider of each vehicle) is drawn from a **body**, named by its number: 16 frames, walking F1 to F3 and attacking F4, facing north, east, south and west. Monsters only walk; F4 shows when a player morphed into the body attacks. A frame stands where a player stands: its middle on the tile's middle and its bottom 5 px below the tile, so a 46×45 frame lines up exactly with a player's character. What shows of each frame is its hit box.

A creature's **Picture** tab has a **Body** panel, and **Show: Monster bodies** lists every body the content draws, with who draws it and whether its frames come from your upload or a pack; choose one to open its panel, or **New body** to make one. Operators never type a body number: the server gives a new body the first free number from 1000 when it is saved (with a clear message once 1000 to 9999 are all taken).

- **Upload** separate PNGs named like `Orc-f1-e.png`, or one sheet: four rows, north, east, south and west, of four frames, F1 to F4, every cell the same size (up to 512×512), so the sheet's width and height divide by 4. The server cuts a sheet into its 16 frames. **Download a guide sheet** gives 46×45 cells with a player and their tile drawn faintly.
- The preview walks and attacks the body facing all four ways on its tile with the hit box drawn, stands it beside a player for scale, and lays out every frame. Drag the body beside the player (or type **Move right** and **Move down**) to move every frame together. A body needs all 16 frames; the panel refuses a frame larger than 512×512 or one that shows nothing, and warns about a nearly invisible edge (it is still clickable).
- **North frames are drawn 1.6-style** starts ticked, as for worn layers: the game flips each north frame about the body's centre line (taken from F2 facing north). Untick it for back views drawn the right way round.
- On a creature's Picture tab: when the monster's body is your upload and nothing else draws it, saving replaces it. When its body is a pack's, or shared with other monsters, **Save as a new body for** the monster makes a new body and gives it to the monster in the same change, and **Repaint body N for all who draw it** replaces that body's picture for everyone (over a pack's body, the pack's comes back when the upload is removed). **Or give it another body** picks any body there is, with a preview. Before either repaint, the panel names everyone who draws the body. Replacing a monster's own body is refused if another admin has given that body to something else meanwhile. **Remove the upload** takes a body's upload out; a publish is refused while content draws a body that no pack or upload supplies (a gap the published content already had, such as a pack's monster with no art, is left alone). The server checks every frame again before saving it (a stored PNG, at most 512×512, with something showing), and players already on a map see a monster's new body as soon as the publish goes live.

The section's bulk upload takes many bodies at once: sheets named `<monster>.png` and frames named `<monster>-f1-e.png`, where the name is a monster's key or the name players see (ignoring case), make that monster a new body, or replace its own upload while the box is ticked; files named after a body's number (`55.png`, `55-f1-e.png`) repaint that body. The list checks every frame before anything is attached. Removing a monster also removes its uploaded body, unless something else still draws it.

#### Spell effects

A spell's effect is drawn from **effect runs**, named by their member: `Crush` draws `Crush-1` … `Crush-30`. A run steps two frames a tick and the screen draws once a tick, as in 1.6, so players see frames 1, 3, 5 … (20 a second); every frame still counts for hits. How many frames show is set by the run's row in the spell's `fx` list: a run placed at the click shows frames 1 to its `lastFrame`, then goes; a projectile (a row with `projectile`) cycles frames 1 to 3 as it flies. Firebolt, Hold and Smoke Bomb's effects are followed by a **trail**, `xFirebolt-1` …, for as many frames as the run shows (up to 16, 7 and 15). The engine draws a few runs of its own with fixed lengths: fishing's splash (`Fishing`, 13), smithing's sparks (`BSmith`, 13), the slot machine's (52) and gathering's sprinkle (5), an arrow in flight (`<colour> Arrows<L|R|U|D>`, 1) and the Battleship's shot (`CannonballShot<L|R|U|D>`, 4). What shows of each frame is its hit box, so a spell's frames are also where it can hit. Each spell's effect acts on one set frame of its run, so a run must show at least that many: heals, buffs, Portal, Morph, Nature Shift, Smoke Bomb, Hold, Firesword, Inxition, Create Food, Diminish Hunger, Magic Shield and Argon's Fist act on frame 3, Radar on 5, Dispel Illusions on 8, Stone Skin on 9, Firebolt on 12, Meteor on 13 and 19, Crush and Splash on 18, and the projectiles (Fireball, Bolt, Wind Wave) on frame 1.

An open spell on the Spells page shows its **Effect** panel (with a choice of run when the spell has several, such as Fireball's four directions), and **Show: Spell effects** lists every run the content and the engine draw, with who draws it, how many frames show, and whether they come from your upload or a pack; choose one to open its panel, or **New effect** to name and upload a run no spell uses yet.

- **Upload** separate PNGs named like `Crush-1.png` (a trail's like `xCrush-1.png`), or one strip of equal cells, each up to 512×512, read left to right and top to bottom: the run's frames on its first rows, wrapping onto as many rows as it needs, then the trail's frames starting on the row after. An upload may be at most 2048 px a side, so a long run wraps (21 cells of 96 px fit across). The page guesses the layout from square cells and the frames the run shows; type **Frames across**, **Rows of the run** and **Rows of its trail** and **Cut the strip again** for any other. Trailing blank cells are dropped, so a trail can be shorter than its run, but a blank frame inside a row is refused. Frames named by number replace only themselves (in a run's panel, `x<run>-<n>.png` is always its trail's frame); a set that starts at frame 1 replaces the whole run. **Download a guide sheet** gives a strip in that layout (96 px cells, up to 21 across), with the target tile, a player standing on it faintly and the effect's point marked in each cell.
- Every frame of a run is anchored at the same spot. By default the first frame's middle lands where the run it behaves as (its row's `effect`) lands, or on the target tile's middle when there is no such art. Drag the frame beside the player (or type **Move right** and **Move down**) to move them all. The preview plays the run as the game shows it (every other frame, 20 a second) beside a player, flying along its axis when it is a projectile, with each frame's hit box; below, every frame is laid out, with a frame that is wrong outlined red and one that is never shown greyed out.
- From a spell's panel, **Spell plays all N frames** (ticked) sets the run's row to show every uploaded frame (`lastFrame` and `frames`) in the same change; the panel says this also changes how long the effect shows, and can hit. It is refused below the frame the spell's effect acts on, and so is a publish that leaves a spell's `lastFrame` below it. Unticked, the upload needs at least as many frames as the row shows, and frames past them are never shown. A projectile still cycles frames 1 to 3.
- **Save the frames to the draft** writes the run's `art/fx` row (with its trail, if one was uploaded; without one, a pack's trail of the same name keeps showing). Before a save that repaints a run something draws, the panel names everyone who draws it, and the save is refused if that has changed meanwhile, or if another admin saved the run's upload since the panel opened (reopen it to see theirs). The server checks every frame again before saving it (a stored PNG, at most 512×512, with something showing). **Remove the upload** takes the row out; a pack's run of the same name shows again. An uploaded run, and an uploaded trail, is the whole of it: a pack's frames of the same name after its last are neither drawn nor hit.
- A publish is refused while a spell shows frames that no upload or pack has (a new spell whose run has no art yet, or an upload with fewer frames than its row now shows; a pack's frames never fill in after an upload's last). A gap the published content already had is left alone. An effect already playing when a publish shortens its run stops at the new last frame.

The section's bulk upload takes many runs at once: strips named `<run>.png` (square cells only) and frames named `<run>-1.png`, with the trail's `x<run>-1.png` beside them, matched to runs by name, ignoring case; files that match nothing are listed with a box to pick their run. For a spell's run, **spell … plays every frame** starts ticked. The list checks every frame before anything is attached. When a spell's removal is published, the uploads of the runs only it drew go with it (discarding the removal leaves them as they were). Files chosen in the list and not yet attached count as unsaved changes, and **Discard** stops a batch still attaching.

#### Tiles

A map is painted with **tiles**, each a 32×32 picture pasted at its square's top-left on any of the map's layers and named by a code. **Show: Tiles** lists every tile in the catalogue with its picture, code and name; type in **Find a tile** to narrow it by code or name, and choose one to open its panel:

- The panel says where its picture comes from (your upload or a pack's), where it is used (every map that has it, and the content rows that name it: the blank map's tiles, gathering nodes, fishing water, farming, regrowth, houses, the newspaper stand), and previews it in a 3×3 patch of itself and between two squares of the map's ground tile, with a player standing on it when it is walkable.
- **Name** is what the playfield's hover tip calls it on layer 2; leave it empty for ground and scenery, so most of the map shows no tip. **Walkable** puts it on the walk list (players on foot can stand on it), and the flags give it the meanings in [tile flags](modding.md#tile-flags-and-defaults). **Save changes** puts them in the draft; once published, the server's walk checks, the maps players are on and their clients use the new rules at once.
- **New picture** takes a 32×32 PNG (the panel refuses any other size, or one that shows nothing with its transparency, before it uploads); **Save the picture** repaints the tile everywhere it is used, as the panel lists. Over a pack's tile, **Take the upload out** brings the pack's picture back. A save or a removal is refused if another admin changed the tile since the panel opened (reopen it to see theirs); a panel you have not touched catches up by itself. A publish is refused while any tile picture shows nothing, however it was written.
- **Take the tile out of the catalogue** works only for a tile no map and no content row uses; the panel names what still does. Its walkable row and upload go with it when the draft is published (discarding the change keeps them; a tile added and taken out before it was ever published leaves nothing behind), and a publish is refused while a map or content row still has a tile the draft takes out. The checks on Publish Changes show that before you publish, and the same check refuses an **Undo**, or taking a pack's version of the catalogue, that would take out a tile a map now uses. A code is never given out again once a publish has had it, even after an undo. A tile added and taken out before it was ever published leaves the draft as it was. Classic's catalogue also lists a few engine fixtures by longer names (`CHURCH`, `BTileX`): they can be named and flagged, but not made walkable or given a picture.

**Add tiles** makes new tiles from PNGs. A file may be a single 32×32 tile or a tileset whose sides are multiples of 32 (at most 2048): every square that shows something becomes a tile of its own (at most 512 a file), and blank squares are left out. The page checks each file's size before it uploads it, guesses its transparency (its own, or 1.6's pure green), and lists every tile it found with a box to leave it out, a name (empty by default) and whether it is walkable (from **New tiles are walkable**). A one-tile file named after an existing tile's code or name (`S3.png`, `Tree.png`) repaints that tile instead; a name several tiles share matches none of them (name the file after the code), and two files for the same tile wait until you untick one. **Download a 32×32 template** gives one tile of pure green. **Add the tiles** puts them in the draft: the server gives each new tile a code, two capital letters or digits that no pack, content row, upload or map uses (so a code left on a map after its tile was taken out never comes back as another tile), and adds its catalogue, walkable and picture rows in the same change. Codes never change. A big tileset goes in as several changes, each small enough for one message; lines that were not saved stay in the list with the reason, to try again. A publish is refused while the catalogue has a new tile no pack or upload draws.

New tiles have no `member`; the World page's palette lists them with Classic's, in catalogue order (find them by code or name). A publish redraws the open palette and the maps on screen with the new tiles, with no reload.

#### Sounds

**Show: Sounds** lists every sound the world plays: the ones content rows name (spell runs, gathering's hit and success sounds, weapon swings, the casino) and the ones the engine plays by name (a hit, a kill, the shop's cash, the slot machine, the blackjack cards, a cannon shot, fishing's splash, smithing, mixing and building, the church bell, a class promotion). Each line says where the sound comes from (your upload, a pack's, or **Missing**, which plays nothing), who plays it, and has **Play**. Type in **Find a sound** to narrow it by name or by who plays it. The game frame's own clicks (`Clicksound`, `Clicksound2`) are the engine's: they are not listed, and no sound may take their names.

- Open a sound to hear it as the draft would publish it (and the pack's, while your upload replaces it). **New file** takes a WAV, MP3 or OGG of at most 5 MB; the page checks its type, its size and that the browser can play it before uploading it, and the server checks its opening bytes again. **Save the file** puts it in the draft, replacing the sound for everyone the panel lists. **Take the upload out** brings a pack's sound back; it is refused when no pack has the sound and something plays it, since that would leave it silent. A save or a removal is refused if another admin changed the sound since the panel opened (open it again to hear theirs).
- **A new sound** takes the name content will play it by (case is ignored, so `Boom` and `boom` are one sound) and opens its panel to give it a file. Name it in a content row (a spell run's `sounds`, a gathering node's `hitSound`, …) to use it.
- **Add sounds** uploads many files at once: a file named like a listed sound (`fireballs.wav`) replaces it, any other name makes a new sound under that name, which you can change before adding. Two files for the same sound wait until you untick one. Each line keeps the upload it saw when its file was read, so one another admin replaced meanwhile is refused, not overwritten; lines that were not saved stay, with the reason, to try again.

A publish is refused while content newly plays a sound nothing supplies (no pack has it and no upload will), and while it takes away an upload something still plays with no pack sound behind it. What already played a sound without a file is not held up by it (a Minimal world has none of the engine's sounds), but anything newly set to play it is: adding Classic's slot machine to a Minimal world asks for its `SlotMachine` and `cash` sounds first. The same checks refuse an **Undo** or taking a pack's version that would leave something silent. Players online load the new sounds with the publish: a replaced sound plays its new file from then on and never its old one (it is silent while the new file decodes, or if their browser cannot play it), and a sound already playing finishes. Older Safari cannot play OGG, so WAV or MP3 reach every player.

### The Publish Changes page

**Control Panel → Publish Changes** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) is where the changes saved on the other content pages are reviewed and published. It opens on **Unpublished changes**; its other tabs are **History** and **Find problems**, and **Where it is used** appears while a row is open. Installed packs are on the [Packs](#the-packs-page) page, and pictures and sounds on [Pictures & Sounds](#the-pictures--sounds-page).

- **Pack updates waiting for you** (at the top of **Unpublished changes**, whose tab then carries a dot): when a newer pack version changes a row you have changed, your version stays live and the row is listed with what the pack changed and how yours differs, one plain line per value ("SP cost: 40 → 41", "Drops: added Gold Ring"). **Use Classic's version** replaces yours (as a publish you can undo); **Keep mine** stops the notice. Rows you never changed take the new version on their own. An item definition (dataset `items`, part `definitions`: one item's rules in one record, see [Item definitions](modding.md#item-definitions)) is noticed when the pack changes what its own rules play for that item: the notice says your definition still plays, and **Use Classic's version** drops the definition so the item plays the pack's rules again.
- **Unpublished changes** (the tab counts them, "Unpublished changes (3)"): the changes saved on every content page, shared by every admin and tagged with who made them. A change reads "Item: Ale", with its path (`items/items/Ale`) shown when you point at it. Clicking a change opens it on the page that edits it (an item on Items, a spell on Spells, a house type on Houses & Vehicles…), on the right tab; a change no page edits (the collision rects, built from the art) opens on **Where it is used**. **Cancel this change** takes one out. An optional **Note for the history** says what the publish changes. Before publishing, the whole store is checked: each dataset against its schema, then the key and name rules (a new item's key is the name it was created with and never changes; display names are unique; a key may not contain `#`, start with a number and a space, or end in `+N`), then the skills (characters save each skill under its key, so skills may be added, removed or reordered and a removed skill's values wait for it to return, but no two skills may read the same with case and spaces ignored), then references between rows (a deed, quest, quest pool, crafting recipe, gathering find, editor list, NPC shop or drop, or summon naming something that no longer exists, or a medal, title, platform, book, tool, weapon, promotion, start class or binding naming a skill that does not). NPC files are checked as they play: where the NPC Editor has saved an NPC, its save is what is checked, so removing an item a saved shop still sells is refused. **Publish** (or **Publish 3 changes**) makes them live for every player at once, without a restart; it is refused if another admin changed the draft since you last looked. The confirmation has a **Log everyone out while publishing** box (off by default, and suggested when the draft removes items or monsters that players hold or that are in the world): ticked, every player but you, other staff and anyone in the Control Panel included, is logged out as at a normal logout (saved, trades cancelled, windows closed) with the alert *"The server is publishing new content. Please log in again in a moment."*, and every login, reconnect and new character is refused with the same text until the publish has finished, whether it went through or failed. Nobody loses a draft (drafts live in the database). The publish history and the audit entry say that everyone was logged out, and how many. A publish that would be refused (an empty draft, one another admin changed, or one that fails any of the publish's checks) logs nobody out. If saving a player fails while everyone is being logged out, nothing is published: that player is disconnected with the server-error alert, and you are told whose save failed (the error log has the reason).
- **Where it is used** (a tab that appears while a row is open here: from an item's **Remove or retire this item…**, a creature's **Remove this monster…**, or a change no page edits): the row's state, with **Change it on its page**, **Remove…**, **Restore the original** and **Cancel unpublished change**. An item, a monster or a vehicle shows where it is used, for example "Held by 14 characters · on the ground on 3 maps · named in 5 places in content": each place content names it, in words ("Amber's NPC file, line 6", "Crafting › stations, cook › recipes 3 › output", with the row's path when you point at it; click to open it on its page), and each place in the world, with the characters who hold copies (click a name to open their player hub).
- **Removing an item, a monster or a vehicle** (**Remove…** on Where it is used) asks what happens to everything that uses it, and puts the cleanup with your other unpublished changes (**Remove it**, or **Retire it** when the copies players have are kept; **Cancel** leaves everything as it was). Nothing changes for players until you publish:
  - **Where content names it** (shop and drop lines in NPC files, recipes, gathering finds, quest rows, quest chest refills, Oraku's orb and reward, faction heads, deeds, editor lists; a deed's row always goes with its item; mining's crystal colours and the Assassin's prize line are listed for you to edit by hand): **take out the lines that name it** (the default: the recipe, shop line, drop or list entry goes), **use another one instead**, or **leave them for me to fix**. A few entries cannot go without breaking their row (a station's one tool, an entry in a quest pool's or carpentry's roll table, one of mining's three ores, the last entry of a list that needs one): they can only be replaced, and the draft's checks name them until they are. NPCs the NPC Editor has saved get the same cleanup as their rows, when the draft is published, and the text each had is kept in its versions.
  - **Copies players have** (bags, gear, vaults, containers, the ground): **retire it** (the default: copies stay and keep working, but no more can be made: no content may name it, `/drop` refuses it, and the character editor can move its copies but not add any; an item nobody holds when the draft is published is simply removed, and removing an item that is already retired takes it out once nobody holds a copy), **delete every copy** (asked twice; you can give gold back for each copy a character held), or **swap every copy for another item**. World quest lines that want or give it are rolled again, or name the replacement. A storage item (a Crate, a Cabinet) can only be replaced with another storage item, and what each copy holds goes with it, under a new storage number of its own, wherever the copy is (a bag, a vault, the ground or another container); purging one deletes what it holds too. Stock on sale in player shops counts as copies: it stays when retired (players can still buy and sell copies they already have, there as in a trade, but no NPC shop sells it), goes when purged, and becomes the replacement when replaced; a player shop never stops a publish. A pile of crystals replaced by an item that is not crystals becomes a pile of that many. Removing a colour of crystals (Blue Crystal) takes every copy of it, piles included, and its entry on the player-shop list.
  - **A monster or NPC:** where it appears on maps, it stops appearing or another monster appears instead; ones alive now are removed when you publish or stay until they die; its own NPC file is deleted too or kept. Quest lines that name an NPC are listed for you to look at.
  - **A vehicle** (a `houses` `vehicles` row): the deeds that build it are removed with it or build another vehicle, and the characters riding it and the parked ones **land** (the default: riders stand where they are, on foot, and each parked one becomes the deed that builds it where it stands, or goes if no deed does) or **switch** to another vehicle (riders ride it, with their hull up to its full hull, and parked ones become it). Each change is an admin entry in the activity log, so the item reconciliation sees no gap.

  The draft lists each removal and what publishing it will do ("This draft removes 2 items still used in 5 places"). Copies, spawns and live monsters change only when the draft is published, in the same step as the content (a failure part-way changes nothing, and players are told nothing until the publish is through), and the publish history keeps a line for each thing done. **Undoing a publish brings removed content back, but not purged or replaced copies, cleared spawns or despawned monsters.** Changing an item's wear rules leaves it on anyone already wearing it; once taken off, it goes back on only if they meet the new rules. Changing a monster's HP applies to new spawns (live ones keep the HP they have); its attack and defence apply at once.
- **Find problems:** **Check for problems** lists references nothing resolves: stored items no catalogue has (left by a database edit or an older server), roster slots naming no monster, characters riding a vehicle no row has (they land where they are, at once if online, else at their next login), and content's own. Stock Classic has none. A tool matched by part of its name (fishing's `Fishing`, the `Axe`) counts while any item's name contains it, and a treasure such as `300 Gold` is a pile of gold, not an item. None of them stops the game: an unknown item shows by its name with no picture and does nothing, and an unknown monster spawns as a stand-in. The server also prints the world's at start.
- **History:** each publish, with its note and what it changed. **Undo this publish** takes a whole publish back, and is refused, naming the rows, if a later publish touched any of them (even to put one back) or if the result would not pass the same checks as a publish (a later publish may refer to something this one added). Every publish, undo and pack-update answer is also tried out first: if any part of the game cannot read the result (a text a rule needs has gone, say), it is refused with the reason and nothing changes.

Publishes, undos and pack-update answers are in the audit log. Connected players pick up a publish within a moment; a player who was away picks it up at their next login. A browser that cannot fetch the new content tries again a few times before carrying on, and keeps trying in the background until it has it.

**Upgrading to the content store:** back up your database first: migrations only run forward. The upgrade records your server as having the Classic pack installed; your world, characters and bags are unchanged. The server also records which index each skill is saved at in characters; a later release or imported pack that would move or drop a skill stops the server at start with the skills it would move, instead of shifting everyone's training onto other skills.

**Upgrading from 1.13.0 or earlier (Classic v1.0.1):** back up your database first. Crystals are now named in the singular, like every other item ("Blue Crystal", not "Blue Crystals"), and the Classic pack drops the items nobody could get or that had no picture. The upgrade renames every saved crystal (bags, worn gear, vaults, containers, the ground, NPC files and their versions, shop ledgers, quest lines, map versions, your content changes and draft) and merges two stacks of one colour into one. Copies of 1.6's broken "Damaged Sword, Knight's" become "Damaged Sword, Knight", which repairs into the same sword. Damaged Armor, the Scimitar, the Hammer, the Laser Sword, the Green Laser Sword and the Magic Shield item are retired: copies players hold stay and work, but no shop, chest, recipe or quest makes more. A stored quest line that asks for or gives an item the catalogue no longer has, or has retired (Dantan's Water Orb), is rolled again at start. If you typed the old plural into your own NPC files or content, the upgrade rewrites the usual spellings; any other spelling still works and picks up singular.

**Upgrading from 1.13.0 or earlier:** **Admin → Server Settings** moved into the Control Panel, and the floating Server Settings window is gone. A role that held every permission gets the three new Control Panel permissions, so it still holds every permission; other roles are left as they are.

### The Packs page

**Control Panel → Packs** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**) shows the packs your world runs. A pack is a bundle of game content (items, monsters, NPCs, spells, art and sounds); your own changes lay on top of them all. **Packs in this world** shows each pack as a card, in the order they are applied: its name and version, whether it is **In use** (or **In use once the server restarts**, **Removed when the server restarts**, **Not in use: it stopped the server starting**), whether it **Comes with the game** or was **Added by you**, and, under **More details**, its pack ID and the release it was made for.

- **Save your changes as a pack** makes one file of your published changes: every edit, addition and removal, the NPC files' saves (Talk & Shops), and the art and sounds you uploaded for them. Unpublished changes are not in it, and nor are maps, server settings or characters. Give it a **Name** and a **Version** (three numbers; raise it for each new version), and under **More options** a **Pack ID** (keep the same one for every version), then **Download my changes as a pack**. The file records the packs it was built on and this server's release. It is also a backup of your content.
- **Add a pack from a file** takes such a file from another server (or a backup of this one). **Check this file** reads it whole first: a file changed since it was saved, a file whose pictures do not match their names, or anything that is not a pack is refused. You then see what it would do, in words, before anything changes: how many things it adds, changes and removes against what plays now (each list folded, `Frost Sword (items)`), the things you have changed yourself, the things with unpublished changes, and whether it can be installed. Then choose:
  - **Add to my unpublished changes** makes everything in it your own change (its files go into the upload store). Review them, see where things are used, and publish on the [Publish Changes](#the-publish-changes-page) page as any change; anything they break is listed under **Problems to fix before you can publish**. An unpublished change to the same thing is replaced.
  - **Install as a pack** (or **Update to v…**, when an older version of the same pack is installed) makes it one of this world's packs, under your own changes, which stay on top. It comes into use **when the server next restarts** (the served art is built at start). It is checked as a start would check it first, and refused if it would not start (the reasons are listed under **Why not**). Installing another version of an installed pack's ID updates it (the same version is refused); for something you had changed, Publish Changes shows the pack-update notice. A pack that comes with the game (Classic) cannot be replaced.
  - **Don't add it** lets the file go; nothing changes.
- **Remove…** (on a pack you added) takes it out when the server next restarts, after asking. Your changes stay.
- If a pack you added would stop the server starting (a later change of yours clashes with it), the server starts without the added packs, says why in the log and on this page, and you can remove it here.

Exports, imports, installs and removals are written to the audit log.

### The World page

**Control Panel → World** (permission **Control Panel: edit content (items, creatures, NPCs, maps and the rest)**; it opens on the map you stood on) builds the world one map at a time, in plain words like the other editor pages, and in the same layout: on a wide screen the map list and the open map each scroll on their own, with **Save changes** kept in view at the bottom. Saving changes the map straight away for everyone on it, and keeps the map it replaced as a version; it does not wait for the content draft.

- **Picking a map.** The list on the left shows each map by its name (its header) with its position beside it (`x0y100`); **Search** finds maps by position, name, or the monsters, NPCs and items on them (where a monster or item is used in the world). The list is read when the page is shown, so it can take a moment on a big world. **Go to a map by its position** (folded under the list) opens a map by its **Map X** and **Map Y**; a position with no map opens a blank one, marked **New map: not saved yet**, which **Create this map** saves. Under the open map's name, **Next map** steps to a neighbour (**← West**, **↑ North**, **↓ South**, **East →**). While another map opens, or a save or restore is on its way, the map cannot be edited.
- **Painting.** Choose a **Tool**, the layer to **Paint on** — **Ground (layer 1)**, **Objects (layer 2)**, **Above characters (layer 3)** or **Shadows (layer S)**, drawn see-through — and a tile from the **Tiles** tab (find it by code or name; a tile players can't walk onto says so). The line under the toolbar says what the chosen tool does and which tile you are painting with. The tools: **Pencil** (one tile, or drag), **Big brush** (a plus of five), **Fill the whole layer**, **Fill an area** (the joined tiles of one kind), **Rectangle** (drag a box), **Eyedropper** (take the tile you click). Tiles players can't walk onto (by layers 1 and 2, as the game decides) are marked with a red corner, and the fog is drawn as players see it. Pointing at a tile names what is on each layer under the map.
- **Select, copy and paste.** **Select** a box, then **Copy**, **Cut** or **Clear** it; **Paste** puts the copy with its top-left corner on the tile you click. **Undo last step** and **Redo** (Ctrl+Z, Ctrl+Y) walk every change since the map was opened, the tabs' too, and reach back past a save of the same map. Under **More tools: show or hide layers, stamps**: **Show layers** hides layers while you work (it does not change the map), **Select, Copy, Cut and Delete work on every layer at once**, and **Keep the copy as a stamp** names a copy, so it can be pasted again from the stamp list while the page is open.
- **The tabs under the map**, each with a line saying what it is for; a dot marks the tabs where the map has something:
  - **Tiles:** the tiles to paint with.
  - **Monsters & NPCs:** the four spots, each a monster or NPC from the World Editor's lists (monsters with no walking art are not offered), and the tile where it appears (**Pick on map**, then click). A spot set by `/roster` has no tile: it appears anywhere, is marked faintly on row 1, and stays so until you pick a tile for it.
  - **Items:** up to 200 items lying on the map, `/drop`s included (a number before the name places a pile: `50 Gold`), each on a tile (**Pick on map**); **+ Add item** adds one and asks for its tile; **Remove** takes one out.
  - **Exits:** up to two, each the map it **leads to** (X and Y; `H1<mx>`/`H2<mx>` for a house interior) and the tile players **arrive at**; all four empty for none.
  - **Name & signs:** the **Map name** (the header players see as they enter) and three sign texts.
  - **Rules:** **Safe area** (no fighting at all), **No player killing**, **Indoors**, and **Faction members appear here** (now and then one of the map's monsters is swapped for a member of that faction; a faction the world no longer has stays on the map until you change it).
  - **Fog:** the fog (**No fog**, **Cloudy 1**…), its **Thickness** (0, can't be seen, to 255, solid) and, under More options, its colour (red, green and blue, 0 to 255 each).
  - **Saved versions:** the maps each save replaced, newest first, with who replaced them. **Restore this version** puts one back, as a save of its own (so it can be restored over in turn). A version the content no longer allows (a tile or item since removed) says why it can't be restored instead. The newest 50 are listed.
- **Saving.** **Save changes** (with a quiet note that saves go live at once, for everyone on this map) checks all four layers (12 rows of 17 palette tiles), the rules, the name and sign lengths, the exits, the fog, the placed monsters and items, as the World Editor did, then saves the map, its roster and placed items and refreshes everyone on it: its monsters respawn where placed. A map someone else saved since you opened it (even unchanged), or changed in play (`/roster`, `/drop`), refuses the save: undo your changes and open it again. If the connection drops before a save's answer comes, the page stops waiting and keeps your changes; reopening shows whether the save landed. **Undo changes** puts the map back as it was opened (or last saved).

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
- **Items:** gold carried and in the bank, the bag, worn gear, vault, spellbook and the houses they own (see [Houses](#houses-in-the-hub)).
- **Edit:** change the character (see [Editing a character](#editing-a-character)), for a role with **Control Panel: edit characters**.
- **Edits:** every edit an admin made to them, with who, when, why and each value before and after, and **Undo**; house revokes and transfers too, with what they destroyed or moved.
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

#### Houses in the hub

**Items → Houses** lists each house the character owns: its type, the map it stands on with its door's tile, the interior's map name, any Small Shop in it (the shopkeeper, how many items it sells and holds in stock, and its till) and how many items the owner's House Vault holds. One House Vault serves all of an owner's houses.

A role with **Control Panel: edit characters** also gets **Revoke** and **Transfer** on each house. Both need a reason. Before either happens, the server reads the house and the page lists exactly what the change will do; nothing changes until you confirm. If the house changes in the meantime (someone drops an item inside, say), the change is refused: look again.

- **Revoke** demolishes the house, as decay does, and can't be undone. Its tiles, door and mailbox or lamp go, and its interior is deleted with the items on its floor and any shop's stock and till. The owner's House Vault and its contents go too if this was their last house; otherwise the vault is kept for their other houses. Anyone inside is moved out to the house's door first, and saved there. Shop windows on its shopkeepers, a mailbox open at it and its casino tables close; a stake still held at a table goes back to its player, including one away mid-hand. The confirmation lists the vault's contents (when it goes), each shop's stock and till, and the items on the floor. To put things back after a mistake, rebuild from the Activity Log, which records each destroyed item as a **Demolished** event.
- **Transfer** gives the house, whole, to another character you name. Its door, mailbox and House Vault become the new owner's, and so does its header when it names the old owner (a custom shop title is kept). Their House Key opens it, only they may place or take its furniture, and the old owner's open House Vault window there, or their mailbox window at it, closes. A guild hall's door and Guild Vault stay its guild's, and a Small Shop has no door or mailbox to rename. Every Small Shop inside works for the new owner, with its stock and till. If the old owner keeps another house, their House Vault stays theirs. Otherwise its contents move into the new owner's House Vault, added to anything already there; if that would be more than the vault holds, the transfer is refused before anything changes. A guild hall can go only to a member of its guild. Anyone inside stays where they are, and both owners are told if they are online. Transferring the house back returns it, with its door and shops, but the vault rules apply again: contents moved into the new owner's House Vault go back only if they own no other house by then, and a merge is not split apart.

Each revoke or transfer is kept in the owner's **Edits** (a transfer in the new owner's too) and in the audit log. Undo is not offered for them. A House Vault's contents moved by a transfer are **Container** events in the Activity Log, so the item reconciliation still matches.

### The activity log

The server logs what players do in the `activity_log` table, for tracing dupes, scams and real-money trading:

- **Items and gold:** trades (both sides), drops, pickups (naming the player who dropped the item), gives, NPC and player shops, the bank, the vault, house vaults, chests and crates, crafting, gathering, items used up (food, potions, books, keys, deeds, seeds, the crystals a bow shoots, cannonballs and spell reagents), quest hand-ins, training, casino bets and wins, prizes, death drops, items breaking in a fight, monster loot, a new character's starting items, admin `/drop`, and items and gold placed or removed by a World Editor save.
- **Combat:** monster kills, player kills and deaths, naming the killer.
- **Progression:** levels, skill gains, class changes and quest hand-ins.
- **Sessions:** logins and logouts with the address, and map changes (with how: an edge, an exit, a portal, a warp or a respawn). Single steps are not logged.
- **World events**, with no character (shown as **World**): items and gold on the ground decaying (**Decay**), the periodic save putting an item in a quest chest (**Chest refill**), what a demolished house destroys: its outdoor items, its vault's contents, the items on its floor and its shops' stock and tills (**Demolished**), and regrown plants producing items (**Regrowth**). For these, a quantity or gold amount is the change to what exists.

Items are recorded by name and quantity. Each event is one character's view of it: a trade writes a row for each side, and a quantity or gold amount is the change to what that character carries (bag, worn gear and gold in hand), so a bank deposit is `-500 gold`. Once a tick the server also compares what each player carries with what the log says they should carry; any difference is written as an **Unlogged change**. One means a bug or a dupe, so report it.

Open **Admin → Control Panel → Activity Log** (the `activityLog` permission, administrators by default). **Player timeline** shows a character's events, newest first; a deleted character is still found by name. **Item flow** shows every movement of one item, with totals gained and lost by type; the currency's name (**Gold** in Classic) shows every change to the gold, carried, placed on the ground or put in the bank. Filter either by event type or group and by UTC day, and choose **Show older** for more. A player or item in a row opens their timeline or flow. Every read, each further page included, is recorded in the audit log. An item's totals add up at most its newest 20,000 events, and the page says when older ones were left out.

Events are written with the change they describe, in the same database transaction, so a crash never keeps one without the other. Rows older than `activityLogRetention` (default 180 days) are deleted at startup and every hour; `0` keeps them forever. The log grows quickly on a busy server, so keep an eye on the database size if you raise it.

#### Item reconciliation

The Activity Log page's **Reconciliation** view checks the log against what exists. A run first saves everything live, as the periodic save does, then counts every copy of every item, and the gold, wherever it is held: bags, worn gear and gold in hand, the bank, personal vaults, house and guild vaults, chests, crates, cabinets and Cauldrons, the ground of every map, player shops' stock and tills, and vehicles (parked, or ridden). Gold is counted as the world's currency, so a pile of it on the ground counts too. Doors, exits, signs, mailboxes, newspaper stands and the doors and switches keys and switches turn are fixtures, not items, and are not counted. SSO has no mail attachments.

For each item it then works out what the log says there should be: the last run's count, plus what was made since and less what ended. **Moves** (trades, gives, drops, pickups, player shop sales, the bank, the vault, containers, and death drops left on the ground) change where an item is, not how many exist. **Makes and ends** (NPC shops, rewards and payments, items used up, spells, loot, gathering, crafting, transforms, quests, the casino, admin changes and the world events) count. **Unlogged changes** are kept out of what is expected and shown in their own column, so a dupe still shows as a difference, with the unexplained change beside it. A difference between expected and counted means a source or sink the log missed, or a dupe: the item's name (the currency's too) opens its flow to find it.

Runs happen nightly and when you choose **Run now**. The server looks once a minute: when no run has happened since the latest 04:00 UTC, it runs one, so a server that was down at 04:00 (or has never run one) runs within a minute or so of starting (the `activityLog` permission; each run is recorded in the audit log). The page lists the newest five runs, newest first, with the items whose count differs and the items with unlogged changes. The very first run only takes the baseline. Each run reads only the log rows written since the run before, so pruning older rows never matters, and `activityLogRetention` never prunes a row written since the last run, however short it is: such rows are pruned once a run has read them. The server keeps the newest 90 runs (`reconcile_runs`, `reconcile_items`). A run holds the game for as long as it counts, a moment on a small world; the nightly run is timed for a quiet hour.

A blackjack stake still held when the server crashes comes back with the saved purse on restart, and is logged then as a **Reward** refund, as a clean shutdown logs its refunds.

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
| `portalTargets` | Portal targets | `[]` | Up to 30 points, a row each: map, x and y | Random destinations for the Portal spell, among those whose map exists; with none, Portal cannot be cast and costs nothing. |
| `hazardMap` | Server Spirit map | `null` | Map `x<mx>y<my>` or empty | Map where the Server Spirit throws fireballs and lightning bolts every 0.35 s. |
| `bellMap` | Church bell map | `null` (Classic servers start with `x999y999`) | Map `x<mx>y<my>` or empty | Map where the church bell rings for everyone on it, about every 2 minutes 40 seconds; empty means no bell. |
| `treasureMaps` | Treasure maps | `[]` | Up to 100 map names (`x<mx>y<my>`), a row each | Maps where buried treasure can spawn for a Shovel; empty disables buried treasure. |
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

Death drops and how long monster loot lasts moved to the Control Panel's [Game Rules](#the-game-rules-page) page (see [Moved from Server Settings](#moved-from-server-settings)).

| Key | Label | Default | Allowed / range | Effect |
|---|---|---|---|---|
| `assassinPrizes` | Assassin prizes | `Long Sword`, `1000 Gold`, `500 Gold`, `Knife` | A box for each of 1st to 4th place, each <= 60 chars (item, `<n> Gold`, or empty) | 1st–4th place prizes when an Assassin's Game ends. |

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

Maps are built on the Control Panel's [World page](#the-world-page); NPC files on its Creatures & NPCs page's [Talk & Shops](#talk--shops) tab. A few things to know when painting:

- **Layers:** `1` (floor), `2` (transparent objects), `3` (over characters) and `S` (shadow).
- **Added tiles** (uploaded on the Pictures & Sounds page, or `assets/added/`) are in the palette with the original ones; find them by code or name (see [Modding](modding.md#tiles-tilesjson)).
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

A world is the database file **and** the `<database name>-content/` folder beside it (`sso-content/` for `sso.sqlite`), which holds the art and sounds operators upload on the Control Panel (files named by their content's hash; the database names them). Back up and restore both together. A world that never had an upload has no such folder. Each database has its own, so a second world beside the first never touches its uploads.

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
