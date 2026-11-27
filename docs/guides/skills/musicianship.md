# Musicianship

Musicianship is the Bard's skill. It shows in the skill panel and the Bard promotion grants it, but nothing in play raises it or reads it.

| | |
|---|---|
| Kind | Unused |
| Starting value | 1 |
| Rises from | The Bard promotion only |
| Cap | 100 |
| Medal | None |
| Counts towards | Bio score, high scores |

## How it works

- **Promotion to Bard** (from Swordsman, Priest or Archer, with maximum HP of 35) raises Musicianship to a roll of 1 to 10 if it is lower.
- **Nothing else raises it.** In 1.6 a "Music" cast would have trained it, but only an unreachable composer sent one, so SSO does not build that row (`spellImp` in [spells.ts](../../../packages/shared/src/rules/spells/spells.ts)).
- **Nothing reads it** except the bio score and high scores.

## Differences from 1.6

- [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills): Bard now grants Musicianship.
- [The bio score counts all its listed skills](../../differences-from-fso.md#the-bio-score-counts-all-its-listed-skills): Musicianship did not count in 1.6.

## Balance notes

- A Bard's class skill does nothing in Classic, as in 1.6. An operator can give it a use from content: a way to raise it and something that reads it (see [Meditation](meditation.md#adding-content)), or perks, caps and training speeds on the Bard class itself (see [classes](../../modding.md#classes)).
