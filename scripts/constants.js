/* Journey Ledger — static data and pure lookups.
 *
 * REPRODUCE AS-IS from the macro (DESIGN.md §7.1), with three deltas:
 *   - Activity descriptions scrubbed per §11 (mechanical/DC clauses removed)
 *   - The `darkvisionAware` field is dropped from soir activities (no roll engine)
 *   - The `paired` field is dropped from `etreinte` (no joint-roll logic)
 *
 * Skill / ability labels are looked up live via getSkillLabel / getAbilityLabel
 * so the "5e - Custom Abilities & Skills" module's custom Crafting label flows
 * through automatically. */

/* ===========================================================================
 * Crafting integration
 * ======================================================================= */

// Skill keys from the "5e - Custom Abilities & Skills" module. If your
// install uses different keys, change them here — the `getSkillLabel`
// helper reads CONFIG.DND5E.skills live, so the activity-card labels
// track the user-defined custom-skill labels automatically.
export const CRAFTING_SKILL_KEY = "cra";
export const COOKING_SKILL_KEY  = "coo";   // v1.1.1 — Cuisiner / Préserver

/* ===========================================================================
 * Speed / Distance / Time unit tables (calculator dialog)
 * ======================================================================= */

export const DISTANCE_UNITS = {
  mi: { label: "mi", toMeters: 1609.344 },
  ft: { label: "ft", toMeters: 0.3048 },
  km: { label: "km", toMeters: 1000 },
};

export const TIME_UNITS = {
  year:   { label: "year",   toSeconds: 365.25 * 86400 },
  day:    { label: "day",    toSeconds: 86400 },
  hour:   { label: "hour",   toSeconds: 3600 },
  minute: { label: "minute", toSeconds: 60 },
};

export const SPEED_UNITS = {
  mph:   { label: "mi/h",  toMps: 0.44704 },
  fps:   { label: "ft/s",  toMps: 0.3048 },
  knots: { label: "knots", toMps: 0.514444 },
  kph:   { label: "km/h",  toMps: 0.277778 },
};

// Prebuilt option HTML — the unit lists never change at runtime, so building
// once here saves 3 × N string concatenations every time the dialog opens.
export const CALC_DISTANCE_OPTIONS = Object.entries(DISTANCE_UNITS)
  .map(([k, v]) => `<option value="${k}" ${k === "mi" ? "selected" : ""}>${v.label}</option>`).join("");
export const CALC_SPEED_OPTIONS = Object.entries(SPEED_UNITS)
  .map(([k, v]) => `<option value="${k}" ${k === "fps" ? "selected" : ""}>${v.label}</option>`).join("");
export const CALC_TIME_OPTIONS = Object.entries(TIME_UNITS)
  .map(([k, v]) => `<option value="${k}" ${k === "hour" ? "selected" : ""}>${v.label}</option>`).join("");

/* ===========================================================================
 * Camp qualities, trap types, default watch shifts
 * ======================================================================= */

export const QUALITIES = [
  { key: "confortable",         label: "Confortable",          icon: "fa-solid fa-bed" },
  { key: "confortableImproved", label: "Confortable amélioré", icon: "fa-solid fa-bed" },
  { key: "defendable",          label: "Défendable",           icon: "fa-solid fa-shield-halved" },
  { key: "defendableImproved",  label: "Défendable amélioré",  icon: "fa-solid fa-shield-halved" },
  { key: "cache",               label: "Caché",                icon: "fa-solid fa-eye-slash" },
  { key: "cacheImproved",       label: "Caché amélioré",       icon: "fa-solid fa-eye-slash" },
  { key: "trapped",             label: "Piégé",                icon: "fa-solid fa-triangle-exclamation" },
];

export const TRAP_TYPES = [
  { key: "bruyant",      label: "Bruyant (alerte)" },
  { key: "immobilisant", label: "Immobilisant (Sauv. DEX)" },
  { key: "blessant",     label: "Blessant (1d4 perforants)" },
];

export const DEFAULT_SHIFTS = [
  "20h00 – 22h00",
  "22h00 – 00h00",
  "00h00 – 02h00",
  "02h00 – 04h00",
  "04h00 – 06h00",
];

/* ===========================================================================
 * Tag glyphs + tooltip rule text
 * ======================================================================= */

