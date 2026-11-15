/**
 * The original showed Windows `alert()` boxes for login and creation results. Browsers' own
 * alert blocks the page and looks different in every browser, so this is a small in-page box
 * with one OK button.
 */
import { action } from "./action.ts";

export function showAlert(root: HTMLElement, text: string): Promise<void> {
  return new Promise((resolve) => {
    const shade = document.createElement("div");
    shade.className = "alert-shade";
    const box = action(document.createElement("div"), "alert-dismiss");
    box.className = "alert-box";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-label", text);
    const p = document.createElement("p");
    p.textContent = text;
    const ok = action(document.createElement("button"), "alert-confirm");
    ok.textContent = "OK";
    ok.className = "alert-ok";
    const close = () => {
      shade.remove();
      resolve();
    };
    ok.addEventListener("click", close);
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    box.append(p, ok);
    shade.append(box);
    root.append(shade);
    ok.focus();
  });
}
