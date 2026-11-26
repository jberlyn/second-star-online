/**
 * Client root: title → login or creation → game, on the classic layout scaled to fit the window. The
 * game loop ticks the model at the original 20 fps and draws every animation frame.
 */
import {
  airshipWalkGrid,
  artBagFull,
  BIO_TEXT,
  CHAT_COLOR,
  CHAT_SOCIAL_TEXT,
  type ClientMsg,
  type ContentRowRef,
  type ContentStore,
  type Dir,
  footWalkGrid,
  groundTipName,
  hidesName,
  houseType,
  inCastBounds,
  installContent,
  type KeyAction,
  localSyncPatch,
  logchatFile,
  mergePlayerPrefs,
  monsterLabel,
  newsIsNew,
  PLAYFIELD_RECT,
  type PlayerPreferences,
  parseMapName,
  primaryKeyLabel,
  type RestoreTarget,
  type ServerMsg,
  TICK_MS,
  tileAt,
  tileName,
  withMonsterLevel,
} from "@secondstaronline/shared";

import { type Assets, loadAssets } from "./assets.ts";
import { createAudio, playAll } from "./audio.ts";
import { ContentFormatError, createContentSync, fetchContent } from "./content.ts";
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
import { createActivityLogPage } from "./ui/activity-log.ts";
import { showAlert } from "./ui/alert.ts";
import {
  type AmountDialog,
  createAmountDialog,
  crystalTitle,
  GOLD_TITLE,
  stackTitle,
} from "./ui/amount.ts";
import { createAwayWindow } from "./ui/away.ts";
import {
  createBalancePage,
  SPELL_BALANCE_GROUPS,
  VEHICLE_BALANCE_GROUPS,
} from "./ui/balance-page.ts";
import { createBars } from "./ui/bars.ts";
import { createBioWindow } from "./ui/bio.ts";
import { createBlackjack } from "./ui/blackjack.ts";
import { createBoardWindow } from "./ui/board.ts";
import { createCharactersPage } from "./ui/characters.ts";
import { createCharMenu } from "./ui/charmenu.ts";
import { createChatInput, createChatLog } from "./ui/chat.ts";
import { createChatRoomWindow } from "./ui/chatroom.ts";
import { createCheckersWindow } from "./ui/checkers.ts";
import { type AreaPage, type AreaTab, createAreaPage } from "./ui/content-area-page.ts";
import {
  CLASS_TABS,
  COMMUNITY_TABS,
  CRAFT_TABS,
  CREATURE_RULE_TABS,
  GAME_RULE_TABS,
  HOUSE_TABS,
  homeOf,
  ITEM_RULE_TABS,
  QUEST_TABS,
  SPELL_TABS,
} from "./ui/content-areas.ts";
import { createContentPage } from "./ui/content-page.ts";
import { createContentRequests } from "./ui/content-requests.ts";
import { contentWords } from "./ui/content-words.ts";
import { createControlPanel } from "./ui/control-panel.ts";
import { createFriendsWindow } from "./ui/friends.ts";
import { desktopMenus, type MenuActions, type MenuState } from "./ui/gamemenu.ts";
import { createGatheringPage } from "./ui/gathering-page.ts";
import { createGuildCenter } from "./ui/guildcenter.ts";
import { createImWindows } from "./ui/im.ts";
import { createItemsPage } from "./ui/items-page.ts";
import { createMailScreen } from "./ui/mail.ts";
import { createMenuBar, MENU_BAR_H } from "./ui/menubar.ts";
import { createMonstersPage } from "./ui/monsters-page.ts";
import { createNewspaper } from "./ui/newspaper.ts";
import { createNpcsPage } from "./ui/npcs-page.ts";
import { createPacksPage } from "./ui/packs-page.ts";
import { createPaintUi } from "./ui/paint.ts";
import { createPanel, type Tab } from "./ui/panel.ts";
import { type Ghost, ghostTile, placementClick } from "./ui/placement.ts";
import { createPlayerSettingsWindow } from "./ui/player-settings.ts";
import { creationScreen, loginScreen, type Screen, titleScreen } from "./ui/screens.ts";
import { createSettingsPanel } from "./ui/settings.ts";
import { createGameView, type GameView } from "./ui/shells.ts";
import { createShopWindow } from "./ui/shop.ts";
import { createSignPanel } from "./ui/sign.ts";
import { createSkillsPage } from "./ui/skills-page.ts";
import { createSlotMachine } from "./ui/slots.ts";
import { fitScale, wholeStage } from "./ui/stage.ts";
import { createTradeWindow } from "./ui/trade.ts";
import { createWhoWindow } from "./ui/who.ts";
import { createWindowLayer } from "./ui/window.ts";
import { createWorldPage } from "./ui/world-page.ts";

