# Game Mods — Planning Document

Status: **Ready to implement (rev 3)** · Branch: `mods` (off `substrate`, merges back to `substrate`) · Date: 2026-06-04

## 1. Goal

Add a **"Game Mods"** layer to Journey to Ascension (JtA): opt-in toggles
for balance tweaks, cheat unlocks, extra automation, and friction
reduction — inspired by the *Prismatic Adventure* mods
(`~/CC/prismatic_adventure_modified` vs `_original`), **adapted to JtA's own
mechanics** rather than ported 1:1.

This branch is a **first draft**, intended to merge into `substrate` once the
mods work properly.

Design principles:

- Every mod is a **toggle**, off/neutral by default → original behavior is the default.
- Mod state is **persisted** in the save and **safe to load** from old saves.
- Mods must remain **available in substrate/AP managed mode** (`?managed`), and
  be **toggleable via a JS API** so the host can drive them.

## 2. Source analysis — what the Prismatic mods did

~95% of the prismatic diff is in `game.js` (+1179 / −57 lines) plus CSS. Two surfaces:

1. **"Game Mods" modal** (a purple button): 8 toggles — permanently unlock
   automation; enable advanced automation; **award serenity on discovery**;
   use constant serenity scaling (+ divisor); disable pause on game over;
   disable serenity-unlocked modal; disable the "10 completions" gate.
2. **Collapsible "Advanced Automation" panel** (in the play area): resume on
   reset, auto-apply armor, auto-use rules for various items, stop at zone N, etc.

> **Clarification on the prestige mod:** "Award Serenity on Discovery" awarded
> prestige currency *every time the player completed the action that unlocks
> prestige*, instead of only when they manually prestiged. This is the behavior
> we want — **not** "free prestige."

## 3. JtA mechanics map (verified, file:line)

| Concern | JtA implementation | Reference |
|---|---|---|
| Prestige currency gain | `calcDivineSparkGain()` → `calcDivineSparkGainFromHighestZone(zone)`; exponential by zone. **No reset divisor.** | `simulation.ts:1345`, `:1316`, `:1309` |
| Manual prestige (awards + resets) | `doPrestige()`: `divine_spark += calcDivineSparkGain()`, then full reset | `simulation.ts:1452`, award at `:1455` |
| Prestige **unlock** action | When a `TaskType.Prestige` task completes → sets `prestige_available = true` (no spark awarded here) | `simulation.ts:502`–`510` |
| Automation modes | `AutomationMode { Off, Zone, All }`; `automation_mode`, `automation_prios`, `automation_end` (**stop-at-zone already built in**), `automation_skip_blocked` | `simulation.ts:1164`; Gamestate `:1634` |
| Automation gate | **`PerkType.Amulet` is the *only* automation gate** — it unlocks both Zone Automation *and* auto Item use | `perks.ts:126`–`132`; `simulation.ts:1180`; `rendering.ts:2177` |
| Permanent unlock (existing) | `PrestigeUnlockType.PermanentAutomation` (10 sparks) → grants `PerkType.Amulet` | `prestige_upgrades.ts:90`; `simulation.ts:1358` |
| Item auto-use | `auto_use_items` flag (gated by Amulet); reset to false on prestige | Gamestate `:1638`; `simulation.ts:1480` |
| Items | `ItemType` enum incl. `ScrollOfHaste`, `MagicRing`, `BottledLightning`, … | `items.ts` enum |
| Energy reset | `doEnergyReset()` → `doAnyReset()`; **sets `automation_mode = Off`** | `simulation.ts:811`, `:781`, `:787` |
| Game-over / end overlays | `#game-over-overlay` (energy-reset summary), `#end-of-content-overlay`; `is_in_energy_reset`, `is_at_end_of_content` | `rendering.ts:2654`, `:1387` |
| Automation panel rendering | `setupAutomationControls()` builds into `RENDERING.controls_list_element` (= `#controls-list`, right column) | `rendering.ts:2176`, `:2139` |
| Settings UI pattern | `setupSettings()` wires `#manual-tooltips`, `#skip-blocked`; `updateSettingsDisplay()` updates labels | `rendering.ts:1696`, `:1805`; markup `index.html:121` |
| Host API pattern | `window.pauseGameLoop` / `resumeGameLoop` / `setManagedMode` etc. | `game.ts:74`–`104` |
| Save/load | new class fields **auto-serialize and default safely**; `automation_mode` excluded from saves | `simulation.ts:1522`, `:1593`; `SAVE_VERSION` `:40` |

