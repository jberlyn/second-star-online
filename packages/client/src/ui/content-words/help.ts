/** Plain words for the `help` dataset's forms (see content-words.ts). */
import type { WordBook } from "../content-words.ts";

export const helpWords: WordBook = {
  "topics.file": {
    label: "File name",
    help: "The topic's name with .txt on the end, such as banking.txt.",
    more: true,
  },
  "topics.topic": {
    label: "Topic",
    help: "What players type after /help to read it.",
  },
  "topics.reachable": {
    label: "Players can read it",
    help: "Whether /help can show this topic.",
  },
  "topics.lines": {
    label: "Text",
    help: "Each line as players see it; blank lines are kept.",
    noun: "line",
  },
  "topics.lines.[]": { label: "Line" },
};
