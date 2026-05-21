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
