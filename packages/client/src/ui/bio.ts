/**
 * The Bio window, opened for an NPC by a click on it and for a player by a bio reply. Stage
 * 315×286, frame 1 (assets/original/sub/BioWindow/layout/frame-1.json):
 * - member 1, the purple frame, over the whole stage;
 * - Buy (member 2) at [14, 253, 65, 270] and Sell (member 3) at [66, 253, 117, 270], shown
 *   when the NPC has `SEL|` / `BUY|` lines;
 * - Train at [118, 253, 169, 270], SSO's own (1.6's sprite 208 is empty): drawn in
 *   CSS as Buy and Sell look (black, 1 px white border, white text), shown when the NPC has
 *   `TRN|` lines;
 * - the bio field at (22, 16) 271×43: the `BIO|` lines, white, size 10 (its font id 32773
 *   is not in the cast's font map; Arial is an assumption: 1.6's files do not say), with a
 *   text shadow;
 * - the profile field at (23, 138) 271×109: the `PRO|` lines, Arial 12 bold white, shadow;
 * - the medals (channel 7) and the editable profile (channel 6) are hidden for an NPC.
 * The window title is the NPC's name. Its buttons close it (`close(window)`); closing it any
 * way ends its key lock.
 *
 * A player's bio (sprites 4-7): the bio field holds the lines (its box type is `adjust`, so it
 * grows with them, an assumption: 1.6's files do not say), Buy and Sell are hidden, the medal
 * strip (channel 7, [17, 113, 241, 129]) shows, and the profile is the read-only profile field
 * or, in your own bio, an editable field at [22, 137] 271×102 (`limit`: SSO stops it at 500
 * characters). The strip is 14 slots of 16 px; each bio clears slots 1-10 to the empty medal
 * and draws its medals from slot 1, each 14×16 tile stretched into 16×15 at y 1, so slots
 * 11-14 keep the last bio's medals. Closing your own bio sends the profile field for saving
 * whether or not it was edited; a bio drawn over it before closing loses the edit.
 */
import { MEDAL_SLOT_WIDTH, medalStrip, PROFILE_MAX } from "@secondstaronline/shared";

import type { Assets } from "../assets.ts";
import { action } from "./action.ts";
import type { GameWindow, WindowLayer } from "./window.ts";

export const BIO_STAGE = { w: 315, h: 286 } as const;

/** A player's bio as the server drew it (`playerBio`). */
export interface PlayerBio {
  title: string;
  bio: string[];
  profile: string;
  medals: string[];
  own: boolean;
}

export interface BioWindow {
  window: GameWindow;
  show(v: {
    name: string;
    bio: string[];
    profile: string[];
    buy: boolean;
    sell: boolean;
    train: boolean;
  }): void;
  showPlayer(v: PlayerBio): void;
  /** The strip's member per slot, null where nothing was ever drawn. */
  readonly strip: readonly (number | null)[];
}

export interface BioActions {
  /** Buy, Sell or Train: asks for the list; the window then closes without `closed`. */
  list(mode: "buy" | "sell" | "train"): void;
  /**
   * The window closed (`on closeWindow`): `player` for a player's bio, with `profile` the box's
   * text when it was your own (sprite 6 shown).
   */
  closed(how?: { player: true; profile: string | null }): void;
}

