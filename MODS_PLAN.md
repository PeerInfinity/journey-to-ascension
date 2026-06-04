# Game Mods — Planning Document

Status: **Draft for review** · Branch: `mods` (off `substrate`) · Date: 2026-06-04

## 1. Goal

Add a **"Game Mods"** layer to Journey to Ascension (JtA): a set of opt-in
toggles for balance tweaks, cheat unlocks, extra automation, and
friction reduction — inspired by the mods made to *Prismatic Adventure*
(`~/CC/prismatic_adventure_modified` vs `_original`), but **adapted to
JtA's own mechanics** rather than ported 1:1.

Design principles (carried over from the prismatic mods):

- Every mod is a **toggle**, off by default → original behavior is the default.
- Mod state is **persisted** in the save and **safe to load** from old saves.
- Mods are gated behind a single UI surface (here: a new **Settings**
  section), so they're discoverable but out of the way.

## 2. Source analysis — what the Prismatic mods did

~95% of the prismatic diff is in `game.js` (+1179 / −57 lines), plus CSS
for the new UI. Two parts:

1. **"Game Mods" modal** (a purple button) with 8 toggles: permanently
   unlock automation; enable advanced automation; award serenity on
   discovery; use constant serenity scaling (+ divisor input); disable
   pause on game over; disable serenity-unlocked modal; disable the
   "10 full completions" automation gate.
2. **Collapsible "Advanced Automation" panel** (~12 controls):
   lock automation order, resume on reset, auto-apply armor, enable/disable
   auto-use after N energy resets, disable auto-use on copium reset,
   auto-use Gauntlet (on reset / when even / all-but-one), auto-use Stardust
   on reset (+ target), auto-use Cosmic Shard for an action (+ target),
   stop automation at zone N.

All toggles live in `gameState.gameMods` / `gameState.automation`, are
woven into the reset / game-over / prestige / serenity-formula /
automation-continuation code paths, and are initialized with `??` defaults
in `loadGame`.

## 3. JtA mechanics map (verified, file:line)

| Concern | JtA implementation | Reference |
|---|---|---|
| Prestige currency gain | `calcDivineSparkGain()` → `calcDivineSparkGainFromHighestZone(zone)`; exponential by zone (`PRESTIGE_GAIN_EXPONENT^effective_zone × bonuses × 100`). **No reset-count divisor.** | `simulation.ts:1345`, `:1316`, `:1309` |
| Prestige action | `doPrestige()` | `simulation.ts:1452` |
| Automation modes | `AutomationMode { Off, Zone, All }`; `automation_mode`, `automation_prios`, `automation_end` (**stop-at-zone already built in**), `automation_skip_blocked` | `simulation.ts:1164`, Gamestate `:1634`–`:1637` |
| Automation gate | `PerkType.Amulet` gates `toggleAutomation` and the automation UI. **No "complete zone N times" gate exists.** | `simulation.ts:1180`, `rendering.ts:2177` |
| Permanent automation unlock | `PrestigeUnlockType.PermanentAutomation` (10 sparks) → grants `PerkType.Amulet` via `applyPrestigeUnlockEffects` | `prestige_upgrades.ts:90`, `simulation.ts:1358` |
| Item auto-use | `auto_use_items` flag | Gamestate `simulation.ts:1638` |
| Energy reset | `doEnergyReset()` → `doAnyReset()`; **sets `automation_mode = Off`** at `:787` | `simulation.ts:811`, `:781`, `:787` |
| Game-over / end overlays | `#game-over-overlay` (energy-reset summary), `#end-of-content-overlay`; `is_in_energy_reset`, `is_at_end_of_content` | `rendering.ts:2654`, `:2656`, `:1387` |
| Settings UI pattern | `setupSettings()` wires `#manual-tooltips`, `#skip-blocked`; `updateSettingsDisplay()` updates labels | `rendering.ts:1696`, `:1805`; markup `index.html:121` |
| Save/load | `saveGame()`/`loadGame()`/`loadGameFromData()`; new class fields **auto-serialize and default safely** on old saves. `automation_mode` is deliberately excluded from saves. | `simulation.ts:1522`, `:1575`, `:1593`; `SAVE_VERSION` `:40` |

### Key takeaways for the port

- **Several prismatic mods already exist in JtA** and should be dropped:
  *stop automation at zone* (`automation_end`), *auto-use items* (`auto_use_items`).
- **No serenity / no reset divisor** → "constant serenity scaling + divisor"
  becomes a simpler **prestige-gain multiplier** mod.
- **No "10 completions" gate** → that prismatic toggle has no JtA analogue; drop it.
- Persistence is essentially free: add fields to the `Gamestate` class with
  defaults and they save/load automatically (no migration needed).

## 4. Proposed JtA mod set

Grouped by the four chosen categories. Each row: the toggle, the gamestate
field, where it hooks, and behavior. All default **off** / neutral.

### 4a. Balance tweaks
| Mod | Field | Hook | Behavior |
|---|---|---|---|
| Prestige gain multiplier (+ number input) | `mods.prestige_gain_mult: number = 1` | wrap return of `calcDivineSparkGainFromHighestZone` (`simulation.ts:1342`) | Multiplies divine spark gained. Replaces prismatic's "constant scaling" idea in JtA terms. |
| Free prestige (no zone requirement) | `mods.always_allow_prestige: boolean` | `prestigeAvailable()`/`prestige_available` checks (`simulation.ts:509`, `:1306`) | Lets the player prestige any time. JtA analogue of "award serenity on discovery." |

