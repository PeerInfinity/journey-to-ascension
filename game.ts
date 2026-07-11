import { handleHotkeyPressed, handleHotkeyReleased, Rendering, updateRendering, updateSettingsDisplay, setupControls, populatePrestigeView } from "./rendering.js";
import { Gamestate, saveGame, updateGamestate, resetTasks, calcTickRate, isManagedMode, getMods, getMod, setMod, type GameMods } from "./simulation.js";
import { applyGameDataset } from "./game_data.js";

function gameLoop() {
    updateGamestate();
    updateRendering();
}

export function setTickRate() {
    if (GAME_LOOP_INTERVAL > 0) {
        clearInterval(GAME_LOOP_INTERVAL);
    }

    GAME_LOOP_INTERVAL = setInterval(gameLoop, calcTickRate());
}

export let GAMESTATE = new Gamestate();
export let RENDERING = new Rendering();
let GAME_LOOP_INTERVAL = 0;

// When loaded inside a substrate-controlled iframe (the wrapper appends
// ?managed=1 to the iframe src), flip on managed mode synchronously —
// before DOMContentLoaded fires — so GAMESTATE.start() loads from the
// substrate save slot (see getSaveLocation) and the tick loop never
// starts. Without this, the auto-bootstrap builds task DOM whose click
// handlers close over Task instances that the bridge later orphans by
// replacing GAMESTATE, producing the "first-load clicks register no
// completion until the next reset" bug.
if (typeof window !== "undefined" && typeof window.location !== "undefined") {
    const _params = new URLSearchParams(window.location.search);
    if (_params.has("managed")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _setManagedMode = (window as any).setManagedMode;
        if (typeof _setManagedMode === "function") {
            _setManagedMode(true);
        }
    }
}

// Whether the real page bootstrap ran (vs a headless import with DOM stubs,
// where DOMContentLoaded never fires). loadGameData only rebuilds the
// Rendering when there is a live page to rebuild.
let _rendering_started = false;

document.addEventListener("DOMContentLoaded", () => {
    GAMESTATE.start();
    RENDERING.initialize();
    RENDERING.start();
    _rendering_started = true;

    // In managed mode the host owns the tick clock — it calls
    // resumeGameLoop() when the player enters a jta region and
    // pauseGameLoop() when they leave. Rendering is unaffected.
    if (!isManagedMode()) {
        setTickRate();
    }
});

document.addEventListener("keyup", handleHotkeyReleased);
document.addEventListener("keydown", handleHotkeyPressed);

export function resetSave() {
    GAMESTATE = new Gamestate();
    GAMESTATE.initialize();
    saveGame();
    location.reload();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getGamestate = GAMESTATE;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).resetSave = resetSave;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).resetZone = () => {
    resetTasks();
    RENDERING = new Rendering();
    RENDERING.initialize();
    RENDERING.start();
}

// MARK: Game Loop Control (for simulator / randomizer / substrate integration)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).pauseGameLoop = () => {
    if (GAME_LOOP_INTERVAL > 0) {
        clearInterval(GAME_LOOP_INTERVAL);
        GAME_LOOP_INTERVAL = 0;
        return true;
    }
    return false;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).resumeGameLoop = () => {
    if (GAME_LOOP_INTERVAL === 0) {
        setTickRate();
        return true;
    }
    return false;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).isGameLoopPaused = () => GAME_LOOP_INTERVAL === 0;

// Initialize game without starting the loop (for headless / test mode).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).initializeHeadless = () => {
    GAMESTATE = new Gamestate();
    GAMESTATE.initialize();
    return true;
};

// MARK: Synthetic game data (see game_data.ts)
//
// Swap the engine's content tables to a versioned dataset document, then
// re-initialize against the dataset-keyed save slot (load a matching save if
// one exists, else fresh init) — live Task/Skill/perk state references the
// old tables, so a dataset swap mid-game is a reset by definition.
// Idempotent per dataset_id (a repeat call with the loaded dataset changes
// nothing); a validation failure applies nothing. Dormant when never called.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).loadGameData = (dataset: unknown) => {
    const result = applyGameDataset(dataset);
    if (!result.ok) {
        return { ok: false, errors: result.errors };
    }
    if (result.alreadyLoaded) {
        return { ok: true };
    }
    GAMESTATE = new Gamestate();
    GAMESTATE.start();
    if (_rendering_started) {
        RENDERING = new Rendering();
        RENDERING.initialize();
        RENDERING.start();
    }
    return { ok: true };
};

// MARK: Game Mods API (for substrate / AP host and console use)
//
// Mods stay available in managed mode; the host drives them through these.
// Names are the GameMods field keys (see simulation.ts). setMod applies
// side-effects and persists; updateRendering refreshes the UI immediately.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getMods = () => getMods();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getMod = (name: keyof GameMods) => getMod(name);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setMod = (name: keyof GameMods, value: boolean | number) => {
    const ok = setMod(name, value);
    if (ok) {
        setupControls(); // rebuild so the automation panel appears/hides with the Amulet
        populatePrestigeView(); // the Divinity popup's automation controls follow the same gate
        updateRendering();
        updateSettingsDisplay();
    }
    return ok;
};
