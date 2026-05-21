/* Journey Ledger — state shape + default builder.
 *
 * REBUILD (DESIGN.md §7.2) — slimmer than the macro per §3:
 *   - No `published` flag on étape state (no per-phase auto-advance)
 *   - No `skillOverride` field on assignments (no skill-picker dropdown)
 *   - No `camp.finderRollNotes` (no camp-finder rolls)
 *   - No `migrateTripShape` (start-clean policy per §0)
 *
 * The surviving field shape exactly matches the macro, so the §7.1 pure
 * helpers (tripMetrics, fmtNum, distrayanteMalus, computePCDailyStats, …)
 * read this state without modification. */

import { QUALITIES, DEFAULT_SHIFTS } from "./constants.js";

export const SCHEMA_VERSION = "1.0.0";

/** Build a fresh, empty state matching §3's schema. Called on a cold install,
 *  on "Nouveau jour" (with trip preserved via createNewDayPreservingTrip),
 *  and as the default value for the world Setting. */
export function createDefaultState() {
  const emptyPhase = () => ({ assignments: {} });
  return {
    version: SCHEMA_VERSION,
    createdAt: Date.now(),
    lastUpdatedAt: 0,
    lastUpdatedBy: null,

    dayName: "",

    // Cross-day trip tracker (preserved across "Nouveau jour"). Per-leg
    // model: each milestones[] entry stores hoursLeg/milesLeg from the
    // previous waypoint. Départ and Destination are synthesized at render
    // time from startNote / endNote + the cumulative sum of legs.
    trip: {
      startNote: "",
      endNote:   "",
      milestones: [],
      elapsedHours: 0,
    },

    reveil:   emptyPhase(),
    petitDej: emptyPhase(),
    etape1:   emptyPhase(),
    midi:     emptyPhase(),
    etape2:   emptyPhase(),
    camp: {
      ...emptyPhase(),
      qualities: Object.fromEntries(QUALITIES.map((q) => [q.key, false])),
      defendableDC: "",
      cacheDC: "",
      traps: [],
      // Phase 2.2 #9c — smart-panel state. `result` is the user's check
      // total ("" until entered); `d6` is the rolled property-order die
      // (0 = not rolled). When BOTH are set, applyCampDerivation in
      // mutations.js overwrites the three finder qualities + their
      // Improved variants. Manual qualities toggles persist until either
      // field changes again. `trapped` is never touched by the derivation.
      smartCheck: { result: "", d6: 0 },
    },
    soir: emptyPhase(),
    nuit: {
      ...emptyPhase(),
      watch: DEFAULT_SHIFTS.map((s) => ({ shift: s, actorIds: [] })),
    },
  };
}

/** Build a fresh day-state but preserve the cross-day trip progress. The
 *  trip is shallow-cloned + field-normalized so the new state's trip is
 *  independent of the previous one. */
export function createNewDayPreservingTrip(prevTrip) {
  const fresh = createDefaultState();
  if (prevTrip && typeof prevTrip === "object") {
    const ms = Array.isArray(prevTrip.milestones)
      ? prevTrip.milestones.map((m) => ({
          id: m.id ?? null,
          label: String(m.label ?? ""),
          icon: String(m.icon ?? ""),
          hoursLeg: Math.max(0, Number(m.hoursLeg) || 0),
          milesLeg: Math.max(0, Number(m.milesLeg) || 0),
          note: String(m.note ?? ""),
          reachedAt: m.reachedAt ?? null,
        }))
      : [];
    fresh.trip = {
      startNote: typeof prevTrip.startNote === "string" ? prevTrip.startNote : "",
      endNote:   typeof prevTrip.endNote   === "string" ? prevTrip.endNote   : "",
      milestones: ms,
      elapsedHours: Math.max(0, Number(prevTrip.elapsedHours) || 0),
    };
  }
  return fresh;
}

/** Field-fill a loaded snapshot so partial / older state objects work. Foundry
 *  may hand us anything that was previously written to the setting, including
 *  empty {} from a fresh world; mergeObject with the default tree fills all
 *  missing fields. */
export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return createDefaultState();
  // foundry.utils.mergeObject deep-merges into a new object. Default tree
  // first, then overlay the raw — raw's leaf values win for shared keys.
  return foundry.utils.mergeObject(createDefaultState(), raw, { inplace: false });
}
