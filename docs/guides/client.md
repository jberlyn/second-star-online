# Client

## What happens in play

Pressing an arrow sends movement intent. The client can show the input promptly, then uses the server's state and updates to show the accepted result. Enter opens chat, where the keys type instead of moving the character. The default Modern controls are W, A, S and D to walk, Shift with a direction to turn, Space to attack and E to act on the faced item, with keys for the panel's tabs and the Friends and Who windows; the Classic 1.6 controls are the arrows, Alt, Tab and Ctrl, and Player Settings can rebind every action. Resting the mouse on a player, monster, NPC, ground item or named tile shows a small tip with its name.

## Where it lives

- [packages/client/index.html](../../packages/client/index.html): the page the client loads into.
- [packages/client/src/main.ts](../../packages/client/src/main.ts): starts the application.
- [packages/client/src/app.ts](../../packages/client/src/app.ts): connects screens, input, messages and game state, builds the Control Panel's pages, and works out the playfield's hover tip (`hoverText`, `hoverName`).
- [packages/client/src/model.ts](../../packages/client/src/model.ts): maintains client-side game state.
- [packages/client/src/net.ts](../../packages/client/src/net.ts): connects, sends messages and resumes after an unexpected disconnect.
- [packages/client/src/content.ts](../../packages/client/src/content.ts): fetches the server's content store and follows it across logins and publishes.
- [packages/client/src/input.ts](../../packages/client/src/input.ts): translates keyboard changes into intents, by the Modern, Classic 1.6 or custom key bindings (`LAYOUTS`, `setLayout`).
- [packages/client/src/assets.ts](../../packages/client/src/assets.ts): loads asset metadata and images.
- [packages/client/src/playfield.ts](../../packages/client/src/playfield.ts): draws the playfield (tiles, ground items, characters, vehicles and their riders, spell and ground effects, fog) and says what a click or the pointer lands on (`pick`, `pickAll`).
- [packages/client/src/prefs.ts](../../packages/client/src/prefs.ts): caches player preferences and floating window positions in the browser.
- [packages/client/src/fog.ts](../../packages/client/src/fog.ts): draws fog.
- [packages/client/src/audio.ts](../../packages/client/src/audio.ts): manages audio playback.
- [packages/client/src/sfx.ts](../../packages/client/src/sfx.ts): maps sound effects to their channels and to the Sound settings' volume categories (`soundCategory`), and a spell effect to its cast sounds (`spellSounds`).
- [packages/client/src/styles.css](../../packages/client/src/styles.css): styles the client and its screens, with the SSO panels' colour tokens (`--ui-*`).

The UI files are:

