/* Journey Ledger — generic helpers.
 *
 * REPRODUCE AS-IS (DESIGN.md §7.1) — pure / near-pure utilities lifted from
 * the macro with no behavioral changes. */

const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** HTML-escape a value for safe inclusion in interpolated strings. */
export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => HTML_ESC[c]);

/** Stable-ish id generator for milestones and mutations. Prefers Foundry's
 *  built-in helper when available. */
export function genMilestoneId() {
  try { return foundry?.utils?.randomID?.() ?? null; }
  catch { /* fall through */ }
  return "ms-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/** PC roster — returns `{ id, name, ownerName }` for every character actor,
 *  sorted by name. `ownerName` is the first active non-GM owner's display
 *  name, or "—". */
export function allPCs() {
  const activePlayers = game.users.filter((u) => u.active && !u.isGM);
  const out = [];
  for (const actor of game.actors) {
    if (actor.type !== "character") continue;
    let ownerName = "—";
    for (const user of activePlayers) {
      if (actor.testUserPermission(user, "OWNER")) {
        ownerName = user.name;
        break;
      }
    }
    out.push({ id: actor.id, name: actor.name, ownerName });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Quick actor-name lookup with a "?" fallback for the rare orphan id. */
export function actorNameSafe(id) {
  return game.actors.get(id)?.name ?? "?";
}
