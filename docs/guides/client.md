# Client

## What happens in play

Pressing an arrow sends movement intent. The client can show the input promptly, then uses the server's state and updates to show the accepted result. Enter opens chat, where arrows move the caret instead of the character. Alt with an arrow turns, Tab holds attack, and Ctrl acts on the faced item.

## Where it lives

- [packages/client/src/main.ts](../../packages/client/src/main.ts): starts the application.
- [packages/client/src/app.ts](../../packages/client/src/app.ts): connects screens, input, messages and game state.
- [packages/client/src/model.ts](../../packages/client/src/model.ts): maintains client-side game state.
- [packages/client/src/net.ts](../../packages/client/src/net.ts): connects, sends messages and resumes after an unexpected disconnect.
- [packages/client/src/input.ts](../../packages/client/src/input.ts): translates keyboard changes into intents.
- [packages/client/src/assets.ts](../../packages/client/src/assets.ts): loads asset metadata and images.
- [packages/client/src/playfield.ts](../../packages/client/src/playfield.ts): draws the playfield.
- [packages/client/src/fog.ts](../../packages/client/src/fog.ts): draws fog.
- [packages/client/src/audio.ts](../../packages/client/src/audio.ts): manages audio playback.
- [packages/client/src/sfx.ts](../../packages/client/src/sfx.ts): maps sound effects to playback.
- [packages/client/src/styles.css](../../packages/client/src/styles.css): styles the client and its screens.

The UI files are:

- [packages/client/src/ui/alert.ts](../../packages/client/src/ui/alert.ts): in-page alerts.
- [packages/client/src/ui/amount.ts](../../packages/client/src/ui/amount.ts): gold and crystal amount dialog.
- [packages/client/src/ui/away.ts](../../packages/client/src/ui/away.ts): away message window.
- [packages/client/src/ui/bars.ts](../../packages/client/src/ui/bars.ts): health, spell and attack power bars.
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
- [packages/client/src/ui/im.ts](../../packages/client/src/ui/im.ts): instant message windows.
- [packages/client/src/ui/mail.ts](../../packages/client/src/ui/mail.ts): mail list and compose panes.
- [packages/client/src/ui/menubar.ts](../../packages/client/src/ui/menubar.ts): generic menu bar widget.
- [packages/client/src/ui/newspaper.ts](../../packages/client/src/ui/newspaper.ts): newspaper reader and editor.
- [packages/client/src/ui/npceditor.ts](../../packages/client/src/ui/npceditor.ts): NPC editor.
- [packages/client/src/ui/action.ts](../../packages/client/src/ui/action.ts): semantic action annotations.
- [packages/client/src/ui/paint.ts](../../packages/client/src/ui/paint.ts): painting, viewer and camera screens.
- [packages/client/src/ui/panel.ts](../../packages/client/src/ui/panel.ts): stats, inventory and skills panel.
- [packages/client/src/ui/placement.ts](../../packages/client/src/ui/placement.ts): house placement mode.
- [packages/client/src/ui/quit.ts](../../packages/client/src/ui/quit.ts): quit screen.
- [packages/client/src/ui/screens.ts](../../packages/client/src/ui/screens.ts): title, login and character creation.
- [packages/client/src/ui/settings.ts](../../packages/client/src/ui/settings.ts): operator settings window.
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

The input layer resolves multiple held arrows left, right, up, then down. A new press emits a step intent; changes to held direction or turning emit a move intent. Focus and chat suppress game input where appropriate. The connection sends messages to the server, receives snapshots and updates, and attempts to resume with a token after an unexpected disconnect, with a delay between attempts; logout, kick and other final close codes do not resume. Messages sent while disconnected are queued. The model predicts ordinary steps with the shared rules, then reconciles its position and facing with server updates; map edges wait for the server snapshot. The application applies incoming state, and the playfield draws the game while DOM screens provide controls and windows.

The stage, panel, placement, window and shell modules arrange screens. Assets use retained layout metadata and sprite images. Audio uses eight channels; a new sound replaces the sound on its channel, and each channel has its own volume. Muting stops all channels. A pointer or key gesture unlocks playback; a sound requested before unlock or before its buffer loads is skipped rather than played late.

## Kept bugs and differences

The church bell leaves channel 5 at its new volume for the rest of the session, even when sound is off. SSO’s sound switch silences every sound. See the [bell volume kept bug](../bug-ledger.md#after-the-church-bell-channel-5-stays-loud), [sound switch difference](../divergences.md#sound-off-silences-everything), [input kept bugs](../bug-ledger.md#movement), and [movement differences](../divergences.md#movement).

