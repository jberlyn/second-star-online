/**
 * The menu bar above the stage, regrouped from 1.6's menus 500 and 502 by what each item is for.
 *
 * 1.6 had File, Edit, Game and Plugins, plus Admin for an immortal (1.6's staff). SSO's bar is Game
 * (your character, the people you know, Settings and Return To Title Screen), Chat (rooms) and
 * Admin for staff with tools (tools and events). Quit Game is dropped (a page cannot close its tab)
 * and so is Plugins. Admin Chat sits with the other rooms, shown only to a role that may use it.
 *
 * Out of the game only what works there shows: Game always (Settings on the title screen, adding
 * Return To Title Screen on login and creation). The rest appears once a character is in play.
 */

import {
  CONTROL_PANEL_PERMISSIONS,
  type KeyAction,
  type Permission,
} from "@secondstaronline/shared";

import type { Menu, MenuItem } from "./menubar.ts";

export interface MenuState {
  /** A character is in the game (an editor counts). */
  inPlay(): boolean;
  /** The title screen is up: Return To Title Screen has nowhere to go. */
  atTitle(): boolean;
  /** Whether your role holds a permission (the server still checks every request). */
  can(permission: Permission): boolean;
  /** Primary bound key label for an action (shown right-aligned on menu items), or "". */
  shortcut(action: KeyAction): string;
  /** The world uses the Class window (issue #15); absent: it does not. */
  classWindow?(): boolean;
}

export type Room = "general" | "newPlayer" | "tradingPost" | "guild" | "admin";
export type AssassinMode = "GO" | "LIGHTNING" | "STOP";

export interface MenuActions {
  returnToTitle(): void;
  clearChat(): void;
  openFriends(): void;
  openWho(): void;
  sendIm(): void;
  enterRoom(room: Room): void;
  controlPanel(): void;
  playerSettings(): void;
  editNewspaper(): void;
  /** Game ▸ Your Class (issue #15). */
  openClass?(): void;
  returnToGame(): void;
  assassin(mode: AssassinMode): void;
}

const SEP: MenuItem = { kind: "sep" };

/** The permissions behind the Admin menu's items: any one shows the menu. */
const ADMIN_MENU: readonly Permission[] = ["assassinGame", ...CONTROL_PANEL_PERMISSIONS];

/** The desktop bar's menus: Game, Chat, Admin (for roles with an admin tool). */
export function desktopMenus(state: MenuState, act: MenuActions): Menu[] {
  const play = () => state.inPlay();
  const item = (label: string, run: () => void): Extract<MenuItem, { kind: "item" }> => ({
    kind: "item",
    label,
    run,
  });
  const inGame = (label: string, run: () => void, key?: KeyAction) => ({
    ...item(label, run),
    visible: play,
    ...(key ? { shortcut: () => state.shortcut(key) } : {}),
  });
  const room = (label: string, r: Room) => inGame(label, () => act.enterRoom(r));
  const controlPanel = () => CONTROL_PANEL_PERMISSIONS.some((p) => state.can(p));
  const gated = (label: string, run: () => void, permission: Permission) => ({
    ...item(label, run),
    visible: () => state.can(permission),
  });
  return [
    {
      title: "Game",
      items: [
        // Your class and the ways out of it (issue #15), in a world that uses classes so.
        {
          ...item("Your Class", () => act.openClass?.()),
          visible: () => play() && state.classWindow?.() === true,
        },
        inGame("Open Friend's List", act.openFriends, "windowFriends"),
        inGame("Who's Online", act.openWho, "windowWho"),
        inGame("Send Instant Message", act.sendIm),
        // Anyone may write the paper their stand shows (1.6 offered it to immortals only).
        inGame("Edit Newspaper", act.editNewspaper),
        { kind: "sep", visible: play },
        item("Settings", act.playerSettings),
        // Works before login too: it leaves the login or creation screen.
        {
          ...item("Return To Title Screen", act.returnToTitle),
          visible: () => play() || !state.atTitle(),
        },
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
    // The Control Panel holds Server Settings (in the File Editor's place) and the editors.
    {
      title: "Admin",
      visible: () => play() && ADMIN_MENU.some((p) => state.can(p)),
      items: [
        { ...item("Control Panel", act.controlPanel), visible: controlPanel },
        // The World and NPC Editors are Control Panel pages (issues #32, #33), with no items here.
        // Its own header returns to the game, and the classic bar never shows over it, so Return
        // To Game has no place here either.
        { kind: "sep", visible: () => controlPanel() && state.can("assassinGame") },
        gated("Begin Assassin's Game", () => act.assassin("GO"), "assassinGame"),
        gated("Begin Lightning Assassin's Game", () => act.assassin("LIGHTNING"), "assassinGame"),
        gated("End Assassin's Game", () => act.assassin("STOP"), "assassinGame"),
      ],
    },
  ];
}
