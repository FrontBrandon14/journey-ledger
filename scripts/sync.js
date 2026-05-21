/* Journey Ledger — sync layer.
 *
 * Phase 3 (DESIGN.md §4): real-time multi-user sync via socketlib.
 *
 *  HOT PATH (live updates)
 *    Any client calls mutate(type, payload).
 *      → applyMutation runs LOCALLY for instant feedback.
 *      → socket.executeForOthers("applyMutation", envelope) broadcasts to
 *        every other connected client; their receiver applies + notifies
 *        their app.
 *      → notify local listeners (this client's app re-renders).
 *      → schedule a debounced commit (500 ms) that calls
 *        socket.executeAsGM("commitState", state).
 *
 *  COLD PATH (persistence)
 *    The GM client's _onCommitState handler writes to the world Setting
 *    via persistence.flushCommit. Non-GM clients never write the Setting
 *    directly — the route is always through executeAsGM.
 *
 *  LATE JOINERS
 *    sync.init() loads the cold-snapshot from the Setting, then asks the
 *    GM for a fresh in-memory snapshot via requestSnapshot. If a GM is
 *    online and has uncommitted changes, the late-joiner gets them.
 *    A 3-second timeout keeps init from hanging if no GM is online.
 *
 *  CONFLICT POLICY
 *    Last-write-wins. With one travel master + N spectators (the user's
 *    confirmed workflow at DESIGN.md §0), true concurrent edits are rare;
 *    when they happen the broadcast that arrives last on each client wins,
 *    and the next debounced snapshot reflects that. */

import { applyMutation } from "./mutations.js";
import { loadSnapshot, flushCommit } from "./persistence.js";
import { createDefaultState } from "./state.js";
import { tripMetrics, fmtNum } from "./trip-metrics.js";
import { postMilestoneReached, postTripUpdate } from "./chat.js";
import * as devLog from "./dev-log.js";

const MODULE_ID = "journey-ledger";
const COMMIT_DEBOUNCE_MS = 500;
const SNAPSHOT_TIMEOUT_MS = 3000;

let _socket = null;
let _ready = false;
let _commitDebounceTimer = null;

// In-memory authoritative state. Reference is stable for the life of the
// module — mutations apply in place. Initialized with a default until init()
// loads the cold snapshot.
const _state = createDefaultState();

const _listeners = new Set();

/* ---------------------------------------------------------------------------
 * socketlib registration
 *
 * IMPORTANT — registered at MODULE TOP LEVEL, not inside an init callback.
 * socketlib.ready fires during Foundry's init phase, potentially BEFORE
 * other modules' init callbacks have run. `Hooks.once` doesn't fire
 * retroactively, so registering the listener from inside an init callback
 * could miss the event entirely — the exact bug that silently disabled
 * live sync in the original macro. Top-level registration runs during the
 * ES-module import (the earliest possible moment).
 * ------------------------------------------------------------------------ */

console.log("[Journey Ledger] sync.js loaded — registering socketlib hook");
Hooks.once("socketlib.ready", _onSocketlibReady);

function _onSocketlibReady() {
  if (typeof socketlib === "undefined") {
    console.error(
      "[Journey Ledger] socketlib not available — multi-user sync DISABLED. " +
      "Verify the socketlib module is installed and enabled in this world."
    );
    return;
  }
  try {
    _socket = socketlib.registerModule(MODULE_ID);
    _socket.register("applyMutation",   _onRemoteMutation);
    _socket.register("commitState",     _onCommitState);
    _socket.register("requestSnapshot", _onRequestSnapshot);
    _socket.register("pushSnapshot",    _onPushSnapshot);
    console.log("%c[Journey Ledger] socketlib registered", "color:#c9a227;font-weight:bold");
  } catch (e) {
    console.error("[Journey Ledger] socketlib registration failed:", e);
    _socket = null;
  }
}

