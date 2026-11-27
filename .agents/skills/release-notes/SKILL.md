---
name: release-notes
description: Draft GitHub release notes for Second Star Online covering every change since the latest tag, written for server operators, and recommend a patch or minor version. Use when preparing a release, tagging a version, or asked for release notes or a changelog.
---

# Release notes

The release notes go on the GitHub release for each `v*` tag. They are written for **server operators**: people who host the game and need to know what changed, what they must do to upgrade, and what their players will notice. Git history is the changelog; there is no `CHANGELOG.md`.

## 1. Gather the changes

Base every claim on the code as it was **at the tag being described**, not the working tree. Later commits can reverse a change, for example a permission granted in one release and taken back in the next. Read code with `git show <tag>:<path>` and compare with `git diff <previous>..<tag> -- <path>`. Use commit messages and docs only to find changes, then confirm each one in the code. When writing notes for an unreleased version, `<tag>` is `HEAD`.

1. Find the previous release: `git describe --tags --abbrev=0`, and `gh release list` to confirm it is published.
2. Read every commit since it, bodies included: `git log <tag>..HEAD --format='%h %s%n%b'`. Commit bodies often list several user-facing fixes; read them all.
3. Look for things operators must act on. Check each of these over the range (`git diff <tag>..HEAD -- <path>`):
   - `packages/server/migrations/`: new migrations. Say what they do to existing data.
   - The settings and command tables in `docs/running-a-server.md`: settings added, removed or renamed, and new commands.
   - `packages/shared/src/rules/admin/permissions.ts`: what each role may do. Staff roles live in the database and operators edit them, so the code holds only the permission list (`TOOL_PERMISSIONS`, `EXEMPTIONS`) and the roles a fresh database is seeded with (`MODERATOR`, `ADMINISTRATOR`, `DEFAULT_ROLES`). A new permission, or a change to a seeded role, reaches existing servers only through a migration, so read the role migrations too (`*_roles.sql` and any later migration that writes the `roles` table) and say whether existing roles gain the permission or the operator must grant it.
   - `docker-compose.yml`, `Dockerfile` and environment variables: renamed services or volumes, and new or changed variables.
   - Changes to content data (`packages/data/content/`) that shift the economy, such as payouts or prices.
4. New entry headings in `docs/differences-from-fso.md` give a reliable list of behaviour changes and fixed bugs. Entries are `####` headings (`###` under Kept on purpose). Compare heading lists rather than the diff, because entries move between sections: `comm -13 <(git show <tag>:docs/differences-from-fso.md | grep -E '^#{3,4} ' | sort) <(grep -E '^#{3,4} ' docs/differences-from-fso.md | sort)`. For tags before the ledger was renamed, read `git show <tag>:docs/divergences.md` and compare its `###` entry headings.
5. Check the pending upgrade items below and carry each one into the first release it ships in, then delete it from this list.
6. Leave out changes that affect neither operators nor players: tests, internal refactors, documentation-only commits and repository images.

### Pending upgrade items

Changes that the next release after `v1.17.0` must list under Upgrade Notes (confirm each in the code at the tag):

- **Migration 81 (`20261126_81_guild_halls.sql`, issue #16) and the first start after it.** Adds `houses.guild_id`. At the first start, each existing guild hall is matched to its guild by the Guild Vault inside it (or its "Hall of the <guild>" header). **A hall whose guild is disbanded, or that matches no guild, is demolished, and every disbanded guild's Guild Vault is emptied.** Both are logged as `demolish` world events in the Activity Log. Operators who want to save a disbanded guild's vault must move its items before upgrading. A disbanded guild's name is then free for anyone to found.
- **Migration 82 (`20261127_82_world_counters.sql`, issue #3) and the orb war in Classic.** Adds the `world_counters` table; the first start saves Classic's four orb war counters (Fire, Water, Earth and Wind at 25). The Classic pack now has the Fire, Water, Earth and Wind Orbs (dropped 1 in 20 by Fire Demons, Snow Demons, Stone Skulls and Gryphons, which now carry an NPC file line `FLG|Still` beside the loot so they still stand still) and the four Orb Platforms. **Orbs can drop immediately. To let players make offerings, place the platforms on the Control Panel's World page**; an operator who changed those four monsters' NPC files keeps their own file and gets no orb loot. The new World Events page edits counters, offerings and counter perks, and `/counter` (content editor permission, already held by administrators) reads and sets the counters. Element mages' spell power now follows their element's share (±1 per 10 from 25).

## 2. Choose the version

Versions follow semantic versioning.

- **Patch** (`x.y.Z`): only bug fixes. No new commands or settings, no migrations, and nothing an operator has to do.
- **Minor** (`x.Y.0`): any new feature, command or setting; any migration; any setting removed or renamed; any change to staff permissions; or anything listed under Upgrade Notes.
- **Major** (`X.0.0`): an upgrade that cannot be done in place (for example, it needs a manual data migration or a fresh world). Confirm with the maintainer before choosing it.

State the recommended version and the reason in one or two sentences.

## 3. Write the notes

Use this template. Leave out any section with nothing in it. A patch release often has only Highlights and Fixed.

```markdown
## Highlights
One to three sentences on what this release is about, for readers who stop here.

## ⚠️ Upgrade Notes
- **Short label.** What changed and exactly what the operator must do.

## New
- **Area:** Something operators, staff or players can now do.

## Changed
- **Area:** Existing behaviour that now works differently.

## Fixed
- **Area:** A bug that no longer happens.

## Removed
- **Area:** Something taken out, and what replaces it.

**Full Changelog:** https://github.com/jberlyn/second-star-online/compare/<previous>...<new>
```

Writing rules:

- Check names and numbers in the code: settings, defaults, payouts, limits and what labels such as "SP" mean in the game.
- Describe the effect, not the code. "Bows fire only with arrows and a crystal" rather than "derive the shot from attackPower".
- Start each bullet with a bold area label: Combat, Moderation, Casino, Chat & Messaging, Admin & World Tools, Interface, Hosting, and so on.
- Put every migration, removed or renamed setting, permission change and configuration change under Upgrade Notes, even if it also appears in another section. Tell the operator to back up before any release with a migration.
- Name commands, settings and tables in backticks exactly as they appear in the code.
- Group many small fixes in one area into a single bullet. Summarise rather than copying the differences document.
- Use links that work from the release page: full GitHub URLs, not relative paths. Link to docs at the tag (`/blob/<tag>/docs/...`).

## 4. Publish

1. Show the maintainer the draft notes and the recommended version, then wait for approval.
2. Tags carry a `v` prefix (`v1.10.0`); a valid version tag reachable from `main` publishes its version image. Only a stable release can advance `latest` (`.github/workflows/publish-image.yml`; pushes to `main` only move `edge`), so only tag once approved:
   ```sh
   git tag v<version> && git push origin v<version>
   gh release create v<version> --title v<version> --notes-file <notes.md>
   ```
3. To rewrite an existing release, save its current notes first (`gh release view <tag> --json body -q .body`), then run `gh release edit <tag> --notes-file <notes.md>`.
