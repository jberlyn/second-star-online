# Skills

Every character has 38 skills, each a whole number from 0 to 100. Skills rise through use, and higher values make attacks, spells, gathering and crafting stronger, faster or more reliable. These pages describe each skill: how it rises, what reads it, and which game systems it touches. They are written for players who want the details and for anyone doing a balance pass or adding content.

The [progression guide](../progression.md) covers character growth as a whole. This page covers the rules every skill shares; each skill page links back here rather than repeating them.

## The skills

| Skill | Kind | Panel |
|---|---|---|
| [Slash](slash.md) | Weapon | Yes |
| [Thrust](thrust.md) | Weapon | Yes |
| [Parry](parry.md) | Defence | Yes |
| [Heavy Arms](heavy-arms.md) | Weapon | Yes |
| [Axe Fighting](axe-fighting.md) | Weapon | Yes |
| [Swordsmanship](swordsmanship.md) | Weapon | Yes |
| [Fencing](fencing.md) | Weapon | Yes |
| [Magery](magery.md) | Magic | Yes |
| [Black Arts](black-arts.md) | Magic | Yes |
| [Unholy Combat](unholy-combat.md) | Weapon | Yes |
| [Archery](archery.md) | Weapon | Yes |
| [Meditation](meditation.md) | Unused | No |
| [Blessing](blessing.md) | Magic | Yes |
| [Sorcery](sorcery.md) | Magic | Yes |
| [Musicianship](musicianship.md) | Unused | Yes |
| [Terrain Navigating](terrain-navigating.md) | Unused | No |
| [Staff Fighting](staff-fighting.md) | Weapon | Yes |
| [Item Identification](item-identification.md) | Magic | Yes |
| [Illusion](illusion.md) | Magic | Yes |
| [Hammer Wielding](hammer-wielding.md) | Weapon | Yes |
| [Fire](fire.md) | Magic (element) | Yes |
| [Water](water.md) | Magic (element) | Yes |
| [Wind](wind.md) | Magic (element) | Yes |
| [Earth](earth.md) | Magic (element) | Yes |
| [Block](block.md) | Defence | Yes |
| [Martial Arts](martial-arts.md) | Weapon and magic | Yes |
| [Wizardry](wizardry.md) | Magic | Yes |
| [Wrath](wrath.md) | Magic | Yes |
| [Punch](punch.md) | Weapon | Yes |
| [Cooking](cooking.md) | Crafting | Yes |
| [Alchemy](alchemy.md) | Crafting | Yes |
| [Lumberjacking](lumberjacking.md) | Gathering | Yes |
| [Carpentry](carpentry.md) | Crafting | Yes |
| [Fishing](fishing.md) | Gathering | Yes |
| [Blacksmithing](blacksmithing.md) | Crafting | Yes |
| [Mining](mining.md) | Gathering | Yes |
| [Shoveling](shoveling.md) | Gathering | Yes |
| [Farming](farming.md) | Gathering | Yes |

The table is in the order of `skills` in [classes.json](../../../packages/data/content/classes.json), which is the order of the Skills page. A character saves each skill under its key (`skill`), so the list can change without moving anyone's training. The Skills page shows 36 of them under their `display` names; Meditation and Terrain Navigating are `hidden`, stored but never shown. Code finds a skill by name with `skillIndex` in [fighter.ts](../../../packages/shared/src/rules/core/fighter.ts), which accepts the spellings the original used (`HeavyArms`, `Heavy Arms`, `fire`). The skills a mechanic reads (Parry, Block, the crafts and others) are named in [bindings.json](../../../packages/data/content/bindings.json); see [Bindings](../../modding.md#bindings-bindingsjson).

## Starting values

A new character starts every skill at 1, except:

| Class | Skills |
|---|---|
| Fighter | Slash 20, Thrust 20 |
| Mage | Magery 30 |
| Ranger | Slash 10, Magery 10, Archery 20 |

The values are each start class's `skills` in `startClasses` in classes.json, by skill key. A skill added to content later starts at 1 (`NEW_SKILL_VALUE`) for every existing character.

## How skills rise

