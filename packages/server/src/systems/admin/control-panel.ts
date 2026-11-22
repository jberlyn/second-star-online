/**
 * The Control Panel on the server (issue #24): a full-page dashboard in the client.
 *
 * - Open: a role that may open the Control Panel (`canOpenControlPanel`). You leave the map as for the World
 *   Editor: everyone there sees you go, nothing on it ticks for you, and trades, shops and held
 *   actions are cancelled. From an editor you are already off the map and stay off it.
 * - Close: Return to Game (`editClose`), back where you stood with the login i-frames
 *   (`closeEditor`).
 *
 * Each page's own requests are gated by their own permission (`ADMIN_INTENTS` in game.ts).
 */
import { canOpenControlPanel } from "@secondstaronline/shared";

import type { CasinoDeps } from "../casino/index.ts";
import type { Outgoing, Player, World } from "../world/world.ts";
import { leaveForEditor } from "./worldedit.ts";

/** Admin menu → Control Panel. Anyone who may not open it gets nothing. */
export function openControlPanel(world: World, p: Player, casino: CasinoDeps): Outgoing[] {
  if (!canOpenControlPanel(p.role) || p.editing === "controlPanel") {
    return [];
  }
  const out = leaveForEditor(world, p, "controlPanel", casino);
  out.push({ to: p.id, msg: { t: "controlPanel" } });
  return out;
}
