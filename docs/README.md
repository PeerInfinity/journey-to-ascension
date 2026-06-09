# Fork changes

This directory documents everything added in the **Archipelago-CC fork** of
Journey to Ascension, on top of upstream
[meneth/journey-to-ascension](https://github.com/meneth/journey-to-ascension).

For the fork's high-level context — build process, committed `build/` output,
GitHub Pages deployment, and the permission/credit terms from Meneth — see the
[root README](../README.md). This directory covers *what changed in the game and
integration code*.

## Fork boundary

Upstream ends at commit `a0057b1` ("The Zone name now has a tooltip", in-game
changelog v1.1.1). Every change documented here landed after that point. The
player-facing additions are also recorded in the in-game changelog
(`changelog.ts`) under **Fork 1.x** versions, kept separate from Meneth's
upstream entries.

## How this is organized

Each document is tagged by audience.

### For maintainers

- **[substrate-integration.md](substrate-integration.md)** — the
  Archipelago-CC integration layer: `?managed` mode, the `window.*` bridge API,
  synthetic/injected tasks, and the travel / energy-reset callbacks. Read this
  before touching the host-facing hooks or merging upstream.

### For players (with a dev "code map" in each)

- **[automation-game-mods.md](automation-game-mods.md)** — the Settings "Game
  Mods" toggles and the **Advanced Automation** panel (Auto Scroll of Haste,
  Auto Bottled Lightning, Auto Use Cycle, Use Free Items, Resume on Reset, …).
- **[artifact-tasks.md](artifact-tasks.md)** — scheduling "use this Artifact
  here" tasks in the task list.
- **[queue-cycling.md](queue-cycling.md)** — multiple saved automation queues
  that cycle across Energy Resets, per-queue item auto-use modes and exclusions,
  and the priority **edit mode**.
- **[balance-and-qol.md](balance-and-qol.md)** — gameplay/balance changes and
  smaller fixes: the Boss energy-disparity limit, synthetic-task correctness
  (Mastery of Time, Artifact effects), manual auto-haste, popup sizing, etc.

## Conventions

- **Synthetic tasks** is the umbrella term used throughout for tasks the game
  *generates* rather than tasks defined in a zone: player-scheduled **artifact
  tasks** (ids ≥ 1,000,000) and host-injected **exit/synthetic tasks** (ids ≥
  10,000, registered via the substrate bridge). `isSyntheticTask()` in
  `simulation.ts` is the shared predicate.
- Source lives in `simulation.ts` (game logic / state) and `rendering.ts` (DOM /
  UI). `build/` holds the compiled output, which is committed — always rebuild
  with `npx tsc` after a source change.