How each skill rises is content: its `progression` in classes.json (see [Progression](../../modding.md#progression)). Classic's skills all use the `chance` model, with 1.6's numbers, so they rise one point at a time. Most rolls take the form "draw `random(n)` and succeed on a 1", a 1-in-n chance; `random` of 0 or less never returns 1, so a bound of 0 or less means the skill cannot rise that way. The ways a skill can rise are listed below.

### Melee kills

When a melee swing kills a monster, `rollKillSkillGain` ([skillgain.ts](../../../packages/shared/src/rules/progression/skillgain.ts)) rolls each skill the weapon trains, in the list's order, by its `kill` progression ([progress.ts](../../../packages/shared/src/rules/progression/progress.ts) `train`). The weapon's list is the **last** matching row of `skillGain.weaponSkills` in classes.json, so a weapon matched by two rows trains only the later row's skills. An `exact` row also matches the masterworks made from its weapon (Knight's Sword +2 trains like Knight's Sword). Monsters killed by spells or arrows train nothing this way. Each skill rolls only if it is above 0 and below its cap (see below), and then needs `random(n) = 1` and to be below the killed monster's cap. Classic's numbers (the world's `kill` default, and the skills' own overrides):

| Skill | n | Also needs |
|---|---|---|
| Hammer Wielding | 40 − Stamina + skill + W | |
| Axe Fighting, Punch, Archery, Martial Arts, Staff Fighting, Slash | skill + W | |
| Heavy Arms | skill + W | Thrust above 60 |
| Unholy Combat | skill | |
| Thrust | 40 − Stamina + skill + W | Slash above 30 |
| Swordsmanship | 25 − Stamina + skill + W | Slash above 50 |
| Fencing | 25 − Stamina + skill + W | Swordsmanship above 20 |

W is the Wisdom term, Classic's `wisdomBonus` stat table (`progression.tables`): it falls as Wisdom rises, so wiser characters learn faster.

| Wisdom | W |
|---|---|
| 5 or less | 30 |
| 6 to 10 | 25 |
| 11 to 15 | 18 |
| 16 to 20 | 10 |
| 21 to 22 | 5 |
| 23 | 3 |
| 24 or more | 0 |

Stamina and Wisdom here are the calculated stats, including class and medal points. The weapons each skill trains are listed on its page.

### Casting

Casting a spell runs `spellImp` ([spells.ts](../../../packages/shared/src/rules/spells/spells.ts)) on the caster: Magery rises on `random(Magery) = 1`, then the spell's school skill (if it has one) rolls the same way, `random(skill) = 1`, and then any more skills the spell trains (Poison Dart: Martial Arts after Black Arts). Each needs the skill above 0 and below the Mage cap, unless the spell sets its own cap: Smoke Bomb's Martial Arts and Identify's Item Identification rise to 100. Wisdom does not affect cast gains. Each magic skill's page lists the spells that train it.

### Being attacked

Parry and Block rise when a monster or another player attacks you. See [Parry](parry.md) and [Block](block.md).

### Shooting arrows

Each arrow shot rolls Archery, and Martial Arts too when the weapon is a crossbow. These rolls rise to 100 whatever the faction. See [Archery](archery.md).

### Gathering and crafting

A successful gather or a finished craft trains the skill by its `gather` or `craft` progression (in [classes.json](../../../packages/data/content/classes.json)): Classic's roll `random(chance) = 1` while the skill is from 0 to 99. The chance does not change with the skill value.

| Skill | Chance per success |
|---|---|
| Cooking | 1 in 8 |
| Blacksmithing, Carpentry | 1 in 9 |
| Lumberjacking, Shoveling, Farming | 1 in 12 |
| Alchemy | 1 in 15 |
| Fishing | 1 in 16 |
| Mining | 1 in 22 |

### Gathering hits

Gathering tools share one hit table (`counterTable` in gather.json, `hitCounter` in [gather.ts](../../../packages/shared/src/rules/crafting/gather.ts)). Each tool keeps its own count of hits left; when the count is empty, the next swing loads it from the skill, and the hit that empties it succeeds. Higher skill means fewer swings per tree, rock, hole or furrow:

| Skill | Hits per success |
|---|---|
| 10 or less | 18 |
| 11 to 20 | 15 |
| 21 to 30 | 14 |
| 31 to 40 | 13 |
| 41 to 50 | 12 |
| 51 to 60 | 10 |
| 61 to 70 | 8 |
| 71 to 80 | 6 |
| 81 to 90 | 4 |
| Above 90 | 3 |

### Crafting time and failure

Cooking, Alchemy and Carpentry share a timer table and a failure table (`craftTimer`, `failurePool` and `rollFailure` in [craft.ts](../../../packages/shared/src/rules/crafting/craft.ts), `stations` in [craft.json](../../../packages/data/content/craft.json)). A craft runs for the timer's frames and then rolls for failure; only a craft that succeeds rolls for a skill gain.

| Skill | Frames | Failure |
|---|---|---|
| 10 or less | 200 | 1 in 3 |
| 11 to 20 | 190 | 1 in 5 |
| 21 to 30 | 170 | 1 in 7 |
| 31 to 40 | 160 | 1 in 7 |
| 41 to 50 | 150 | 1 in 9 |
| 51 to 60 | 120 | 1 in 11 |
| 61 to 70 | 100 | 1 in 13 |
| 71 to 80 | 70 | 1 in 15 |
| 81 to 90 | 50 | 1 in 18 |
| Above 90 | 20 | 1 in 100 |

Cooking at a Campfire takes twice as long. Blacksmithing has its own, longer timer and never fails; see [Blacksmithing](blacksmithing.md).

### Combat books

Reading a combat book (`use.skillBooks` in [item-rules.json](../../../packages/data/content/item-rules.json)) adds its `points`, Classic's `1 + random(5)`, to its skill, but only below its `upTo`, 77, and never takes the skill past it. A book that teaches nothing stays in the bag. Books exist for Slash, Thrust, Heavy Arms, Parry and Unholy Combat.

### Promotion

A [promotion](../progression.md) raises its class's `skillGrants` to a roll of 1 to 10, never lowering a skill already higher. Several promotions also require a minimum skill. Both are listed on each skill's page and in `classes` in classes.json. Classes and promotions are being rethought in [issue #15](https://github.com/jberlyn/second-star-online/issues/15).

## Caps

Every skill stops at 100. Below that, two caps apply to kill and cast gains. Both are in [skillgain.ts](../../../packages/shared/src/rules/progression/skillgain.ts) and depend on your faction and its bonus, which comes from the faction's power (`factionBonus` in [factions.ts](../../../packages/shared/src/rules/social/factions.ts)).

**The combat cap** limits weapon skills raised by kills:

| Faction | Bonus 0 | 1 | 2 | 3 | 4 | 5 or more |
|---|---|---|---|---|---|---|
| None or Mage | 50 | 50 | 50 | 50 | 50 | 50 |
| Warrior | 55 | 60 | 70 | 80 | 90 | 100 |
| Adventurer | 55 | 60 | 65 | 70 | 75 | 80 |

**The Mage cap** (`mageSkillCap`) limits Magery and every magic school, from kills and casts alike, and the kill gains of Unholy Combat and Staff Fighting:

| Faction | Bonus 0 | 1 | 2 | 3 | 4 or more |
|---|---|---|---|---|---|
| Not Mage | 30 | 30 | 30 | 30 | 30 |
| Mage | 50 | 60 | 70 | 90 | 100 |

**The monster cap** (`monsterSkillCap`, `skillCaps` in [monsters.json](../../../packages/data/content/monsters.json)) limits kill gains by what you killed. A monster's body sets a base cap, and your Intelligence adds to it: +3 above 5, +5 above 10, +5 above 15, +5 above 20 and +5 above 22, up to +23.

| Monster (body) | Base cap |
|---|---|
| Illusionary Spikes, Pig, Web, faction members | 10 |
| Slime | 30 |
| Wolf | 35 |
| Orc | 45 |
| Imp | 50 |
| Cyclops | 55 |
| Elf | 62 |
| Poison Frog, Mega Slime | 65 |
| Zombie, Dwarf, Gazer | 70 |
| Death | 75 |
| Lizard Warrior | 80 |
| Demon, Dragon Hatchling, any other monster | 85 |

A skill rises while it is below a cap, so it can reach the cap itself. Skills raised by casting, shooting, being attacked, gathering, crafting, books or promotion ignore the combat and monster caps.

## Rewards

- **Medals.** A skill at 90 or more holds its medal: it shows on the bio and adds stat points. Dropping below 90 removes both. Reaching 90 in play prints the medal's line. Nineteen skills have medals (`medals` in [social.json](../../../packages/data/content/social.json), [medals.ts](../../../packages/shared/src/rules/progression/medals.ts)); each page names its medal.
- **Bio titles.** The bio shows the last title in `bios.titles` (social.json) whose skills are all above its thresholds, or "Adventurer" when none are. Order in the table, not skill value, decides which title wins.
- **Bio score and high scores.** The bio score, also used for high scores, sums every skill plus maximum HP and SP, except Meditation, Terrain Navigating, Item Identification, Shoveling and Farming (`bios.score.counted`).
- **Combat rating.** The Assassin's Game compares killer and victim by a combat rating: sixteen combat skills plus maximum HP (`assassin.rating.skills` in social.json, [assassin.ts](../../../packages/shared/src/rules/social/assassin.ts)).
- **Master platforms.** The Slash, Mage and Ninja Master Platforms block a player on foot from stepping onto them until Slash, Magery or Martial Arts reaches 90 (`ground.platforms` in item-rules.json, `blocksPlayer` in [ground.ts](../../../packages/shared/src/rules/inventory/ground.ts)).

## Where it lives

- [packages/data/content/classes.json](../../../packages/data/content/classes.json): the skill list, panel, starting values, promotion grants and requirements, and the weapons each kill trains.
- [packages/shared/src/rules/progression/skillgain.ts](../../../packages/shared/src/rules/progression/skillgain.ts): kill gains, the combat, Mage and monster caps.
- [packages/shared/src/rules/spells/spells.ts](../../../packages/shared/src/rules/spells/spells.ts): cast gains, spell power and books.
- [packages/shared/src/rules/combat/attpower.ts](../../../packages/shared/src/rules/combat/attpower.ts) and [attpower.json](../../../packages/data/content/attpower.json): melee and bow attack power, including each weapon skill's tiers.
- [packages/shared/src/rules/combat/combat.ts](../../../packages/shared/src/rules/combat/combat.ts) and [armour.ts](../../../packages/shared/src/rules/combat/armour.ts): swing speed, parry and block.
- [packages/shared/src/rules/crafting/gather.ts](../../../packages/shared/src/rules/crafting/gather.ts) and [craft.ts](../../../packages/shared/src/rules/crafting/craft.ts), with [gather.json](../../../packages/data/content/gather.json) and [craft.json](../../../packages/data/content/craft.json): gathering and crafting.
- [packages/shared/src/rules/progression/medals.ts](../../../packages/shared/src/rules/progression/medals.ts), [bios.ts](../../../packages/shared/src/rules/social/bios.ts) and [social.json](../../../packages/data/content/social.json): medals, titles and the score.

To change a skill's numbers, edit the content JSON and run `bun run data:build` (see [modding](../../modding.md)). The tier ladders for spell power, parry and block, and the kill-gain formulas are in code.

## Differences from 1.6

Skill behaviour differs from 1.6 in several places; each page links the entries that touch it. The ones that touch many skills are [Class promotions give their skills](../../differences-from-fso.md#class-promotions-give-their-skills), [Mage skills cap the same from kills and casts](../../differences-from-fso.md#mage-skills-cap-the-same-from-kills-and-casts), [Medals and their stat points come from your skills](../../differences-from-fso.md#medals-and-their-stat-points-come-from-your-skills), [The bio score counts all its listed skills](../../differences-from-fso.md#the-bio-score-counts-all-its-listed-skills), [Books teach what they say, and stay when they teach nothing](../../differences-from-fso.md#books-teach-what-they-say-and-stay-when-they-teach-nothing) and [Gathering and crafting skills rise from 0](../../differences-from-fso.md#gathering-and-crafting-skills-rise-from-0).
