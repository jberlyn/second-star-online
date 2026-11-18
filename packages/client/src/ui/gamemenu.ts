/**
 * 1.6's menus, drawn above the stage as the menu bar.
 *
 * The classic layout draws menu 500 (File, Edit, Game) and, for an immortal, menu 502's Admin
 * between Edit and Game, plus SSO's Options. Plugins stays dropped.
 */

import type { Menu, MenuItem } from "./menubar.ts";

export interface MenuState {
  /** A character is in the game (an editor counts). */
  inPlay(): boolean;
  immortal(): boolean;
  sharp(): boolean;
  sfx(): boolean;
}

export type Room = "general" | "newPlayer" | "tradingPost" | "guild" | "admin";
export type AssassinMode = "GO" | "LIGHTNING" | "STOP";

export interface MenuActions {
  returnToTitle(): void;
  quitGame(): void;
  clearChat(): void;
  openFriends(): void;
  sendIm(): void;
  enterRoom(room: Room): void;
  worldEditor(): void;
  npcEditor(): void;
  settings(): void;
  editNewspaper(): void;
  adminChat(): void;
  returnToGame(): void;
  assassin(mode: AssassinMode): void;
  setSharp(on: boolean): void;
  setSfx(on: boolean): void;
}

const SEP: MenuItem = { kind: "sep" };

/** The desktop bar's menus, in 1.6's order. */
export function desktopMenus(state: MenuState, act: MenuActions): Menu[] {
  const play = () => state.inPlay();
  const item = (label: string, run: () => void, enabled?: () => boolean): MenuItem => ({
    kind: "item",
    label,
    run,
    ...(enabled ? { enabled } : {}),
  });
  return [
    // Menu 500: File > Return To Title Screen and Quit Game both work before login.
    {
      title: "File",
      items: [item("Return To Title Screen", act.returnToTitle), item("Quit Game", act.quitGame)],
    },
    { title: "Edit", items: [item("Clear Chat Text", act.clearChat, play)] },
    // Menu 502 adds Admin for an immortal; Settings stands in the File Editor's place.
    {
      title: "Admin",
      visible: () => state.immortal(),
      items: [
        item("World Editor", act.worldEditor, play),
        item("NPC Editor", act.npcEditor, play),
        item("Settings", act.settings, play),
        SEP,
        item("Admin Chat", act.adminChat, play),
        item("Return To Game", act.returnToGame, play),
        SEP,
        item("Begin Assassin's Game", () => act.assassin("GO"), play),
        item("Begin Lightning Assassin's Game", () => act.assassin("LIGHTNING"), play),
        item("End Assassin's Game", () => act.assassin("STOP"), play),
      ],
    },
    {
      title: "Game",
      items: [
        item("Open Friend's List", act.openFriends, play),
        SEP,
        item("Send Instant Message", act.sendIm, play),
        // Anyone may write the paper their stand shows (1.6 offered it to immortals only).
        item("Edit Newspaper", act.editNewspaper, play),
        SEP,
        item("General Chat", () => act.enterRoom("general"), play),
        item("New Player Chat", () => act.enterRoom("newPlayer"), play),
        item("Trading Post Chat", () => act.enterRoom("tradingPost"), play),
        item("Guild Chat", () => act.enterRoom("guild"), play),
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
