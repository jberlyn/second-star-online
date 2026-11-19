/**
 * Chat log and chat input (Internal #47 `chat`, #48 `sendchat`). Live DOM
 * text in the fields' decoded style (assets/original/main/layout/text-styles.jsonl): the log is
 * Arial 12, 742×88, scrolling; the input is Arial 12 bold white, 756×20.
 *
 * - Each line takes its palette colour (`foreColor`). Spaces are kept as typed (`Bob  waves`).
 * - The two lines the server repeats every tick while a key is held (REPEATING_LINES) show once
 *   with a ×N counter (SSO's own rule: repeated identical chat lines collapse). Every other
 *   line prints each time, as 1.6. Display only: the server still sends every line.
 */
import { PALETTE_RGB, REPEATING_LINES } from "@secondstaronline/shared";

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
}

export function colorOf(index: number): string {
  return PALETTE_RGB[index] ?? PALETTE_RGB[0] ?? "#FFFFFF";
}

export function createChatLog(): ChatLog {
  const el = document.createElement("div");
  el.className = "chat-log";
  el.setAttribute("role", "log");
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-label", "Chat");
  let last: { el: HTMLElement; text: string; color: number; count: number } | null = null;
  const all: string[] = [];
  return {
    el,
    clear() {
      el.replaceChildren();
      last = null;
      all.length = 0;
    },
    text() {
      return all.map((l) => `${l}\n`).join("");
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
        last.el.textContent = `${text} ×${last.count}`;
        last.el.dataset.count = String(last.count);
      } else {
        const line = document.createElement("div");
        line.className = "chat-line";
        line.textContent = text;
        line.style.color = colorOf(color);
        el.append(line);
        last = { el: line, text, color, count: 1 };
        while (el.childElementCount > CHAT_LOG_LINES) {
          el.firstElementChild?.remove();
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
