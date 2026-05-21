/* Journey Ledger — pure apply functions per DESIGN.md §4.2 / §4.3.
 *
 * NEW code. Each handler signature: apply(state, payload) → mutates `state`
 * in place. The state object reference is owned by sync.js; these handlers
 * never replace it (Object.assign / property mutation only).
 *
 * INVARIANTS enforced here so every client converges (DESIGN.md §4.3):
 *   - ADD_ASSIGNMENT enforces the Ciblée 2-cap and de-duplicates actorIds
 *   - SET_TRAP_FIELD only accepts known trap-type keys and coerces dc to
 *     a finite number (or "")
 *   - TOGGLE_CAMP_QUALITY only accepts known quality keys
 *   - SET_CAMP_FIELD only accepts the two whitelisted field names
 *
 * Unknown mutation types console.warn and no-op rather than throwing — a
 * broadcast carrying a malformed payload must not crash the receiver. */

import { ACTIVITY_BY_KEY, QUALITIES, TRAP_TYPES } from "./constants.js";
import { createNewDayPreservingTrip } from "./state.js";
import { deriveCampProperties, FINDER_QUALITY_KEYS } from "./camp-rules.js";
import { tripMetrics } from "./trip-metrics.js";

/* ---------------------------------------------------------------------------
 * Individual handlers
 * ------------------------------------------------------------------------ */

function applySetDayName(state, { dayName }) {
  state.dayName = String(dayName ?? "");
}

function applySetTrip(state, payload) {
  const { startNote, endNote, milestones, elapsedHours } = payload || {};
  state.trip = {
    startNote: String(startNote ?? ""),
    endNote:   String(endNote   ?? ""),
    elapsedHours: Math.max(0, Number(elapsedHours) || 0),
    milestones: Array.isArray(milestones) ? milestones.map(normalizeMilestone) : [],
  };

  // Phase 4 — auto-stamp newly-reached milestones with the current day name.
  // Deterministic: every client computes the same stamp on the same mutation
  // input, so all clients converge on identical milestone data even after
  // socket-broadcast relay. Once a milestone has reachedAt set, normalizeMs
  // preserves it through subsequent SET_TRIPs, so we don't re-stamp.
  const metrics = tripMetrics(state.trip);
  const stampLabel = (typeof state.dayName === "string" && state.dayName.trim())
    ? state.dayName.trim()
    : "Jour de voyage";
  for (const liveM of state.trip.milestones) {
    if (liveM.reachedAt) continue;
    const afterM = metrics.markers.find((m) => m.id === liveM.id);
    if (afterM?.reached) liveM.reachedAt = stampLabel;
  }
}

function applyResetTrip(state) {
  state.trip = { startNote: "", endNote: "", milestones: [], elapsedHours: 0 };
}

function applyAddAssignment(state, { phase, activityKey, actorId }) {
  if (!phase || !activityKey || !actorId) return;
  state[phase] ??= { assignments: {} };
  state[phase].assignments ??= {};

  // Phase 2.1 #6 — per-column actor uniqueness. An actor already assigned
  // to ANY activity in this phase cannot be added to another activity in
  // the same phase. Enforced here so every client converges; the picker
  // filter in _renderActivity hides them at the UI level too. Subsumes the
  // older per-activity de-dup since same-activity is a special case.
  for (const list of Object.values(state[phase].assignments)) {
    if (Array.isArray(list) && list.some((x) => x.actorId === actorId)) return;
  }

  state[phase].assignments[activityKey] ??= [];
  const arr = state[phase].assignments[activityKey];

  // Ciblée 2-cap — enforced here so every client agrees, not just the
  // originator's UI (DESIGN.md §4.3).
  const activity = ACTIVITY_BY_KEY.get(activityKey);
  const isCiblee = (activity?.tags || []).includes("ciblee");
  if (isCiblee && arr.length >= 2) return;

  arr.push({ actorId });
}

function applyRemoveAssignment(state, { phase, activityKey, actorId }) {
  const arr = state?.[phase]?.assignments?.[activityKey];
  if (!Array.isArray(arr)) return;
  const idx = arr.findIndex((x) => x.actorId === actorId);
  if (idx >= 0) arr.splice(idx, 1);
}

