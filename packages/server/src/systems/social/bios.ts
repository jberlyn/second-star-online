/**
 * Player bios and profiles on the server.
 *
 * 1.6's target client composed its own bio and any `*@*` message opened a Bio window, asked for or
 * not. The server composes it from the target's state with `giveBio`, draws it for the asker with
 * `drawProfile` and sends it only in answer to a request. An offline target gets nothing (an SMUS
 * error, ignored); a dead one answers, as 1.6's dead-player gate never closed and let it (nothing
 * set the flag to 1).
 */
import { type BioSource, drawProfile, giveBio, saveProfile } from "@secondstaronline/shared";

import type { Outgoing, Player, World } from "../world/world.ts";
import { guildOf } from "./guilds.ts";
import { onlineNamed } from "./presence.ts";

/** Nature Shift's tree (`setBody(p, 80)`): its `Chars` members are named "80-…". */
const TREE_BODY = 80;

/** What the bio composer reads from the target. */
export function bioSource(world: World, t: Player): BioSource {
  const guild = guildOf(world, t);
  return {
    name: t.name,
    sex: t.char.sex,
    level: t.char.vitals.level,
    profile: t.char.profile,
    medals: t.char.medals,
    skills: t.char.skills,
    hpMax: t.char.vitals.hpMax,
    spMax: t.char.vitals.spMax,
    // The `Guild` field names it; "Leader of" when the guild file holds `*<me>*`, which only its
    // header does.
    guild: t.guild === "" ? null : { name: t.guild, leader: guild?.leaderId === t.id },
    faction: t.char.faction.id,
    wanted: t.char.wanted,
    body: t.spell.body,
    tree: t.spell.body === TREE_BODY,
    bodyItem: t.char.equip.body,
    // The `Vehicle` field: the Robe's disguise is skipped aboard.
    inVehicle: t.vehicle !== null,
  };
}

/**
 * A bio request (`$*+`): the player menu's Bio names a player by id, the Who window's Profile by
 * name (as a P2P message reached a name ignoring case). Silent when the target is offline.
 */
export function bioRequest(
  world: World,
  p: Player,
  to: { id?: string | undefined; name?: string | undefined },
): Outgoing[] {
  const t =
    to.id !== undefined
      ? world.players.get(to.id)
      : to.name !== undefined
        ? onlineNamed(world, to.name)
        : null;
  if (!t) {
    return [];
  }
  const d = drawProfile(giveBio(bioSource(world, t)), p.name);
  return [
    {
      to: p.id,
      msg: {
        t: "playerBio",
        title: d.title,
        bio: d.bio,
        profile: d.profile,
        medals: d.medals,
        own: d.own,
      },
    },
  ];
}

/**
 * Closing your own Bio window: the strip, then an alert for a remaining ":" or "/", else the new
 * profile, written through `write`.
 */
export function profileSave(p: Player, text: string, write: (profile: string) => void): Outgoing[] {
  const r = saveProfile(text);
  if (r.profile === null) {
    return r.alert ? [{ to: p.id, msg: { t: "alert", text: r.alert } }] : [];
  }
  if (r.profile !== p.char.profile) {
    p.char.profile = r.profile;
    write(r.profile);
  }
  return [];
}