### Takeaways

- **Only `Amulet` gates automation** → the "unlock automation" cheat is simply
  granting `Amulet` (the automation-related perk), nothing broader.
- **No serenity / no reset divisor** → the prestige mod is **award-on-discovery
  with a configurable fraction** (default 10%) of the full gain; manual prestige
  is unchanged and the two stack.
- **Armor ≈ `ScrollOfHaste`.** Other prismatic items may have JtA analogues
  (`MagicRing`, etc.) — to be mapped later.
- **Dropped** (already in JtA or N/A): stop-automation-at-zone (`automation_end`),
  manual auto-use-items toggle, disable-10-completions gate, and **lock
  automation order** (that fixed a Prismatic-only UI bug not present in JtA).

## 4. Proposed JtA mod set

All default off/neutral. Two UI homes (see §6): **Settings** holds the
"Game Mods" toggles (the purple-button set); the **Controls** section holds the
collapsible **Advanced Automation** panel.

### 4a. Settings — "Game Mods" (balance / cheat / friction)

| Mod | Field | Hook | Behavior |
|---|---|---|---|
| Award prestige currency on discovery (+ decimal fraction) | `mods.award_spark_on_discovery = false`, `mods.discovery_spark_fraction = 0.1` | prestige-task completion (`simulation.ts:509`) | When a `TaskType.Prestige` task completes, immediately award `discovery_spark_fraction × calcDivineSparkGain()` divine spark (default 10% of the full prestige amount). **Manual `doPrestige()` is unchanged** — it still awards the full amount, and the two **stack by design** (no double-award guard). Fraction is a **decimal, unbounded**, via `createNumericInput` (`rendering.ts:37`). |
| Permanently unlock automation | `mods.force_automation = false` | grant `PerkType.Amulet` via `tryAddPerk` (`simulation.ts:1359`); re-apply on load & on toggle | Same effect as the `PermanentAutomation` prestige unlock, for free. Toggling off must **not strip a legitimately earned Amulet** — track whether the grant came from the mod (mirrors the prismatic "don't delete legit unlocks" fix). |
| Auto-continue on energy reset | `mods.auto_continue_energy_reset = false` | energy-reset summary / `#game-over-overlay` (`rendering.ts:2654`, `:1309`) | Skip/auto-dismiss the energy-reset summary overlay and continue immediately (friction reducer; analogue of "disable pause on game over"). |
| Suppress prestige-available popup | `mods.suppress_prestige_popup = false` | `EventType.PrestigeAvailable` handling (`simulation.ts:510` → its render event) | JtA analogue of "disable serenity-unlocked modal." |

### 4b. Controls section — "Advanced Automation" (collapsible panel)

Rendered into `controls_list_element` next to the existing Task Automation
controls (`setupAutomationControls`, `rendering.ts:2176`); only shown when
`Amulet` is held (matching the existing automation UI gate).

| Mod | Field | Hook | Behavior |
|---|---|---|---|
| Resume automation on reset | `mods.resume_automation_on_reset = false` | `doAnyReset()` (`simulation.ts:787`) | Capture `automation_mode` + `automation_end` before the reset zeroes them; restore after. |
| Keep auto-use items through prestige | `mods.keep_auto_use_items = false` | `doPrestige()` (`simulation.ts:1480`) | Don't force `auto_use_items` back to false on prestige. |
| Smart auto-use Scroll of Haste | `mods.auto_haste = false` | task-start / energy-drain estimation in automation path | Armor → `ScrollOfHaste` analogue: auto-use a Scroll of Haste ahead of energy-expensive automated tasks. **Scroll of Haste only for now** — exact heuristic TBD during implementation. |

> Scope is **Scroll of Haste only** for this first draft. Other item analogues
> (`MagicRing`, `BottledLightning`, …) are deferred and will be added to this
> panel later.

