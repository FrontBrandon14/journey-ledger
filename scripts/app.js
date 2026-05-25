/* Journey Ledger — main application window.
 *
 * REBUILD from scratch (DESIGN.md §7.2), macro at journey-ledger.js as the
 * visual / behavioral reference only. Architectural differences:
 *
 *   - State is owned by sync.js, not by `this._state`. _renderHTML reads
 *     sync.getState() each pass; mutations dispatch through sync.mutate().
 *   - The app subscribes to sync on first render and unsubscribes on close;
 *     when sync notifies, the app re-renders. (Phase 3 will replace the
 *     full re-render with section-scoped re-render per §4.7.)
 *   - No `this._refresh()` / `this._persist()` — both are inherent in the
 *     mutate() → notify → render cycle.
 *   - All roll buttons, the skill-override picker, per-phase publish
 *     buttons, and the camp-finder roll buttons are REMOVED (§6). The
 *     camp-finder role grouping survives as informational. Inline skill
 *     labels (§10) replace the picker.
 *
 * Phase 2 deliberately omits:
 *   - Footer day-recap button (Phase 4)
 *   - Last-edit-by indicator UI (Phase 3)
 *   - Section-scoped re-render (Phase 3 — full re-render is fine on single
 *     client; text inputs use `change` event so blur happens before re-render)
 *   - Dev-mode console logging (Phase 5) */

import {
  PHASES, PHASES_BY_KEY, TAGS,
  TRAVEL_ACTIVITIES, EVENING_ACTIVITIES, QUALITIES, TRAP_TYPES,
  activityById, activitySkillLabel,
} from "./constants.js";
import { getParticipants, actorNameSafe, escapeHtml } from "./helpers.js";
import { openParticipantsDialog } from "./participants-dialog.js";
import { computePCDailyStats, distrayanteMalus, isEclaireurActive, getRestStatus, getRestRequirement, DEFAULT_REQUIRED_HOURS } from "./stats.js";
import { tripMetrics, fmtNum } from "./trip-metrics.js";
import { openTripEditDialog } from "./trip-dialog.js";
import { deriveCampProperties, finderQualityLabel } from "./camp-rules.js";
import { buildDayRecapHTML } from "./chat.js";
import * as sync from "./sync.js";
import * as devLog from "./dev-log.js";

const MODULE_ID = "journey-ledger";
const { ApplicationV2 } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

/* ---------------------------------------------------------------------------
 * Phase 3 — Mutation → section dispatch (DESIGN.md §4.7).
 *
 * Each mutation type lists the sections of the UI it can affect. When a
 * mutation arrives (local or remote), only those sections re-render; the
 * rest of the DOM is untouched, so a typist in a non-affected section
 * keeps their focus and in-progress text.
 *
 * Special value "all" forces a full re-render — used for RESET_DAY and
 * for snapshot replacements where everything changes at once. Unknown
 * mutation types also fall through to "all" for safety.
 *
 * Function-valued entries inspect the mutation payload to compute the
 * sections — ADD/REMOVE_ASSIGNMENT depends on which phase the assignment
 * lives in (and adds "camp" for étape 2 because the camp-finder grouping
 * is computed from étape 2 assignments).
 * ------------------------------------------------------------------------ */

function _sectionsForAssignment(mutation) {
  const phase = mutation?.payload?.phase;
  if (!phase) return [];
  const out = [phase, "roster"];
  if (phase === "etape2") out.push("camp"); // finder grouping reflects étape 2
  return out;
}

/** Human-friendly "il y a Ns / Nm / Nh / Nj" relative-time string. Used by
 *  the last-edit indicator next to the day-name field. */
