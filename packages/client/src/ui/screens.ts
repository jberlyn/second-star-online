/**
 * Title, login and character-creation screens, built from the original art at its score positions
 * Rects are top-left = loc − regpoint, from assets/original/main/layout/
 * score-spans.jsonl (frames 8-10 title, 31 login, 26 creation).
 *
 * Title (frame 8): only Load Character (→ frame 30) and New
 * Character lead anywhere in a browser. Game Setup (prefs) arrives with its settings,
 * Server Editor and Exit belonged to the Windows projector, and the frame-10 advert popup
 * (Internal #106, #234-236) pointed at a dead website; their art is shown, inert.
 */
import {
  CREATION_POINTS,
  HEADS_BY_SEX,
  nextHead,
  type Sex,
  STAT_MAX,
  STAT_MIN,
  type StartClass,
} from "@secondstaronline/shared";

import { type Assets, drawSprite } from "../assets.ts";
import { type Sfx, SOUND } from "../sfx.ts";
import { action } from "./action.ts";
import { artImg, type Rect, type StageItem } from "./stage.ts";

export interface Screen {
  items: StageItem[];
  /** Focus the first field, etc. */
  onShow?(): void;
}

function hit(label: string, actionId: string, onClick: () => void): HTMLButtonElement {
  const b = action(document.createElement("button"), actionId);
  b.className = "hit";
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

/** The name and password fields are DBAdmin #3 and #4, editable (login and creation). */
function field(type: "text" | "password", label: string): HTMLInputElement {
  const i = action(
    document.createElement("input"),
    type === "password" ? "account-password" : "account-name",
  );
  i.type = type;
  i.className = "field";
  i.setAttribute("aria-label", label);
  i.autocomplete = type === "password" ? "current-password" : "username";
  i.spellcheck = false;
  return i;
}

function label(cls: string, text: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

/** Internal #250: `unFun Games 1999-2003` / `http://www.unfungames.com` / `v1.6`. */
function credits(): HTMLElement {
  const d = document.createElement("div");
  d.className = "title-credits";
  for (const text of ["unFun Games 1999-2003", "http://www.unfungames.com", "v1.6"]) {
    d.append(label("title-credit", text));
  }
  return d;
}

const ui = (a: Assets, m: number) => a.ui("internal", m);

export function titleScreen(
  a: Assets,
  go: { load(): void; create(): void; sound(s: Sfx): void },
): Screen {
  const items: StageItem[] = [
    {
      el: artImg(ui(a, 105), "First Star Online"),
      x: 194,
      y: -19,
      w: 409,
      h: 526,
      z: 2,
      art: true,
    },
    { el: artImg(ui(a, 39)), x: 253, y: 288, w: 308, h: 46, z: 10, art: true },
    { el: artImg(ui(a, 38)), x: 259, y: 329, w: 284, h: 39, z: 9, art: true },
    { el: artImg(ui(a, 103)), x: 269, y: 366, w: 263, h: 36, z: 12, art: true },
    { el: artImg(ui(a, 127)), x: 262, y: 406, w: 281, h: 28, z: 3, art: true },
    { el: artImg(ui(a, 104)), x: 308, y: 440, w: 172, h: 36, z: 13, art: true },
    // Load Character clicks on channel 3; New Character on channel 1, its behaviour shadowing the
    // cast script.
    {
      el: hit("Load Character", "title-load-character", () => {
        go.sound(SOUND.click);
        go.load();
      }),
      x: 253,
      y: 288,
      w: 308,
      h: 46,
      z: 20,
    },
    {
      el: hit("New Character", "title-new-character", () => {
        go.sound(SOUND.newCharacter);
        go.create();
      }),
      x: 259,
      y: 329,
      w: 284,
      h: 39,
      z: 20,
    },
    // The credits text (Internal #250, a text member on channel 1 of frames 7-10), loc (259, 533),
    // 293 wide: three centred lines, #EFEFEF on the black title. Plain text: its cast script's
    // mouseUp is empty.
    { el: credits(), x: 259, y: 533, w: 293, h: 46, z: 1 },
  ];
  return {
    items,
  };
}

export function loginScreen(
  a: Assets,
  go: { ok(name: string, password: string): void; cancel(): void; sound(s: Sfx): void },
  prefill = "",
): Screen {
  const name = field("text", "Name");
  const password = field("password", "Password");
  name.value = prefill;
  name.maxLength = 20;
  password.maxLength = 64;
  // OK clicks first; Enter in a field is the same button.
  const ok = () => {
    go.sound(SOUND.click);
    go.ok(name.value.trim(), password.value);
  };
  for (const f of [name, password]) {
    f.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        ok();
      }
    });
  }
  const items: StageItem[] = [
    { el: artImg(ui(a, 195), "Log in"), x: 289, y: 137, w: 258, h: 136, z: 3, art: true },
    { el: name, x: 409, y: 171, w: 94, h: 16, z: 5 },
    { el: password, x: 409, y: 195, w: 107, h: 16, z: 6 },
    { el: artImg(ui(a, 201)), x: 431, y: 231, w: 52, h: 24, z: 10, art: true },
    { el: artImg(ui(a, 202)), x: 488, y: 230, w: 45, h: 24, z: 11, art: true },
    // Cancel clicks first too.
    {
      el: hit("Cancel", "login-cancel", () => {
        go.sound(SOUND.click);
        go.cancel();
      }),
      x: 431,
      y: 231,
      w: 52,
      h: 24,
      z: 20,
    },
    {
      el: hit("OK", "login-submit", ok),
      x: 488,
      y: 230,
      w: 45,
      h: 24,
      z: 20,
    },
  ];
  return {
    items,
    onShow: () => (prefill ? password : name).focus(),
  };
}

