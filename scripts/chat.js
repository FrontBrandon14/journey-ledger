/* Journey Ledger — chat HTML builders + auto-card posters.
 *
 * REBUILD (DESIGN.md §7.2, §8) — macro at journey-ledger.js:2455-2580 as
 * the visual reference. Three deltas:
 *   - The "Apply +1 exhaustion" button on the day recap is REMOVED (§6.4).
 *     Per-PC counts still appear, as text-only.
 *   - Per-phase publishing is GONE (§6.3). buildPhaseSummaryHTML stays as
 *     an internal helper for the day recap; no caller fires it directly.
 *   - postTripUpdate and postMilestoneReached are fired GM-only from
 *     sync.js's mutate path (§8.2) so each event posts exactly once
 *     regardless of which client triggered the SET_TRIP. */

import { PHASES, TRAVEL_ACTIVITIES, EVENING_ACTIVITIES, TAGS, QUALITIES, TRAP_TYPES } from "./constants.js";
import { escapeHtml, actorNameSafe, getParticipants } from "./helpers.js";
import { computePCDailyStats, getRestStatus } from "./stats.js";
import { tripMetrics, fmtNum } from "./trip-metrics.js";

/* ---------------------------------------------------------------------------
 * Phase summary (internal helper)
 * ------------------------------------------------------------------------ */

function tagGlyphs(tagKeys) {
  return (tagKeys || []).map((k) => TAGS[k]?.glyph ?? "").join(" ");
}

function activityAssignmentLine(state, phaseKey, activityList) {
  const out = [];
  const asg = state?.[phaseKey]?.assignments || {};
  for (const a of activityList) {
    const arr = asg[a.key];
    if (!arr || !arr.length) continue;
    const names = arr.map((x) => escapeHtml(actorNameSafe(x.actorId))).join(", ");
    out.push(`<li><strong>${escapeHtml(a.label)}</strong> ${tagGlyphs(a.tags)} — ${names}</li>`);
  }
  return out.length ? `<ul>${out.join("")}</ul>` : `<em>Aucune assignation.</em>`;
}

/** Build the HTML block for one phase. Consumed only by buildDayRecapHTML;
 *  no per-phase publish button exists in the module so this is an internal
 *  helper, not exported for ad-hoc use. */
function buildPhaseSummaryHTML(state, phase) {
  const parts = [];
  parts.push(`<div class="journey-ledger-chat">`);
  const icon = phase.icon ? `<i class="${phase.icon}"></i> ` : "";
  parts.push(`<h2>${icon}${escapeHtml(phase.label)} <span style="font-size:0.85rem;opacity:0.7;">(${escapeHtml(phase.duration)})</span></h2>`);
  if (phase.cost) parts.push(`<div><em>Coût : ${escapeHtml(phase.cost)}</em></div>`);

  if (phase.key === "etape1" || phase.key === "etape2") {
    parts.push(activityAssignmentLine(state, phase.key, TRAVEL_ACTIVITIES));
  } else if (phase.key === "soir") {
    parts.push(activityAssignmentLine(state, phase.key, EVENING_ACTIVITIES));
  } else if (phase.key === "camp") {
    const qLabels = QUALITIES.filter((q) => state?.camp?.qualities?.[q.key]).map((q) => q.label);
    parts.push(`<h3>Propriétés du camp</h3>`);
    if (qLabels.length === 0) {
      parts.push(`<div><em>Camp précaire — aucune propriété notable.</em></div>`);
    } else {
      parts.push(`<div>${qLabels.map((l) => `<span class="jl-tag">${escapeHtml(l)}</span>`).join(" ")}</div>`);
    }
    const dc = [];
    if (state?.camp?.qualities?.defendable && state.camp.defendableDC !== "")
      dc.push(`DC d'entrée (Défendable) : <strong>${escapeHtml(state.camp.defendableDC)}</strong>`);
    if (state?.camp?.qualities?.cache && state.camp.cacheDC !== "")
      dc.push(`DC pour localiser (Caché) : <strong>${escapeHtml(state.camp.cacheDC)}</strong>`);
    if (dc.length) parts.push(`<ul>${dc.map((l) => `<li>${l}</li>`).join("")}</ul>`);
    if (state?.camp?.qualities?.trapped && (state.camp.traps?.length ?? 0) > 0) {
      parts.push(`<h3>Pièges (${state.camp.traps.length})</h3><ul>`);
      for (let i = 0; i < state.camp.traps.length; i++) {
        const t = state.camp.traps[i];
        const typeLabel = TRAP_TYPES.find((x) => x.key === t.type)?.label ?? t.type;
        const dcPart = (t.dc !== "" && t.dc != null) ? ` — DC ${escapeHtml(t.dc)}` : "";
        const note = t.note ? ` <em>(${escapeHtml(t.note)})</em>` : "";
        parts.push(`<li>Piège ${i + 1} : ${escapeHtml(typeLabel)}${dcPart}${note}</li>`);
      }
      parts.push(`</ul>`);
    }
  } else if (phase.key === "nuit") {
    parts.push(`<h3>Tour de Garde</h3><ul>`);
    for (const w of (state?.nuit?.watch || [])) {
      const names = (w.actorIds || []).map(actorNameSafe).map(escapeHtml).join(", ") || "<em>personne</em>";
      parts.push(`<li><strong>${escapeHtml(w.shift)}</strong> — ${names}</li>`);
    }
    parts.push(`</ul>`);
    if (state?.camp?.qualities?.confortable || state?.camp?.qualities?.confortableImproved) {
      parts.push(`<h3>Repos</h3>`);
      if (state.camp.qualities.confortableImproved) {
        parts.push(`<div>Au réveil : <strong>+2 dés de vie</strong> et <strong>-1 fatigue</strong>.</div>`);
      } else {
        parts.push(`<div>Au réveil : <strong>+1 dé de vie</strong>.</div>`);
      }
    }
  }
  parts.push(`</div>`);
  return parts.join("");
}

