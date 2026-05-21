/* Journey Ledger — camp property derivation rules.
 *
 * Phase 2.2 #9c smart panel. Pure function over (checkResult, d6) → the
 * derived property count, improvement count, and ordered selection. Lives
 * in its own file because it's a piece of game-rules data orthogonal to
 * everything else: state.js owns the schema, mutations.js applies, and
 * app.js renders the preview — they all consume this single source of truth.
 *
 * Threshold table (interpretation of the FR rules text):
 *   <  10 : 0 properties
 *   ≥ 10 : 1 property
 *   ≥ 15 : 2 properties
 *   ≥ 20 : 3 properties (all)
 *   ≥ 25 : 3 + 1 improved
 *   ≥ 30 : 3 + 2 improved
 *
 * d6 → first property (the FR rule text):
 *   1-2 → confortable first
 *   3-4 → defendable first
 *   5-6 → cache first
 * Remaining two follow canonical order (confortable < defendable < cache),
 * skipping the first. Improvement positions are the FIRST N in this order
 * (N = improvedCount), so a d6 of 3 with result ≥ 30 produces
 *   defendableImproved + confortableImproved + cache. */

const CANONICAL_ORDER = ["confortable", "defendable", "cache"];

function firstFromD6(d6) {
  if (d6 >= 1 && d6 <= 2) return "confortable";
  if (d6 >= 3 && d6 <= 4) return "defendable";
  if (d6 >= 5 && d6 <= 6) return "cache";
  return null;
}

/** Derive the camp's auto-properties from a check result and a d6 roll.
 *
 *  Returns:
 *    - count          : 0..3 — how many properties the result earned
 *    - improvedCount  : 0..2 — how many of those are improved
 *    - order          : 0..3 keys in d6-rotated order, or [] if d6 absent
 *    - selected       : 0..count entries `{ key, improved }` ready to apply */
export function deriveCampProperties(checkResult, d6) {
  const r = Number(checkResult);
  let count = 0, improvedCount = 0;
  if (Number.isFinite(r)) {
    if      (r >= 30) { count = 3; improvedCount = 2; }
    else if (r >= 25) { count = 3; improvedCount = 1; }
    else if (r >= 20) { count = 3; improvedCount = 0; }
    else if (r >= 15) { count = 2; improvedCount = 0; }
    else if (r >= 10) { count = 1; improvedCount = 0; }
    // r < 10 → 0
  }

  const first = firstFromD6(Number(d6));
  const order = first ? [first, ...CANONICAL_ORDER.filter((k) => k !== first)] : [];

  const selected = order.slice(0, count).map((key, idx) => ({
    key,
    improved: idx < improvedCount,
  }));

  return { count, improvedCount, order, selected };
}

/** Quality keys the smart panel may overwrite. `trapped` is intentionally
 *  excluded — it's set by the "Installer des pièges" evening activity, not
 *  by the camp finder. */
export const FINDER_QUALITY_KEYS = Object.freeze([
  "confortable", "confortableImproved",
  "defendable",  "defendableImproved",
  "cache",       "cacheImproved",
]);

/** Pretty FR label for a finder quality key (with the improvement marker
 *  added for the "Improved" variants). Used by the preview line. */
const LABEL_FR = {
  confortable: "Confortable",
  defendable:  "Défendable",
  cache:       "Caché",
};
export function finderQualityLabel(key, improved) {
  const base = LABEL_FR[key] ?? key;
  return improved ? `${base} amélioré` : base;
}
