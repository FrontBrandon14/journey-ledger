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
 *  on "Nouveau jour" (with cross-day data preserved via createNewDayPreserving),
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

    // Per-PC long-rest hour requirements (deferred-#10b). Sparse map:
    // key = actorId, value = number ≥ 0 (hours) or null (no sleep needed).
    // Missing keys default to 8 — we don't pre-write every PC. Rest math
    // (available = 10 − 2 × shifts; sufficient if available ≥ required or
    // required is null) lives in stats.js so it stays a pure function of
    // state and is reusable from chat.js for the day recap.
    restRequirements: {},

    // v1.1.0 — GM-managed journey participant list. Array of actor ids
    // explicitly added to the journey (PC, NPC, or Vehicle types). The
    // UI reads from this list, not game.actors directly. Default empty;
    // migration in normalizeState auto-populates from PC actors when
    // upgrading a pre-v1.1.0 stored state. See DESIGN.md §3.
    participants: [],
  };
}

/** Build a fresh day-state but preserve everything that's *cross-day*:
 *    - `trip`           — long-trip progress, milestones, reachedAt stamps
 *    - `restRequirements` — per-PC rest traits (elf trance = 4 h, etc.)
 *
 *  All preserved data is shallow-cloned and field-normalized so the new
 *  state owns its own references — no shared mutation across days.
 *
 *  Renamed from createNewDayPreservingTrip (now accepts the full previous
 *  state, not just prevTrip) so additions stay one-function/one-caller
 *  instead of growing parallel preserve-X functions. */
export function createNewDayPreserving(prevState) {
  const fresh = createDefaultState();
  if (!prevState || typeof prevState !== "object") return fresh;

  // Trip (per-trip data, persists until "Réinitialiser le voyage")
  const prevTrip = prevState.trip;
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

  // Rest requirements (per-PC traits — elf, vampire, construct). These
  // describe the PC, not the day, so they survive Nouveau jour. Shallow
  // clone of the object so we don't share the reference with prevState.
  if (prevState.restRequirements && typeof prevState.restRequirements === "object") {
    fresh.restRequirements = { ...prevState.restRequirements };
  }

  return fresh;
}

/** Field-fill a loaded snapshot so partial / older state objects work. Foundry
 *  may hand us anything that was previously written to the setting, including
 *  empty {} from a fresh world; mergeObject with the default tree fills all
 *  missing fields. Schema migrations live here too. */
export function normalizeState(raw) {
  if (!raw || typeof raw !== "object") return createDefaultState();
  // foundry.utils.mergeObject deep-merges into a new object. Default tree
  // first, then overlay the raw — raw's leaf values win for shared keys.
  const merged = foundry.utils.mergeObject(createDefaultState(), raw, { inplace: false });

  // v1.1.0 migration — auto-populate participants from PC-type actors
  // when the stored state predates the participants field. Detected by
  // the field being literally absent from the raw object (mergeObject
  // would have filled it with the default empty array, which is then
  // indistinguishable from "GM explicitly cleared the list"). Once any
  // GM commit lands, the field is present and migration stops running.
  if (!("participants" in raw)) {
    merged.participants = _autoDetectPCActorIds();
  } else if (!Array.isArray(raw.participants)) {
    // Malformed (shouldn't happen, but be defensive)
    merged.participants = [];
  }

  return merged;
}

/** Returns the actor ids of every PC ("character" type) currently visible
 *  to this client. Used by the v1.1.0 migration to seed the participant
 *  list. Players and the GM all see PC actors (Foundry default permissions),
 *  so different clients converge on the same migration result. */
function _autoDetectPCActorIds() {
  const out = [];
  try {
    for (const actor of (game?.actors ?? [])) {
      if (actor.type === "character") out.push(actor.id);
    }
  } catch { /* game.actors not ready — return empty */ }
  return out;
}