/* ---------------------------------------------------------------------------
 * Day recap (footer-button trigger; any user can publish)
 * ------------------------------------------------------------------------ */

/** Full day recap. Loops through the significant phases (étape 1, étape 2,
 *  camp, soir, nuit; skips reveil/petitDej/midi as light roleplay phases),
 *  appends a per-PC effects footer. No Apply-Exh button (§6.4 removal).
 *  Any user can fire this from the footer button — single chat post,
 *  whoever clicks. */
export function buildDayRecapHTML(state) {
  const parts = [];
  parts.push(`<div class="journey-ledger-chat">`);
  parts.push(`<h2>📜 Récapitulatif du jour${state.dayName ? ` — ${escapeHtml(state.dayName)}` : ""}</h2>`);

  parts.push(`<h3>Ressources consommées</h3>`);
  parts.push(`<ul><li>4 lb de nourriture</li><li>3 utilisations d'eau</li></ul>`);

  // Significant phases only — light "roleplay" phases (réveil, petit-dej,
  // midi) don't add useful information to the recap.
  for (const phase of PHASES) {
    if (phase.key === "reveil" || phase.key === "petitDej" || phase.key === "midi") continue;
    parts.push(`<h3>${escapeHtml(phase.label)}</h3>`);
    const innerHtml = buildPhaseSummaryHTML(state, phase);
    // Strip the inner wrapper / heading; the h3 above already provides it.
    const matched = innerHtml.match(/<h2[^>]*>.*?<\/h2>(.*)<\/div>$/s);
    parts.push(matched ? matched[1] : innerHtml);
  }

  // Per-PC fatigue + distrayante + rest summary (display-only — no Apply
  // button). deferred-#10b folds rest-insufficient PCs into the same
  // section so the recap surfaces every cumulative concern in one place.
  const pcs = getParticipants(state);
  const stats = computePCDailyStats(state);
  const flags = [];
  for (const pc of pcs) {
    const s = stats.get(pc.id) ?? { epuisanteCount: 0, distrayanteCount: 0 };
    const exh = s.epuisanteCount;
    const disCount = s.distrayanteCount;
    const disPenalty = disCount * 5;
    // deferred-#10b opt-in: only flag rest issues for PCs the user has
    // explicitly added to the rest-tracking list. Untracked PCs are
    // silent in the recap regardless of how many shifts they're on.
    const rest = getRestStatus(state, pc.id);
    const undersleep = rest.tracked && !rest.sufficient;
    if (exh >= 2 || disCount > 0 || undersleep) {
      const exhPart = exh >= 2
        ? ` <span style="color:#a02020">+1 épuisement</span>`
        : (exh === 1 ? ` <em>(1 activité épuisante)</em>` : "");
      const disPart = disCount > 0
        ? ` <em>(-${disPenalty} Perception · ${disCount} distrayante${disCount > 1 ? "s" : ""})</em>`
        : "";
      const restPart = undersleep
        ? ` <span style="color:#a02020">😴 ${rest.available} h de sommeil (besoin ${rest.required} h) — repos long incomplet</span>`
        : "";
      flags.push(`<li><strong>${escapeHtml(pc.name)}</strong>${exhPart}${disPart}${restPart}</li>`);
    }
  }
  if (flags.length) {
    parts.push(`<h3>Effets cumulés</h3>`);
    parts.push(`<ul>${flags.join("")}</ul>`);
  }

  parts.push(`</div>`);
  return parts.join("");
}

