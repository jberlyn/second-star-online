# Mail, news and art

## What happens in play

A character can open a mailbox, read messages and compose a reply. A message can reach an offline character; an online recipient sees a notice. Boards, newspapers, paintings and photos provide other ways to share text and images.

## Where it lives

- [packages/server/src/systems/mail/mail.ts](../../packages/server/src/systems/mail/mail.ts): opens mailboxes and sends and deletes stored messages.
- [packages/server/src/systems/mail/boards.ts](../../packages/server/src/systems/mail/boards.ts): opens boards and handles posts and closing.
- [packages/server/src/systems/mail/newspapers.ts](../../packages/server/src/systems/mail/newspapers.ts): loads, reads and saves newspapers.
- [packages/server/src/systems/mail/art.ts](../../packages/server/src/systems/mail/art.ts): handles canvas, film, viewing and saving art.
- [packages/server/src/systems/mail/upload-check.ts](../../packages/server/src/systems/mail/upload-check.ts): validates uploaded PNG structure.
- [packages/shared/src/rules/mail/mail.ts](../../packages/shared/src/rules/mail/mail.ts): defines mailbox, recipient and board text checks.
- [packages/shared/src/rules/mail/newspaper.ts](../../packages/shared/src/rules/mail/newspaper.ts): defines newspaper author, stand and placement helpers.
- [packages/shared/src/rules/mail/paint.ts](../../packages/shared/src/rules/mail/paint.ts): defines painting pixels, tools and photo crop rules.

Entry points include `packages/server/src/systems/mail/mail.ts` (`mailOpen`), `packages/server/src/systems/mail/mail.ts` (`mailSend`) and `packages/server/src/systems/mail/boards.ts` (`boardOpen`).

## How it works

Opening a mailbox checks position and ownership, loads stored messages and locks movement for as long as the list is open; closing a pane or sending keeps the lock. The list's CLOSE, or a map change, ends the mailbox session (a map change also closes the mail screen), so a send is refused again until a mailbox is next opened. Compose and reply have their own UI state: a refused send retains the draft, and a reply adds "Re: " only once. A send needs a body and recipient and observes the chat cooldown; a muted player or a prisoner cannot send mail or post to a board (`silenced`). The server stamps the sender, strips every space and star from To, takes each different name once, refuses more than seven with a line, silently skips names without a character, stores messages subject to configured limits and notifies online recipients; a visible list is reloaded. Delete removes a message from the deleting player's own mailbox. UI locks are session state, separate from stored mail.

Boards, newspaper stands and paintings or photos on the ground open only from the tile in front of them, facing them (`standingInFront`). A board locks movement, and a guild hall board opens only for that guild's members. Posts go to the open board, which reloads with the post; a refused post leaves the board open, locked, with its text, and a map change closes it. Newspaper handlers load and save the writer's own paper, which their stand shows; any player can open the editor from the Game menu, and a reader sees only existing photo IDs. Using a canvas or film arms one save without using it up; film requires a camera in the right hand, sets a 425-frame item pause, and photos crop the playfield. The canvas and the art viewer lock the keys while open. Paint tools, white included, operate on a 64-by-64 image on the client; the viewer keeps a separate image. A save takes one Canvas or Film from the bag; a full bag refuses the save and keeps it. Art handlers manage viewing and saving; image bytes are stored separately from the transient view state. Upload validation (`isPng`) checks the `artBytesMax` byte cap, the PNG signature, IHDR first, dimensions, supported format, chunk boundaries and checksums, at least one IDAT and IEND last; an upload that fails is dropped without a reply. Books pass to the [spells guide](spells.md), and help text is returned through chat. The original event panel had no reachable sender and is not built.

## Differences from 1.6

The server stores mail and validates image uploads. See the [mail bugs fixed](../differences-from-fso.md#mail) and [server-side mail changes](../differences-from-fso.md#server-side-mail).
