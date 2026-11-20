/**
 * The Server Settings window's Roles and Staff pages (issue #7): an SSO panel, as the rest of the
 * window. The server keeps the roles and checks every change; these pages only edit and send.
 *
 * - Roles: pick a role, or New role, and edit its display name (the chat tag), rank and
 *   permissions, grouped as commands, tools and exemptions. Save sends the role; Delete leaves its
 *   accounts with no role. Like a settings page, unsaved edits ask before they are dropped.
 * - Staff: every account with a role, each with a role picker that applies at once, and a line to
 *   give a character's account a role. An account with no role is an ordinary player.
 */
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  type Permission,
  permissionInfo,
  type RoleData,
  type RoleRow,
  roleDataError,
  rolesError,
  type StaffRow,
} from "@secondstaronline/shared";

import { action, gameInput } from "./action.ts";

export interface RoleActions {
  /** Roles page → Save: a new role (`create`) or a change to one. */
  saveRole(role: RoleData, create: boolean): void;
  /** Roles page → Delete. */
  deleteRole(id: string): void;
  /** Staff page: a character's account gets a role, or none (`null`). */
  assignRole(name: string, role: string | null): void;
}

/** A page with its own editor: drawn from the server's lists, saved by the window's Save. */
export interface CustomPage {
  el: HTMLElement;
  /** Draws the server's lists, keeping the picked role when it still exists. */
  show(roles: readonly RoleRow[], staff: readonly StaffRow[]): void;
  /** How many unsaved edits the page holds (0 or 1). */
  changes(): number;
  /** The window's Save: checks and sends, or returns why not. Null for a page with no Save. */
  save: (() => string | null) | null;
}

/** The New role entry of the role picker. */
const NEW = "";

const button = (id: string, cls: string, label: string, onClick: () => void) => {
  const b = action(document.createElement("button"), id);
  b.type = "button";
  b.className = `settings-btn ${cls}`;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
};

const field = (labelText: string, control: HTMLElement) => {
  const row = document.createElement("label");
  row.className = "roles-field";
  const name = document.createElement("span");
  name.className = "roles-field-label";
  name.textContent = labelText;
  row.append(name, control);
  return row;
};

const roleOption = (r: RoleRow) => {
  const o = document.createElement("option");
  o.value = r.id;
  o.textContent = `${r.name} (${r.id}), rank ${r.rank}`;
  return o;
};

/**
 * `onChange`: the edits changed (the window recounts them). `guard`: runs `go` now, or after the
 * operator agrees to drop the unsaved edits (the window's own question).
 */
