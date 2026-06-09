# Balance & QoL changes (mixed)

Smaller gameplay/balance changes and fixes that don't belong to one of the big
feature areas. Several of these concern **synthetic tasks** (artifact tasks and
host exit tasks); the shared predicate is `isSyntheticTask()` in `simulation.ts`.

## Boss energy-disparity limit scales with your Items

A Boss is locked when its energy cost is too far above your current energy.
Upstream used a flat 5×. The fork makes the limit reflect the best cost reduction
your Items could provide:

- **5×** normally (one Scroll of Haste, `HASTE_MULT`), or
- **10×** once you've ever obtained **Bottled Lightning**
  (`HASTE_MULT × BOTTLED_LIGHTNING_MULT`).

The check compares the Boss's **base** cost (no queued Items) against that limit,
so it reflects what your Items *could* do rather than what happens to be queued.
The "too strong" tooltip shows the live limit (5 or 10).

- Code: `getBossEnergyDisparityLimit()` and `isTaskDisabledDueToTooStrongBoss()`.

> Related behavior (unchanged, upstream): if a prioritized Boss is locked,
> automation **pauses** on it (rather than skipping) unless you set
> "Skip on Blocked Tasks" in Settings. Starting the Boss manually gives it
> progress, which clears the lock, so automation continues.

## Synthetic tasks are excluded from generic mechanics

These were fixes — synthetic tasks were instant/skill-less, so generic mechanics
treated them like cheap normal tasks and misfired:

- **Mastery of Time** no longer completes synthetic tasks "for free". For an
  artifact task that would spend the Artifact outside its gating; for a host exit
  task it would fire the host's one-shot exit callback (auto-picking an exit).
  (`doMasteryOfTimeTaskCompletion()`.)
- **Queued Artifact effects** (Scroll of Haste / Magic Ring / Bottled Lightning,
  and the auto-use of those) are not applied to synthetic tasks — they'd be
  wasted on an instant, skill-less task. They're preserved for the next real
  task. (`applyTaskRepStartEffects()`.)

## Auto Scroll of Haste on manual starts

Auto Scroll of Haste previously only fired during automation. It now also fires
on **manually-started** tasks (reached via `clickTask → applyTaskRepStartEffects`),
so manually starting an expensive task can auto-spend a Scroll just like
automation does. See [automation-game-mods.md](automation-game-mods.md).

## UI / QoL

- **Popups don't clip on short screens** — overlay popups (Divinity/Prestige,
  Settings, Stats, Changelog, Credits) are capped to the viewport height
  (`max-height: calc(100dvh - 16px)` on `.overlay-box`) and scroll internally, so
  the bottom is reachable on e.g. a phone in landscape. Settings got an inner
  scroll area so its close button stays put. (Width is left at each popup's
  natural size.)
- **Edit boxes match the numeric inputs** — the queue-name and Discovery Spark
  Fraction fields use the blue input background instead of white.
- Various queue/edit UI polish: consistent colors, collapsible queue list,
  two-row queue entries with an optional label, clearer active-queue indicator.

## Code map

- Boss limit: `getBossEnergyDisparityLimit`, `isTaskDisabledDueToTooStrongBoss`
  (`simulation.ts`); tooltip in `rendering.ts`.
- Synthetic exclusions: `isSyntheticTask`, `doMasteryOfTimeTaskCompletion`,
  `applyTaskRepStartEffects` (`simulation.ts`).
- Popups / inputs: `.overlay-box`, `#settings`, `.queue-name-input`,
  `.mod-fraction-row input` in `style.css`.
