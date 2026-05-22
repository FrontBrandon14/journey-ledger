# Journey Ledger

Panorama-style "day of travel" tracker for D&D 5e in Foundry VTT v13, with real-time multi-user sync via socketlib.

## What it does

- **8-phase day tracker** — réveil, petit-déjeuner, two travel legs, pause de midi, finding camp, evening activity, overnight rest
- **11 travel activities + 12 evening activities** with the four-tag system (Ciblée 🔗, Dangereuse ☠️, Épuisante 💤, Distrayante 🔥) and inline skill labels
- **Per-leg milestone trip** — animated progress bar with milestone flags, current-leg subtitle, speed/distance/time calculator, automatic milestone-crossed chat cards
- **Smart camp panel** — enter your check result + d6, properties auto-assign with improvement order following the d6 rule (1–2 Confortable / 3–4 Défendable / 5–6 Caché first)
- **Watch shift scheduler** — assignable PCs per shift
- **Per-PC long-rest tracking** — opt-in list. Add a PC, set required hours (default 8, custom number, or "Aucun" for constructs / vampires). Each watch shift costs 2 h of sleep; under-rested PCs flag with a red icon on their watch chip and in the day recap. Persists across "Nouveau jour" — rest needs are per-PC traits, not per-day state.
- **Day recap publishing** — one button posts a full chat recap; any player can publish
- **Real-time multi-user sync** — any connected user can edit any field; every other client sees the change instantly with no GM-relay bottleneck and no window close/reopen

## What's deliberately not included

- **No dice rolls.** Players roll skills from their character sheets — the module is a tracker, not a rules enforcer.
- **No automatic exhaustion application.** Activity-tag counters (💤 / 🔥) display so players know when they've crossed a threshold, but applying the mechanical effect is the GM's call.
- **No per-phase chat publishing.** Only the day recap is a button. Milestone-crossed and trip-progress are fired automatically (GM-side) when the trip changes.

## Requirements

