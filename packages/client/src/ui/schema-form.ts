/**
 * A form drawn from a content row's shape (the JSON Schema the server sends with a row): every
 * field as a plain control, in plain words, so no content needs typing as JSON. Objects are groups
 * of fields, lists are rows you add, remove and move, a pick from a fixed set is a drop-down, an
 * optional value is a tick box that shows its fields, and a value that can take several shapes
 * asks which one. Names of things the game has (items, monsters, skills…) are offered as you type.
 *
 * The words come from `FormWords` (content-words.ts): each field's label, its help line, the
 * labels of its choices, and whether it is a rarely used one folded under "More options". A field
 * with no words of its own is named from its key ("periodFrames" → "Period frames").
 *
 * An SSO page part: 1.6 had no content editor.
 */
import { action, noAutofill } from "./action.ts";

/** The JSON Schema subset `z.toJSONSchema` writes for the content schemas. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  pattern?: string;
}

/** What the words say about one field. */
export interface FieldWords {
  label?: string;
  help?: string;
  /** Folded under "More options" in its group. */
  more?: boolean;
  /** Not shown (an internal id the game keeps in step on its own); its value is kept. */
  hidden?: boolean;
  /** The kind of name it holds, offered as you type ("item", "monster", "skill"…). */
  names?: string;
  /** A long text: a box several lines high. */
  long?: boolean;
  /** The label of each choice of a drop-down, by value. */
  choices?: Record<string, string>;
  /** What one entry of a list is called ("drop", "row"), for its Add button. */
  noun?: string;
  /** The labels of a value that can take several shapes, in the schema's order. */
  shapes?: string[];
  /** A top-level field's tab: a form whose fields name tabs shows one tab at a time. */
  tab?: string;
}

/** Where a field's words come from. `path` is the field's keys from the row, `[]` for a list's entries. */
export interface FormWords {
  field(path: readonly string[]): FieldWords;
  /** Names of a kind (items, monsters…) to offer as you type, or none. */
  names(kind: string): readonly string[];
}

export interface SchemaForm {
  readonly el: HTMLElement;
  /** The value as the fields hold it. Throws a `FormError` naming a field that does not read. */
  value(): unknown;
}

/** A field whose text is not a value (a number that is not a whole number, a missing name). */
export class FormError extends Error {}

const SPECIAL: Record<string, string> = {
  hp: "HP",
  sp: "SP",
  xp: "XP",
  id: "ID",
  ids: "IDs",
  npc: "NPC",
  npcs: "NPCs",
  pvp: "PvP",
  fx: "effect",
  px: "pixels",
  ch: "channel",
  mx: "map x",
  my: "map y",
  im: "IM",
  ims: "IMs",
  ip: "IP",
  url: "URL",
  ui: "screen",
  x: "x",
  y: "y",
  n: "n",
};

/** A key in plain words: `periodFrames` → "Period frames", `npcSpawn` → "NPC spawn". */
export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SPECIAL[w.toLowerCase()] ?? w.toLowerCase());
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The variants of a union, or null. */
function variantsOf(s: JsonSchema): JsonSchema[] | null {
  if (s.anyOf) {
    return s.anyOf;
  }
  if (s.oneOf) {
    return s.oneOf;
  }
  if (Array.isArray(s.type)) {
    return s.type.map((t) => ({ ...s, type: t }));
  }
  return null;
}

const isNull = (s: JsonSchema) => s.type === "null" || (s.const === null && s.type === undefined);

/** A schema with `null` taken out of its union, and whether it had one. */
function withoutNull(s: JsonSchema): { inner: JsonSchema; nullable: boolean } {
  const vs = variantsOf(s);
  if (!vs || !vs.some(isNull)) {
    return { inner: s, nullable: false };
  }
  const rest = vs.filter((v) => !isNull(v));
  if (rest.length === 1 && rest[0]) {
    return { inner: rest[0], nullable: true };
  }
  return { inner: { anyOf: rest }, nullable: true };
}

