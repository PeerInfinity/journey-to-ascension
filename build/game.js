import { handleHotkeyPressed, handleHotkeyReleased, Rendering, updateRendering, updateSettingsDisplay } from "./rendering.js";
import { Gamestate, saveGame, updateGamestate, resetTasks, calcTickRate, isManagedMode, getMods, getMod, setMod } from "./simulation.js";
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
// before DOMContentLoaded fires — so GAMESTATE.start() skips loadGame
// and the tick loop never starts. Without this, the auto-bootstrap
// builds task DOM whose click handlers close over Task instances that
// the bridge later orphans by replacing GAMESTATE, producing the
// "first-load clicks register no completion until the next reset" bug.
if (typeof window !== "undefined" && typeof window.location !== "undefined") {
    const _params = new URLSearchParams(window.location.search);
    if (_params.has("managed")) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _setManagedMode = window.setManagedMode;
        if (typeof _setManagedMode === "function") {
            _setManagedMode(true);
        }
    }
}
document.addEventListener("DOMContentLoaded", () => {
    GAMESTATE.start();
    RENDERING.initialize();
    RENDERING.start();
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
window.getGamestate = GAMESTATE;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.resetSave = resetSave;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.resetZone = () => {
    resetTasks();
    RENDERING = new Rendering();
    RENDERING.initialize();
    RENDERING.start();
};
// MARK: Game Loop Control (for simulator / randomizer / substrate integration)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.pauseGameLoop = () => {
    if (GAME_LOOP_INTERVAL > 0) {
        clearInterval(GAME_LOOP_INTERVAL);
        GAME_LOOP_INTERVAL = 0;
        return true;
    }
    return false;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.resumeGameLoop = () => {
    if (GAME_LOOP_INTERVAL === 0) {
        setTickRate();
        return true;
    }
    return false;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.isGameLoopPaused = () => GAME_LOOP_INTERVAL === 0;
// Initialize game without starting the loop (for headless / test mode).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.initializeHeadless = () => {
    GAMESTATE = new Gamestate();
    GAMESTATE.initialize();
    return true;
};
// MARK: Game Mods API (for substrate / AP host and console use)
//
// Mods stay available in managed mode; the host drives them through these.
// Names are the GameMods field keys (see simulation.ts). setMod applies
// side-effects and persists; updateRendering refreshes the UI immediately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.getMods = () => getMods();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.getMod = (name) => getMod(name);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setMod = (name, value) => {
    const ok = setMod(name, value);
    if (ok) {
        updateRendering();
        updateSettingsDisplay();
    }
    return ok;
};
//# sourceMappingURL=game.js.map