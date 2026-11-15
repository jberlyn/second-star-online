/**
 * The screen after File > Quit Game. 1.6 quit the projector; a page can't close its own tab, so the
 * stage goes black and says so. A click anywhere returns to the title.
 */
import { action } from "./action.ts";
import type { Screen } from "./screens.ts";

export const QUIT_LINES = ["You can close this tab now.", "Click to return to the title screen."];

export function quitScreen(onBack: () => void): Screen {
  const black = document.createElement("div");
  black.className = "quit-black";
  const text = document.createElement("div");
  text.className = "quit-text";
  for (const line of QUIT_LINES) {
    const p = document.createElement("div");
    p.textContent = line;
    text.append(p);
  }
  const hit = action(document.createElement("button"), "quit-return-title");
  hit.type = "button";
  hit.className = "hit";
  hit.setAttribute("aria-label", "Return to the title screen");
  hit.addEventListener("click", onBack);
  return {
    items: [
      { el: black, x: 0, y: 0, w: 800, h: 600, z: 1, art: true },
      { el: text, x: 0, y: 280, w: 800, h: 40, z: 2 },
      { el: hit, x: 0, y: 0, w: 800, h: 600, z: 3 },
    ],
  };
}