export const TAGS = {
  ciblee:      { glyph: "🔗", label: "Ciblée",      rule: "Max 2 participants. Meilleur résultat des deux; échec partagé." },
  dangereuse:  { glyph: "☠️", label: "Dangereuse", rule: "Risque de séparation et d'agression. À considérer avant d'agir seul." },
  epuisante:   { glyph: "💤", label: "Épuisante",  rule: "Une seconde activité épuisante dans la journée provoque +1 épuisement." },
  distrayante: { glyph: "🔥", label: "Distrayante", rule: "-5 Perception pour le reste de la journée. Cumulable." },
};

/* ===========================================================================
 * Activity definitions
 *
 * Each record:
 *   - key:          unique
 *   - label, desc:  French UI text (desc may be empty for activities whose
 *                   original description was pure roll-outcome text — see §11)
 *   - tags:         subset of TAGS keys
 *   - skill:        dnd5e skill key (sur/ath/ste/prc/inv/prf …) for the
 *                   inline label
 *   - skillChoice:  array of skill keys when the activity offers a player
 *                   choice; the label joins them with " / "
 *   - tool:         informational only (the macro used this for roll flavor;
 *                   kept here for documentation parity)
 *   - ability:      ability check (str/dex/con/int/wis/cha) as fallback
 *                   label source for activities with no skill
 *   - mandatory:    Naviguer — banner warning if absent (DESIGN.md §0 E11)
 * ======================================================================= */

export const TRAVEL_ACTIVITIES = [
  { key: "chasse",        label: "Chasse/pêche et cueillage", tags: ["ciblee", "dangereuse"],
    skill: "sur", tool: "Hunting Trap / Fishing Tackle",
    desc: "Vous cherchez activement nourriture : racines, fruits, insectes, poisson ou petit gibier." },
  { key: "grandeChasse",  label: "Grande chasse et pêche",    tags: ["ciblee", "dangereuse", "epuisante"],
    skillChoice: ["ath", "ste"],
    desc: "Un vrai chasseur cherche un vrai repas, s'aventurant hors du groupe en territoire inconnu." },
  { key: "trouverEau",    label: "Trouver de l'eau",          tags: ["dangereuse"],
    skill: "sur",
    desc: "Vous parcourez la région pour repérer plantes indicatrices, lacs, rivières, traces animales menant à l'eau." },
  { key: "garde",         label: "Monter la garde",           tags: ["ciblee", "dangereuse"],
    skill: "prc",
    desc: "Vous restez vigilant, cherchant tout signe de danger ou de menace sur votre parcours." },
  { key: "naviguer",      label: "Naviguer",                  tags: ["distrayante"],
    tool: "Navigator's Tools", ability: "wis", mandatory: true,
    desc: "Vous guidez le groupe et surveillez les membres s'aventurant ailleurs. Au moins un membre doit l'effectuer." },
  { key: "eclaireur",     label: "Partir en éclaireur",       tags: ["dangereuse", "epuisante", "ciblee"],
    skill: "ste",
    desc: "Vous partez devant pour détecter embuscades, identifier routes avantageuses. +5 aux alliés chassant ou cherchant l'eau." },
  { key: "profilBas",     label: "Profil bas",                tags: ["distrayante"],
    skillChoice: ["ste", "sur"],
    desc: "Vous agissez discrètement pour éviter ou ralentir ennemis et poursuivants." },
  // §11 scrub: "Sur 20+, octroyez 1 inspiration." removed from end of desc.
  { key: "moral",         label: "Rehausser le moral",        tags: ["distrayante"],
    skill: "prf",
    desc: "Mélodies, danses, chants ou histoires. Chaque membre gagne mod CHA + 1d4 PV temporaires." },
  { key: "traquer",       label: "Traquer",                   tags: ["ciblee", "dangereuse"],
    skill: "inv",
    desc: "Vous suivez une créature ou un groupe selon leur discrétion et l'environnement." },
  { key: "trailblaze",    label: "Trailblaze",                tags: ["ciblee", "distrayante", "epuisante"],
    skillChoice: ["ath", "sur"],
    desc: "Vous frayez un chemin à travers un environnement ardu et réduisez la durée du voyage." },
  { key: "neRienFaire",   label: "Ne rien faire",             tags: [],
    desc: "Vous suivez le navigateur sans tâche particulière. À la recherche du camp, vous bénéficiez d'un avantage à votre jet de Perception (vos sens étaient libres en route)." },
];

