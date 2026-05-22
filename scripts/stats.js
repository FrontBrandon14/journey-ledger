/* Journey Ledger — per-PC state statistics.
 *
 * REPRODUCE AS-IS (DESIGN.md §7.1). These are pure functions over the shared
 * state — they read assignment lists and tally tags. With the roll engine
 * removed, the counts they produce are display-only (roster chips, day
 * recap), no longer feeding any automation. */

import { TRAVEL_ACTIVITIES, EVENING_ACTIVITIES } from "./constants.js";

/**
 * Single-pass per-PC daily stats: counts Épuisante and Distrayante
 * assignments across the 3 active phases (étape 1, étape 2, soir).
 * Returns a Map keyed by actorId → { epuisanteCount, distrayanteCount }.
 */
export function computePCDailyStats(state) {
  const stats = new Map();
  const phases = [
    ["etape1", TRAVEL_ACTIVITIES],
    ["etape2", TRAVEL_ACTIVITIES],
    ["soir",   EVENING_ACTIVITIES],
  ];
  for (const [phaseKey, list] of phases) {
    const asg = state?.[phaseKey]?.assignments;
    if (!asg) continue;
    for (const a of list) {
      const arr = asg[a.key];
      if (!arr || !arr.length) continue;
      const tags = a.tags || [];
      const epui = tags.includes("epuisante");
      const dist = tags.includes("distrayante");
      if (!epui && !dist) continue;
      for (const x of arr) {
        let s = stats.get(x.actorId);
        if (!s) { s = { epuisanteCount: 0, distrayanteCount: 0 }; stats.set(x.actorId, s); }
        if (epui) s.epuisanteCount++;
        if (dist) s.distrayanteCount++;
      }
    }
  }
  return stats;
}

/** Running Distrayante count and cumulative -5 Perception malus for a PC.
 *  Display-only — no longer auto-applied to rolls. */
export function distrayanteMalus(state, actorId) {
  let count = 0;
  const visit = (phaseKey, list) => {
    for (const a of list || []) {
      if ((state?.[phaseKey]?.assignments?.[a.key] || []).some((x) => x.actorId === actorId)) {
        if ((a.tags || []).includes("distrayante")) count++;
      }
    }
  };
  visit("etape1", TRAVEL_ACTIVITIES);
  visit("etape2", TRAVEL_ACTIVITIES);
  visit("soir",   EVENING_ACTIVITIES);
  return { count, penalty: count * 5 };
}

/** True if any PC is assigned to `eclaireur` on the given leg. Used for the
 *  Éclaireur info banner — informational only, no auto-bonus. */
export function isEclaireurActive(state, legKey) {
  return ((state?.[legKey]?.assignments?.eclaireur) || []).length > 0;
}

/* ---------------------------------------------------------------------------
 * Per-PC long-rest math (deferred-#10b)
 *
 * Night is fixed at 10 h. Each watch shift a PC is assigned to costs them
 * exactly 2 h of sleep regardless of the shift's label text. Required is
 * a per-PC value (default 8 if absent from state.restRequirements; an
 * explicit `null` means the PC doesn't need to sleep at all).
 * ------------------------------------------------------------------------ */

const NIGHT_HOURS = 10;
const SHIFT_COST_HOURS = 2;
/** Initial value when a PC is first added to the rest-tracking list via
 *  the "+ ajouter un personnage" picker. Not a fallback for absent PCs —
 *  absent means "not tracked", which getRestRequirement signals with
 *  `undefined` (not 8). */
export const DEFAULT_REQUIRED_HOURS = 8;

/** Required rest hours for a PC. Returns:
 *    - a finite non-negative number — tracked, needs that many hours
 *    - `null` — tracked, no sleep needed
 *    - `undefined` — NOT tracked (no entry in state.restRequirements)
 *
 *  Opt-in semantics: the rest list is empty by default. PCs only appear
 *  once the user explicitly adds them. */
export function getRestRequirement(state, actorId) {
  const map = state?.restRequirements;
  if (!map || typeof map !== "object") return undefined;
  if (!(actorId in map)) return undefined;
  const v = map[actorId];
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  return undefined; // malformed value → treat as not tracked
}

/** Available sleep hours this night for a PC, given how many watch shifts
 *  they're on. Clamped to 0 so 6+ shifts doesn't go negative. */
export function getAvailableSleep(state, actorId) {
  const watch = state?.nuit?.watch || [];
  let shifts = 0;
  for (const w of watch) {
    if ((w.actorIds || []).includes(actorId)) shifts++;
  }
  return Math.max(0, NIGHT_HOURS - SHIFT_COST_HOURS * shifts);
}

/** Combined status:
 *    { tracked: boolean, available, required, sufficient }
 *  An untracked PC (no entry in restRequirements) has tracked=false,
 *  available=null, required=null, sufficient=true. Callers should check
 *  `tracked` first to decide whether to render warnings / recap entries. */
export function getRestStatus(state, actorId) {
  const required = getRestRequirement(state, actorId);
  if (required === undefined) {
    return { tracked: false, available: null, required: null, sufficient: true };
  }
  const available = getAvailableSleep(state, actorId);
  const sufficient = (required === null) || (available >= required);
  return { tracked: true, available, required, sufficient };
}
