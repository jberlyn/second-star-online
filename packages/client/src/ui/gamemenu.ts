/**
 * The menu bar above the stage, regrouped from 1.6's menus 500 and 502 by what each item is for.
 *
 * 1.6 had File, Edit, Game and Plugins, plus Admin for an immortal. SSO's bar is Game (your
 * character and the people you know), Chat (rooms), Admin for staff with tools (tools and events) and
 * Options (browser preferences). Quit Game is dropped (a page cannot close its tab) and so is
 * Plugins. Admin Chat sits with the other rooms, shown only to a role that may use it.
 *
 * Out of the game only what works there shows: Options always, and on the login and creation
 * screens Game with Return To Title Screen alone. The rest appears once a character is in play.
 */

import type { Permission } from "@secondstaronline/shared";

import type { Menu, MenuItem } from "./menubar.ts";

export interface MenuState {
  /** A character is in the game (an editor counts). */
  inPlay(): boolean;
  /** The title screen is up: Return To Title Screen has nowhere to go. */
  atTitle(): boolean;
  /** Whether your role holds a permission (the server still checks every request). */
  can(permission: Permission): boolean;
  sharp(): boolean;
  sfx(): boolean;
}

export type Room = "general" | "newPlayer" | "tradingPost" | "guild" | "admin";
export type AssassinMode = "GO" | "LIGHTNING" | "STOP";

export interface MenuActions {
  returnToTitle(): void;
  clearChat(): void;
  openFriends(): void;
  sendIm(): void;
  enterRoom(room: Room): void;
  worldEditor(): void;
  npcEditor(): void;
  serverSettings(): void;
  editNewspaper(): void;
  returnToGame(): void;
  assassin(mode: AssassinMode): void;
  setSharp(on: boolean): void;
  setSfx(on: boolean): void;
}

const SEP: MenuItem = { kind: "sep" };

/** The permissions behind the Admin menu's items: any one shows the menu. */
const ADMIN_MENU: readonly Permission[] = ["worldEditor", "npcEditor", "settings", "assassinGame"];

/** The desktop bar's menus: Game, Chat, Admin (for roles with an admin tool), Options. */
export function desktopMenus(state: MenuState, act: MenuActions): Menu[] {
  const play = () => state.inPlay();
  const item = (label: string, run: () => void): Extract<MenuItem, { kind: "item" }> => ({
    kind: "item",
    label,
    run,
  });
  const inGame = (label: string, run: () => void) => ({ ...item(label, run), visible: play });
  const room = (label: string, r: Room) => inGame(label, () => act.enterRoom(r));
  const gated = (label: string, run: () => void, permission: Permission) => ({
    ...item(label, run),
    visible: () => state.can(permission),
  });
  return [
    {
      title: "Game",
      visible: () => play() || !state.atTitle(),
      items: [
        inGame("Open Friend's List", act.openFriends),
        inGame("Send Instant Message", act.sendIm),
        // Anyone may write the paper their stand shows (1.6 offered it to immortals only).
        inGame("Edit Newspaper", act.editNewspaper),
        { kind: "sep", visible: play },
        // Works before login too: it leaves the login or creation screen.
        item("Return To Title Screen", act.returnToTitle),
      ],
    },
    {
      title: "Chat",
      visible: play,
      items: [
        room("General Chat", "general"),
        room("New Player Chat", "newPlayer"),
        room("Trading Post Chat", "tradingPost"),
        room("Guild Chat", "guild"),
        { ...room("Admin Chat", "admin"), visible: () => play() && state.can("adminChat") },
        SEP,
        item("Clear Chat Text", act.clearChat),
      ],
    },
    // Server Settings stands in the File Editor's place.
    {
      title: "Admin",
      visible: () => play() && ADMIN_MENU.some((p) => state.can(p)),
      items: [
        gated("World Editor", act.worldEditor, "worldEditor"),
        gated("NPC Editor", act.npcEditor, "npcEditor"),
        {
          ...item("Return To Game", act.returnToGame),
          visible: () => state.can("worldEditor") || state.can("npcEditor"),
        },
        SEP,
        gated("Server Settings", act.serverSettings, "settings"),
        SEP,
        gated("Begin Assassin's Game", () => act.assassin("GO"), "assassinGame"),
        gated("Begin Lightning Assassin's Game", () => act.assassin("LIGHTNING"), "assassinGame"),
        gated("End Assassin's Game", () => act.assassin("STOP"), "assassinGame"),
      ],
    },
    // SSO's own: the browser preferences, in 1.6's Title Case.
    {
      title: "Options",
      items: [
        {
          kind: "item",
          label: "Sharp Pixels Only",
          checked: state.sharp,
          run: () => act.setSharp(!state.sharp()),
        },
        {
          kind: "item",
          label: "Sound Effects",
          checked: state.sfx,
          run: () => act.setSfx(!state.sfx()),
        },
      ],
    },
  ];
}
