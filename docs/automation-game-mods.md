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
| **Auto Dreamcatcher** | Use a held Dreamcatcher before a task rep that would consume at least a set percentage of current energy (default 25%) — i.e. late in the run, when its "duplicate everything found this reset" effect is near its biggest. One per qualifying rep; only while Auto Use Items is enabled. |
| **Auto Magic Ring** | Spend held Magic Rings (5× XP for one rep) on the tasks where they help most, ranked from last run's completions. Tasks ranked within the Ring budget (held + already spent this run) each get one Ring; Rings found mid-run widen the budget. Needs one completed run of history; only while Auto Use Items is enabled. |
| **Auto-Fill Priorities** | (Button, not a toggle.) Overwrite every reached zone's automation priorities with a heuristic order: item-awarding tasks, task-unlockers, perk tasks (cheapest to finish first), the rest by skill levels per energy, then Mandatory/Prestige with Travel last. Re-click after unlocking or reaching new content. |
| **Auto-Prioritize** | Autopilot for the above: re-runs Auto-Fill automatically at every Energy Reset and Prestige, on task unlock, and on zone entry, so the order always reflects current skills and energy. Overwrites manual edits while on. Mutually exclusive with **Queue Cycling**. |
| **Energy Thresholds** | Skip prioritized tasks that aren't worth their energy — per-category energy-per-level thresholds; see below. |
| **End Run When All Skipped** | (Under Energy Thresholds) When every remaining prioritized task is over its threshold, trigger the Energy Reset instead of idling. |

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

**Auto Magic Ring** can't use an affordability trigger either — a Ring is 5×
XP for one rep, so it should go to the rep that converts XP into the most
levels, and future skill states are unknowable. Instead the game records every
task started this run with the extra levels a Ring *would* have earned (from
the skill state at rep start), keeps the successfully completed ones at the
energy reset, and ranks them. When a ranked task starts, it gets a Ring if its
rank fits the **Ring budget**: Rings currently held plus Rings already spent
this run (so spending never shrinks the window, and a Ring found mid-run
widens it immediately — important early game, where Rings don't survive the
reset cull and must be spent the run they're found). One Ring per task per
run. The plan and its spent marks persist in the save (no double-spend on
reload) and are wiped on prestige, where skills reset and all Rings are lost
anyway. On the first run after a prestige (or before any history exists) the
feature simply waits.

**Auto Dreamcatcher** uses a different trigger, because a Dreamcatcher doesn't
speed anything up — it duplicates one copy of every Item type found this energy
reset, so it's worth the most as late in the run as possible. It fires when the
next rep would consume at least the configured percentage of *current* energy
(default 25%): once reps start qualifying, energy only shrinks, so held copies
drain naturally over the run's final tasks. It's skipped while nothing (except
Dreamcatchers) has been found yet, and it runs after the Haste/Lightning
decisions so its cost estimate reflects the boosts that will actually apply.

Auto-use of Artifacts is deliberately **not** applied to synthetic tasks
(artifact tasks, host exit tasks) — see [balance-and-qol.md](balance-and-qol.md).

## How the Energy Thresholds decide

With **Energy Thresholds** on, automation skips a prioritized task when the
energy one rep costs, divided by the (fractional) skill levels that rep would
earn at your current skill state, exceeds a percentage of your **max energy**.
The idea: "I'm willing to spend at most T% of my max energy to earn one level
from this kind of task." One priority list then serves the whole prestige cycle
— cheap tasks pass everywhere early after a prestige; late in a run only
worthwhile tasks run.

Each task is classified into exactly one category (first match wins), each with
its own threshold percentage and toggle. **A disabled category is exempt — its
tasks always run.**

1. **New Perk (finishable)** — awards a perk you haven't earned this prestige,
   and finishing all remaining reps fits in your current energy, counting the
   speed-up your held Scrolls of Haste (and, for Bosses, Bottled Lightning)
   could provide.
2. **New Perk (out of reach)** — awards an unearned perk, but finishing it does
   *not* fit this cycle even with your Artifacts.
3. **Awards an Item** — grants an Item on each rep.
4. **Progression** — Travel, Mandatory, and Prestige tasks. **Judged on the
   rep's absolute energy cost** (skip when one rep costs more than T% of max
   energy) rather than energy-per-level: their value is progression, not XP,
   and a per-level metric explodes once the task's skill outlevels early-zone
   XP — a farmed-up skill would make an old zone's Travel task look
   infinitely expensive per level and strand the run there.
5. **Unlocks a Task** — finishing it unlocks another task.
6. **Everything else.**

A task can migrate between the two perk categories mid-run as your energy and
Artifacts change; once its perk is earned it drops to whichever later category
fits. Synthetic tasks and skill-less tasks are always exempt.

Threshold skipping always *skips* (it never pauses automation, regardless of
the Skip/Pause on Blocked Tasks setting). If **everything** left is skipped,
automation would idle forever — no running task means no energy drain. With
**End Run When All Skipped** on, that state triggers the Energy Reset instead
(pairs well with Auto-Continue Energy Reset and Resume on Reset); with it off,
a notification appears and automation idles.

## Code map

- **State / defaults:** `GameMods` interface and `defaultMods()` in
  `simulation.ts`; merged over defaults on load (`{ ...defaultMods(), ...saved }`).
- **Auto artifacts:** `maybeAutoUseHaste()`, `maybeAutoUseLightning()`,
  `maybeAutoUseDreamcatcher()`, and `maybeAutoUseRing()`, called from
  `applyTaskRepStartEffects()`; Dreamcatcher UI in
  `setupAutoDreamcatcherControl()` (`rendering.ts`).
- **Run task history / Ring plan:** `RunTaskRecord`, `recordRunTaskHistory()`,
  `buildRingPlan()`; rotation in `doEnergyReset()`, completion marking in
  `applyFinishTaskRepEffects()`, wipe in `doPrestige()`.
- **Auto-fill priorities:** `autoFillPriorities()` / `autoFillAllPriorities()`
  / `autoFillGroup()` (`simulation.ts`, also `window.autoFillPriorities`); UI
  in `setupAutoFillControl()` (`rendering.ts`).
- **Auto-Prioritize (autopilot):** `maybeAutoPrioritizeAll()` /
  `maybeAutoPrioritizeZone()`, hooked into `doEnergyReset()`, `doPrestige()`,
  `unlockTask()`, and `advanceZone()`; mutual exclusion with `queue_cycle` in
  `setMod()`; UI in `setupAutoPrioritizeControl()` (`rendering.ts`).
- **Cycles:** `applyResetCycle()` → `applyAutoUseCycle()` (and `applyQueueCycle()`).
- **Free items:** `maybeUseRoundingErrorItem()`.
- **Energy thresholds:** `isThresholdSkipped()` / `getThresholdCategory()` /
  `calcExpectedLevels()` in `simulation.ts`; the skip hook and stall handling
  in `pickNextTaskInAutomationQueue()`; UI in `setupThresholdControls()` +
  `THRESHOLD_ROWS` (`rendering.ts`).
- **UI:** the Settings section and the `ADVANCED_AUTOMATION_TOGGLES` table +
  `setupAdvancedAutomationControls()` in `rendering.ts`.