export function createRolesPage(
  actions: RoleActions,
  onChange: () => void,
  guard: (go: () => void) => void,
): CustomPage {
  const el = document.createElement("div");
  el.className = "roles";

  const picker = action(document.createElement("select"), "roles-pick");
  picker.className = "roles-pick";
  picker.setAttribute("aria-label", "Role");
  const del = button("roles-delete", "roles-delete", "Delete role", () => {
    const r = roles.find((x) => x.id === picker.value);
    if (r) {
      actions.deleteRole(r.id);
    }
  });
  const top = document.createElement("div");
  top.className = "roles-top";
  top.append(picker, del);

  const id = gameInput("roles-id");
  id.className = "roles-id";
  id.spellcheck = false;
  id.placeholder = "e.g. helper";
  const name = gameInput("roles-name");
  name.className = "roles-name";
  name.spellcheck = false;
  const rank = gameInput("roles-rank");
  rank.type = "number";
  rank.className = "roles-rank";
  rank.min = "1";
  rank.step = "1";
  const fields = document.createElement("div");
  fields.className = "roles-fields";
  fields.append(field("Id", id), field("Name (chat tag)", name), field("Rank", rank));
  const help = document.createElement("p");
  help.className = "settings-help";
  help.textContent =
    "Staff act only on those of lower rank, unless their role can overrule. Any role makes an account staff: it reads and posts staff chat and can be sent IMs by jailed and muted players.";
  const holders = document.createElement("p");
  holders.className = "settings-help roles-holders";

  const boxes = new Map<Permission, HTMLInputElement>();
  const groups = PERMISSION_GROUPS.map((g) => {
    const set = document.createElement("fieldset");
    set.className = "roles-group";
    const legend = document.createElement("legend");
    legend.textContent = g.title;
    const list = document.createElement("div");
    list.className = "roles-perms";
    for (const p of PERMISSIONS) {
      const info = permissionInfo(p);
      if (info.group !== g.id) {
        continue;
      }
      const box = gameInput("roles-permission");
      box.type = "checkbox";
      box.className = "settings-check";
      box.dataset.permission = p;
      const label = document.createElement("label");
      label.className = "roles-perm";
      const text = document.createElement("span");
      text.textContent = info.label;
      label.append(box, text);
      list.append(label);
      boxes.set(p, box);
    }
    set.append(legend, list);
    return set;
  });
  el.append(top, fields, help, holders, ...groups);

  let roles: RoleRow[] = [];
  /** The role as the server holds it, or a blank one for New role. */
  let base: RoleData = { id: "", name: "", rank: 1, permissions: [] };

  const read = (): RoleData => ({
    id: id.value.trim(),
    name: name.value.trim(),
    rank: rank.value.trim() === "" ? Number.NaN : Number(rank.value),
    permissions: PERMISSIONS.filter((p) => boxes.get(p)?.checked),
  });
  const same = (a: RoleData, b: RoleData) => JSON.stringify(a) === JSON.stringify(b);

  const fill = (r: RoleData) => {
    // Only the fields the form edits (a `RoleRow` also carries its holders).
    base = {
      id: r.id,
      name: r.name,
      rank: r.rank,
      permissions: PERMISSIONS.filter((p) => r.permissions.includes(p)),
    };
    id.value = r.id;
    name.value = r.name;
    rank.value = String(r.rank);
    for (const [p, box] of boxes) {
      box.checked = r.permissions.includes(p);
    }
  };

  const pick = (roleId: string) => {
    picker.value = roleId;
    const r = roles.find((x) => x.id === roleId);
    const creating = !r;
    id.readOnly = !creating;
    del.hidden = creating;
    if (r) {
      fill(r);
      holders.textContent =
        r.holders === 0
          ? "No account holds this role."
          : `${r.holders} ${r.holders === 1 ? "account holds" : "accounts hold"} this role (see Staff).`;
    } else {
      fill({ id: "", name: "", rank: 1, permissions: [] });
      holders.textContent = "A new role. Give it to an account on the Staff page once it is saved.";
    }
    onChange();
  };

  picker.addEventListener("change", () => {
    // Switching roles drops the edits, so it asks first as leaving a page does.
    const next = picker.value;
    picker.value = base.id;
    guard(() => pick(next));
  });
  for (const c of [id, name, rank, ...boxes.values()]) {
    c.addEventListener("input", onChange);
    c.addEventListener("change", onChange);
  }

  return {
    el,
    show(next) {
      const keep = picker.value;
      roles = [...next];
      const fresh = document.createElement("option");
      fresh.value = NEW;
      fresh.textContent = "New role…";
      picker.replaceChildren(...roles.map(roleOption), fresh);
      // Stay on the role being edited (a new one is picked once saved, by its id).
      const want = id.value.trim();
      pick(
        roles.some((r) => r.id === want)
          ? want
          : roles.some((r) => r.id === keep)
            ? keep
            : (roles[0]?.id ?? NEW),
      );
    },
    changes: () => (same(read(), base) ? 0 : 1),
    save() {
      const r = read();
      const create = !roles.some((x) => x.id === base.id);
      const bad =
        roleDataError(r) ??
        rolesError(
          roles
            .filter((x) => x.id !== r.id)
            .map((x) => ({ permissions: new Set(x.permissions) }))
            .concat({ permissions: new Set(r.permissions) }),
        );
      if (bad) {
        return bad;
      }
      actions.saveRole(r, create);
      return null;
    },
  };
}

export function createStaffPage(actions: RoleActions): CustomPage {
  const el = document.createElement("div");
  el.className = "roles";

  const list = document.createElement("div");
  list.className = "staff-list";
  list.setAttribute("role", "list");

  const who = gameInput("staff-name");
  who.className = "staff-name";
  who.placeholder = "Character name";
  who.spellcheck = false;
  who.setAttribute("aria-label", "Character name");
  const giveRole = action(document.createElement("select"), "staff-role");
  giveRole.setAttribute("aria-label", "Role to give");
  const give = button("staff-assign", "settings-save", "Give role", () => {
    if (who.value.trim() !== "" && giveRole.value !== "") {
      actions.assignRole(who.value.trim(), giveRole.value);
    }
  });
  who.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      give.click();
    }
  });
  const add = document.createElement("div");
  add.className = "staff-add";
  add.append(who, giveRole, give);
  const help = document.createElement("p");
  help.className = "settings-help";
  help.textContent =
    "A role belongs to the account, whichever character it plays. Changes apply at once, also to anyone online. You cannot change your own role; the server's command line can (bun run admin:role).";
  el.append(add, help, list);

  return {
    el,
    show(roles, staff) {
      giveRole.replaceChildren(...roles.map(roleOption));
      const rows = staff.map((s) => {
        const row = document.createElement("div");
        row.className = "staff-row";
        row.setAttribute("role", "listitem");
        const label = document.createElement("span");
        label.className = "staff-row-name";
        label.textContent = s.name;
        const sel = action(document.createElement("select"), "staff-row-role");
        sel.setAttribute("aria-label", `${s.name}'s role`);
        const none = document.createElement("option");
        none.value = NEW;
        none.textContent = "No role (player)";
        sel.append(...roles.map(roleOption), none);
        sel.value = s.role;
        sel.addEventListener("change", () => {
          const picked = sel.value;
          // The picker shows what the server holds: an applied change redraws the page, and a
          // refused one (your own role) leaves it as it was.
          sel.value = s.role;
          actions.assignRole(s.name, picked === NEW ? null : picked);
        });
        row.append(label, sel);
        return row;
      });
      if (rows.length === 0) {
        const empty = document.createElement("p");
        empty.className = "settings-none";
        empty.textContent = "No account has a role.";
        list.replaceChildren(empty);
      } else {
        list.replaceChildren(...rows);
      }
      who.value = "";
    },
    changes: () => 0,
    save: null,
  };
}
