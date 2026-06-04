# Journey to Ascension (Archipelago-CC fork)

A fork of [Journey to Ascension](https://meneth.github.io/journey-to-ascension/)
by Meneth, modified for integration with
[Archipelago-CC](https://github.com/PeerInfinity/Archipelago-CC), a multi-game
randomizer project. Supports two integration modes: the standard
Archipelago randomizer (apworld) and the loop-based substrate.

Integration edits live on the `substrate` branch; `main` tracks upstream
unchanged.

## Live demo

A standalone build of the `substrate` branch is hosted at
**https://peerinfinity.github.io/journey-to-ascension/**.

Note: this is just the base game. The substrate integration hooks are
present in the code but stay dormant until the Archipelago-CC parent
drives them (via the `?managed` URL parameter, injected tasks, etc.), so
the live demo does not exercise any substrate features.

## Permission & terms

Upstream Journey to Ascension is unlicensed. Meneth granted permission for
this fork on 2026-05-22, under the following conditions:

- **Non-commercial use only.**
- **Credit:** Meneth is credited as the original author, with the original
  game linked: https://meneth.github.io/journey-to-ascension/
- **No endorsement:** no endorsement of this fork or its uses by Meneth is
  implied beyond "this is allowed."

## Building

    npm install
    npx tsc

Built output is committed to `build/` (upstream's `.gitignore` excludes it;
this fork un-ignores it) so the parent Archipelago-CC repo, which consumes
this as a git submodule, can read the compiled files directly without a
build step.

Because the parent repo trusts the committed output, always rebuild and
commit `build/` alongside any source change — otherwise stale `build/`
files will ship to the parent.

## Deployment

Pushes to the `substrate` branch trigger
`.github/workflows/typescript.yml`, which builds with `tsc` and publishes
to GitHub Pages at the live-demo URL above. This deploy exists only to
host the base-game demo; it does not build or serve any substrate
integration.

## Upstream

`main` mirrors [meneth/journey-to-ascension](https://github.com/meneth/journey-to-ascension).
To pull future upstream changes:

    git fetch upstream
    git checkout main
    git merge upstream/main
