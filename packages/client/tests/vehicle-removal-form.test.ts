/**
 * Where a vehicle is used and its removal form (issue #44, with #28's cleanup), and a cannon's
 * rider drawn without firing frames.
 */
import { describe, expect, test } from "bun:test";

import type { ContentUsageView } from "@secondstaronline/shared";

import { createModel } from "../src/model.ts";
import { bodyMember } from "../src/playfield.ts";
import { drawUsage, type RemovalPlan, removalForm, usageSummary } from "../src/ui/content-usage.ts";

const boat: ContentUsageView = {
  kind: "vehicle",
  key: "Boat",
  name: "Boat",
  retired: false,
  uses: [
    {
      row: { dataset: "houses", part: "deeds", key: "Boat Deed" },
      where: "houses/deeds/Boat Deed → vehicle",
      name: "Boat",
      removable: true,
    },
  ],
  world: [
    { place: "aboard", count: 2, holders: ["Ann", "Bo"], holderCount: 2 },
    { place: "parked", count: 1, holders: ["x1000y992"], holderCount: 1 },
  ],
  characters: 0,
  npcFile: false,
  pending: false,
};

const action = (el: HTMLElement, a: string) =>
  el.querySelector(`[data-action="${a}"]`) as HTMLElement & { value: string };
const hiddenRow = (el: HTMLElement) =>
  (el.closest(".control-panel-field") as HTMLElement | null)?.hidden ?? true;

describe("a vehicle's usage", () => {
  test("names who rides it, where it is parked and the deeds that build it", () => {
    expect(usageSummary(boat)).toBe(
      "ridden by 2 characters · 1 parked one on 1 map · named in 1 place in content",
    );
    const opened: string[] = [];
    const box = drawUsage(boat, { openRow: () => {}, openCharacter: (n) => opened.push(n) });
    expect(box.innerText ?? box.textContent).toContain("Aboard: 2 characters");
    (box.querySelector('[data-action="content-holder-open"]') as HTMLButtonElement).click();
    expect(opened).toEqual(["Ann"]);
  });
});

describe("a vehicle's removal form", () => {
  function form() {
    const plans: RemovalPlan[] = [];
    const host = document.createElement("div");
    const el = removalForm(boat, host, { submit: (p) => plans.push(p), cancel: () => {} });
    document.body.replaceChildren(host, el);
    return { el, plans };
  }

  test("lands by default, with no replacement asked", () => {
    const { el, plans } = form();
    expect(action(el, "content-removal-riders").value).toBe("land");
    expect(hiddenRow(action(el, "content-removal-replacement"))).toBe(true);
    action(el, "content-removal-submit").click();
    expect(plans).toEqual([
      { kind: "vehicle", key: "Boat", content: "remove", replacement: null, riders: "land" },
    ]);
  });

  test("switching asks for the vehicle to switch to", () => {
    const { el, plans } = form();
    const riders = action(el, "content-removal-riders") as unknown as HTMLSelectElement;
    riders.value = "switch";
    riders.dispatchEvent(new Event("change"));
    const rep = action(el, "content-removal-replacement") as unknown as HTMLInputElement;
    expect(hiddenRow(rep)).toBe(false);
    action(el, "content-removal-submit").click();
    expect(plans).toEqual([]);
    rep.value = "Battleship";
    action(el, "content-removal-submit").click();
    expect(plans).toEqual([
      {
        kind: "vehicle",
        key: "Boat",
        content: "remove",
        replacement: "Battleship",
        riders: "switch",
      },
    ]);
  });
});

describe("a cannon's rider without firing frames", () => {
  test("shows its standing frame while it fires; with them, the firing frame", () => {
    const m = createModel();
    const has = (names: string[]) => ({
      sprite: (_g: string, n: string) =>
        names.includes(n) ? ([0, 0, 0, 1, 1, 0, 0] as never) : undefined,
    });
    expect(bodyMember(m, has([]), 1001, "fire2", "E")).not.toBe("1001-fire2-E");
    expect(bodyMember(m, has([]), 1001, "fire2", "E")).toMatch(/^1001-F[1-4]-E$/);
    expect(bodyMember(m, has(["56-fire2-E"]), 56, "fire2", "E")).toBe("56-fire2-E");
    expect(bodyMember(m, has([]), 56, "F2", "N")).toBe("56-F2-N");
  });
});