## 5. Architecture

- **Single namespaced state object.** Add `mods` to the `Gamestate` class
  (`simulation.ts:1621+`) as a typed plain object (or a `GameMods` class) with
  the fields above and neutral defaults. Plain objects auto-persist and
  auto-default on old saves (only `Map` defaults get special handling in
  `loadGameFromData`, `:1599`).
- **Helper accessors** in `simulation.ts` (`getModMult()`, `isModEnabled(flag)`)
  so call sites stay readable and greppable.
- **Centralized `applyMods()`** called on load and whenever a toggle changes
  (handles the `force_automation` perk grant and any re-render), mirroring the
  existing `applyPrestigeUnlockEffects` pattern.
- **Bump `SAVE_VERSION`** (`simulation.ts:40`) when fields land.

## 6. UI design (two homes)

1. **Settings overlay** (`index.html:121`, `#settings`) → the **§4a** "Game
   Mods" toggles. Reuse the `#manual-tooltips` / `#skip-blocked` button pattern
   wired in `setupSettings()` (`rendering.ts:1696`) with labels updated in
   `updateSettingsDisplay()` (`:1805`); use `createNumericInput` for the
   prestige multiplier. Add a `<h2>Game Mods</h2>` subsection in the markup.
2. **Controls section** (right column, `#controls`/`#controls-list`) → a new
   **collapsible "Advanced Automation"** panel built in/after
   `setupAutomationControls()` (`rendering.ts:2176`), gated on `Amulet`. This is
   the JtA home for the **§4b** controls — not the Settings menu.

## 7. Host API (substrate / AP managed mode)

Mods stay available under `?managed`, and the host can drive them. Following the
`game.ts:74`–`104` pattern, expose on `window`:

- `setMod(name: string, value: boolean | number)` / `getMod(name)` — read/write
  any §4a/§4b field by name.
- `getMods()` — return the whole `mods` object (for the host UI to mirror).
- Convenience toggles for the advanced-automation features if the host needs
  them individually.

Each setter routes through `applyMods()` so effects (perk grant, re-render)
apply immediately. Document the name → field mapping next to the API.

## 8. Implementation phases

1. **State + persistence + API** — add `mods` to `Gamestate`, helpers,
   `applyMods()`, `SAVE_VERSION` bump, and the `window` API; verify save/load
   round-trips, old-save loading, and API get/set.
2. **Settings UI (§4a)** — markup + `setupSettings`/`updateSettingsDisplay`
   wiring + numeric input; toggles flip state only.
3. **Cheat + prestige behaviors** — award-on-discovery (fraction of full gain;
   manual prestige unchanged), force-automation unlock (+ legit-unlock protection).
4. **Friction behaviors** — auto-continue energy reset, suppress prestige popup.
5. **Advanced Automation panel (§4b)** — collapsible Controls-section panel:
   resume-on-reset, keep-auto-use, smart Scroll of Haste.
6. **Polish + tests** — see §9.

Each phase builds independently (`npx tsc`) and is testable in the live demo.

## 9. Testing

- `npx tsc` clean build after each phase; commit `build/` alongside source (the
  parent repo consumes the committed output — see `README.md`).
- Manual smoke test per toggle in the browser (`index.html`), plus the `window`
  API from the console.
- Save/load regression: enable several mods, reload, confirm persistence; load a
  pre-mods save, confirm safe defaults.
- Managed-mode check: confirm mods + API work under `?managed` and don't
  interfere with the substrate integration.

## 10. Open questions / decisions

**Resolved:** branch off `substrate` and merges back · mods available in managed
mode + JS API · no "unlock all perks" (automation perk only) · no "lock
automation order" · free-form prestige multiplier · Advanced Automation lives in
the Controls section, Game Mods toggles live in Settings.

Also resolved (rev 3): award-on-discovery grants a **decimal, unbounded
fraction** (default 0.1) of the full gain, and **manual prestige still awards
the full amount** (they stack) · item auto-use is **Scroll of Haste only** for
this draft, other items deferred.

**Still open:** none blocking — remaining specifics (Scroll of Haste heuristic)
are implementation details to settle in Phase 5.
