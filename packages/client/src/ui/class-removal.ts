/**
 * Removing a class on the Classes tab (issue #15): the characters in it need another class, so
 * Remove asks which one they move to when the change is published, and puts the removal in the
 * draft with that move. A class nobody is in is removed with a plain question.
 */
import { content, hasContent } from "@secondstaronline/shared";

import type { ContentAnswer, ContentRequests } from "./content-requests.ts";
import { confirmChoice } from "./control-panel-kit.ts";

export async function removeClass(
  key: string,
  host: HTMLElement,
  requests: ContentRequests,
): Promise<ContentAnswer | null> {
  const code = Number(key);
  const usage = await requests.classUsage(code);
  const others = hasContent()
    ? content()
        .classes.classes.filter((c) => c.code !== code)
        .map((c) => [String(c.code), `${c.code} · ${c.name}`] as const)
    : [];
  if (others.length === 0) {
    return { ok: false, text: "A world needs a class: add another before removing this one." };
  }
  // The class they already move to, if the removal is waiting, comes first.
  const pending = usage.pending === null ? undefined : String(usage.pending);
  const options = [
    ...others.filter(([v]) => v === pending),
    ...others.filter(([v]) => v !== pending),
  ];
  const n = usage.holders;
  const c = await confirmChoice(host, {
    text:
      n > 0
        ? `${n === 1 ? "1 character is" : `${n} characters are`} in ${usage.name}. When your changes are published, ${usage.name} is removed and ${n === 1 ? "that character moves" : "they move"} to the class you pick.`
        : `Remove ${usage.name}? Nobody is in it. Anything else that names it (a way in, gear, a title) is named by the checks before publishing.`,
    select: { action: "classes-remove-move-to", label: "Move them to", options },
    confirm: "Remove",
    cancel: "Keep it",
    danger: true,
  });
  if (!c.yes || c.selected === undefined) {
    return null;
  }
  return requests.removeClass(code, Number(c.selected));
}
