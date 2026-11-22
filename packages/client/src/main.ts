import { startApp } from "./app.ts";

const root = document.getElementById("app");
if (root) {
  startApp(root).catch((err: unknown) => {
    root.textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
  });
}
