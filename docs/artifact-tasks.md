# Artifact Tasks (player)

Artifact Tasks let you **schedule using an Artifact at a specific point in a
zone**, as if it were a task in your plan. This is useful for automation: instead
of manually clicking an Artifact at the right moment, you place a "Use \<Artifact\>"
task and let automation run it.

## Using them

The task list has an **Artifacts** section with **Add** / **Remove** controls:

- Click **Add**, then click an Artifact in your inventory to schedule a "Use
  \<Artifact\>" task in the current zone. (You can pick an Artifact even if you
  currently hold **zero** of it — handy for scheduling ahead of acquiring one.)
- Click **Remove**, then click a scheduled artifact task to unschedule it.
- Click the active pick-mode button again to cancel.

A scheduled artifact task behaves like an instant task: when it runs it consumes
one copy of that Artifact (if you hold one). It's prioritized for automation like
any other task.

## Gating

An artifact task only runs while you actually **hold a copy** of its Artifact.
With the **Artifact Tasks: Item Cycles Only** mod enabled, it *additionally* only
runs while **Auto Use Items** is on — so on banking cycles the artifact tasks are
skipped and your Artifacts are saved for a spending cycle. Otherwise it's left
disabled and automation skips past it.

Artifact tasks are per-zone and are tracked across cycles/reloads by a `done`
flag so a mid-cycle reload doesn't re-arm and double-spend the Artifact. They're
also saved as part of each automation **queue** (see
[queue-cycling.md](queue-cycling.md)).

## Relationship to other mechanics

Artifact tasks are **synthetic tasks** (ids ≥ `ARTIFACT_TASK_ID_BASE` =
1,000,000). Several generic mechanics intentionally skip them so they aren't
fired or buffed outside their own gating — Mastery of Time won't auto-complete
them, and queued Artifact effects (Haste/Ring/Lightning) aren't spent on them.
See [balance-and-qol.md](balance-and-qol.md).

## Code map

- **Data:** `ArtifactTaskSpec` (`{ task_id, item, zone_id, done }`) in
  `GAMESTATE.artifact_tasks`; `ARTIFACT_TASK_ID_BASE`, `isArtifactTaskId()`.
- **Lifecycle:** `addArtifactTask()`, `removeArtifactTask()`,
  `makeArtifactTask()`, `injectArtifactTasksForCurrentZone()`,
  `resetArtifactTaskCycleState()`.
- **Run gating:** the artifact-task branch in `updateEnabledTasks()`; consumption
  in `applyFinishTaskRepEffects()`.
- **UI:** the Artifacts section header + pick-mode in `rendering.ts`
  (`artifact_task_mode`), with zero-count Artifacts kept clickable during Add.
