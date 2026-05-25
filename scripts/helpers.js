/* Journey Ledger — generic helpers.
 *
 * REPRODUCE AS-IS (DESIGN.md §7.1) — pure / near-pure utilities lifted
 * from the macro with no behavioral changes, plus v1.1.0 additions for
 * the GM-managed participant list. */

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

/** Actor types that may be journey participants. Anything outside this set
 *  is filtered out of the dialog's add picker so we don't accidentally let
 *  the GM add a Group, an Item-Pile actor, etc. */
const PARTICIPANT_ACTOR_TYPES = new Set(["character", "npc", "vehicle"]);

/** Journey participants — the GM-managed list resolved against game.actors.
 *  Returns `{ id, name, type }[]`, sorted by name. Skips any actor id that
 *  no longer corresponds to an existing actor (e.g. actor was deleted
 *  after being added). Deduplicates if the stored list has accidental
 *  duplicates.
 *
 *  This is the v1.1.0 replacement for `allPCs()` — every UI surface that
 *  needs "the people on this journey" reads from here. NPCs and Vehicles
 *  appear alongside PCs once the GM adds them via the Participants dialog. */
export function getParticipants(state) {
  const ids = Array.isArray(state?.participants) ? state.participants : [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const actor = game.actors?.get?.(id);
    if (!actor) continue; // stale id — actor was deleted; silently skip
    out.push({ id: actor.id, name: actor.name, type: actor.type });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Every actor that *could* be added to the journey — PC, NPC, Vehicle.
 *  Used by the Participants dialog to populate the checkbox groups. The
 *  GM sees the union of every actor of these types regardless of
 *  ownership; players never call this (the dialog is GM-only). */
export function allCandidateActors() {
  const out = [];
  try {
    for (const actor of (game?.actors ?? [])) {
      if (!PARTICIPANT_ACTOR_TYPES.has(actor.type)) continue;
      out.push({ id: actor.id, name: actor.name, type: actor.type });
    }
  } catch { /* game.actors not ready */ }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** FR display label for an actor type. Used by the Participants dialog
 *  and any UI that wants to show what kind of actor a participant is. */
export function actorTypeLabel(type) {
  switch (type) {
    case "character": return "PJ";
    case "npc":       return "PNJ";
    case "vehicle":   return "Véhicule";
    default:          return type ?? "?";
  }
}

/** Quick actor-name lookup with a "?" fallback for the rare orphan id. */
export function actorNameSafe(id) {
  return game.actors.get(id)?.name ?? "?";
}