### 4b. Cheat unlocks
| Mod | Field | Hook | Behavior |
|---|---|---|---|
| Permanently unlock automation | `mods.force_automation: boolean` | grant `PerkType.Amulet` (reuse `tryAddPerk`, `simulation.ts:1359`); re-check on load & on toggle | Same effect as `PermanentAutomation` prestige unlock, for free. Removing the toggle should not strip a *legitimately* earned Amulet (track origin, mirroring the prismatic "don't delete legit unlocks" fix). |
| Unlock all perks *(optional, confirm)* | `mods.unlock_all_perks: boolean` | iterate `PerkType`, `tryAddPerk` | Broad cheat; flagged as optional pending your call. |

### 4c. Extra automation
| Mod | Field | Hook | Behavior |
|---|---|---|---|
| Resume automation on reset | `mods.resume_automation_on_reset: boolean` | `doAnyReset()` `simulation.ts:787` | Capture `automation_mode`/`automation_end` before the reset zeroes them, restore after. |
| Lock automation order | `mods.lock_automation_order: boolean` | `toggleAutomation` (`simulation.ts:1180`) + the right-click handler (`rendering.ts:396`) | Ignore automation toggles/right-clicks so the configured order can't be changed by accident. |
| Auto-use items across resets | `mods.keep_auto_use_items: boolean` | reset path; `auto_use_items` (`simulation.ts:1638`) | Keep `auto_use_items` enabled through resets (JtA analogue of prismatic's per-reset auto-use rules; simpler, no per-item dropdowns). |

### 4d. Friction reducers
| Mod | Field | Hook | Behavior |
|---|---|---|---|
| Auto-continue on energy reset | `mods.auto_continue_energy_reset: boolean` | energy-reset summary trigger / `#game-over-overlay` (`rendering.ts:1309`, `:2654`) | Skip/auto-dismiss the energy-reset summary overlay and continue immediately. |
| Suppress prestige-available popup | `mods.suppress_prestige_popup: boolean` | wherever the prestige-available modal is shown (`simulation.ts:509`-area) | JtA analogue of "disable serenity-unlocked modal." |

> Explicitly **dropped** (already in JtA or no analogue): stop-automation-at-zone,
> manual auto-use-items toggle, disable-10-completions gate,
> gauntlet/stardust/cosmic-shard/armor auto-use (prismatic-specific items).

## 5. Architecture

- **Single namespaced state object.** Add `mods` to the `Gamestate` class
  (`simulation.ts:1621+`) as a small typed object (or a dedicated `GameMods`
  class) with all fields above and neutral defaults. This auto-persists and
  auto-defaults on old saves — confirm Map-vs-object handling in
  `loadGameFromData` (`:1599`) treats a plain object correctly (it should,
  since only `Map` defaults get special handling).
- **Helper accessors** in `simulation.ts` (e.g. `getModMult()`,
  `isModEnabled(flag)`) so call sites stay readable and the feature is easy
  to grep.
- **Effect application** centralized in an `applyMods()` function called on
  load and whenever a toggle changes (mirrors prismatic's `applyPerks()`
  pattern for the "permanent unlock" cheats).
- **Bump `SAVE_VERSION`** (`simulation.ts:40`) when fields land, for clarity
  (not strictly required since defaults are safe).

## 6. UI design (new Settings section)

Per your choice, mods live in the existing **Settings overlay**
(`index.html:121`, `#settings`), not a separate modal.

- Add a `<h2>Game Mods</h2>` subsection with one button per boolean toggle
  (reusing the `#manual-tooltips` / `#skip-blocked` button pattern) and a
  small number input for `prestige_gain_mult`.
- Wire each in `setupSettings()` (`rendering.ts:1696`); update labels in
  `updateSettingsDisplay()` (`rendering.ts:1805`).
- Toggles that change unlocks/automation call `applyMods()` + the relevant
  re-render (`updateRendering`).
- Optional: a collapsible wrapper so the section stays compact (prismatic
  used a collapsible "Automation Settings" panel; JtA's settings overlay may
  not need it — decide during implementation).

## 7. Implementation phases

1. **State + persistence** — add `mods` to `Gamestate`, helpers, `applyMods()`,
   `SAVE_VERSION` bump; verify save/load round-trips and old-save loading.
2. **Settings UI** — markup + `setupSettings`/`updateSettingsDisplay` wiring;
   no behavior yet (toggles flip state only).
3. **Balance + cheat mods** — prestige multiplier, free prestige, force
   automation unlock (+ legit-unlock protection).
4. **Automation + friction mods** — resume-on-reset, lock order, keep
   auto-use, auto-continue reset, suppress popup.
5. **Polish + tests** — see §8.

Each phase is independently buildable (`npx tsc`) and testable in the live
demo.

## 8. Testing

- `npx tsc` clean build after each phase; commit `build/` alongside source
  (the parent repo consumes the committed output — see `README.md`).
- Manual smoke test per toggle in the browser (load `index.html`).
- Save/load regression: enable several mods, reload, confirm state persists;
  load a pre-mods save, confirm defaults apply and nothing breaks.
- Confirm mods stay dormant/irrelevant under substrate managed mode (the
  `?managed` path) so they don't interfere with the AP integration.

## 9. Open questions / decisions deferred

1. **Unlock-all-perks cheat (§4b)** — include it, or keep cheats limited to
   automation unlock?
2. **`prestige_gain_mult` range** — free-form number, or capped/curated set
   (e.g. ×1/×2/×10/×100)?
3. **Collapsible section** — worth the extra UI code, or a flat list under
   the Settings heading?
4. **Interaction with substrate/AP mode** — should mods be hidden or disabled
   entirely when running managed (`?managed`)? Default assumption: leave them
   available but verify no interference.
5. **Relationship to `substrate`** — this branch is off `substrate`; do mods
   eventually merge back, or stay a parallel demo-only branch?
