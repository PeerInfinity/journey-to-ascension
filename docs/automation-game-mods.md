# Game Mods & Advanced Automation (player)

The fork adds a set of optional "Game Mods" — quality-of-life and automation
toggles that are **off by default**. They live in two places:

- **Settings** (the gear icon) → a "Game Mods" section.
- The **Advanced Automation** panel, a collapsible section under the Task
  Automation controls (only shown once you have the Amulet, like the rest of
  automation).

All mod state persists in your save and is merged over defaults on load, so a
save from before a mod existed simply gets that mod off.

## Settings → Game Mods

| Mod | What it does |
| --- | --- |
| **Award Spark on Discovery** | Each time a Prestige task *completes* (not just on manual prestige), award a fraction of the full prestige currency. |
| **Discovery Spark Fraction** | The fraction awarded above (default 0.1). |
| **Force Automation** | Permanently grants the Amulet (automation) perk. |
| **Auto-Continue Energy Reset** | Skip the energy-reset summary overlay. |
| **Suppress Prestige Popup** | Don't show the "prestige available" popup. |
| **Skip / Pause on Blocked Tasks** | Existing upstream toggle; documented here because it interacts with automation: when automation reaches a task it can't start (e.g. a Boss that's too strong), *Pause* stops automation, *Skip* moves past it. See [balance-and-qol.md](balance-and-qol.md). |

## Advanced Automation panel

| Mod | What it does |
| --- | --- |
| **Resume on Reset** | Keep automating after an Energy Reset instead of stopping — restores the automation mode/target that was active before the reset. |
| **Auto Scroll of Haste** | Automatically spend held Scrolls of Haste on Task reps you couldn't otherwise afford (a single rep costing more energy than you have left). Only acts while **Auto Use Items** is enabled. Works for automated *and* manually-started reps. |
| **Auto Bottled Lightning** | The same idea, but Bottled Lightning only affects **Boss** Tasks, so this only fires on Bosses. On an unaffordable Boss rep it spends a Bottled Lightning to lower the cost. |
| **Auto Use Cycle** | Cycle item auto-use across Energy Resets: run N resets with Auto Use Items off (banking Items), then one with it on (spending the stockpile), and repeat. The off-count is configurable. |
| **Use Free Items** | Even on cycles where Auto Use Items is off, use Items you can spend *without reducing how many you keep* on the next reset (the surplus left by keep-rounding). Artifacts are excluded. |
| **Artifact Tasks: Item Cycles Only** | Only run scheduled artifact tasks while Auto Use Items is enabled (see [artifact-tasks.md](artifact-tasks.md)). |

> Note: **Auto Use Cycle** and **Queue Cycling** are mutually exclusive — at most
> one per-reset cycle runs (see [queue-cycling.md](queue-cycling.md)).

## How the auto-artifact tools decide

Both Auto Scroll of Haste and Auto Bottled Lightning fire when a single rep's
energy cost exceeds a budget of `current_energy / items_held` — i.e. the more
copies you hold, the more eagerly they're spent. They never stack on top of an
Artifact you've already queued manually, and they skip single-tick (trivially
cheap) reps.

On an expensive Boss with both tools enabled, **Bottled Lightning is applied
first**, then Auto Scroll of Haste re-checks and only adds a Scroll if the rep is
*still* unaffordable.

Auto-use of Artifacts is deliberately **not** applied to synthetic tasks
(artifact tasks, host exit tasks) — see [balance-and-qol.md](balance-and-qol.md).

## Code map

- **State / defaults:** `GameMods` interface and `defaultMods()` in
  `simulation.ts`; merged over defaults on load (`{ ...defaultMods(), ...saved }`).
- **Auto artifacts:** `maybeAutoUseHaste()` and `maybeAutoUseLightning()`,
  called from `applyTaskRepStartEffects()`.
- **Cycles:** `applyResetCycle()` → `applyAutoUseCycle()` (and `applyQueueCycle()`).
- **Free items:** `maybeUseRoundingErrorItem()`.
- **UI:** the Settings section and the `ADVANCED_AUTOMATION_TOGGLES` table +
  `setupAdvancedAutomationControls()` in `rendering.ts`.