- [packages/client/src/ui/alert.ts](../../packages/client/src/ui/alert.ts): in-page alerts.
- [packages/client/src/ui/amount.ts](../../packages/client/src/ui/amount.ts): gold and crystal amount dialog.
- [packages/client/src/ui/away.ts](../../packages/client/src/ui/away.ts): away message window.
- [packages/client/src/ui/bars.ts](../../packages/client/src/ui/bars.ts): health, spell and experience bars, each showing its value while it is hovered; aboard a vehicle the health bar shows its hull.
- [packages/client/src/ui/bio.ts](../../packages/client/src/ui/bio.ts): player and NPC biography window.
- [packages/client/src/ui/blackjack.ts](../../packages/client/src/ui/blackjack.ts): blackjack table.
- [packages/client/src/ui/board.ts](../../packages/client/src/ui/board.ts): message board window.
- [packages/client/src/ui/charmenu.ts](../../packages/client/src/ui/charmenu.ts): player context menu.
- [packages/client/src/ui/chat.ts](../../packages/client/src/ui/chat.ts): chat log and input.
- [packages/client/src/ui/chatroom.ts](../../packages/client/src/ui/chatroom.ts): chat room windows.
- [packages/client/src/ui/checkers.ts](../../packages/client/src/ui/checkers.ts): checkers window.
- [packages/client/src/ui/friends.ts](../../packages/client/src/ui/friends.ts): buddy list window.
- [packages/client/src/ui/gamemenu.ts](../../packages/client/src/ui/gamemenu.ts): game menus and actions.
- [packages/client/src/ui/guildcenter.ts](../../packages/client/src/ui/guildcenter.ts): guild center screen.
- [packages/client/src/ui/hovertip.ts](../../packages/client/src/ui/hovertip.ts): the hover tip: one box in the item menu's purple frame that follows the pointer, for the panel's controls and for what the mouse is over on the playfield.
- [packages/client/src/ui/im.ts](../../packages/client/src/ui/im.ts): instant message windows.
- [packages/client/src/ui/mail.ts](../../packages/client/src/ui/mail.ts): mail list and compose panes.
- [packages/client/src/ui/menubar.ts](../../packages/client/src/ui/menubar.ts): generic menu bar widget.
- [packages/client/src/ui/newspaper.ts](../../packages/client/src/ui/newspaper.ts): newspaper reader and editor.
- [packages/client/src/ui/npcs-page.ts](../../packages/client/src/ui/npcs-page.ts): the NPC file editor: the Creatures & NPCs page's Talk & Shops tab (NPC files as plain-word sections).
- [packages/client/src/ui/monsters-page.ts](../../packages/client/src/ui/monsters-page.ts): the Creatures & NPCs page's Creatures tab.
- [packages/client/src/ui/skills-page.ts](../../packages/client/src/ui/skills-page.ts): the Skills & Classes page's Skills tab.
- [packages/client/src/ui/gathering-page.ts](../../packages/client/src/ui/gathering-page.ts): the Gathering & Crafting page's Gathering tab.
- [packages/client/src/ui/action.ts](../../packages/client/src/ui/action.ts): semantic action annotations.
- [packages/client/src/ui/paint.ts](../../packages/client/src/ui/paint.ts): painting, viewer and camera screens.
- [packages/client/src/ui/panel.ts](../../packages/client/src/ui/panel.ts): the right panel: the Stats (with hunger where the world shows it), Inventory and Skills tabs, the Spellbook tab's host, and the hover tips' owner.
- [packages/client/src/ui/placement.ts](../../packages/client/src/ui/placement.ts): house placement mode.
- [packages/client/src/ui/player-settings.ts](../../packages/client/src/ui/player-settings.ts): Player Settings window (controls, display, sound, chat, social & privacy, accessibility).
- [packages/client/src/ui/screens.ts](../../packages/client/src/ui/screens.ts): title, login and character creation; the remade title screen's art is in `packages/client/src/ui/title/`.
- [packages/client/src/ui/control-panel.ts](../../packages/client/src/ui/control-panel.ts): the Control Panel, which replaces the game view for admin pages: its header tools, grouped sidebar and unsaved-changes prompt.
- [packages/client/src/ui/control-panel-kit.ts](../../packages/client/src/ui/control-panel-kit.ts): the Control Panel's shared table, form field, confirmation, and the editor forms' section tabs (`sectionTabs`, `tabStrip`), folded rule sources (`sourcesNote`), Save bar kept in view (`formActions`), short row lists (`rowList`), "+ New" dialogs (`newDialog`) and less used fields shown after the main ones (`moreFields`).
- [packages/client/src/ui/settings.ts](../../packages/client/src/ui/settings.ts): the Control Panel's Server Settings page.
- [packages/client/src/ui/activity-log.ts](../../packages/client/src/ui/activity-log.ts): the Control Panel's Activity Log page.
- [packages/client/src/ui/content-page.ts](../../packages/client/src/ui/content-page.ts): the Control Panel's Publish Changes page (unpublished changes, history, problems, where a row is used) and the Pictures & Sounds page's panels.
- [packages/client/src/ui/content-areas.ts](../../packages/client/src/ui/content-areas.ts): which content page and tab edits each dataset part (`homeOf`), with their titles and help lines: Items, Creatures & NPCs, Spells, Skills & Classes, Gathering & Crafting, Houses & Vehicles, Quests, World Events (`EVENT_TABS`: Counters, Offerings, Counter perks), Community and Game Rules.
- [packages/client/src/ui/content-area-page.ts](../../packages/client/src/ui/content-area-page.ts): the generic content page: a list beside a form, settings cards, and Save, Undo, Restore, Cancel and Remove, each naming the row's revision.
- [packages/client/src/ui/schema-form.ts](../../packages/client/src/ui/schema-form.ts): a form drawn from a row's JSON Schema: rows, tables or a list of names beside the picked entry for lists, drop-downs, empty-means-none optional values, the words a message fills in, names suggested as you type; nothing folds.
- [packages/client/src/ui/content-words.ts](../../packages/client/src/ui/content-words.ts) and `content-words/`: each part's field labels, help lines and choices in plain words.
- [packages/client/src/ui/content-diff.ts](../../packages/client/src/ui/content-diff.ts): what a pack update changed, as plain lines.
- [packages/client/src/ui/content-requests.ts](../../packages/client/src/ui/content-requests.ts): the content pages' row, draft and discard requests as promises.
- [packages/client/src/ui/balance-page.ts](../../packages/client/src/ui/balance-page.ts): the balance cards: Game Rules' Numbers, Spells' Damage and buffs, and Houses & Vehicles' Hull and cannon.
- [packages/client/src/ui/characters.ts](../../packages/client/src/ui/characters.ts): the Control Panel's Characters page and player hub.
- [packages/client/src/ui/character-editor.ts](../../packages/client/src/ui/character-editor.ts): the player hub's character editor and edit log.
- [packages/client/src/ui/settings-roles.ts](../../packages/client/src/ui/settings-roles.ts): Server Settings' Roles and Staff pages.
- [packages/client/src/ui/shells.ts](../../packages/client/src/ui/shells.ts): game screen shell.
- [packages/client/src/ui/shop.ts](../../packages/client/src/ui/shop.ts): shop and vault window.
- [packages/client/src/ui/sign.ts](../../packages/client/src/ui/sign.ts): sign display.
- [packages/client/src/ui/slots.ts](../../packages/client/src/ui/slots.ts): slot machine panel.
- [packages/client/src/ui/spellbook.ts](../../packages/client/src/ui/spellbook.ts): spellbook page.
- [packages/client/src/ui/stage.ts](../../packages/client/src/ui/stage.ts): original-art stage placement.
- [packages/client/src/ui/trade.ts](../../packages/client/src/ui/trade.ts): trade window.
- [packages/client/src/ui/who.ts](../../packages/client/src/ui/who.ts): online player list.
- [packages/client/src/ui/window.ts](../../packages/client/src/ui/window.ts): floating windows.
- [packages/client/src/ui/world-page.ts](../../packages/client/src/ui/world-page.ts): the Control Panel's World page: the World Editor as a page (drawing tools, roster slots, placed items, exits, signs, header, flags, fog and a map's saved versions).