export const EVENING_ACTIVITIES = [
  // §11 scrub: DC / assistant-mod clauses removed.
  { key: "camoufler",     label: "Camoufler le camp",       tags: ["ciblee", "distrayante"],
    skillChoice: [CRAFTING_SKILL_KEY, "sur", "ste"],
    desc: "Vous effacez le camp du paysage. Le camp devient Caché." },
  // §11 scrub: DC / 20+ damage clauses removed.
  { key: "fortifier",     label: "Fortifier le camp",       tags: ["epuisante", "distrayante"],
    skillChoice: [CRAFTING_SKILL_KEY, "ath", "sur"],
    desc: "Vous transformez les défenses naturelles en position tenable. Ajoute Défendable." },
  { key: "pieges",        label: "Installer des pièges",    tags: ["ciblee", "distrayante"],
    skillChoice: [CRAFTING_SKILL_KEY, "sur", "ste", "inv"],
    desc: "Vous parsemez les abords du camp d'embûches : caltrops, cloches, fosses, branches élastiques. Bruyant / Immobilisant / Blessant." },
  // §11 scrub: "Sinon DC 12 l'accorde." removed (kept verbatim through the +1 HD effect).
  { key: "confort",       label: "Améliorer le confort",    tags: ["ciblee", "epuisante"],
    skillChoice: [CRAFTING_SKILL_KEY, "sur"],
    desc: "Couchages, abri, foyer, bâche. Si Confortable déjà acquis, l'améliore (+1 HD, -1 fatigue)." },
  // §11 scrub: darkvision penalty sentence removed. `darkvisionAware` field dropped.
  { key: "chasseSoir",    label: "Chasse/pêche et cueillage", tags: ["ciblee", "dangereuse", "distrayante"],
    skill: "sur",
    desc: "Comme l'étape, mais de nuit." },
  { key: "grandeChasseSoir", label: "Grande chasse et pêche", tags: ["ciblee", "dangereuse", "distrayante", "epuisante"],
    skillChoice: ["ath", "ste"],
    desc: "Comme l'étape, mais de nuit." },
  { key: "trouverEauSoir", label: "Trouver de l'eau",       tags: ["dangereuse"],
    skill: "sur",
    desc: "Comme l'étape, mais de nuit." },
  // v1.1.1 — food-prep activities. Live between foraging and magic in the
  // evening flow: forage / hunt → cook → preserve → enchant / harmonize.
  { key: "cuisiner",      label: "Cuisiner un repas",       tags: ["ciblee", "distrayante"],
    skill: COOKING_SKILL_KEY,
    desc: "Vous préparez un véritable repas pour le groupe : ingrédients réunis, feu maîtrisé, plats coordonnés. Un assistant peut aider à hacher, mélanger et servir." },
  { key: "preserver",     label: "Préserver les provisions", tags: ["ciblee", "epuisante", "distrayante"],
    skillChoice: [COOKING_SKILL_KEY, "sur"],
    desc: "Vous traitez la nourriture chassée ou récoltée pour la conserver : fumage, salaison, séchage, congélation, fermentation ou autre méthode adaptée à la cargaison." },
  // §11 invented narrative (macro had only DC text — no narrative half).
  { key: "identifier",    label: "Identifier un objet magique", tags: ["epuisante"],
    skill: "arc",
    desc: "Vous étudiez un objet magique pour en révéler l'origine, la nature et les pouvoirs cachés." },
  // §11 scrub: "Pas de jet — temps consacré." removed.
  { key: "harmoniser",    label: "Harmoniser un objet magique", tags: ["distrayante", "epuisante"],
    skill: null,
    desc: "Requiert que l'objet ait été préalablement identifié." },
  { key: "laver",         label: "Se laver",                tags: ["distrayante"],
    skill: null,
    desc: "Nécessite Hygiene Toolkit + source d'eau. -1 épuisement et +3 CHA pendant 24h. Avec massage : -2 épuisement, +10ft, +3 CHA." },
  // `paired: true` dropped — was only consumed by the deleted joint-roll logic.
  { key: "etreinte",      label: "L'étreinte d'un compagnon", tags: ["distrayante"],
    skill: null,
    desc: "Avec un autre PC. Avantage sur tests CHA et sauves peur/charme; +2 et avantage sur jets de destin pendant 24h." },
  { key: "gardeSoir",     label: "Monter la garde",         tags: ["ciblee", "epuisante"],
    skill: "prc",
    desc: "Tour de 2h pendant le repos. Avantage si vous jouez à un jeu de société avec une créature." },
];

/* ===========================================================================
 * Phase descriptors (panorama column data)
 * ======================================================================= */