const TAB_KEY_ACTION: Readonly<Record<Tab, KeyAction>> = {
  stats: "tabStats",
  inventory: "tabInventory",
  skills: "tabSkills",
  spellbook: "tabSpellbook",
};

export interface App {
  stop(): void;
}

/**
 * The server's store, at start. A store in a format this client was not built for means a newer
 * client was deployed: reload once to get it (not again, if the reload did not help).
 */
async function startingContent(): Promise<ContentStore> {
  try {
    const store = await fetchContent();
    sessionStorageSafe("removeItem");
    return store;
  } catch (err) {
    if (err instanceof ContentFormatError && sessionStorageSafe("getItem") === null) {
      sessionStorageSafe("setItem");
      location.reload();
      return new Promise(() => {});
    }
    throw err;
  }
}

/** Remembers a format reload across it (with storage blocked it does not reload, so it cannot loop). */
function sessionStorageSafe(op: "getItem" | "setItem" | "removeItem"): string | null {
  try {
    const key = "sso-content-format-reload";
    if (op === "setItem") {
      sessionStorage.setItem(key, "1");
      return null;
    }
    if (op === "removeItem") {
      sessionStorage.removeItem(key);
      return null;
    }
    return sessionStorage.getItem(key);
  } catch {
    return op === "getItem" ? "blocked" : null;
  }
}

export async function startApp(root: HTMLElement): Promise<App> {
  root.replaceChildren();
  // The client bundles no content: it plays with the server's published store (content.ts).
  const [assets, store] = await Promise.all([loadAssets(), startingContent()]);
  installContent(store);
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
  // A monster or NPC whose species an operator renamed shows the name players know it by, with
  // its level when the world shows monster levels (issue #42).
  return withMonsterLevel(monsterLabel(hit.name), model.monsters.get(hit.slot)?.level);
}

/**
 * The hover tip's lines for everything under the mouse (`Playfield.pickAll`): a monster's or
 * player's name alone, or the named ground items on the tile, newest first, so the first line is
 * what a click or Ctrl takes. With none of those, the layer-2 tile at playfield pixel `at` gives
 * its name (`tileName`: a tree, a rock, a crop), so a log on a stump names the log. Empty when
 * nothing there is named.
 */
export function hoverText(
  model: Model,
  hits: readonly Pick[],
  at?: { x: number; y: number },
): string[] {
  const lines = hits.map((h) => hoverName(model, h)).filter((t): t is string => !!t);
  if (lines.length > 0 || !at || !model.map) {
    return lines;
  }
  const name = tileName(
    tileAt(model.map.layers[1], Math.floor(at.x / 32) + 1, Math.floor(at.y / 32) + 1),
  );
  return name ? [name] : [];
}