/* ---------------------------------------------------------------------------
 * Bootstrap — called from main.js's ready hook
 * ------------------------------------------------------------------------ */

export async function init() {
  if (_ready) return;

  // 1. Cold-start snapshot from the world Setting
  _replaceStateInPlace(loadSnapshot());
  _ready = true;
  console.log("[Journey Ledger] cold snapshot loaded");
  devLog.logColdSnapshot();

  // 2. If socketlib is registered, fetch a fresh in-memory snapshot from
  //    the GM — covers the case where we joined mid-session and the cold
  //    snapshot is older than the GM's in-memory state.
  if (_socket) {
    try {
      const remote = await Promise.race([
        _socket.executeAsGM("requestSnapshot"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("snapshot timeout")), SNAPSHOT_TIMEOUT_MS)
        ),
      ]);
      if (remote && typeof remote === "object") {
        const localTs  = Number(_state.lastUpdatedAt) || 0;
        const remoteTs = Number(remote.lastUpdatedAt) || 0;
        devLog.logLiveSnapshot(remoteTs, localTs);
        if (remoteTs >= localTs) {
          _replaceStateInPlace(remote);
          console.log("[Journey Ledger] live snapshot received from GM");
        }
      }
    } catch (e) {
      // No GM online, or socketlib timeout — stick with cold snapshot.
      console.log("[Journey Ledger] no live snapshot — using cold (no GM online?)");
    }
  } else {
    console.warn("[Journey Ledger] socketlib not registered — live sync OFFLINE for this session");
  }

  _notify(null);
}

export function isReady() { return _ready; }

/* ---------------------------------------------------------------------------
 * Public accessors
 * ------------------------------------------------------------------------ */

export function getState() { return _state; }

/** True iff at least one active GM user is connected. Drives the no-GM
 *  warning banner — non-GM commits won't persist without a GM online. */
export function isGMOnline() {
  return !!game.users?.activeGM;
}

/* ---------------------------------------------------------------------------
 * Mutation entry point (local)
 *
 * Build the §4.1 envelope, apply it locally for instant feedback, broadcast
 * to other clients, schedule the GM-side commit, notify local listeners.
 * Returns the mutation envelope so callers / dev-log can correlate by id.
 * ------------------------------------------------------------------------ */