export const PHASES = [
  { key: "reveil",      label: "Réveil au lever du soleil",            duration: "30 min", cost: null,                      width: 220, icon: "fa-solid fa-sun" },
  { key: "petitDej",    label: "Petit-déjeuner et démontage du camp", duration: "1 h",    cost: "1 lb nourriture",         width: 220, icon: "fa-solid fa-mug-saucer" },
  { key: "etape1",      label: "Première étape du voyage",            duration: "6 h",    cost: "1 utilisation d'eau",     width: 290, icon: "fa-solid fa-route" },
  { key: "midi",        label: "Pause de midi",                       duration: "1 h",    cost: "1 lb nourriture",         width: 200, icon: "fa-solid fa-utensils" },
  { key: "etape2",      label: "Deuxième étape du voyage",            duration: "6 h",    cost: "1 utilisation d'eau",     width: 290, icon: "fa-solid fa-route" },
  { key: "camp",        label: "Trouver et faire un camp",            duration: "30 min", cost: null,                      width: 320, icon: "fa-solid fa-campground" },
  { key: "soir",        label: "Activité du soir",                    duration: "1 h 30", cost: "2 lb nourriture + 1 eau", width: 320, icon: "fa-solid fa-fire" },
  { key: "nuit",        label: "Repos pour la nuit",                  duration: "10 h",   cost: null,                      width: 288, icon: "fa-solid fa-moon" },
];

// O(1) phase lookup
export const PHASES_BY_KEY = new Map(PHASES.map((p) => [p.key, p]));

/* ===========================================================================
 * Skill / ability label resolution
 *
 * Prefers the live CONFIG (which includes custom skills added by the "5e -
 * Custom Abilities & Skills" module) so the inline activity-card label tracks
 * the user's configured names with Foundry i18n applied. Falls back to the
 * FR maps below, then to the raw key.
 * ======================================================================= */

export const SKILL_LABELS_FR = {
  acr: "Acrobaties", ani: "Dressage", arc: "Arcanes", ath: "Athlétisme",
  dec: "Tromperie",  his: "Histoire", ins: "Perspicacité", itm: "Intimidation",
  inv: "Investigation", med: "Médecine", nat: "Nature", prc: "Perception",
  prf: "Représentation", per: "Persuasion", rel: "Religion",
  slt: "Escamotage", ste: "Discrétion", sur: "Survie",
  [CRAFTING_SKILL_KEY]: "Crafting",
  [COOKING_SKILL_KEY]:  "Cooking",
};

export const ABILITY_LABELS_FR = {
  str: "Force", dex: "Dextérité", con: "Constitution",
  int: "Intelligence", wis: "Sagesse", cha: "Charisme",
};

export function getSkillLabel(skillKey) {
  if (!skillKey) return "";
  const cfg = CONFIG?.DND5E?.skills?.[skillKey];
  if (cfg) {
    const raw = typeof cfg === "string" ? cfg : (cfg.label ?? cfg.name ?? "");
    if (raw) {
      try { return game.i18n?.localize?.(raw) ?? raw; }
      catch { return raw; }
    }
  }
  return SKILL_LABELS_FR[skillKey] ?? skillKey;
}

export function getAbilityLabel(abilityKey) {
  if (!abilityKey) return "";
  const cfg = CONFIG?.DND5E?.abilities?.[abilityKey];
  if (cfg) {
    const raw = typeof cfg === "string" ? cfg : (cfg.label ?? cfg.name ?? "");
    if (raw) {
      try { return game.i18n?.localize?.(raw) ?? raw; }
      catch { return raw; }
    }
  }
  return ABILITY_LABELS_FR[abilityKey] ?? abilityKey;
}

/* Inline "what to roll" label for an activity card (DESIGN.md §10).
 *   - `skill`        → single skill label
 *   - `skillChoice`  → joined with " / "
 *   - `ability`      → FR ability label (e.g. Naviguer → "Sagesse")
 *   - otherwise      → "" (Harmoniser, Laver, Étreinte, etc.) */
export function activitySkillLabel(activity) {
  if (!activity) return "";
  if (activity.skill) return getSkillLabel(activity.skill);
  if (Array.isArray(activity.skillChoice) && activity.skillChoice.length)
    return activity.skillChoice.map(getSkillLabel).join(" / ");
  if (activity.ability) return getAbilityLabel(activity.ability);
  return "";
}

/* ===========================================================================
 * Activity lookup
 * ======================================================================= */

export const ACTIVITY_BY_KEY = new Map();
for (const a of TRAVEL_ACTIVITIES) ACTIVITY_BY_KEY.set(a.key, a);
for (const a of EVENING_ACTIVITIES) ACTIVITY_BY_KEY.set(a.key, a);

export function activityById(key) {
  return ACTIVITY_BY_KEY.get(key) ?? null;
}
