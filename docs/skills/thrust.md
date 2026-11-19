# Thrust

Thrust adds attack power to every weapon, including bare hands and bows. It rises only once Slash is above 30, and it gates Heavy Arms.

| | |
|---|---|
| Kind | Weapon |
| Starting value | Fighter 20, others 1 |
| Rises from | Melee kills; the Thrust Book; the Grunt promotion |
| Cap | [Combat cap](README.md#caps) on kills; 77 from books |
| Medal | The Golden Lance at 90: +2 Strength |
| Counts towards | Bio score, high scores, combat rating |

## How it rises

- **Melee kills** with the same weapons as [Slash](slash.md): every axe, sword, knife, dagger and the Hammer, Thor's Hammer, Katana, Scimitar and Bo. The chance is 1 in (40 − Stamina + Thrust + W), and a gain also needs Slash above 30. See [melee kills](README.md#melee-kills).
- **The Thrust Book** adds 1 to 5 while Thrust is below 77.
- **Promotion to Grunt** raises Thrust to a roll of 1 to 10 if it is lower.

## What it does

Attack power with any weapon, applied after every other skill bonus: +1 above 0, +1 above 20, +1 above 30, +1 above 70 and +1 above 97, up to +5.

Thrust above 60 is needed for [Heavy Arms](heavy-arms.md) to rise from kills.

## Connected systems

- **Combat:** attack power (the `any` block in [attpower.json](../../packages/data/content/attpower.json)).
- **Bio titles:** Jouster (above 50 with Slash above 60), Gladiator (above 60 with Heavy Arms above 70).

## Differences from 1.6

- [Class promotions give their skills](../differences-from-fso.md#class-promotions-give-their-skills): Grunt now grants Thrust.
- [Books teach what they say, and stay when they teach nothing](../differences-from-fso.md#books-teach-what-they-say-and-stay-when-they-teach-nothing).

## Balance notes

- Thrust is the only skill that boosts every weapon, bows and fists included.
- High Stamina slows Thrust gains. When Stamina is above 40 + Thrust + W, the draw bound is 0 or less and Thrust cannot rise from kills at all.
