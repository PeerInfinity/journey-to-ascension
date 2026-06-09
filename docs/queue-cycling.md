# Queue Cycling & Priority Edit Mode (player)

Normally you have a single automation plan: task priorities, scheduled artifact
tasks, and whether Auto Use Items is on. **Queue Cycling** lets you save several
such plans ("queues") and rotate through them automatically, one (or more) per
Energy Reset. This makes multi-phase strategies possible — e.g. a banking queue
that saves Items, followed by a spending queue.

Enable it with the **Queue Cycling** mod in the Advanced Automation panel. It's
mutually exclusive with **Auto Use Cycle** (at most one per-reset cycle runs),
and it restarts at the first queue on Prestige.

## Each queue holds

- Its own **task priorities** (the automation order).
- Its own **scheduled artifact tasks** (see [artifact-tasks.md](artifact-tasks.md)).
- An **item auto-use mode**: **All** (use everything), **None** (bank
  everything), or **Exclude** (use everything *except* a listed set).
- A **repeat count** — how many consecutive Energy Resets to run before
  advancing.

## Per-queue controls

- **Name** — an optional label, shown in the queue list and collapsed header.
- **Items: All / None / Exclude** — click to cycle the auto-use mode. In
  Exclude mode an exclusion list is shown; use the picker to add items to it.
  You can exclude an item even if you currently hold **zero** of it (so you can
  pre-exclude something a later queue should spend). Excluded items are saved for
  a later, non-excluding queue.
- **× \<n\>** — the repeat count. **0 means skip this queue entirely** in the
  cycle; the list shows "(skipped)". With a repeat count of *k* > 0, the active
  queue's header shows "(run i/k)" progress.
- **↑ / ↓** — reorder the queue in the cycle.
- Add / remove queues; select a queue to view and edit its plan; an **advance**
  button steps the cycle to the next queue immediately.

The queue list is collapsible, with a header summarizing the active queue.

## How the cycle advances

Once per Energy Reset, the active queue's run counter increments; when it reaches
the queue's repeat count, the cycle advances to the **next queue with a non-zero
repeat count** (skipping any set to 0). If *every* queue is set to 0, the cycle
leaves the current queue active rather than looping forever. The newly active
queue's plan (priorities + artifact tasks + auto-use mode) is loaded before the
zone is rebuilt, so it governs the upcoming run.

## Priority Edit Mode

"Edit Priorities" enters a **frozen** edit mode for arranging automation:

- The game is paused while editing (no ticks, can't start tasks). You can only
  enter it when no task is currently active.
- You can **navigate between zones** you've reached to edit each zone's
  priorities, without changing your real position — on exit, your actual zone and
  the run's live tasks (reps intact) are restored, and artifact tasks are
  re-injected for the current zone.
- An on-screen indicator shows you're in edit mode.

## Code map

- **Data:** `QueueConfig` (`prios`, `artifact_tasks`, `auto_use_mode`,
  `excluded_items`, `repeat_count`, `name`) in `GAMESTATE.queue_configs`;
  `active_queue_index`, `queue_runs_on_current`.
- **Cycle:** `applyResetCycle()` → `applyQueueCycle()` →
  `advanceToNextRunnableQueue()`; `loadActiveQueue()` / `saveActiveQueue()`;
  `resetQueueCycleForPrestige()`.
- **Editing API:** `addQueue`, `removeQueue`, `moveQueue`, `setActiveQueue`,
  `setQueueAutoUseMode`, `add/removeQueueExcludedItem`, `setQueueRepeatCount`
  (clamps ≥ 0), `setQueueName`, `advanceQueueCycle`.
- **Edit mode:** `enterEditMode()`, `exitEditMode()`, `setEditZone()`,
  `isEditMode()`, `getEditMaxZone()` (`_edit_mode`, `_edit_saved_zone`,
  `_edit_saved_tasks`).
- **Auto-use exclusions:** consulted in `autoUseItems()`
  (`auto_use_excluded_items`).
- **UI:** the Queues panel and `queue-name-input` in `rendering.ts`.