- The player's Class window (Game ▸ Your Class, shown only in a world whose classes use it) shows perks, trainers and each way out with its requirements, and its **Become a …** button. [class-window.ts](../../packages/client/src/ui/class-window.ts).
- The crafting window shows station recipes and runs a selected quantity. [crafting.ts](../../packages/client/src/ui/crafting.ts).
- The Items editor and the reference checks and cleanup choices for removals. [items-page.ts](../../packages/client/src/ui/items-page.ts), [content-usage.ts](../../packages/client/src/ui/content-usage.ts).
- Class tree and perk previews, and reassignment when removing a class. [class-preview.ts](../../packages/client/src/ui/class-preview.ts), [class-removal.ts](../../packages/client/src/ui/class-removal.ts).
- Recipe success, duration and XP previews, and masterwork odds by skill. [recipe-preview.ts](../../packages/client/src/ui/recipe-preview.ts), [masterwork-preview.ts](../../packages/client/src/ui/masterwork-preview.ts).
- Pack export, import, installation and update. [packs-page.ts](../../packages/client/src/ui/packs-page.ts).
- The shared file upload flow and the editors for inventory icons, worn sprites and creature bodies. [art-uploads.ts](../../packages/client/src/ui/art-uploads.ts), [item-art.ts](../../packages/client/src/ui/item-art.ts), [worn-art.ts](../../packages/client/src/ui/worn-art.ts), [body-art.ts](../../packages/client/src/ui/body-art.ts).
- The editors for spell effects, sounds, tiles and house placement previews. [fx-art.ts](../../packages/client/src/ui/fx-art.ts), [sound-art.ts](../../packages/client/src/ui/sound-art.ts), [tile-art.ts](../../packages/client/src/ui/tile-art.ts), [house-art.ts](../../packages/client/src/ui/house-art.ts).

## How it works

The client bundles no game content. At start it fetches the server's published content store (`/content/current.json` for the hash, then `/content/<hash>.json`, which the browser caches) and installs it before anything is shown. Every server message passes through the content sync: a `welcome` or a publish (`content`) naming another hash fetches that store first, and the messages behind it wait until it is installed, so nothing is handled against the old content. A hash the server no longer has falls back to its current store. A store in a format the client was not built for reloads the page (at start, once). Editors built once per session (the World page's and character editor's lists) rebuild them when a new store is installed. Item names shown to players go through `itemLabel`, so an operator's rename shows at once. Item art follows the sprite key the server sends beside an item's key (`GroundView.sprite`, `InventoryView.sprites`), falling back to 1.6's picture rules. The asset index the client loads already merges the art of every installed pack.

