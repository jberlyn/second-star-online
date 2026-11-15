/**
 * Member rects for the server's spell collision (schema/rects.ts). Kept off the
 * package index so the client bundle never carries it: the client reads its own atlas index.
 */
export type { MemberRect, RectsData } from "../schema/rects.ts";
export { rectsData } from "./generated/rects.ts";