export function runApp(root: HTMLElement, assets: Assets, conn: Connection): App {
  const initialLocal = loadLocalPrefsState();
  let prefs: PlayerPreferences = initialLocal.prefs;
  let confirmedPrefs: PlayerPreferences = initialLocal.prefs;
  let localPendingSync = initialLocal.pendingSync;
  let inFlightPrefsId: number | null = null;
  let nextAutoPrefsReqId = 1_000_000;
  let ignores: string[] = [];
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
  /** Whether the Control Panel is up (the World and NPC editors are its pages, issues #32-#33). */
  let editing: "controlPanel" | null = null;

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
    // The World and NPC Editors are Control Panel pages (issues #32, #33), with no menu items of
    // their own. The World page opens on the map the admin stands on, as the World Editor did,
    // unless one is open already.
    controlPanel: () => {
      if (editing !== "controlPanel") {
        const at = parseMapName(model.map?.name ?? "");
        if (at) {
          worldPage.prefer(at.mx, at.my);
        }
        conn.send({ t: "controlPanelOpen" });
      }
    },
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
  const bars = createBars(assets);
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
  /**
   * Opens the amount dialog and takes down any tip already up: a dialog opened from the keyboard
   * leaves the pointer still, so the tip it was over would otherwise stay on top of the dialog.
   */
  const askAmount: AmountDialog["open"] = (title, seed, onOk) => {
    panel.tips.hide();
    amount.open(title, seed, onOk);
  };
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
      askAmount(crystalTitle(colour, mode), null, (n) => send({ t: "crystals", slot, n, mode })),
    oneCrystal: (slot, mode) => send({ t: "crystals", slot, n: 1, mode }),
    gold: () => askAmount(GOLD_TITLE, "0", (n) => send({ t: "gold", n })),
    // Any other stack asks how many, starting at 1.
    stack: (slot, name, mode) =>
      askAmount(stackTitle(name, mode), "1", (n) => send({ t: mode, slot, n })),
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
  // No tip over the amount dialog either: it sits mid-stage, where a pile's tip would cover it.
  const panelBlocked = panel.tips.blocked;
  panel.tips.blocked = () => panelBlocked() || !amount.el.hidden;

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
  // ---- the Control Panel and its pages ------------------------------------------------------
  const settingsPanel = createSettingsPanel({
    save: (values) => send({ t: "settingsSave", values }),
    saveRole: (role, create) => send({ t: "roleSave", role, create }),
    deleteRole: (id) => send({ t: "roleDelete", id }),
    assignRole: (name, role) => send({ t: "roleAssign", name, role }),
    load: () => send({ t: "settingsOpen" }),
  });
  const settingsPage = document.createElement("div");
  settingsPage.className = "control-panel-settings";
  settingsPage.append(settingsPanel.el);
  const activityPage = createActivityLogPage({
    query: (q) => send({ t: "activityQuery", ...q }),
    reconcile: (r) => send({ t: r.run ? "reconcileRun" : "reconcileQuery", seq: r.seq }),
  });
  const charactersPage = createCharactersPage({
    search: (seq, query) => send({ t: "characterSearch", seq, query }),
    open: (seq, name) => send({ t: "characterOpen", seq, name }),
    moderate: (req) => send({ t: "characterModerate", ...req }),
    edit: (req) => send({ t: "characterEdit", ...req }),
    undo: (req) => send({ t: "characterUndo", ...req }),
    housePreview: (req) => send({ t: "characterHousePreview", ...req }),
    houseRevoke: (req) => send({ t: "characterHouseRevoke", ...req }),
    houseTransfer: (req) => send({ t: "characterHouseTransfer", ...req }),
    openActivity: (name) => {
      controlPanel.go("activity");
      if (controlPanel.page === "activity") {
        activityPage.show("character", name);
      }
    },
    can: (permission) => permissions.has(permission),
  });
  const contentPage = createContentPage(
    {
      overview: (seq) => send({ t: "contentOverview", seq }),
      list: (seq, dataset, part) => send({ t: "contentList", seq, dataset, part }),
      row: (seq, ref) => send({ t: "contentRow", seq, ...ref }),
      draft: (seq, ref, op, data, expect) =>
        send({ t: "contentDraft", seq, ...ref, op, data, ...(expect ? { expect } : {}) }),
      discard: (seq, ref, expect) =>
        send({ t: "contentDiscard", seq, ...ref, ...(expect ? { expect } : {}) }),
      publish: (seq, summary, draftRev, logoutEveryone) =>
        send({
          t: "contentPublish",
          seq,
          summary,
          draftRev,
          ...(logoutEveryone ? { logoutEveryone } : {}),
        }),
      undo: (seq, id) => send({ t: "contentUndo", seq, id }),
      notice: (seq, ref, accept) => send({ t: "contentNotice", seq, ...ref, accept }),
      usage: (seq, kind, key) => send({ t: "contentUsage", seq, kind, key }),
      remove: (seq, plan) => send({ t: "contentRemove", seq, ...plan }),
      problems: (seq) => send({ t: "contentProblems", seq }),
      uploadTicket: (seq) => send({ t: "contentUploadTicket", seq }),
      itemArt: (seq) => send({ t: "contentItemArt", seq }),
      picture: (seq, change) => send({ t: "contentPicture", seq, change }),
      wornArt: (seq) => send({ t: "contentWornArt", seq }),
      wornSheet: (seq, sheet) => send({ t: "contentWornSheet", seq, sheet }),
      worn: (seq, change) => send({ t: "contentWorn", seq, change }),
      bodyArt: (seq) => send({ t: "contentBodyArt", seq }),
      bodySheet: (seq, sheet) => send({ t: "contentBodySheet", seq, sheet }),
      body: (seq, change) => send({ t: "contentBody", seq, change }),
      fxArt: (seq) => send({ t: "contentFxArt", seq }),
      fxSheet: (seq, sheet, layout) => send({ t: "contentFxSheet", seq, sheet, ...layout }),
      fx: (seq, change) => send({ t: "contentFx", seq, change }),
      tileArt: (seq) => send({ t: "contentTileArt", seq }),
      tileSheet: (seq, sheet, transparency) =>
        send({ t: "contentTileSheet", seq, sheet, transparency }),
      tile: (seq, change) => send({ t: "contentTile", seq, change }),
      soundArt: (seq) => send({ t: "contentSoundArt", seq }),
      sound: (seq, change) => send({ t: "contentSound", seq, change }),
      openCharacter: (name) => {
        controlPanel.go("characters");
        if (controlPanel.page === "characters") {
          charactersPage.openHub(name);
        }
      },
      // A change opens on the page that edits it, when the role may use it.
      openEditor: (ref) => openContentRow(ref),
    },
    assets,
  );
  const balancePage = createBalancePage(
    {
      view: (seq) => send({ t: "contentBalance", seq }),
      set: (seq, change) => send({ t: "contentBalanceSet", seq, ...change }),
      openContent: () => controlPanel.go("content"),
      openContentRow: (row) => openContentRow(row),
    },
    { except: [...SPELL_BALANCE_GROUPS, ...VEHICLE_BALANCE_GROUPS] },
  );
  const itemsPage = createItemsPage({
    view: (seq, name) => send({ t: "contentItems", seq, ...(name !== undefined ? { name } : {}) }),
    set: (seq, change) => send({ t: "contentItemSet", seq, ...change }),
    openContent: () => controlPanel.go("content"),
    openContentRow: (row) => controlPanel.go("content", () => contentPage.openRow(row)),
    panels: (saved) => contentPage.itemPanels(saved),
  });
  const monstersPage = createMonstersPage({
    view: (seq, name) =>
      send({ t: "contentMonsters", seq, ...(name !== undefined ? { name } : {}) }),
    set: (seq, change) => send({ t: "contentMonsterSet", seq, ...change }),
    spells: (seq, spells, expect) => send({ t: "contentMonsterSpells", seq, spells, expect }),
    npcFile: (seq, name) => send({ t: "contentNpcFile", seq, name }),
    npcFileSet: (seq, name, expect, sections) =>
      send({ t: "contentNpcFileSet", seq, name, expect, sections }),
    openContent: () => controlPanel.go("content"),
    openContentRow: (row) => controlPanel.go("content", () => contentPage.openRow(row)),
    body: (saved) => contentPage.monsterBody(saved),
    openNpc: (name) => openNpc(name),
  });
  // The Skills and Gathering pages (issue #38).
  const skillsPage = createSkillsPage({
    view: (seq, key) => send({ t: "contentSkills", seq, ...(key !== undefined ? { key } : {}) }),
    set: (seq, change) =>
      send({
        t: "contentSkillSet",
        seq,
        key: change.key,
        op: change.op,
        ...(change.data !== undefined ? { data: change.data } : {}),
        ...(change.expect !== undefined ? { expect: change.expect } : {}),
      }),
    usage: (seq, key) => send({ t: "contentSkillUsage", seq, key }),
    remove: (seq, key, refs, expect) => send({ t: "contentSkillRemove", seq, key, refs, expect }),
    openContent: () => controlPanel.go("content"),
    openContentRow: (row) => {
      openContentRow(row);
    },
    openItem: (name) =>
      controlPanel.go("items", () => {
        itemsArea.showTab("Items");
        itemsPage.open(name);
      }),
    openGathering: (node) =>
      controlPanel.go("gathering", () => {
        gatheringArea.showTab("Gathering");
        gatheringPage.open(node);
      }),
  });
  const gatheringPage = createGatheringPage(
    {
      view: (seq) => send({ t: "contentGathering", seq }),
      set: (seq, change) => send({ t: "contentGatheringSet", seq, ...change }),
      openContent: () => controlPanel.go("content"),
      openSkill: (key) =>
        controlPanel.go("skills", () => {
          skillsArea.showTab("Skills");
          skillsPage.open(key);
        }),
    },
    assets,
  );
  // The Packs page (issue #34): export and import, files over HTTP with an upload ticket.
  const packsPage = createPacksPage({
    view: (seq) => send({ t: "contentPacks", seq }),
    apply: (seq, importId, mode) => send({ t: "contentPackApply", seq, importId, mode }),
    remove: (seq, id) => send({ t: "contentPackRemove", seq, id }),
    ticket: (seq) => send({ t: "contentUploadTicket", seq }),
  });
  const npcsPage = createNpcsPage({
    view: (seq, name) => send({ t: "contentNpcs", seq, ...(name !== undefined ? { name } : {}) }),
    save: (seq, name, text, expect) => send({ t: "contentNpcSave", seq, name, text, expect }),
    openMonster: (name) =>
      controlPanel.go("monsters", () => {
        monstersArea.showTab("Creatures");
        monstersPage.open(name);
      }),
  });
  const worldPage = createWorldPage(
    {
      view: (seq, at, list) =>
        send({
          t: "contentMaps",
          seq,
          ...(at ? { mx: at.mx, my: at.my } : {}),
          ...(list ? { list: true } : {}),
        }),
      save: (seq, map, expect) => send({ t: "contentMapSave", seq, map, expect }),
      restore: (seq, mx, my, version, expect) =>
        send({ t: "contentMapRestore", seq, mx, my, version, expect }),
    },
    assets,
  );
  // ---- the content editor pages built from forms (content-areas.ts): every part of the content
  // has one page, and each existing editor is that page's first tab.
  const contentRequests = createContentRequests(send);
  const areaDeps = {
    requests: contentRequests,
    words: contentWords,
    openContent: () => controlPanel.go("content"),
  };
  /** An existing editor page as the first tab of its area. */
  const pageTab = (
    label: string,
    help: string,
    page: { el: HTMLElement; onShow(): void; changes(): number; discard(): void },
  ): AreaTab => ({
    kind: "custom",
    label,
    help,
    el: page.el,
    onShow: () => page.onShow(),
    changes: () => page.changes(),
    discard: () => page.discard(),
  });
  // The Balance page's cards, split by where each belongs.
  const spellNumbers = createBalancePage(
    {
      view: (seq) => send({ t: "contentBalance", seq }),
      set: (seq, change) => send({ t: "contentBalanceSet", seq, ...change }),
      openContent: () => controlPanel.go("content"),
      openContentRow: (row) => openContentRow(row),
    },
    { only: SPELL_BALANCE_GROUPS, embedded: true, seqBase: 100_000_000 },
  );
  const vehicleNumbers = createBalancePage(
    {
      view: (seq) => send({ t: "contentBalance", seq }),
      set: (seq, change) => send({ t: "contentBalanceSet", seq, ...change }),
      openContent: () => controlPanel.go("content"),
      openContentRow: (row) => openContentRow(row),
    },
    { only: VEHICLE_BALANCE_GROUPS, embedded: true, seqBase: 200_000_000 },
  );
  const itemsArea = createAreaPage(
    {
      id: "items-area",
      title: "Items",
      intro:
        "Every item in the game, and the rules all items share. Pick an item to change it, or make a new one.",
      tabs: [
        pageTab("Items", "Each item: what it is, how it looks and what it does.", itemsPage),
        ...ITEM_RULE_TABS,
      ],
    },
    areaDeps,
  );
  const monstersArea = createAreaPage(
    {
      id: "monsters-area",
      title: "Creatures & NPCs",
      intro:
        "Every monster, animal and NPC: their stats, pictures, behaviour, rewards, loot and spells, and the rules all creatures share.",
      tabs: [
        pageTab(
          "Creatures",
          "Each creature: its stats, picture, behaviour, rewards, and the loot and spells it has.",
          monstersPage,
        ),
        pageTab(
          "Talk & Shops",
          "What each NPC says, sells and buys, and whether it runs a bank or trains players. These save straight away for everyone: there is nothing to publish.",
          npcsPage,
        ),
        ...CREATURE_RULE_TABS,
      ],
    },
    areaDeps,
  );
  const spellsArea = createAreaPage(
    {
      id: "spells-area",
      title: "Spells",
      intro:
        "Every spell, what each spell effect deals or heals, how long buffs last and how strong a cast is.",
      tabs: SPELL_TABS(
        pageTab(
          "Damage and buffs",
          "What each spell effect deals or heals, and how long buffs last. A spell effect is shared: a spell, a staff's free fireball, a creature's cast and a map hazard running it all use these numbers, unless a spell sets its own.",
          spellNumbers,
        ),
        () => contentPage.spellEffect(() => spellsArea.published()),
      ),
    },
    areaDeps,
  );
  const skillsArea = createAreaPage(
    {
      id: "skills-area",
      title: "Skills & Classes",
      intro: "Every skill and how it rises, the classes, and how a new character starts out.",
      tabs: [pageTab("Skills", "Each skill and how it rises.", skillsPage), ...CLASS_TABS],
    },
    areaDeps,
  );
  const gatheringArea = createAreaPage(
    {
      id: "gathering-area",
      title: "Gathering & Crafting",
      intro: "Chopping, mining, fishing and farming, and what the crafting stations make.",
      tabs: [
        pageTab(
          "Gathering",
          "Where players gather, with what tools and what they find.",
          gatheringPage,
        ),
        ...CRAFT_TABS,
      ],
    },
    areaDeps,
  );
  const housesArea = createAreaPage(
    {
      id: "houses-area",
      title: "Houses & Vehicles",
      intro: "The houses players build, their doors, keys and chests, and the vehicles they sail.",
      tabs: HOUSE_TABS(
        pageTab(
          "Hull and cannon",
          "How much a hit takes off a vehicle's hull, how fast a parked one mends, and the cannon.",
          vehicleNumbers,
        ),
        (name) =>
          controlPanel.go("content", () =>
            contentPage.openRow({ dataset: "houses", part: "vehicles", key: name }),
          ),
      ),
    },
    areaDeps,
  );
  const questsArea = createAreaPage(
    {
      id: "quests-area",
      title: "Quests",
      intro: "The quests NPCs give players, and what they reward.",
      tabs: QUEST_TABS,
    },
    areaDeps,
  );
  const communityArea = createAreaPage(
    {
      id: "community-area",
      title: "Community",
      intro:
        "Factions, guilds, chat, mail, the message boards, the newspaper, the casino and the help players read.",
      tabs: COMMUNITY_TABS,
    },
    areaDeps,
  );
  const rulesArea = createAreaPage(
    {
      id: "rules-area",
      title: "Game Rules",
      intro:
        "The rules for the whole game rather than for one item or creature: hunger and death, levels and experience, timings, combat, how monsters move and spawn, money and tiles.",
      tabs: [
        pageTab(
          "Numbers",
          "Hunger, death, drops, levels and experience, timings, combat and monsters. Pick a tab, or search.",
          balancePage,
        ),
        ...GAME_RULE_TABS,
      ],
    },
    areaDeps,
  );
  const areaPages: Record<string, AreaPage> = {
    items: itemsArea,
    monsters: monstersArea,
    spells: spellsArea,
    skills: skillsArea,
    gathering: gatheringArea,
    houses: housesArea,
    quests: questsArea,
    community: communityArea,
    balance: rulesArea,
  };
  /**
   * Opens a row on the page that edits it (a link from another page or from a change on the
   * Content page): false when no page does or the role may not open it.
   */
  /** An NPC's file: the Talk & Shops tab of Creatures & NPCs. */
  const openNpc = (name: string) => {
    controlPanel.go("monsters", () => {
      monstersArea.showTab("Talk & Shops");
      npcsPage.open(name);
    });
  };
  const openContentRow = (row: ContentRowRef): boolean => {
    const home = homeOf(row.dataset, row.part);
    if (!home) {
      return false;
    }
    if (!permissions.has("contentEditor")) {
      return false;
    }
    const key = row.key;
    if (home === "pictures") {
      controlPanel.go("pictures");
      return true;
    }
    controlPanel.go(home, () => {
      if (home === "items" && row.dataset === "items" && key !== null) {
        itemsArea.showTab("Items");
        itemsPage.open(key);
      } else if (home === "monsters" && row.dataset === "npcFiles") {
        monstersArea.showTab("Talk & Shops");
        if (key !== null) {
          npcsPage.open(key);
        }
      } else if (home === "monsters" && row.dataset === "monsters" && row.part !== "casting") {
        monstersArea.showTab("Creatures");
        if (key !== null) {
          monstersPage.open(key);
        }
      } else if (
        home === "skills" &&
        row.dataset === "classes" &&
        (row.part === "skills" || row.part === "skillOrder")
      ) {
        skillsArea.showTab("Skills");
        if (key !== null && row.part === "skills") {
          skillsPage.open(key);
        }
      } else if (home === "gathering" && row.dataset === "gather") {
        gatheringArea.showTab("Gathering");
      } else {
        areaPages[home]?.open(row.dataset, row.part, key);
      }
    });
    return true;
  };

  const controlPanel = createControlPanel({
    pages: [
      {
        id: "settings",
        title: "Server Settings",
        group: "Server",
        permission: "settings",
        el: settingsPage,
        onShow: () => send({ t: "settingsOpen" }),
        changes: () => settingsPanel.changes(),
        discard: () => settingsPanel.discard(),
      },
      {
        id: "characters",
        title: "Characters",
        group: "Players",
        permission: "characterView",
        el: charactersPage.el,
        onShow: () => charactersPage.onShow(),
      },
      {
        id: "activity",
        title: "Activity Log",
        group: "Players",
        permission: "activityLog",
        el: activityPage.el,
        onShow: () => activityPage.onShow(),
      },
      ...(
        [
          ["items", "Items", itemsArea],
          ["monsters", "Creatures & NPCs", monstersArea],
          ["spells", "Spells", spellsArea],
          ["skills", "Skills & Classes", skillsArea],
          ["gathering", "Gathering & Crafting", gatheringArea],
          ["houses", "Houses & Vehicles", housesArea],
          ["quests", "Quests", questsArea],
          ["community", "Community", communityArea],
          ["balance", "Game Rules", rulesArea],
        ] as const
      ).map(([id, title, area]) => ({
        id,
        title,
        group: "Content",
        permission: "contentEditor" as const,
        el: area.el,
        onShow: () => area.onShow(),
        changes: () => area.changes(),
        discard: () => area.discard(),
      })),
      {
        id: "pictures",
        title: "Pictures & Sounds",
        group: "Content",
        permission: "contentEditor",
        el: contentPage.artEl,
        onShow: () => contentPage.onShow(),
        onHide: () => contentPage.onHide(),
        changes: () => contentPage.changes(),
        discard: () => contentPage.discard(),
      },
      {
        id: "content",
        title: "Publish Changes",
        group: "Publishing",
        permission: "contentEditor",
        el: contentPage.el,
        onShow: () => contentPage.onShow(),
        onHide: () => contentPage.onHide(),
        changes: () => contentPage.changes(),
        discard: () => contentPage.discard(),
      },
      {
        id: "packs",
        title: "Packs",
        group: "Publishing",
        permission: "contentEditor",
        el: packsPage.el,
        onShow: () => packsPage.onShow(),
        changes: () => 0,
        discard: () => {},
      },
      {
        id: "world",
        title: "World",
        group: "Content",
        permission: "contentEditor",
        el: worldPage.el,
        onShow: () => worldPage.onShow(),
        changes: () => worldPage.changes(),
        discard: () => worldPage.discard(),
      },
    ],
    // The classic editors are its World and NPCs pages now (issues #32, #33).
    links: [],
    actions: {
      returnToGame: menuActions.returnToGame,
      returnToTitle: menuActions.returnToTitle,
      openFriends: menuActions.openFriends,
      openWho: menuActions.openWho,
      sendIm: menuActions.sendIm,
      enterRoom: menuActions.enterRoom,
      playerSettings: menuActions.playerSettings,
    },
    can: (permission) => permissions.has(permission),
  });
  /** Out of an editor or the Control Panel: open questions close and unsaved drafts go. */
  const leaveEditing = () => {
    if (editing === "controlPanel") {
      controlPanel.close();
      settingsPanel.discard();
    }
    editing = null;
  };
  /** Puts the Control Panel in the game's place; the floating windows go to their own size over it. */
  const showControlPanel = () => {
    releaseFocus();
    game = null;
    screen = null;
    screenStage = null;
    atTitle = false;
    menuBar.refresh();
    container.replaceChildren(controlPanel.el);
    windows.setScale(1);
    controlPanel.open();
  };
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
    bars.setOptions({ colorblind: next.colorblindBars });
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
  // there, one line each, or else a named tile such as a tree (1.6 named nothing on the ground).
  // The mouse position is kept,
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
    const text = hoverText(model, playfield.pickAll(model, hoverAt.x, hoverAt.y), hoverAt);
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
    container.replaceChildren(view.root);
    relayout();
  };

  function relayout() {
    if (editing === "controlPanel") {
      windows.setScale(1);
    } else if (game) {
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
  // Every message goes through the content sync: a login or publish naming another store fetches
  // it first, and the messages after it wait.
  const contentSync = createContentSync({
    // An operator published art (issue #29): load what changed before the messages that follow.
    assets: (hash) => assets.reload().then(() => void hash),
    assetsHash: () => assets.hash,
    handle: (msg) => {
      handleMessage(msg);
      syncMenus();
    },
    // A new store is live: walkability follows the tile tables. The server sends the inventory
    // and the ground items again after it.
    installed: () => {
      if (model.map) {
        model.walk = footWalkGrid(model.map.layers[0], model.map.layers[1]);
        model.walkAir = airshipWalkGrid(model.map.layers[1]);
      }
    },
    // Every publish, undo and accepted pack notice, a balance-only one too (its store's hash stays
    // as it was): the Content and Balance pages ask again.
    published: () => {
      contentPage.published();
      balancePage.published();
      spellNumbers.published();
      vehicleNumbers.published();
      for (const area of Object.values(areaPages)) {
        area.published();
      }
      itemsPage.published();
      monstersPage.published();
      skillsPage.published();
      gatheringPage.published();
      worldPage.published();
    },
  });
  // Art published (issue #29): the map's tile layers are drawn once per map, so new tiles redraw
  // them, and the Content page shows the publish (an art-only one leaves the store's hash as it was).
  assets.onReload((changed) => {
    if (changed.includes("tiles") && model.map) {
      void playfield.setMap(model.map);
    }
    // Pictures already painted in the panel are redrawn from the new sheets.
    if (changed.includes("items")) {
      panel.refreshArt();
    }
    // The World page's palette and map are drawn from the sheets too.
    worldPage.published();
    contentPage.published();
    balancePage.published();
    itemsPage.published();
    monstersPage.published();
    skillsPage.published();
    gatheringPage.published();
  });
  conn.onMessage = (msg: ServerMsg) => contentSync.receive(msg);
  const handleMessage = (msg: ServerMsg) => {
    switch (msg.t) {
      case "welcome":
        chatInput.maxLength = msg.rules.chatMaxChars;
        room.setMaxChars(msg.rules.chatMaxChars);
        myName = msg.name;
        friendsReady = false;
        onlineFriends = new Set();
        lastPresenceOn = null;
        // A resumed session is back on the map: the server does not keep an editor or the Control
        // Panel open across a dropped connection, so neither does the client.
        if (editing) {
          leaveEditing();
        }
        // An answer to a World page save sent before the drop may never come.
        worldPage.connectionLost();
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
        panel.setLevel(msg.vitals.level);
        panel.setHunger(msg.vitals.hunger);
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
        panel.setSkills(msg.skills, msg.xp);
        return;
      case "permissions":
        // Sent at entry and whenever your role or its definition changes.
        permissions = new Set(msg.permissions);
        menuBar.refresh();
        controlPanel.refresh();
        // Without the permission, nothing the log showed stays on the page.
        if (!permissions.has("activityLog")) {
          activityPage.reset();
        }
        if (!permissions.has("contentEditor")) {
          npcsPage.reset();
          worldPage.reset();
          packsPage.reset();
          contentPage.reset();
          balancePage.reset();
          spellNumbers.reset();
          vehicleNumbers.reset();
          for (const area of Object.values(areaPages)) {
            area.reset();
          }
          itemsPage.reset();
          monstersPage.reset();
          skillsPage.reset();
          gatheringPage.reset();
        }
        if (permissions.has("characterView")) {
          charactersPage.permissionsChanged();
        } else {
          charactersPage.reset();
        }
        return;
      case "settings":
        settingsPanel.show(msg.pages, msg.rows, { roles: msg.roles, staff: msg.staff });
        return;
      case "roleResult":
        settingsPanel.roleResult(msg);
        return;
      case "activity":
        activityPage.receive(msg);
        return;
      case "reconcile":
        activityPage.receiveReconcile(msg);
        return;
      case "contentList":
      case "contentRow":
      case "contentResult":
        // An area page's request, else the Content page's.
        if (!contentRequests.receive(msg)) {
          contentPage.receive(msg);
        }
        return;
      case "contentOverview":
      case "contentUsage":
      case "contentProblems":
      case "contentItemArt":
      case "contentWornArt":
      case "contentWornSheet":
      case "contentBodyArt":
      case "contentBodySheet":
      case "contentFxArt":
      case "contentFxSheet":
      case "contentTileArt":
      case "contentTileSheet":
      case "contentSoundArt":
        contentPage.receive(msg);
        return;
      case "contentBalance":
        // Each Balance panel asks with its own range of numbers.
        if (msg.seq >= 200_000_000) {
          vehicleNumbers.receive(msg);
        } else if (msg.seq >= 100_000_000) {
          spellNumbers.receive(msg);
        } else {
          balancePage.receive(msg);
        }
        return;
      case "contentItems":
        itemsPage.receive(msg);
        return;
      case "contentMonsters":
      case "contentNpcFile":
        monstersPage.receive(msg);
        return;
      case "contentSkills":
      case "contentSkillUsage":
        skillsPage.receive(msg);
        return;
      case "contentGathering":
        gatheringPage.receive(msg);
        return;
      case "contentNpcs":
        npcsPage.receive(msg);
        return;
      case "contentPacks":
        packsPage.receive(msg);
        return;
      // A ticket the Packs page asked for, else the Content page's.
      case "contentUploadTicket":
        if (!packsPage.receive(msg)) {
          contentPage.receive(msg);
        }
        return;
      case "contentMaps":
        worldPage.receive(msg);
        return;
      case "content":
        // The content sync fetches and installs the store; nothing else to do here.
        return;
      case "characterList":
        charactersPage.receiveList(msg);
        return;
      case "characterHub":
        charactersPage.receiveHub(msg);
        return;
      case "characterResult":
        charactersPage.receiveResult(msg);
        return;
      case "characterHousePreview":
        charactersPage.receiveHousePreview(msg);
        return;
      case "settingsResult":
        settingsPanel.result(msg);
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
        // Return to Game: the snapshot that follows puts the game back.
        leaveEditing();
        return;
      case "controlPanel":
        if (editing !== "controlPanel") {
          editing = "controlPanel";
          releaseAll(input, sink);
          sign.close();
          charMenu.close();
          showControlPanel();
        }
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
      case "mailClosed":
        // The mailbox went away under the session (given away or demolished): it closes.
        mail.reset();
        model.keyLock = false;
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
        chat.add(msg.text, msg.color);
        // The game's chat log is not on screen in the Control Panel: the line shows there too.
        if (editing === "controlPanel") {
          controlPanel.notice(msg.text);
        }
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
          if (editing === "controlPanel") {
            controlPanel.noteIm();
          }
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
    // Messages the dead session left waiting for a store must not reach the next one.
    contentSync.reset();
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
    model.vitals = null;
    bars.reset();
    panel.resetCharacter();
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
    // A new session (perhaps another account) starts the Control Panel afresh.
    controlPanel.reset();
    settingsPanel.discard();
    activityPage.reset();
    charactersPage.reset();
    contentPage.reset();
    contentRequests.reset();
    balancePage.reset();
    spellNumbers.reset();
    vehicleNumbers.reset();
    for (const area of Object.values(areaPages)) {
      area.reset();
    }
    itemsPage.reset();
    monstersPage.reset();
    skillsPage.reset();
    gatheringPage.reset();
    npcsPage.reset();
    worldPage.reset();
    packsPage.reset();
    playerSettingsWin.window.close();
    inFlightPrefsId = null;
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
    root.querySelector(".settings-confirm:not([hidden]), .control-panel-confirm") !== null;
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
