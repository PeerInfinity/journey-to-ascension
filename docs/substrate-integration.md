# Substrate integration (maintainer)

The fork embeds Journey to Ascension as a "substrate" game inside
[Archipelago-CC](https://github.com/PeerInfinity/Archipelago-CC). The host drives
the game through a `window.*` bridge and a small set of callbacks. All of this is
**dormant** in the standalone build — it only activates when the host opts in
(via `?managed` or by calling the bridge), so the public demo plays exactly like
upstream.

## Managed mode

`window.setManagedMode(enabled)` / `window.isManagedMode()` toggle managed mode
(`_managed_mode` in `simulation.ts`). It's also enabled automatically when the
page is loaded with the `?managed` URL parameter.

In managed mode the host owns things the standalone game would do itself:

- **Persistence** — `saveGame()` / load are skipped (`_managed_mode` guards at
  `simulation.ts` ~2254 and ~2580); the host supplies and stores state.
- **Zone transitions** — completing a Travel task fires the travel callback but
  does **not** auto-`advanceZone()`; the host decides the next zone (so it can
  present synthetic exit-choice tasks first). See `onFullyFinishTask`
  (`simulation.ts` ~553).

## Callbacks

Registered by the host; both are one-per-game:

- `window.setTravelTaskCallback(fn)` → `_travel_task_callback(zone, { id, name })`
  — fired when a Travel task completes.
- `window.setEnergyResetCallback(fn)` →
  `_energy_reset_callback({ currentEnergy, maxEnergy, energyResetCount })`
  — fired at the end of `doEnergyReset()`, used to keep the host's loop-mode
  energy pool in sync.

## Synthetic / injected tasks

The host can inject its own tasks (e.g. exit-choice tasks) into the current zone:

- `window.injectSyntheticTask(spec, onComplete)` — `spec` is
  `{ id, name, costMultiplier?, maxReps?, free?, skills? }`. Builds a
  `TaskDefinition`, pushes a live `Task`, creates its DOM immediately
  (`RENDERING.appendTask`), and registers a **one-shot** `onComplete` callback in
  `_synthetic_task_callbacks`, keyed by id. The callback fires when the task is
  fully completed (`onFullyFinishTask`, `simulation.ts` ~535) and is then
  dropped.
- `window.clearSyntheticTasks()` — removes all injected tasks and their
  callbacks. The host calls this when leaving a region.

**Id ranges (by convention, so the three task kinds never collide):**

| Kind | Id range | Identified by |
| --- | --- | --- |
| Upstream zone tasks | normal (low) | — |
| Host synthetic/exit tasks | ≥ 10,000 | membership in `_synthetic_task_callbacks` |
| Player artifact tasks | ≥ 1,000,000 (`ARTIFACT_TASK_ID_BASE`) | `isArtifactTaskId()` |

`isSyntheticTask(task)` returns true for either of the latter two. Several
generic mechanics deliberately skip synthetic tasks — see
[balance-and-qol.md](balance-and-qol.md).

## The `window.*` bridge

Defined at the bottom of `simulation.ts`. Beyond the managed-mode and synthetic
helpers above, the host has access to (non-exhaustive):

- **Stepping / state:** `stepTick`, `performTask`, `setInstantMode`,
  `isInstantMode`, `getFullState`, `getAvailableTasks`, `setEnergy`,
  `setProgressMult`, `advanceZone`, `loadZone`, `doEnergyReset`, `saveGame`.
- **Items:** `useItem`.
- **Artifact tasks:** `addArtifactTask`, `removeArtifactTask`,
  `getArtifactTasks`.
- **Queues:** `getQueueConfigs`, `addQueue`, `removeQueue`,
  `setQueueAutoUseMode`, `addQueueExcludedItem`, `removeQueueExcludedItem`,
  `setQueueRepeatCount`, `setQueueName`, `moveQueue`, `advanceQueueCycle`.
- **Edit mode:** `enterEditMode`, `exitEditMode`, `setEditZone`.

`loadZone` rebuilds the task DOM so the host can swap zones directly. Most of
these are thin wrappers over exported `simulation.ts` functions, so the same
behavior is reachable from both the UI and the host.

## Upstream-merge notes

- The integration is additive and concentrated in the `window.*` block, the
  `_managed_mode` / callback guards, and `onFullyFinishTask`. Conflicts on an
  upstream merge are most likely in `onFullyFinishTask` (travel handling) and
  `doEnergyReset`.
- `build/` is committed and un-ignored in this fork (upstream `.gitignore`s it).
  Re-run `npx tsc` and commit `build/` with every source change.