/** A value a schema starts with: a new list entry, a field ticked on, a shape picked. */
export function blank(s: JsonSchema): unknown {
  if (s.default !== undefined) {
    return structuredClone(s.default);
  }
  if (s.const !== undefined) {
    return s.const;
  }
  if (s.enum) {
    return s.enum[0];
  }
  const vs = variantsOf(s);
  if (vs) {
    if (vs.some(isNull)) {
      return null;
    }
    return vs[0] ? blank(vs[0]) : null;
  }
  switch (s.type) {
    case "string":
      return "";
    case "integer":
    case "number": {
      const low = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 0);
      return Math.max(low, Math.min(0, s.maximum ?? 0));
    }
    case "boolean":
      return false;
    case "array":
      if (s.prefixItems) {
        return s.prefixItems.map(blank);
      }
      return Array.from({ length: s.minItems ?? 0 }, () => (s.items ? blank(s.items) : null));
    case "object": {
      const out: Record<string, unknown> = {};
      for (const k of s.required ?? []) {
        const p = s.properties?.[k];
        if (p) {
          out[k] = blank(p);
        }
      }
      return out;
    }
    default:
      return null;
  }
}

/** Whether `v` fits `s` well enough to be shown as that shape (a union's pick). */
export function fits(s: JsonSchema, v: unknown): boolean {
  if (s.const !== undefined) {
    return v === s.const;
  }
  if (s.enum) {
    return s.enum.includes(v);
  }
  const vs = variantsOf(s);
  if (vs) {
    return vs.some((x) => fits(x, v));
  }
  switch (s.type) {
    case "null":
      return v === null;
    case "string":
      return typeof v === "string";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "number":
      return typeof v === "number";
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object": {
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return false;
      }
      const o = v as Record<string, unknown>;
      if (s.properties) {
        for (const [k, p] of Object.entries(s.properties)) {
          // A constant field tells two object shapes apart.
          if (p.const !== undefined && o[k] !== p.const) {
            return false;
          }
        }
        if (!(s.required ?? []).every((k) => k in o)) {
          return false;
        }
        if (s.additionalProperties === false) {
          return Object.keys(o).every((k) => k in (s.properties ?? {}));
        }
      }
      return true;
    }
    default:
      return true;
  }
}

/** What a shape is called when no words name it. */
function shapeName(s: JsonSchema): string {
  if (s.const !== undefined) {
    return humanize(String(s.const));
  }
  if (s.enum) {
    return s.enum.length === 1 ? humanize(String(s.enum[0])) : "One of a list";
  }
  if (s.properties) {
    // An object told apart by a constant field: its constant names it.
    for (const p of Object.values(s.properties)) {
      if (p.const !== undefined) {
        return humanize(String(p.const));
      }
    }
    const keys = Object.keys(s.properties);
    return keys.length <= 3 ? keys.map(humanize).join(", ") : "Several settings";
  }
  switch (s.type) {
    case "string":
      return "Text";
    case "integer":
    case "number":
      return "A number";
    case "boolean":
      return "Yes or no";
    case "array":
      return s.prefixItems ? "A set of values" : "A list";
    case "object":
      return "A list of named values";
    default:
      return "A value";
  }
}

/** The text an entry of a list is called by in its header: its name, or the first words it has. */
export function entryTitle(v: unknown, at: number): string {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of [
      "name",
      "label",
      "title",
      "display",
      "key",
      "code",
      "skill",
      "item",
      "monster",
      "npc",
      "deed",
      "house",
      "file",
      "effect",
      "spell",
      "pattern",
      "weapon",
      "member",
      "text",
      "kind",
    ]) {
      const x = o[k];
      if (typeof x === "string" && x.trim() !== "") {
        return x.length > 48 ? `${x.slice(0, 45)}…` : x;
      }
      if (typeof x === "number") {
        return `${humanize(k)} ${x}`;
      }
    }
  }
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    // No field that names it: its first words.
    const first = Object.values(v as Record<string, unknown>).find(
      (x) => typeof x === "string" && x.trim() !== "",
    ) as string | undefined;
    if (first) {
      return first.length > 48 ? `${first.slice(0, 45)}…` : first;
    }
    // Numbers only: its first few values ("Faces 1, 1, 1 · Bonus 50").
    const bits = Object.entries(v as Record<string, unknown>)
      .filter(
        ([, x]) =>
          typeof x === "number" ||
          (Array.isArray(x) && x.length > 0 && x.every((y) => typeof y === "number")),
      )
      .slice(0, 3)
      .map(([k, x]) => `${humanize(k)} ${Array.isArray(x) ? x.join(", ") : x}`);
    if (bits.length > 0) {
      const t = bits.join(" · ");
      return t.length > 48 ? `${t.slice(0, 45)}…` : t;
    }
  }
  if (typeof v === "string" && v.trim() !== "") {
    return v.length > 48 ? `${v.slice(0, 45)}…` : v;
  }
  if (typeof v === "number") {
    return String(v);
  }
  return `Entry ${at + 1}`;
}

