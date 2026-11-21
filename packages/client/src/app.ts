/**
 * Client root: title → login or creation → game, on the classic layout scaled to fit the window. The
 * game loop ticks the model at the original 20 fps and draws every animation frame.
 */
import {
  artBagFull,
  BIO_TEXT,
  CHAT_COLOR,
  CHAT_SOCIAL_TEXT,
  type ClientMsg,
  type Dir,
  groundTipName,
  hidesName,
  houseType,
  inCastBounds,
  type KeyAction,
  localSyncPatch,
  logchatFile,
  mergePlayerPrefs,
  newsIsNew,
  PLAYFIELD_RECT,
  type PlayerPreferences,
  primaryKeyLabel,
  type RestoreTarget,
  type ServerMsg,
  TICK_MS,
} from "@secondstaronline/shared";

import { type Assets, loadAssets } from "./assets.ts";
import { createAudio, playAll } from "./audio.ts";
import {
  createInputState,
  type InputSink,
  keyDown,
  keyUp,
  matchOneShotAction,
  releaseAll,
  setLayout,
} from "./input.ts";
import {
  applyDelta,
  applySnapshot,
  applyYou,
  clientTick,
  createModel,
  type Intent,
  type Model,
  onDeath,
  onRespawnDrawn,
  pressAction,
} from "./model.ts";
import { type Connection, connect, connectRetrying } from "./net.ts";
import { createPlayfield, type Pick, PLAYFIELD_H, PLAYFIELD_W } from "./playfield.ts";
import {
  getStored,
  loadLocalPrefsState,
  loadWindowPos,
  PREF_STORAGE_KEYS,
  saveLocalPrefs,
  saveWindowPos,
  setStored,
} from "./prefs.ts";
import { type Sfx, SOUND } from "./sfx.ts";
import { action } from "./ui/action.ts";
import { showAlert } from "./ui/alert.ts";
import { createAmountDialog, crystalTitle, GOLD_TITLE, stackTitle } from "./ui/amount.ts";
import { createAwayWindow } from "./ui/away.ts";
import { createBars } from "./ui/bars.ts";
import { createBioWindow } from "./ui/bio.ts";
import { createBlackjack } from "./ui/blackjack.ts";
import { createBoardWindow } from "./ui/board.ts";
import { createCharMenu } from "./ui/charmenu.ts";
import { createChatInput, createChatLog } from "./ui/chat.ts";
import { createChatRoomWindow } from "./ui/chatroom.ts";
import { createCheckersWindow } from "./ui/checkers.ts";
import { createFriendsWindow } from "./ui/friends.ts";
import { desktopMenus, type MenuActions, type MenuState } from "./ui/gamemenu.ts";
import { createGuildCenter } from "./ui/guildcenter.ts";
import { createImWindows } from "./ui/im.ts";
import { createMailScreen } from "./ui/mail.ts";
import { createMenuBar, MENU_BAR_H } from "./ui/menubar.ts";
import { createNewspaper } from "./ui/newspaper.ts";
import { createNpcEditor, type NpcEditor } from "./ui/npceditor.ts";
import { createPaintUi } from "./ui/paint.ts";
import { createPanel, type Tab } from "./ui/panel.ts";
import { type Ghost, ghostTile, placementClick } from "./ui/placement.ts";
import { createPlayerSettingsWindow } from "./ui/player-settings.ts";
import { creationScreen, loginScreen, type Screen, titleScreen } from "./ui/screens.ts";
import { createSettingsWindow } from "./ui/settings.ts";
import { createGameView, type GameView } from "./ui/shells.ts";
import { createShopWindow } from "./ui/shop.ts";
import { createSignPanel } from "./ui/sign.ts";
import { createSlotMachine } from "./ui/slots.ts";
import { fitScale, wholeStage } from "./ui/stage.ts";
import { createTradeWindow } from "./ui/trade.ts";
import { createWhoWindow } from "./ui/who.ts";
import { createWindowLayer } from "./ui/window.ts";
import { createWorldEditor, type WorldEditor } from "./ui/worldeditor.ts";

const TAB_KEY_ACTION: Readonly<Record<Tab, KeyAction>> = {
  stats: "tabStats",
  inventory: "tabInventory",
  skills: "tabSkills",
  spellbook: "tabSpellbook",
};

export interface App {
  stop(): void;
}

export async function startApp(root: HTMLElement): Promise<App> {
  root.replaceChildren();
  const assets = await loadAssets();
  const conn = await connect();
  return runApp(root, assets, conn);
}

/** Closes any open casino UI when a snapshot moves the player to a different map. */
export function closeCasinoOnMapChange(
  prevMap: string | undefined,
  nextMap: string,
  ui: {
    slots: { show(open: boolean): void };
    blackjack: { close(): void };
    checkers: { reset(): void };
  },
): void {
  if (prevMap !== undefined && prevMap !== nextMap) {
    ui.slots.show(false);
    ui.blackjack.close();
    ui.checkers.reset();
  }
}

/**
 * The hover name for what the pointer is over (1.6's sprite 156; SSO shows it in the hover
 * tip). Another player in
 * a body armour containing "Invis" shows "???"; your own name always shows. Ground items have
 * no hover (their click script reacts to the mouse-up only), so they give null.
 */
export function hoverName(model: Model, hit: Pick): string | null {
  if (hit.kind === "player") {
    const peer = model.peers.get(hit.id);
    return peer && hidesName(peer.equip) ? "???" : hit.name;
  }
  if (hit.kind === "ground") {
    const item = model.ground.get(hit.id);
    return item ? groundTipName(item.name) : null;
  }
  return hit.name;
}

/**
 * The hover tip's lines for everything under the mouse (`Playfield.pickAll`): a monster's or
 * player's name alone, or the named ground items on the tile, newest first, so the first line is
 * what a click or Ctrl takes. Empty when none of it is named.
 */
export function hoverText(model: Model, hits: readonly Pick[]): string[] {
  return hits.map((h) => hoverName(model, h)).filter((t): t is string => !!t);
}

