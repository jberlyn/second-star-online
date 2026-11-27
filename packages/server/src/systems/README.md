# server/systems

One folder per game system. Each folder has a [same-name guide](../../../../docs/guides/README.md).

- [`admin/`](../../../../docs/guides/admin.md): admin commands, the NPC and World Editors, the roster and spawn tools, `/drop`, the
  login and account-creation limits, and the Control Panel's server side: opening and closing it, the NPCs page and
  the monsters' NPC file sections, the player hub (character search, the character editor, house revoke and
  transfer), the activity log, and the cleanup of the world when content in use is removed.
- [`casino/`](../../../../docs/guides/casino.md): slots, blackjack and checkers.
- [`chat/`](../../../../docs/guides/chat.md): chat, instant messages, chat rooms, ignore, who may speak (mutes, prisoners, cooldowns) and the chat log.
- [`combat/`](../../../../docs/guides/combat.md): the melee swing and the arena challenge.
- [`crafting/`](../../../../docs/guides/crafting.md): gathering, station crafts, recipe books and crafting runs.
- [`economy/`](../../../../docs/guides/economy.md): NPC and player shops, the bank, vaults and containers, quests and trade.
- [`housing/`](../../../../docs/guides/housing.md): houses (deeds, the build, decay) and doors, keys and switches.
- [`inventory/`](../../../../docs/guides/inventory.md): the item intents (use, equip, drop, give, pick up) and ground items.
- [`mail/`](../../../../docs/guides/mail.md): mail, message boards, paintings, newspapers and the check on uploaded images.
- [`monsters/`](../../../../docs/guides/monsters.md): roster slots, spawning, monster movement and attacks, and NPCs and their data
  files. Monster spells are in `spells/`.
- [`movement/`](../../../../docs/guides/movement.md): steps and pushing.
- [`progression/`](../../../../docs/guides/progression.md): regen, hunger and death, medals and the Class window.
- [`social/`](../../../../docs/guides/social.md): guilds and guild halls, factions, the Assassin's game, murder and pardons, buddies, bios, presence and the high score table.
- [`spells/`](../../../../docs/guides/spells.md): casting, spell FX and collision, buffs, the hazard timer, learning from books, and
  monster spells.
- [`vehicles/`](../../../../docs/guides/vehicles.md): vehicle construction, boarding, travel and parking for the Airship, Boat and Battleship.
- [`world/`](../../../../docs/guides/world.md): map rooms, visibility, shared event counters and offerings, and the simulation tick.

The shared rules in `packages/shared/src/rules/` use the same folder names, including `world/` for event rules, plus [core](../../../../docs/guides/core.md).

Systems are pure sim logic. They never import `gateway/` or `persistence/`; those arrive as
arguments (`Db`, `Clock`, `Rng`, `Send`). The import-rule test (`tests/import-rules.test.ts`)
enforces this.
