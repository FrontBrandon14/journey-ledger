/* Journey Ledger — world Setting persistence.
 *
 * Phase 3 (DESIGN.md §4.4, §4.6): persistence is the COLD path only. Live
 * propagation runs through socketlib in sync.js; this module just reads
 * the snapshot at world startup and writes immediate flushes when the
 * GM-side socketlib handler asks for one. The 500 ms debounce that used
 * to live here moved to sync.js (see _scheduleCommit there).
 *
 * Foundry's default world-setting permission means only GMs can write
 * directly — flushCommit is therefore only invoked from sync's
 * _onCommitState handler (which is registered with executeAsGM and only
 * runs on a GM client). Non-GM clients reach persistence only by
 * loadSnapshot at startup.
 *
 * The world Setting's onChange handler is a no-op by design (§4.6): live
 * updates already happened via socketlib by the time onChange fires. The
 * Setting exists only for the cold-start snapshot on next world load. */

import { createDefaultState, normalizeState } from "./state.js";

const MODULE_ID = "journey-ledger";
const SETTING_KEY = "state";

/**
 * Read the cold-start snapshot from the world Setting.
 *   - Missing / empty / malformed → fresh createDefaultState()
 *   - Otherwise → normalizeState() fills in any missing fields
 *
 * The setting is registered in main.js's init hook with a default of {},
 * so on a brand-new world this returns a default state without ever
 * touching the Setting itself.
 */
export function loadSnapshot() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTING_KEY);
    if (!raw || typeof raw !== "object" || Object.keys(raw).length === 0) {
      return createDefaultState();
    }
    return normalizeState(raw);
  } catch (e) {
    console.error("[Journey Ledger] loadSnapshot failed:", e);
    return createDefaultState();
  }
}

/**
 * Immediate write of the snapshot to the world Setting. Called only from
 * sync.js's GM-side socketlib handler. Failure is logged and swallowed —
 * a persistence miss is recoverable on the next mutation; we don't want
 * one bad write to crash the sync layer.
 */
export async function flushCommit(state) {
  try {
    await game.settings.set(MODULE_ID, SETTING_KEY, state);
  } catch (e) {
    console.warn("[Journey Ledger] persistence flushCommit failed:", e?.message ?? e);
  }
}