export function runApp(root: HTMLElement, assets: Assets, conn: Connection): App {
  const initialLocal = loadLocalPrefsState();
  let prefs: PlayerPreferences = initialLocal.prefs;
  let confirmedPrefs: PlayerPreferences = initialLocal.prefs;
  let localPendingSync = initialLocal.pendingSync;
  let inFlightPrefsId: number | null = null;
  let nextAutoPrefsReqId = 1_000_000;
  let ignores: string[] = [];
  let lowHpActive = false;
  let onlineFriends = new Set<string>();
  let friendsReady = false;
  let lastPresenceOn: string | null = null;
  let screen: Screen | null = null;
  let game: GameView | null = null;
  /** The kick alert still open: the game stays behind it until OK. */
  let kickAlert: Promise<void> | null = null;
  let lastName = "";
  let stopped = false;

  // ---- menus (In-game menu) ----------------------------------------------------------------
  // The classic layout draws 1.6's menu bar above the stage.
  /** Your role's permissions as the server last sent them (it still checks every request). */
  let permissions: ReadonlySet<string> = new Set();
  let editor: WorldEditor | null = null;
  let npcEditor: NpcEditor | null = null;
  /** Which editor is up; either opens from the other. */
  let editing: "world" | "npc" | null = null;

  /** The title screen is the screen showing (the menu bar hides Game there). */
  let atTitle = false;
  const menuState: MenuState = {
    inPlay: () => model.self !== null,
    atTitle: () => atTitle,
    can: (permission) => permissions.has(permission),
    shortcut: (act) => primaryKeyLabel(input.bindings, act),
  };
  const menuActions: MenuActions = {
    // Game > Return To Title Screen: in play it is today's Log out.
    returnToTitle: () => (menuState.inPlay() ? conn.send({ t: "logout" }) : toTitle()),
    clearChat: () => chat.clear(),
    // Open Friend's List only reopens the window, without refilling it.
    openFriends: () => friends.window.open(),
    openWho: () => send({ t: "whoOpen" }),
    sendIm: () => ims.openSend(""),
    enterRoom: (r) => send({ t: "roomEnter", room: r }),
    worldEditor: () => {
      if (editing !== "world") {
        conn.send({ t: "editOpen" });
      }
    },
    npcEditor: () => {
      if (editing !== "npc") {
        conn.send({ t: "npcEditOpen" });
      }
    },
    serverSettings: () => conn.send({ t: "settingsOpen" }),
    playerSettings: () => {
      releaseAll(input, sink);
      playerSettingsWin.open(prefs, ignores, menuState.inPlay());
    },
    editNewspaper: () => {
      news.openEditor();
      conn.send({ t: "newspaperLoad" });
    },
    returnToGame: () => {
      if (editing) {
        conn.send({ t: "editClose" });
      }
    },
    // Sent at once with no confirmation.
    assassin: (mode) => conn.send({ t: "assassinGame", mode }),
  };

  // ---- game parts, built once ---------------------------------------------------------------
  const model = createModel();
  // After the model: the bar reads whether a character is in play as it is built.
  const menuBar = createMenuBar(desktopMenus(menuState, menuActions));
  // The arrows' mask test reads each FX member's rect from the atlas (spellfx.ts).
  model.fxRect = (member) => {
    const r = assets.sprite("fx", member);
    return r ? [r[3], r[4], r[5], r[6]] : null;
  };
  const playfield = createPlayfield(assets);
  const chat = createChatLog();
  const chatInput = createChatInput();
  const windows = createWindowLayer({
    shouldRemember: () => prefs.rememberWindowPositions,
    load: loadWindowPos,
    save: saveWindowPos,
  });
  const ims = createImWindows(assets, windows, {
    send: (to, text, via) => send({ t: "im", to, text, via }),
    me: () => myName,
  });
  const who = createWhoWindow(assets, windows, {
    im: (name) => ims.openSend(name),
    profile: (name) => {
      send({ t: "bioRequest", name });
      chat.add(BIO_TEXT.loadingProfile, 0);
    },
  });
  const away = createAwayWindow(assets, windows, { away: (text) => send({ t: "away", text }) });
  // The Friends window: its lines come from the server.
  const friends = createFriendsWindow(assets, windows, {
    remove: (name) => send({ t: "friendRemove", name }),
    im: (name) => ims.openSend(name),
    away: () => away.open(),
  });
  const room = createChatRoomWindow(assets, windows, {
    say: (text) => send({ t: "roomSay", text }),
    leave: () => send({ t: "roomLeave" }),
    logchat: (file, text) => {
      saveTextFile(file, text);
      // 1.6's sub-movie call failed and printed nothing (an assumption: 1.6's files do not say);
      // SSO prints it.
      chat.add(CHAT_SOCIAL_TEXT.logging, 0);
    },
  });
  /** Your character's name (the IM reply echo). */
  let myName = "";
  const syncLowHp = () => {
    game?.root.classList.toggle("pf-low-hp", lowHpActive);
  };
  const bars = createBars(assets, (low) => {
    lowHpActive = low;
    syncLowHp();
  });
  const audio = createAudio(assets, prefs.sfxEnabled, undefined, undefined, undefined, () => {
    model.sounds.length = 0;
  });
  const sound = (s: Sfx) => audio.play(s);
  // Browsers start audio only from a gesture; pointerdown and keydown come before the click
  // or key that plays a sound, so the first one is heard (audio.ts).
  const onAudioUnlock = () => audio.unlock();
  window.addEventListener("pointerdown", onAudioUnlock, true);
  window.addEventListener("keydown", onAudioUnlock, true);
  const intent: Intent = { held: null, turn: false, pending: null };
  const input = createInputState(prefs.controlSet, prefs.keyBindings);
  let seq = 0;
  const send = (m: ClientMsg) => conn.send(m);
  const sink: InputSink = {
    move(held: Dir | null, turn: boolean) {
      intent.held = held;
      intent.turn = turn;
      if (game) {
        send({ t: "move", seq: ++seq, held, turn, scheduled: true });
      }
    },
    step(dir: Dir, turn: boolean) {
      if (!game) {
        return;
      }
      intent.pending = { dir, turn, age: 0 };
    },
    attack(held: boolean) {
      // Mirrors the server's `setAttackHeld`, so the key poll can predict the attack lock.
      if (held && !intent.attackHeld) {
        intent.attackPress = 0;
      }
      intent.attackHeld = held;
      if (game) {
        send({ t: "attack", seq: ++seq, held });
      }
    },
    action() {
      if (game) {
        pressAction(model);
        send({ t: "action" });
      }
    },
  };
  // The amount dialog's OK clicks on every press.
  const amount = createAmountDialog(assets, () => sound(SOUND.click));
  const panel = createPanel(assets, {
    use: (slot) => send({ t: "use", slot }),
    // The Use button exits silently while the compose pane is up.
    canUse: () => !mail.composeUp,
    equip: (slot) => send({ t: "equip", slot }),
    drop: (slot) => send({ t: "drop", slot }),
    give: (slot) => send({ t: "give", slot }),
    craft: (slot) => send({ t: "craft", slot }),
    storage: (slot) => send({ t: "storage", slot }),
    unequip: (slot) => send({ t: "unequip", slot }),
    crystals: (slot, colour, mode) =>
      amount.open(crystalTitle(colour, mode), null, (n) => send({ t: "crystals", slot, n, mode })),
    oneCrystal: (slot, mode) => send({ t: "crystals", slot, n: 1, mode }),
    gold: () => amount.open(GOLD_TITLE, "0", (n) => send({ t: "gold", n })),
    // Any other stack asks how many, starting at 1.
    stack: (slot, name, mode) =>
      amount.open(stackTitle(name, mode), "1", (n) => send({ t: mode, slot, n })),
    arrange: (from, to) => send({ t: "arrange", from, to }),
    sound,
    // An open vault or container holds the keys, but the bag still takes clicks so Drop can
    // store an item in it.
    canModify: () =>
      !model.loading && model.itemPause === 0 && (!model.keyLock || model.storageOpen),
    slotClicked: () => {
      shop.clearBusy();
      // A bag click cancels the lens; the Film is spent only by a saved photo.
      paintUi.cancelLens();
      // A bag click leaves placement.
      leavePlacement();
      return !model.keyLock || model.storageOpen;
    },
    say: (text) => chat.add(text, 0),
    tabShortcut: (tab) => primaryKeyLabel(input.bindings, TAB_KEY_ACTION[tab]),
  });

  // ---- NPC Bio, shop and vault, the player menu, trade ---------------------------------------
  const bio = createBioWindow(assets, windows, {
    list: (mode) => send({ t: "shopList", mode }),
    closed: (how) => {
      if (how) {
        // A player's bio: your own sends its box to be saved. The server
        // holds every key lock, so closing it frees nothing (1.6 cleared the key lock, N/A).
        if (how.profile !== null) {
          send({ t: "profileSave", text: how.profile });
        }
        return;
      }
      model.keyLock = false;
      send({ t: "npcClose" });
    },
  });
  const shop = createShopWindow(assets, {
    buy: (line, count) => send({ t: "buy", line, count }),
    sell: (line, count) => send({ t: "sell", line, count }),
    train: (line) => send({ t: "train", line }),
    take: (index) => {
      // The window stays open and the keys stay locked until CANCEL.
      send({ t: "vaultTake", index });
    },
    cancel: () => {
      model.keyLock = false;
      model.storageOpen = false;
      send({ t: "shopCancel" });
    },
    sound,
  });
  // The Guild Center (frame 72).
  // Leaving frame 72 plays 55, the first tab (the mail list's CLOSE does the same).
  const leaveFrame72 = () => {
    game?.setFrame72(false);
    panel.setTab("stats");
  };
  const closeGuild = () => {
    model.keyLock = false;
    leaveFrame72();
  };
  const guild = createGuildCenter(assets, {
    create: (name, alignment) => {
      // OK unlocks the keys at once.
      model.keyLock = false;
      send({ t: "guildCreate", name, alignment });
    },
    close: () => {
      closeGuild();
      send({ t: "guildClose" });
    },
    view: (name) => send({ t: "guildView", name }),
    act: (act, viewing, member) => {
      send(
        member === undefined
          ? { t: "guildAction", act, viewing }
          : { t: "guildAction", act, viewing, member },
      );
      if ((act === "leave" || act === "disband") && !guild.isOpen) {
        closeGuild();
      }
    },
    sound,
  });
  // The Slot Machine (frame 72's sprites 333-336). Close and a server close free the
  // keys and play the first tab; a map change closes the panel.
  const slots = createSlotMachine(assets, {
    pull: () => send({ t: "slotPull" }),
    close: () => send({ t: "slotClose" }),
    lock: (on) => {
      model.keyLock = on;
    },
    frame: (on) => {
      if (on) {
        game?.setFrame72(true);
      } else {
        leaveFrame72();
      }
    },
    sound,
  });
  // The Blackjack Table (frame 72's sprites 333 and 338-353). Leave frees the keys
  // and plays the first tab; a map change closes the seat.
  const blackjack = createBlackjack(assets, {
    bid: (text) => send({ t: "bjBid", text }),
    hit: () => send({ t: "bjHit" }),
    stand: () => send({ t: "bjStand" }),
    leave: () => send({ t: "bjLeave" }),
    lock: (on) => {
      model.keyLock = on;
    },
    frame: (on) => {
      if (on) {
        game?.setFrame72(true);
      } else {
        leaveFrame72();
      }
    },
    sound,
  });
  // The Checkers window (the `Checkers` sub-movie): closing it quits.
  const checkers = createCheckersWindow(assets, windows, {
    move: (piece, dh, dv) => send({ t: "ckMove", piece, dh, dv }),
    close: () => send({ t: "ckClose" }),
    lock: (on) => {
      model.keyLock = on;
    },
  });
  // Mail and message boards.
  const mail = createMailScreen(assets, {
    ui: (act) => send({ t: "mailUi", act }),
    send: (to, subject, body) => send({ t: "mailSend", to, subject, body }),
    del: (id) => send({ t: "mailDelete", id }),
    say: (text) => chat.add(text, 0),
    lock: (on) => {
      model.keyLock = on;
    },
    frame: (on) => {
      if (on) {
        game?.setFrame72(true);
      } else {
        leaveFrame72();
      }
    },
    sound,
  });
  const board = createBoardWindow(assets, {
    post: (text) => send({ t: "boardPost", text }),
    close: () => send({ t: "boardClose" }),
    lock: (on) => {
      model.keyLock = on;
    },
  });
  // Paintings, photos and the camera lens, and the newspaper windows.
  const paintUi = createPaintUi(assets, {
    cancel: () => send({ t: "paintUi", act: "cancel" }),
    viewClose: () => send({ t: "viewClose" }),
    save: (kind, png) => send({ t: "artSave", kind, png }),
    say: (text) => chat.add(text, 0),
    lock: (on) => {
      model.keyLock = on;
    },
    bagFull: () => artBagFull((model.inv?.bag ?? []).map((l) => l?.item ?? "")),
    redraw: () => playfield.draw(model),
    grab: (crop) => {
      const ctx = playfield.canvas.getContext("2d");
      return ctx ? ctx.getImageData(crop.x, crop.y, crop.w, crop.h).data : null;
    },
  });
  const news = createNewspaper(assets, windows, {
    save: (photos, texts) => {
      if (texts.length === 6) {
        send({
          t: "newspaperSave",
          photos,
          texts: texts as [string, string, string, string, string, string],
        });
      }
    },
    say: (text) => chat.add(text, 0),
  });
  const overlay = document.createElement("div");
  overlay.className = "pf-overlay";
  const charMenu = createCharMenu(assets, {
    trade: (id) => send({ t: "tradeOpen", id }),
    bio: (id) => {
      send({ t: "bioRequest", id });
      chat.add(BIO_TEXT.viewBio, 0);
    },
  });
  const sign = createSignPanel(assets);
  overlay.append(charMenu.el, sign.el, paintUi.lens);
  const signText = (n: number) => model.map?.signs[n - 1] ?? "";
  // The map header under the playfield (sprite 299).
  const header = document.createElement("div");
  header.className = "map-header";
  // House placement (ui/placement.ts).
  const leavePlacement = () => {
    if (model.ghost) {
      model.ghost = null;
      send({ t: "placeCancel" });
    }
  };
  const settingsWin = createSettingsWindow(windows, {
    save: (values) => send({ t: "settingsSave", values }),
    saveRole: (role, create) => send({ t: "roleSave", role, create }),
    deleteRole: (id) => send({ t: "roleDelete", id }),
    assignRole: (name, role) => send({ t: "roleAssign", name, role }),
    load: () => send({ t: "settingsOpen" }),
  });
  const applyPrefs = (next: PlayerPreferences) => {
    prefs = next;
    setLayout(input, sink, next.controlSet, next.keyBindings);
    audio.setSettings({
      enabled: next.sfxEnabled,
      masterVolume: next.masterVolume,
      combatVolume: next.combatVolume,
      spellsVolume: next.spellsVolume,
      worldVolume: next.worldVolume,
      backgroundAudio: next.backgroundAudio,
    });
    playfield.showDamageNumbers = next.showDamageNumbers;
    bars.setOptions({
      colorblind: next.colorblindBars,
      lowHealthWarning: next.lowHealthWarning,
    });
    chat.setTextSize(next.chatTextSize);
    chat.setTimestamps(next.chatTimestamps);
    panel.tips.setLarge(next.largerHoverTips);
    if (!next.rememberWindowPositions) {
      windows.resetPositions();
    }
    relayout();
  };
  const playerSettingsWin = createPlayerSettingsWindow(windows, {
    save: (patch, requestId) => {
      const next = mergePlayerPrefs(patch, prefs);
      applyPrefs(next);
      if (menuState.inPlay()) {
        inFlightPrefsId = requestId;
        send({ t: "prefsSave", prefs: patch, requestId });
      } else {
        confirmedPrefs = next;
        localPendingSync = true;
        saveLocalPrefs(next, true);
        playerSettingsWin.saveResult(
          true,
          "Saved on this browser. First-time accounts import these on login.",
          requestId,
        );
      }
    },
    ignoreAdd: (name) => send({ t: "ignoreAdd", name }),
    ignoreRemove: (name) => send({ t: "ignoreRemove", name }),
    onCaptureStart: () => releaseAll(input, sink),
  });
  const trade = createTradeWindow(assets, windows, {
    offer: (gold, items) => send({ t: "tradeOffer", gold, items }),
    accept: () => send({ t: "tradeAccept" }),
    cancel: () => send({ t: "tradeCancel" }),
  });
  /** A pointer position as playfield pixels (544×384), or null off the canvas. */
  const playfieldPoint = (e: MouseEvent): { x: number; y: number } | null => {
    const r = playfield.canvas.getBoundingClientRect();
    if (r.width === 0) {
      return null;
    }
    return {
      x: ((e.clientX - r.left) / r.width) * PLAYFIELD_W,
      y: ((e.clientY - r.top) / r.height) * PLAYFIELD_H,
    };
  };
  // A click lands on the top sprite: a monster or NPC (their click scripts), a ground item,
  // or a player (the player-click script, which opens the player menu).
  action(playfield.canvas, "playfield"); // its clicks: tests/playfield-clicks.test.ts
  /**
   * The movie `mouseDown` → the spell cast: with the cursor armed, a mouse-down on the playfield
   * (`inCastBounds`, as the server checks) casts there; 1.6 took any point at stage
   * `8 < H < 580`, `5 < V < 420`. The stage point comes from
   * the playfield's own box, whatever the frame is scaled to.
   */
  const stagePoint = (e: MouseEvent): { x: number; y: number } | null => {
    const r = playfield.canvas.getBoundingClientRect();
    if (r.width === 0) {
      return null;
    }
    const scale = r.width / PLAYFIELD_W;
    return {
      x: Math.round(PLAYFIELD_RECT.left + (e.clientX - r.left) / scale),
      y: Math.round(PLAYFIELD_RECT.top + (e.clientY - r.top) / scale),
    };
  };
  const castAt = (pt: { x: number; y: number }) => {
    if (!game || !panel.spellbook.armed || !inCastBounds(pt.x, pt.y)) {
      return false;
    }
    send({ t: "cast", spell: panel.spellbook.selected, x: pt.x, y: pt.y });
    return true;
  };
  // The whole stage, as Director sent every mouse-down without its own handler to the movie
  // script; floating windows and the menu bar are outside the stage. Any pointer casts on
  // pointer-down: a tap is a click.
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (!game) {
        return;
      }
      const t = e.target as Node;
      if (!game.root.contains(t) || windows.el.contains(t) || menuBar.el.contains(t)) {
        return;
      }
      const pt = stagePoint(e);
      if (pt) {
        castAt(pt);
      }
    },
    true,
  );
  playfield.canvas.addEventListener("click", (e) => {
    const pt = playfieldPoint(e);
    if (!game || !pt) {
      return;
    }
    // The armed cursor stops NPC, monster, item and player clicks.
    if (panel.spellbook.armed) {
      return;
    }
    const hit = playfield.pick(model, pt.x, pt.y);
    // With the lens up a click on the map, yourself, another player or a monster takes the picture
    // instead of its own action; a ground item still does its click.
    if (paintUi.lensUp && hit?.kind !== "ground") {
      paintUi.takePhoto(pt.x, pt.y);
      return;
    }
    charMenu.close();
    const place = placementClick(model.ghost, hit !== null, pt);
    if (place?.kind === "build") {
      send({ t: "placeHouse", slot: place.slot, x: place.x, y: place.y });
      return;
    }
    if (hit?.kind === "monster") {
      send({ t: "npcClick", slot: hit.slot });
    } else if (hit?.kind === "ground") {
      // A sign shows its text, from any distance and without a pickup.
      const name = (model.ground.get(hit.id)?.name ?? "").toLowerCase();
      const n = name === "sign 1" ? 1 : name === "sign 2" ? 2 : name === "sign 3" ? 3 : 0;
      if (n > 0) {
        sign.show(signText(n));
        return;
      }
      send({ t: "pickup", id: hit.id });
    } else if (hit?.kind === "player") {
      charMenu.open(hit.id, pt.x, pt.y);
    }
  });
  // The name of the monster, NPC, player or yourself under the mouse, in the hover tip (an SSO
  // change: 1.6 floated the bare name above the pointer, sprite 156), or else the ground items
  // there, one line each (1.6 named nothing on the ground). The mouse position is kept,
  // so someone walking out from under it loses the tip too.
  let hoverAt: { x: number; y: number } | null = null;
  let hoverClient = { x: 0, y: 0 };
  const playfieldTip = {};
  playfield.canvas.addEventListener("pointermove", (e) => {
    hoverAt = e.pointerType === "mouse" ? playfieldPoint(e) : null;
    hoverClient = { x: e.clientX, y: e.clientY };
    // The lens follows the mouse.
    const lp = playfieldPoint(e);
    if (paintUi.lensUp && lp) {
      paintUi.moveLens(lp.x, lp.y);
    }
    // The ghost follows the mouse over the playfield.
    if (model.ghost && hoverAt) {
      model.ghost.tile = ghostTile(hoverAt);
    }
  });
  playfield.canvas.addEventListener("pointerleave", (e) => {
    hoverAt = null;
    panel.tips.release(playfieldTip);
    // Leaving the playfield ends placement (`mouseLeave`).
    if (e.pointerType === "mouse") {
      leavePlacement();
    }
  });
  const updateHoverTip = () => {
    if (!hoverAt) {
      return;
    }
    // The player menu opens at the pointer; the tip would sit under its edge.
    if (charMenu.isOpen) {
      panel.tips.release(playfieldTip);
      return;
    }
    const text = hoverText(model, playfield.pickAll(model, hoverAt.x, hoverAt.y));
    panel.tips.showFor(playfieldTip, text, hoverClient.x, hoverClient.y);
  };
  // ---- screens -----------------------------------------------------------------------------
  const container = document.createElement("div");
  container.className = "app";
  container.dataset.shell = "desktop";
  root.append(container, windows.el);

  let screenStage: HTMLElement | null = null;
  /**
   * Lays the current screen out for the window. A resize only rescales; a rebuild (a new
   * screen) keeps the focused field.
   */
  const renderScreen = (rebuild = false) => {
    if (!screen) {
      return;
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!rebuild && screenStage) {
      const s = fitScale(w, h, prefs.gameSize === "sharp", MENU_BAR_H);
      menuBar.setScale(s);
      screenStage.style.transform = `scale(${s})`;
      const holder = screenStage.parentElement;
      if (holder) {
        holder.style.width = `${800 * s}px`;
        holder.style.height = `${600 * s}px`;
      }
      windows.setScale(s);
      return;
    }
    const focused = document.activeElement;
    screenStage = wholeStage(screen.items);
    const holder = document.createElement("div");
    holder.className = "stage-holder";
    holder.append(screenStage);
    const frame = document.createElement("div");
    frame.className = "desktop-frame";
    frame.append(menuBar.el, holder);
    container.replaceChildren(frame);
    renderScreen();
    if (focused instanceof HTMLElement && focused.isConnected) {
      focused.focus();
    }
  };
  /**
   * Blurs a focused field the next screen will remove. A password manager anchors its autofill
   * menu to the focused field and, when that field is detached without a blur, strands the menu
   * at the window's top-left.
   */
  const releaseFocus = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && container.contains(focused)) {
      focused.blur();
    }
  };
  const show = (s: Screen, title = false) => {
    releaseFocus();
    game = null;
    screen = s;
    atTitle = title;
    menuBar.refresh();
    renderScreen(true);
    s.onShow?.();
  };
  const toTitle = () =>
    show(titleScreen(assets, { load: () => toLogin(lastName), create: toCreate, sound }), true);
  const toLogin = (prefill = "") =>
    show(
      loginScreen(
        assets,
        {
          ok: (name, password) => {
            lastName = name;
            if (name && password) {
              send({ t: "login", name, password });
            }
          },
          cancel: toTitle,
          sound,
        },
        prefill,
      ),
    );
  const toCreate = () =>
    show(
      creationScreen(assets, {
        ok: (v) => {
          lastName = v.name;
          send({ t: "create", ...v });
        },
        cancel: toTitle,
        sound,
      }),
    );

  const enterGame = () => {
    releaseFocus();
    screen = null;
    // Game entry clears every mail flag and hides the board.
    mail.reset();
    board.reset();
    paintUi.reset();
    news.reset();
    const view = createGameView(assets, {
      playfield: playfield.canvas,
      chatLog: chat.el,
      chatInput,
      menuBar,
      bars: bars.el,
      panel: panel.el,
      menuLayer: panel.menuLayer,
      amount: amount.el,
      shop: shop.el,
      shopBusy: shop.busy,
      overlay,
      header,
      guild: guild.el,
      slots: slots.el,
      blackjack: blackjack.el,
      mail: mail.el,
      board: board.el,
      paint: paintUi.paint,
      viewer: paintUi.viewer,
    });
    game = view;
    syncLowHp();
    container.replaceChildren(view.root);
    relayout();
  };

  function relayout() {
    if (game) {
      game.fit(window.innerWidth, window.innerHeight, prefs.gameSize === "sharp");
      windows.setScale(game.scale);
    } else {
      renderScreen();
    }
  }

  // ---- server messages ---------------------------------------------------------------------
  // The menus follow whether a character is in play, which any message may change.
  let menusInPlay = false;
  const syncMenus = () => {
    if (menuState.inPlay() !== menusInPlay) {
      menusInPlay = menuState.inPlay();
      menuBar.refresh();
    }
  };
  conn.onMessage = (msg: ServerMsg) => {
    handleMessage(msg);
    syncMenus();
  };
  const handleMessage = (msg: ServerMsg) => {
    switch (msg.t) {
      case "welcome":
        chatInput.maxLength = msg.rules.chatMaxChars;
        room.setMaxChars(msg.rules.chatMaxChars);
        myName = msg.name;
        friendsReady = false;
        onlineFriends = new Set();
        lastPresenceOn = null;
        if (!game) {
          enterGame();
        }
        return;
      case "denied":
        void showAlert(root, msg.text);
        return;
      case "created":
        void showAlert(root, msg.text).then(toTitle);
        return;
      case "kicked":
        // 1.6 prints the kick line, shows the alert over the game and only then plays frame 1,
        // so the title waits for OK.
        kickAlert = showAlert(root, msg.text);
        return;
      case "snapshot": {
        const prevMap = model.map?.name;
        if (!game) {
          enterGame();
        }
        applySnapshot(model, msg);
        closeCasinoOnMapChange(prevMap, msg.map.name, { slots, blackjack, checkers });
        // A map change closes an open vault or container (the server closed it too).
        if (model.storageOpen) {
          shop.close();
          model.storageOpen = false;
        }
        // And an open message board or mailbox.
        board.reset();
        mail.reset();
        // Drawing the map's items clears the key lock.
        model.keyLock = false;
        void playfield.setMap(msg.map).then(() => {
          model.loading = false;
          onRespawnDrawn(model);
          send({ t: "mapReady" });
        });
        return;
      }
      case "death":
        onDeath(model);
        return;
      case "you":
        applyYou(model, msg.self);
        return;
      case "vitals":
        model.vitals = msg.vitals;
        bars.setVitals(msg.vitals);
        return;
      case "delta":
        applyDelta(model, msg.events);
        if (!audio.canPlay()) {
          model.sounds.length = 0;
        }
        return;
      case "inv":
        model.inv = msg.inv;
        panel.setInventory(msg.inv, model.self?.head ?? 1);
        shop.clearBusy(); // `inx` hides the PROCESSING box
        return;
      case "bio":
        model.keyLock = true;
        bio.show(msg);
        return;
      case "shop":
        model.storageOpen = false;
        shop.showList(msg.mode, msg.rows);
        return;
      case "processed":
        shop.processed(msg.ok === true);
        return;
      case "vault":
        if (msg.closed) {
          shop.close();
          model.storageOpen = false;
          model.keyLock = false;
          return;
        }
        if (msg.open) {
          model.keyLock = true; // opening the vault locks the keys
          model.storageOpen = true;
        }
        shop.showVault(msg.items);
        return;
      case "lock":
        // A craft's key lock: the bag ignores clicks while it holds.
        model.keyLock = msg.on;
        return;
      case "placing": {
        // A deed's Use starts placement with its house art member; a build ends it.
        if (!msg.house) {
          model.ghost = null;
          return;
        }
        const ghost: Ghost = { house: msg.house, slot: msg.slot, tile: null, img: null };
        model.ghost = ghost;
        const t = houseType(msg.house);
        if (t) {
          const img = new Image();
          img.onload = () => {
            ghost.img = img;
          };
          img.src = assets.ui("houses", t.ghost.member);
        }
        return;
      }
      case "trade":
        trade.show(msg.trade, model.inv);
        return;
      case "spellbook":
        model.spellbook = msg.spells;
        panel.spellbook.setSpells(msg.spells);
        return;
      case "sound":
        if (!audio.canPlay()) {
          return;
        }
        model.sounds.push(
          msg.volume === undefined
            ? { name: msg.name, ch: msg.ch }
            : { name: msg.name, ch: msg.ch, volume: msg.volume },
        );
        return;
      case "sheet":
        panel.setStats(msg.stats);
        panel.setSkills(msg.skills);
        return;
      case "permissions":
        // Sent at entry and whenever your role or its definition changes.
        permissions = new Set(msg.permissions);
        menuBar.refresh();
        if (!permissions.has("settings")) {
          settingsWin.window.close();
        }
        return;
      case "settings":
        settingsWin.show(msg.pages, msg.rows, { roles: msg.roles, staff: msg.staff });
        return;
      case "roleResult":
        settingsWin.roleResult(msg);
        return;
      case "settingsResult":
        settingsWin.result(msg);
        return;
      case "prefs":
        ignores = [...msg.ignores];
        if (msg.stored === false && localPendingSync && inFlightPrefsId === null) {
          // First login for an uninitialized account: import migrated legacy / pre-login edits.
          const importPatch = localSyncPatch(prefs);
          const merged = mergePlayerPrefs(importPatch, msg.prefs);
          confirmedPrefs = msg.prefs;
          applyPrefs(merged);
          const reqId = ++nextAutoPrefsReqId;
          inFlightPrefsId = reqId;
          send({ t: "prefsSave", prefs: importPatch, requestId: reqId });
          playerSettingsWin.sync(merged, ignores, true);
          return;
        }
        confirmedPrefs = msg.prefs;
        localPendingSync = false;
        saveLocalPrefs(msg.prefs, false);
        if (inFlightPrefsId === null) {
          applyPrefs(msg.prefs);
          playerSettingsWin.sync(msg.prefs, ignores, true);
        }
        return;
      case "prefsResult": {
        if (
          msg.requestId !== undefined &&
          inFlightPrefsId !== null &&
          msg.requestId !== inFlightPrefsId
        ) {
          return;
        }
        if (msg.requestId === undefined || msg.requestId === inFlightPrefsId) {
          inFlightPrefsId = null;
        }
        if (msg.ok) {
          const authoritative = msg.prefs ?? prefs;
          confirmedPrefs = authoritative;
          localPendingSync = false;
          saveLocalPrefs(authoritative, false);
          applyPrefs(authoritative);
          playerSettingsWin.sync(authoritative, ignores, true);
        } else {
          const fallback = msg.prefs ?? confirmedPrefs;
          confirmedPrefs = fallback;
          applyPrefs(fallback);
        }
        playerSettingsWin.saveResult(msg.ok, msg.text, msg.requestId, msg.prefs ?? confirmedPrefs);
        return;
      }
      case "ignores":
        ignores = [...msg.list];
        playerSettingsWin.setIgnores(ignores, msg.text, msg.ok);
        return;
      case "rules":
        chatInput.maxLength = msg.rules.chatMaxChars;
        room.setMaxChars(msg.rules.chatMaxChars);
        return;
      case "restore":
        restoreTo(msg.text, msg.restoreTo);
        return;
      case "editor":
        if (msg.editing) {
          if (!editor) {
            editor = createWorldEditor(assets, {
              load: (mx, my) => send({ t: "editLoad", mx, my }),
              save: (map) => send({ t: "editSave", map }),
            });
          }
          if (editing !== "world") {
            editing = "world";
            releaseAll(input, sink);
            sign.close();
            charMenu.close();
            show(editor.screen);
          }
          editor.show(msg.map, msg.exists);
        } else {
          // The snapshot that follows puts the game back (Return To Game → frame 49).
          editing = null;
        }
        return;
      case "npcEditor":
        if (!npcEditor) {
          npcEditor = createNpcEditor(assets, {
            load: (name) => send({ t: "npcLoad", name }),
            save: (name, text) => send({ t: "npcSave", name, text }),
          });
        }
        if (editing !== "npc") {
          editing = "npc";
          releaseAll(input, sink);
          sign.close();
          charMenu.close();
          show(npcEditor.screen);
        }
        return;
      case "npcScript":
        npcEditor?.showScript(msg.text);
        return;
      case "npcClosed":
        // An NPC editor save changed this NPC: its windows close, so the edit applies at once.
        shop.close();
        bio.window.close();
        model.keyLock = false;
        model.storageOpen = false;
        return;
      case "guild":
        if (msg.screen) {
          model.keyLock = true; // the Guild Center locks the keys
          game?.setFrame72(true);
          guild.show(msg.screen);
        } else if (guild.isOpen) {
          guild.show(null);
          closeGuild();
        }
        return;
      case "guildList":
        guild.setList(msg.names);
        return;
      case "slot":
        slots.show(msg.open);
        return;
      case "bj":
        if (msg.open) {
          blackjack.view(msg);
        } else {
          blackjack.close();
        }
        return;
      case "ck":
        if (msg.open) {
          checkers.view(msg);
        } else {
          checkers.reset();
        }
        return;
      case "slotSpin":
        slots.spin();
        return;
      case "slotResult":
        slots.result(msg.reels, msg.win);
        return;
      case "guildView":
        guild.view(msg);
        return;
      case "mail":
        // The mail load's reply: a box open locks the keys, a reload does not.
        if (msg.lock) {
          model.keyLock = true;
        }
        mail.show(msg.messages);
        return;
      case "mailSent":
        mail.sent();
        return;
      case "board":
        board.show(msg.board);
        return;
      // Paintings, photos and newspapers.
      case "paint":
        paintUi.openPaint(msg.reopen);
        return;
      case "lens":
        paintUi.showLens();
        return;
      case "artSaved":
        paintUi.saved();
        return;
      case "art":
        void paintUi.showArt(msg.author, msg.png);
        return;
      case "newspaper":
        news.read(msg.texts, msg.photos);
        return;
      case "newspaperEdit":
        news.fill(msg.photos, msg.texts);
        return;
      case "alert":
        void showAlert(root, msg.text);
        return;
      case "minute":
        model.minute = msg.minute;
        return;
      case "news":
        // The news is printed only when it differs from the last one this computer kept (the news
        // preference). Its key lock is undone by the map load that follows game entry, so it locks
        // nothing.
        if (newsIsNew(msg.text, getStored(PREF_STORAGE_KEYS.news))) {
          chat.add(msg.text, CHAT_COLOR.normal);
          setStored(PREF_STORAGE_KEYS.news, msg.text);
        }
        return;
      case "sign":
        sign.show(signText(msg.n));
        return;
      case "chat":
        if (editing === "world") {
          editor?.addChat(msg.text);
        }
        chat.add(msg.text, msg.color);
        // A refused line goes back in the input, as 1.6 left a refused broadcast typed.
        if (msg.restore !== undefined) {
          restoreTo(msg.restore, msg.restoreTo);
        }
        return;
      // IM, Away and chat rooms.
      case "im":
        if (msg.away) {
          away.log(msg.from, msg.text);
        } else {
          ims.receive(msg.from, msg.text);
          if (prefs.imChime) {
            audio.playChime("im");
          }
        }
        return;
      case "imEcho":
        ims.echo(msg.to, msg.text);
        return;
      case "room":
        room.enter(msg.title, msg.entering, msg.users);
        return;
      case "roomLine":
        room.line(msg.text);
        return;
      case "roomUser":
        room.user(msg.name, msg.on);
        return;
      case "who":
        who.show(msg.names);
        return;
      case "presence":
        // Remember who just logged on so a newly added Friends entry plays the logon chime.
        lastPresenceOn = msg.on ? msg.name.toLowerCase() : null;
        return;
      case "friends": {
        // Only Open Friend's List opens the window (1.6's frame 50 opened it at every game entry).
        const nextSet = new Set(msg.names.map((n) => n.toLowerCase()));
        if (
          friendsReady &&
          prefs.friendLogonSound &&
          lastPresenceOn &&
          nextSet.has(lastPresenceOn) &&
          !onlineFriends.has(lastPresenceOn)
        ) {
          audio.playChime("friendLogon");
        }
        lastPresenceOn = null;
        onlineFriends = nextSet;
        friendsReady = true;
        friends.setNames(msg.names);
        return;
      }
      case "playerBio":
        bio.showPlayer(msg);
        return;
    }
  };
  conn.onGone = (text, relogin = false) => {
    if (kickAlert) {
      const shown = kickAlert;
      kickAlert = null;
      void shown.then(() => conn.onGone(text, relogin));
      return;
    }
    game = null;
    editing = null;
    permissions = new Set();
    menuBar.refresh();
    sign.close();
    who.window.close();
    friends.window.close();
    friends.setNames([]);
    // The session's room and away state end with it; closing the IM windows frees their slots.
    ims.closeAll();
    mail.reset();
    board.reset();
    paintUi.reset();
    news.reset();
    away.window.close();
    room.window.close();
    chatInput.value = "";
    chatInput.blur();
    model.self = null;
    syncMenus();
    model.inv = null;
    model.ground.clear();
    amount.close();
    shop.close();
    charMenu.close();
    model.keyLock = false;
    model.storageOpen = false;
    hoverAt = null;
    panel.tips.hide();
    panel.spellbook.disarm();
    model.fx = [];
    trade.show(null, null);
    slots.show(false);
    blackjack.close();
    checkers.reset();
    bio.window.close();
    settingsWin.window.close();
    playerSettingsWin.window.close();
    inFlightPrefsId = null;
    bars.reset();
    ignores = [];
    friendsReady = false;
    onlineFriends = new Set();
    lastPresenceOn = null;
    model.peers.clear();
    model.map = null;
    if (text) {
      void showAlert(root, text);
    }
    // Start over with a fresh connection, waiting out a server restart.
    void connectRetrying(() => stopped).then((c) => {
      if (!c || stopped) {
        return;
      }
      conn.send = c.send;
      conn.close = c.close;
      c.onMessage = conn.onMessage;
      c.onGone = conn.onGone;
      // A refused resume (the session ran out while away) goes straight back to Load Character,
      // with the name filled in; every other ending goes to the title.
      if (relogin) {
        toLogin(lastName || myName);
      } else {
        toTitle();
      }
    });
  };

  // ---- chat input -------------------------------------------------------------------------
  // Enter opens the chat input; while it is open, keys type and arrows move the caret only.
  // Enter sends and closes it (an empty line just closes it); Escape closes it and keeps the
  // text.
  /** Puts a refused or kept line back where it was typed. */
  const restoreTo = (text: string, target?: RestoreTarget) => {
    if (!target) {
      if (chatInput.value === "") {
        chatInput.value = text;
      }
    } else if (target.kind === "room") {
      room.restore(text);
    } else if (target.kind === "im") {
      ims.restoreReply(target.to, text);
    } else {
      ims.restoreSend(target.to, text);
    }
  };
  const sendChat = () => {
    // A line of only spaces is sent, and the server drops it instead of saying `Bob says ""`.
    const text = chatInput.value.slice(0, chatInput.maxLength);
    // `/logchat <file>` saves the main chat as it stands, then says so.
    const file = logchatFile(text);
    if (file !== null) {
      saveTextFile(file, chat.text());
      chat.add(CHAT_SOCIAL_TEXT.logging, 0);
    } else if (text !== "") {
      send({ t: "chat", text });
    }
    chatInput.value = "";
    chatInput.blur();
  };
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    } else if (e.key === "Escape") {
      e.preventDefault();
      chatInput.blur();
    }
  });

  // ---- keyboard ----------------------------------------------------------------------------
  const typingIn = (t: EventTarget | null) =>
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement;
  const onTextFocus = (e: FocusEvent) => {
    if (game && typingIn(e.target)) {
      releaseAll(input, sink);
    }
  };
  const hasConfirmModal = () =>
    playerSettingsWin.isConfirmOpen() ||
    root.querySelector(".settings-confirm:not([hidden])") !== null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (!game || typingIn(e.target) || playerSettingsWin.isCapturing() || hasConfirmModal()) {
      return;
    }
    const oneShot = matchOneShotAction(input, e);
    if (oneShot === "chat") {
      e.preventDefault();
      chatInput.focus();
      return;
    }
    if (oneShot === "commandChat") {
      e.preventDefault(); // and no quick find in Firefox
      chatInput.focus();
      chatInput.value += "/";
      chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length);
      return;
    }
    if (
      oneShot === "tabStats" ||
      oneShot === "tabInventory" ||
      oneShot === "tabSkills" ||
      oneShot === "tabSpellbook"
    ) {
      e.preventDefault();
      if (!e.repeat && !model.keyLock) {
        const tab: Tab =
          oneShot === "tabStats"
            ? "stats"
            : oneShot === "tabInventory"
              ? "inventory"
              : oneShot === "tabSkills"
                ? "skills"
                : "spellbook";
        sound(SOUND.tab);
        panel.setTab(tab);
      }
      return;
    }
    if (oneShot === "windowFriends") {
      e.preventDefault();
      if (!e.repeat) {
        if (friends.window.isOpen) {
          friends.window.close();
        } else {
          friends.window.open();
        }
      }
      return;
    }
    if (oneShot === "windowWho") {
      e.preventDefault();
      if (!e.repeat) {
        if (who.window.isOpen) {
          who.window.close();
        } else {
          send({ t: "whoOpen" });
        }
      }
      return;
    }
    // Stop the page scrolling, a focused button's press and the Alt menu bar.
    if (keyDown(input, sink, e)) {
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (!game || typingIn(e.target) || playerSettingsWin.isCapturing() || hasConfirmModal()) {
      return;
    }
    if (keyUp(input, sink, e)) {
      e.preventDefault();
    }
  };
  // A game button clicked with the mouse does not keep focus, so Space or Enter cannot press it
  // again (as the menu bar already keeps it). The field being typed in still loses focus, as
  // the click would have taken it.
  const onButtonDown = (e: PointerEvent) => {
    const t = e.target;
    if (
      !game ||
      e.button !== 0 ||
      !(t instanceof Element) ||
      !root.contains(t) ||
      !t.closest("button") ||
      menuBar.el.contains(t)
    ) {
      return;
    }
    e.preventDefault();
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) {
      focused.blur();
    }
  };
  window.addEventListener("pointerdown", onButtonDown, true);
  const onBlur = () => releaseAll(input, sink);
  const onResize = () => relayout();
  window.addEventListener("focus", onTextFocus, true);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", onResize);

  // ---- loop: 20 ticks a second, drawn every frame ----------------------------------------------
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  const frame = (now: number) => {
    acc = Math.min(acc + (now - last), TICK_MS * 5);
    last = now;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      if (game) {
        clientTick(model, intent, (step) => {
          send({ t: "step", seq: ++seq, ...step });
          return seq;
        });
      }
    }
    if (game) {
      if (audio.canPlay()) {
        playAll(audio, model.sounds.splice(0));
      } else {
        model.sounds.length = 0;
      }
      const t = model.self?.timers;
      if (t) {
        bars.setPower(t.bar, t.barMember);
      }
      updateHoverTip();
      const title = model.map?.title ?? "";
      if (header.textContent !== title) {
        header.textContent = title;
      }
      playfield.draw(model);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  applyPrefs(prefs);
  toTitle();
  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", onAudioUnlock, true);
      window.removeEventListener("keydown", onAudioUnlock, true);
      window.removeEventListener("focus", onTextFocus, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onButtonDown, true);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      audio.dispose();
      menuBar.dispose();
      playerSettingsWin.dispose();
      conn.close();
    },
  };
}

/**
 * `/logchat`'s save (it becomes a browser download):
 * 1.6's `setPref` wrote a prefs file; the browser downloads one with that name.
 */
export function saveTextFile(name: string, text: string): void {
  if (typeof URL.createObjectURL !== "function") {
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
