/** Test helpers for the desktop menu bar. */
import {
  type MapView,
  NO_EQUIPMENT,
  NO_FOG,
  type PlayerView,
  type SelfState,
  type ServerMsg,
} from "@secondstaronline/shared";

const rows = (code: string) => Array.from({ length: 12 }, () => Array(17).fill(code).join(" "));
const map: MapView = {
  name: "x1000y992",
  title: "",
  layers: [rows("G1"), rows("G3"), rows("G3"), rows("5A")],
  signs: ["", "", ""],
  fog: { ...NO_FOG },
};
const you: PlayerView = {
  id: "me",
  name: "Me",
  head: 1,
  x: 5,
  y: 5,
  facing: "N",
  step: null,
  equip: { ...NO_EQUIPMENT },
  body: null,
};
const self: SelfState = { n: 0, x: 5, y: 5, facing: "N", frames: 0 };

/** The snapshot that puts the character in the game (the menus' "in play"). */
export const SNAPSHOT: ServerMsg = {
  t: "snapshot",
  map,
  you,
  self,
  players: [],
  monsters: [],
  ground: [],
};

export const titles = (root: ParentNode): string[] =>
  [...root.querySelectorAll<HTMLElement>(".menu-title:not([hidden])")].map(
    (t) => t.textContent ?? "",
  );

export const openMenu = (root: ParentNode, title: string): HTMLElement | null => {
  const t = [...root.querySelectorAll<HTMLElement>(".menu-title")].find(
    (b) => b.textContent === title,
  );
  if (t?.getAttribute("aria-expanded") !== "true") {
    t?.click();
  }
  return root.querySelector<HTMLElement>(".menu-drop");
};

/** The open menu's items in order; a separator reads "-". */
export const menuTexts = (root: ParentNode, title: string): string[] => {
  const drop = openMenu(root, title);
  return [...(drop?.children ?? [])].map((e) =>
    e.classList.contains("menu-sep") ? "-" : (e.textContent ?? ""),
  );
};

/** Clicks `item` in `title`'s menu, as a player would. */
export function menuClick(root: ParentNode, title: string, item: string): void {
  const drop = openMenu(root, title);
  const b = [...(drop?.querySelectorAll<HTMLElement>(".menu-item") ?? [])].find(
    (e) => e.textContent === item,
  );
  if (!b) {
    throw new Error(`no ${title} > ${item}`);
  }
  b.click();
}