The input layer resolves multiple held arrows left, right, up, then down. A new press emits a step intent; changes to held direction or turning emit a move intent. Game keys are ignored while typing in any input, text area or select, and focusing the chat entry, losing window focus, or pressing Meta (or any key with Meta held) releases every held key. The connection sends messages to the server, receives snapshots and updates, and attempts to resume with a token after an unexpected disconnect, every 1000 ms for up to 25 attempts before "Disconnected!"; the final close codes 4001-4006 (logout, kick, flooding and the like) do not resume, while 4007 (fell behind) does and gets a fresh snapshot, and a `denied` reply to a resume (the grace ran out, or a ban since the drop) closes that socket and ends the session, showing the server's text and reopening Load Character with the name filled in. Messages sent while disconnected are queued and flushed after the resume message. After a session ends, the fresh connection for the title or Load Character retries every 1000 ms while the server is unreachable (a restart). The model predicts ordinary steps with the shared rules, then reconciles its position and facing with server updates; map edges wait for the server snapshot. The application applies incoming state, and the playfield draws the game while DOM screens provide controls and windows.

The hover tip (an SSO addition replacing 1.6's floating hover name) is name-only: no health bar or other detail, though a monster's name carries its level in a world that shows monster levels. On the playfield `pickAll` gives what is under the pointer in a click's order: a monster or NPC alone, else a player alone (another player hidden by invisibility armour reads "???"), else the tile's ground items newest first, with the ones the tip never names (`ground.tipless`) last. The tip shows the first, which is the one a click or Ctrl takes, and "+N more items" for the rest; with none of those it names the layer-2 tile when the tile catalogue gives it a name (a tree, a rock, a crop). It stays on the stage, hides while the player menu or item menu is open or an item is dragged, shows only for a mouse, and can be made larger in Player Settings.

A gathering effect arrives as an `fx` event like a spell's: a harvest node's strike run (`strikeFx`) and fishing's cast (`fishing.castFx`) are ground effects (`isGroundFx`), drawn in their tile's row so a character standing in front covers them; fishing's cast sound comes from the server as a `sound` of its own. A cannon's rider shows its firing frames while its shot's animation runs, and a parked ship bobs on the riders' swell clock (see [vehicles](vehicles.md)).

The crafting window opens and closes on the server's `recipes` message and sends `recipeMake`, `recipeStop` and `recipeClose`; the Class window opens on `classWindow`, asked for with `classOpen`, and its **Become a …** button sends `classPromote`. The server checks every one.

The Control Panel's sidebar groups its pages as Server (Server Settings), Players (Characters, Activity Log), Content (the content pages above, Pictures & Sounds and World) and Publishing (Publish Changes, Packs), A to Z within each group, showing only the pages the role may use; a page whose saves apply at once rather than into the shared draft (Server Settings, World) is tagged Live. Content editor forms show one section tab at a time with the Save bar pinned in view, and nothing is typed as JSON. The SSO panels share one set of colour tokens sampled from 1.6's art (`--ui-*` in `styles.css`: the right panel's woodgrain, its tan pole and the item menu's purple); the Control Panel and Player Settings (`.control-panel`, `.settings`) redefine them as a quieter cut, while in-game windows built on them, such as the crafting window, keep the full-strength values.

The stage, panel, placement, window and shell modules arrange screens. Assets use retained layout metadata and sprite images. Audio uses eight channels; a new sound replaces the sound on its channel, and each channel has its own volume. Muting stops all channels. A pointer or key gesture unlocks playback; a sound requested before unlock or before its buffer loads is skipped rather than played late.

## Differences from 1.6

The church bell plays at its own volume and leaves channel 5's alone (see [the church bell fix](../differences-from-fso.md#the-church-bell-leaves-channel-5s-volume-alone)). SSO's sound switch silences every sound. See the [sound switch difference](../differences-from-fso.md#sound-off-silences-everything), the [core bugs fixed](../differences-from-fso.md#core), the [browser platform changes](../differences-from-fso.md#browser-platform), the [movement bugs fixed](../differences-from-fso.md#movement) and the [server-side movement changes](../differences-from-fso.md#server-side-movement).