function applyToggleCampQuality(state, { key, value }) {
  if (!QUALITIES.some((q) => q.key === key)) return;
  state.camp ??= { assignments: {}, qualities: {}, defendableDC: "", cacheDC: "", traps: [] };
  state.camp.qualities ??= {};
  state.camp.qualities[key] = !!value;
}

function applySetCampField(state, { field, value }) {
  if (field !== "defendableDC" && field !== "cacheDC") return;
  state.camp ??= { assignments: {}, qualities: {}, defendableDC: "", cacheDC: "", traps: [] };
  // DC fields kept as string per macro semantics — "" means "not set".
  state.camp[field] = String(value ?? "");
}

function applyAddTrap(state) {
  state.camp ??= { assignments: {}, qualities: {}, defendableDC: "", cacheDC: "", traps: [] };
  state.camp.traps ??= [];
  state.camp.traps.push({ type: "bruyant", dc: 12, note: "" });
}

function applyRemoveTrap(state, { index }) {
  if (!Array.isArray(state.camp?.traps)) return;
  if (!Number.isInteger(index) || index < 0 || index >= state.camp.traps.length) return;
  state.camp.traps.splice(index, 1);
}

function applySetTrapField(state, { index, field, value }) {
  const trap = state.camp?.traps?.[index];
  if (!trap) return;
  if (field === "type") {
    if (TRAP_TYPES.some((t) => t.key === value)) trap.type = value;
  } else if (field === "dc") {
    // Numeric, but allow "" for "not set".
    if (value === "" || value == null) trap.dc = "";
    else {
      const n = Number(value);
      trap.dc = Number.isFinite(n) ? n : "";
    }
  } else if (field === "note") {
    trap.note = String(value ?? "");
  }
}

function applyAddWatchShift(state) {
  state.nuit ??= { assignments: {}, watch: [] };
  state.nuit.watch ??= [];
  const n = state.nuit.watch.length + 1;
  state.nuit.watch.push({ shift: `Tour ${n}`, actorIds: [] });
}

function applyRemoveWatchShift(state, { index }) {
  if (!Array.isArray(state.nuit?.watch)) return;
  if (!Number.isInteger(index) || index < 0 || index >= state.nuit.watch.length) return;
  state.nuit.watch.splice(index, 1);
}

function applySetWatchShiftLabel(state, { index, value }) {
  const w = state.nuit?.watch?.[index];
  if (!w) return;
  w.shift = String(value ?? "");
}

function applyAddWatchPC(state, { index, actorId }) {
  const w = state.nuit?.watch?.[index];
  if (!w || !actorId) return;
  w.actorIds ??= [];
  if (!w.actorIds.includes(actorId)) w.actorIds.push(actorId);
}

function applyRemoveWatchPC(state, { index, actorId }) {
  const w = state.nuit?.watch?.[index];
  if (!w) return;
  w.actorIds = (w.actorIds || []).filter((id) => id !== actorId);
}

function applyResetDay(state) {
  // Build a fresh state preserving the current trip, then overwrite `state`'s
  // properties in place. We can't replace the reference because sync.js holds
  // the canonical pointer.
  const fresh = createNewDayPreservingTrip(state.trip);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);
}

/* ---------------------------------------------------------------------------
 * Phase 2.2 #9c — Smart camp panel
 *
 * Setting either field (result, d6) auto-applies the derivation to the
 * finder qualities the moment BOTH are populated. Clearing either field
 * leaves the previously-applied qualities alone — user retains manual
 * control by toggling qualities directly. RESET_CAMP_SMART wipes the
 * panel state without touching qualities.
 * ------------------------------------------------------------------------ */

function applySetCampCheckResult(state, { value }) {
  _ensureCampShape(state);
  if (value === "" || value == null) {
    state.camp.smartCheck.result = "";
  } else {
    const n = Number(value);
    state.camp.smartCheck.result = Number.isFinite(n) ? n : "";
  }
  _autoApplyCampDerivation(state);
}

function applySetCampD6(state, { value }) {
  _ensureCampShape(state);
  const n = Math.floor(Number(value));
  state.camp.smartCheck.d6 = (n >= 1 && n <= 6) ? n : 0;
  _autoApplyCampDerivation(state);
}

