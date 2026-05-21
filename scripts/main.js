/* Journey Ledger — module entry point.
 *
 * Phase 2 scope (DESIGN.md §12): registers settings, injects Google Fonts,
 * wires the scene-controls button (Phase 1), loads the cold-start state
 * snapshot via sync.init() in the ready hook so the application has data
 * to render the moment it opens. */

import { JourneyLedger } from "./app.js";
import * as sync from "./sync.js";

const MODULE_ID = "journey-ledger";

Hooks.once("init", () => {
  console.log("%c[Journey Ledger] init", "color:#c9a227;font-weight:bold");
  registerSettings();
  injectFonts();
  exposeApi();
});

Hooks.once("ready", () => {
  // Load the cold-start snapshot from the world Setting into sync's in-
  // memory state. Phase 3 will additionally request a fresh snapshot from
  // any active GM client via socketlib for late-joiners.
  try { sync.init(); }
  catch (e) { console.error("[Journey Ledger] sync.init failed:", e); }

  const version = game.modules.get(MODULE_ID)?.version ?? "?";
  console.log(`%c[Journey Ledger] ready · v${version}`,
              "color:#c9a227;font-weight:bold");
});

/* ---------------------------------------------------------------------------
 * Google Fonts injection
 *
 * Carried over from the macro (journey-ledger.js:275–291). The Cinzel +
 * IM Fell English SC pair powers the parchment / serif look — Foundry's
 * default font stack alone makes the panorama feel wrong. Injected once
 * via the init hook so it's gated on document.head not already having the
 * link tags (defensive against hot module reloads / multi-instance test
 * environments).
 * ------------------------------------------------------------------------ */

function injectFonts() {
  const FONT_MARKER = "journey-ledger-fonts";
  if (document.getElementById(FONT_MARKER)) return;

  const pc1 = document.createElement("link");
  pc1.rel = "preconnect";
  pc1.href = "https://fonts.googleapis.com";
  document.head.appendChild(pc1);

  const pc2 = document.createElement("link");
  pc2.rel = "preconnect";
  pc2.href = "https://fonts.gstatic.com";
  pc2.crossOrigin = "anonymous";
  document.head.appendChild(pc2);

  const fontLink = document.createElement("link");
  fontLink.id = FONT_MARKER;
  fontLink.rel = "stylesheet";
  fontLink.href =
    "https://fonts.googleapis.com/css2?family=IM+Fell+English+SC&family=Cinzel:wght@400;600;700&display=swap";
  document.head.appendChild(fontLink);
}

/* ---------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------ */

function registerSettings() {
  // World-scope shared state. Phase 1 stores nothing meaningful — the real
  // schema (§3) and the GM-debounced commit path (§4.4) land in Phase 2+.
  // onChange stays a no-op by design: live updates run through socketlib
  // once the sync layer is wired (DESIGN.md §4.6).
  game.settings.register(MODULE_ID, "state", {
    name: "Journey Ledger — État partagé",
    hint: "JSON du journal. Modifié automatiquement par le module.",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Per-client window-size persistence — carried over behavior from the
  // macro (DESIGN.md §7.2 "Rebuilt fresh"). The setting key already exists
  // here; the actual save/restore wiring on the ApplicationV2 instance
  // lands when app.js is rebuilt in Phase 2.
  game.settings.register(MODULE_ID, "windowSize", {
    name: "Journey Ledger — Taille de fenêtre",
    scope: "client",
    config: false,
    type: Object,
    default: null,
  });

  // GM-toggleable verbose log gate. Visible in the Foundry settings UI so
  // it can be flipped without touching code when sync misbehaves
  // (DESIGN.md §9.1).
  game.settings.register(MODULE_ID, "devMode", {
    name: "Journey Ledger — Mode développement (logs verbeux)",
    hint: "Journalise chaque mutation, broadcast et snapshot dans la console. À activer si la synchronisation se comporte mal.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}

/* ---------------------------------------------------------------------------
 * Window registry — module-scoped singleton.
 *
 * Replaces the macro's `window.__journeyLedgerInstances` global flag
 * (DESIGN.md §7.2 "Not carried forward"). Lives at module scope so
 * re-running the module entry isn't a concern — ES modules are imported
 * once per page load.
 * ------------------------------------------------------------------------ */

let _instance = null;

export function openLedger() {
  if (_instance?.rendered) {
    _instance.bringToFront();
    return _instance;
  }
  _instance = new JourneyLedger();
  _instance.render(true);
  return _instance;
}

/* ---------------------------------------------------------------------------
 * Scene-controls button (DESIGN.md §13 item 4).
 *
 * v13.351 passes `controls` as an object keyed by control group name (e.g.
 * `tokens`, `templates`, `tiles`, `drawings`, `walls`, `lighting`, etc. — all
 * PLURAL). Each group's `tools` is itself an object keyed by tool name. We
 * append our button to the `tokens` group; if Foundry's shape shifts in
 * future builds, the diagnostic warns surface it instead of silently bailing.
 * ------------------------------------------------------------------------ */

Hooks.on("getSceneControlButtons", (controls) => {
  // v13.351 deprecated SceneControlTool#onClick in favor of #onChange. For
  // a button-style tool, onChange fires once on each press just like the
  // old onClick. We use onChange exclusively to silence the deprecation
  // warning Foundry emits on every controls render.
  const tool = {
    name: "journey-ledger-open",
    title: "Ouvrir Journey Ledger",
    icon: "fa-solid fa-route",
    button: true,
    visible: true,
    // v13.351 callback signature: (event, active). For button-style tools
    // `active` is meaningless (the button doesn't toggle), but matching the
    // documented arity removes any theoretical excuse for Foundry's compat
    // shim to fall through to the deprecated onClick path.
    onChange: (event, active) => {
      try { openLedger(); }
      catch (e) { console.error("[Journey Ledger] openLedger threw:", e); }
    },
  };

  // v13.x: object keyed by group name. The token group is `tokens` (plural).
  // Fall back to legacy singular `token` if a future build flips back.
  const group = controls?.tokens ?? controls?.token;
  if (!group) {
    console.warn(
      "[Journey Ledger] could not locate the 'tokens' scene-control group — button not added.",
      "Available keys:", controls ? Object.keys(controls) : "(none)"
    );
    return;
  }

  const tools = group.tools;
  if (tools && typeof tools === "object" && !Array.isArray(tools)) {
    tools[tool.name] = tool;                       // v13 object-keyed tools
  } else if (Array.isArray(tools)) {
    tools.push(tool);                              // legacy array tools
  } else {
    console.warn(
      "[Journey Ledger] tokens.tools is neither object nor array — button not added.",
      "tools=", tools
    );
  }
});

/* ---------------------------------------------------------------------------
 * Public API surface.
 *
 * Exposes `game.modules.get("journey-ledger").api` for console inspection
 * and for advanced users who want to script against the module without
 * going through the scene-controls button. Kept minimal in Phase 1.
 * ------------------------------------------------------------------------ */

function exposeApi() {
  const mod = game.modules.get(MODULE_ID);
  if (!mod) {
    console.error("[Journey Ledger] module record not found at init — API not exposed");
    return;
  }
  mod.api = {
    moduleId: MODULE_ID,
    openLedger,
    JourneyLedger,
  };
}
