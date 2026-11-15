/** Identifies an interactive control by its in-game action. */
export function action<T extends HTMLElement>(el: T, id: string): T {
  el.dataset.action = id;
  return el;
}
