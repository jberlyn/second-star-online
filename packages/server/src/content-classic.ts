/**
 * Installs the content store from the Classic pack's generated modules, when none is installed
 * yet. Entry points import this first, so the store exists before any other module loads (some,
 * like the setting defaults, still copy content values when they load).
 */
import { classicData } from "@secondstaronline/data/classic";
import { buildContentStore, hasContent, installContent } from "@secondstaronline/shared";

if (!hasContent()) {
  installContent(buildContentStore(classicData));
}