export interface CreationValues {
  name: string;
  password: string;
  sex: Sex;
  head: number;
  classCode: StartClass;
  str: number;
  sta: number;
  int: number;
  wis: number;
  dex: number;
}

const STAT_ROWS = [
  { key: "str", y: 158 },
  { key: "sta", y: 178 },
  { key: "int", y: 200 },
  { key: "wis", y: 220 },
  { key: "dex", y: 242 }, // labelled "Mysticism" on the art
] as const;

/**
 * Character creation (frame 26). The + and − buttons, the stat bars that slide 7 px per
 * point (I220/I221), the two head arrows, the sex and class radio buttons and the name and
 * password fields all behave as the original's scripts did; the server checks the result.
 */
export function creationScreen(
  a: Assets,
  go: { ok(v: CreationValues): void; cancel(): void; sound(s: Sfx): void },
): Screen {
  const v: CreationValues = {
    name: "",
    password: "",
    sex: 1,
    head: 1,
    classCode: 1, // class = 1, sex = 1
    str: STAT_MIN,
    sta: STAT_MIN,
    int: STAT_MIN,
    wis: STAT_MIN,
    dex: STAT_MIN,
  };
  const items: StageItem[] = [];
  const points = () => CREATION_POINTS - (v.str + v.sta + v.int + v.wis + v.dex - 5 * STAT_MIN);
  const pointsLabel = label("cc-points", "");
  const bars: HTMLImageElement[] = [];
  const nums: HTMLDivElement[] = [];
  const refreshStats = () => {
    pointsLabel.textContent = `Points remaining: ${points()}`;
    STAT_ROWS.forEach((row, i) => {
      const val = v[row.key];
      (nums[i] as HTMLDivElement).textContent = String(val);
      // The bar's locH starts at 72 and moves 7 px per point.
      (bars[i] as HTMLImageElement).style.transform = `translateX(${7 * (val - STAT_MIN)}px)`;
    });
  };

  items.push({
    el: artImg(ui(a, 155), "Character creation"),
    x: -28,
    y: 93,
    w: 749,
    h: 230,
    z: 1,
    art: true,
  });
  STAT_ROWS.forEach((row, i) => {
    const bar = artImg(ui(a, 183));
    bars.push(bar);
    items.push({ el: bar, x: 0, y: row.y - 6, w: 145, h: 13, z: 0 });
    const num = label("cc-stat", "");
    nums.push(num);
    items.push({ el: num, x: 244, y: row.y - 5, w: 34, h: 15, z: 390 + i });
    const plus = artImg(ui(a, 218));
    const minus = artImg(ui(a, 219));
    items.push({ el: plus, x: 286, y: row.y - 6, w: 11, h: 11, z: 40 + i * 3, art: true });
    items.push({ el: minus, x: 120, y: row.y - 6, w: 11, h: 11, z: 41 + i * 3, art: true });
    // The plus buttons are on channels 40/43/46/49/52, the minus buttons on 41/44/47/50/53 (score
    // frame 25).
    const inc = hit(`More ${row.key}`, `creation-increase-${row.key}`, () => {
      if (points() > 0 && v[row.key] < STAT_MAX) {
        v[row.key] += 1;
      }
      refreshStats();
    });
    const dec = hit(`Less ${row.key}`, `creation-decrease-${row.key}`, () => {
      if (v[row.key] > STAT_MIN) {
        v[row.key] -= 1;
      }
      refreshStats();
    });
    items.push({ el: inc, x: 282, y: row.y - 10, w: 19, h: 19, z: 100 });
    items.push({ el: dec, x: 116, y: row.y - 10, w: 19, h: 19, z: 100 });
  });
  items.push({ el: pointsLabel, x: 136, y: 257, w: 146, h: 16, z: 38 });

  // Body preview (Internal #159) and the chosen head (Characters HEAD<n>-F2-S).
  const preview = document.createElement("canvas");
  preview.width = 46;
  preview.height = 45;
  preview.className = "art";
  const drawHead = () => {
    const c = preview.getContext("2d");
    if (!c) {
      return;
    }
    c.clearRect(0, 0, 46, 45);
    c.imageSmoothingEnabled = false;
    drawSprite(c, a, "paperdoll", `Head${v.head}-F2-S`, 0, 0, true);
  };
  void a.loadGroup("paperdoll").then(drawHead);
  items.push({ el: artImg(ui(a, 159)), x: 438, y: 202, w: 46, h: 45, z: 17 });
  items.push({ el: preview, x: 438, y: 202, w: 46, h: 45, z: 18 });
  const arrow = () => {
    v.head = nextHead(v.sex, v.head);
    drawHead();
  };
  items.push({ el: artImg(ui(a, 197)), x: 433, y: 252, w: 29, h: 23, z: 28, art: true });
  items.push({ el: artImg(ui(a, 198)), x: 459, y: 252, w: 30, h: 23, z: 29, art: true });
  // Both arrows' scripts are the same "next" cycle.
  items.push({
    el: hit("Previous head", "creation-previous-head", arrow),
    x: 433,
    y: 252,
    w: 29,
    h: 23,
    z: 100,
  });
  items.push({
    el: hit("Next head", "creation-next-head", arrow),
    x: 459,
    y: 252,
    w: 30,
    h: 23,
    z: 100,
  });

  // Radio buttons: member 62 = selected, 63 = not (I64-I68).
  const radio = () => artImg(ui(a, 63));
  const sexRadios = [radio(), radio()];
  const classRadios = [radio(), radio(), radio()];
  const classOrder: StartClass[] = [1, 3, 2]; // Fighter, Ranger, Mage (field Internal #196)
  // fighter on channel 22, ranger on 24, mage on 23 (score frame 25). The fourth radio, business
  // (channel 25), sits off-stage at (189, 638) and nothing moves it.
  const refreshRadios = () => {
    sexRadios.forEach((r, i) => {
      r.src = ui(a, v.sex === i + 1 ? 62 : 63);
    });
    classRadios.forEach((r, i) => {
      r.src = ui(a, v.classCode === classOrder[i] ? 62 : 63);
    });
  };
  const setSex = (sex: Sex) => {
    v.sex = sex;
    v.head = HEADS_BY_SEX[sex][0] ?? sex; // male shows HEAD1, female HEAD2
    refreshRadios();
    drawHead();
  };
  sexRadios.forEach((r, i) => {
    items.push({ el: r, x: 426, y: 153 + i * 15, w: 12, h: 12, z: 20 + i });
    items.push({
      el: hit(i === 0 ? "Male" : "Female", i === 0 ? "creation-male" : "creation-female", () =>
        setSex((i + 1) as Sex),
      ),
      x: 424,
      y: 151 + i * 15,
      w: 50,
      h: 15,
      z: 100,
    });
  });
  const classText = label("cc-classes", "");
  classText.innerHTML = "Fighter<br>Ranger<br>Mage";
  items.push({ el: classText, x: 544, y: 223, w: 100, h: 48, z: 26 });
  classRadios.forEach((r, i) => {
    items.push({ el: r, x: 526, y: 225 + i * 15, w: 12, h: 12, z: 22 + i });
    items.push({
      el: hit(
        ["Fighter", "Ranger", "Mage"][i] ?? "",
        `creation-class-${["fighter", "ranger", "mage"][i]}`,
        () => {
          v.classCode = classOrder[i] ?? 1;
          refreshRadios();
        },
      ),
      x: 524,
      y: 223 + i * 15,
      w: 110,
      h: 15,
      z: 100,
    });
  });

  const name = field("text", "Name");
  name.maxLength = 20;
  const password = field("password", "Password");
  password.autocomplete = "new-password";
  password.maxLength = 64;
  items.push({ el: name, x: 586, y: 150, w: 83, h: 14, z: 4 });
  items.push({ el: password, x: 586, y: 175, w: 80, h: 16, z: 5 });

  const submit = () => go.ok({ ...v, name: name.value.trim(), password: password.value });
  items.push({ el: artImg(ui(a, 193)), x: 584, y: 275, w: 74, h: 48, z: 15, art: true });
  items.push({ el: artImg(ui(a, 192)), x: 663, y: 275, w: 52, h: 40, z: 14, art: true });
  // Cancel clicks. OK uses the create-user behavior on channel 14; the member's own handler
  // names an invalid event, so it never runs. OK and the other controls are silent.
  const cancel = () => {
    go.sound(SOUND.click);
    go.cancel();
  };
  items.push({
    el: hit("Cancel", "creation-cancel", cancel),
    x: 584,
    y: 275,
    w: 74,
    h: 48,
    z: 100,
  });
  items.push({ el: hit("OK", "creation-submit", submit), x: 663, y: 275, w: 52, h: 40, z: 100 });

  refreshStats();
  refreshRadios();
  return {
    items,
    onShow: () => name.focus(),
  };
}