/* ---------------------------------------------------------------------------
 * Auto-cards (GM-only fire from sync.js)
 * ------------------------------------------------------------------------ */

/** Fired when the party crosses a milestone (any SET_TRIP that flips a
 *  marker from reached:false → reached:true). Always GM-only, dispatched
 *  by sync.js's _maybeFireTripChat after a SET_TRIP applies. */
export async function postMilestoneReached(state, marker) {
  const isFinal = !!marker.isLast;
  const headline = isFinal ? "🎯 Destination atteinte !" : "🏁 Jalon franchi";
  const iconBig = marker.icon
    ? `<span style="font-size:1.6em;vertical-align:middle;">${escapeHtml(marker.icon)}</span> `
    : "";
  const dayPart = state.dayName ? ` <span style="opacity:0.7;">(${escapeHtml(state.dayName)})</span>` : "";
  const notePart = marker.note
    ? `<div style="margin-top:4px;font-style:italic;opacity:0.9;">${escapeHtml(marker.note)}</div>`
    : "";
  const content = `
    <div class="journey-ledger-chat">
      <h2>${headline}${dayPart}</h2>
      <div>${iconBig}<strong>${escapeHtml(marker.label || "(jalon sans nom)")}</strong></div>
      <div style="opacity:0.85;font-size:0.9em;margin-top:2px;">
        ${fmtNum(marker.hoursFromStart)} h · ${fmtNum(marker.milesFromStart)} mi depuis le départ
      </div>
      ${notePart}
    </div>`;
  try {
    await ChatMessage.create({ content, speaker: { alias: "Journey Ledger" } });
  } catch (e) {
    console.error("[Journey Ledger] postMilestoneReached failed:", e);
  }
}

/** Fired when trip progress changes — elapsedHours moved, or the trip was
 *  just configured for the first time. Always GM-only. */
export async function postTripUpdate(state, reason) {
  const m = tripMetrics(state.trip);
  if (!m.configured) return;
  const editor = state.lastUpdatedBy
    ? (game.users?.get?.(state.lastUpdatedBy)?.name ?? "Inconnu")
    : "Inconnu";
  const completionLine = m.complete
    ? `<div style="color:#426a2a;font-weight:bold;margin-top:4px;">🎯 Voyage terminé !</div>`
    : "";
  const legLine = m.currentLeg
    ? `<div style="opacity:0.85;margin-top:2px;">Étape ${m.currentLeg.legIndex + 1}/${m.currentLeg.legCount} : <strong>${escapeHtml(m.currentLeg.from.label || "?")}</strong> → <strong>${escapeHtml(m.currentLeg.to.label || "?")}</strong> · ${fmtNum(m.currentLeg.hoursIntoLeg)} / ${fmtNum(m.currentLeg.hoursTotal)} h</div>`
    : "";
  const reasonLine = reason
    ? `<div style="font-style:italic;opacity:0.85;margin-top:2px;">${escapeHtml(reason)} <span style="opacity:0.6;">— ${escapeHtml(editor)}</span></div>`
    : "";
  const content = `
    <div class="journey-ledger-chat">
      <h2>📍 Progression du voyage</h2>
      <div><strong>${fmtNum(m.elapsedH)} / ${fmtNum(m.totalH)} h</strong>
           · ${fmtNum(m.elapsedM)} / ${fmtNum(m.totalM)} miles
           · <strong>${m.pct}%</strong></div>
      ${legLine}
      ${reasonLine}
      ${completionLine}
    </div>`;
  try {
    await ChatMessage.create({ content, speaker: { alias: "Journey Ledger" } });
  } catch (e) {
    console.error("[Journey Ledger] postTripUpdate failed:", e);
  }
}