export function createBioWindow(a: Assets, layer: WindowLayer, act: BioActions): BioWindow {
  const stage = document.createElement("div");
  stage.className = "bio-stage";
  const art = (member: number, cls: string) => {
    const img = document.createElement("img");
    img.className = `${cls} art`;
    img.src = a.ui("BioWindow", member);
    img.alt = "";
    img.draggable = false;
    return img;
  };
  const frame = art(1, "bio-frame");
  const bio = document.createElement("div");
  bio.className = "bio-text bio-bio";
  const profile = document.createElement("div");
  profile.className = "bio-text bio-profile";
  /**
   * Buy, Sell and Train close the window from a script, which does not run its `closeWindow`
   * (measured on the running 1.6): `closed` is not called, so the keys stay locked until the
   * list's CANCEL.
   */
  let scripted = false;
  const closeByScript = () => {
    scripted = true;
    win.close();
    scripted = false;
  };
  const button = (member: number, label: string, cls: string, mode: "buy" | "sell") => {
    // Buy and Sell are their members' own scripts.
    const b = action(document.createElement("button"), `bio-${mode}`);
    b.type = "button";
    b.className = `bio-btn ${cls}`;
    b.setAttribute("aria-label", label);
    b.append(art(member, "bio-btn-art"));
    b.addEventListener("click", () => {
      act.list(mode);
      closeByScript();
    });
    return b;
  };
  const buy = button(2, "Buy", "bio-buy", "buy");
  const sell = button(3, "Sell", "bio-sell", "sell");
  // SSO's own button: plain text on CSS, no art.
  const train = action(document.createElement("button"), "bio-train");
  train.type = "button";
  train.className = "bio-btn bio-train";
  train.setAttribute("aria-label", "Train");
  train.textContent = "Train";
  train.addEventListener("click", () => {
    act.list("train");
    closeByScript();
  });
  // Sprite 6, your own profile (`field:BioWindow:Internal:6`).
  const myProfile = action(document.createElement("textarea"), "bio-profile");
  myProfile.className = "bio-text bio-myprofile";
  myProfile.maxLength = PROFILE_MAX;
  myProfile.spellcheck = false;
  myProfile.setAttribute("aria-label", "Your profile");
  myProfile.hidden = true;
  // Sprite 7, the medal strip: 14 slots.
  const medals = document.createElement("div");
  medals.className = "bio-medals";
  medals.setAttribute("role", "img");
  medals.hidden = true;
  let strip: (number | null)[] = [];
  const drawStrip = () => {
    medals.replaceChildren(
      ...strip.map((member, i) => {
        const img = document.createElement("img");
        img.className = "bio-medal art";
        img.alt = "";
        img.draggable = false;
        img.style.left = `${i * MEDAL_SLOT_WIDTH}px`;
        if (member === null) {
          img.hidden = true;
        } else {
          img.src = a.ui("BioWindow", member);
        }
        return img;
      }),
    );
  };
  stage.append(frame, bio, profile, myProfile, medals, buy, sell, train);

  /** What is up: an NPC's bio, another player's, or your own (sprite 6). */
  let mode: "npc" | "player" | "own" = "npc";
  const win = layer.create({
    title: "BioWindow",
    name: "bio",
    width: BIO_STAGE.w,
    height: BIO_STAGE.h,
    body: stage,
    onClose: () => {
      if (scripted) {
        scripted = false;
        return;
      }
      if (mode === "npc") {
        act.closed();
      } else {
        act.closed({ player: true, profile: mode === "own" ? myProfile.value : null });
      }
    },
  });

  return {
    window: win,
    get strip() {
      return strip;
    },
    show(v) {
      mode = "npc";
      win.setTitle(v.name);
      bio.textContent = v.bio.join("\n");
      profile.textContent = v.profile.join("\n");
      profile.hidden = false;
      myProfile.hidden = true;
      medals.hidden = true;
      buy.hidden = !v.buy;
      sell.hidden = !v.sell;
      train.hidden = !v.train;
      win.open();
    },
    showPlayer(v) {
      mode = v.own ? "own" : "player";
      win.setTitle(v.title);
      bio.textContent = v.bio.join("\n");
      profile.textContent = v.profile;
      myProfile.value = v.profile;
      profile.hidden = v.own;
      myProfile.hidden = !v.own;
      buy.hidden = true;
      sell.hidden = true;
      train.hidden = true;
      strip = medalStrip(strip, v.medals);
      drawStrip();
      medals.hidden = false;
      medals.setAttribute("aria-label", `${v.medals.length} medals`);
      win.open();
    },
  };
}
