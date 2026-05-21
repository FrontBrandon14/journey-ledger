/* Journey Ledger — trip-edit dialog (calculator + milestone editor).
 *
 * REBUILD from scratch (DESIGN.md §7.2), macro as visual reference. Same
 * dialog structure and same wireTripCalculator behavior as the macro at
 * journey-ledger.js:3570–3766. Key architectural difference: on Save the
 * dialog dispatches a single SET_TRIP mutation through sync.mutate() rather
 * than writing this._state.trip directly. */

import {
  CALC_DISTANCE_OPTIONS, CALC_SPEED_OPTIONS, CALC_TIME_OPTIONS,
  DISTANCE_UNITS, SPEED_UNITS, TIME_UNITS,
} from "./constants.js";
import { fmtNum, normalizeLegValue } from "./trip-metrics.js";
import { escapeHtml, genMilestoneId } from "./helpers.js";
import * as sync from "./sync.js";

/* ===========================================================================
 * Row HTML builders
 *
 * The editor has three row types:
 *   - Fixed Départ row     : icon/label/values locked, note editable
 *   - User milestone row   : everything editable, with reorder + remove
 *   - Fixed Destination row: icon/label locked, totals auto-derived, note editable
 * ======================================================================= */

/** HTML for a single USER waypoint row. Hours/Miles represent the LEG from
 *  the previous waypoint to this one — not cumulative. */
function milestoneRowHtml(ms = {}) {
  const id = ms.id || genMilestoneId();
  const label = escapeHtml(ms.label ?? "");
  const icon  = escapeHtml(ms.icon ?? "");
  const h     = escapeHtml(normalizeLegValue(ms.hoursLeg));
  const mi    = escapeHtml(normalizeLegValue(ms.milesLeg));
  const note  = escapeHtml(ms.note ?? "");
  const reachedAt = ms.reachedAt ?? null;
  return `
    <div class="jl-ms-row" data-ms-row data-ms-id="${escapeHtml(id)}" data-reached-at="${escapeHtml(reachedAt ?? "")}">
      <div class="jl-ms-reorder">
        <button type="button" data-ms-up title="Monter">▲</button>
        <button type="button" data-ms-down title="Descendre">▼</button>
      </div>
      <input type="text"   data-ms-icon class="jl-ms-icon-input" value="${icon}" placeholder="📍" maxlength="4"/>
      <input type="text"   data-ms-label value="${label}" placeholder="Nom du jalon"/>
      <input type="number" data-ms-hours-leg value="${h}"  step="0.5" min="0" placeholder="h"/>
      <input type="number" data-ms-miles-leg value="${mi}" step="0.5" min="0" placeholder="mi"/>
      <input type="text"   data-ms-note value="${note}" placeholder="Note (optionnel)"/>
      <button type="button" data-ms-remove class="jl-ms-remove" title="Supprimer">✕</button>
    </div>`;
}

/** HTML for the fixed Départ row. Note editable; everything else disabled. */
function startRowHtml(startNote = "") {
  return `
    <div class="jl-ms-row jl-ms-row-fixed jl-ms-row-start" data-ms-fixed="start">
      <div class="jl-ms-reorder jl-ms-reorder-spacer"></div>
      <input type="text" class="jl-ms-icon-input" value="🏁" disabled/>
      <input type="text" value="Départ" disabled/>
      <input type="number" value="0" disabled/>
      <input type="number" value="0" disabled/>
      <input type="text" data-start-note value="${escapeHtml(startNote)}" placeholder="Lieu de départ (ex. Rimlost)"/>
      <span class="jl-ms-no-remove" aria-hidden="true"></span>
    </div>`;
}

/** HTML for the fixed Destination row. Totals auto-fill from refreshDerived(). */
function endRowHtml(endNote = "") {
  return `
    <div class="jl-ms-row jl-ms-row-fixed jl-ms-row-end" data-ms-fixed="end">
      <div class="jl-ms-reorder jl-ms-reorder-spacer"></div>
      <input type="text" class="jl-ms-icon-input" value="⭐" disabled/>
      <input type="text" value="Destination" disabled/>
      <input type="number" data-total-hours value="0" disabled/>
      <input type="number" data-total-miles value="0" disabled/>
      <input type="text" data-end-note value="${escapeHtml(endNote)}" placeholder="Lieu d'arrivée"/>
      <span class="jl-ms-no-remove" aria-hidden="true"></span>
    </div>`;
}

