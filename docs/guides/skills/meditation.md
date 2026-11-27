# Meditation

Meditation is stored for every character but has no effect. It is a hidden slot that content could use in future.

| | |
|---|---|
| Kind | Unused |
| Starting value | 1 |
| Rises from | Nothing |
| Cap | 100 |
| Medal | None |
| Counts towards | Nothing |

## How it works

Meditation is in the stored skills (`skills` in [classes.json](../../../packages/data/content/classes.json)), marked `hidden`, so the Skills page leaves it out. Nothing raises it and no rule reads it. It is kept because 1.6 saved it.

## Adding content

A new use for it needs a way to raise it, something that reads it, and the `hidden` mark taken off its row to show it. Every existing character already has it at 1.

Most of that is content an operator can set on the Control Panel, with no code:

- **Raising it:** a `progression` on its row for a source the engine already has (see [progression](../../modding.md#progression)), a harvest node or recipe that names it as its skill, a spell's `school` or `alsoTrains`, a weapon's `skillGain.weaponSkills` row, a book in `use.skillBooks`, a promotion's `skillGrants` or a class path's `grants`.
- **Reading it:** a [requirement](../../modding.md#requirements) on an item, harvest node, recipe, spell or class path, a condition in an attack-power or spell-power row, a harvest node's or recipe's odds, or a Bio title.

A new kind of activity, such as meditating to restore SP, still needs code.
