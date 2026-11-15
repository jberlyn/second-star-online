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

Opening a mailbox checks position and ownership, loads stored messages and locks movement while the list is open. Compose and reply have their own UI state: a refused send retains the draft. A send needs a body and recipient and observes the chat cooldown. The server stamps the sender, resolves up to seven recipients, silently skips names without a character, stores messages subject to configured limits and notifies online recipients; a visible list is reloaded. Delete acts on the sender's own mailbox. UI locks are session state, separate from stored mail.

The town board locks movement; a guild hall board checks the character’s position and does not lock it. Posts go to the last opened board, and a refused post leaves the board open with its text. Newspaper handlers load and save the text associated with a stand; editing is restricted to immortals, and a reader sees only existing photo IDs. Using a canvas or film grants a matching save credit; film requires a camera in the right hand, and photos crop the playfield. Paint tools operate on a 64-by-64 image on the client; white brushes leave pixels unchanged. A save spends that credit; a full bag refuses the save and keeps the credit. Art handlers manage viewing and saving; image bytes are stored separately from the transient view state. Upload validation checks the PNG signature, dimensions, supported format, chunk boundaries and checksums. Books pass to the [spells guide](spells.md), and help text is returned through chat. The original event panel had no reachable sender and is not built.

## Kept bugs and differences

Closing a mail pane can unlock movement while the list remains open. The server stores mail and validates image uploads. See [mail kept bugs](../bug-ledger.md#mail) and [mail differences](../divergences.md#mail).