/* ===========================================================================
 * Calculator + editor wiring
 *
 * Called from the renderDialogV2 hook on the dialog body. Wires the
 * Speed/Distance/Time solver AND the milestones editor (add/remove/reorder,
 * snap-to-milestone select, live destination totals).
 * ======================================================================= */

function wireTripCalculator(root) {
  const $ = (sel) => root.querySelector(sel);
  const solve = $('[name="calc-solve"]');
  if (!solve) return; // not our dialog

  const distInput  = $('[name="calc-distance"]');
  const distUnit   = $('[name="calc-distance-unit"]');
  const speedInput = $('[name="calc-speed"]');
  const speedUnit  = $('[name="calc-speed-unit"]');
  const timeInput  = $('[name="calc-time"]');
  const timeUnit   = $('[name="calc-time-unit"]');
  const applyBtn   = $('[name="calc-apply"]');
  const applyTarget = $('[name="calc-apply-target"]');
  const msList     = root.querySelector(".jl-ms-editor");
  const msAddBtn   = $('[name="ms-add"]');
  const snapSel    = $('[name="snap-to-milestone"]');
  const elapsedEl  = $('[name="elapsedHours"]');
  const totalHEl   = root.querySelector("[data-total-hours]");
  const totalMEl   = root.querySelector("[data-total-miles]");

  const inBaseUnits = (input, unitEl, table, field) => {
    const v = Number(input.value);
    if (!Number.isFinite(v) || v < 0) return NaN;
    return v * table[unitEl.value][field];
  };

  const recompute = () => {
    const which = solve.value;
    const dM   = inBaseUnits(distInput,  distUnit,  DISTANCE_UNITS, "toMeters");
    const sMps = inBaseUnits(speedInput, speedUnit, SPEED_UNITS,    "toMps");
    const tS   = inBaseUnits(timeInput,  timeUnit,  TIME_UNITS,     "toSeconds");

    if (which === "time" && Number.isFinite(dM) && Number.isFinite(sMps) && sMps > 0) {
      timeInput.value = ((dM / sMps) / TIME_UNITS[timeUnit.value].toSeconds).toFixed(2);
    } else if (which === "distance" && Number.isFinite(sMps) && Number.isFinite(tS)) {
      distInput.value = ((sMps * tS) / DISTANCE_UNITS[distUnit.value].toMeters).toFixed(2);
    } else if (which === "speed" && Number.isFinite(dM) && Number.isFinite(tS) && tS > 0) {
      speedInput.value = ((dM / tS) / SPEED_UNITS[speedUnit.value].toMps).toFixed(2);
    } else {
      if (which === "time")     timeInput.value  = "";
      if (which === "distance") distInput.value  = "";
      if (which === "speed")    speedInput.value = "";
    }
  };

  const updateReadonly = () => {
    const which = solve.value;
    distInput.readOnly  = which === "distance";
    speedInput.readOnly = which === "speed";
    timeInput.readOnly  = which === "time";
    distInput.classList.toggle("jl-calc-output",  which === "distance");
    speedInput.classList.toggle("jl-calc-output", which === "speed");
    timeInput.classList.toggle("jl-calc-output",  which === "time");
  };

  [distInput, distUnit, speedInput, speedUnit, timeInput, timeUnit].forEach((el) => {
    el?.addEventListener("input", recompute);
    el?.addEventListener("change", recompute);
  });
  solve.addEventListener("change", () => { updateReadonly(); recompute(); });

  // Live totals + snap-select rebuild from current row values.
  const refreshDerived = () => {
    if (!msList) return;
    const rows = msList.querySelectorAll("[data-ms-row]");
    let cumH = 0, cumM = 0;
    const snapOpts = [`<option value="">Aller à un jalon…</option>`];
    snapOpts.push(`<option value="0">Départ (0 h)</option>`);
    rows.forEach((r) => {
      cumH += Number(r.querySelector("[data-ms-hours-leg]")?.value) || 0;
      cumM += Number(r.querySelector("[data-ms-miles-leg]")?.value) || 0;
      const label = r.querySelector("[data-ms-label]")?.value || "(sans nom)";
      snapOpts.push(`<option value="${escapeHtml(fmtNum(cumH))}">${escapeHtml(label)} (${escapeHtml(fmtNum(cumH))} h)</option>`);
    });
    snapOpts.push(`<option value="${escapeHtml(fmtNum(cumH))}">Destination (${escapeHtml(fmtNum(cumH))} h)</option>`);
    if (totalHEl) totalHEl.value = fmtNum(cumH);
    if (totalMEl) totalMEl.value = fmtNum(cumM);
    if (snapSel) snapSel.innerHTML = snapOpts.join("");
  };

  snapSel?.addEventListener("change", () => {
    if (snapSel.value !== "" && elapsedEl) {
      elapsedEl.value = snapSel.value;
      snapSel.value = "";
    }
  });

  // Reorder + remove via event delegation on the editor root. Fixed
  // Départ/Destination rows use [data-ms-fixed], so the [data-ms-row]
  // selectors naturally skip them.
  msList?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-ms-row]");
    if (!row || !msList.contains(row)) return;
    if (e.target.closest("[data-ms-up]")) {
      const prev = row.previousElementSibling;
      if (prev && prev.matches("[data-ms-row]")) {
        row.parentNode.insertBefore(row, prev);
        refreshDerived();
      }
    } else if (e.target.closest("[data-ms-down]")) {
      const next = row.nextElementSibling;
      if (next && next.matches("[data-ms-row]")) {
        row.parentNode.insertBefore(next, row);
        refreshDerived();
      }
    } else if (e.target.closest("[data-ms-remove]")) {
      row.remove();
      refreshDerived();
    }
  });

  // Live recompute on leg-value / label changes (input event so totals
  // update while the user types).
  msList?.addEventListener("input", (e) => {
    if (e.target.matches("[data-ms-hours-leg], [data-ms-miles-leg], [data-ms-label]")) {
      refreshDerived();
    }
  });

  // On blur, snap leg values to clean 2-decimal form so the persisted
  // data stays canonical. `blur` doesn't bubble; use `focusout`.
  msList?.addEventListener("focusout", (e) => {
    if (!e.target.matches("[data-ms-hours-leg], [data-ms-miles-leg]")) return;
    const cleaned = normalizeLegValue(e.target.value);
    if (cleaned !== e.target.value) {
      e.target.value = cleaned;
      refreshDerived();
    }
  });

  // Insert a new user row before the Destination fixed row so it joins the
  // end of the user-rows block (not after the locked footer).
  const appendUserRow = (htmlStr) => {
    if (!msList) return;
    const endRow = msList.querySelector('[data-ms-fixed="end"]');
    if (endRow) endRow.insertAdjacentHTML("beforebegin", htmlStr);
    else        msList.insertAdjacentHTML("beforeend", htmlStr);
  };

  msAddBtn?.addEventListener("click", () => {
    appendUserRow(milestoneRowHtml({}));
    refreshDerived();
  });

  // Calculator "Appliquer" — pushes the solved values into either a new row
  // or the last existing one.
  applyBtn?.addEventListener("click", () => {
    const tS = inBaseUnits(timeInput, timeUnit, TIME_UNITS,     "toSeconds");
    const dM = inBaseUnits(distInput, distUnit, DISTANCE_UNITS, "toMeters");
    const hours = Number.isFinite(tS) ? (tS / 3600) : null;
    const miles = Number.isFinite(dM) ? (dM / DISTANCE_UNITS.mi.toMeters) : null;
    if (hours == null && miles == null) {
      ui.notifications?.warn?.("Calculateur : renseignez au moins le temps ou la distance.");
      return;
    }
    const mode = applyTarget?.value || "new";

    if (mode === "new") {
      appendUserRow(milestoneRowHtml({
        hoursLeg: hours != null ? fmtNum(hours) : "",
        milesLeg: miles != null ? fmtNum(miles) : "",
      }));
      ui.notifications?.info?.("Nouveau jalon ajouté à partir du calculateur.");
    } else if (mode === "last") {
      const rows = msList?.querySelectorAll("[data-ms-row]") ?? [];
      const last = rows[rows.length - 1];
      if (!last) {
        ui.notifications?.warn?.("Aucun jalon à mettre à jour.");
        return;
      }
      const hEl = last.querySelector("[data-ms-hours-leg]");
      const mEl = last.querySelector("[data-ms-miles-leg]");
      if (hEl && hours != null) hEl.value = fmtNum(hours);
      if (mEl && miles != null) mEl.value = fmtNum(miles);
      ui.notifications?.info?.("Dernier jalon mis à jour à partir du calculateur.");
    }
    refreshDerived();
  });

  updateReadonly();
  recompute();
  refreshDerived();
}

