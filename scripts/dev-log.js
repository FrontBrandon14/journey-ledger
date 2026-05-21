/* Journey Ledger — dev-mode console logging.
 *
 * Phase 5 (DESIGN.md §9). Every function in this module is a no-op
 * unless the world setting `devMode` is true. When devMode is on, each
 * call emits exactly one filterable console.log line so output can be
 * grepped by event type ([JL mutation], [JL received], [JL commit], …)
 * or by mutation id (correlate originator with receivers across consoles).
 *
 * The dev-mode setting is registered in main.js with `config: true`, so
 * the GM can toggle it from Foundry's Module Settings dialog without
 * touching code. Changes take effect immediately — _isDevMode() reads
 * the live value on every call. */

const MODULE_ID = "journey-ledger";

/** Live read of the world setting. Wrapped in try/catch because settings
 *  aren't accessible until after Foundry's init phase. Callers may run
 *  during init (e.g. sync.js's top-level setup) and should not crash. */
export function isDevMode() {
  try { return Boolean(game.settings.get(MODULE_ID, "devMode")); }
  catch { return false; }
}

/* ---------------------------------------------------------------------------
 * Style + identity helpers
 *
 * Each log line is split into a styled tag (`%c[JL <kind>]%c`) followed
 * by plain text. The styling makes the lines scan easily in a busy
 * console; the rest stays as raw text so logs can be copy-pasted into
 * bug reports without color codes.
 * ------------------------------------------------------------------------ */

const STYLE_TAG = "color:#c9a227;font-weight:bold;";

function _now() {
  return new Date().toISOString();
}

function _userLabel(userId) {
  if (!userId) return "(anonymous)";
  const name = game.users?.get?.(userId)?.name ?? "Unknown";
  return `${name}/${userId}`;
}

/* ---------------------------------------------------------------------------
 * Event loggers
 *
 * Each maps to one event in the sync pipeline. Calls are placed where
 * the event happens (mutate, _onRemoteMutation, _commit, etc.) so the
 * log faithfully reflects the runtime flow rather than reconstructed
 * after-the-fact summaries.
 * ------------------------------------------------------------------------ */

/** Local mutation dispatched by this client's UI. Logged from sync.mutate. */
export function logLocalMutation(mutation) {
  if (!isDevMode()) return;
  console.log(
    `%c[JL mutation]%c ${mutation.type} by ${_userLabel(mutation.userId)} at ${_now()} [${mutation.id}]`,
    STYLE_TAG, "", "\n  payload:", mutation.payload
  );
}

/** Remote mutation received via socketlib. Logged from _onRemoteMutation. */
export function logRemoteMutation(mutation) {
  if (!isDevMode()) return;
  console.log(
    `%c[JL received]%c ${mutation.type} from ${_userLabel(mutation.userId)} at ${_now()} [${mutation.id}] — applying`,
    STYLE_TAG, "", "\n  payload:", mutation.payload
  );
}

/** Originator's broadcast dispatch (executeForOthers). socketlib doesn't
 *  return a recipient count, so we log only the mutation id. */
export function logBroadcast(mutation) {
  if (!isDevMode()) return;
  console.log(
    `%c[JL broadcast]%c applyMutation [${mutation.id}] dispatched via executeForOthers`,
    STYLE_TAG, ""
  );
}

/** Originator's commit dispatch (executeAsGM call leaving this client). */
export function logCommitDispatch() {
  if (!isDevMode()) return;
  const gm = game.users?.activeGM?.name ?? "(no active GM)";
  console.log(
    `%c[JL commit→GM]%c commitState dispatched (target GM=${gm}) at ${_now()}`,
    STYLE_TAG, ""
  );
}

/** GM's local commit completion (after game.settings.set succeeded). The
 *  byte count is approximate — JSON-stringified length of the state. */
export function logCommitWrite(state) {
  if (!isDevMode()) return;
  let bytes;
  try { bytes = JSON.stringify(state).length; } catch { bytes = -1; }
  const sizeStr = bytes >= 0 ? `${(bytes / 1024).toFixed(1)} KB` : "unknown size";
  console.log(
    `%c[JL commit-wrote]%c GM=${game.user?.name ?? "?"} wrote ${sizeStr} to world setting at ${_now()}`,
    STYLE_TAG, ""
  );
}

/** Cold-start snapshot from the world Setting (sync.init). */
export function logColdSnapshot() {
  if (!isDevMode()) return;
  console.log(
    `%c[JL snapshot]%c cold snapshot loaded from world setting at ${_now()}`,
    STYLE_TAG, ""
  );
}

/** Live snapshot received from the GM during init (executeAsGM resolved). */
export function logLiveSnapshot(remoteTs, localTs) {
  if (!isDevMode()) return;
  const newerBy = (Number(remoteTs) || 0) - (Number(localTs) || 0);
  const direction = newerBy > 0 ? `newer by ${newerBy} ms` : `older or equal (${newerBy} ms diff)`;
  console.log(
    `%c[JL snapshot]%c live snapshot received from GM (${direction}) at ${_now()}`,
    STYLE_TAG, ""
  );
}

/** Snapshot request received (this is the GM responding). */
export function logSnapshotRequested(requesterUserId) {
  if (!isDevMode()) return;
  console.log(
    `%c[JL snapshot-req]%c requestSnapshot received from ${_userLabel(requesterUserId)} at ${_now()}`,
    STYLE_TAG, ""
  );
}

/** Snapshot pushed by the GM via socketlib (force-resync path). */
export function logSnapshotPush(direction) {
  if (!isDevMode()) return;
  console.log(
    `%c[JL snapshot-push]%c ${direction} at ${_now()}`,
    STYLE_TAG, ""
  );
}

/** Auto-chat fire decision in _maybeFireTripChat. */
export function logAutoChat(action, detail) {
  if (!isDevMode()) return;
  console.log(
    `%c[JL auto-chat]%c ${action}${detail ? ` · ${detail}` : ""} at ${_now()}`,
    STYLE_TAG, ""
  );
}

/** Generic catch-all for anything the structured loggers above don't cover. */
export function log(label, ...args) {
  if (!isDevMode()) return;
  console.log(`%c[JL ${label}]%c`, STYLE_TAG, "", ...args);
}
