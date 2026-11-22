import { classicData } from "@secondstaronline/data/classic";
import { buildContentStore, installContent } from "@secondstaronline/shared";

import { startApp } from "./app.ts";

// The content store is still the Classic pack's generated modules, bundled with the client.
installContent(buildContentStore(classicData));

const root = document.getElementById("app");
if (root) {
  startApp(root).catch((err: unknown) => {
    root.textContent = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
  });
}
