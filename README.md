# Journey to Ascension (Archipelago-CC fork)

A fork of [Journey to Ascension](https://meneth.github.io/journey-to-ascension/)
by Meneth, modified for integration with
[Archipelago-CC](https://github.com/PeerInfinity/Archipelago-CC), a multi-game
randomizer project. Supports both Archipelago's standard randomizer
(apworld) mode and a loop-mode substrate mode.

Integration edits live on the `substrate` branch; `main` tracks upstream
unchanged.

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
this fork un-ignores it) so consumers do not need a build step.

## Upstream

`main` mirrors [meneth/journey-to-ascension](https://github.com/meneth/journey-to-ascension).
To pull future upstream changes:

    git fetch upstream
    git checkout main
    git merge upstream/main
