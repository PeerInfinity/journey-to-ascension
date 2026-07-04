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
| **Auto-Fill Priorities** | (Button, not a toggle.) Overwrite every reached zone's automation priorities with a heuristic order: item-awarding tasks, then unearned perk tasks (cheapest to finish first), then Prestige tasks (one-shot, cheap for their zone, and the fresh items boost them), task-unlockers, the rest by skill levels per energy, then Mandatory with Travel last. Earned perks and done unlocks sort as plain tasks — below Prestige. Re-click after unlocking or reaching new content. |
| **Auto-Prioritize** | Autopilot for the above: re-runs Auto-Fill automatically at every Energy Reset and Prestige, on task unlock, and on zone entry, so the order always reflects current skills and energy. Overwrites manual edits while on. Mutually exclusive with **Queue Cycling**. |
| **Energy Thresholds** | Skip prioritized tasks that aren't worth their energy — per-category energy-per-level thresholds; see below. |
| **When All Skipped** | (Under Energy Thresholds) What happens when every remaining prioritized task is over its threshold: **Idle** (stop + notify), **End Run** (trigger the Energy Reset), or **Best Task** (run the skipped task that would earn the most total skill levels from the remaining energy). |

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
levels, and future skill states are unknowable. Instead the game records which
tasks each run *actually completes* — the reliable signal for how deep runs
really reach — and keeps that history **per run context**: per queue under
Queue Cycling, per banking/spending phase under the Auto Use Cycle, one shared
bucket otherwise. Each run's plan comes from the most recent completed run of
the *same* context (so a banking run's completions never mislead a spending
run, and queue A's plan never ranks tasks queue B won't run), re-ranked at the
reset by the extra levels a Ring would earn **at your current skills** (the
matching history run can be a full cycle old). When a ranked task starts, it
gets a Ring if its rank fits the **Ring budget**: Rings currently held plus
Rings already spent this run (so spending never shrinks the window, and a Ring
found mid-run widens it immediately — important early game, where Rings don't
survive the reset cull and must be spent the run they're found). One Ring per
task per run. The plan and its spent marks persist in the save (no
double-spend on reload) and everything is wiped on prestige, where skills
reset and all Rings are lost anyway. Before any matching history exists (first
run after a prestige, or the first pass of a new queue/cycle phase) the
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

With **Energy Thresholds** on, automation skips a prioritized task when it
fails its category's judgment, where each category picks the judgment via its
**/lvl · /rep · /rst metric switch**:

- **/lvl** — the energy one rep costs, divided by the (fractional) skill
  levels that rep would earn at your current skill state, vs a percentage of
  **max energy**. The idea: "I'm willing to spend at most T% of my max energy
  to earn one level from this kind of task." Right for XP-valued tasks — but
  beware on purpose-driven ones: once a skill far outlevels a task's XP,
  levels-per-rep tends to zero and this metric explodes.
- **/rep** — the rep's total energy cost vs that percentage: "don't do this
  if one rep costs more than T% of my max energy." Right for tasks whose
  value isn't XP.
- **/rst** (the default for every category) — the estimated number of
  **energy resets** until the task could be *fully completed* (all remaining
  reps in one go), vs a reset count: "skip it if it isn't reachable within N
  resets." 0 means it must be completable right now. The estimate assumes conditions like the moment of the decision
  repeat each reset — the same remaining energy as the budget, the same
  active boosts — and that each simulated run grinds its whole budget into
  this one task (only skill XP survives a reset, which is what the grind
  accumulates). Level-ups *during* a run aren't modeled, so the estimate is
  slightly conservative; and because it uses *current remaining* energy, a
  task can be within reach early in a run and out of reach late — which is
  the point.

One priority list then serves the whole prestige cycle — cheap tasks pass
everywhere early after a prestige; late in a run only worthwhile tasks run.

Each task is classified into exactly one category (first match wins), each with
its own threshold percentage and toggle. **A disabled category is exempt — its
tasks always run.**

1. **New Perk (finishable)** — awards a perk you haven't earned this prestige,
   and finishing all remaining reps fits in your current energy, counting the
   speed-up your held Scrolls of Haste (and, for Bosses, Bottled Lightning)
   could provide.
2. **New Perk (out of reach)** — awards an unearned perk, but finishing it does
   *not* fit this cycle even with your Artifacts.
3. **Unlocks a Task** — its unlock target is still locked. Checked *before*
   the item category deliberately: every unlocker in the game is a Boss that
   also awards an item, so the other order would leave this category
   permanently empty. Unlocks persist across energy resets (until prestige).
4. **Awards an Item** — grants an Item on each rep.
5. **Progression** — Travel, Mandatory, and Prestige tasks. Avoid /lvl here:
   their value is progression, not XP, and the /lvl metric explodes once the
   task's skill outlevels early-zone XP — a farmed-up skill would make an old
   zone's Travel task look infinitely expensive per level and strand the run
   there.
6. **Everything else.**

Categories track live state, so tasks migrate as their purpose is spent: the
two perk categories swap with your energy and Artifacts, an earned perk drops
the task to whichever later category fits, and a completed unlock turns its
Boss into a plain item farm (first kill of a prestige judges as "Unlocks a
Task", every later kill as "Awards an Item"). Synthetic tasks and skill-less
tasks are always exempt.

Threshold skipping always *skips* (it never pauses automation, regardless of
the Skip/Pause on Blocked Tasks setting). If **everything** left is skipped,
something must happen — no running task means no energy drain, so the run
would never end. The **When All Skipped** control picks what:

- **Idle** (default) — automation stops and shows a notification.
- **End Run** — trigger the Energy Reset; leftover energy was only spendable
  at rejected rates anyway. Pairs well with Auto-Continue Energy Reset and
  Resume on Reset.
- **Best Task** — run the skipped task that would earn the **most total skill
  levels** from the remaining energy (XP accrues per tick, so even reps that
  can't finish convert energy into levels; the final tick may overdraft below
  zero, matching normal play, so even a sliver of energy buys one more tick).
  The choice is re-evaluated at every pick as energy drains, and if some task
  drops back under its threshold the normal priority walk takes over again —
  so the run ends by converting leftover energy into levels instead of
  idling. If nothing at all could convert, the run ends like End Run.

## Code map

- **State / defaults:** `GameMods` interface and `defaultMods()` in
  `simulation.ts`; merged over defaults on load (`{ ...defaultMods(), ...saved }`).
- **Auto artifacts:** `maybeAutoUseHaste()`, `maybeAutoUseLightning()`,
  `maybeAutoUseDreamcatcher()`, and `maybeAutoUseRing()`, called from
  `applyTaskRepStartEffects()`; Dreamcatcher UI in
  `setupAutoDreamcatcherControl()` (`rendering.ts`).
- **Run task history / Ring plan:** `RunTaskRecord`, `recordRunTaskHistory()`,
  `currentRingContext()` / `run_history_by_context`, `calcRingExtraLevels()`,
  `buildRingPlan()`; context capture + rotation in `doEnergyReset()`,
  completion marking in `applyFinishTaskRepEffects()`, wipe in `doPrestige()`.
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
  `calcExpectedLevels()` / `estimateResetsToComplete()` /
  `estimateLevelsFromGrinding()` and the `THRESHOLD_METRIC_*` /
  `THRESHOLD_ALL_SKIPPED_*` constants in `simulation.ts`; the skip hook and
  `handleThresholdStall()` fallback in `pickNextTaskInAutomationQueue()`; UI
  in `setupThresholdControls()` + `THRESHOLD_ROWS` (`rendering.ts`).
- **UI:** the Settings section and the `ADVANCED_AUTOMATION_TOGGLES` table +
  `setupAdvancedAutomationControls()` in `rendering.ts`.
