/* Journey Ledger — Participants management dialog (v1.1.0).
 *
 * GM-only DialogV2 for editing state.participants. Save-on-close: the
 * dialog accumulates checkbox changes in the DOM, and on Save reads the
 * checked state and dispatches a single SET_PARTICIPANTS mutation.
 * Cancel discards everything.
 *
 * Actor groups: PJ (character), PNJ (npc), Véhicule (vehicle). Each
 * group is a <details open> so the GM can collapse uninteresting types.
 * Sections with zero actors of that type are omitted entirely.
 *
 * Two convenience buttons:
 *   - "Tous les PJ" — checks every character checkbox
 *   - "Aucun" — unchecks everything
 *
 * The mutation handler is permissive (DESIGN.md §3); permission gating
 * lives in the caller (app.js shows the trigger button only for GMs).
 * That's the same model as the rest of the module — last-write-wins,
 * UI-level enforcement. */

import { allCandidateActors, actorTypeLabel, escapeHtml } from "./helpers.js";
import * as sync from "./sync.js";

const { DialogV2 } = foundry.applications.api;

/** Open the GM Participants dialog. Returns a Promise that resolves when
 *  the dialog closes (by either button or escape). The actual state
 *  change happens via SET_PARTICIPANTS dispatched on Save. */
export async function openParticipantsDialog() {
  const state = sync.getState();
  const current = new Set(Array.isArray(state.participants) ? state.participants : []);
  const candidates = allCandidateActors();

  // Group candidates by type, preserving each group's name-sort from
  // allCandidateActors (already sorted globally — within-group order
  // remains alphabetical).
  const groups = { character: [], npc: [], vehicle: [] };
  for (const a of candidates) {
    if (groups[a.type]) groups[a.type].push(a);
  }

  // Unique marker on the dialog body so the renderDialogV2 hook below
  // can target only this dialog (the world may have other DialogV2s).
  const marker = `jl-pp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const renderGroup = (title, type, list) => {
    if (!list.length) return ""; // omit empty groups entirely
    const rows = list.map((a) => `
      <label class="jl-pp-row">
        <input type="checkbox" data-pp-actor-id="${escapeHtml(a.id)}" data-pp-type="${escapeHtml(a.type)}" ${current.has(a.id) ? "checked" : ""}/>
        <span class="jl-pp-name">${escapeHtml(a.name)}</span>
      </label>`).join("");
    return `
      <details class="jl-pp-group" open>
        <summary>${escapeHtml(title)} <span class="jl-pp-count">(${list.length})</span></summary>
        <div class="jl-pp-group-body">${rows}</div>
      </details>`;
  };

  const content = `
    <div class="jl-pp-dialog ${marker}">
      <p class="jl-pp-intro">
        Sélectionnez les participants du voyage. Les acteurs cochés apparaîtront
        dans les listes d'activité, les chips du tour de garde, le repérage du
        camp, la barre de personnages, et le récap quotidien.
      </p>
      ${renderGroup("Personnages-joueurs (PJ)",     "character", groups.character)}
      ${renderGroup("Personnages non-joueurs (PNJ)", "npc",       groups.npc)}
      ${renderGroup("Véhicules",                     "vehicle",   groups.vehicle)}
      <div class="jl-pp-tools">
        <button type="button" class="jl-btn jl-ghost" data-pp-action="select-all-pcs" title="Cocher tous les PJ">
          <i class="fa-solid fa-check-double"></i> Tous les PJ
        </button>
        <button type="button" class="jl-btn jl-ghost" data-pp-action="select-none" title="Tout décocher">
          <i class="fa-solid fa-square"></i> Aucun
        </button>
      </div>
      ${candidates.length === 0 ? `<p class="jl-pp-empty"><em>Aucun acteur de type PJ, PNJ ou véhicule détecté dans ce monde.</em></p>` : ""}
    </div>`;

  // Hook the dialog render to wire the convenience buttons. The hook
  // is removed in the finally block below regardless of how the dialog
  // closes (button / escape / browser close).
  const hookId = Hooks.on("renderDialogV2", (app, html) => {
    const root = html?.querySelector?.(`.${marker}`);
    if (!root) return;
    wireDialog(root);
  });

  try {
    const result = await DialogV2.wait({
      window: { title: "Participants du voyage", icon: "fa-solid fa-users" },
      classes: ["journey-ledger"],
      position: { width: 460 },
      content,
      buttons: [
        {
          action: "save",
          label: "Enregistrer",
          icon: "fa-solid fa-check",
          default: true,
          callback: (event, button) => {
            const root = button.form?.querySelector?.(`.${marker}`) ?? button.form;
            return { kind: "save", participants: collectChecked(root) };
          },
        },
        { action: "cancel", label: "Annuler", icon: "fa-solid fa-xmark" },
      ],
    });

    if (result && result.kind === "save") {
      sync.mutate("SET_PARTICIPANTS", { participants: result.participants });
    }
  } catch {
    // User dismissed via escape — treat as cancel, no-op
  } finally {
    Hooks.off("renderDialogV2", hookId);
  }
}

/** Wire the dialog's convenience buttons (Tous les PJ / Aucun). The
 *  checkboxes themselves are plain HTML — their state is read at Save
 *  time, no per-click handling needed. */
function wireDialog(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-pp-action]");
    if (!btn) return;
    const action = btn.dataset.ppAction;
    if (action === "select-all-pcs") {
      root.querySelectorAll('input[data-pp-type="character"]').forEach((cb) => { cb.checked = true; });
    } else if (action === "select-none") {
      root.querySelectorAll('input[data-pp-actor-id]').forEach((cb) => { cb.checked = false; });
    }
  });
}

/** Read every checked actor checkbox in the dialog and return their ids
 *  as a plain string array. Order is DOM order = group order (character
 *  first, then npc, then vehicle), name-sorted within each group. */
function collectChecked(root) {
  if (!root) return [];
  const out = [];
  root.querySelectorAll('input[data-pp-actor-id]:checked').forEach((cb) => {
    const id = cb.dataset.ppActorId;
    if (id) out.push(id);
  });
  return out;
}
