# Client

## What happens in play

Pressing an arrow sends movement intent. The client can show the input promptly, then uses the server's state and updates to show the accepted result. Enter opens chat, where arrows move the caret instead of the character. Alt with an arrow turns, Tab holds attack, and Ctrl acts on the faced item.

## Where it lives

- [packages/client/src/main.ts](../../packages/client/src/main.ts): starts the application.
- [packages/client/src/app.ts](../../packages/client/src/app.ts): connects screens, input, messages and game state.
- [packages/client/src/model.ts](../../packages/client/src/model.ts): maintains client-side game state.
- [packages/client/src/net.ts](../../packages/client/src/net.ts): connects, sends messages and resumes after an unexpected disconnect.
- [packages/client/src/content.ts](../../packages/client/src/content.ts): fetches the server's content store and follows it across logins and publishes.
- [packages/client/src/input.ts](../../packages/client/src/input.ts): translates keyboard changes into intents.
- [packages/client/src/assets.ts](../../packages/client/src/assets.ts): loads asset metadata and images.
- [packages/client/src/playfield.ts](../../packages/client/src/playfield.ts): draws the playfield.
- [packages/client/src/prefs.ts](../../packages/client/src/prefs.ts): caches player preferences and floating window positions in the browser.
- [packages/client/src/fog.ts](../../packages/client/src/fog.ts): draws fog.
- [packages/client/src/audio.ts](../../packages/client/src/audio.ts): manages audio playback.
- [packages/client/src/sfx.ts](../../packages/client/src/sfx.ts): maps sound effects to playback.
- [packages/client/src/styles.css](../../packages/client/src/styles.css): styles the client and its screens.

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
- [packages/client/src/ui/hovertip.ts](../../packages/client/src/ui/hovertip.ts): hover tips for tabs, items and the playfield.
- [packages/client/src/ui/im.ts](../../packages/client/src/ui/im.ts): instant message windows.
- [packages/client/src/ui/mail.ts](../../packages/client/src/ui/mail.ts): mail list and compose panes.
- [packages/client/src/ui/menubar.ts](../../packages/client/src/ui/menubar.ts): generic menu bar widget.
- [packages/client/src/ui/newspaper.ts](../../packages/client/src/ui/newspaper.ts): newspaper reader and editor.
- [packages/client/src/ui/npceditor.ts](../../packages/client/src/ui/npceditor.ts): NPC editor.
- [packages/client/src/ui/action.ts](../../packages/client/src/ui/action.ts): semantic action annotations.
- [packages/client/src/ui/paint.ts](../../packages/client/src/ui/paint.ts): painting, viewer and camera screens.
- [packages/client/src/ui/panel.ts](../../packages/client/src/ui/panel.ts): stats, inventory and skills panel.
- [packages/client/src/ui/placement.ts](../../packages/client/src/ui/placement.ts): house placement mode.
- [packages/client/src/ui/player-settings.ts](../../packages/client/src/ui/player-settings.ts): Player Settings window (controls, display, sound, chat, social & privacy, accessibility).
- [packages/client/src/ui/screens.ts](../../packages/client/src/ui/screens.ts): title, login and character creation.
- [packages/client/src/ui/control-panel.ts](../../packages/client/src/ui/control-panel.ts): the Control Panel, which replaces the game view for admin pages.
- [packages/client/src/ui/control-panel-kit.ts](../../packages/client/src/ui/control-panel-kit.ts): the Control Panel's shared table, form field and confirmation.
- [packages/client/src/ui/settings.ts](../../packages/client/src/ui/settings.ts): the Control Panel's Server Settings page.
- [packages/client/src/ui/activity-log.ts](../../packages/client/src/ui/activity-log.ts): the Control Panel's Activity Log page.
- [packages/client/src/ui/content-page.ts](../../packages/client/src/ui/content-page.ts): the Control Panel's Content page.
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
- [packages/client/src/ui/worldeditor.ts](../../packages/client/src/ui/worldeditor.ts): world editor.

## How it works

The client bundles no game content. At start it fetches the server's published content store (`/content/current.json` for the hash, then `/content/<hash>.json`, which the browser caches) and installs it before anything is shown. Every server message passes through the content sync: a `welcome` or a publish (`content`) naming another hash fetches that store first, and the messages behind it wait until it is installed, so nothing is handled against the old content. A store in a format the client was not built for reloads the page. Item names shown to players go through `itemLabel`, so an operator's rename shows at once. Item art follows the sprite key the server sends beside an item's key (`GroundView.sprite`, `InventoryView.sprites`), falling back to 1.6's picture rules. The asset index the client loads already merges the art of every installed pack.

The input layer resolves multiple held arrows left, right, up, then down. A new press emits a step intent; changes to held direction or turning emit a move intent. Game keys are ignored while typing in any input, text area or select, and focusing the chat entry, losing window focus, or pressing Meta (or any key with Meta held) releases every held key. The connection sends messages to the server, receives snapshots and updates, and attempts to resume with a token after an unexpected disconnect, every 1000 ms for up to 25 attempts before "Disconnected!"; the final close codes 4001-4006 (logout, kick, flooding and the like) do not resume, while 4007 (fell behind) does and gets a fresh snapshot, and a `denied` reply to a resume (the grace ran out, or a ban since the drop) closes that socket and ends the session, showing the server's text and reopening Load Character with the name filled in. Messages sent while disconnected are queued and flushed after the resume message. After a session ends, the fresh connection for the title or Load Character retries every 1000 ms while the server is unreachable (a restart). The model predicts ordinary steps with the shared rules, then reconciles its position and facing with server updates; map edges wait for the server snapshot. The application applies incoming state, and the playfield draws the game while DOM screens provide controls and windows.

The stage, panel, placement, window and shell modules arrange screens. Assets use retained layout metadata and sprite images. Audio uses eight channels; a new sound replaces the sound on its channel, and each channel has its own volume. Muting stops all channels. A pointer or key gesture unlocks playback; a sound requested before unlock or before its buffer loads is skipped rather than played late.

## Differences from 1.6

The church bell plays at its own volume and leaves channel 5's alone (see [the church bell fix](../differences-from-fso.md#the-church-bell-leaves-channel-5s-volume-alone)). SSO’s sound switch silences every sound. See the [sound switch difference](../differences-from-fso.md#sound-off-silences-everything), the [core bugs fixed](../differences-from-fso.md#core), the [browser platform changes](../differences-from-fso.md#browser-platform), the [movement bugs fixed](../differences-from-fso.md#movement) and the [server-side movement changes](../differences-from-fso.md#server-side-movement).
