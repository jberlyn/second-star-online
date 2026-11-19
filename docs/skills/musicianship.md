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
- **Nothing else raises it.** In 1.6 a "Music" cast would have trained it, but only an unreachable composer sent one, so SSO does not build that row (`spellImp` in [spells.ts](../../packages/shared/src/rules/spells/spells.ts)).
- **Nothing reads it** except the bio score and high scores.

## Differences from 1.6

- [Class promotions give their skills](../differences-from-fso.md#class-promotions-give-their-skills): Bard now grants Musicianship.
- [The bio score counts every skill](../differences-from-fso.md#the-bio-score-counts-every-skill): Musicianship did not count in 1.6.

## Balance notes

- A Bard's class skill does nothing. Bards are part of the class rethink in [issue #15](https://github.com/jberlyn/second-star-online/issues/15).