function applyResetCampSmart(state) {
  _ensureCampShape(state);
  state.camp.smartCheck = { result: "", d6: 0 };
  // Note: qualities deliberately left untouched. The user's most recent
  // auto-applied or manually-toggled qualities persist.
}

/* Defensive: ensure `state.camp` has all the fields the handlers expect.
 * Older snapshots (or partial state from a broadcast race) may be missing
 * `smartCheck` etc. — we don't want a mutation to crash on undefined paths. */
function _ensureCampShape(state) {
  state.camp ??= { assignments: {}, qualities: {}, defendableDC: "", cacheDC: "", traps: [], smartCheck: { result: "", d6: 0 } };
  state.camp.qualities ??= {};
  state.camp.smartCheck ??= { result: "", d6: 0 };
}

/* The actual auto-apply: when both `result` and `d6` are set, overwrite
 * the six finder-quality flags from the derivation. `trapped` is never
 * touched — it's set by the "Installer des pièges" evening activity. */
function _autoApplyCampDerivation(state) {
  const smart = state.camp.smartCheck;
  if (smart.result === "" || smart.d6 === 0) return;
  const derived = deriveCampProperties(smart.result, smart.d6);
  for (const k of FINDER_QUALITY_KEYS) state.camp.qualities[k] = false;
  for (const sel of derived.selected) {
    const targetKey = sel.improved ? `${sel.key}Improved` : sel.key;
    state.camp.qualities[targetKey] = true;
  }
}

/* ---------------------------------------------------------------------------
 * Dispatch table + entry point
 * ------------------------------------------------------------------------ */

const HANDLERS = {
  SET_DAY_NAME:           applySetDayName,
  SET_TRIP:               applySetTrip,
  RESET_TRIP:             applyResetTrip,
  ADD_ASSIGNMENT:         applyAddAssignment,
  REMOVE_ASSIGNMENT:      applyRemoveAssignment,
  TOGGLE_CAMP_QUALITY:    applyToggleCampQuality,
  SET_CAMP_FIELD:         applySetCampField,
  ADD_TRAP:               applyAddTrap,
  REMOVE_TRAP:            applyRemoveTrap,
  SET_TRAP_FIELD:         applySetTrapField,
  ADD_WATCH_SHIFT:        applyAddWatchShift,
  REMOVE_WATCH_SHIFT:     applyRemoveWatchShift,
  SET_WATCH_SHIFT_LABEL:  applySetWatchShiftLabel,
  ADD_WATCH_PC:           applyAddWatchPC,
  REMOVE_WATCH_PC:        applyRemoveWatchPC,
  RESET_DAY:              applyResetDay,
  // Phase 2.2 #9c
  SET_CAMP_CHECK_RESULT:  applySetCampCheckResult,
  SET_CAMP_D6:            applySetCampD6,
  RESET_CAMP_SMART:       applyResetCampSmart,
};

export const MUTATION_TYPES = Object.freeze(Object.keys(HANDLERS));

/** Apply a mutation envelope to `state` in place. Unknown types are a
 *  no-op (with a console.warn) so a malformed broadcast can't crash the
 *  receiver. Returns the same `state` reference for caller chaining. */
export function applyMutation(state, mutation) {
  const handler = HANDLERS[mutation?.type];
  if (!handler) {
    console.warn("[Journey Ledger] unknown mutation type:", mutation?.type, mutation);
    return state;
  }
  try {
    handler(state, mutation.payload ?? {});
  } catch (e) {
    console.error("[Journey Ledger] mutation handler threw:",
                  mutation?.type, mutation?.payload, e);
  }
  return state;
}

/* Used by SET_TRIP and by trip-dialog when ingesting raw form input. */
function normalizeMilestone(m) {
  return {
    id: m?.id ?? null,
    label: String(m?.label ?? ""),
    icon:  String(m?.icon  ?? ""),
    hoursLeg: Math.max(0, Number(m?.hoursLeg) || 0),
    milesLeg: Math.max(0, Number(m?.milesLeg) || 0),
    note:  String(m?.note  ?? ""),
    reachedAt: m?.reachedAt ?? null,
  };
}
