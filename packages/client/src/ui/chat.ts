/**
 * Chat log and chat input (Internal #47 `chat`, #48 `sendchat`). Live DOM
 * text in the fields' decoded style (assets/original/main/layout/text-styles.jsonl): the log is
 * Arial 12, 742×88, scrolling; the input is Arial 12 bold white, 756×20.
 *
 * - Each line takes its palette colour (`foreColor`). Spaces are kept as typed (`Bob  waves`).
 * - The two lines the server repeats every tick while a key is held (REPEATING_LINES) show once
 *   with a ×N counter (SSO's own rule: repeated identical chat lines collapse). Every other
 *   line prints each time, as 1.6. Display only: the server still sends every line.
 * - Optional text size (`small`, `classic`, `large`) and `[HH:MM]` timestamps from Player Settings.
 */
import { type ChatTextSize, PALETTE_RGB, REPEATING_LINES } from "@secondstaronline/shared";

import { gameInput } from "./action.ts";

/** Lines kept in the log. Not from the original (its field just grew); keeps the DOM small. */
export const CHAT_LOG_LINES = 200;

/**
 * Lines `/logchat` can save: the whole main chat since login or Clear Chat Text. Not from the
 * original (its field just grew); bounds the page's memory.
 */
export const CHAT_SAVE_LINES = 20_000;

export interface ChatLog {
  el: HTMLElement;
  add(text: string, color?: number): void;
  /** Chat → Clear Chat Text: empties the log and what `/logchat` saves. */
  clear(): void;
  /** The main chat as `/logchat` saves it: every line since login or Clear Chat Text. */
  text(): string;
  /** Player Settings → Chat → Text size. */
  setTextSize(size: ChatTextSize): void;
  /** Player Settings → Chat → Timestamps (`[HH:MM]` prefix on visible lines). */
  setTimestamps(on: boolean): void;
}

export function colorOf(index: number): string {
  return PALETTE_RGB[index] ?? PALETTE_RGB[0] ?? "#FFFFFF";
}

function formatStamp(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `[${hh}:${mm}] `;
}

interface LineEntry {
  el: HTMLElement;
  text: string;
  color: number;
  count: number;
  stamp: string;
}

export function createChatLog(now: () => Date = () => new Date()): ChatLog {
  const el = document.createElement("div");
  el.className = "chat-log";
  el.setAttribute("role", "log");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-label", "Chat");
  let last: LineEntry | null = null;
  const entries: LineEntry[] = [];
  const all: string[] = [];
  let timestamps = false;

  const paintLine = (entry: LineEntry) => {
    const body = entry.count > 1 ? `${entry.text} ×${entry.count}` : entry.text;
    if (!timestamps) {
      entry.el.textContent = body;
      return;
    }
    const ts = document.createElement("span");
    ts.className = "chat-ts";
    ts.textContent = entry.stamp;
    entry.el.replaceChildren(ts, document.createTextNode(body));
  };

  return {
    el,
    clear() {
      el.replaceChildren();
      entries.length = 0;
      last = null;
      all.length = 0;
    },
    text() {
      return all.map((l) => `${l}\n`).join("");
    },
    setTextSize(size) {
      el.classList.toggle("chat-size-small", size === "small");
      el.classList.toggle("chat-size-large", size === "large");
    },
    setTimestamps(on) {
      if (timestamps === on) {
        return;
      }
      timestamps = on;
      for (const entry of entries) {
        paintLine(entry);
      }
      el.scrollTop = el.scrollHeight;
    },
    add(text, color = 0) {
      all.push(text);
      if (all.length > CHAT_SAVE_LINES) {
        all.shift();
      }
      if (
        REPEATING_LINES.has(text) &&
        last &&
        last.el.parentElement === el &&
        last.text === text &&
        last.color === color
      ) {
        last.count += 1;
        last.el.dataset.count = String(last.count);
        paintLine(last);
      } else {
        const line = document.createElement("div");
        line.className = "chat-line";
        line.style.color = colorOf(color);
        const entry: LineEntry = { el: line, text, color, count: 1, stamp: formatStamp(now()) };
        paintLine(entry);
        el.append(line);
        entries.push(entry);
        last = entry;
        while (el.childElementCount > CHAT_LOG_LINES) {
          el.firstElementChild?.remove();
          entries.shift();
        }
      }
      el.scrollTop = el.scrollHeight;
    },
  };
}

export function createChatInput(): HTMLInputElement {
  // The chat line is the editable field sendchat (Internal #48, channel 106).
  const input = gameInput("chat-input");
  input.className = "chat-input";
  input.type = "text";
  input.maxLength = 200;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.enterKeyHint = "send";
  input.setAttribute("aria-label", "Chat. Press Enter to type, Enter again to send.");
  return input;
}