export function mutate(type, payload) {
  const mutation = {
    id: foundry?.utils?.randomID?.() ?? `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload: payload ?? {},
    userId: game.user?.id ?? null,
    timestamp: Date.now(),
  };

  // 0. Snapshot the trip BEFORE apply for SET_TRIP — needed by the auto-
  //    chat fire to diff reached markers + elapsed-hours change. Skipped
  //    for all other mutation types (saves the deepClone cost).
  const beforeTrip = (type === "SET_TRIP") ? foundry.utils.deepClone(_state.trip) : null;

  devLog.logLocalMutation(mutation);

  // 1. Apply locally — instant feedback for the originating client.
  applyMutation(_state, mutation);
  _state.lastUpdatedBy = mutation.userId;
  _state.lastUpdatedAt = mutation.timestamp;

  // 2. Broadcast to all OTHER clients (not us — we already applied).
  if (_socket) {
    devLog.logBroadcast(mutation);
    _socket.executeForOthers("applyMutation", mutation).catch((e) =>
      console.warn("[Journey Ledger] broadcast failed:", e?.message ?? e)
    );
  }

  // 3. Schedule a debounced commit. The actual commit routes through
  //    executeAsGM so any client can trigger persistence.
  _scheduleCommit();

  // 4. Notify local listeners (the app re-renders).
  _notify(mutation);

  // 5. GM-only auto-chat fire (Phase 4, DESIGN.md §8.2). Same logic runs
  //    on every client; only the lowest-id active GM actually posts.
  if (beforeTrip) _maybeFireTripChat(beforeTrip, _state, mutation);

  return mutation;
}

/** Flush any pending debounced commit immediately. Called from the app's
 *  _onClose so an in-flight mutation isn't lost when the user closes the
 *  window before the debounce fires. */
export function flush() {
  if (_commitDebounceTimer) {
    clearTimeout(_commitDebounceTimer);
    _commitDebounceTimer = null;
  }
  return _commit();
}

/* ---------------------------------------------------------------------------
 * socketlib receivers
 * ------------------------------------------------------------------------ */

/** A remote client mutated — apply to our local state and notify the app.
 *  We do NOT re-broadcast (the sender already did) and do NOT schedule a
 *  commit (the sender's client handles that via executeAsGM). For
 *  SET_TRIP, capture before-state for the GM-only auto-chat fire. */
function _onRemoteMutation(mutation) {
  if (!mutation || typeof mutation !== "object") return;
  devLog.logRemoteMutation(mutation);
  const beforeTrip = (mutation.type === "SET_TRIP") ? foundry.utils.deepClone(_state.trip) : null;
  applyMutation(_state, mutation);
  _state.lastUpdatedBy = mutation.userId;
  _state.lastUpdatedAt = mutation.timestamp;
  _notify(mutation);
  if (beforeTrip) _maybeFireTripChat(beforeTrip, _state, mutation);
}

/** GM-only handler. Writes the snapshot to the world Setting. Non-GM
 *  receivers (socketlib shouldn't route here, but defensive) do nothing. */
async function _onCommitState(state) {
  if (!game.user?.isGM) return;
  await flushCommit(state);
  devLog.logCommitWrite(state);
}

/** Returns the GM's current in-memory state. Called by late-joiners via
 *  executeAsGM during their sync.init(). socketlib routes to a GM client
 *  automatically; if multiple GMs are online, the lowest-id one answers. */
function _onRequestSnapshot() {
  devLog.logSnapshotRequested(null); // socketlib doesn't pass requester id
  return foundry.utils.deepClone(_state);
}

/** GM pushes a full state snapshot. Used by RESET_DAY (too big to diff
 *  via a single mutation envelope) and by any future force-resync path. */
function _onPushSnapshot(state) {
  if (!state || typeof state !== "object") return;
  devLog.logSnapshotPush("received push from GM — overwriting local state");
  _replaceStateInPlace(state);
  _notify(null);
}

/* ---------------------------------------------------------------------------
 * Commit scheduling
 *
 * Debounced 500 ms — burst-edit sessions coalesce into one write per quiet
 * gap. Phase 3 routes through executeAsGM so any client can commit; if
 * socketlib is unavailable, the GM can still write directly.
 * ------------------------------------------------------------------------ */

function _scheduleCommit() {
  if (_commitDebounceTimer) clearTimeout(_commitDebounceTimer);
  _commitDebounceTimer = setTimeout(() => {
    _commitDebounceTimer = null;
    _commit().catch((e) =>
      console.warn("[Journey Ledger] debounced commit threw:", e?.message ?? e)
    );
  }, COMMIT_DEBOUNCE_MS);
}

async function _commit() {
  if (_socket) {
    devLog.logCommitDispatch();
    try {
      await _socket.executeAsGM("commitState", _state);
    } catch (e) {
      // No active GM, or socketlib error. The mutation lives in the in-
      // memory state of every connected client; it just doesn't survive a
      // full client refresh. The no-GM warning in the banner surfaces this.
      console.warn("[Journey Ledger] commit-as-GM failed (GM offline?):", e?.message ?? e);
    }
    return;
  }
  // Fallback for the socketlib-unavailable case — only GMs can write
  // directly (Foundry's default world-setting permission).
  if (game.user?.isGM) {
    await flushCommit(_state);
    devLog.logCommitWrite(_state);
  }
}

/* ---------------------------------------------------------------------------
 * Subscription
 * ------------------------------------------------------------------------ */

/** Register a re-render listener. Returns an unsubscribe function — call
 *  it from your owner's close / destroy lifecycle.
 *
 *  Listener signature: (mutation | null) => void
 *    - mutation: the envelope that triggered the change (local or remote)
 *    - null: snapshot replacement (cold load, pushSnapshot, etc.) */
export function subscribe(listener) {
  if (typeof listener !== "function") {
    console.warn("[Journey Ledger] subscribe: listener is not a function");
    return () => {};
  }
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function _notify(mutation) {
  for (const listener of _listeners) {
    try { listener(mutation); }
    catch (e) { console.error("[Journey Ledger] listener threw:", e); }
  }
}

/* ---------------------------------------------------------------------------
 * Internal helpers
 * ------------------------------------------------------------------------ */

/** Replace _state's contents in place. The reference stays stable so any
 *  external code holding `getState()` continues to see fresh data without
 *  needing to re-fetch. */
function _replaceStateInPlace(newState) {
  for (const key of Object.keys(_state)) delete _state[key];
  Object.assign(_state, newState);
}

/* ---------------------------------------------------------------------------
 * Auto-chat fire (Phase 4, DESIGN.md §8.2)
 *
 * Runs on every client after a SET_TRIP applies, but only the lowest-id
 * active GM actually posts. This guarantees exactly one chat card per
 * crossing regardless of which client originated the mutation.
 *
 * Cards fired:
 *   - Trip-progress card: any time elapsedHours changed OR the trip was
 *     just configured for the first time.
 *   - Milestone-crossed card: one per marker that transitioned from
 *     reached:false → reached:true. Includes the Destination marker on
 *     trip completion.
 *
 * Skipped on RESET_TRIP / RESET_DAY (those zero everything; no semantic
 * "crossing" event to announce).
 * ------------------------------------------------------------------------ */

function _isActiveGM() {
  return game.users?.activeGM?.id === game.user?.id;
}

function _maybeFireTripChat(beforeTrip, state, mutation) {
  if (mutation.type !== "SET_TRIP") return;
  if (!_isActiveGM()) {
    devLog.logAutoChat("skipped — this client is not the activeGM");
    return;
  }

  const beforeMetrics = tripMetrics(beforeTrip);
  const afterMetrics  = tripMetrics(state.trip);

  // Diff markers by id: anything that went from not-reached to reached is
  // a fresh crossing. Skip the Départ marker (always reached at hour 0).
  const wasReached = new Map(beforeMetrics.markers.map((mk) => [mk.id, mk.reached]));
  const crossedMarkers = [];
  for (const mk of afterMetrics.markers) {
    if (mk.isFixed === "start") continue;
    if (!wasReached.get(mk.id) && mk.reached) crossedMarkers.push(mk);
  }

  const elapsedChanged   = beforeMetrics.elapsedH !== afterMetrics.elapsedH;
  const newlyConfigured  = !beforeMetrics.configured && afterMetrics.configured;

  // Nothing chat-worthy happened (e.g. user opened the dialog, made a
  // micro-edit to a milestone note, hit Save without changing elapsed).
  if (!elapsedChanged && !newlyConfigured && crossedMarkers.length === 0) {
    devLog.logAutoChat("skipped — no chat-worthy diff");
    return;
  }

  let reason;
  if (newlyConfigured)    reason = "Voyage configuré";
  else if (elapsedChanged) reason = `Progression ajustée (${fmtNum(beforeMetrics.elapsedH)} → ${fmtNum(afterMetrics.elapsedH)} h)`;
  else                    reason = "Voyage modifié";

  devLog.logAutoChat("firing", `reason="${reason}", crossings=${crossedMarkers.length}`);

  // Fire-and-forget: the chat posts are async but we don't need to await
  // them in the sync hot path. Errors inside the posters log themselves.
  postTripUpdate(state, reason);
  for (const mk of crossedMarkers) {
    postMilestoneReached(state, mk);
  }
}