/* ===========================================================================
 * Entry point
 *
 * Opens the trip-edit dialog. On Save: dispatches SET_TRIP through sync.
 * On Reset: dispatches RESET_TRIP. On Cancel / dismiss: no mutation.
 * Returns nothing — the app re-renders via its sync subscription.
 * ======================================================================= */

export async function openTripEditDialog(currentTrip) {
  const t = currentTrip ?? { startNote: "", endNote: "", milestones: [], elapsedHours: 0 };

  // Unique marker so the renderDialogV2 hook can identify our dialog body
  // among any other DialogV2 instances open in the same world.
  const marker = `jl-trip-edit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const userRowsHtml = Array.isArray(t.milestones)
    ? t.milestones.map((m) => milestoneRowHtml(m)).join("")
    : "";

  const content = `
    <div class="jl-trip-edit ${marker}">
      <section class="jl-edit-section jl-calc-section">
        <h3><i class="fa-solid fa-calculator"></i> Calculateur Vitesse / Distance / Temps</h3>
        <label class="jl-calc-solve">
          Calculer :
          <select name="calc-solve">
            <option value="time" selected>Temps</option>
            <option value="distance">Distance</option>
            <option value="speed">Vitesse</option>
          </select>
        </label>
        <div class="jl-calc-grid">
          <label>distance =</label>
          <input type="number" name="calc-distance" step="0.01" min="0" placeholder="—"/>
          <select name="calc-distance-unit">${CALC_DISTANCE_OPTIONS}</select>

          <label>speed =</label>
          <input type="number" name="calc-speed" step="0.01" min="0" placeholder="—"/>
          <select name="calc-speed-unit">${CALC_SPEED_OPTIONS}</select>

          <label>time =</label>
          <input type="number" name="calc-time" step="0.01" min="0" placeholder="—"/>
          <select name="calc-time-unit">${CALC_TIME_OPTIONS}</select>
        </div>
        <div class="jl-calc-apply-row">
          <button type="button" name="calc-apply" class="jl-calc-apply">
            <i class="fa-solid fa-arrow-down"></i> Appliquer comme
          </button>
          <select name="calc-apply-target">
            <option value="new" selected>Nouveau jalon</option>
            <option value="last">Mettre à jour le dernier jalon</option>
          </select>
        </div>
        <p class="jl-edit-note">Les valeurs représentent la LONGUEUR d'une étape (distance/temps depuis le jalon précédent).</p>
      </section>

      <section class="jl-edit-section jl-trip-section">
        <h3><i class="fa-solid fa-route"></i> Jalons du voyage</h3>
        <p class="jl-edit-note">
          Renseignez chaque étape avec sa durée/distance <strong>depuis le jalon précédent</strong>.
          Départ et Destination sont automatiques. Vous pouvez nommer le lieu de départ et d'arrivée dans le champ Note.
          L'ordre est conservé tel que vous l'arrangez (utilisez les flèches ▲ ▼).
        </p>
        <div class="jl-ms-editor-head">
          <span></span>
          <span>Icône</span>
          <span>Nom</span>
          <span>Heures</span>
          <span>Miles</span>
          <span>Note</span>
          <span></span>
        </div>
        <div class="jl-ms-editor">
          ${startRowHtml(t.startNote || "")}
          ${userRowsHtml}
          ${endRowHtml(t.endNote || "")}
        </div>
        <div class="jl-ms-add-row">
          <button type="button" name="ms-add"><i class="fa-solid fa-plus"></i> Ajouter un jalon</button>
        </div>

        <hr style="border:none;border-top:1px solid rgba(107,79,42,0.3);margin:10px 0;"/>

        <label class="jl-trip-row">
          <span>Heures écoulées :</span>
          <input type="number" name="elapsedHours" value="${escapeHtml(t.elapsedHours)}" min="0" step="0.5"/>
        </label>
        <div class="jl-snap-row">
          <span>Aller à :</span>
          <select name="snap-to-milestone"><option value="">Aller à un jalon…</option></select>
        </div>
        <p class="jl-edit-note">Les miles parcourus dans la barre sont calculés au prorata des heures écoulées entre les jalons.</p>
      </section>
    </div>`;

  // Bind the calculator + milestone editor once the dialog renders.
  const hookId = Hooks.on("renderDialogV2", (app, html) => {
    const root = html?.querySelector?.(`.${marker}`);
    if (!root) return;
    try { wireTripCalculator(root); }
    catch (e) { console.error("[Journey Ledger] trip-dialog wiring failed:", e); }
  });

  // Collect user milestones from the dialog DOM, in DOM order (no sort).
  // Fixed Départ/Destination rows (data-ms-fixed) are excluded; their notes
  // are read separately.
  const collectMilestones = (formRoot) => {
    const out = [];
    formRoot?.querySelectorAll("[data-ms-row]").forEach((row) => {
      const label = (row.querySelector("[data-ms-label]")?.value ?? "").trim();
      const hStr  = (row.querySelector("[data-ms-hours-leg]")?.value ?? "").trim();
      const mStr  = (row.querySelector("[data-ms-miles-leg]")?.value ?? "").trim();
      const icon  = (row.querySelector("[data-ms-icon]")?.value ?? "").trim();
      const note  = (row.querySelector("[data-ms-note]")?.value ?? "").trim();
      if (!label && hStr === "" && mStr === "" && !note) return;
      out.push({
        id: row.dataset.msId || genMilestoneId(),
        label, icon,
        hoursLeg: Number(normalizeLegValue(hStr)) || 0,
        milesLeg: Number(normalizeLegValue(mStr)) || 0,
        note,
        reachedAt: row.dataset.reachedAt || null,
      });
    });
    return out;
  };

  // Width: prefer 1100px, but cap at 90% of viewport so the dialog stays
  // usable on smaller monitors.
  const dialogWidth = Math.min(1100, Math.max(720, Math.floor((window.innerWidth || 1200) * 0.9)));

  let result;
  try {
    result = await foundry.applications.api.DialogV2.wait({
      window: { title: "Modifier le voyage", icon: "fa-solid fa-route" },
      position: { width: dialogWidth },
      content,
      buttons: [
        {
          action: "save", label: "Mettre à jour", default: true, icon: "fa-solid fa-check",
          callback: (event, button) => {
            const root = button.form?.querySelector?.(`.${marker}`) ?? button.form;
            return {
              kind: "save",
              startNote: (root?.querySelector("[data-start-note]")?.value ?? "").trim(),
              endNote:   (root?.querySelector("[data-end-note]")?.value   ?? "").trim(),
              milestones: collectMilestones(root),
              elapsedHours: Number(button.form.elements.elapsedHours?.value) || 0,
            };
          },
        },
        {
          action: "reset", label: "Réinitialiser le voyage", icon: "fa-solid fa-rotate-left",
          callback: () => ({ kind: "reset" }),
        },
        { action: "cancel", label: "Annuler", icon: "fa-solid fa-xmark" },
      ],
    });
  } catch {
    Hooks.off("renderDialogV2", hookId);
    return;
  } finally {
    Hooks.off("renderDialogV2", hookId);
  }
  if (!result || result === "cancel") return;

  if (result.kind === "reset") {
    sync.mutate("RESET_TRIP", {});
    return;
  }
  if (result.kind === "save") {
    sync.mutate("SET_TRIP", {
      startNote: result.startNote,
      endNote:   result.endNote,
      milestones: result.milestones,
      elapsedHours: Math.max(0, result.elapsedHours),
    });
  }
}
