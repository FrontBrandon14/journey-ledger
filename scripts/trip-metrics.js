/* Journey Ledger — trip metrics (pure math over the trip object).
 *
 * REPRODUCE AS-IS (DESIGN.md §7.1) — direct lift from the macro at
 * journey-ledger.js:2030–2210. No architectural changes. */

// IDs used for the synthesized, non-stored Départ / Destination markers.
// Real user-defined milestones get their own randomID at creation time.
export const START_MARKER_ID = "__jl_start__";
export const END_MARKER_ID   = "__jl_end__";

/** Format a number for display: trims trailing zeros and floating-point junk.
 *    5.27999999 → "5.28"  ·  32.00 → "32"  ·  NaN → "0" */
export function fmtNum(n) {
  if (!Number.isFinite(n)) return "0";
  const fixed = n.toFixed(2);
  return fixed.replace(/\.00$/, "").replace(/(\.[0-9]*?)0+$/, "$1");
}

/** Clean a leg-value input string: "" stays "", anything non-numeric → "",
 *  numerics round-trip through fmtNum so the persisted form is canonical. */
export function normalizeLegValue(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return fmtNum(n);
}

/**
 * Compute derived trip metrics from the per-leg milestones array.
 *
 * The user's milestones[] holds ONLY intermediate waypoints, each carrying
 * the LEG from the previous point. We walk them in their stored order
 * (never sorted), accumulate, then prepend a Départ marker and append a
 * Destination marker. Départ and Destination always exist when the trip is
 * "configured" (totalH > 0). Destination's cumulative position equals
 * totalH/totalM, so it visually overlaps the last user waypoint by design.
 *
 * Returns:
 *   - totalH / totalM     : sum of all leg hours/miles
 *   - elapsedH / elapsedM : how far the party is right now
 *   - pct / ratio         : 0..100 / 0..1 of the whole trip
 *   - complete            : at-or-past the final marker
 *   - configured          : at least one leg with totalH > 0
 *   - userMilestones[]    : user's legs + cumulative positions
 *   - markers[]           : Départ + user milestones + Destination, each
 *                           decorated with { pct, reached, isFirst, isLast,
 *                           isCurrent, isFixed }
 *   - currentLeg          : { from, to, legIndex, legCount, hoursIntoLeg,
 *                             hoursTotal, hoursToNext, legPct } | null
 */
export function tripMetrics(trip) {
  const rawMs = Array.isArray(trip?.milestones) ? trip.milestones : [];
  const startNote = typeof trip?.startNote === "string" ? trip.startNote : "";
  const endNote   = typeof trip?.endNote   === "string" ? trip.endNote   : "";
  const elapsedH = Math.max(0, Number(trip?.elapsedHours) || 0);

  // Walk user legs in authored order; build cumulative as we go.
  const userMilestones = [];
  let cumH = 0, cumM = 0;
  for (const m of rawMs) {
    const hLeg = Math.max(0, Number(m.hoursLeg) || 0);
    const mLeg = Math.max(0, Number(m.milesLeg) || 0);
    cumH += hLeg;
    cumM += mLeg;
    userMilestones.push({
      id: m.id,
      label: String(m.label ?? ""),
      icon:  String(m.icon ?? ""),
      note:  String(m.note ?? ""),
      hoursLeg: hLeg,
      milesLeg: mLeg,
      hoursFromStart: cumH,
      milesFromStart: cumM,
      reachedAt: m.reachedAt ?? null,
    });
  }
  const totalH = cumH;
  const totalM = cumM;
  const configured = userMilestones.length >= 1 && totalH > 0;

  const ratio = totalH > 0 ? Math.min(1, elapsedH / totalH) : 0;
  const elapsedM = totalH > 0 ? ratio * totalM : 0;
  const pct = Math.round(ratio * 100);
  const complete = totalH > 0 && elapsedH >= totalH;

  if (!configured) {
    return {
      totalH, totalM, elapsedH, elapsedM, pct, ratio,
      complete, configured, userMilestones, markers: [], currentLeg: null,
    };
  }

  // Build the full marker list in a single pass: Départ + user + Destination.
  const lastIdx = userMilestones.length + 1; // index of Destination marker
  const decorate = (raw, idx, isFixed) => ({
    ...raw,
    isFixed,
    pct: (raw.hoursFromStart / totalH) * 100,
    reached: elapsedH >= raw.hoursFromStart,
    isFirst: idx === 0,
    isLast:  idx === lastIdx,
    isCurrent: false, // patched below once currentLegIndex is known
  });

  const markers = new Array(userMilestones.length + 2);
  markers[0] = decorate({
    id: START_MARKER_ID, label: "Départ", icon: "🏁", note: startNote,
    hoursFromStart: 0, milesFromStart: 0, reachedAt: null,
  }, 0, "start");
  for (let i = 0; i < userMilestones.length; i++) {
    markers[i + 1] = decorate(userMilestones[i], i + 1, false);
  }
  markers[lastIdx] = decorate({
    id: END_MARKER_ID, label: "Destination", icon: "⭐", note: endNote,
    hoursFromStart: totalH, milesFromStart: totalM, reachedAt: null,
  }, lastIdx, "end");

  // Find the current leg: segment [i, i+1] whose interval covers elapsedH.
  // The last segment (last user waypoint → Destination) has zero hours by
  // construction, naturally skipped by the `b > a` guard.
  let currentLegIndex = -1;
  if (!complete) {
    for (let i = 0; i < markers.length - 1; i++) {
      const a = markers[i].hoursFromStart;
      const b = markers[i + 1].hoursFromStart;
      if (b > a && a <= elapsedH && elapsedH < b) {
        currentLegIndex = i;
        break;
      }
    }
  }
  if (currentLegIndex >= 0) markers[currentLegIndex + 1].isCurrent = true;

  let currentLeg = null;
  if (currentLegIndex >= 0) {
    const from = markers[currentLegIndex];
    const to = markers[currentLegIndex + 1];
    const hoursTotal = Math.max(0, to.hoursFromStart - from.hoursFromStart);
    const hoursIntoLeg = Math.max(0, elapsedH - from.hoursFromStart);
    currentLeg = {
      from, to,
      legIndex: currentLegIndex,
      legCount: markers.length - 1,
      hoursIntoLeg,
      hoursTotal,
      hoursToNext: Math.max(0, hoursTotal - hoursIntoLeg),
      legPct: hoursTotal > 0 ? Math.min(100, (hoursIntoLeg / hoursTotal) * 100) : 0,
    };
  }

  return {
    totalH, totalM, elapsedH, elapsedM, pct, ratio,
    complete, configured, userMilestones, markers, currentLeg,
  };
}