- **Foundry VTT v13** — verified on 13.351
- **[D&D 5e system](https://foundryvtt.com/packages/dnd5e)** 5.3+
- **[socketlib](https://foundryvtt.com/packages/socketlib)** — required dependency for multi-user sync
- Optional: **[5e - Custom Abilities & Skills](https://foundryvtt.com/packages/5e-custom-abilities-and-skills)** if you want the inline "Crafting" skill label to reflect a custom-named skill. Change `CRAFTING_SKILL_KEY` in `scripts/constants.js` if your install uses a different key.

## Installation

In Foundry: **Setup → Add-on Modules → Install Module**. Paste the manifest URL:

```
https://github.com/FrontBrandon14/journey-ledger/releases/latest/download/module.json
```

Enable the module in your world's module list. **socketlib must also be enabled in the same world** — without it, multi-user sync is offline and only single-client editing works.

## Quick start

1. Open the **scene-controls panel** in Foundry (left sidebar). Click the route icon to open Journey Ledger.
2. Click the **progress bar** or the **pencil icon** to open the trip editor. Use the calculator to derive hours/distance, or type leg values directly. Save.
3. As the day progresses, **assign PCs to activities** in each étape column. The Ciblée 2-cap is enforced. A PC assigned to any activity in a column can't be assigned to another activity in the same column.
4. At camp, enter your **check result** + **d6 roll** (use the `🎲 1d6` button or type a value). Properties auto-assign with the improved variants going to the d6-determined first positions. Or skip the smart panel and toggle qualities manually.
5. End of day: click **Publier le récap du jour** in the footer. The recap posts to chat.

## Multi-user editing

Any connected user can edit any field. Edits broadcast via socketlib to every other connected client in real time — no need to close/reopen the ledger window. Last-write-wins on conflicts. The **last-edit indicator** under the day-name field shows who changed what most recently.

The GM client is the only one that writes to the world Setting; non-GM edits route through socketlib's `executeAsGM`. If no GM is online, edits propagate live between connected players but **don't persist** through a full client refresh — a `⚠ GMC est hors ligne · sauvegarde en attente` chip appears in the banner to make this state explicit.

## Troubleshooting

### Multi-user sync isn't working

1. Verify **socketlib** is installed AND enabled in the world.
2. Open the dev console (F12). On every client that has the module loaded, you should see during world init:
   ```
   [Journey Ledger] sync.js loaded — registering socketlib hook
   [Journey Ledger] socketlib registered
   [Journey Ledger] cold snapshot loaded
   ```
   If `socketlib registered` is missing, socketlib isn't loading. Re-enable it.
3. Enable **dev mode** (see below). Edit a field on one client. You should see a `[JL mutation]` log on the originator's console and a `[JL received]` on every other client's console. If the broadcast doesn't fan out, socketlib is mis-configured.

### "GMC est hors ligne · sauvegarde en attente" appears in the banner

No GM user is connected. Edits still propagate between connected players (real-time UI sync works) but the world Setting isn't being written. The next-connecting GM auto-commits the current in-memory state on their first mutation.

### Scene-controls button doesn't appear

The module logs a warning if it can't find the `tokens` scene-control group. Check the console for `[Journey Ledger] could not locate the 'tokens' scene-control group`. Open a GitHub issue with the warning text + your Foundry version.

### Day recap card looks unstyled

The module's CSS may not have loaded. In the **Network** tab, look for `modules/journey-ledger/styles/journey-ledger.css`. If it returned 404, the module is corrupted — reinstall.

### Window opens with old content after editing

The renderer is section-scoped: changing a value re-renders only the affected section, preserving focus and in-progress text everywhere else. If a section appears stale, refresh the browser tab — Foundry occasionally caches ES modules aggressively. `F12 → Network → Disable cache → F5` is the reliable cache-bust.

### Chat-render errors from other modules ("html.find is not a function" etc.)

After Journey Ledger posts a chat card (recap, trip-progress, milestone-crossed), other installed modules' chat hooks may throw errors like:

```
TypeError: html.find is not a function
    at ChatAPI._renderChatMessage (chat-api.js:56:8)
[Detected 2 packages: item-piles(3.3.1), system:dnd5e(5.3.2)]
```

This is a **v13 compatibility issue in the third-party module**, not Journey Ledger. In v13, the `renderChatMessageHTML` hook now passes a plain `HTMLElement` instead of a jQuery wrapper; modules that still call `.find()` (a jQuery method) on it throw.

- The Journey Ledger chat card **still appears in chat** — the error happens *after* message creation, during the third-party module's render hook.
- The `[Detected packages: …]` line in the error identifies the offending module. Update or temporarily disable it.
- Common offenders observed so far: item-piles, item-piles-bagpiles. Both have v13-compatible builds released — make sure you're on the latest version.
- These errors don't affect Journey Ledger's sync, state, or chat output.

## Dev mode

Enable in **Module Settings → Journey Ledger — Mode développement (logs verbeux)**. Effects:

- Every state mutation logs one filterable line with sender, timestamp, payload, and mutation id (`[JL mutation]`).
- Broadcasts, commits, and snapshot transfers log too (`[JL broadcast]`, `[JL commit→GM]`, `[JL commit-wrote]`, `[JL snapshot]`).
- Auto-chat decisions log (`[JL auto-chat]`) — including the "this client isn't the activeGM, skipping" path, useful for verifying single-poster behavior.
- A 🐛 badge appears in the last-edit indicator in the banner so the dev-mode state is visible at a glance.

Each log line is plain `console.log` with a colored tag for easy filtering and copy-paste into bug reports.

## State storage

State lives in a single world Setting named `state` under the `journey-ledger` module. It's a JSON blob; nothing else writes to it. On a fresh install the module writes a default state on the first mutation that successfully reaches the GM client.

The setting is **not migrated from any previous macro** — by design, the module starts clean. If you have data from a pre-module macro version you'd like imported, that's a manual one-off (open an issue).

## License

MIT — see [LICENSE](LICENSE).
