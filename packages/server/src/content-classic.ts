/**
 * Installs the Classic pack's store, read from its folder in the release, when none is installed
 * yet. The command-line tools import this first: they read stored data and settings, and the
 * modules they load expect a store. The server itself builds its store from the installed packs
 * and the operator layer (content/service.ts) instead.
 */
import { RELEASE_PACK_DIRS } from "@secondstaronline/data/packs";
import {
  buildContentStore,
  type ContentData,
  hasContent,
  installContent,
} from "@secondstaronline/shared";

import { readPackDir } from "./content/packs.ts";

if (!hasContent()) {
  installContent(
    buildContentStore(readPackDir(RELEASE_PACK_DIRS.classic as string).data as ContentData),
  );
}
