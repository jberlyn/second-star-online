/** Test preload: installs the Classic pack's content store, as a server with no operator changes runs. */
import { classicData } from "@secondstaronline/data/classic";
import { buildContentStore, installContent } from "@secondstaronline/shared";

installContent(buildContentStore(classicData));