function _formatRelativeTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "à l'instant";
  const sec = Math.floor(ms / 1000);
  if (sec < 5)   return "à l'instant";
  if (sec < 60)  return `il y a ${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60)  return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  return `il y a ${days} j`;
}

const MUTATION_TO_SECTIONS = {
  SET_DAY_NAME:           ["banner"],
  SET_TRIP:               ["banner"],
  RESET_TRIP:             ["banner"],
  ADD_ASSIGNMENT:         _sectionsForAssignment,
  REMOVE_ASSIGNMENT:      _sectionsForAssignment,
  TOGGLE_CAMP_QUALITY:    ["camp", "reveil"],   // reveil shows rest effect
  SET_CAMP_FIELD:         ["camp"],
  ADD_TRAP:               ["camp"],
  REMOVE_TRAP:            ["camp"],
  SET_TRAP_FIELD:         ["camp"],
  ADD_WATCH_SHIFT:        ["nuit"],
  REMOVE_WATCH_SHIFT:     ["nuit"],
  SET_WATCH_SHIFT_LABEL:  ["nuit"],
  ADD_WATCH_PC:           ["nuit"],
  REMOVE_WATCH_PC:        ["nuit"],
  RESET_DAY:              "all",
  SET_CAMP_CHECK_RESULT:  ["camp", "reveil"],
  SET_CAMP_D6:            ["camp", "reveil"],
  RESET_CAMP_SMART:       ["camp"],
  SET_REST_REQUIREMENT:    ["nuit"],   // deferred-#10b — updates both the rest list AND the watch-chip warning icons
  REMOVE_REST_REQUIREMENT: ["nuit"],   // deferred-#10b — same scope; row removal + warning-icon clearance
  // v1.1.0 — GM-managed participant list. Affects activity pickers, watch
  // chips, camp finder grouping, roster, and rest list — easier to full-
  // render than enumerate every affected section.
  SET_PARTICIPANTS:        "all",
};

export class JourneyLedger extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "journey-ledger-app",
    tag: "div",
    classes: ["journey-ledger"],
    window: {
      title: "Journey Ledger",
      icon: "fa-solid fa-route",
      resizable: true,
    },
    position: { width: 1400, height: 820 },
    actions: {
      removeAssign:    JourneyLedger.prototype._onRemoveAssign,
      addTrap:         JourneyLedger.prototype._onAddTrap,
      removeTrap:      JourneyLedger.prototype._onRemoveTrap,
      removeWatchPC:   JourneyLedger.prototype._onRemoveWatchPC,
      addWatchShift:   JourneyLedger.prototype._onAddWatchShift,
      removeWatch:     JourneyLedger.prototype._onRemoveWatch,
      newDay:          JourneyLedger.prototype._onNewDay,
      editTrip:        JourneyLedger.prototype._onEditTrip,
      rollD6:                  JourneyLedger.prototype._onRollD6,
      resetCampSmart:          JourneyLedger.prototype._onResetCampSmart,
      postDayRecap:            JourneyLedger.prototype._onPostDayRecap,
      removeRestRequirement:   JourneyLedger.prototype._onRemoveRestRequirement,
      openParticipants:        JourneyLedger.prototype._onOpenParticipants,
    },
  };

  /* ---------------------------------------------------------------------------
   * Lifecycle
   * ------------------------------------------------------------------------ */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);

    // Phase 3 — section-scoped re-render on every mutation.
    this._syncUnsubscribe = sync.subscribe((m) => this._onSyncChange(m));

    // Ticker: refreshes the "modifié par X · il y a Ys" text every 5s and
    // detects GM connect/disconnect so the no-GM warning banner appears /
    // disappears even if no Foundry hook fires. Belt-and-suspenders.
    this._lastGMOnline = sync.isGMOnline();
    this._lastEditTicker = setInterval(() => this._tick(), 5000);

    // Foundry's userConnected fires when ANY user connects/disconnects.
    // We only care about GMs (the no-GM warning toggles on their state).
    this._userConnHook = Hooks.on("userConnected", (user) => {
      if (user?.isGM) {
        this._lastGMOnline = sync.isGMOnline();
        this._applySection("banner");
      }
    });

    // Restore last-known window size if the user set one previously.
    this._restoreWindowSize();
  }

  _onClose(options) {
    this._syncUnsubscribe?.();
    this._syncUnsubscribe = null;
    if (this._savePosTimer)    { clearTimeout(this._savePosTimer);    this._savePosTimer = null; }
    if (this._lastEditTicker)  { clearInterval(this._lastEditTicker); this._lastEditTicker = null; }
    if (this._userConnHook != null) {
      Hooks.off("userConnected", this._userConnHook);
      this._userConnHook = null;
    }
    // Best-effort flush so a last edit just before close isn't stuck in the
    // debounce timer.
    sync.flush?.();
    this._saveWindowSize();
    super._onClose?.(options);
  }

  /* 5-second ticker: refresh the last-edit relative-time, detect GM
   * connect/disconnect (in case Foundry's userConnected hook missed it
   * or doesn't fire — Foundry v13's behavior on this isn't 100% consistent
   * across builds). */
  _tick() {
    this._refreshLastEditText();
    const gmNow = sync.isGMOnline();
    if (this._lastGMOnline !== gmNow) {
      this._lastGMOnline = gmNow;
      this._applySection("banner");
    }
  }

  /* ---------------------------------------------------------------------------
   * Window-size persistence (per-client setting, carried from macro §7.2)
   * ------------------------------------------------------------------------ */

  setPosition(position) {
    const result = super.setPosition(position);
    this._scheduleSaveWindowSize();
    return result;
  }

  _scheduleSaveWindowSize() {
    clearTimeout(this._savePosTimer);
    this._savePosTimer = setTimeout(() => this._saveWindowSize(), 400);
  }

  _saveWindowSize() {
    try {
      const w = this.position?.width;
      const h = this.position?.height;
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 400 || h < 300) return;
      game.settings.set(MODULE_ID, "windowSize", { width: w, height: h });
    } catch {
      // setting not registered yet, or write blocked — ignore silently
    }
  }

  _restoreWindowSize() {
    try {
      const saved = game.settings.get(MODULE_ID, "windowSize");
      if (saved && Number.isFinite(saved.width) && Number.isFinite(saved.height)) {
        const vw = window.innerWidth  || 1400;
        const vh = window.innerHeight || 900;
        this.setPosition({
          width:  Math.min(vw - 20, Math.max(800, saved.width)),
          height: Math.min(vh - 40, Math.max(500, saved.height)),
        });
      }
    } catch { /* ignore */ }
  }

  /* ---------------------------------------------------------------------------
   * Render pipeline
   * ------------------------------------------------------------------------ */

  async _renderHTML() {
    if (!sync.isReady()) {
      return `<div style="padding:24px;text-align:center;">Chargement…</div>`;
    }
    const state = sync.getState();
    const pcs = getParticipants(state);
    const stats = computePCDailyStats(state);
    return this._buildHTML(state, pcs, stats);
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    this._bindLiveInputs(content);
  }

  /* ---------------------------------------------------------------------------
   * HTML builders
   * ------------------------------------------------------------------------ */

  _buildHTML(state, pcs, stats) {
    // Every section is routed through _renderSection so the data-jl-section
    // marker is injected uniformly. _applySection later looks up the marker
    // to swap a single section's DOM without touching the rest.
    return `
      ${this._renderSection("banner",   state, pcs, stats)}
      ${this._renderSection("legend",   state, pcs, stats)}
      <div class="jl-panorama">
        ${this._renderSection("reveil",   state, pcs, stats)}
        ${this._renderSection("petitDej", state, pcs, stats)}
        ${this._renderSection("etape1",   state, pcs, stats)}
        ${this._renderSection("midi",     state, pcs, stats)}
        ${this._renderSection("etape2",   state, pcs, stats)}
        ${this._renderSection("camp",     state, pcs, stats)}
        ${this._renderSection("soir",     state, pcs, stats)}
        ${this._renderSection("nuit",     state, pcs, stats)}
      </div>
      ${this._renderSection("roster",   state, pcs, stats)}
      ${this._renderSection("footer",   state, pcs, stats)}
    `;
  }

  /* ---------------------------------------------------------------------------
   * Phase 3 — Section-scoped re-render plumbing (DESIGN.md §4.7)
   * ------------------------------------------------------------------------ */

  /** Subscribe callback from sync.js. Mutation envelope (or null for a
   *  snapshot replacement). Routes to either full re-render or section-
   *  scoped re-render based on MUTATION_TO_SECTIONS. */
  _onSyncChange(mutation) {
    // Always refresh the last-edit display (cheap textContent update).
    this._refreshLastEditText();

    // Snapshot replacement (cold-load, pushSnapshot) → full re-render.
    if (!mutation) {
      this.render(true);
      return;
    }

    const sections = this._sectionsForMutation(mutation);
    if (sections === "all") {
      this.render(true);
      return;
    }
    if (!Array.isArray(sections) || sections.length === 0) return;
    for (const name of sections) this._applySection(name);
  }

  _sectionsForMutation(mutation) {
    const entry = MUTATION_TO_SECTIONS[mutation.type];
    if (entry === undefined) return "all"; // unknown type → safe full render
    if (entry === "all") return "all";
    if (typeof entry === "function") return entry(mutation);
    if (Array.isArray(entry)) return entry;
    return "all";
  }

  /** Render the HTML for one section, with the data-jl-section marker
   *  injected on the outer element so _applySection can find it. */
  _renderSection(name, state, pcs, stats) {
    let inner;
    switch (name) {
      case "banner":   inner = this._renderBanner(state); break;
      case "legend":   inner = this._renderLegend(); break;
      case "reveil":   inner = this._renderReveil(state); break;
      case "petitDej": inner = this._renderPetitDej(state); break;
      case "etape1":   inner = this._renderEtape(state, "etape1", pcs); break;
      case "midi":     inner = this._renderMidi(state); break;
      case "etape2":   inner = this._renderEtape(state, "etape2", pcs); break;
      case "camp":     inner = this._renderCamp(state, pcs); break;
      case "soir":     inner = this._renderSoir(state, pcs); break;
      case "nuit":     inner = this._renderNuit(state, pcs); break;
      case "roster":   inner = this._renderRoster(state, pcs, stats); break;
      case "footer":   inner = this._renderFooter(state); break;
      default: return "";
    }
    return this._wrapSection(name, inner);
  }

  /** Inject `data-jl-section="<name>"` into the first opening tag of the
   *  HTML string. Idempotent — bails out if the attribute is already there
   *  (defensive against double-wrapping during refactors). */
  _wrapSection(name, html) {
    if (!html) return "";
    if (html.includes(`data-jl-section="${name}"`)) return html;
    return html.replace(/^(\s*<[a-zA-Z][^>]*?)>/, `$1 data-jl-section="${name}">`);
  }

  /** Re-render a single section. Finds the old DOM element by data marker,
   *  computes new HTML for that section, captures focus inside the old
   *  element if any, swaps the element, restores focus + in-progress
   *  value + cursor selection on the matching new element. */
  _applySection(name) {
    const root = this.element;
    if (!root) return;
    const oldEl = root.querySelector(`[data-jl-section="${name}"]`);
    if (!oldEl) return;

    // Compute new HTML
    const state = sync.getState();
    if (!state) return;
    const pcs = getParticipants(state);
    const stats = computePCDailyStats(state);
    const newHtml = this._renderSection(name, state, pcs, stats);
    if (!newHtml) return;

    // Capture focus if it's inside this section (preserves typist's draft)
    const focusSnap = this._captureFocus(oldEl);

    // Parse new HTML into a single element and swap it in
    const tpl = document.createElement("template");
    tpl.innerHTML = newHtml.trim();
    const newEl = tpl.content.firstElementChild;
    if (!newEl) return;
    oldEl.replaceWith(newEl);

    // Rebind change listeners on the new section's inputs
    this._bindLiveInputs(newEl);

    // Restore focus + in-progress draft + cursor position
    this._restoreFocus(newEl, focusSnap);
  }

  /** Capture focus state inside a section. Builds a selector from the
   *  active element's data-* attributes (every input in the panorama has
   *  at least one), plus the in-progress value and cursor selection.
   *  Returns null if focus is outside the section or the element has no
   *  data attributes we can target. */
  _captureFocus(sectionEl) {
    const el = document.activeElement;
    if (!el || !sectionEl.contains(el)) return null;
    const attrs = [];
    for (const attrName of el.getAttributeNames()) {
      if (attrName.startsWith("data-")) {
        const v = el.getAttribute(attrName) ?? "";
        // Our data values are controlled (integers, actor ids, fixed field
        // names) — no quotes or backslashes ever land in them. A bad
        // selector throws inside _restoreFocus's try/catch and the focus
        // restore silently bails, which is acceptable behavior.
        attrs.push(`[${attrName}="${v}"]`);
      }
    }
    if (attrs.length === 0) return null;
    return {
      selector: el.tagName.toLowerCase() + attrs.join(""),
      value: el.value,
      selectionStart: typeof el.selectionStart === "number" ? el.selectionStart : null,
      selectionEnd:   typeof el.selectionEnd   === "number" ? el.selectionEnd   : null,
    };
  }

  /** Restore focus, in-progress draft, and cursor position on the new DOM.
   *  The draft value overrides whatever the re-render computed — the
   *  typist's local edit wins until they blur (and SET_X fires). */
  _restoreFocus(sectionEl, snap) {
    if (!snap) return;
    let el;
    try { el = sectionEl.querySelector(snap.selector); }
    catch { return; } // bad selector — give up silently
    if (!el) return;
    if (snap.value != null && "value" in el && el.value !== snap.value) {
      el.value = snap.value;
    }
    try { el.focus(); } catch { /* not focusable */ }
    if (snap.selectionStart != null && typeof el.selectionStart === "number") {
      try { el.setSelectionRange(snap.selectionStart, snap.selectionEnd); }
      catch { /* not a text input */ }
    }
  }

  /** Refresh just the "modifié par X · il y a Ys" textContent without
   *  re-rendering anything. Called on every mutation and every 5 seconds.
   *  Phase 5: prefixes a 🐛 emoji when devMode is on. */
  _refreshLastEditText() {
    const root = this.element;
    if (!root) return;
    const el = root.querySelector("[data-last-edit]");
    if (!el) return;
    const state = sync.getState();
    const devBadge = devLog.isDevMode() ? "🐛 " : "";
    if (!state?.lastUpdatedBy || !state?.lastUpdatedAt) {
      el.textContent = devBadge;
      return;
    }
    const editor = game.users?.get?.(state.lastUpdatedBy)?.name ?? "Inconnu";
    el.textContent = `${devBadge}modifié par ${editor} · ${_formatRelativeTime(Date.now() - state.lastUpdatedAt)}`;
  }

  /* ----- Banner: day name + progress bar + cost pills + Nouveau jour ----- */

  _renderBanner(state) {
    const m = tripMetrics(state.trip);

    // Milestone markers — flag pinned at its percentage with guide line +
    // label. Départ / Destination synthesized; their note holds the location
    // name shown in the tooltip and label.
    const markersHtml = m.configured ? m.markers.map((mk, idx) => {
      const classes = ["jl-ms"];
      if (mk.reached) classes.push("reached");
      if (mk.isCurrent) classes.push("current");
      if (mk.isLast) classes.push("last");
      if (mk.isFirst) classes.push("first");
      if (mk.isFixed === "start") classes.push("jl-ms-start");
      if (mk.isFixed === "end")   classes.push("jl-ms-end");
      classes.push(idx % 2 === 0 ? "jl-ms-stagger-near" : "jl-ms-stagger-far");
      const iconChar = mk.icon || (mk.isFixed === "end" ? "⭐" : (mk.isFixed === "start" ? "🏁" : "•"));
      const headline = mk.note ? `${mk.label} — ${mk.note}` : (mk.label || "(sans nom)");
      const ttLines = [
        headline,
        `${fmtNum(mk.hoursFromStart)} h · ${mk.milesFromStart.toFixed(1)} mi depuis le départ`,
      ];
      if (mk.reachedAt) ttLines.push(`Atteint : ${mk.reachedAt}`);
      const tooltip = escapeHtml(ttLines.join("\n"));
      const labelBelow = mk.isFixed && mk.note ? mk.note : (mk.label || "");
      return `
        <div class="${classes.join(" ")}" style="left:${mk.pct}%" data-marker-id="${escapeHtml(mk.id ?? "")}">
          <div class="jl-ms-line"></div>
          <div class="jl-ms-flag" title="${tooltip}">${escapeHtml(iconChar)}</div>
          <div class="jl-ms-label">${escapeHtml(labelBelow)}</div>
        </div>`;
    }).join("") : "";

    const barInner = m.configured ? `
      <div class="jl-progress-bar ${m.complete ? "jl-complete" : ""}" data-action="editTrip" title="Cliquer pour modifier le voyage">
        <div class="jl-progress-track">
          <div class="jl-progress-fill" data-pct="${m.pct}" style="width:${m.pct}%"></div>
          <div class="jl-progress-text">
            ${fmtNum(m.elapsedH)} / ${fmtNum(m.totalH)} h · ${fmtNum(m.elapsedM)} / ${fmtNum(m.totalM)} mi · ${m.pct}%
          </div>
        </div>
        ${markersHtml}
      </div>` : `
      <div class="jl-progress-bar jl-progress-empty" data-action="editTrip" title="Cliquer pour configurer un voyage">
        <div class="jl-progress-track">
          <div class="jl-progress-text">Aucun voyage défini — cliquer pour configurer</div>
        </div>
      </div>`;

    let subtitleHtml = "";
    if (m.configured && m.complete) {
      subtitleHtml = `<div class="jl-progress-subtitle complete">🎯 Voyage terminé</div>`;
    } else if (m.currentLeg) {
      const cl = m.currentLeg;
      subtitleHtml = `<div class="jl-progress-subtitle">
        Étape ${cl.legIndex + 1}/${cl.legCount} —
        <span class="jl-leg-from">${escapeHtml(cl.from.label || "?")}</span>
        <i class="jl-leg-icon">→</i>
        <span class="jl-leg-to">${escapeHtml(cl.to.label || "?")}</span>
        · ${fmtNum(cl.hoursIntoLeg)} / ${fmtNum(cl.hoursTotal)} h
      </div>`;
    } else if (m.configured) {
      subtitleHtml = `<div class="jl-progress-subtitle">&nbsp;</div>`;
    }

    // Phase 3: last-edit-by indicator + no-GM warning. Both live inside
    // the banner section so they re-render alongside the day-name.
    // Phase 5: prepend a 🐛 badge when devMode is on so the verbose-log
    // state is visible at a glance without opening settings.
    const editor = state.lastUpdatedBy
      ? (game.users?.get?.(state.lastUpdatedBy)?.name ?? "Inconnu")
      : null;
    const devBadge = devLog.isDevMode() ? "🐛 " : "";
    const editText = editor && state.lastUpdatedAt
      ? `${devBadge}modifié par ${escapeHtml(editor)} · ${_formatRelativeTime(Date.now() - state.lastUpdatedAt)}`
      : (devBadge ? `${devBadge}` : "");
    const noGM = !sync.isGMOnline();
    const noGMHtml = noGM
      ? `<div class="jl-no-gm-warn" title="Aucun GM n'est connecté — les modifications restent en mémoire chez les clients connectés, mais ne sont pas écrites dans le monde tant qu'un GM n'est pas en ligne.">
           <i class="fa-solid fa-triangle-exclamation"></i> GMC est hors ligne · sauvegarde en attente
         </div>`
      : "";

    return `
      <div class="jl-banner">
        <div class="jl-banner-title">
          <i class="fa-solid fa-book"></i>
          <div class="jl-banner-title-stack">
            <input type="text" class="jl-day-name" data-field="dayName"
              value="${escapeHtml(state.dayName)}" placeholder="Nom du jour / lieu (ex. Forêt sombre, jour 4)"/>
            <div class="jl-last-edit" data-last-edit>${editText}</div>
          </div>
        </div>
        <div class="jl-progress-wrap">
          <div class="jl-progress-stack">
            ${barInner}
            ${subtitleHtml}
          </div>
          <button type="button" class="jl-icon-btn jl-progress-edit" data-action="editTrip" title="Modifier le voyage">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </div>
        <div class="jl-cost-pills">
          <span class="jl-pill"><i class="fa-solid fa-drumstick-bite"></i> 4 lb nourriture</span>
          <span class="jl-pill"><i class="fa-solid fa-droplet"></i> 3 utilisations d'eau</span>
        </div>
        <div class="jl-actions">
          ${noGMHtml}
          ${game.user?.isGM ? `
            <button type="button" class="jl-btn jl-ghost" data-action="openParticipants" title="Gérer les participants du voyage (PJ, PNJ, véhicules) — GM uniquement">
              <i class="fa-solid fa-users"></i> Participants
            </button>` : ""}
          <button type="button" class="jl-btn jl-ghost" data-action="newDay" title="Réinitialiser à un nouveau jour (voyage conservé)">
            <i class="fa-solid fa-rotate-left"></i> Nouveau jour
          </button>
        </div>
      </div>`;
  }

  /* ----- Legend strip ----- */

  _renderLegend() {
    const items = Object.entries(TAGS).map(([k, t]) =>
      `<span class="jl-legend-item" title="${escapeHtml(t.rule)}">${t.glyph} ${t.label}</span>`
    ).join("");
    return `<div class="jl-legend">${items}</div>`;
  }

  /* ----- Column header (reused by every phase) ----- */

  _columnHeader(phase) {
    return `
      <div class="jl-column-header">
        <div class="jl-time-circle">${escapeHtml(phase.duration)}</div>
        <div class="jl-phase-title">
          <i class="jl-phase-icon ${phase.icon}"></i>${escapeHtml(phase.label)}
        </div>
        ${phase.cost ? `<div class="jl-phase-cost">${escapeHtml(phase.cost)}</div>` : ""}
      </div>`;
  }

  /* ----- Réveil + Petit-déjeuner + Midi: roleplay-only columns ----- */

  _renderReveil(state) {
    const phase = PHASES_BY_KEY.get("reveil");
    return `
      <div class="jl-column" style="width:${phase.width}px">
        ${this._columnHeader(phase)}
        <div class="jl-mini-section">
          <h4><i class="fa-solid fa-feather"></i> Roleplay</h4>
          <div style="font-size:0.82rem;">
            Le groupe s'éveille. Aucun coût. GMC décrit l'aube et l'ambiance.
          </div>
        </div>
        <div class="jl-mini-section">
          <h4><i class="fa-solid fa-bed"></i> Effets du repos</h4>
          <div style="font-size:0.82rem;">
            Le repos long s'achève : Appuyé sur Short ou Long Rest (dépendemment de votre level), Roulé vos Hit Dices et utilisé le Spell Slot Point Recovery System.
            ${state.camp.qualities.confortable || state.camp.qualities.confortableImproved
              ? `<br/><em>Camp ${state.camp.qualities.confortableImproved ? "Confortable amélioré" : "Confortable"} : ${state.camp.qualities.confortableImproved ? "+2 dés de vie, -1 fatigue" : "+1 dé de vie"}.</em>`
              : ""}
          </div>
        </div>
      </div>`;
  }

  _renderPetitDej(state) {
    const phase = PHASES_BY_KEY.get("petitDej");
    return `
      <div class="jl-column" style="width:${phase.width}px">
        ${this._columnHeader(phase)}
        <div class="jl-mini-section">
          <h4><i class="fa-solid fa-mug-saucer"></i> Repas</h4>
          <div style="font-size:0.82rem;">1 lb de nourriture par personne. Roleplay autour du repas.</div>
        </div>
        <div class="jl-mini-section">
          <h4><i class="fa-solid fa-box-archive"></i> Démontage</h4>
          <div style="font-size:0.82rem;">Le camp est plié. Si Caché ou Piégé, les protections sont récupérées ou laissées sur place.</div>
        </div>
      </div>`;
  }

  _renderMidi(state) {
    const phase = PHASES_BY_KEY.get("midi");
    return `
      <div class="jl-column" style="width:${phase.width}px">
        ${this._columnHeader(phase)}
        <div class="jl-mini-section">
          <h4><i class="fa-solid fa-utensils"></i> Repas de midi</h4>
          <div style="font-size:0.82rem;">1 lb de nourriture par personne. Repos roleplay.</div>
        </div>
      </div>`;
  }

  /* ----- Étape 1 / 2: activity assignment columns ----- */

  _renderEtape(state, legKey, pcs) {
    const phase = PHASES_BY_KEY.get(legKey);
    const hasNavigator = (state[legKey]?.assignments?.naviguer ?? []).length > 0;
    const eclaireurActive = isEclaireurActive(state, legKey);

    return `
      <div class="jl-column" style="width:${phase.width}px">
        ${this._columnHeader(phase)}
        ${!hasNavigator
          ? `<div class="jl-warn-banner">⚠️ Naviguer requis. Au moins un PJ doit naviguer pour avancer.</div>`
          : ""}
        ${eclaireurActive
          ? `<div class="jl-info-banner">🛡️ Éclaireur actif — +5 aux alliés Chasse / Trouver eau (à appliquer manuellement).</div>`
          : ""}
        <div class="jl-activities">
          ${TRAVEL_ACTIVITIES.map((a) => this._renderActivity(state, legKey, a, pcs)).join("")}
        </div>
      </div>`;
  }

  /* ----- Soir: evening activities ----- */

  _renderSoir(state, pcs) {
    const phase = PHASES_BY_KEY.get("soir");
    return `
      <div class="jl-column" style="width:${phase.width}px">
        ${this._columnHeader(phase)}
        <div class="jl-activities">
          ${EVENING_ACTIVITIES.map((a) => this._renderActivity(state, "soir", a, pcs)).join("")}
        </div>
      </div>`;
  }

  /* ----- Activity card — used by both étape columns and soir ----- */

  _renderActivity(state, phaseKey, activity, pcs) {
    const asg = state[phaseKey]?.assignments?.[activity.key] || [];
    const isCiblee = (activity.tags || []).includes("ciblee");
    const atCap = isCiblee && asg.length >= 2;

    // Phase 2.1 #6 — phase-level uniqueness: the picker hides anyone already
    // assigned to ANY activity in this column, not just this activity. The
    // mutation handler enforces the same rule (see applyAddAssignment).
    const phaseAssignments = state[phaseKey]?.assignments || {};
    const phaseAssignedIds = new Set();
    for (const list of Object.values(phaseAssignments)) {
      for (const x of list || []) phaseAssignedIds.add(x.actorId);
    }
    const opts = ['<option value="">+ ajouter</option>']
      .concat(pcs
        .filter((p) => !phaseAssignedIds.has(p.id))
        .map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`))
      .join("");

    const chips = asg.map((x) => {
      const name = actorNameSafe(x.actorId);
      return `
        <div class="jl-assignee">
          <span class="jl-aname" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
          <button type="button" class="jl-rm" data-action="removeAssign"
            data-phase="${phaseKey}" data-activity="${activity.key}" data-actor-id="${x.actorId}"
            title="Retirer">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>`;
    }).join("");

    // Tooltip text — activity desc + tag rules.
    const tagRule = (activity.tags || [])
      .map((k) => `${TAGS[k]?.glyph ?? ""} ${TAGS[k]?.label ?? ""} — ${TAGS[k]?.rule ?? ""}`)
      .join("\n");
    const tooltipParts = [activity.desc, tagRule].filter(Boolean).join("\n\n");

    // Inline skill label (§10) — muted pastel blue, replaces the deleted
    // skill-picker dropdown.
    const skillLabel = activitySkillLabel(activity);

    return `
      <div class="jl-activity ${activity.mandatory ? "jl-activity-mandatory" : ""}">
        <div class="jl-activity-name" title="${escapeHtml(tooltipParts)}">
          <span>
            ${escapeHtml(activity.label)}${activity.mandatory ? " ★" : ""}
            ${skillLabel ? `<span class="jl-activity-skill">· ${escapeHtml(skillLabel)}</span>` : ""}
          </span>
          <span class="jl-activity-tags">${(activity.tags || []).map((k) => TAGS[k]?.glyph ?? "").join(" ")}</span>
        </div>
        <div class="jl-assignees">${chips}</div>
        ${!atCap ? `
          <div class="jl-add-picker">
            <select data-add-assign
              data-phase="${phaseKey}" data-activity="${activity.key}">${opts}</select>
          </div>` : `<div style="font-size:0.74rem;opacity:0.6;text-align:center;margin-top:2px;">(max 2 — ciblée)</div>`}
      </div>`;
  }

  /* ----- Camp: finder grouping + qualities + DCs + traps ----- */

  _renderCamp(state, pcs) {
    const phase = PHASES_BY_KEY.get("camp");

    // Auto-detected from étape 2: scout/watch/idle buckets — informational
    // groupings only, no roll buttons (§6).
    const lastLeg = state.etape2?.assignments || {};
    const scoutIds = new Set((lastLeg.eclaireur || []).map((x) => x.actorId));
    const watchIds = new Set((lastLeg.garde || []).map((x) => x.actorId));
    const assignedToRealTask = new Set();
    for (const k of Object.keys(lastLeg)) {
      if (k === "neRienFaire") continue;
      for (const x of lastLeg[k] || []) assignedToRealTask.add(x.actorId);
    }
    const scouts = [], watchers = [], idles = [];
    for (const p of pcs) {
      if (scoutIds.has(p.id)) scouts.push(p);
      else if (watchIds.has(p.id)) watchers.push(p);
      else if (!assignedToRealTask.has(p.id)) idles.push(p);
    }

    const renderFinderGroup = (label, glyph, modLabel, group, cssMod) => {
      const headerCount = group.length ? ` (${group.length})` : "";
      if (!group.length) {
        return `<div class="jl-finder-group jl-finder-empty jl-finder-${cssMod}">
          <div class="jl-finder-header">${glyph} <strong>${escapeHtml(label)}</strong> · ${escapeHtml(modLabel)}</div>
          <div class="jl-finder-empty-line"><em>aucun</em></div>
        </div>`;
      }
      const rows = group.map((p) => `
        <div class="jl-finder-row">
          <span class="jl-finder-name">${escapeHtml(p.name)}</span>
        </div>`).join("");
      return `<div class="jl-finder-group jl-finder-${cssMod}">
        <div class="jl-finder-header">${glyph} <strong>${escapeHtml(label)}</strong> · ${escapeHtml(modLabel)}${headerCount}</div>
        ${rows}
      </div>`;
    };

    const finderHtml = `
      <p class="jl-finder-note"><i class="fa-solid fa-circle-info"></i> Rôles auto-détectés depuis la 2ᵉ étape du voyage.</p>
      ${renderFinderGroup("Éclaireurs", "🔍", "Investigation",            scouts,   "scout")}
      ${renderFinderGroup("Gardes",      "👁️", "Perception · désavantage", watchers, "watch")}
      ${renderFinderGroup("Libres",      "🌿", "Perception · avantage",    idles,    "idle")}`;

    const qHtml = QUALITIES.map((q) =>
      `<label class="jl-quality-row">
        <input type="checkbox" data-camp-quality="${q.key}" ${state.camp.qualities[q.key] ? "checked" : ""}/>
        <i class="${q.icon}"></i> ${q.label}
      </label>`
    ).join("");

    const trapRows = (state.camp.traps || []).map((t, i) => `
      <div class="jl-trap-row">
        <span style="text-align:center;color:var(--jl-gold);font-family:'IM Fell English SC';">${i + 1}</span>
        <select data-trap-idx="${i}" data-trap-field="type">
          ${TRAP_TYPES.map((tt) => `<option value="${tt.key}" ${tt.key === t.type ? "selected" : ""}>${tt.label}</option>`).join("")}
        </select>
        <input type="number" data-trap-idx="${i}" data-trap-field="dc" value="${escapeHtml(t.dc)}" min="0" placeholder="DC"/>
        <button type="button" class="jl-icon-btn" data-action="removeTrap" data-trap-idx="${i}" title="Retirer"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join("");

    // Phase 2.1 #9b — DC inputs are enabled only when the matching property
    // (standard or improved) is active. Either variant flips the DC live.
    const defendableActive = !!(state.camp.qualities.defendable || state.camp.qualities.defendableImproved);
    const cacheActive      = !!(state.camp.qualities.cache      || state.camp.qualities.cacheImproved);

    // Phase 2.2 #9c — smart camp panel. The derivation reflects what would
    // be auto-applied if both fields are set; when both ARE set the
    // mutation handler has already overwritten qualities to match.
    const smartHtml = this._renderCampSmartPanel(state);

    return `
      <div class="jl-column" style="width:${phase.width}px">
        ${this._columnHeader(phase)}
        <div class="jl-mini-section jl-camp-finder">
          <h4><i class="fa-solid fa-magnifying-glass"></i> Trouver le campement</h4>
          ${finderHtml}
        </div>
        ${smartHtml}
        <div class="jl-mini-section">
          <h4><i class="fa-solid fa-campground"></i> Propriétés</h4>
          ${qHtml}
          <div class="jl-dc-row">
            <label class="${defendableActive ? "" : "jl-dc-disabled"}"><i class="fa-solid fa-shield-halved"></i> DC entrée (Défendable)
              <input type="number" data-camp-field="defendableDC" value="${escapeHtml(state.camp.defendableDC)}" min="0" ${defendableActive ? "" : "disabled"}/></label>
            <label class="${cacheActive ? "" : "jl-dc-disabled"}"><i class="fa-solid fa-eye-slash"></i> DC localiser (Caché)
              <input type="number" data-camp-field="cacheDC" value="${escapeHtml(state.camp.cacheDC)}" min="0" ${cacheActive ? "" : "disabled"}/></label>
          </div>
        </div>
        ${state.camp.qualities.trapped ? `
          <div class="jl-mini-section">
            <h4><i class="fa-solid fa-triangle-exclamation"></i> Pièges (${(state.camp.traps || []).length})</h4>
            ${trapRows}
            <button type="button" class="jl-btn jl-ghost" data-action="addTrap" style="font-size:0.78rem; padding:1px 6px; margin-top:4px;">
              <i class="fa-solid fa-plus"></i> Ajouter
            </button>
          </div>` : ""}
        ${this._renderCampRulesReference()}
      </div>`;
  }

  /* Phase 2.2 #9c — interactive smart panel.
   *
   * Two inputs (result + d6); auto-apply happens inside the mutation
   * handler the moment both are set. The preview line shows what's
   * currently derived from the panel's state — when both fields are
   * populated, that derived state matches the camp.qualities below. */
  _renderCampSmartPanel(state) {
    const smart = state.camp.smartCheck || { result: "", d6: 0 };
    const derived = deriveCampProperties(smart.result, smart.d6);
    const resultDisplay = smart.result === "" ? "" : String(smart.result);
    const d6Display = smart.d6 === 0 ? "" : String(smart.d6);

    let preview;
    if (smart.result === "" && smart.d6 === 0) {
      preview = `<em>Saisir le résultat du jet et lancer le d6 pour attribuer automatiquement les propriétés.</em>`;
    } else if (smart.result === "") {
      preview = `<em>Saisir le résultat du jet pour déterminer le nombre de propriétés.</em>`;
    } else if (smart.d6 === 0) {
      const impPart = derived.improvedCount > 0
        ? ` (dont <strong>${derived.improvedCount}</strong> améliorée${derived.improvedCount > 1 ? "s" : ""})`
        : "";
      preview = derived.count === 0
        ? `Résultat <strong>${escapeHtml(resultDisplay)}</strong> : aucune propriété — campement précaire.`
        : `Résultat <strong>${escapeHtml(resultDisplay)}</strong> : <strong>${derived.count}</strong> propriété${derived.count > 1 ? "s" : ""}${impPart}. <em>Lancer le d6 pour fixer l'ordre.</em>`;
    } else if (derived.count === 0) {
      preview = `Résultat <strong>${escapeHtml(resultDisplay)}</strong> · d6=<strong>${smart.d6}</strong> → aucune propriété (campement précaire).`;
    } else {
      const propsHtml = derived.selected
        .map((s) => `<span class="jl-smart-prop ${s.improved ? "jl-smart-prop-imp" : ""}">${escapeHtml(finderQualityLabel(s.key, s.improved))}</span>`)
        .join(" · ");
      const impPart = derived.improvedCount > 0
        ? ` <span class="jl-smart-imp-tag">★ ${derived.improvedCount} améliorée${derived.improvedCount > 1 ? "s" : ""}</span>`
        : "";
      preview = `
        <div>Résultat <strong>${escapeHtml(resultDisplay)}</strong> · d6=<strong>${smart.d6}</strong> → <strong>${derived.count}</strong> propriété${derived.count > 1 ? "s" : ""}${impPart}</div>
        <div class="jl-smart-props-row">${propsHtml}</div>`;
    }

    return `
      <div class="jl-mini-section jl-camp-smart">
        <h4><i class="fa-solid fa-dice-d20"></i> Résultat du jet de camp</h4>
        <div class="jl-camp-smart-row">
          <label>Résultat :
            <input type="number" data-camp-smart="result" value="${escapeHtml(resultDisplay)}" min="0" placeholder="—"/>
          </label>
        </div>
        <div class="jl-camp-smart-row">
          <label>Ordre (d6) :
            <input type="number" data-camp-smart="d6" value="${escapeHtml(d6Display)}" min="1" max="6" placeholder="1–6"/>
          </label>
          <button type="button" class="jl-btn jl-ghost jl-camp-smart-btn" data-action="rollD6" title="Lancer 1d6 dans le chat">
            <i class="fa-solid fa-dice"></i> 1d6
          </button>
          <button type="button" class="jl-btn jl-ghost jl-camp-smart-btn" data-action="resetCampSmart" title="Effacer le résultat sans toucher aux propriétés">
            <i class="fa-solid fa-eraser"></i> Effacer
          </button>
        </div>
        <div class="jl-camp-smart-preview">${preview}</div>
        <p class="jl-camp-smart-hint">
          <i class="fa-solid fa-circle-info"></i>
          Les propriétés sont attribuées automatiquement dès que résultat <em>et</em> d6 sont renseignés. Modifier ensuite les cases ci-dessous remplace l'attribution automatique localement (jusqu'à la prochaine relance).
        </p>
      </div>`;
  }

  /* Phase 2.1 #9a (trimmed in Phase 2.2 per user feedback) — static
   * reference text. The "Temps requis : 30 minutes" line and the
   * "Qui peut contribuer" contributor list were removed because they
   * duplicate the column header badge and the finder grouping above. The
   * warning was restated to be self-contained. */
  _renderCampRulesReference() {
    return `
      <details class="jl-mini-section jl-camp-rules">
        <summary><i class="fa-solid fa-book-open"></i> Règles : Trouver et établir un camp</summary>
        <div class="jl-camp-rules-body">
          <p class="jl-camp-rules-warn">
            ⚠ Si aucun PJ n'a contribué à la recherche : +1 heure pour un campement précaire (aucune propriété). Si vous n'êtes pas satisfaits : +1 h supplémentaire de marche forcée (+1 épuisement), mais le camp gagne 2 propriétés.
          </p>
          <h5>Résultat du jet → Propriétés obtenues</h5>
          <table class="jl-camp-rules-table">
            <thead><tr><th>Résultat</th><th>Propriétés</th></tr></thead>
            <tbody>
              <tr><td>&lt; 5</td><td>Rien</td></tr>
              <tr><td>10</td><td>1ère propriété</td></tr>
              <tr><td>15</td><td>1ère et 2ème propriétés</td></tr>
              <tr><td>20</td><td>Toutes les propriétés</td></tr>
              <tr><td>25</td><td>Toutes + 1 améliorée</td></tr>
              <tr><td>30</td><td>Toutes + 2 améliorées</td></tr>
            </tbody>
          </table>
          <p><em>L'ordre des propriétés est déterminé par un d6 :</em></p>
          <ul>
            <li>1–2 : <strong>Confortable</strong> en premier</li>
            <li>3–4 : <strong>Défendable</strong> en premier</li>
            <li>5–6 : <strong>Caché</strong> en premier</li>
          </ul>
          <h5>Propriétés</h5>
          <dl class="jl-camp-rules-props">
            <dt>🏕️ Confortable</dt>
            <dd>Camp protégé sauf intempéries extrêmes. Gain de 1 hit dice après le Short Rest.<br/>
              <em>Amélioré :</em> +1 hit dice supplémentaire et réduction de fatigue de 1.</dd>
            <dt>🛡️ Défendable</dt>
            <dd>Barrière naturelle ou position surélevée. Créatures doivent réussir Athletics DC 15 pour entrer.<br/>
              <em>Amélioré :</em> DC augmenté selon le résultat du jet.</dd>
            <dt>👁️ Caché</dt>
            <dd>Camp éloigné ou dissimulé. Créatures doivent réussir Investigation ou Perception DC 15 pour localiser.<br/>
              <em>Amélioré :</em> DC augmenté selon le résultat du jet.</dd>
          </dl>
        </div>
      </details>`;
  }

  /* ----- Nuit: watch shifts ----- */

  _renderNuit(state, pcs) {
    const phase = PHASES_BY_KEY.get("nuit");
    const rows = (state.nuit.watch || []).map((w, i) => {
      const chips = (w.actorIds || []).map((id) => {
        const a = game.actors.get(id);
        // deferred-#10b: small red warning on chip if this PC is being
        // tracked AND is under-rested. Untracked PCs (not in the rest
        // list) get no warning regardless of how many shifts they're on.
        // Non-blocking — assignment still goes through either way.
        const rest = getRestStatus(state, id);
        const warnIcon = (rest.tracked && !rest.sufficient)
          ? `<i class="fa-solid fa-triangle-exclamation jl-watch-warn" title="Sommeil insuffisant (${rest.available} h disponibles, ${rest.required} h requises) — repos long incomplet"></i>`
          : "";
        return `<span class="jl-watch-chip">
          ${warnIcon}${escapeHtml(a?.name ?? "?")}
          <button type="button" class="jl-icon-btn" data-action="removeWatchPC" data-watch-idx="${i}" data-actor-id="${id}" title="Retirer">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </span>`;
      }).join("");
      const opts = ['<option value="">+ ajouter</option>']
        .concat(pcs.filter((p) => !(w.actorIds || []).includes(p.id)).map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`))
        .join("");
      return `
        <div class="jl-watch-row">
          <span style="text-align:center;color:var(--jl-gold);font-family:'IM Fell English SC';">${i + 1}</span>
          <input type="text" data-watch-idx="${i}" data-watch-field="shift" value="${escapeHtml(w.shift)}"/>
          <button type="button" class="jl-icon-btn" data-action="removeWatch" data-watch-idx="${i}" title="Supprimer ce tour">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <div class="jl-watch-chips">${chips}<select data-watch-add="${i}">${opts}</select></div>
        </div>`;
    }).join("");

    return `
      <div class="jl-column" style="width:${phase.width}px">
        ${this._columnHeader(phase)}
        <div class="jl-mini-section">
          <h4><i class="fa-solid fa-moon"></i> Tours de garde</h4>
          ${rows}
          <button type="button" class="jl-btn jl-ghost" data-action="addWatchShift" style="font-size:0.78rem; padding:1px 6px; margin-top:4px;">
            <i class="fa-solid fa-plus"></i> Ajouter un tour
          </button>
        </div>
        ${this._renderRestRequirements(state, pcs)}
      </div>`;
  }

  /* deferred-#10b — "Repos requis" mini-section.
   *
   * OPT-IN: the list starts empty. Users add specific PCs via the
   * "+ ajouter un personnage" picker. Adding dispatches SET_REST_REQUIREMENT
   * with the default 8 h; removing dispatches REMOVE_REST_REQUIREMENT.
   * Untracked PCs are invisible here, don't warn on watch chips, and are
   * skipped in the day recap (chat.js checks status.tracked).
   *
   * Each tracked row: name · number input (or disabled when "Aucun") ·
   * "Aucun" checkbox · ✕ remove button · live status line. Watch
   * assignments anywhere in the column update each tracked PC's status
   * via the nuit-column re-render (ADD_WATCH_PC etc. include "nuit"). */
  _renderRestRequirements(state, pcs) {
    if (!pcs.length) return "";

    // Partition PCs into tracked (already in restRequirements) vs. not.
    const tracked = pcs.filter((p) => getRestStatus(state, p.id).tracked);
    const untracked = pcs.filter((p) => !getRestStatus(state, p.id).tracked);

    const rows = tracked.map((pc) => {
      const required = getRestRequirement(state, pc.id);
      const status = getRestStatus(state, pc.id);
      const isNone = required === null;
      // When "Aucun" is checked, the disabled input still needs a value
      // so unchecking has a sensible number to revert to.
      const hoursDisplay = isNone ? DEFAULT_REQUIRED_HOURS : required;

      let statusText, statusClass;
      if (status.required === null) {
        statusText = "Aucun repos requis ✓";
        statusClass = "jl-rest-status-ok";
      } else if (status.sufficient) {
        statusText = `✓ ${status.available} h de repos · suffisant`;
        statusClass = "jl-rest-status-ok";
      } else {
        statusText = `⚠ ${status.available} h de repos · insuffisant (besoin de ${status.required} h)`;
        statusClass = "jl-rest-status-warn";
      }

      return `
        <div class="jl-rest-row" data-rest-actor="${escapeHtml(pc.id)}">
          <div class="jl-rest-row-main">
            <span class="jl-rest-name" title="${escapeHtml(pc.name)}">${escapeHtml(pc.name)}</span>
            <input type="number" class="jl-rest-input" data-rest-hours
              value="${hoursDisplay}" min="0" max="24" step="1"
              ${isNone ? "disabled" : ""}/>
            <label class="jl-rest-none-toggle" title="Cette créature n'a pas besoin de dormir">
              <input type="checkbox" data-rest-none ${isNone ? "checked" : ""}/> Aucun
            </label>
            <button type="button" class="jl-icon-btn jl-rest-remove"
              data-action="removeRestRequirement" data-actor-id="${escapeHtml(pc.id)}"
              title="Retirer du suivi">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <div class="jl-rest-status ${statusClass}">${statusText}</div>
        </div>`;
    }).join("");

    // "+ ajouter un personnage" picker — only PCs not already tracked.
    const addPicker = untracked.length
      ? `<div class="jl-add-picker" style="margin-top:6px;">
           <select data-rest-add>
             <option value="">+ ajouter un personnage</option>
             ${untracked.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("")}
           </select>
         </div>`
      : "";

    const listBody = rows || `<div class="jl-finder-empty-line"><em>Aucun personnage suivi.</em></div>`;

    return `
      <div class="jl-mini-section">
        <h4><i class="fa-solid fa-bed"></i> Repos requis</h4>
        <p class="jl-finder-note" style="margin-top:0;"><i class="fa-solid fa-circle-info"></i> Nuit = 10 h. Chaque tour de garde coûte 2 h de sommeil.</p>
        <div class="jl-rest-list">${listBody}</div>
        ${addPicker}
      </div>`;
  }

  /* ----- Footer: day-recap publish button (Phase 4) -----
   *
   * Single button — the "Afficher à tous" popup-on-every-client behavior
   * from the macro is removed per DESIGN.md §8. Any user can publish;
   * the chat card uses the standard ChatMessage.create from whoever
   * clicked. Milestone-crossed and trip-progress cards are auto-fired
   * GM-side from sync.js (§8.2) — not from this button. */
  _renderFooter(state) {
    return `
      <div class="jl-footer">
        <button type="button" class="jl-btn" data-action="postDayRecap" title="Publier le récapitulatif du jour dans le chat">
          <i class="fa-solid fa-comments"></i> Publier le récap du jour
        </button>
      </div>`;
  }

  /* ----- Roster (épuisante / distrayante per-PC counters) ----- */

  _renderRoster(state, pcs, stats) {
    const chips = pcs.map((pc) => {
      const s = stats.get(pc.id) ?? { epuisanteCount: 0, distrayanteCount: 0 };
      const exh = s.epuisanteCount;
      const disCount = s.distrayanteCount;
      const disPenalty = disCount * 5;
      const danger = exh >= 2 || disCount > 0;
      const exhTag = exh > 0
        ? `<span class="jl-pc-tag ${exh >= 2 ? "jl-tag-danger" : ""}" title="${exh} activité(s) épuisante(s)">💤 ${exh}</span>`
        : "";
      const disTag = disCount > 0
        ? `<span class="jl-pc-tag jl-tag-danger" title="-${disPenalty} Perception (cumulable)">🔥 -${disPenalty} Perc.</span>`
        : "";
      return `
        <span class="jl-pc-chip ${danger ? "jl-warn" : ""}">
          <span class="jl-pc-name">${escapeHtml(pc.name)}</span>
          ${exhTag}${disTag}
        </span>`;
    }).join("");
    return `<div class="jl-roster">${chips || "<em>Aucun PJ détecté.</em>"}</div>`;
  }

  /* ---------------------------------------------------------------------------
   * Live-input bindings — change events that dispatch mutations
   *
   * Text inputs use `change` (fires on blur) so the user's focus has already
   * left the field by the time the re-render rebuilds the DOM. This is the
   * macro's pattern and is sufficient for Phase 2 (single editor at a time).
   * Phase 3 adds focus-aware section re-render for keystroke-level scenarios.
   * ------------------------------------------------------------------------ */

  _bindLiveInputs(root) {
    // Day name
    const dayNameEl = root.querySelector('[data-field="dayName"]');
    if (dayNameEl) {
      dayNameEl.addEventListener("change", (e) => {
        sync.mutate("SET_DAY_NAME", { dayName: e.target.value });
      });
    }

    // Camp qualities
    root.querySelectorAll("[data-camp-quality]").forEach((el) => {
      el.addEventListener("change", () => {
        sync.mutate("TOGGLE_CAMP_QUALITY", {
          key: el.dataset.campQuality,
          value: el.checked,
        });
      });
    });

    // Camp DC fields
    root.querySelectorAll("[data-camp-field]").forEach((el) => {
      el.addEventListener("change", () => {
        sync.mutate("SET_CAMP_FIELD", {
          field: el.dataset.campField,
          value: el.value,
        });
      });
    });

    // Trap select / DC inputs
    root.querySelectorAll("[data-trap-field]").forEach((el) => {
      el.addEventListener("change", () => {
        sync.mutate("SET_TRAP_FIELD", {
          index: Number(el.dataset.trapIdx),
          field: el.dataset.trapField,
          value: el.value,
        });
      });
    });

    // Add-assignee pickers
    root.querySelectorAll("[data-add-assign]").forEach((el) => {
      el.addEventListener("change", () => {
        const actorId = el.value;
        if (!actorId) return;
        sync.mutate("ADD_ASSIGNMENT", {
          phase: el.dataset.phase,
          activityKey: el.dataset.activity,
          actorId,
        });
      });
    });

    // Watch shift label
    root.querySelectorAll("[data-watch-field]").forEach((el) => {
      el.addEventListener("change", () => {
        sync.mutate("SET_WATCH_SHIFT_LABEL", {
          index: Number(el.dataset.watchIdx),
          value: el.value,
        });
      });
    });

    // Watch add-PC select
    root.querySelectorAll("[data-watch-add]").forEach((el) => {
      el.addEventListener("change", () => {
        const id = el.value;
        if (!id) return;
        sync.mutate("ADD_WATCH_PC", {
          index: Number(el.dataset.watchAdd),
          actorId: id,
        });
      });
    });

    // Phase 2.2 #9c — smart camp panel inputs.
    root.querySelectorAll("[data-camp-smart]").forEach((el) => {
      el.addEventListener("change", () => {
        const field = el.dataset.campSmart;
        if (field === "result") {
          sync.mutate("SET_CAMP_CHECK_RESULT", { value: el.value });
        } else if (field === "d6") {
          sync.mutate("SET_CAMP_D6", { value: el.value });
        }
      });
    });

    // deferred-#10b — per-PC rest requirement inputs (number) + "Aucun"
    // checkboxes. Both controls dispatch SET_REST_REQUIREMENT; the
    // checkbox passes null when checked, the input's current value when
    // unchecked (so unchecking gracefully restores a non-null requirement
    // without inventing a value).
    root.querySelectorAll("[data-rest-hours]").forEach((el) => {
      el.addEventListener("change", () => {
        const row = el.closest("[data-rest-actor]");
        const actorId = row?.dataset.restActor;
        if (!actorId) return;
        const hours = Number(el.value);
        if (!Number.isFinite(hours) || hours < 0) return;
        sync.mutate("SET_REST_REQUIREMENT", { actorId, hours: Math.floor(hours) });
      });
    });
    root.querySelectorAll("[data-rest-none]").forEach((el) => {
      el.addEventListener("change", () => {
        const row = el.closest("[data-rest-actor]");
        const actorId = row?.dataset.restActor;
        if (!actorId) return;
        if (el.checked) {
          sync.mutate("SET_REST_REQUIREMENT", { actorId, hours: null });
        } else {
          const input = row.querySelector("[data-rest-hours]");
          const hours = Math.max(0, Math.floor(Number(input?.value) || DEFAULT_REQUIRED_HOURS));
          sync.mutate("SET_REST_REQUIREMENT", { actorId, hours });
        }
      });
    });

    // deferred-#10b — "+ ajouter un personnage" picker. Selecting a PC
    // dispatches SET_REST_REQUIREMENT with the default initial hours; the
    // PC then appears in the tracked list on next re-render.
    root.querySelectorAll("[data-rest-add]").forEach((el) => {
      el.addEventListener("change", () => {
        const actorId = el.value;
        if (!actorId) return;
        sync.mutate("SET_REST_REQUIREMENT", { actorId, hours: DEFAULT_REQUIRED_HOURS });
      });
    });
  }

  /* ---------------------------------------------------------------------------
   * Action handlers (dispatched from the data-action attribute)
   * ------------------------------------------------------------------------ */

  _onRemoveAssign(event, target) {
    sync.mutate("REMOVE_ASSIGNMENT", {
      phase: target.dataset.phase,
      activityKey: target.dataset.activity,
      actorId: target.dataset.actorId,
    });
  }

  _onAddTrap() {
    sync.mutate("ADD_TRAP", {});
  }

  _onRemoveTrap(event, target) {
    sync.mutate("REMOVE_TRAP", { index: Number(target.dataset.trapIdx) });
  }

  _onRemoveWatchPC(event, target) {
    sync.mutate("REMOVE_WATCH_PC", {
      index: Number(target.dataset.watchIdx),
      actorId: target.dataset.actorId,
    });
  }

  _onAddWatchShift() {
    sync.mutate("ADD_WATCH_SHIFT", {});
  }

  _onRemoveWatch(event, target) {
    sync.mutate("REMOVE_WATCH_SHIFT", { index: Number(target.dataset.watchIdx) });
  }

  async _onNewDay() {
    const ok = await DialogV2.confirm({
      window: { title: "Nouveau jour" },
      content: `<p>Réinitialiser le journal pour démarrer une nouvelle journée ?</p>
                <p><em>L'état du jour sera perdu. La progression du voyage est conservée.</em></p>`,
    });
    if (!ok) return;
    sync.mutate("RESET_DAY", {});
  }

  async _onEditTrip() {
    const state = sync.getState();
    await openTripEditDialog(state.trip);
  }

  /* Phase 2.2 #9c — d6 button posts a real Foundry roll to chat so the
   * order draw is auditable, then stores the result via SET_CAMP_D6 so
   * the smart panel can apply its derivation. */
  async _onRollD6() {
    try {
      const roll = await new Roll("1d6").evaluate();
      await roll.toMessage({
        speaker: { alias: "Journey Ledger" },
        flavor: "Ordre des propriétés du camp (1-2 : Confortable · 3-4 : Défendable · 5-6 : Caché)",
      });
      sync.mutate("SET_CAMP_D6", { value: roll.total });
    } catch (e) {
      console.error("[Journey Ledger] d6 roll failed:", e);
      ui.notifications?.error?.("Le lancer de d6 a échoué — voir la console.");
    }
  }

  _onResetCampSmart() {
    sync.mutate("RESET_CAMP_SMART", {});
  }

  /* deferred-#10b — remove a PC from rest tracking. The entry is deleted
   * from state.restRequirements; the row disappears on next nuit re-render
   * and any watch-chip warning icon for this PC vanishes too. */
  _onRemoveRestRequirement(event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    sync.mutate("REMOVE_REST_REQUIREMENT", { actorId });
  }

  /* Phase 4 — day-recap publish. Any user can fire; the chat post is
   * a single ChatMessage.create from whoever clicks. Auto-cards
   * (milestone-crossed, trip-progress) live in sync.js and route GM-only. */
  async _onPostDayRecap() {
    const state = sync.getState();
    try {
      const html = buildDayRecapHTML(state);
      await ChatMessage.create({
        content: html,
        speaker: { alias: "Journey Ledger" },
      });
      ui.notifications?.info?.("Récapitulatif du jour publié.");
    } catch (e) {
      console.error("[Journey Ledger] postDayRecap failed:", e);
      ui.notifications?.error?.("Échec de la publication du récap. Voir la console.");
    }
  }

  /* v1.1.0 — Participants management. GM-only at the trigger level (the
   * button in _renderBanner is only rendered for game.user.isGM). The
   * dialog itself is permissive, but it's only opened via this handler. */
  async _onOpenParticipants() {
    if (!game.user?.isGM) {
      ui.notifications?.warn?.("Seul le GM peut gérer la liste des participants.");
      return;
    }
    try {
      await openParticipantsDialog();
    } catch (e) {
      console.error("[Journey Ledger] openParticipantsDialog failed:", e);
      ui.notifications?.error?.("Échec de l'ouverture du dialogue. Voir la console.");
    }
  }
}