/** A field's built control: its element and how to read it back. */
interface Built {
  el: HTMLElement;
  get(): unknown;
  /** A plain control that sits inline with its label (a number, a text, a pick, a tick box). */
  inline: boolean;
}

let uid = 0;
const nextId = () => `schema-form-${++uid}`;

/** `["items", "[]", "icon"]` → "Items › icon" for an error. */
function where(label: string): string {
  return label;
}

export function schemaForm(
  schema: JsonSchema,
  value: unknown,
  words: FormWords,
  opts: { id: string; onInput?: () => void; readOnly?: boolean } = { id: "content" },
): SchemaForm {
  const changed = () => opts.onInput?.();
  const datalists = new Map<string, string>();
  const lists = document.createElement("div");
  lists.hidden = true;

  /** A `<datalist>` of names of a kind, made once per form. */
  const namesList = (kind: string): string | null => {
    const known = datalists.get(kind);
    if (known) {
      return known;
    }
    const names = words.names(kind);
    if (names.length === 0) {
      return null;
    }
    const dl = document.createElement("datalist");
    dl.id = nextId();
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n;
      dl.append(o);
    }
    lists.append(dl);
    datalists.set(kind, dl.id);
    return dl.id;
  };

  const lock = <T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(c: T): T => {
    if (opts.readOnly) {
      c.disabled = true;
    }
    return c;
  };

  const build = (s: JsonSchema, v: unknown, path: string[], label: string): Built => {
    const w = words.field(path);
    if (s.const !== undefined) {
      const el = document.createElement("span");
      el.hidden = true;
      return { el, get: () => s.const, inline: true };
    }
    const { inner, nullable } = withoutNull(s);
    if (nullable) {
      return optional(inner, v, path, label, null);
    }
    const vs = variantsOf(s);
    if (vs && !s.enum) {
      return union(vs, v, path, label);
    }
    if (s.enum) {
      const sel = lock(action(document.createElement("select"), `${opts.id}-pick`));
      for (const e of s.enum) {
        const o = document.createElement("option");
        o.value = JSON.stringify(e);
        o.textContent = w.choices?.[String(e)] ?? humanize(String(e));
        sel.append(o);
      }
      const now = s.enum.includes(v) ? v : s.enum[0];
      sel.value = JSON.stringify(now);
      sel.addEventListener("change", changed);
      return { el: sel, get: () => JSON.parse(sel.value) as unknown, inline: true };
    }
    switch (s.type) {
      case "string":
        return text(s, v, w, label);
      case "integer":
      case "number":
        return number(s, v, label);
      case "boolean": {
        const box = lock(action(document.createElement("input"), `${opts.id}-check`));
        box.type = "checkbox";
        box.checked = v === true;
        box.addEventListener("change", changed);
        return { el: box, get: () => box.checked, inline: true };
      }
      case "array":
        if (s.prefixItems) {
          return tuple(s.prefixItems, v, path, label);
        }
        return list(s.items ?? {}, v, path, label, w, s);
      case "object":
        if (s.properties) {
          return object(s, v, path);
        }
        return record(s, v, path, label, w);
      default:
        return anyValue(v, label);
    }
  };

  const text = (s: JsonSchema, v: unknown, w: FieldWords, label: string): Built => {
    const long = w.long || (s.maxLength ?? 0) > 200;
    const c = lock(
      noAutofill(
        action(
          document.createElement(long ? "textarea" : "input"),
          `${opts.id}-text`,
        ) as HTMLInputElement,
      ),
    );
    if (!long) {
      c.type = "text";
    } else {
      (c as unknown as HTMLTextAreaElement).rows = 3;
    }
    c.value = typeof v === "string" ? v : "";
    if (s.maxLength !== undefined) {
      c.maxLength = s.maxLength;
    }
    if (w.names) {
      const list = namesList(w.names);
      if (list) {
        c.setAttribute("list", list);
      }
    }
    c.addEventListener("input", changed);
    return {
      el: c,
      get: () => {
        if (c.value.length < (s.minLength ?? 0)) {
          throw new FormError(`${where(label)} can't be empty.`);
        }
        return c.value;
      },
      inline: true,
    };
  };

  const number = (s: JsonSchema, v: unknown, label: string): Built => {
    const c = lock(noAutofill(action(document.createElement("input"), `${opts.id}-number`)));
    c.type = "text";
    c.inputMode = s.type === "integer" ? "numeric" : "decimal";
    c.className = "schema-form-number";
    c.value = typeof v === "number" ? String(v) : "";
    const lo = s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum : undefined);
    const hi = s.maximum ?? s.exclusiveMaximum;
    const shown = (n: number | undefined) =>
      n === undefined || Math.abs(n) >= 2 ** 52 ? undefined : n;
    const low = shown(lo);
    const high = shown(hi);
    if (low !== undefined || high !== undefined) {
      c.title =
        low !== undefined && high !== undefined
          ? `${s.exclusiveMinimum !== undefined ? `more than ${low}` : `from ${low}`} to ${high}`
          : low !== undefined
            ? s.exclusiveMinimum !== undefined
              ? `more than ${low}`
              : `at least ${low}`
            : `at most ${high}`;
    }
    c.addEventListener("input", changed);
    return {
      el: c,
      get: () => {
        const t = c.value.trim();
        const n = Number(t);
        if (t === "" || !Number.isFinite(n)) {
          throw new FormError(`${where(label)} must be a number.`);
        }
        if (s.type === "integer" && !Number.isInteger(n)) {
          throw new FormError(`${where(label)} must be a whole number.`);
        }
        const tooLow =
          (s.minimum !== undefined && n < s.minimum) ||
          (s.exclusiveMinimum !== undefined && n <= s.exclusiveMinimum);
        const tooHigh =
          (s.maximum !== undefined && n > s.maximum) ||
          (s.exclusiveMaximum !== undefined && n >= s.exclusiveMaximum);
        if (tooLow || tooHigh) {
          throw new FormError(`${where(label)} must be ${c.title}.`);
        }
        return n;
      },
      inline: true,
    };
  };

  /** A field that may be left out (null, or missing from its object): a tick box shows it. */
  const optional = (
    s: JsonSchema,
    v: unknown,
    path: string[],
    label: string,
    absent: null | undefined,
  ): Built => {
    const wrap = document.createElement("div");
    wrap.className = "schema-form-optional";
    const box = lock(action(document.createElement("input"), `${opts.id}-set`));
    box.type = "checkbox";
    const has = v !== null && v !== undefined;
    box.checked = has;
    const tick = document.createElement("label");
    tick.className = "schema-form-set";
    tick.append(box, absent === undefined ? " Set" : " Has one");
    const holder = document.createElement("div");
    holder.className = "schema-form-optional-body";
    let inner: Built | null = has ? build(s, v, path, label) : null;
    const show = () => {
      holder.replaceChildren(...(inner ? [inner.el] : []));
      holder.hidden = !box.checked;
      wrap.classList.toggle("schema-form-optional-inline", inner?.inline === true);
    };
    box.addEventListener("change", () => {
      if (box.checked && !inner) {
        inner = build(s, blank(s), path, label);
      }
      show();
      changed();
    });
    show();
    wrap.append(tick, holder);
    return {
      el: wrap,
      get: () => (box.checked && inner ? inner.get() : absent),
      inline: false,
    };
  };

  /** A value with several shapes: pick the shape, then fill it. */
  const union = (vs: JsonSchema[], v: unknown, path: string[], label: string): Built => {
    const w = words.field(path);
    const wrap = document.createElement("div");
    wrap.className = "schema-form-union";
    const sel = lock(action(document.createElement("select"), `${opts.id}-shape`));
    vs.forEach((x, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = w.shapes?.[i] ?? shapeName(x);
      sel.append(o);
    });
    const at = Math.max(
      0,
      vs.findIndex((x) => fits(x, v)),
    );
    sel.value = String(at);
    const holder = document.createElement("div");
    holder.className = "schema-form-union-body";
    let inner = build(vs[at] ?? {}, fits(vs[at] ?? {}, v) ? v : blank(vs[at] ?? {}), path, label);
    holder.append(inner.el);
    sel.addEventListener("change", () => {
      const s = vs[Number(sel.value)] ?? {};
      inner = build(s, blank(s), path, label);
      holder.replaceChildren(inner.el);
      changed();
    });
    const pick = document.createElement("label");
    pick.className = "schema-form-shape";
    pick.append("Kind: ", sel);
    wrap.append(pick, holder);
    return { el: wrap, get: () => inner.get(), inline: false };
  };

  /** One labelled field of a group. */
  const fieldRow = (
    built: Built,
    label: string,
    help: string | undefined,
    tickLabel = false,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = built.inline ? "balance-field schema-form-field" : "schema-form-block";
    const id = nextId();
    const l = document.createElement(built.inline ? "label" : "div");
    l.className = built.inline ? "control-panel-field-label" : "schema-form-block-title";
    l.textContent = label;
    const control = built.el.matches("input, select, textarea") ? built.el : null;
    if (control && l instanceof HTMLLabelElement) {
      control.id = id;
      l.htmlFor = id;
    }
    if (tickLabel && control instanceof HTMLInputElement && control.type === "checkbox") {
      // A tick box reads best with its label beside it.
      row.className = "items-check schema-form-field schema-form-check";
      const t = document.createElement("label");
      t.htmlFor = id;
      t.textContent = label;
      row.append(control, t);
    } else {
      row.append(l, built.el);
    }
    if (help) {
      const h = document.createElement("p");
      h.className = "control-panel-field-help";
      h.textContent = help;
      row.append(h);
    }
    return row;
  };

  const object = (s: JsonSchema, v: unknown, path: string[]): Built => {
    const o =
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
    const box = document.createElement("div");
    box.className = "schema-form-object";
    /** One group of fields: the inline row, the blocks and the "More options" fold. */
    const bucket = () => {
      const inlineRow = document.createElement("div");
      inlineRow.className = "balance-fields schema-form-fields";
      const blocks = document.createElement("div");
      blocks.className = "schema-form-blocks";
      const more = document.createElement("details");
      more.className = "items-more schema-form-more";
      const moreSum = action(document.createElement("summary"), `${opts.id}-more`);
      moreSum.textContent = "More options";
      const moreInline = document.createElement("div");
      moreInline.className = "balance-fields schema-form-fields";
      more.append(moreSum, moreInline);
      return { inlineRow, blocks, more, moreInline, moreUsed: false };
    };
    type Bucket = ReturnType<typeof bucket>;
    const fill = (into: HTMLElement, b: Bucket) => {
      b.more.open = b.moreUsed;
      if (b.inlineRow.childElementCount > 0) {
        into.append(b.inlineRow);
      }
      if (b.blocks.childElementCount > 0) {
        into.append(b.blocks);
      }
      // The fold holds its summary and inline row: show it only with a field in it.
      if (b.more.childElementCount > 2 || b.moreInline.childElementCount > 0) {
        into.append(b.more);
      }
    };
    // Top-level fields may be grouped under tabs (`FieldWords.tab`), in the order first named.
    const tabs = new Map<string, Bucket>();
    const plain = bucket();
    const bucketOf = (fw: FieldWords): Bucket => {
      if (path.length > 0 || fw.tab === undefined) {
        return plain;
      }
      let b = tabs.get(fw.tab);
      if (!b) {
        b = bucket();
        tabs.set(fw.tab, b);
      }
      return b;
    };
    const getters: [string, () => unknown][] = [];
    const required = new Set(s.required ?? []);
    for (const [k, p] of Object.entries(s.properties ?? {})) {
      const fp = [...path, k];
      const fw = words.field(fp);
      const label = fw.label ?? humanize(k);
      if (fw.hidden || (p.const !== undefined && required.has(k))) {
        // Kept as it is: an internal value, or a constant that tells shapes apart.
        const keep = p.const !== undefined ? p.const : o[k];
        if (keep !== undefined || required.has(k)) {
          getters.push([k, () => (keep === undefined ? blank(p) : keep)]);
        }
        continue;
      }
      let built: Built;
      if (required.has(k)) {
        built = build(p, k in o ? o[k] : blank(p), fp, label);
      } else if (p.const !== undefined) {
        // A flag that is there or not (`hidden: true`): a tick box.
        const box = lock(action(document.createElement("input"), `${opts.id}-check`));
        box.type = "checkbox";
        box.checked = o[k] === p.const;
        box.addEventListener("change", changed);
        built = { el: box, get: () => (box.checked ? p.const : undefined), inline: true };
      } else {
        // Left out unless ticked; one that was there as "none" stays "none" when unticked.
        const { inner, nullable } = withoutNull(p);
        built = optional(inner, o[k], fp, label, nullable && o[k] === null ? null : undefined);
      }
      getters.push([k, built.get]);
      const row = fieldRow(built, label, fw.help, true);
      const b = bucketOf(fw);
      if (fw.more) {
        if (o[k] !== undefined && o[k] !== null && o[k] !== false) {
          b.moreUsed = true;
        }
        if (built.inline) {
          b.moreInline.append(row);
        } else {
          b.more.append(row);
        }
      } else if (built.inline) {
        b.inlineRow.append(row);
      } else {
        b.blocks.append(row);
      }
    }
    fill(box, plain);
    if (tabs.size > 0) {
      const strip = document.createElement("div");
      strip.className = "control-panel-tabs schema-form-tabs";
      strip.setAttribute("role", "tablist");
      strip.setAttribute("aria-label", "Sections");
      const panes: HTMLElement[] = [];
      const buttons: HTMLButtonElement[] = [];
      const pick = (i: number) => {
        panes.forEach((pane, j) => {
          pane.hidden = j !== i;
        });
        buttons.forEach((btn, j) => {
          btn.setAttribute("aria-selected", String(j === i));
        });
      };
      for (const [label, b] of tabs) {
        const i = panes.length;
        const pane = document.createElement("div");
        pane.className = "schema-form-tab";
        pane.setAttribute("role", "tabpanel");
        pane.setAttribute("aria-label", label);
        fill(pane, b);
        const btn = action(document.createElement("button"), `${opts.id}-tab`);
        btn.type = "button";
        btn.className = "control-panel-tab";
        btn.setAttribute("role", "tab");
        btn.dataset.tab = label;
        btn.textContent = label;
        btn.addEventListener("click", () => pick(i));
        panes.push(pane);
        buttons.push(btn);
      }
      strip.append(...buttons);
      box.append(strip, ...panes);
      pick(0);
    }
    return {
      el: box,
      get: () => {
        const out: Record<string, unknown> = {};
        for (const [k, g] of getters) {
          const x = g();
          if (x !== undefined) {
            out[k] = x;
          }
        }
        return out;
      },
      inline: false,
    };
  };

  /** A list: each entry a row (a value) or a card (a group of fields), added, moved and removed. */
  const list = (
    item: JsonSchema,
    v: unknown,
    path: string[],
    label: string,
    w: FieldWords,
    s: JsonSchema,
  ): Built => {
    const fp = [...path, "[]"];
    const arr = Array.isArray(v) ? v : [];
    const box = document.createElement("div");
    box.className = "schema-form-list";
    const rows = document.createElement("div");
    rows.className = "schema-form-list-rows";
    const empty = document.createElement("p");
    empty.className = "schema-form-empty";
    empty.textContent = "None yet.";
    const plain = !withoutNull(item).inner.properties && !variantsOf(withoutNull(item).inner);
    const entries: { el: HTMLElement; built: Built }[] = [];
    const noun = w.noun ?? "entry";
    const redraw = () => {
      rows.replaceChildren(...entries.map((e) => e.el));
      empty.hidden = entries.length > 0;
      entries.forEach((e, i) => {
        const up = e.el.querySelector<HTMLButtonElement>(":scope > * [data-move='up']");
        const down = e.el.querySelector<HTMLButtonElement>(":scope > * [data-move='down']");
        if (up) {
          up.disabled = i === 0 || opts.readOnly === true;
        }
        if (down) {
          down.disabled = i === entries.length - 1 || opts.readOnly === true;
        }
        const title = e.el.querySelector<HTMLElement>(":scope > summary .schema-form-entry-title");
        if (title) {
          let now: unknown;
          try {
            now = e.built.get();
          } catch {
            now = null;
          }
          title.textContent = entryTitle(now, i);
        }
      });
      add.disabled =
        opts.readOnly === true || (s.maxItems !== undefined && entries.length >= s.maxItems);
    };
    const tools = (entry: { el: HTMLElement; built: Built }) => {
      const t = document.createElement("span");
      t.className = "schema-form-entry-tools";
      const mk = (text: string, aria: string, move: string, run: () => void) => {
        // An entry's Remove is `-remove-entry`, never the page's own `-remove` (a class's Remove,
        // issue #15): one action, one control.
        const b = action(
          document.createElement("button"),
          `${opts.id}-${move === "remove" ? "remove-entry" : move}`,
        );
        b.type = "button";
        b.className = "control-panel-btn control-panel-btn-plain schema-form-mini";
        b.textContent = text;
        b.setAttribute("aria-label", aria);
        b.dataset.move = move;
        b.disabled = opts.readOnly === true;
        b.addEventListener("click", (e) => {
          e.preventDefault();
          run();
          redraw();
          changed();
        });
        return b;
      };
      const at = () => entries.indexOf(entry);
      t.append(
        mk("↑", "Move up", "up", () => {
          const i = at();
          if (i > 0) {
            entries.splice(i - 1, 0, ...entries.splice(i, 1));
          }
        }),
        mk("↓", "Move down", "down", () => {
          const i = at();
          if (i < entries.length - 1) {
            entries.splice(i + 1, 0, ...entries.splice(i, 1));
          }
        }),
        mk("Remove", `Remove this ${noun}`, "remove", () => {
          entries.splice(at(), 1);
        }),
      );
      return t;
    };
    const make = (x: unknown, open: boolean) => {
      const built = build(item, x, fp, `${label} ${noun}`);
      let el: HTMLElement;
      const entry: { el: HTMLElement; built: Built } = { el: document.createElement("div"), built };
      if (plain) {
        el = document.createElement("div");
        el.className = "schema-form-list-row";
        el.append(built.el, tools(entry));
      } else {
        const d = document.createElement("details");
        d.className = "schema-form-entry";
        d.open = open;
        const sum = action(document.createElement("summary"), `${opts.id}-entry`);
        const title = document.createElement("span");
        title.className = "schema-form-entry-title";
        sum.append(title, tools(entry));
        d.append(sum, built.el);
        // The header follows the entry's name as it is typed.
        built.el.addEventListener("input", () => {
          let now: unknown;
          try {
            now = built.get();
          } catch {
            now = null;
          }
          title.textContent = entryTitle(now, entries.indexOf(entry));
        });
        el = d;
      }
      entry.el = el;
      return entry;
    };
    for (const x of arr) {
      entries.push(make(x, arr.length <= 2));
    }
    const add = action(document.createElement("button"), `${opts.id}-add`);
    add.type = "button";
    add.className = "control-panel-btn control-panel-btn-plain schema-form-add";
    add.textContent = `+ Add ${noun}`;
    add.addEventListener("click", () => {
      entries.push(make(blank(item), true));
      redraw();
      changed();
      entries.at(-1)?.el.querySelector<HTMLElement>("input, select, textarea")?.focus();
    });
    box.append(rows, empty, add);
    redraw();
    return {
      el: box,
      get: () => {
        if (s.minItems !== undefined && entries.length < s.minItems) {
          throw new FormError(
            `${label} needs at least ${s.minItems} ${s.minItems === 1 ? noun : `${noun}s`}.`,
          );
        }
        return entries.map((e) => e.built.get());
      },
      inline: false,
    };
  };

  /** A fixed set of values (a slot machine's three faces). */
  const tuple = (items: JsonSchema[], v: unknown, path: string[], label: string): Built => {
    const arr = Array.isArray(v) ? v : [];
    const box = document.createElement("div");
    box.className = "balance-fields schema-form-tuple";
    const parts = items.map((s, i) => {
      const b = build(
        s,
        i < arr.length ? arr[i] : blank(s),
        [...path, String(i)],
        `${label} ${i + 1}`,
      );
      const tw = words.field([...path, String(i)]);
      box.append(fieldRow(b, tw.label ?? `${i + 1}`, tw.help));
      return b;
    });
    return { el: box, get: () => parts.map((p) => p.get()), inline: false };
  };

  /** Named values: a name and its value per row (a card's points by its face). */
  const record = (
    s: JsonSchema,
    v: unknown,
    path: string[],
    label: string,
    w: FieldWords,
  ): Built => {
    const valueSchema = typeof s.additionalProperties === "object" ? s.additionalProperties : {};
    const o =
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
    const box = document.createElement("div");
    box.className = "schema-form-list";
    const rows = document.createElement("div");
    const entries: { el: HTMLElement; key: HTMLInputElement | HTMLSelectElement; built: Built }[] =
      [];
    const keyNames = s.propertyNames?.enum?.map(String);
    const keyWords = words.field([...path, "{}"]);
    const make = (k: string, x: unknown) => {
      const row = document.createElement("div");
      row.className = "schema-form-list-row";
      let key: HTMLInputElement | HTMLSelectElement;
      if (keyNames) {
        // A fixed set of names: pick one.
        const sel = lock(action(document.createElement("select"), `${opts.id}-name`));
        for (const n of keyNames) {
          const o = document.createElement("option");
          o.value = n;
          o.textContent = keyWords.choices?.[n] ?? w.choices?.[n] ?? humanize(n);
          sel.append(o);
        }
        sel.value = keyNames.includes(k) ? k : (keyNames[0] ?? "");
        sel.addEventListener("change", changed);
        key = sel;
      } else {
        const input = lock(noAutofill(action(document.createElement("input"), `${opts.id}-name`)));
        input.type = "text";
        input.value = k;
        input.placeholder = "Name";
        input.addEventListener("input", changed);
        if (w.names) {
          const l = namesList(w.names);
          if (l) {
            input.setAttribute("list", l);
          }
        }
        key = input;
      }
      key.setAttribute("aria-label", `${label}: name`);
      const built = build(valueSchema, x, [...path, "{}"], `${label} ${k}`);
      const rm = action(document.createElement("button"), `${opts.id}-remove-entry`);
      rm.type = "button";
      rm.className = "control-panel-btn control-panel-btn-plain schema-form-mini";
      rm.textContent = "Remove";
      rm.disabled = opts.readOnly === true;
      const entry = { el: row, key, built };
      rm.addEventListener("click", () => {
        entries.splice(entries.indexOf(entry), 1);
        rows.replaceChildren(...entries.map((e) => e.el));
        changed();
      });
      row.append(key, built.el, rm);
      return entry;
    };
    for (const [k, x] of Object.entries(o)) {
      entries.push(make(k, x));
    }
    rows.replaceChildren(...entries.map((e) => e.el));
    const add = action(document.createElement("button"), `${opts.id}-add`);
    add.type = "button";
    add.className = "control-panel-btn control-panel-btn-plain schema-form-add";
    add.textContent = `+ Add ${w.noun ?? "a name"}`;
    add.disabled = opts.readOnly === true;
    add.addEventListener("click", () => {
      entries.push(make("", blank(valueSchema)));
      rows.replaceChildren(...entries.map((e) => e.el));
      changed();
      entries.at(-1)?.key.focus();
    });
    box.append(rows, add);
    return {
      el: box,
      get: () => {
        const out: Record<string, unknown> = {};
        for (const e of entries) {
          const k = e.key.value.trim();
          if (k === "") {
            throw new FormError(`${label}: every row needs a name.`);
          }
          if (keyNames && !keyNames.includes(k)) {
            throw new FormError(`${label}: "${k}" is not one of ${keyNames.join(", ")}.`);
          }
          if (k in out) {
            throw new FormError(`${label}: "${k}" is listed twice.`);
          }
          out[k] = e.built.get();
        }
        return out;
      },
      inline: false,
    };
  };

  /** A value of no fixed shape (none of the content has one; kept as it is). */
  const anyValue = (v: unknown, _label: string): Built => {
    const el = document.createElement("span");
    el.className = "schema-form-kept";
    el.textContent = "Kept as it is.";
    return { el, get: () => v, inline: true };
  };

  const root = build(schema, value, [], "This");
  const el = document.createElement("div");
  el.className = "schema-form";
  el.append(lists, root.el);
  return { el, value: () => root.get() };
}
