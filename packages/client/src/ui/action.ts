/** Identifies an interactive control by its in-game action. */
export function action<T extends HTMLElement>(el: T, id: string): T {
  el.dataset.action = id;
  return el;
}

/**
 * Marks a field that is not a credential so password managers leave it alone. Bitwarden and its
 * peers ignore `autocomplete="off"`, so each needs its own opt-out attribute; without them an
 * in-game field (chat, amounts, mail) gets an autofill menu.
 */
export function noAutofill<T extends HTMLInputElement | HTMLTextAreaElement>(el: T): T {
  el.autocomplete = "off";
  el.setAttribute("data-bwignore", "true"); // Bitwarden
  el.setAttribute("data-1p-ignore", "true"); // 1Password
  el.setAttribute("data-lpignore", "true"); // LastPass
  el.setAttribute("data-form-type", "other"); // Dashlane
  return el;
}

/** A non-credential `<input>` tagged with its in-game action. */
export function gameInput(id: string): HTMLInputElement {
  return noAutofill(action(document.createElement("input"), id));
}
