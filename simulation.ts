import { Task, ZONES, TaskType, TASK_LOOKUP, TaskDefinition, rebuildZoneDerivedMaps } from "./zones.js";
import { GAMESTATE, RENDERING, setTickRate } from "./game.js";
import { HASTE_MULT, ItemDefinition, ITEMS, ARTIFACTS, ItemType, MAGIC_RING_MULT, BOTTLED_LIGHTNING_MULT, NOTE_ITEMS } from "./items.js";
import { getReflectionsOnTheJourneyExponent, PerkDefinition, PERKS, PerkType } from "./perks.js";
import { SkillUpContext, EventType, RenderEvent, GainedPerkContext, UsedItemContext, UnlockedTaskContext, UnlockedSkillContext, EventContext, HighestZoneContext, SkippedTasksContext, AwardedSparkContext } from "./events.js";
import { SKILL_DEFINITIONS, SkillDefinition, SKILLS, SkillType } from "./skills.js";
import { PRESTIGE_UNLOCKABLES, PRESTIGE_REPEATABLES, PrestigeRepeatableType, PrestigeUnlock, PrestigeUnlockType, PrestigeRepeatable, DIVINE_KNOWLEDGE_MULT, DIVINE_APPETITE_ENERGY_ITEM_BOOST_MULT, GOTTA_GO_FAST_BASE, PrestigeLayer, DIVINE_LIGHTNING_EXPONENT_INCREASE, TRANSCENDANT_APTITUDE_MULT, ENERGIZED_INCREASE, DIVINE_SPEED_TICKS_PER_PERCENT, PERKY_BASE, COMPULSIVE_NOTE_TAKING_AMOUNT, ENERGIZED_PERK_INCREASE, MANDATORY_SCHMANDATORY_MULT, DIVINE_ATTUNEMENT_BASE, SPITE_THE_GODS_MULT, DIVINER_KNOWLEDGE_MULT, GODLY_TRAVEL_MULT, FINAL_PRESTIGE_MULT, DIVINE_SUPREMACY_ENERGY } from "./prestige_upgrades.js";
import { AWAKENING_DIVINE_SPARK_MULT, DEFIED_THE_GODS_SPARK_MULT, ENERGETIC_MEMORY_MULT, MAJOR_TIME_COMPRESSION_EFFECT, SUPPLY_LINES_EFFECT, UNIFIED_THEORY_OF_MAGIC_EFFECT } from "./simulation_constants.js";

// MARK: Constants
let task_progress_mult = 1;
let instant_mode = false;

// MARK: Substrate / host integration state
//
// Managed mode: when on, the host (Archipelago substrate wrapper) owns
// persistence, ticking, and zone transitions. Internally this gates
// saveGame (no-op), loadGame (skipped in Gamestate.start), automatic
// advanceZone after the Travel task (skipped — host advances via the
// travel callback), and the auto setTickRate in game.ts's
// DOMContentLoaded handler.
let _managed_mode = false;
// Fires when a TaskType.Travel task is fully completed.
let _travel_task_callback: ((zone: number, task: { id: number, name: string }) => void) | null = null;
// Fires when doEnergyReset() or doPrestige() finishes — any game-initiated
// run end the substrate host must observe. After a prestige,
// energyResetCount is 0 (doPrestige resets it).
let _energy_reset_callback: ((state: { currentEnergy: number, maxEnergy: number, energyResetCount: number }) => void) | null = null;
// Synthetic-task injection: per-task callbacks fired when the synthetic
// task is fully completed. Keyed by task id (use ids well above the
// normal task-id range to avoid collisions — exit-choice tasks use
// ids in the 10000+ range by convention).
const _synthetic_task_callbacks = new Map<number, () => void>();
// Fires every time ANY task is fully completed (reps == max_reps), once
// per task. Unlike the travel/synthetic callbacks above, this is the
// general channel the Archipelago substrate host uses for
// all-tasks-as-locations: the host maps each completed real zone task to
// an AP location check. The payload carries `synthetic` (true for
// injected/artifact tasks that are not real zone tasks) so the host can
// filter. Pass null to clear. First full completion is the only signal —
// tasks stay done once at max_reps — so the host dedupes on its side.
let _task_completion_callback: ((info: {
    id: number, name: string, zone: number, type: TaskType,
    perk: PerkType, item: ItemType, reps: number, maxReps: number,
    synthetic: boolean,
}) => void) | null = null;
// Cost-assignment allowlist (Pass-B balance walk). When non-null, any real
// (non-synthetic) task whose id is NOT in the set is treated as
// disabled-without-being-finished, so automation skips past it (the walk runs
// `automation_skip_blocked`). null (default) = inert; standalone play never
// sets it. Stored as a Set for O(1) lookup — it is consulted per task per tick
// via updateEnabledTasks.
let _costed_task_ids: Set<number> | null = null;
// Tasks the automation must judge as PERK TASKS even though their `perk` field
// says otherwise (AP-authoritative grants: the randomizer patches a perk task's
// `perk` -> PerkType.Count to suppress the local grant, and the perk instead
// arrives as an AP item). Both categorizers gate on
// `def.perk != Count && !hasPerk(def.perk)`, so without this override a
// suppressed perk task (a) is judged by the `other` threshold category's
// energy-per-level metric, which perk tasks fail BY DESIGN (their xp_mult is
// deliberately tiny — the perk is the reward), and (b) loses its place in the
// auto-fill "perk" priority band. Both effects also bite once AP delivers the
// perk early, since `hasPerk` then short-circuits the vanilla check too.
// The host retires an id once its AP location is checked. null (default) =
// inert; standalone play never sets it.
let _perk_category_task_ids: Set<number> | null = null;
// First-start cost callback (Pass-B balance walk). Fired SYNCHRONOUSLY the
// moment a real task begins the first rep of its current run (reps == 0 &&
// progress == 0), BEFORE any cost/progress is evaluated. The callback may
// synchronously call applyTaskPatches to set this task's cost_multiplier and
// the starting tick — normal OR instant mode — reads the patched cost (see
// applyTaskRepStartEffects). Fires on every fresh start (reps reset each run);
// the host dedupes. null (default) = inert.
let _task_first_start_callback: ((info: {
    id: number, name: string, zone: number, type: TaskType,
    reps: number, progress: number,
}) => void) | null = null;
// Reentrancy guard for _task_first_start_callback: the callback mutates task
// definitions (applyTaskPatches) but must never re-enter the first-start seam.
let _in_first_start_callback = false;

export function isManagedMode(): boolean {
    return _managed_mode;
}
const STARTING_ENERGY = 100;
const DEFAULT_TICK_RATE = 66.6;
// The fork's save format diverged from upstream's (added queue_configs,
// artifact_tasks, mods, etc.), so this tracks the fork changelog rather than
// upstream's save version. The Changelog popup checks SAVE_VERSION against the
// newest CHANGELOG entry, so keep this equal to CHANGELOG[0].version — bump both
// together when adding a fork changelog entry.
export const SAVE_VERSION = "Fork 1.8";
const TASK_STARTED_PROGRESS = 0.01;

// MARK: Dataset-tunable data tables (fork addition)
//
// The synthetic-game-data boundary (window.loadGameData, see game_data.ts)
// swaps the content tables at runtime. These objects carry the couplings that
// used to be compiled constants: skill-identity roles, the economy backbone,
// and the two absolute prestige couplings. Vanilla values are the defaults;
// loadGameData overwrites the fields IN PLACE. With no dataset loaded nothing
// ever writes them, so every reader behaves exactly as the old literals did.

export const SKILL_ROLES = {
    // Half starting level from Transcendant Aptitude; also the spite pairing.
    ascension_skill: SkillType.Ascension as SkillType,
    // The Godly Travel prestige multiplier target.
    travel_skill: SkillType.Travel as SkillType,
    // Base attunement skills. The Fully Attuned / Crafting Breakthrough
    // conditional extensions stay keyed to their behavior slots (fixed
    // behavior slots, so Search/Crafting identities are stable).
    attunement_skills: [SkillType.Magic, SkillType.Study] as SkillType[],
    power_skills: [SkillType.Combat, SkillType.Fortitude] as SkillType[],
    spite_skills: [SkillType.Ascension, SkillType.Charisma] as SkillType[],
};

export const ECONOMY = {
    base_task_cost: 10,
    zone_cost_exponent: 2.2,
    boss_cost_exponent: 4,
    xp_base: 8,
    xp_zone_mult: 1.25,
    level_curve: 1.02,
    // The per-zone speedup/drain backbone (tasks in zone z progress AND
    // drain zone_speedup_base^z faster — a pure time compression, the two
    // sites cancel in energy terms).
    zone_speedup_base: 1.05,
    // Raw-value economy mode (Fork 1.8). "zone_formula" (vanilla): task
    // cost/XP and the zone speedup come from the exponential backbones
    // above. "raw": every dataset task carries absolute raw_cost/raw_xp and
    // every zone carries raw_drain; the backbone fields above are carried
    // but unused. Only a loaded dataset can select "raw".
    value_mode: "zone_formula" as "zone_formula" | "raw",
};

export const PRESTIGE_DATA = {
    // Divine-spark scaling origin (0-indexed zone; vanilla: zone 15).
    spark_zone_origin: 14,
    // Tasks unlocked by the See Beyond the Veil prestige unlockable — the
    // engine's only hardcoded task-id list, now data.
    sbtv_unlock_task_ids: [17, 28, 88, 158, 209] as number[],
};

// Identity of the dataset loaded via window.loadGameData; null = the built-in
// vanilla tables. Keys the save slot (see getSaveLocation) and stamps the
// save blob, because numeric task/perk/item/skill ids are save-load-bearing —
// a save is only meaningful under the dataset that produced it.
let _loaded_dataset_id: string | null = null;
let _loaded_dataset_schema_version: number | null = null;

export function setLoadedDataset(id: string, schema_version: number) {
    _loaded_dataset_id = id;
    _loaded_dataset_schema_version = schema_version;
}

export function getLoadedDatasetId(): string | null {
    return _loaded_dataset_id;
}

// Player-scheduled "use this artifact here" tasks get ids in this range — well
// above zone task ids and the host's synthetic exit tasks (>= 10000) — so they
// can never collide and are easy to recognise.
const ARTIFACT_TASK_ID_BASE = 1_000_000;

// MARK: Skills

export class Skill {
    type: SkillType = SkillType.Count;
    level: number = 0;
    progress: number = 0;
    speed_modifier: number = 1;

    constructor(type: SkillType, level: number) {
        this.type = type;
        this.level = level;
    }
}

export function calcSkillXp(task: Task, task_progress: number, ignore_boost = false): number {
    // Raw mode: raw_xp is the absolute per-progress XP base (xp_base and the
    // zone backbone pre-dissolved into it), applied below at the SAME chain
    // position as the zone factor it replaces — the multiplication order is
    // load-bearing for tick-for-tick equivalence with formula mode.
    const raw = ECONOMY.value_mode == "raw" && task.task_definition.raw_xp !== undefined;
    const xp_mult = raw ? 1 : ECONOMY.xp_base;
    let xp = task_progress * xp_mult * task.task_definition.xp_mult;

    if (hasPerk(PerkType.Writing)) {
        xp *= 1.5;
    }

    if (hasPerk(PerkType.GazedBeyondTheVeil)) {
        xp *= 2;
    }

    if (hasPrestigeUnlock(PrestigeUnlockType.DivineInspiration)) {
        xp *= 1.5;
    }

    xp *= 1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.DivineKnowledge) * DIVINE_KNOWLEDGE_MULT;
    xp *= 1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.DivinerKnowledge) * DIVINER_KNOWLEDGE_MULT;

    if (hasPrestigeUnlock(PrestigeUnlockType.UnparalleledLearning))
    {
        xp *= FINAL_PRESTIGE_MULT;
    }

    if (raw) {
        xp *= task.task_definition.raw_xp as number;
    } else {
        xp *= Math.pow(ECONOMY.xp_zone_mult, task.task_definition.zone_id);
    }

    if (!ignore_boost && task.xp_boosted) {
        xp *= MAGIC_RING_MULT;
    }

    return xp;
}

export function calcSkillXpNeeded(skill: Skill): number {
    return calcSkillXpNeededAtLevel(skill.level, skill.type);
}

export function calcSkillXpNeededAtLevel(level: number, skill_type: SkillType): number {
    const exponent_base = ECONOMY.level_curve;
    const base_amount = 10;
    const skill_modifier = (SKILL_DEFINITIONS[skill_type] as SkillDefinition).xp_needed_mult;

    return Math.pow(exponent_base, level) * base_amount * skill_modifier;
}

function addSkillXp(skill: SkillType, xp: number) {
    const skill_entry = getSkill(skill);

    skill_entry.progress += xp;
    let xp_to_level_up = calcSkillXpNeeded(skill_entry);

    const old_level = skill_entry.level;
    while (skill_entry.progress >= xp_to_level_up) {
        skill_entry.progress -= xp_to_level_up;
        skill_entry.level += 1;
        xp_to_level_up = calcSkillXpNeeded(skill_entry);
    }

    if (skill_entry.level > old_level) {
        const context: SkillUpContext = { skill: skill_entry.type, new_level: skill_entry.level, levels_gained: skill_entry.level - old_level };
        const event = new RenderEvent(EventType.SkillUp, context);
        GAMESTATE.queueRenderEvent(event);
    }
}

function removeTemporarySkillBonuses() {
    for (const skill of GAMESTATE.skills.values()) {
        skill.speed_modifier = 1;
    }
}

// Fractional skill levels gained from adding `xp` to a skill, evaluated
// against its current level/progress without mutating anything. Replays the
// addSkillXp level-up loop and counts the partial progress toward the next
// level on both sides, so tasks that grant less than a full level still
// produce a usable (nonzero) number.
function calcFractionalLevelsFromXp(skill_type: SkillType, xp: number): number {
    const skill = getSkill(skill_type);
    let level = skill.level;
    let progress = skill.progress + xp;
    let needed = calcSkillXpNeededAtLevel(level, skill_type);
    const start_fraction = skill.progress / needed;

    while (progress >= needed) {
        progress -= needed;
        level += 1;
        needed = calcSkillXpNeededAtLevel(level, skill_type);
    }

    return (level - skill.level) + progress / needed - start_fraction;
}

// Expected (fractional) skill levels one full rep of this task would grant
// right now. XP per tick is linear in task progress, so a whole rep awards
// each of the task's skills calcSkillXp(task, calcTaskCost(task)); boosts
// like a queued Magic Ring are deliberately ignored so the estimate reflects
// the task itself.
export function calcExpectedLevels(task: Task): number {
    const xp = calcSkillXp(task, calcTaskCost(task), true);
    let levels = 0;
    for (const skill_type of task.task_definition.skills) {
        levels += calcFractionalLevelsFromXp(skill_type, xp);
    }
    return levels;
}

export function calcSkillTaskProgressMultiplierFromLevel(level: number): number {
    const exponent = 1.01;
    return Math.pow(exponent, level);
}

export function calcSkillTaskProgressWithoutLevel(skill_type: SkillType): number {
    let mult = 1;

    const skill = getSkill(skill_type);
    mult *= skill.speed_modifier;

    for (const [perk_type, active] of GAMESTATE.perks) {
        if (!active) {
            continue;
        }

        const perk = PERKS[perk_type] as PerkDefinition;
        mult *= 1 + perk.skill_modifiers.getSkillEffect(skill_type);
    }

    if (getPowerSkills().includes(skill_type)) {
        mult *= calcPowerSpeedBonusAtLevel(GAMESTATE.power);
    }

    if (calcAttunementSkills().includes(skill_type)) {
        mult *= calcAttunementSpeedBonusAtLevel(GAMESTATE.attunement);
    }

    if (getSpiteTheGodsSkills().includes(skill_type)) {
        mult *= calcSpiteTheGodsBonus();
    }

    if (skill_type == SKILL_ROLES.travel_skill && hasPrestigeUnlock(PrestigeUnlockType.GodlyTravel)) {
        mult *= GODLY_TRAVEL_MULT;
    }

    return mult;
}

export function calcSkillTaskProgressMultiplier(skill_type: SkillType): number {
    const skill = getSkill(skill_type);
    let mult = calcSkillTaskProgressWithoutLevel(skill_type);
    mult *= calcSkillTaskProgressMultiplierFromLevel(skill.level);
    return mult;
}

export function getSkill(skill: SkillType): Skill {
    const ret = GAMESTATE.skills[skill];
    if (!ret) {
        console.error("Couldn't find skill");
        return new Skill(skill, 0);
    }
    return ret;
}

function initializeSkills() {
    GAMESTATE.skills = [];
    GAMESTATE.skills_at_start_of_reset = [];
    const global_target_level = getPrestigeRepeatableLevel(PrestigeRepeatableType.TranscendantAptitude) * TRANSCENDANT_APTITUDE_MULT;

    for (let skill = 0; skill < SkillType.Count; ++skill) {
        const target_level = skill == SKILL_ROLES.ascension_skill ? global_target_level / 2 : global_target_level;
        GAMESTATE.skills.push(new Skill(skill, target_level));
        GAMESTATE.skills_at_start_of_reset.push(target_level);
    }
}

function storeLoopStartNumbersForNextGameOver() {
    for (const skill of SKILLS) {
        GAMESTATE.skills_at_start_of_reset[skill] = getSkill(skill).level;
    }

    GAMESTATE.attunement_at_start_of_reset = GAMESTATE.attunement;
    GAMESTATE.power_at_start_of_reset = GAMESTATE.power;
}


// MARK: Tasks

// Raw-value economy mode (Fork 1.8): a task/zone whose dataset carries raw
// values reads them instead of the zone-keyed backbone formulas. Runtime-
// synthesized tasks (host-injected exit tasks, scheduled artifact tasks)
// carry no raw values and fall back to the formula even in raw mode — the
// backbone fields are still carried by raw datasets for exactly this.
function usesRawValues(def: TaskDefinition): boolean {
    return ECONOMY.value_mode == "raw" && def.raw_cost !== undefined;
}

// The per-zone speedup factor — applied to BOTH task progress per tick and
// energy drain per tick (the two cancel in energy terms; the factor is a pure
// time compression). In raw mode each zone carries it as raw_drain.
function calcZoneSpeedupFactor(zone: number): number {
    if (ECONOMY.value_mode == "raw") {
        const raw_drain = ZONES[zone]?.raw_drain;
        if (raw_drain !== undefined) {
            return raw_drain;
        }
    }
    return Math.pow(ECONOMY.zone_speedup_base, zone);
}

export function calcTaskCost(task: Task): number {
    const def = task.task_definition;
    if (usesRawValues(def)) {
        // raw_cost is the absolute base cost (the zone/Boss backbone is
        // pre-dissolved into it); cost_multiplier stays the patch lever.
        return (def.raw_cost as number) * def.cost_multiplier;
    }
    const base_cost = ECONOMY.base_task_cost;
    const normal_exponent = ECONOMY.zone_cost_exponent;
    const boss_exponent = ECONOMY.boss_cost_exponent;
    const zone_exponent = def.type == TaskType.Boss ? boss_exponent : normal_exponent;
    const zone_mult = Math.pow(zone_exponent, def.zone_id);

    return base_cost * def.cost_multiplier * zone_mult;
}

export function calcTaskProgressMultiplier(task: Task, override_haste: boolean | null = null, override_lightning: boolean | null = null): number {
    let mult = 1;

    let skill_level_mult = 1;
    for (const skill_type of task.task_definition.skills) {
        skill_level_mult *= calcSkillTaskProgressMultiplierFromLevel(getSkill(skill_type).level);
    }

    // Avoid multi-skill tasks scaling much faster than all other tasks.
    // Skip when the task has no skills — 1/0 = Infinity, and
    // Math.pow(1, Infinity) is NaN, which poisons everything downstream
    // (tooltip energy/ticks render as NaN).
    if (task.task_definition.skills.length > 0) {
        mult *= Math.pow(skill_level_mult, 1 / task.task_definition.skills.length);
    }

    let has_attunement_skill = false;
    for (const skill_type of task.task_definition.skills) {
        mult *= calcSkillTaskProgressWithoutLevel(skill_type);
        const is_attunement_skill = calcAttunementSkills().includes(skill_type);
        if (is_attunement_skill) {
            has_attunement_skill = true;
            mult /= calcAttunementSpeedBonusAtLevel(GAMESTATE.attunement);
        }
    }

    // The bonus gets truly ridiculous if we let it stack, so let's not
    if (has_attunement_skill) {
        mult *= calcAttunementSpeedBonusAtLevel(GAMESTATE.attunement);
    }

    mult *= Math.pow(GOTTA_GO_FAST_BASE, getPrestigeRepeatableLevel(PrestigeRepeatableType.GottaGoFast));

    if ((override_haste === null && task.hasted) || override_haste === true) {
        mult *= HASTE_MULT;
    }

    if ((override_lightning === null && task.lightning) || override_lightning === true) {
        mult *= BOTTLED_LIGHTNING_MULT;
    }

    mult *= calcZoneSpeedupFactor(task.task_definition.zone_id);

    if (hasPerk(PerkType.MajorTimeCompression)) {
        mult *= MAJOR_TIME_COMPRESSION_EFFECT;
    }

    if (hasPerk(PerkType.UnifiedTheoryOfMagic)) {
        mult *= Math.pow(1 + UNIFIED_THEORY_OF_MAGIC_EFFECT, GAMESTATE.highest_zone_fully_completed + 1);
    }

    const mandatoryish = task.task_definition.type == TaskType.Travel || task.task_definition.type == TaskType.Mandatory || task.task_definition.type == TaskType.Prestige;
    if (mandatoryish) {
        mult *= 1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.MandatorySchmandatory) * MANDATORY_SCHMANDATORY_MULT;

        if (hasPrestigeUnlock(PrestigeUnlockType.DivineSupremacy)) {
            mult *= FINAL_PRESTIGE_MULT;
        }
    }

    if (hasPrestigeUnlock(PrestigeUnlockType.AmazingSpeed)) {
        mult *= FINAL_PRESTIGE_MULT;
    }

    return mult * task_progress_mult;
}

function calcTaskProgressPerTick(task: Task): number {
    return calcTaskProgressMultiplier(task);
}

export function calcTaskTicks(progress_per_tick: number, cost: number) {
    return Math.ceil(cost / progress_per_tick);
}

function calcTaskEnergyCost(task: Task, hasted: boolean, lightning: boolean): number {
    const progress_per_tick = calcTaskProgressMultiplier(task, hasted, lightning);
    const cost = calcTaskCost(task);
    const energy_per_tick = calcEnergyDrainPerTick(task, isSingleTickTaskImpl(progress_per_tick, cost));
    const ticks = calcTaskTicks(progress_per_tick, cost);

    return ticks * energy_per_tick;
}

function isSingleTickTaskImpl(progress: number, cost: number) {
    return (progress + TASK_STARTED_PROGRESS) >= cost;
}

function isSingleTickTask(task: Task) {
    const progress = calcTaskProgressPerTick(task);
    const cost = calcTaskCost(task);

    return isSingleTickTaskImpl(progress, cost);
}

export function willCompleteAllRepsInOneTick(task: Task) {
    if (!hasPerk(PerkType.MajorTimeCompression)) {
        return false;
    }

    return isSingleTickTask(task);
}

function progressTask(task: Task, progress: number, consume_energy = true) {
    const cost = calcTaskCost(task);
    progress = Math.min(progress, cost - task.progress);
    task.progress += progress;

    const is_single_tick = isSingleTickTaskImpl(progress, cost);
    if (consume_energy) {
        modifyEnergy(-calcEnergyDrainPerTick(task, is_single_tick));
    }

    for (const skill of task.task_definition.skills) {
        addSkillXp(skill, calcSkillXp(task, progress));
    }

    const finished_rep = task.progress >= cost;
    if (finished_rep) {
        applyFinishTaskRepEffects(task);
    } else {
        return;
    }

    if (is_single_tick && hasPerk(PerkType.MajorTimeCompression)) {
        while (task.reps < task.task_definition.max_reps) {
            applyFinishTaskRepEffects(task);

            for (const skill of task.task_definition.skills) {
                addSkillXp(skill, calcSkillXp(task, progress));
            }
        }
    }

    const fully_finished = task.reps == task.task_definition.max_reps;
    if (fully_finished) {
        onFullyFinishTask(task);
    }

    updateEnabledTasks();
}

function completeTaskInstantly(task: Task) {
    // Calculate remaining reps and complete them all at once, billing
    // the same energy + XP a normal tick-by-tick execution would.
    // Ported from iframe_games/journey-to-ascension-modified (2026-01-20),
    // with fullyFinishTask → onFullyFinishTask rename (upstream refactor
    // 2025-09-22 → 2026-04-12).
    const remaining_reps = task.task_definition.max_reps - task.reps;
    if (remaining_reps <= 0) {
        return;
    }

    const cost = calcTaskCost(task);
    const progress_per_tick = calcTaskProgressMultiplier(task);

    for (let rep = 0; rep < remaining_reps; rep++) {
        const is_single_tick = isSingleTickTaskImpl(progress_per_tick, cost);
        const ticks_for_rep = calcTaskTicks(progress_per_tick, cost - task.progress);
        const energy_per_tick = calcEnergyDrainPerTick(task, is_single_tick);
        const energy_for_rep = ticks_for_rep * energy_per_tick;
        modifyEnergy(-energy_for_rep);

        const xp_progress = cost - task.progress;
        for (const skill of task.task_definition.skills) {
            addSkillXp(skill, calcSkillXp(task, xp_progress));
        }

        task.progress = 0;
        applyFinishTaskRepEffects(task);
    }

    onFullyFinishTask(task);
    updateEnabledTasks();
}

function updateActiveTask() {
    let active_task = GAMESTATE.active_task;
    if (!active_task) {
        GAMESTATE.active_task = pickNextTaskInAutomationQueue();
        active_task = GAMESTATE.active_task;
        if (active_task && active_task.progress == 0) {
            applyTaskRepStartEffects(active_task);
        }
    }
    if (!active_task) {
        return;
    }

    // Can't undo after the item's started having an effect
    disableItemUndo();

    // Instant mode: complete the entire task in one tick. Active via the
    // programmatic hook (window.setInstantMode, used by the substrate and
    // tests) OR the player-facing mod pair (toggle gated behind Settings).
    if (instant_mode || (GAMESTATE.mods.instant_mode_allowed && GAMESTATE.mods.instant_mode)) {
        completeTaskInstantly(active_task);
        GAMESTATE.active_task = null;
        saveGame();
        return;
    }

    const progress = calcTaskProgressPerTick(active_task);
    const old_rep_count = active_task.reps;
    progressTask(active_task, progress);

    if (old_rep_count == active_task.reps) {
        return;
    }

    const fully_finished = active_task.reps == active_task.task_definition.max_reps;
    
    if (!GAMESTATE.repeat_tasks || fully_finished) {
        GAMESTATE.active_task = null;
    } else if (!fully_finished) {
        applyTaskRepStartEffects(active_task);
    }

    saveGame();
}

// Game Mod — smart auto-use of Scroll of Haste. Before an automated Task rep
// starts, spend a held Scroll of Haste on it when the rep is energy-expensive
// relative to our per-scroll energy budget. Mirrors the Prismatic Adventure
// "auto-apply armor" heuristic (use when cost > energy / itemsHeld): the more
// Scrolls we hold, the more freely we spend them. Pushes into the haste queue
// (via the item's on_consume) so applyTaskRepStartEffects then applies it to
// this rep just like a manually-used Scroll.
function maybeAutoUseHaste(task: Task) {
    if (!GAMESTATE.mods.auto_haste) {
        return;
    }
    // Only when item auto-use is currently enabled — so under an Auto Use Cycle
    // it fires only on the "on" runs — and never stacking on top of an
    // already-queued Scroll. Applies to both automated and manually-started reps.
    if (!GAMESTATE.auto_use_items || GAMESTATE.queued_scrolls_of_haste > 0) {
        return;
    }
    const scrolls_held = GAMESTATE.items.get(ItemType.ScrollOfHaste) ?? 0;
    if (scrolls_held <= 0 || isSingleTickTask(task)) {
        return; // nothing to spend, or the rep is too cheap to be worth a Scroll
    }
    const lightning = GAMESTATE.queued_lightning > 0 && task.task_definition.type == TaskType.Boss;
    const cost = calcTaskEnergyCost(task, false, lightning);
    const budget = GAMESTATE.current_energy / scrolls_held;
    if (cost > budget) {
        useItem(ItemType.ScrollOfHaste, 1);
        disableItemUndo();
    }
}

// Auto Bottled Lightning: like Auto Scroll of Haste, but Bottled Lightning only
// affects Boss Tasks, so this only acts on Bosses. Runs before maybeAutoUseHaste
// (Lightning is applied first); maybeAutoUseHaste's cost estimate then accounts
// for any Lightning just auto-queued, so it only adds a Scroll if the Boss rep
// is still unaffordable.
function maybeAutoUseLightning(task: Task) {
    if (!GAMESTATE.mods.auto_lightning) {
        return;
    }
    if (task.task_definition.type != TaskType.Boss) {
        return; // Bottled Lightning does nothing on non-Boss Tasks
    }
    // Same gating as auto-haste: only while item auto-use is on, and never
    // stacking on top of an already-queued Bottled Lightning.
    if (!GAMESTATE.auto_use_items || GAMESTATE.queued_lightning > 0) {
        return;
    }
    const lightning_held = GAMESTATE.items.get(ItemType.BottledLightning) ?? 0;
    if (lightning_held <= 0 || isSingleTickTask(task)) {
        return; // nothing to spend, or the rep is too cheap to be worth one
    }
    const hasted = GAMESTATE.queued_scrolls_of_haste > 0;
    const cost = calcTaskEnergyCost(task, hasted, false);
    const budget = GAMESTATE.current_energy / lightning_held;
    if (cost > budget) {
        useItem(ItemType.BottledLightning, 1);
        disableItemUndo();
    }
}

// Game Mod — Auto Magic Ring. A Ring is 5x XP for one rep, so it should go to
// the task where one rep converts that XP into the most skill levels. Future
// skill states are unknowable, so the ranking comes from last run's completed
// tasks (see buildRingPlan): when a planned task starts, a Ring is held, and
// the task ranks within the top K of the plan — K = Rings held plus Rings
// already spent this run, so spending never shrinks the window and a Ring
// found mid-run widens it immediately — queue one, the same consumption path
// as a manually-used Ring. One Ring per planned task per run (ring_plan_used).
function maybeAutoUseRing(task: Task) {
    if (!GAMESTATE.mods.auto_ring) {
        return;
    }
    // Same gating as the other auto-artifact tools: only while item auto-use
    // is on, and never stacking on top of an already-queued Ring.
    if (!GAMESTATE.auto_use_items || GAMESTATE.queued_magic_rings > 0) {
        return;
    }
    const rings_held = GAMESTATE.items.get(ItemType.MagicRing) ?? 0;
    if (rings_held <= 0) {
        return;
    }
    const key = runTaskKey(task.task_definition.zone_id, task.task_definition.id);
    if (GAMESTATE.ring_plan_used.includes(key)) {
        return;
    }
    const rank = GAMESTATE.ring_plan.indexOf(key);
    if (rank < 0 || rank >= rings_held + GAMESTATE.ring_plan_used.length) {
        return;
    }
    GAMESTATE.ring_plan_used.push(key);
    useItem(ItemType.MagicRing, 1);
    disableItemUndo();
}

// Game Mod — Auto Dreamcatcher. A Dreamcatcher duplicates one copy of every
// Item type found this energy reset, so it's most valuable as late in the run
// as possible. Proxy for "late": the next rep would consume at least the
// configured percentage of current energy. One copy per qualifying rep start —
// once reps start qualifying, they mostly keep qualifying (energy only
// shrinks), so remaining copies drain naturally as the run winds down. Runs
// after the haste/lightning decisions so the cost estimate reflects the
// boosts that will actually apply. Unlike those tools the effect is instant
// (the item's on_consume does the duplication; no queued counter).
function maybeAutoUseDreamcatcher(task: Task) {
    if (!GAMESTATE.mods.auto_dreamcatcher) {
        return;
    }
    if (!GAMESTATE.auto_use_items) {
        return; // same banking-cycle convention as auto haste/lightning
    }
    if ((GAMESTATE.items.get(ItemType.Dreamcatcher) ?? 0) <= 0) {
        return;
    }
    // Nothing (except Dreamcatchers) found yet — using one would duplicate nothing.
    if (!GAMESTATE.items_found_this_energy_reset.some((item) => item != ItemType.Dreamcatcher)) {
        return;
    }
    const hasted = GAMESTATE.queued_scrolls_of_haste > 0;
    const lightning = GAMESTATE.queued_lightning > 0 && task.task_definition.type == TaskType.Boss;
    const cost = calcTaskEnergyCost(task, hasted, lightning);
    if (cost >= (GAMESTATE.mods.auto_dreamcatcher_pct / 100) * GAMESTATE.current_energy) {
        useItem(ItemType.Dreamcatcher, 1);
        disableItemUndo();
    }
}

// Note that free executions don't call this
export function applyTaskRepStartEffects(task: Task) {
    // Pass-B first-start cost hook. This function is the single rep-start seam
    // reached before a task's cost is read in BOTH tick modes: updateActiveTask
    // calls it for a freshly-picked task (progress == 0) BEFORE the instant
    // branch (completeTaskInstantly, which reads calcTaskCost) AND before the
    // normal progressTask call (which reads calcTaskCost). Firing here — while
    // reps == 0 && progress == 0, before the TASK_STARTED_PROGRESS bump below —
    // lets the callback synchronously applyTaskPatches this task's
    // cost_multiplier and have the very tick that starts it observe the patched
    // cost. Synthetic tasks are host-owned/never-costed and never fire. The
    // reentrancy guard keeps the callback's applyTaskPatches from re-entering.
    if (_task_first_start_callback !== null
            && !_in_first_start_callback
            && task.reps == 0 && task.progress == 0
            && !isSyntheticTask(task)) {
        _in_first_start_callback = true;
        try {
            const def = task.task_definition;
            _task_first_start_callback({
                id: def.id, name: def.name, zone: def.zone_id, type: def.type,
                reps: task.reps, progress: task.progress,
            });
        } finally {
            _in_first_start_callback = false;
        }
    }

    // Artifact effects (auto-/queued Scroll of Haste, Magic Ring, Bottled
    // Lightning) shouldn't be spent on synthetic tasks: artifact tasks and host
    // exit tasks are instant and skill-less, so applying them just wastes the
    // queued Artifact. Keep them for the next real task.
    if (!isSyntheticTask(task)) {
        recordRunTaskHistory(task);
        maybeAutoUseRing(task);
        maybeAutoUseLightning(task);
        maybeAutoUseHaste(task);
        maybeAutoUseDreamcatcher(task);
        if (GAMESTATE.queued_scrolls_of_haste > 0) {
            task.hasted = true;
            GAMESTATE.queued_scrolls_of_haste--;
        }
        if (GAMESTATE.queued_magic_rings > 0) {
            task.xp_boosted = true;
            GAMESTATE.queued_magic_rings--;
        }
        if (GAMESTATE.queued_lightning > 0 && task.task_definition.type == TaskType.Boss) {
            task.lightning = true;
            GAMESTATE.queued_lightning--;
        }
    }

    if (task.task_definition.use_item != ItemType.Count) {
        consumeItem(task.task_definition.use_item, 1);
    }

    task.progress = Math.max(task.progress, TASK_STARTED_PROGRESS); // Slight progress to ensure it counts as started
}

export function clickTask(task: Task) {
    if (_edit_mode) {
        return; // can't start tasks while editing priorities
    }
    if (GAMESTATE.active_task == task) {
        GAMESTATE.active_task = null;
    }
    else {
        GAMESTATE.active_task = task;
        applyTaskRepStartEffects(task);
    }
}

function onFullyFinishTask(task: Task) {
    if (task.task_definition.perk != PerkType.Count) {
        tryAddPerk(task.task_definition.perk);
    }

    if (task.task_definition.unlocks_task >= 0) {
        unlockTask(task.task_definition.unlocks_task);
    }

    if (task.task_definition.type == TaskType.Travel) {
        if (_travel_task_callback) {
            _travel_task_callback(GAMESTATE.current_zone, {
                id: task.task_definition.id,
                name: task.task_definition.name,
            });
        }
        // In managed mode the host owns zone transitions — fire the
        // travel callback but skip the automatic advanceZone so the
        // substrate can render synthetic exit-choice tasks and dispatch
        // user:regionMove on the host side.
        if (!_managed_mode) {
            advanceZone();
        }
    }

    // Synthetic-task completion: a host-registered callback fires when
    // an injected task (e.g. an exit-choice task) is fully done. The
    // callback is one-shot; we drop it after firing.
    const syntheticCallback = _synthetic_task_callbacks.get(task.task_definition.id);
    if (syntheticCallback) {
        _synthetic_task_callbacks.delete(task.task_definition.id);
        syntheticCallback();
    }

    if (task.task_definition.type == TaskType.Prestige && !GAMESTATE.prestige_layers_unlocked.includes(task.task_definition.prestige_layer)) {
        GAMESTATE.prestige_layers_unlocked.push(task.task_definition.prestige_layer);
        GAMESTATE.unlocked_new_prestige_this_prestige = true;
        const event = new RenderEvent(EventType.NewPrestigeLayer, {});
        GAMESTATE.queueRenderEvent(event);
    }

    if (task.task_definition.type == TaskType.Prestige && !GAMESTATE.prestige_available) {
        GAMESTATE.prestige_available = true;
        if (!GAMESTATE.mods.suppress_prestige_popup) {
            const event = new RenderEvent(EventType.PrestigeAvailable, {});
            GAMESTATE.queueRenderEvent(event);
        }
    }

    // Game Mod — award a fraction of the full prestige currency each time a
    // Prestige task completes. Manual prestige still awards the full amount.
    if (task.task_definition.type == TaskType.Prestige && GAMESTATE.mods.award_spark_on_discovery) {
        const amount = Math.ceil(calcDivineSparkGain() * GAMESTATE.mods.discovery_spark_fraction);
        if (amount > 0) {
            GAMESTATE.divine_spark += amount;
            const context = new AwardedSparkContext();
            context.amount = amount;
            GAMESTATE.queueRenderEvent(new RenderEvent(EventType.AwardedSparkOnDiscovery, context));
        }
    }

    // General task-completion channel (Archipelago substrate host):
    // fired last, once the task's own finish effects have settled, for
    // EVERY fully-completed task. The host maps real zone tasks to AP
    // location checks; injected/artifact tasks are flagged synthetic so
    // the host can skip them (they have their own one-shot callbacks
    // above). Dormant in standalone play (callback null).
    if (_task_completion_callback) {
        const def = task.task_definition;
        _task_completion_callback({
            id: def.id, name: def.name, zone: def.zone_id, type: def.type,
            perk: def.perk, item: def.item,
            reps: task.reps, maxReps: def.max_reps,
            synthetic: isSyntheticTask(task),
        });
    }
}

function doAllTaskRepsForFree(task: Task) {
    const consume_energy = false;
    while (task.reps < task.task_definition.max_reps) {
        progressTask(task, calcTaskCost(task), consume_energy);
        // Deliberately doesn't call applyTaskRepStartEffects, we get to skip those
    }
}

function applyFinishTaskRepEffects(task: Task) {
    // Log the performed rep before its effects settle (ordered actions log).
    recordPerformedTaskRep(task);

    if (task.task_definition.item != ItemType.Count) {
        addItem(task.task_definition.item, 1);
    }

    task.reps += 1;
    if (task.reps < task.task_definition.max_reps) {
        task.progress = 0;
    }

    task.hasted = false;
    task.xp_boosted = false;

    addPower(calcPowerGain(task));
    addAttunement(calcAttunementGain(task));

    const event = new RenderEvent(EventType.TaskCompleted, {});
    GAMESTATE.queueRenderEvent(event);

    if (task.task_definition.item != ItemType.Count) {
        maybeUseRoundingErrorItem(task.task_definition.item);
    }

    // Scheduled artifact task: using it is the whole point of the task.
    const artifact_spec = getArtifactTaskSpec(task.task_definition.id);
    if (artifact_spec && (GAMESTATE.items.get(artifact_spec.item) ?? 0) > 0) {
        artifact_spec.done = true;
        useItem(artifact_spec.item, 1);
        disableItemUndo();
    }

    // Run task history: only successfully completed reps count toward the
    // next run's Magic Ring plan. Free completions (Mastery of Time) never
    // recorded a start, so the find can miss — that's fine.
    const history_record = GAMESTATE.run_task_history.find(
        (r) => r.zone_id == task.task_definition.zone_id && r.task_id == task.task_definition.id);
    if (history_record) {
        history_record.completed = true;
    }
}

// The most a Boss's energy cost may exceed your current energy and still be
// attemptable: the best item-based speedup that could bring it within reach. A
// Scroll of Haste (HASTE_MULT) is always available; Bottled Lightning stacks on
// top once you've obtained it. So the limit is HASTE_MULT, or HASTE_MULT *
// BOTTLED_LIGHTNING_MULT (5 -> 10) after the first Bottled Lightning.
export function getBossEnergyDisparityLimit(): number {
    return HASTE_MULT * (knowsItem(ItemType.BottledLightning) ? BOTTLED_LIGHTNING_MULT : 1);
}

export function isTaskDisabledDueToTooStrongBoss(task: Task) {
    if (task.progress > 0) {
        return false;
    }

    if (task.task_definition.type != TaskType.Boss) {
        return false;
    }

    // Compare the base cost (no queued items) against that best reduction, so a
    // Boss is locked only if even Haste(+Lightning) couldn't bring it within
    // current energy. Using base cost keeps the rule independent of what Items
    // happen to be queued (which calcTaskEnergyCost would otherwise fold in).
    return calcTaskEnergyCost(task, false, false) > (GAMESTATE.current_energy * getBossEnergyDisparityLimit());
}

export function isTaskDisabledDueToMissingItem(task: Task) {
    if (isSingleTickTask(task)) {
        return false; // If it is that cheap, we don't care about the item
    }

    if (task.progress > 0) {
        return false;
    }

    if (task.task_definition.use_item == ItemType.Count) {
        return false;
    }

    const item_count = GAMESTATE.items.get(task.task_definition.use_item) ?? 0;
    return item_count <= 0;
}

// Pass-B cost-assignment allowlist: while the balance walk is active, a real
// task with no cost assigned yet is UNCOSTED — not runnable by automation, and
// not eligible for the free-completion paths (free-zone skip, Mastery of
// Time), which bypass applyTaskRepStartEffects and so would complete the task
// without its first-start cost hook ever firing. Synthetic tasks (host exit /
// artifact tasks) are host-owned, never costed, and exempt. Always false when
// the allowlist is unset (standalone play).
function isTaskUncosted(task: Task): boolean {
    return _costed_task_ids !== null
        && !_costed_task_ids.has(task.task_definition.id)
        && !isSyntheticTask(task);
}

export function isTaskDisabledWithoutBeingFinished(task: Task) {
    if (isTaskDisabledDueToTooStrongBoss(task)) {
        return true;
    }

    if (isTaskDisabledDueToMissingItem(task)) {
        return true;
    }

    if (isTaskUncosted(task)) {
        return true;
    }

    return false;
}

function updateEnabledTasks() {
    let has_unfinished_mandatory_task = false;

    for (const task of GAMESTATE.tasks) {
        const finished = task.reps >= task.task_definition.max_reps;
        task.enabled = !finished && !isTaskDisabledWithoutBeingFinished(task);

        // Scheduled artifact task: only runnable while we hold a copy, and —
        // if the global flag is set — only on item (auto-use) cycles. Otherwise
        // it's left disabled, so the automation queue skips past it.
        const artifact_spec = getArtifactTaskSpec(task.task_definition.id);
        if (artifact_spec) {
            const held = GAMESTATE.items.get(artifact_spec.item) ?? 0;
            const cycle_ok = !GAMESTATE.mods.artifact_tasks_item_cycle_only || GAMESTATE.auto_use_items;
            task.enabled = task.enabled && held > 0 && cycle_ok;
        }

        has_unfinished_mandatory_task = has_unfinished_mandatory_task
            || (task.task_definition.type == TaskType.Mandatory && !finished)
            || (task.task_definition.type == TaskType.Prestige && !finished);
    }

    if (has_unfinished_mandatory_task) {
        for (const task of GAMESTATE.tasks) {
            if (task.task_definition.type == TaskType.Travel) {
                task.enabled = false;
            }
        }
    }
}

export function resetTasks() {
    initializeTasks();
    updateEnabledTasks();
    GAMESTATE.is_at_end_of_content = false;
}

function initializeTasks() {
    GAMESTATE.active_task = null;
    GAMESTATE.tasks = [];

    const zone = ZONES[GAMESTATE.current_zone];
    if (zone) {
        for (const task of zone.tasks) {
            if (task.hidden_by_default && !GAMESTATE.unlocked_tasks.includes(task.id)) {
                continue;
            }

            GAMESTATE.tasks.push(new Task(task));
            for (const skill of task.skills) {
                if (!GAMESTATE.unlocked_skills.includes(skill)) {
                    GAMESTATE.unlocked_skills.push(skill);
                    // Don't cause notifications when literally just starting the game
                    if (GAMESTATE.current_zone != 0) {
                        const context: UnlockedSkillContext = { skill: skill };
                        const event = new RenderEvent(EventType.UnlockedSkill, context);
                        GAMESTATE.queueRenderEvent(event);
                    }
                }
            }
        }
    }

    injectArtifactTasksForCurrentZone();
    updateEnabledTasks();
}

export function toggleRepeatTasks() {
    GAMESTATE.repeat_tasks = !GAMESTATE.repeat_tasks;
}

function taskUnlocksTask(task: Task) {
    return task.task_definition.unlocks_task >= 0 && !GAMESTATE.unlocked_tasks.includes(task.task_definition.unlocks_task);
}

function unlockTask(task_id: number) {
    if (GAMESTATE.unlocked_tasks.includes(task_id)) {
        return;
    }

    const task = TASK_LOOKUP.get(task_id) as TaskDefinition;
    GAMESTATE.unlocked_tasks.push(task_id);
    if (GAMESTATE.current_zone == task.zone_id) {
        GAMESTATE.tasks.push(new Task(task));
        const context: UnlockedTaskContext = { task_definition: task };
        const event = new RenderEvent(EventType.UnlockedTask, context);
        GAMESTATE.queueRenderEvent(event);
    }

    // Auto-Prioritize: slot the newly unlocked task into its zone's plan.
    maybeAutoPrioritizeZone(task.zone_id);
}

function isTaskFullyCompleted(task: Task): boolean {
    return task.reps >= task.task_definition.max_reps;
}

function doMasteryOfTimeTaskCompletion() {
    if (!hasPrestigeUnlock(PrestigeUnlockType.MasteryOfTime)) {
        return;
    }

    if (GAMESTATE.is_in_zone_skip) {
        // Gets handled at the end of the zone skipping so we don't spam unnecessary notifications
        return;
    }

    if ((GAMESTATE.current_zone + 1) >= GAMESTATE.automation_end) {
        // Let the user deal with it manually when it's not automated
        return;
    }

    // Artifacts shouldn't affect this
    const old_queued_haste = GAMESTATE.queued_scrolls_of_haste;
    const old_queued_rings = GAMESTATE.queued_magic_rings;
    const old_queued_lightning = GAMESTATE.queued_lightning;

    let num_complete = 0;

    for (const task of GAMESTATE.tasks) {
        if (isTaskFullyCompleted(task)) {
            continue;
        }

        // Don't let Mastery of Time fire synthetic tasks for free — that would
        // spend a scheduled Artifact outside its gating, or fire a host exit
        // callback. They run only through their own paths.
        if (isSyntheticTask(task)) {
            continue;
        }

        // Nor an UNCOSTED task (Pass-B allowlist): free completion bypasses
        // applyTaskRepStartEffects, so its cost would never be assigned.
        if (isTaskUncosted(task)) {
            continue;
        }

        if (!isSingleTickTask(task)) {
            continue;
        }

        if (task.task_definition.type == TaskType.Travel) {
            continue;
        }

        doAllTaskRepsForFree(task);
        ++num_complete;
    }

    if (num_complete > 0) {
        autoUseItems(); // Before the render event so the event's at the top
        const context: SkippedTasksContext = { tasks: num_complete };
        const event = new RenderEvent(EventType.SkippedTasks, context);
        GAMESTATE.queueRenderEvent(event);
    }

    GAMESTATE.queued_scrolls_of_haste = old_queued_haste;
    GAMESTATE.queued_magic_rings = old_queued_rings;
    GAMESTATE.queued_lightning = old_queued_lightning;
}

// MARK: Energy

function modifyEnergy(delta: number) {
    GAMESTATE.current_energy += delta;
}

function modifyMaxEnergy(delta: number) {
    GAMESTATE.max_energy += delta;
    // Mirror the delta into the starting-energy-bonus accumulator (fork
    // substrate hook). Every current caller is a JtA starting-energy bonus
    // (Energetic Memory, EnergySpell perk, Energized repeatable); the one
    // other bonus (Divine Supremacy) writes max_energy directly and mirrors
    // there. See the jta_starting_energy_bonus field comment.
    GAMESTATE.jta_starting_energy_bonus += delta;
    setTickRate();
}

export function calcReflectionsOnTheJourneyMult(zone: number) {
    const zone_diff = GAMESTATE.highest_zone - zone;
    const base = getReflectionsOnTheJourneyExponent();
    return Math.pow(base, zone_diff);
}

export function calcEnergyDrainPerTickInZone(zone: number): number {
    let drain = 1;

    if (hasPerk(PerkType.HighAltitudeClimbing)) {
        drain *= 0.8;
    }

    if (hasPerk(PerkType.ReflectionsOnTheJourney)) {
        drain *= calcReflectionsOnTheJourneyMult(zone);
    }

    if (hasPerk(PerkType.MajorTimeCompression)) {
        drain *= MAJOR_TIME_COMPRESSION_EFFECT;
    }

    drain *= calcZoneSpeedupFactor(zone);

    return drain;
}

export function calcEnergyDrainPerTick(task: Task, is_single_tick: boolean): number {
    // Substrate-injected free tasks (e.g. exit-choice tasks) drain
    // nothing, regardless of zone / perks / single-tick status.
    if (task.task_definition.free) {
        return 0;
    }

    let drain = calcEnergyDrainPerTickInZone(task.task_definition.zone_id);

    if (is_single_tick && hasPrestigeUnlock(PrestigeUnlockType.MasteryOfTime)) {
        return 0;
    }

    if (is_single_tick && hasPerk(PerkType.MinorTimeCompression)) {
        drain *= 0.2;
    }

    if (is_single_tick && hasPerk(PerkType.MajorTimeCompression)) {
        // Make up for it always getting applied in calcEnergyDrainPerTickInZone
        drain /= MAJOR_TIME_COMPRESSION_EFFECT;
    }

    return drain;
}

function doAnyReset() {
    // Both energy reset and prestige funnel through here — snapshot the run's
    // performed actions before the fresh run begins.
    snapshotRunActions();
    GAMESTATE.current_zone = 0;
    resetArtifactTaskCycleState();
    resetTasks();
    GAMESTATE.current_energy = GAMESTATE.max_energy;
    GAMESTATE.is_in_energy_reset = false;
    GAMESTATE.is_at_end_of_content = false;
    GAMESTATE.automation_mode = AutomationMode.Off;
    GAMESTATE.queued_scrolls_of_haste = 0;
    GAMESTATE.queued_magic_rings = 0;
    GAMESTATE.queued_lightning = 0;
    GAMESTATE.items_found_this_energy_reset = [];
    GAMESTATE.used_items.clear();
    removeTemporarySkillBonuses();
}

function calcEnergeticMemoryGain() {
    if (!hasPerk(PerkType.EnergeticMemory)) {
        return 0;
    }
    let energy_gain = (GAMESTATE.current_zone + 1) * ENERGETIC_MEMORY_MULT;
    if (energy_gain > 1 && hasPrestigeUnlock(PrestigeUnlockType.TranscendantMemory)) {
        energy_gain *= energy_gain;
    }

    const energized_level = getPrestigeRepeatableLevel(PrestigeRepeatableType.Energized);
    energy_gain *= 1 + energized_level * ENERGIZED_PERK_INCREASE;

    return energy_gain;
}

// Game Mod — cycle item auto-use across Energy Resets: run the configured
// number of resets with Auto Use Items off (banking Items), then one reset
// with it on (spending the stockpile), and repeat. Called once per Energy
// Reset; drives GAMESTATE.auto_use_items, overriding the manual toggle while
// the mod is enabled. The counter persists in the save and resets on Prestige.
function applyAutoUseCycle() {
    if (!GAMESTATE.mods.auto_use_cycle) {
        return;
    }
    GAMESTATE.auto_use_excluded_items = []; // the auto-use cycle never excludes
    const off_resets = Math.max(0, Math.floor(GAMESTATE.mods.auto_use_cycle_off_resets));
    if (GAMESTATE.auto_use_cycle_counter >= off_resets) {
        GAMESTATE.auto_use_items = true;
        GAMESTATE.auto_use_cycle_counter = 0;
    } else {
        GAMESTATE.auto_use_items = false;
        GAMESTATE.auto_use_cycle_counter += 1;
    }
}

export function doEnergyReset() {
    modifyMaxEnergy(calcEnergeticMemoryGain());
    updatePrepRunHint(); // Needs to be before we reset the item use

    // Game Mod — resume automation after the reset. Captured before
    // doAnyReset zeroes automation_mode; scoped to energy resets (perks,
    // incl. the Amulet that gates automation, are kept across them).
    const resume_automation = GAMESTATE.mods.resume_automation_on_reset;
    const saved_automation_mode = GAMESTATE.automation_mode;

    // The run that just ended belongs to the pre-cycle context (queue index /
    // auto-use phase); capture it before applyResetCycle advances them.
    const ending_ring_context = currentRingContext();

    // Advance the per-reset cycle (queue swap or auto-use cycle) before
    // doAnyReset rebuilds the zone, so the newly-active queue's priorities and
    // artifact tasks are the ones injected.
    applyResetCycle();

    doAnyReset(); // Gotta be after the current_zone check in calcEnergeticMemoryGain

    // Auto-Prioritize: regenerate every zone's plan for the new run. After
    // the cycle/reset so it wins over any loaded queue (the mods are mutually
    // exclusive, but a stale queue plan could otherwise leak through).
    maybeAutoPrioritizeAll();

    if (resume_automation) {
        GAMESTATE.automation_mode = saved_automation_mode;
    }
    GAMESTATE.energy_reset_count += 1;
    GAMESTATE.resets_since_highest_zone_gain += 1;
    handleEnergyResetItemCounts();

    // Bank the ended run's completions under its context, then rank the new
    // run's Magic Ring plan from the new context's own history.
    GAMESTATE.run_history_by_context[ending_ring_context] = GAMESTATE.run_task_history.filter((r) => r.completed);
    GAMESTATE.run_task_history = [];
    buildRingPlan();

    storeLoopStartNumbersForNextGameOver();
    skipFreeZones();

    saveGame();

    // Notify the host that an energy reset happened (jta's own
    // game-over). The substrate bridge uses this to keep the shared
    // loop-mode pool in sync — pushing jta's post-reset energy out, and
    // observing the count so it doesn't double-apply on reactivation.
    if (_energy_reset_callback) {
        _energy_reset_callback({
            currentEnergy: GAMESTATE.current_energy,
            maxEnergy: GAMESTATE.max_energy,
            energyResetCount: GAMESTATE.energy_reset_count,
        });
    }
}

export function calcItemEnergyGain(base_energy: number) {
    let value = base_energy;
    value *= (1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.DivineAppetite) * DIVINE_APPETITE_ENERGY_ITEM_BOOST_MULT);

    if (hasPerk(PerkType.SupplyLines)) {
        value *= 1 + SUPPLY_LINES_EFFECT;
    }

    return Math.floor(value);
}

// MARK: Items

export function addItem(item: ItemType, count: number) {
    const oldValue = GAMESTATE.items.get(item) ?? 0;
    GAMESTATE.items.set(item, oldValue + count);

    if (!GAMESTATE.items_found_this_energy_reset.includes(item)) {
        GAMESTATE.items_found_this_energy_reset.push(item);
    }

    const event = new RenderEvent(EventType.GainedItem, {});
    GAMESTATE.queueRenderEvent(event);
}

function consumeItem(item: ItemType, amount: number ) {
    const old_value = GAMESTATE.items.get(item) ?? 0;
    GAMESTATE.items.set(item, old_value - amount);
}

function useItem(item: ItemType, amount: number) {
    consumeItem(item, amount);
    recordPerformedItem(item, amount);
    const old_use_value = GAMESTATE.used_items.get(item) ?? 0;
    const definition = ITEMS[item] as ItemDefinition;
    definition.applyEffects(amount);
    GAMESTATE.used_items.set(item, old_use_value + amount);

    const context: UsedItemContext = { item: item, count: Math.abs(amount) };
    const event = new RenderEvent(amount > 0 ? EventType.UsedItem : EventType.UndidItem, context);
    GAMESTATE.queueRenderEvent(event);

    // Can't undo after the item's started having an effect
    if (GAMESTATE.active_task == null && amount > 0) {
        GAMESTATE.undo_item = [item, amount];
    }

    updateEnabledTasks();
}

export function clickItem(item: ItemType, use_all: boolean) {
    const old_value = GAMESTATE.items.get(item) ?? 0;

    if (old_value <= 0) {
        console.error("Not held item?");
        return;
    }

    const num_used = use_all ? old_value : 1;
    useItem(item, num_used);
}

// How many of an Item are kept after an Energy Reset, given a starting count.
// UnderstandingTheReset keeps half (rounded up), otherwise none; Compulsive
// Notetaking then raises note Items to a floor. Shared by the reset itself and
// by the "use free Items" mod so the two never disagree on the rounding.
export function calcItemsKeptOnEnergyReset(item: ItemType, value: number): number {
    let kept = hasPerk(PerkType.UnderstandingTheReset) ? Math.ceil(value / 2) : 0;
    if (hasPrestigeUnlock(PrestigeUnlockType.CompulsiveNotetaking) && NOTE_ITEMS.includes(item)) {
        kept = Math.max(kept, COMPULSIVE_NOTE_TAKING_AMOUNT);
    }
    return kept;
}

function handleEnergyResetItemCounts() {
    for (const [key, value] of GAMESTATE.items) {
        GAMESTATE.items.set(key, calcItemsKeptOnEnergyReset(key, value));
    }

    // CompulsiveNotetaking can grant note Items the player wasn't holding at all.
    if (hasPrestigeUnlock(PrestigeUnlockType.CompulsiveNotetaking)) {
        for (const item of NOTE_ITEMS) {
            if (!GAMESTATE.items.has(item)) {
                GAMESTATE.items.set(item, COMPULSIVE_NOTE_TAKING_AMOUNT);
            }
        }
    }
}

// Highest zone index that has a Task granting each Item. Built lazily on first
// use (not at module load) to avoid reading ZONES during the circular-import
// bootstrap, when it may not be initialized yet. Used to tell whether a later
// zone could still grant an Item this cycle (we never travel backwards).
let _last_source_zone: Map<ItemType, number> | null = null;
function lastSourceZone(item: ItemType): number {
    if (_last_source_zone == null) {
        const map = new Map<ItemType, number>();
        ZONES.forEach((zone, index) => {
            for (const def of zone.tasks) {
                if (def.item != ItemType.Count) {
                    map.set(def.item, index); // later zones overwrite earlier ones
                }
            }
        });
        _last_source_zone = map;
    }
    return _last_source_zone.get(item) ?? -1;
}

// Whether any remaining Task rep this cycle could still grant the Item: an
// unfinished source in the current zone, or any source in a later zone. Errs
// toward "yes" (later-zone sources count even if automation won't reach them),
// so the "use free Items" mod never spends a copy that more reps could replace.
function canStillGainItemThisReset(item: ItemType): boolean {
    for (const task of GAMESTATE.tasks) {
        if (task.task_definition.item == item && task.reps < task.task_definition.max_reps) {
            return true;
        }
    }
    return lastSourceZone(item) > GAMESTATE.current_zone;
}

// How many copies of an Item can be used right now without changing how many
// would be kept on the next Energy Reset — the "rounding-error" surplus.
function calcFreeToUseItems(item: ItemType): number {
    const value = GAMESTATE.items.get(item) ?? 0;
    if (value <= 0) {
        return 0;
    }
    const kept = calcItemsKeptOnEnergyReset(item, value);
    let free = 0;
    while (free < value && calcItemsKeptOnEnergyReset(item, value - (free + 1)) == kept) {
        free++;
    }
    return free;
}

// Game Mod — use "rounding-error" Items even on cycles where item auto-use is
// off. Called when a Task rep grants an Item; once that was the last rep that
// could grant it this cycle (so the count is final), use any copies that the
// keep rounding would let us spend for free.
function maybeUseRoundingErrorItem(item: ItemType) {
    if (!GAMESTATE.mods.auto_use_free_items || item == ItemType.Count) {
        return;
    }
    // Only ordinary Items, never Artifacts — they're strategic and have their
    // own handling (e.g. auto_haste for Scrolls), matching autoUseItems().
    if (ARTIFACTS.includes(item)) {
        return;
    }
    if (canStillGainItemThisReset(item)) {
        return;
    }
    const free = calcFreeToUseItems(item);
    if (free > 0) {
        useItem(item, free);
        disableItemUndo();
    }
}

// MARK: Artifact Tasks

// A player-scheduled "use this artifact here" task. The spec is durable (it
// persists across cycles/reloads); a fresh Task is injected into the zone each
// time it's loaded. `done` tracks whether it already fired this cycle so a
// mid-cycle reload doesn't re-arm and double-spend the artifact.
export interface ArtifactTaskSpec {
    task_id: number;   // unique id (>= ARTIFACT_TASK_ID_BASE); not "id" so the save replacer doesn't collapse the spec
    item: ItemType;
    zone_id: number;
    done: boolean;     // already used this cycle (reset on any reset)
}

export function isArtifactTaskId(id: number): boolean {
    return id >= ARTIFACT_TASK_ID_BASE;
}

// True for tasks we synthesise/inject rather than real zone tasks: player-
// scheduled artifact tasks and host-injected exit-choice tasks. They have their
// own gating and side effects, so generic mechanics (Mastery of Time free
// completion, queued Artifact effects) should skip them.
function isSyntheticTask(task: Task): boolean {
    return isArtifactTaskId(task.task_definition.id)
        || _synthetic_task_callbacks.has(task.task_definition.id);
}

function getArtifactTaskSpec(id: number): ArtifactTaskSpec | undefined {
    return GAMESTATE.artifact_tasks.find(spec => spec.task_id == id);
}

function makeArtifactTask(spec: ArtifactTaskSpec): Task {
    const item_def = ITEMS[spec.item] as ItemDefinition;
    const def = new TaskDefinition({
        id: spec.task_id,
        name: `Use ${item_def.name}`,
        type: TaskType.Normal,
        cost_multiplier: 0,
        max_reps: 1,
        zone_id: spec.zone_id,
        free: true,
        skills: [],
    });
    const task = new Task(def);
    task.reps = spec.done ? def.max_reps : 0; // a spec that already fired shows as finished
    return task;
}

// Add a Task for every artifact spec in the current zone that isn't already
// present. Called on zone load and after a save load.
function injectArtifactTasksForCurrentZone() {
    for (const spec of GAMESTATE.artifact_tasks) {
        if (spec.zone_id != GAMESTATE.current_zone) {
            continue;
        }
        if (GAMESTATE.tasks.some(t => t.task_definition.id == spec.task_id)) {
            continue;
        }
        GAMESTATE.tasks.push(makeArtifactTask(spec));
    }
}

// Schedule using one copy of `item` as a task in the current zone. Returns the
// new task id. The caller (UI) is responsible for re-rendering the task list.
export function addArtifactTask(item: ItemType): number {
    const spec: ArtifactTaskSpec = {
        task_id: GAMESTATE.next_artifact_task_id++,
        item,
        zone_id: GAMESTATE.current_zone,
        done: false,
    };
    GAMESTATE.artifact_tasks.push(spec);
    if (spec.zone_id == GAMESTATE.current_zone) {
        GAMESTATE.tasks.push(makeArtifactTask(spec));
        updateEnabledTasks();
    }
    syncActiveQueueIfCycling();
    saveGame();
    return spec.task_id;
}

// Remove a scheduled artifact task, dropping its live Task and any priority.
export function removeArtifactTask(task_id: number) {
    GAMESTATE.artifact_tasks = GAMESTATE.artifact_tasks.filter(spec => spec.task_id != task_id);
    GAMESTATE.tasks = GAMESTATE.tasks.filter(t => t.task_definition.id != task_id);
    for (const [, prios] of GAMESTATE.automation_prios) {
        const idx = prios.indexOf(task_id);
        if (idx >= 0) {
            prios.splice(idx, 1);
        }
    }
    syncActiveQueueIfCycling();
    saveGame();
}

export function getArtifactTasks(): ArtifactTaskSpec[] {
    return GAMESTATE.artifact_tasks;
}

// Clear the per-cycle "fired" flags. Called from doAnyReset.
function resetArtifactTaskCycleState() {
    for (const spec of GAMESTATE.artifact_tasks) {
        spec.done = false;
    }
}

// MARK: Queue Cycling

// A saved automation queue: a full plan (per-zone priorities + the artifact-use
// tasks it schedules) plus whether it's an item cycle and how many consecutive
// energy resets to run it before moving on. Stored in serialization-friendly
// shapes (priorities as entries, no Maps; specs use task_id) so it round-trips
// through the save without special handling.
export type AutoUseMode = "all" | "none" | "exclude";

export interface QueueConfig {
    prios: [number, number[]][]; // automation_prios as [zone, task_id[]] entries
    artifact_tasks: ArtifactTaskSpec[];
    auto_use_mode: AutoUseMode;  // all = auto-use everything, none = nothing, exclude = all but excluded_items
    excluded_items: number[];    // ItemTypes skipped while auto-using in exclude mode
    repeat_count: number;        // consecutive energy resets to run before advancing
    name: string;                // optional player-set label
}

function cloneArtifactSpecs(specs: ArtifactTaskSpec[]): ArtifactTaskSpec[] {
    return specs.map(s => ({ ...s }));
}

function clonePrioEntries(entries: [number, number[]][]): [number, number[]][] {
    return entries.map(([zone, ids]) => [zone, [...ids]]);
}

function activeQueue(): QueueConfig | null {
    return GAMESTATE.queue_configs[GAMESTATE.active_queue_index] ?? null;
}

// Copy the live working plan (priorities + artifact tasks) into the active
// queue. auto_use_items / repeat_count are config, edited only via the UI, so
// they're left alone here.
function saveActiveQueue() {
    const queue = activeQueue();
    if (!queue) {
        return;
    }
    queue.prios = clonePrioEntries(Array.from(GAMESTATE.automation_prios.entries()) as [number, number[]][]);
    queue.artifact_tasks = cloneArtifactSpecs(GAMESTATE.artifact_tasks);
}

// Make the active queue's plan the live working state.
function loadActiveQueue() {
    const queue = activeQueue();
    if (!queue) {
        return;
    }
    GAMESTATE.automation_prios = new Map(clonePrioEntries(queue.prios));
    GAMESTATE.artifact_tasks = cloneArtifactSpecs(queue.artifact_tasks);
    GAMESTATE.auto_use_items = queue.auto_use_mode != "none";
    GAMESTATE.auto_use_excluded_items = queue.auto_use_mode == "exclude" ? [...queue.excluded_items] : [];
}

// Keep the active queue's stored snapshot in sync with live edits (right-click
// priorities, add/remove artifact tasks) so the UI and reloads stay correct.
function syncActiveQueueIfCycling() {
    if (GAMESTATE.mods.queue_cycle) {
        saveActiveQueue();
    }
}

// Seed an initial queue from the current plan the first time cycling is enabled.
function seedQueueConfigsIfEmpty() {
    if (GAMESTATE.queue_configs.length > 0) {
        return;
    }
    GAMESTATE.queue_configs = [{
        prios: clonePrioEntries(Array.from(GAMESTATE.automation_prios.entries()) as [number, number[]][]),
        artifact_tasks: cloneArtifactSpecs(GAMESTATE.artifact_tasks),
        auto_use_mode: GAMESTATE.auto_use_items ? "all" : "none",
        excluded_items: [],
        repeat_count: 1,
        name: "",
    }];
    GAMESTATE.active_queue_index = 0;
    GAMESTATE.queue_runs_on_current = 0;
}

// Advance the queue cycle for the upcoming run: save the finishing run's edits,
// step to the next queue once the current one's repeat_count is met, then make
// the (now-)active queue the live plan. Runs once per energy reset, before the
// per-reset task rebuild so the new queue's artifact tasks get injected.
function applyQueueCycle() {
    if (GAMESTATE.queue_configs.length == 0) {
        return;
    }
    saveActiveQueue();

    GAMESTATE.queue_runs_on_current += 1;
    const current = activeQueue();
    // repeat_count 0 means "skip this queue": with a 0 limit the run counter is
    // always >= it, so we advance immediately (and past any other 0-count queues).
    const repeat = Math.max(0, Math.floor(current?.repeat_count ?? 1));
    if (GAMESTATE.queue_runs_on_current >= repeat) {
        advanceToNextRunnableQueue();
    }

    loadActiveQueue();
}

// Advance active_queue_index to the next queue with repeat_count > 0, skipping
// any set to 0. If every queue is 0 (all skipped), leave the index unchanged so
// the cycle still has something to run rather than looping forever.
function advanceToNextRunnableQueue() {
    const n = GAMESTATE.queue_configs.length;
    GAMESTATE.queue_runs_on_current = 0;
    if (!GAMESTATE.queue_configs.some(q => Math.floor(q.repeat_count) > 0)) {
        return;
    }
    for (let i = 0; i < n; i++) {
        GAMESTATE.active_queue_index = (GAMESTATE.active_queue_index + 1) % n;
        if (Math.floor(activeQueue()?.repeat_count ?? 0) > 0) {
            break;
        }
    }
}

// Restart the cycle at the first queue (called on prestige).
function resetQueueCycleForPrestige() {
    if (!GAMESTATE.mods.queue_cycle || GAMESTATE.queue_configs.length == 0) {
        return;
    }
    saveActiveQueue();
    GAMESTATE.active_queue_index = 0;
    GAMESTATE.queue_runs_on_current = 0;
    // If the first queue is set to skip (0), start at the next runnable one.
    if (Math.floor(activeQueue()?.repeat_count ?? 0) <= 0) {
        advanceToNextRunnableQueue();
    }
    loadActiveQueue();
}

// Per-reset cycle hook: queue cycling and the auto-use cycle are mutually
// exclusive, so at most one runs.
function applyResetCycle() {
    if (GAMESTATE.mods.queue_cycle) {
        applyQueueCycle();
    } else if (GAMESTATE.mods.auto_use_cycle) {
        applyAutoUseCycle();
    }
}

// --- Queue editing API (used by the UI and the window bridge) ---

export function getQueueConfigs(): QueueConfig[] {
    return GAMESTATE.queue_configs;
}

export function getActiveQueueIndex(): number {
    return GAMESTATE.active_queue_index;
}

// Make a queue active so its plan can be viewed/edited. The cycle then
// continues advancing from this queue.
export function setActiveQueue(index: number) {
    if (index < 0 || index >= GAMESTATE.queue_configs.length) {
        return;
    }
    saveActiveQueue();
    GAMESTATE.active_queue_index = index;
    GAMESTATE.queue_runs_on_current = 0;
    loadActiveQueue();
    // Refresh the current zone's artifact tasks to match the now-active queue,
    // keeping live state consistent if this was a live switch (not in edit mode).
    GAMESTATE.tasks = GAMESTATE.tasks.filter(t => !isArtifactTaskId(t.task_definition.id));
    injectArtifactTasksForCurrentZone();
    updateEnabledTasks();
    saveGame();
}

// Immediately advance the cycle to the next queue (wrapping), applying its plan
// now rather than waiting for the next energy reset.
export function advanceQueueCycle() {
    if (GAMESTATE.queue_configs.length == 0) {
        return;
    }
    setActiveQueue((GAMESTATE.active_queue_index + 1) % GAMESTATE.queue_configs.length);
}

// Resets completed on the active queue (for "run k of N" display).
export function getQueueRunsOnCurrent(): number {
    return GAMESTATE.queue_runs_on_current;
}

// Save the current plan as a new queue at the end of the cycle.
export function addQueue(): number {
    GAMESTATE.queue_configs.push({
        prios: clonePrioEntries(Array.from(GAMESTATE.automation_prios.entries()) as [number, number[]][]),
        artifact_tasks: cloneArtifactSpecs(GAMESTATE.artifact_tasks),
        auto_use_mode: GAMESTATE.auto_use_items ? "all" : "none",
        excluded_items: [],
        repeat_count: 1,
        name: "",
    });
    saveGame();
    return GAMESTATE.queue_configs.length - 1;
}

export function removeQueue(index: number) {
    if (index < 0 || index >= GAMESTATE.queue_configs.length) {
        return;
    }
    GAMESTATE.queue_configs.splice(index, 1);
    if (GAMESTATE.active_queue_index >= GAMESTATE.queue_configs.length) {
        GAMESTATE.active_queue_index = 0;
        GAMESTATE.queue_runs_on_current = 0;
    }
    // No queues left: turn cycling off so we don't cycle nothing.
    if (GAMESTATE.queue_configs.length == 0) {
        GAMESTATE.mods.queue_cycle = false;
    } else if (GAMESTATE.mods.queue_cycle && index == GAMESTATE.active_queue_index) {
        loadActiveQueue();
    }
    saveGame();
}

export function setQueueName(index: number, name: string) {
    const queue = GAMESTATE.queue_configs[index];
    if (!queue) {
        return;
    }
    queue.name = name;
    saveGame();
}

// Apply a queue's auto-use config to the live state if it's the running queue.
function syncQueueAutoUseIfActive(index: number) {
    const queue = GAMESTATE.queue_configs[index];
    if (queue && GAMESTATE.mods.queue_cycle && index == GAMESTATE.active_queue_index) {
        GAMESTATE.auto_use_items = queue.auto_use_mode != "none";
        GAMESTATE.auto_use_excluded_items = queue.auto_use_mode == "exclude" ? [...queue.excluded_items] : [];
    }
}

export function setQueueAutoUseMode(index: number, mode: AutoUseMode) {
    const queue = GAMESTATE.queue_configs[index];
    if (!queue) {
        return;
    }
    queue.auto_use_mode = mode;
    syncQueueAutoUseIfActive(index);
    saveGame();
}

export function getQueueExcludedItems(index: number): number[] {
    return GAMESTATE.queue_configs[index]?.excluded_items ?? [];
}

export function addQueueExcludedItem(index: number, item: ItemType) {
    const queue = GAMESTATE.queue_configs[index];
    if (!queue || queue.excluded_items.includes(item)) {
        return;
    }
    queue.excluded_items.push(item);
    syncQueueAutoUseIfActive(index);
    saveGame();
}

export function removeQueueExcludedItem(index: number, item: ItemType) {
    const queue = GAMESTATE.queue_configs[index];
    if (!queue) {
        return;
    }
    queue.excluded_items = queue.excluded_items.filter(i => i != item);
    syncQueueAutoUseIfActive(index);
    saveGame();
}

export function setQueueRepeatCount(index: number, value: number) {
    const queue = GAMESTATE.queue_configs[index];
    if (!queue) {
        return;
    }
    // 0 is allowed and means "skip this queue in the cycle".
    queue.repeat_count = Math.max(0, Math.floor(value));
    saveGame();
}

// Move a queue earlier/later in the cycle order, keeping the active queue selected.
export function moveQueue(index: number, delta: number) {
    const target = index + delta;
    if (index < 0 || index >= GAMESTATE.queue_configs.length
        || target < 0 || target >= GAMESTATE.queue_configs.length) {
        return;
    }
    const active = GAMESTATE.queue_configs[GAMESTATE.active_queue_index];
    const [moved] = GAMESTATE.queue_configs.splice(index, 1);
    GAMESTATE.queue_configs.splice(target, 0, moved as QueueConfig);
    const new_active = GAMESTATE.queue_configs.indexOf(active as QueueConfig);
    if (new_active >= 0) {
        GAMESTATE.active_queue_index = new_active;
    }
    saveGame();
}

// MARK: Priority Edit Mode

// A frozen, zone-navigable view for arranging automation priorities. While on,
// the sim is paused (no task starts) and current_zone is repointed at the zone
// being viewed; the run's real zone and tasks are saved and restored on exit.
let _edit_mode = false;
let _edit_saved_zone = 0;
let _edit_saved_tasks: Task[] = [];

export function isEditMode(): boolean {
    return _edit_mode;
}

export function getEditMaxZone(): number {
    return Math.min(GAMESTATE.highest_zone_ever, ZONES.length - 1);
}

// Enter edit mode. Refused (returns false) while a Task is running.
export function enterEditMode(): boolean {
    if (_edit_mode) {
        return true;
    }
    if (GAMESTATE.active_task != null) {
        return false;
    }
    _edit_mode = true;
    _edit_saved_zone = GAMESTATE.current_zone;
    _edit_saved_tasks = GAMESTATE.tasks;
    return true;
}

export function exitEditMode() {
    if (!_edit_mode) {
        return;
    }
    _edit_mode = false;
    GAMESTATE.current_zone = _edit_saved_zone;
    // Restore the run's real tasks (reps intact), refreshing artifact tasks in
    // case the active queue changed while editing.
    GAMESTATE.tasks = _edit_saved_tasks.filter(t => !isArtifactTaskId(t.task_definition.id));
    _edit_saved_tasks = [];
    injectArtifactTasksForCurrentZone();
    updateEnabledTasks();
    saveGame();
}

// View a different zone's tasks for editing, clamped to zones reached.
export function setEditZone(zone: number) {
    if (!_edit_mode) {
        return;
    }
    GAMESTATE.current_zone = Math.max(0, Math.min(zone, getEditMaxZone()));
    initializeTasks();
}

function autoUseItems() {
    if (!GAMESTATE.auto_use_items) {
        return;
    }

    for (const [key, value] of GAMESTATE.items) {
        if (ARTIFACTS.includes(key)) {
            continue;
        }
        if (GAMESTATE.auto_use_excluded_items.includes(key)) {
            continue; // saved for a later (non-excluding) queue
        }

        if (value > 0) {
            useItem(key, value);
            disableItemUndo(); // It'd just cause weird flashing
        }
    }
}

function disableItemUndo() {
    GAMESTATE.undo_item = [ItemType.Count, 0];
}

export function undoItemUse() {
    const [item_type, amount] = GAMESTATE.undo_item;
    if (item_type == ItemType.Count) {
        console.error("Trying to undo non-existing item");
        return;
    }

    disableItemUndo();
    useItem(item_type, -amount);
}

type ItemAmount = [item: ItemType, amount: number];
export function gatherItemBonuses(skill: SkillType): ItemAmount[] {
    const ret: ItemAmount[] = [];

    for (const [item_type, amount] of GAMESTATE.used_items) {
        const item = ITEMS[item_type] as ItemDefinition;
        if (!item.skill_modifiers.affectsSkill(skill)) {
            continue;
        }

        ret.push([item_type, amount]);
    }

    return ret;
}

function updatePrepRunHint() {
    if (!hasPerk(PerkType.UnderstandingTheReset)) {
        return;
    }

    if (GAMESTATE.used_items.size == 0) {
        GAMESTATE.hint_prep_runs_done++;
    } else {
        GAMESTATE.hint_non_prep_runs_done++;
    }
}

export function setHasGottenPrepRunHint() {
    GAMESTATE.hint_has_gotten_prep_run_hint = true;
}

export function setHasGottenBossHint() {
    GAMESTATE.hint_has_gotten_boss_hint = true;
}

export function knowsItem(item: ItemType) {
    return GAMESTATE.items.get(item) != null;
}

// MARK: Perks
function tryAddPerk(perk: PerkType, show_notification = true) {
    if (hasPerk(perk)) {
        return;
    }

    if (perk == PerkType.EnergySpell) {
        modifyMaxEnergy(50);
    }

    GAMESTATE.perks.set(perk, true);

    if (show_notification) {
        const context: GainedPerkContext = { perk: perk };
        const event = new RenderEvent(EventType.GainedPerk, context);
        GAMESTATE.queueRenderEvent(event);
    }
}

export function hasPerk(perk: PerkType): boolean {
    return GAMESTATE.perks.get(perk) == true;
}

export function knowsPerk(perk: PerkType): boolean {
    return GAMESTATE.perks.get(perk) != null;
}

function skipCurrentZoneIfFree() : boolean {
    if (!GAMESTATE.tasks.every(task => {
        // Unlocking stuff the player needs to deal with themselves. An
        // UNCOSTED task (Pass-B allowlist) also blocks the skip: its cost is
        // provisional, and free completion would bypass the first-start hook.
        return !taskUnlocksTask(task) && isSingleTickTask(task) && !isTaskUncosted(task)
    })) {
        return false;
    }

    const zone_before = GAMESTATE.current_zone;

    // In reverse so travel happens last
    for (const task of GAMESTATE.tasks.slice().reverse()) {
        doAllTaskRepsForFree(task);
    }

    // "Skipped" means we actually left the zone. Standalone, the Travel task's
    // onFullyFinishTask calls advanceZone() and swaps GAMESTATE.tasks, so this
    // is true whenever the zone was free. In MANAGED mode the host owns zone
    // transitions and advanceZone() is deliberately not called, so the task
    // array never changes — returning true unconditionally made skipFreeZones'
    // `while` loop re-skip the same finished zone forever, hanging the game
    // inside doEnergyReset. The zone's tasks are still completed for free above
    // (items awarded, perks granted, host callbacks fired); we just stop here
    // and let the host move the player.
    return GAMESTATE.current_zone !== zone_before;
}

function skipFreeZones() {
    if (!hasPerk(PerkType.MinorTimeCompression)) {
        return;
    }

    GAMESTATE.is_in_zone_skip = true;

    while (skipCurrentZoneIfFree()) { /* Effect is in conditional */ }

    if (GAMESTATE.current_zone > 0) {
        autoUseItems(); // Do this first so our zone skip notification is at the top
        const event = new RenderEvent(EventType.SkippedZones, {});
        GAMESTATE.queueRenderEvent(event);
    }

    GAMESTATE.is_in_zone_skip = false;
    doMasteryOfTimeTaskCompletion();
}

export function gatherPerkBonuses(skill: SkillType): PerkType[] {
    const ret: PerkType[] = [];

    for (const [perk_type, active] of GAMESTATE.perks) {
        const perk = PERKS[perk_type] as PerkDefinition;
        if (!active || !perk.skill_modifiers.affectsSkill(skill)) {
            continue;
        }

        ret.push(perk_type);
    }

    return ret;
}

// MARK: Extra stats

function addPower(amount: number) {
    if (amount <= 0) {
        return;
    }

    if (!GAMESTATE.has_unlocked_power) {
        const event = new RenderEvent(EventType.UnlockedPower, new EventContext());
        GAMESTATE.queueRenderEvent(event);
        GAMESTATE.has_unlocked_power = true;
    }
    GAMESTATE.power += amount;
}

export function calcPowerGain(task: Task) {
    if (task.task_definition.type != TaskType.Boss) {
        return 0;
    }

    const mult = Math.max(task.task_definition.zone_id - 1, 1); // First boss is zone 3, which is internally 2
    let powerAmount = 5 * mult;
    powerAmount *= Math.pow(2, getPrestigeRepeatableLevel(PrestigeRepeatableType.UnlimitedPower));

    if (hasPrestigeUnlock(PrestigeUnlockType.LimitlessPower))
    {
        powerAmount *= FINAL_PRESTIGE_MULT;
    }

    return powerAmount;
}

export function calcPowerSpeedBonusAtLevel(level: number): number {
    return 1 + level / 100;
}

export function calcAttunementSpeedBonusAtLevel(level: number): number {
    return 1 + level / 1000;
}

export function calcSpiteTheGodsBonus(): number {
    return 1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.SpiteTheGods) * SPITE_THE_GODS_MULT;
}

function addAttunement(amount: number) {
    GAMESTATE.attunement += amount;
}

export function calcAttunementGain(task: Task): number {
    if (!hasPerk(PerkType.Attunement)) {
        return 0;
    }

    const attunement_skills = calcAttunementSkills();
    if (!attunement_skills.some(skill => task.task_definition.skills.includes(skill))) {
        return 0;
    }

    let value = task.task_definition.zone_id + 1;
    if (hasPrestigeUnlock(PrestigeUnlockType.DivineInspiration)) {
        value *= 2;
    }

    if (hasPrestigeUnlock(PrestigeUnlockType.FullyAttuned)) {
        value *= 1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.DivineKnowledge) * DIVINE_KNOWLEDGE_MULT;
    }

    if (hasPerk(PerkType.CommunedWithDamnedSouls)) {
        value *= 2;
    }

    if (hasPrestigeUnlock(PrestigeUnlockType.LimitlessPower))
    {
        value *= FINAL_PRESTIGE_MULT;
    }

    value *= Math.pow(DIVINE_ATTUNEMENT_BASE, getPrestigeRepeatableLevel(PrestigeRepeatableType.DivineAttunement));

    return value;
}

export function calcAttunementSkills() {
    const attunement_skills = [...SKILL_ROLES.attunement_skills];
    if (hasPrestigeUnlock(PrestigeUnlockType.FullyAttuned)) {
        attunement_skills.push(SkillType.Search);
    }

    if (hasPrestigeUnlock(PrestigeUnlockType.CraftingBreakthrough)) {
        attunement_skills.push(SkillType.Crafting);
    }

    return attunement_skills;
}

export function getPowerSkills() {
    return [...SKILL_ROLES.power_skills];
}

export function getSpiteTheGodsSkills() {
    return [...SKILL_ROLES.spite_skills];
}

// MARK: Run Task History / Auto Magic Ring (Game Mod)

// One entry per real task started this run. extra_levels_if_ringed is the
// extra (fractional) skill levels a Magic Ring (MAGIC_RING_MULT x XP for one
// rep) would have earned over an unboosted rep, measured from the skill state
// at rep start — the only moment that state is observable. Field is task_id,
// not "id", so the save replacer doesn't collapse the record.
export interface RunTaskRecord {
    zone_id: number;
    task_id: number;
    extra_levels_if_ringed: number;
    completed: boolean;
}

function runTaskKey(zone_id: number, task_id: number): string {
    return `${zone_id}:${task_id}`;
}

function recordRunTaskHistory(task: Task) {
    const def = task.task_definition;
    if (def.skills.length == 0) {
        return; // no skills, no levels — nothing a Ring could boost
    }

    const xp = calcSkillXp(task, calcTaskCost(task), true);
    let extra = 0;
    for (const skill_type of def.skills) {
        extra += calcFractionalLevelsFromXp(skill_type, xp * MAGIC_RING_MULT)
            - calcFractionalLevelsFromXp(skill_type, xp);
    }

    let record = GAMESTATE.run_task_history.find((r) => r.zone_id == def.zone_id && r.task_id == def.id);
    if (!record) {
        record = { zone_id: def.zone_id, task_id: def.id, extra_levels_if_ringed: 0, completed: false };
        GAMESTATE.run_task_history.push(record);
    }
    // A task can rep several times a run; keep its best Ring opportunity.
    record.extra_levels_if_ringed = Math.max(record.extra_levels_if_ringed, extra);
}

// ── Performed-actions log ────────────────────────────────────────────────
// An ORDERED record of what actually ran during a run — every task rep and
// item use, in sequence — snapshotted at each reset so tooling can read back
// "what did the last run do" (and reconstruct it as an action script). This is
// distinct from run_task_history above, which is a deduped, unordered,
// skill-only set kept for Magic Ring planning. Module-level + session-transient
// on purpose: it is observational (never feeds the simulation) and stays out of
// the save blob, so it is byte-inert to both the tick loop and saved games.

export interface PerformedAction {
    type: "task" | "item";
    name: string;
    // task fields
    zone_id?: number;
    task_id?: number;
    reps?: number;
    // item fields
    item?: ItemType;
    count?: number;
}

let _current_run_actions: PerformedAction[] = [];
let _previous_run_actions: PerformedAction[] = [];

// Record one completed rep of a task. Consecutive reps of the same task
// coalesce into a single entry (a run rarely interleaves tasks rep-by-rep),
// yielding a compact ordered script. Synthetic tasks (host-injected exit tasks,
// artifact tasks) are skipped — they are substrate/UI machinery, not player
// actions to replay.
function recordPerformedTaskRep(task: Task) {
    if (isSyntheticTask(task)) return;
    const def = task.task_definition;
    const last = _current_run_actions[_current_run_actions.length - 1];
    if (last && last.type === "task" && last.task_id === def.id && last.zone_id === def.zone_id) {
        last.reps = (last.reps ?? 0) + 1;
    } else {
        _current_run_actions.push({
            type: "task", name: def.name, zone_id: def.zone_id, task_id: def.id, reps: 1,
        });
    }
}

// Record an item use (positive amounts only — negatives are undos).
function recordPerformedItem(item: ItemType, count: number) {
    if (count <= 0) return;
    const name = (ITEMS[item] as ItemDefinition | undefined)?.name ?? String(item);
    _current_run_actions.push({ type: "item", name, item, count });
}

// End of a run (energy reset or prestige, both via doAnyReset): the actions
// just performed become "the previous run".
function snapshotRunActions() {
    _previous_run_actions = _current_run_actions;
    _current_run_actions = [];
}

// Under queue cycling or the auto-use cycle, consecutive runs execute
// different plans (per-queue priorities) or run at different speeds (banking
// vs spending items), so "the previous run" can be a bad predictor of the
// upcoming one. History is therefore kept per run CONTEXT, and each run's
// Ring plan is built from the most recent completed run of the SAME context.
// Contexts: the active queue index (queue cycling), the auto-use on/off
// phase (auto-use cycle), or a single shared bucket otherwise. Stale buckets
// (removed queues, disabled mods) linger harmlessly until prestige wipes
// them; a queue reorder just means one cycle of re-learning.
function currentRingContext(): string {
    if (GAMESTATE.mods.queue_cycle) {
        return `queue:${GAMESTATE.active_queue_index}`;
    }
    if (GAMESTATE.mods.auto_use_cycle) {
        return `cycle:${GAMESTATE.auto_use_items ? "on" : "off"}`;
    }
    return "default";
}

// Extra levels a Ring would earn on this task, from the CURRENT skill state.
// The history run that discovered the task can be a full cycle old (several
// resets under queue cycling), so the extras recorded back then are stale;
// only the reachability information (which tasks a comparable run actually
// completes) is taken from history — the ranking is recomputed fresh.
function calcRingExtraLevels(record: RunTaskRecord): number {
    const def = TASK_LOOKUP.get(record.task_id);
    if (!def || def.skills.length == 0) {
        return record.extra_levels_if_ringed; // dangling id: recorded value
    }
    const probe = new Task(def);
    const xp = calcSkillXp(probe, calcTaskCost(probe), true);
    let extra = 0;
    for (const skill_type of def.skills) {
        extra += calcFractionalLevelsFromXp(skill_type, xp * MAGIC_RING_MULT)
            - calcFractionalLevelsFromXp(skill_type, xp);
    }
    return extra;
}

// Called once per energy reset: the same-context history run's completed
// tasks, ranked by Ring value. Deliberately not truncated to the Rings held
// at reset — without the keep-items prestige unlock every Ring is culled at
// the reset, so Rings are typically found and spent within the same run;
// maybeAutoUseRing instead applies a dynamic top-K window (K = held +
// already spent) at spend time. The plan persists in the save so a mid-run
// reload neither re-plans nor re-spends.
function buildRingPlan() {
    GAMESTATE.ring_plan_used = [];
    const history = GAMESTATE.run_history_by_context[currentRingContext()] ?? [];
    GAMESTATE.ring_plan = history
        .map((r) => ({ key: runTaskKey(r.zone_id, r.task_id), extra: calcRingExtraLevels(r) }))
        .sort((a, b) => b.extra - a.extra)
        .map((entry) => entry.key);
}

// MARK: Energy Thresholds (Game Mod)

// Category of a task for the energy threshold filter. First match wins, and
// the perk/unlocker categories track live state: a task counts as a perk
// task only while its perk is unearned this prestige, and as an unlocker
// only while its unlock target is still locked — afterwards it falls
// through. Combat (Boss) tasks are their own category and are deliberately
// NOT item tasks even though every Boss drops one (user ruling); an
// uncompleted Boss (pending unlock) still counts as an unlocker. Prestige
// tasks are their own category too; progression is Travel + Mandatory.
// Precedence: perk (affordable/not) > unlocker > combat > item > prestige >
// progression > other.
export type ThresholdCategory =
    | "perk_affordable"
    | "perk_unaffordable"
    | "unlocker"
    | "combat"
    | "item"
    | "prestige"
    | "progression"
    | "other";

// Per-category judgment metric for the threshold filter.
export const THRESHOLD_METRIC_LEVEL = 0;  // % of max energy per skill level earned ("worth it as XP?")
export const THRESHOLD_METRIC_REP = 1;    // % of max energy per rep ("can I afford it?")
export const THRESHOLD_METRIC_RESETS = 2; // energy resets until fully completable ("reachable soon?")

const THRESHOLD_MOD_KEYS: Record<ThresholdCategory, { enabled: keyof GameMods; pct: keyof GameMods; metric: keyof GameMods; resets: keyof GameMods }> = {
    perk_affordable: { enabled: "threshold_perk_affordable_enabled", pct: "threshold_perk_affordable_pct", metric: "threshold_perk_affordable_metric", resets: "threshold_perk_affordable_resets" },
    perk_unaffordable: { enabled: "threshold_perk_unaffordable_enabled", pct: "threshold_perk_unaffordable_pct", metric: "threshold_perk_unaffordable_metric", resets: "threshold_perk_unaffordable_resets" },
    unlocker: { enabled: "threshold_unlocker_enabled", pct: "threshold_unlocker_pct", metric: "threshold_unlocker_metric", resets: "threshold_unlocker_resets" },
    combat: { enabled: "threshold_combat_enabled", pct: "threshold_combat_pct", metric: "threshold_combat_metric", resets: "threshold_combat_resets" },
    item: { enabled: "threshold_item_enabled", pct: "threshold_item_pct", metric: "threshold_item_metric", resets: "threshold_item_resets" },
    prestige: { enabled: "threshold_prestige_enabled", pct: "threshold_prestige_pct", metric: "threshold_prestige_metric", resets: "threshold_prestige_resets" },
    progression: { enabled: "threshold_progression_enabled", pct: "threshold_progression_pct", metric: "threshold_progression_metric", resets: "threshold_progression_resets" },
    other: { enabled: "threshold_other_enabled", pct: "threshold_other_pct", metric: "threshold_other_metric", resets: "threshold_other_resets" },
};

const THRESHOLD_CATEGORY_LIST: ThresholdCategory[] = ["perk_affordable", "perk_unaffordable", "unlocker", "combat", "item", "prestige", "progression", "other"];

// A task whose `perk` field was suppressed for AP-authoritative grants, but
// which both categorizers must still treat as granting an unearned perk (see
// _perk_category_task_ids). Always false when the host never set the list.
function isForcedPerkCategoryTask(def: TaskDefinition): boolean {
    return _perk_category_task_ids !== null && _perk_category_task_ids.has(def.id);
}

export function getThresholdCategory(task: Task): ThresholdCategory {
    const def = task.task_definition;
    if (isForcedPerkCategoryTask(def) || (def.perk != PerkType.Count && !hasPerk(def.perk))) {
        return isPerkTaskAffordableThisCycle(task) ? "perk_affordable" : "perk_unaffordable";
    }
    // Checked before combat/item: while the unlock target is still locked
    // (unlocks persist across energy resets, wiped on prestige) any task —
    // in the game data, always an uncompleted Boss — judges as an unlocker.
    if (def.unlocks_task >= 0 && !GAMESTATE.unlocked_tasks.includes(def.unlocks_task)) {
        return "unlocker";
    }
    // Combat before item (user ruling): every Boss drops an item, but repeat
    // kills are their own kind of decision, not generic item farming.
    if (def.type == TaskType.Boss) {
        return "combat";
    }
    if (def.item != ItemType.Count) {
        return "item";
    }
    if (def.type == TaskType.Prestige) {
        return "prestige";
    }
    if (def.type == TaskType.Travel || def.type == TaskType.Mandatory) {
        return "progression";
    }
    return "other";
}

// Whether finishing ALL remaining reps — which is what actually awards the
// perk — fits in the current energy, counting the best speed-up the held and
// queued Artifacts could provide: up to that many reps costed hasted, and for
// Bosses with Bottled Lightning on top. Mirrors getBossEnergyDisparityLimit's
// optimism (what your Artifacts *could* do, not what happens to be queued).
function isPerkTaskAffordableThisCycle(task: Task): boolean {
    const remaining = task.task_definition.max_reps - task.reps;
    if (remaining <= 0) {
        return true;
    }

    const scrolls = (GAMESTATE.items.get(ItemType.ScrollOfHaste) ?? 0) + GAMESTATE.queued_scrolls_of_haste;
    const lightning = task.task_definition.type == TaskType.Boss
        ? (GAMESTATE.items.get(ItemType.BottledLightning) ?? 0) + GAMESTATE.queued_lightning
        : 0;

    // Per-rep cost only depends on which boosts apply, so the total is a
    // split into (both, haste-only, lightning-only, plain) rep counts rather
    // than a per-rep loop. Boosts pair up first — they stack.
    const both = Math.min(remaining, scrolls, lightning);
    const haste_only = Math.min(remaining - both, scrolls - both);
    const lightning_only = Math.min(remaining - both - haste_only, lightning - both);
    const plain = remaining - both - haste_only - lightning_only;

    let total = 0;
    if (both > 0) {
        total += both * calcTaskEnergyCost(task, true, true);
    }
    if (haste_only > 0) {
        total += haste_only * calcTaskEnergyCost(task, true, false);
    }
    if (lightning_only > 0) {
        total += lightning_only * calcTaskEnergyCost(task, false, true);
    }
    if (plain > 0) {
        total += plain * calcTaskEnergyCost(task, false, false);
    }

    return total <= GAMESTATE.current_energy;
}

// Game Mod — energy thresholds. A prioritized task is skipped when it fails
// its category's judgment, one of three per-category metrics: energy per
// skill level earned vs a % of max energy, the rep's absolute energy vs that
// %, or the estimated energy resets until fully completable vs a max-resets
// count (the default for every category). Each category has its own values,
// metric switch, and enable toggle; a disabled category is EXEMPT (its tasks
// always run). Synthetic and skill-less tasks are always exempt.
export function isThresholdSkipped(task: Task): boolean {
    if (!GAMESTATE.mods.threshold_master) {
        return false;
    }
    if (isSyntheticTask(task) || task.task_definition.skills.length == 0) {
        return false;
    }

    const category = getThresholdCategory(task);
    const keys = THRESHOLD_MOD_KEYS[category];
    if (!GAMESTATE.mods[keys.enabled]) {
        return false;
    }

    const metric = GAMESTATE.mods[keys.metric] as number;

    // Resets mode: skip unless the task could be fully completed within the
    // configured number of energy resets, per the grind estimate below.
    if (metric == THRESHOLD_METRIC_RESETS) {
        const max_resets = Math.max(0, Math.floor(GAMESTATE.mods[keys.resets] as number));
        return estimateResetsToComplete(task, max_resets) > max_resets;
    }

    const threshold_pct = GAMESTATE.mods[keys.pct] as number;
    const budget = (threshold_pct / 100) * GAMESTATE.max_energy;
    // Judge the task the way the player would actually attempt it: with a
    // Scroll of Haste if one is held (user ruling — Touch the Divine was
    // skipped even though a manual start plus a Scroll succeeds).
    const cost = calcTaskEnergyCost(task, thresholdScrollsAvailable() > 0, false);

    // Rep mode: judge the rep's total energy cost. The default for
    // progression (Travel/Mandatory/Prestige), whose value is progression,
    // not XP — a per-level metric inevitably explodes once the task's skill
    // outgrows early-zone XP (a farmed-up Charisma made zone 1's Travel task
    // look infinitely expensive per level and stranded the run).
    if (metric == THRESHOLD_METRIC_REP) {
        return cost > budget;
    }

    const expected_levels = calcExpectedLevels(task);
    if (expected_levels <= 0) {
        return true;
    }

    return cost / expected_levels > budget;
}

// Scrolls of Haste available to the threshold estimates. The player ruled
// that every threshold metric should account for them: a task you'd
// realistically start by spending a Scroll shouldn't be judged on its
// unhasted cost. One Scroll covers one rep. Held Scrolls only count while
// item auto-use is enabled (user ruling) — on banking cycles automation
// won't spend them (maybeAutoUseHaste has the same gate), so assuming haste
// there would promise assistance that never arrives. An already-queued
// Scroll counts regardless: it's committed and applies to the next rep.
function thresholdScrollsAvailable(): number {
    const held = GAMESTATE.auto_use_items ? (GAMESTATE.items.get(ItemType.ScrollOfHaste) ?? 0) : 0;
    return held + GAMESTATE.queued_scrolls_of_haste;
}

// Estimate how many energy resets it would take until this task could be
// fully completed (all remaining reps in one go), assuming conditions like
// right now repeat each reset: the same energy budget (current remaining
// energy — evaluated at skip-decision time, per design), the same non-level
// speed boosts (items/perks/power as currently active), and every simulated
// run grinding its whole budget into this one task. Only skill XP persists
// across resets (progress and reps do not), which is exactly what the grind
// accumulates. Returns 0 if completable right now, otherwise the number of
// resets needed, or max_resets + 1 if not reachable within max_resets —
// which caps the iteration count, so the estimate is O(max_resets).
export function estimateResetsToComplete(task: Task, max_resets: number): number {
    const def = task.task_definition;
    if (def.skills.length == 0) {
        return 0; // no skills to grow; either affordable now or never — treat as now
    }

    const cost = calcTaskCost(task);
    const budget = GAMESTATE.current_energy;
    // Currently-held Scrolls count toward completability, one hasted rep per
    // Scroll (user ruling; same optimism as isPerkTaskAffordableThisCycle).
    // Held constant across simulated runs like the other conditions.
    const scrolls = thresholdScrollsAvailable();

    // Split the live progress multiplier into its level part (uniform
    // 1.01^level, geometric-meaned across skills = 1.01^(mean level)) and
    // everything else, held constant during the simulation.
    const mean_level = def.skills.reduce((sum, s) => sum + getSkill(s).level, 0) / def.skills.length;
    const base_mult = calcTaskProgressMultiplier(task) / Math.pow(1.01, mean_level);

    const sim = def.skills.map((s) => ({ type: s, level: getSkill(s).level, progress: getSkill(s).progress }));

    for (let resets = 0; resets <= max_resets; resets++) {
        const sim_mean = sim.reduce((sum, x) => sum + x.level, 0) / sim.length;
        const progress_per_tick = base_mult * Math.pow(1.01, sim_mean);
        const drain = calcEnergyDrainPerTick(task, isSingleTickTaskImpl(progress_per_tick, cost));
        // Reps done this run survive until the reset wipes them, so run 0
        // only needs the remaining reps; later runs start from zero.
        const reps = resets == 0 ? Math.max(1, def.max_reps - task.reps) : def.max_reps;

        // Completability: up to `scrolls` reps costed hasted, the rest plain.
        // The final tick may overdraft below zero (energy only has to be > 0
        // when it starts), so one final-tick drain is deducted.
        const hasted_reps = Math.min(reps, scrolls);
        const plain_reps = reps - hasted_reps;
        const hasted_progress = progress_per_tick * HASTE_MULT;
        const hasted_drain = calcEnergyDrainPerTick(task, isSingleTickTaskImpl(hasted_progress, cost));
        const total_energy = hasted_reps * calcTaskTicks(hasted_progress, cost) * hasted_drain
            + plain_reps * calcTaskTicks(progress_per_tick, cost) * drain;
        const final_drain = plain_reps > 0 ? drain : hasted_drain;
        if (total_energy - final_drain < budget) {
            return resets;
        }

        // Grind this run's whole budget into the task; XP is linear in the
        // progress achieved. Held Scrolls apply here too (user ruling: a
        // Scroll available this reset is assumed available in future resets),
        // so up to `scrolls` reps grind hasted — five times the progress per
        // energy — before the remainder grinds plain. Level-ups during the
        // run would speed it up further, so this is a (slightly)
        // conservative estimate. Ceil, not floor: the last tick of a run
        // overdrafts (see above).
        let remaining_budget = budget;
        let progress = 0;
        let reps_left = reps;
        for (let s = 0; s < hasted_reps && reps_left > 0 && remaining_budget > 0; s++) {
            const rep_ticks = Math.min(calcTaskTicks(hasted_progress, cost), Math.ceil(remaining_budget / hasted_drain));
            progress += Math.min(rep_ticks * hasted_progress, cost);
            remaining_budget -= rep_ticks * hasted_drain;
            reps_left -= 1;
        }
        if (remaining_budget > 0 && reps_left > 0) {
            const ticks = Math.ceil(remaining_budget / drain);
            progress += Math.min(ticks * progress_per_tick, cost * reps_left);
        }
        const xp = calcSkillXp(task, progress, true);
        if (xp <= 0) {
            break; // can't even tick once — no growth is coming, ever
        }
        for (const s of sim) {
            s.progress += xp;
            let needed = calcSkillXpNeededAtLevel(s.level, s.type);
            while (s.progress >= needed) {
                s.progress -= needed;
                s.level += 1;
                needed = calcSkillXpNeededAtLevel(s.level, s.type);
            }
        }
    }

    return max_resets + 1;
}

// What automation does when every runnable task was threshold-skipped.
// Something must happen — no running task means no energy drain, so the run
// would otherwise never end.
export const THRESHOLD_ALL_SKIPPED_IDLE = 0;     // stop and notify, like pause-on-block
export const THRESHOLD_ALL_SKIPPED_END_RUN = 1;  // trigger the energy reset
export const THRESHOLD_ALL_SKIPPED_BEST_TASK = 2; // run the best-level-yield skipped task anyway

// Estimated total (fractional) skill levels from pouring `budget` energy into
// this task, capped at finishing its remaining reps. XP accrues per tick and
// is linear in progress, so even a rep that can't finish converts energy into
// levels — which is what makes "run the best task anyway" meaningful.
export function estimateLevelsFromGrinding(task: Task, budget: number): number {
    const def = task.task_definition;
    if (def.skills.length == 0) {
        return 0;
    }
    const cost = calcTaskCost(task);
    const progress_per_tick = calcTaskProgressMultiplier(task);
    const drain = calcEnergyDrainPerTick(task, isSingleTickTaskImpl(progress_per_tick, cost));
    const max_progress = cost * Math.max(1, def.max_reps - task.reps);
    // Ticks keep coming while energy is > 0 and the final tick may overdraft
    // below zero (checkEnergyReset fires at <= 0, after the drain), so any
    // positive budget funds ceil(budget / drain) ticks — never zero. Flooring
    // here stalled runs at 0.x energy: every candidate's yield reported 0, so
    // the Best Task fallback found nothing and nothing drained the remnant.
    const ticks = drain > 0 ? Math.ceil(budget / drain) : Infinity;
    const progress = Math.min(ticks * progress_per_tick, max_progress);
    const xp = calcSkillXp(task, progress, true);
    let levels = 0;
    for (const skill_type of def.skills) {
        levels += calcFractionalLevelsFromXp(skill_type, xp);
    }
    return levels;
}

let threshold_stall_notified = false;

// Returns the fallback task to run (Best Task mode), or null if automation
// should stay idle this tick (Idle mode, End Run mode, or no viable pick).
function handleThresholdStall(skipped: Task[]): Task | null {
    const action = GAMESTATE.mods.threshold_all_skipped;

    if (action == THRESHOLD_ALL_SKIPPED_END_RUN) {
        // Leftover energy was by definition only spendable at rejected rates.
        GAMESTATE.is_in_energy_reset = true;
        populateEnergyResetInfo();
        return null;
    }

    if (action == THRESHOLD_ALL_SKIPPED_BEST_TASK) {
        // Convert the remaining energy into the most skill levels available.
        // Recomputed at every pick (it's cheap and the numbers shift as
        // energy drains); once some task passes its threshold again, the
        // normal walk resumes ahead of this fallback.
        let best: Task | null = null;
        let best_levels = 0;
        for (const task of skipped) {
            const levels = estimateLevelsFromGrinding(task, GAMESTATE.current_energy);
            if (levels > best_levels) {
                best = task;
                best_levels = levels;
            }
        }
        if (best) {
            threshold_stall_notified = false;
            return best;
        }
        // No candidate can convert energy into levels. Shouldn't happen now
        // that the overdraft tick is modeled (any positive budget funds at
        // least one tick), but if it does: the player chose "never idle", so
        // end the run rather than stall.
        GAMESTATE.is_in_energy_reset = true;
        populateEnergyResetInfo();
        return null;
    }

    if (!threshold_stall_notified) {
        threshold_stall_notified = true;
        GAMESTATE.queueRenderEvent(new RenderEvent(EventType.ThresholdStall, {}));
    }
    return null;
}

// MARK: Automation

export enum AutomationMode {
    All,
    Zone,
    Off,
}

function hasAutomatedTask(task: TaskDefinition) {
    if (!GAMESTATE.automation_prios.has(task.zone_id)) {
        return false;
    }

    const prios = GAMESTATE.automation_prios.get(task.zone_id) as number[];
    return prios.includes(task.id);
}

export function toggleAutomation(task: TaskDefinition) {
    if (!hasPerk(PerkType.Amulet) && !hasAutomatedTask(task)) {
        return;
    }

    if (!GAMESTATE.automation_prios.has(task.zone_id)) {
        GAMESTATE.automation_prios.set(task.zone_id, []);
    }

    const prios = GAMESTATE.automation_prios.get(task.zone_id) as number[];
    if (prios.includes(task.id)) {
        prios.splice(prios.indexOf(task.id), 1);
    }
    else {
        prios.push(task.id);
        // Ensure travel always happens last. Ids without a TASK_LOOKUP entry
        // (synthetic/injected tasks — host exit tasks, and the upcoming
        // artifact tasks) aren't Travel, so treat a missing lookup as non-Travel
        // instead of dereferencing undefined.
        prios.sort((a, b) => {
            const a_travel = TASK_LOOKUP.get(a)?.type == TaskType.Travel;
            const b_travel = TASK_LOOKUP.get(b)?.type == TaskType.Travel;
            if (a_travel || b_travel) {
                return a_travel ? 1 : -1;
            }
            return 0;
        });
    }

    syncActiveQueueIfCycling();
}

// MARK: Auto-Fill Priorities (Game Mod)

// Ordering categories for autoFillPriorities. The GROUP ORDER is player-
// configurable (auto_fill_order; default below): resources first; then
// unearned perks — the frontier value; the threshold filter handles skipping
// ones that aren't currently worth it (user ruling); then Prestige tasks —
// one-shot, cheap for their zone, and completing them early gives prestige
// availability (plus discovery spark every run with that mod), while the
// collected items boost the attempt; then opening the task graph, then pure
// XP by yield. Earned perks demote to the plain group, BELOW prestige (user
// ruling). Mandatory and Travel close the default list — the same
// travel-last invariant toggleAutomation maintains.
export const AUTO_FILL_CATEGORIES = ["item", "combat", "perk", "prestige", "unlocker", "plain", "mandatory", "travel"] as const;
export type AutoFillCategory = (typeof AUTO_FILL_CATEGORIES)[number];

export function defaultAutoFillOrder(): AutoFillCategory[] {
    return [...AUTO_FILL_CATEGORIES];
}

// The saved order, sanitized against the canonical set: known keys keep
// their saved order (first occurrence wins), unknown keys drop, and missing
// keys are inserted right after their nearest preceding default-order
// neighbor that IS present — so a category added in a later version lands at
// its intended default position in an old save's list (e.g. combat directly
// after item), not at the end.
export function getAutoFillOrder(): AutoFillCategory[] {
    const saved = Array.isArray(GAMESTATE.auto_fill_order) ? GAMESTATE.auto_fill_order : [];
    const order: AutoFillCategory[] = [];
    for (const key of saved) {
        if ((AUTO_FILL_CATEGORIES as readonly string[]).includes(key) && !order.includes(key as AutoFillCategory)) {
            order.push(key as AutoFillCategory);
        }
    }
    for (let i = 0; i < AUTO_FILL_CATEGORIES.length; i++) {
        const key = AUTO_FILL_CATEGORIES[i] as AutoFillCategory;
        if (order.includes(key)) {
            continue;
        }
        let insert_at = 0;
        for (let j = i - 1; j >= 0; j--) {
            const prev_index = order.indexOf(AUTO_FILL_CATEGORIES[j] as AutoFillCategory);
            if (prev_index >= 0) {
                insert_at = prev_index + 1;
                break;
            }
        }
        order.splice(insert_at, 0, key);
    }
    return order;
}

export function moveAutoFillCategory(category: AutoFillCategory, delta: number) {
    const order = getAutoFillOrder();
    const from = order.indexOf(category);
    const to = from + (delta < 0 ? -1 : 1);
    if (from < 0 || to < 0 || to >= order.length) {
        return;
    }
    order.splice(from, 1);
    order.splice(to, 0, category);
    GAMESTATE.auto_fill_order = order;
    afterAutoFillOrderChange();
}

export function resetAutoFillOrder() {
    GAMESTATE.auto_fill_order = defaultAutoFillOrder();
    afterAutoFillOrderChange();
}

// A changed order takes effect immediately under the autopilot (no-op
// otherwise — the next Auto-Fill click uses it).
function afterAutoFillOrderChange() {
    maybeAutoPrioritizeAll();
    saveGame();
}

// Which ordering category a task falls into. Classification precedence is
// fixed (only the group ORDER is configurable): perk/unlocker track live
// state like getThresholdCategory — once the perk is earned or the target
// unlocked, the task sorts as a plain XP task instead of keeping its spent
// purpose slot.
function autoFillCategory(def: TaskDefinition): AutoFillCategory {
    if (def.type == TaskType.Travel) {
        return "travel";
    }
    if (def.type == TaskType.Mandatory) {
        return "mandatory";
    }
    // Bosses are never item tasks (user ruling), even though every Boss
    // drops one: while its unlock is pending it sorts as an unlocker,
    // afterwards as combat.
    if (def.type == TaskType.Boss) {
        return def.unlocks_task >= 0 && !GAMESTATE.unlocked_tasks.includes(def.unlocks_task)
            ? "unlocker" : "combat";
    }
    if (def.item != ItemType.Count) {
        return "item";
    }
    // Same override as getThresholdCategory: a suppressed perk task keeps its
    // place in the cheapest-first "perk" priority band. Checked at the vanilla
    // position, so a perk-granting Boss still sorts as unlocker/combat.
    if (isForcedPerkCategoryTask(def) || (def.perk != PerkType.Count && !hasPerk(def.perk))) {
        return "perk";
    }
    if (def.type == TaskType.Prestige) {
        return "prestige";
    }
    if (def.unlocks_task >= 0 && !GAMESTATE.unlocked_tasks.includes(def.unlocks_task)) {
        return "unlocker";
    }
    return "plain";
}

export function autoFillPriorities(zone_id: number) {
    const zone = ZONES[zone_id];
    if (!zone) {
        return;
    }

    // Preserve player-prioritized entries the rebuild can't know about:
    // ids that aren't in the zone definition (host-injected exit-choice
    // tasks, scheduled artifact tasks). Matched by "not a zone task"
    // rather than by live-task lookup, because the regen can fire while
    // the injected task doesn't currently exist (e.g. the zone-entry
    // hook on a fresh re-entry, before the host re-injects exit tasks) —
    // the automation queue skips ids with no live task, so a parked
    // entry is harmless until its task reappears.
    const zone_task_ids = new Set(zone.tasks.map((def) => def.id));
    const old_prios = GAMESTATE.automation_prios.get(zone_id) ?? [];
    const preserved = old_prios
        .map((id, index) => ({ id, index }))
        .filter(({ id }) => !zone_task_ids.has(id));

    const order = getAutoFillOrder();
    const entries: { id: number; group: number; metric: number }[] = [];
    for (const def of zone.tasks) {
        if (def.hidden_by_default && !GAMESTATE.unlocked_tasks.includes(def.id)) {
            continue; // not discovered yet — re-run after unlocking to include it
        }

        // Use the live Task where one exists (current zone: real reps and
        // progress); a throwaway wrapper elsewhere — the cost and level
        // estimates only need the definition plus the current skill state.
        const live = GAMESTATE.tasks.find((t) => t.task_definition.id == def.id);
        const task = live ?? new Task(def);

        const category = autoFillCategory(def);
        const group = order.indexOf(category);
        let metric = 0;
        if (category == "perk") {
            // Perk tasks: cheapest-to-finish first, so reachable perks come early.
            metric = calcTaskEnergyCost(task, false, false) * Math.max(1, def.max_reps - task.reps);
        } else if (category == "plain") {
            // Plain tasks: most skill levels per energy first (negated for the
            // ascending sort). The Energy Thresholds filter re-judges these
            // live, so this order only has to be a sensible starting shape.
            const cost = calcTaskEnergyCost(task, false, false);
            metric = cost > 0 ? -(calcExpectedLevels(task) / cost) : 0;
        }
        entries.push({ id: def.id, group, metric });
    }

    entries.sort((a, b) => a.group - b.group || a.metric - b.metric || a.id - b.id);
    const ids = entries.map((e) => e.id);
    // Re-insert preserved foreign entries at (approximately) their old
    // positions, in ascending order so earlier inserts keep later
    // indices meaningful.
    for (const { id, index } of preserved) {
        ids.splice(Math.min(index, ids.length), 0, id);
    }
    GAMESTATE.automation_prios.set(zone_id, ids);
}

export function autoFillAllPriorities() {
    if (!hasPerk(PerkType.Amulet)) {
        return; // same gate as toggleAutomation
    }
    const max_zone = Math.min(GAMESTATE.highest_zone, ZONES.length - 1);
    for (let zone = 0; zone <= max_zone; zone++) {
        autoFillPriorities(zone);
    }
    syncActiveQueueIfCycling();
    saveGame();
}

// Game Mod — Auto-Prioritize: the autopilot form of Auto-Fill Priorities.
// While enabled (and the Amulet is held), priorities are regenerated at every
// energy reset and prestige, plus incrementally for one zone on task unlock
// and zone entry, so the plan tracks the current skill/energy state without
// any clicks. Manual edits are overwritten by design.
function maybeAutoPrioritizeAll() {
    if (GAMESTATE.mods.auto_prioritize && hasPerk(PerkType.Amulet)) {
        autoFillAllPriorities();
    }
}

function maybeAutoPrioritizeZone(zone_id: number) {
    if (GAMESTATE.mods.auto_prioritize && hasPerk(PerkType.Amulet)) {
        autoFillPriorities(zone_id);
        syncActiveQueueIfCycling();
    }
}

function pickNextTaskInAutomationQueue(): Task | null {
    if (GAMESTATE.automation_mode == AutomationMode.Off) {
        return null;
    }

    const prios = GAMESTATE.automation_prios.get(GAMESTATE.current_zone);
    if (!prios) {
        return null;
    }

    const threshold_skipped: Task[] = [];
    for (const task_id of prios) {
        for (const task of GAMESTATE.tasks) {
            if (task.task_definition.id != task_id) {
                continue;
            }

            if (isTaskDisabledWithoutBeingFinished(task)) {
                if (GAMESTATE.automation_skip_blocked) {
                    continue;
                }
                return null; // Better to stop automating than having it fuck up by skipping a Task
            }

            if (!task.enabled) {
                break;
            }

            // Game Mod — energy thresholds: not worth the energy right now.
            // Always skips (never pauses): unlike a blocked task this is a
            // deliberate "don't bother", and the task stays in the list in
            // case its category or level yield changes later in the run.
            // Collected so the all-skipped fallback can pick from them.
            if (isThresholdSkipped(task)) {
                threshold_skipped.push(task);
                continue;
            }

            threshold_stall_notified = false;
            return task;
        }
    }

    if (threshold_skipped.length > 0) {
        return handleThresholdStall(threshold_skipped);
    }

    return null;
}

export function setAutomationMode(mode: AutomationMode) {
    // If the player turns off automation they probably want to stop the ongoing task
    if (GAMESTATE.automation_mode != AutomationMode.Off && mode == AutomationMode.Off) {
        GAMESTATE.active_task = null;
    }

    GAMESTATE.automation_mode = mode;
    threshold_stall_notified = false; // re-arm the "all Tasks skipped" notice
}

export function setAutomationEndZone(zone: number) {
    GAMESTATE.automation_end = zone;
    if (GAMESTATE.automation_mode == AutomationMode.All && GAMESTATE.current_zone >= zone) {
        setAutomationMode(AutomationMode.Off);
    }
}

// MARK: Energy Reset

export class EnergyResetInfo {
    skill_gains: [SkillType, number][] = [];
    power_at_start = 0;
    power_at_end = 0;
    attunement_at_start = 0;
    attunement_at_end = 0;
    energetic_memory_gain = 0;
}

function checkEnergyReset() {
    if (GAMESTATE.current_energy > 0) {
        return;
    }

    GAMESTATE.is_in_energy_reset = true;
    GAMESTATE.current_energy = 0;

    populateEnergyResetInfo();
}

function populateEnergyResetInfo() {
    const info = new EnergyResetInfo();

    for (const skill of SKILLS) {
        const current_level = getSkill(skill).level;
        const starting_level = GAMESTATE.skills_at_start_of_reset[skill] as number;
        const skill_diff = current_level - starting_level;

        if (skill_diff > 0) {
            info.skill_gains.push([skill, skill_diff]);
        }
    }

    // Biggest gain first
    info.skill_gains.sort((a, b) => b[1] - a[1]);

    info.power_at_end = GAMESTATE.power;
    info.power_at_start = GAMESTATE.power_at_start_of_reset;
    info.attunement_at_end = GAMESTATE.attunement;
    info.attunement_at_start = GAMESTATE.attunement_at_start_of_reset;
    info.energetic_memory_gain = calcEnergeticMemoryGain();

    GAMESTATE.energy_reset_info = info;
}

// MARK: Prestige

export function hasUnlockedPrestige() {
    return GAMESTATE.prestige_available || GAMESTATE.prestige_count > 0;
}

export const PRESTIGE_GAIN_EXPONENT = 2.0;
export const BASE_PRESTIGE_GAIN = 100;

export function getPrestigeGainExponent() {
    return PRESTIGE_GAIN_EXPONENT + DIVINE_LIGHTNING_EXPONENT_INCREASE * getPrestigeRepeatableLevel(PrestigeRepeatableType.DivineLightning);
}

export function calcDivineSparkGainFromHighestZone(zone: number) {
    const prestige_zone = PRESTIGE_DATA.spark_zone_origin; // 0-indexed (vanilla: zone 15)
    const effective_zone = Math.max(0, zone - prestige_zone);
    let gain_mult = Math.pow(getPrestigeGainExponent(), effective_zone);
    if (hasPerk(PerkType.Awakening)) {
        gain_mult *= 1 + AWAKENING_DIVINE_SPARK_MULT;
    }
    if (hasPerk(PerkType.DefiedTheGods)) {
        gain_mult *= 1 + DEFIED_THE_GODS_SPARK_MULT;
    }
    if (hasPerk(PerkType.Ascended)) {
        gain_mult *= 2;
    }
    if (hasPrestigeUnlock(PrestigeUnlockType.AmazingSpeed)) {
        gain_mult *= 2;
    }
    if (hasPrestigeUnlock(PrestigeUnlockType.LimitlessPower)) {
        gain_mult *= 2;
    }
    if (hasPrestigeUnlock(PrestigeUnlockType.UnparalleledLearning)) {
        gain_mult *= 2;
    }
    if (hasPrestigeUnlock(PrestigeUnlockType.DivineSupremacy)) {
        gain_mult *= 2;
    }

    return Math.ceil(gain_mult * BASE_PRESTIGE_GAIN);
}

export function calcDivineSparkGain() {
    return calcDivineSparkGainFromHighestZone(GAMESTATE.highest_zone)
}

// MARK: Prestige Purchase Queue (Game Mod)

// A queued Divinity purchase. Field names avoid "id" (save replacer).
export interface PrestigeBuyEntry {
    kind: "unlock" | "repeatable";
    type: number;
}

// Queue mode in the Divinity popup pushes here instead of buying. The queue
// deliberately SURVIVES prestige — buying upgrades right after a prestige is
// its main use. A non-empty queue is the feature's opt-in; there's no mod.
export function queuePrestigePurchase(kind: "unlock" | "repeatable", type: number) {
    // Queueing the same one-time unlock twice would just leave a dead entry.
    if (kind == "unlock" && GAMESTATE.prestige_buy_queue.some((e) => e.kind == "unlock" && e.type == type)) {
        return;
    }
    GAMESTATE.prestige_buy_queue.push({ kind, type });
    processPrestigeBuyQueue(); // already affordable -> buys immediately
    saveGame();
}

export function resetPrestigeBuyQueue() {
    GAMESTATE.prestige_buy_queue = [];
    saveGame();
}

// 1-based queue positions of the pending entries for one purchase — the
// button badges in the Divinity popup.
export function getPrestigeQueuePositions(kind: "unlock" | "repeatable", type: number): number[] {
    const positions: number[] = [];
    GAMESTATE.prestige_buy_queue.forEach((entry, index) => {
        if (entry.kind == kind && entry.type == type) {
            positions.push(index + 1);
        }
    });
    return positions;
}

// Strict head-of-queue (user ruling): nothing is bought until the FRONT
// entry is affordable, so the order is a real strategic tool — you can
// deliberately save toward something big while cheaper entries wait behind
// it. Entries that became moot (unlock already owned, unknown type) drop
// silently. Runs once per tick while the queue is non-empty, which covers
// every spark source (prestige, discovery spark, spark items).
export function processPrestigeBuyQueue() {
    let bought = false;
    while (GAMESTATE.prestige_buy_queue.length > 0) {
        const head = GAMESTATE.prestige_buy_queue[0] as PrestigeBuyEntry;
        if (head.kind == "unlock") {
            if (hasPrestigeUnlock(head.type)) {
                GAMESTATE.prestige_buy_queue.shift();
                continue;
            }
            const def = PRESTIGE_UNLOCKABLES.find((unlock) => unlock.type == head.type);
            if (!def) {
                GAMESTATE.prestige_buy_queue.shift();
                continue;
            }
            if (def.cost > GAMESTATE.divine_spark) {
                break;
            }
            addPrestigeUnlock(head.type);
        } else {
            if (calcPrestigeRepeatableCost(head.type) > GAMESTATE.divine_spark) {
                break;
            }
            increasePrestigeRepeatableLevel(head.type);
        }
        GAMESTATE.prestige_buy_queue.shift();
        bought = true;
    }
    if (bought) {
        saveGame();
    }
}

// Game Mod — with the purchase queue EMPTY, automatically buy the cheapest
// affordable Divinity purchase (unlockables not yet owned, and repeatables,
// within unlocked prestige layers), repeating until nothing is affordable.
// A non-empty queue always takes precedence: explicit plans outrank the
// greedy default.
function maybeAutoBuyCheapest() {
    if (!GAMESTATE.mods.auto_buy_cheapest || GAMESTATE.prestige_buy_queue.length > 0) {
        return;
    }
    if (GAMESTATE.mods.auto_buy_budget_enabled) {
        if (autoBuyWithUnlockBudget()) {
            saveGame();
        }
        return;
    }
    let bought = false;
    for (;;) {
        let best_cost = Infinity;
        let buy: (() => void) | null = null;
        for (const unlock of PRESTIGE_UNLOCKABLES) {
            if (!GAMESTATE.prestige_layers_unlocked.includes(unlock.layer) || hasPrestigeUnlock(unlock.type)) {
                continue;
            }
            if (unlock.cost < best_cost) {
                best_cost = unlock.cost;
                const type = unlock.type;
                buy = () => addPrestigeUnlock(type);
            }
        }
        for (const upgrade of PRESTIGE_REPEATABLES) {
            if (!GAMESTATE.prestige_layers_unlocked.includes(upgrade.layer)) {
                continue;
            }
            const cost = calcPrestigeRepeatableCost(upgrade.type);
            if (cost < best_cost) {
                best_cost = cost;
                const type = upgrade.type;
                buy = () => increasePrestigeRepeatableLevel(type);
            }
        }
        if (!buy || best_cost > GAMESTATE.divine_spark) {
            break;
        }
        buy();
        bought = true;
    }
    if (bought) {
        saveGame();
    }
}

// Game Mod — Unlock Savings: Auto-Buy Cheapest with a budget on repeatables,
// so cheap low-exponent repeatables can't soak Divine Spark forever just
// below each unlockable's price point. Unlockables (cheapest first) are
// bought the moment they're affordable — each purchase starts a fresh budget
// window. The cheapest repeatable is bought only while repeatable spending
// since the last unlockable purchase stays within auto_buy_budget_pct% of the
// cheapest unowned unlockable's cost; with no unowned unlockable in the
// unlocked layers, spending is unrestricted. Simulated on the harness
// (CC/scripts/jta-stats, outer repo): pulls Mastery of Time / See Beyond the
// Veil forward by ~70 runs and roughly doubles long-run Spark income vs pure
// cheapest; the buy-unlockables-first ordering also matters — pure greedy can
// dribble Spark below an affordable unlockable's price right before buying it.
function autoBuyWithUnlockBudget(): boolean {
    let bought = false;
    for (;;) {
        let next_unlock: PrestigeUnlock | null = null;
        for (const unlock of PRESTIGE_UNLOCKABLES) {
            if (!GAMESTATE.prestige_layers_unlocked.includes(unlock.layer) || hasPrestigeUnlock(unlock.type)) {
                continue;
            }
            if (!next_unlock || unlock.cost < next_unlock.cost) {
                next_unlock = unlock;
            }
        }
        if (next_unlock && next_unlock.cost <= GAMESTATE.divine_spark) {
            addPrestigeUnlock(next_unlock.type);
            bought = true;
            continue;
        }

        let best: PrestigeRepeatable | null = null;
        let best_cost = Infinity;
        for (const upgrade of PRESTIGE_REPEATABLES) {
            if (!GAMESTATE.prestige_layers_unlocked.includes(upgrade.layer)) {
                continue;
            }
            const cost = calcPrestigeRepeatableCost(upgrade.type);
            if (cost < best_cost) {
                best = upgrade;
                best_cost = cost;
            }
        }
        if (!best || best_cost > GAMESTATE.divine_spark) {
            return bought;
        }
        if (next_unlock) {
            const budget = (GAMESTATE.mods.auto_buy_budget_pct / 100) * next_unlock.cost;
            if (GAMESTATE.repeatable_spend_since_unlock + best_cost > budget) {
                return bought;
            }
        }
        increasePrestigeRepeatableLevel(best.type);
        bought = true;
    }
}

// MARK: Auto-Prestige (Game Mod)

// True when any enabled auto-prestige condition is met. Evaluated at the
// run-end decision point (the energy-reset moment), where prestige replaces
// the reset; all conditions require prestige to actually be available.
export function shouldAutoPrestige(): boolean {
    const mods = GAMESTATE.mods;
    if (!mods.auto_prestige || !GAMESTATE.prestige_available) {
        return false;
    }
    // Diminishing returns: spark-per-reset sagged below the configured
    // fraction of its peak. Needs a completed reset so the ratio has moved.
    if (mods.auto_prestige_ratio_enabled && GAMESTATE.energy_reset_count >= 1
        && GAMESTATE.peak_spark_per_reset > 0
        && calcSparkPerReset() < (mods.auto_prestige_ratio_pct / 100) * GAMESTATE.peak_spark_per_reset) {
        return true;
    }
    // Prospective spark reached an absolute target.
    if (mods.auto_prestige_target_enabled && calcDivineSparkGain() >= mods.auto_prestige_target) {
        return true;
    }
    // Plateau: K consecutive resets without reaching a new highest zone.
    if (mods.auto_prestige_stall_enabled
        && GAMESTATE.resets_since_highest_zone_gain >= Math.max(1, Math.floor(mods.auto_prestige_stall_resets))) {
        return true;
    }
    // Wealth-relative: the gain is a meaningful fraction of owned spark.
    // With zero owned, any gain qualifies — the first prestige fires as
    // soon as it's available.
    if (mods.auto_prestige_wealth_enabled
        && calcDivineSparkGain() >= (mods.auto_prestige_wealth_pct / 100) * Math.max(1, GAMESTATE.divine_spark)) {
        return true;
    }
    return false;
}

// Called by the run-end paths INSTEAD of doEnergyReset when it returns true:
// performs the prestige, keeps automation running afterwards when Resume on
// Reset is on (doPrestige turns automation off like any reset does), and
// surfaces a notification with the spark gained.
export function maybeAutoPrestige(): boolean {
    if (!shouldAutoPrestige()) {
        return false;
    }
    const resume = GAMESTATE.mods.resume_automation_on_reset;
    const saved_mode = GAMESTATE.automation_mode;
    const gain = calcDivineSparkGain();
    doPrestige();
    if (resume) {
        GAMESTATE.automation_mode = saved_mode;
    }
    const context = new AwardedSparkContext();
    context.amount = gain;
    GAMESTATE.queueRenderEvent(new RenderEvent(EventType.AutoPrestiged, context));
    return true;
}

// Prospective spark from prestiging now, averaged over this prestige's runs
// (energy resets so far plus the run in progress, so it's defined from run
// one). The efficiency signal behind the spark stats display and the
// auto-prestige triggers: it jumps when a new highest zone is reached
// (spark roughly doubles per zone) and decays at every reset while progress
// plateaus. The peak since the last prestige is tracked per tick in
// updateGamestate and wiped by doPrestige.
export function calcSparkPerReset(): number {
    return calcDivineSparkGain() / (GAMESTATE.energy_reset_count + 1);
}

export function hasPrestigeUnlock(unlock: PrestigeUnlockType) {
    return GAMESTATE.prestige_unlocks.includes(unlock);
}

export function getPrestigeRepeatableLevel(repeatable: PrestigeRepeatableType) {
    return GAMESTATE.prestige_repeatables.get(repeatable) ?? 0;
}

function applyPrestigeUnlockEffects(unlock: PrestigeUnlockType, show_notification: boolean) {
    if (unlock == PrestigeUnlockType.PermanentAutomation) {
        tryAddPerk(PerkType.Amulet, show_notification);
    } else if (unlock == PrestigeUnlockType.LookInTheMirror) {
        tryAddPerk(PerkType.ReflectionsOnTheJourney, show_notification);
    } else if (unlock == PrestigeUnlockType.FullyAttuned) {
        tryAddPerk(PerkType.Attunement, show_notification);
    } else if (unlock == PrestigeUnlockType.TranscendantMemory) {
        tryAddPerk(PerkType.EnergeticMemory, show_notification);
    } else if (unlock == PrestigeUnlockType.MasteryOfTime) {
        tryAddPerk(PerkType.MinorTimeCompression, show_notification);
        tryAddPerk(PerkType.MajorTimeCompression, show_notification);
        doMasteryOfTimeTaskCompletion();
    } else if (unlock == PrestigeUnlockType.SeeBeyondTheVeil) {
        // Vanilla: 17 Secret Fishing Spot, 28 Training Dummy, 88 Train at
        // every Guild, 158 Divine Notes, 209 Gaze Beyond the Veil.
        for (const task_id of PRESTIGE_DATA.sbtv_unlock_task_ids) {
            unlockTask(task_id);
        }
    } else if (unlock == PrestigeUnlockType.DivineSupremacy) {
        GAMESTATE.max_energy += DIVINE_SUPREMACY_ENERGY;
        // Mirror into the starting-energy-bonus accumulator (fork hook);
        // this bonus writes max_energy directly, bypassing modifyMaxEnergy.
        GAMESTATE.jta_starting_energy_bonus += DIVINE_SUPREMACY_ENERGY;
    }
}

export function addPrestigeUnlock(unlock: PrestigeUnlockType) {
    if (hasPrestigeUnlock(unlock)) {
        console.error("Already has prestige unlock");
        return;
    }

    const definition = PRESTIGE_UNLOCKABLES[unlock] as PrestigeUnlock;

    if (GAMESTATE.divine_spark < definition.cost) {
        console.error("Not enough prestige currency");
        return;
    }

    GAMESTATE.divine_spark -= definition.cost;
    GAMESTATE.prestige_unlocks.push(unlock);
    GAMESTATE.repeatable_spend_since_unlock = 0; // fresh Unlock Savings window

    const show_notification = true;
    applyPrestigeUnlockEffects(unlock, show_notification);
}

export function calcPrestigeRepeatableCost(repeatable: PrestigeRepeatableType) {
    const definition = PRESTIGE_REPEATABLES[repeatable] as PrestigeRepeatable;
    const current_level = getPrestigeRepeatableLevel(repeatable);
    const base_cost = definition.initial_cost;

    return Math.ceil(base_cost * Math.pow(definition.scaling_exponent, current_level));
}

export function increasePrestigeRepeatableLevel(repeatable: PrestigeRepeatableType) {
    const cost = calcPrestigeRepeatableCost(repeatable);

    if (GAMESTATE.divine_spark < cost) {
        console.error("Not enough prestige currency");
        return;
    }

    const current_level = getPrestigeRepeatableLevel(repeatable);
    GAMESTATE.prestige_repeatables.set(repeatable, current_level + 1);
    GAMESTATE.divine_spark -= cost;
    GAMESTATE.repeatable_spend_since_unlock += cost;

    if (repeatable == PrestigeRepeatableType.TranscendantAptitude) {
        const global_target_level = (current_level + 1) * TRANSCENDANT_APTITUDE_MULT;
        for (const skill of GAMESTATE.skills) {
            const target_level = skill.type == SKILL_ROLES.ascension_skill ? global_target_level / 2 : global_target_level;
            skill.level = Math.max(target_level, skill.level);
        }
    } else if (repeatable == PrestigeRepeatableType.Energized) {
        modifyEnergy(ENERGIZED_INCREASE);
        modifyMaxEnergy(ENERGIZED_INCREASE);
    }
}

function applyGameStartPrestigeEffects() {
    const show_notification = false;

    // We set this so Mastery of Time doesn't trigger and cause notifications
    GAMESTATE.is_in_zone_skip = true;

    for (const unlock of GAMESTATE.prestige_unlocks) {
        applyPrestigeUnlockEffects(unlock, show_notification);
    }

    const energy_boost = ENERGIZED_INCREASE * getPrestigeRepeatableLevel(PrestigeRepeatableType.Energized);
    modifyEnergy(energy_boost);
    modifyMaxEnergy(energy_boost);
    skipFreeZones();

    GAMESTATE.is_in_zone_skip = false;
    doMasteryOfTimeTaskCompletion();
}

export function doPrestige() {
    // Restart the queue cycle at the first queue before the reset rebuilds tasks.
    resetQueueCycleForPrestige();
    doAnyReset();
    GAMESTATE.prestige_count++;
    GAMESTATE.highest_prestige_zone = Math.max(GAMESTATE.highest_zone, GAMESTATE.highest_prestige_zone);
    GAMESTATE.divine_spark += calcDivineSparkGain();

    // Reset most game state
    GAMESTATE.unlocked_tasks = [];
    GAMESTATE.highest_zone = 0;
    GAMESTATE.highest_zone_fully_completed = -1;
    initializeSkills();

    // We set these to false/zero rather than clearing it, so the player can still see everything they've unlocked in the past
    for (const perk of GAMESTATE.perks.keys()) {
        GAMESTATE.perks.set(perk, false);
    }
    for (const item of GAMESTATE.items.keys()) {
        GAMESTATE.items.set(item, 0);
    }

    // Ensure we apply Compulsive Notetaking
    handleEnergyResetItemCounts();

    GAMESTATE.energy_reset_info = new EnergyResetInfo();
    GAMESTATE.energy_reset_count = 0;
    GAMESTATE.auto_use_cycle_counter = 0;
    GAMESTATE.max_energy = STARTING_ENERGY;
    GAMESTATE.current_energy = STARTING_ENERGY;
    // Reset the starting-energy-bonus accumulator alongside max_energy (fork
    // hook). applyGameStartPrestigeEffects re-applies the persistent bonuses
    // (Divine Supremacy, Energized) right after, re-accumulating them.
    GAMESTATE.jta_starting_energy_bonus = 0;
    GAMESTATE.power = 0;
    GAMESTATE.attunement = 0;
    GAMESTATE.prestige_available = false;
    // Queue cycling owns auto-use during its runs (set by the restart above);
    // otherwise prestige turns auto-use off.
    if (!GAMESTATE.mods.queue_cycle) {
        GAMESTATE.auto_use_items = false;
        GAMESTATE.auto_use_excluded_items = [];
    }
    GAMESTATE.unlocked_new_prestige_this_prestige = false;

    // Prestige changes the XP/level balance (skills reset to aptitude base)
    // and wipes all Rings, so pre-prestige Ring history would only mislead.
    GAMESTATE.run_task_history = [];
    GAMESTATE.run_history_by_context = {};
    GAMESTATE.ring_plan = [];
    GAMESTATE.ring_plan_used = [];
    GAMESTATE.peak_spark_per_reset = 0;
    GAMESTATE.resets_since_highest_zone_gain = 0;

    // Re-apply mods after the perk wipe so force_automation re-grants the
    // Amulet that gates automation and auto-use.
    applyMods();

    if (!hasPrestigeUnlock(PrestigeUnlockType.SeeBeyondTheVeil))
    {
        for (const [, task] of TASK_LOOKUP) {
            if (task.type == TaskType.Boss && hasAutomatedTask(task)) {
                toggleAutomation(task);
            }
        }
    }

    // Things not reset:
    // has_unlocked_power - No reason to hide that from the UI
    // unlocked_skills - No reason to hide that either
    // Any prestige variable, duh. Except prestige_available

    resetTasks();
    applyGameStartPrestigeEffects();

    // Auto-Prioritize: rebuild the plan for the fresh prestige — after the
    // prestige effects, so a re-granted Amulet (force_automation /
    // PermanentAutomation) passes the gate.
    maybeAutoPrioritizeAll();

    storeLoopStartNumbersForNextGameOver();
    setTickRate();
    saveGame();

    // Notify the host, same as doEnergyReset — a prestige is also a
    // game-initiated run end (zone 0, energy refilled) that the substrate
    // bridge must observe to keep the shared loop-mode pool in sync.
    if (_energy_reset_callback) {
        _energy_reset_callback({
            currentEnergy: GAMESTATE.current_energy,
            maxEnergy: GAMESTATE.max_energy,
            energyResetCount: GAMESTATE.energy_reset_count,
        });
    }
}

export function calcPerkySpeedMultiplier() {
    let unlocked_perks = 0;

    for (const [, active] of GAMESTATE.perks) {
        if (active) {
            ++unlocked_perks;
        }
    }

    return Math.pow(PERKY_BASE, unlocked_perks);
}

// MARK: Persistence

export const SAVE_LOCATION = "incrementalGameSave";

// Managed (substrate) sessions persist under their own key so they never
// touch a standalone save on the same origin. One shared substrate slot
// across all presets/worlds — the game content is identical across presets;
// only the host-owned region topology differs.
//
// A loaded dataset adds its own dimension: numeric task/perk/item/skill ids
// are save-load-bearing, so each dataset gets its own slot. Vanilla managed
// play keeps the plain substrate slot; standalone is untouched.
export function getSaveLocation(): string {
    if (_loaded_dataset_id !== null) {
        return SAVE_LOCATION + "_substrate__" + _loaded_dataset_id;
    }
    return _managed_mode ? SAVE_LOCATION + "_substrate" : SAVE_LOCATION;
}

export function saveGame() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saveData: any = {};

    GAMESTATE.save_version = SAVE_VERSION;

    for (const key in GAMESTATE) {
        if (key == "active_task") {
            continue; // This would feel weird for the player if was persisted
        }
        if (key == "automation_mode") {
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(GAMESTATE, key)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const value = (GAMESTATE as any)[key];
            // Check if the value is a Map and convert it to an array
            if (value instanceof Map) {
                saveData[key] = Array.from(value.entries());
            } else if (key == "tasks") {
                // Synthetic tasks aren't real zone tasks: artifact tasks are
                // rebuilt from artifact_tasks on load, and host-injected exit
                // tasks are re-injected by the substrate bridge. Neither id is
                // in TASK_LOOKUP, so excluding both avoids the task_definition
                // reviver yielding undefined.
                saveData[key] = (value as Task[]).filter(t => !isSyntheticTask(t));
            } else {
                saveData[key] = value;
            }
        }
    }

    // Stamp dataset saves with their dataset identity so loadGame can refuse
    // a blob that doesn't belong to the loaded tables (hand-copied saves,
    // key collisions). Vanilla saves are unchanged — no stamp.
    if (_loaded_dataset_id !== null) {
        saveData.dataset_id = _loaded_dataset_id;
        saveData.dataset_schema_version = _loaded_dataset_schema_version;
    }

    // Save to localStorage
    const json = JSON.stringify(saveData, (key, value) => {
        if (typeof value === 'object' && value !== null && 'id' in value) {
            return value.id; // Replace object with its ID
        }
        return value;
    });

    localStorage.setItem(getSaveLocation(), json);
}

function parseSave(save: string): unknown {
    const data = JSON.parse(save, function (key, value) {
        if (key == "task_definition") {
            return TASK_LOOKUP.get(value); // Replace ID with the actual object
        }
        return value;
    });

    return data;
}

function loadGame(): boolean {
    const saved_game = localStorage.getItem(getSaveLocation());
    if (!saved_game) {
        return false;
    }

    try {
        // Refuse a blob whose dataset stamp doesn't match the loaded tables
        // BEFORE parseSave: the task reviver resolves ids via TASK_LOOKUP, so
        // a foreign blob would revive undefined task definitions and crash
        // later instead of failing cleanly here. Mismatch = fresh init.
        const stamp = JSON.parse(saved_game) as { dataset_id?: unknown, dataset_schema_version?: unknown };
        if (_loaded_dataset_id === null) {
            if (stamp.dataset_id !== undefined) {
                console.warn("Ignoring save from dataset", stamp.dataset_id, "— no dataset loaded");
                return false;
            }
        } else if (stamp.dataset_id !== _loaded_dataset_id
            || stamp.dataset_schema_version !== _loaded_dataset_schema_version) {
            console.warn("Ignoring save from dataset", stamp.dataset_id, "— loaded dataset is", _loaded_dataset_id);
            return false;
        }

        const data = parseSave(saved_game);
        loadGameFromData(data);
    } catch (e) {
        console.log(e);
        return false;
    }

    return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadGameFromData(data: any) {
    // The dataset stamp is envelope metadata, not game state — drop it so it
    // never lands on GAMESTATE (loadGame already verified it).
    delete data.dataset_id;
    delete data.dataset_schema_version;

    Object.keys(data).forEach(key => {
        const value = data[key];

        // Convert it back to a Map if that's what we want
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (GAMESTATE as any)[key] = (GAMESTATE as any)[key] instanceof Map ? new Map(value) : value;
    });

    // Get rid of any skills that no longer exist
    GAMESTATE.unlocked_skills = GAMESTATE.unlocked_skills.filter((skill) => SKILLS.includes(skill));

    for (const task of GAMESTATE.tasks) {
        task.reps = Math.min(task.reps, task.task_definition.max_reps);
    }

    // At least not as inaccurate as shwoing these as 1/0
    GAMESTATE.highest_zone_ever = Math.max(GAMESTATE.highest_zone, GAMESTATE.highest_zone_ever);
    GAMESTATE.highest_zone_fully_completed_ever = Math.max(GAMESTATE.highest_zone_fully_completed, GAMESTATE.highest_zone_fully_completed_ever);

    // We didn't use to track this, so let's get as close as we can
    if (GAMESTATE.highest_prestige_zone == 0 && GAMESTATE.prestige_count > 0) {
        GAMESTATE.highest_prestige_zone = GAMESTATE.highest_zone_ever;
    }

    // Migrate queues saved before the three-way auto-use mode: the old boolean
    // auto_use_items maps to "all"/"none", with no exclusions.
    for (const queue of GAMESTATE.queue_configs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const legacy = queue as any;
        if (legacy.auto_use_mode == null) {
            legacy.auto_use_mode = legacy.auto_use_items ? "all" : "none";
        }
        if (!Array.isArray(queue.excluded_items)) {
            queue.excluded_items = [];
        }
    }

    // Migration: Fork 1.4 briefly shipped boolean threshold_*_absolute metric
    // toggles, immediately generalized to the 3-way threshold_*_metric field
    // with /rst as the default. Drop any saved legacy flag WITHOUT mapping it
    // (deliberate, per user: the 2-state era's auto-assigned values shouldn't
    // pin old saves to /lvl//rep — let the merge apply the /rst default).
    if (GAMESTATE.mods) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const legacy_mods = GAMESTATE.mods as any;
        for (const category of THRESHOLD_CATEGORY_LIST) {
            delete legacy_mods[`threshold_${category}_absolute`];
        }
        // threshold_end_run (bool) became the 3-way threshold_all_skipped;
        // preserve a deliberate end-run choice.
        if ("threshold_end_run" in legacy_mods) {
            if (!("threshold_all_skipped" in legacy_mods)) {
                legacy_mods.threshold_all_skipped = legacy_mods.threshold_end_run
                    ? THRESHOLD_ALL_SKIPPED_END_RUN : THRESHOLD_ALL_SKIPPED_IDLE;
            }
            delete legacy_mods.threshold_end_run;
        }
    }

    // Merge mods over defaults so saves from before a given mod existed (or
    // from before mods at all) get safe values for any missing field.
    GAMESTATE.mods = { ...defaultMods(), ...(GAMESTATE.mods ?? {}) };

    // Migration: the single last_run_task_history became the per-context
    // run_history_by_context. Seed the current context's bucket from the
    // legacy field (after the mods merge — the context depends on mods).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy_state = GAMESTATE as any;
    if (Array.isArray(legacy_state.last_run_task_history)) {
        if (legacy_state.last_run_task_history.length > 0
            && Object.keys(GAMESTATE.run_history_by_context).length == 0) {
            GAMESTATE.run_history_by_context[currentRingContext()] = legacy_state.last_run_task_history;
        }
        delete legacy_state.last_run_task_history;
    }
    applyMods();

    // Artifact tasks are excluded from the saved `tasks`; rebuild the current
    // zone's from the persisted specs (load doesn't go through initializeTasks).
    injectArtifactTasksForCurrentZone();
    updateEnabledTasks();
}

// MARK: Game Mods

// Opt-in "Game Mods" — balance / cheat / automation / friction toggles.
// All default off/neutral so the base game is unchanged unless the player
// (or, in managed mode, the host via the window API) turns one on. See
// MODS_PLAN.md (mods branch) for the design.
export interface GameMods {
    // Settings overlay — the "Game Mods" toggles
    award_spark_on_discovery: boolean;   // award divine spark when a Prestige task completes
    discovery_spark_fraction: number;    // fraction of full prestige gain awarded on discovery
    force_automation: boolean;           // permanently grant the Amulet (automation) perk
    advanced_automation: boolean;        // UI-only gate: show the fork's advanced-automation UI (the Advanced Automation panel and the Divinity popup's queue/auto-buy controls) while automation is available. Never affects simulation behavior.
    auto_continue_energy_reset: boolean; // skip the energy-reset summary overlay
    suppress_prestige_popup: boolean;    // suppress the "prestige available" popup
    show_spark_stats: boolean;           // show spark-per-reset (current + peak) under the Divine Spark button
    instant_mode_allowed: boolean;       // Settings gate: expose the Instant Mode toggle in Advanced Automation
    instant_mode: boolean;               // complete tasks in one tick (only effective while allowed)

    // Advanced Automation panel — Controls section (right column)
    resume_automation_on_reset: boolean; // restore automation mode/target after a reset
    auto_haste: boolean;                 // smart auto-use of Scroll of Haste
    auto_lightning: boolean;             // smart auto-use of Bottled Lightning (Bosses only)
    auto_use_cycle: boolean;             // cycle item auto-use across energy resets
    auto_use_cycle_off_resets: number;   // resets with auto-use off before one on
    auto_use_free_items: boolean;        // use "rounding-error" Items that won't reduce keep
    artifact_tasks_item_cycle_only: boolean; // only run scheduled artifact tasks on item cycles
    queue_cycle: boolean;                // cycle through saved automation queues, one per energy reset
    auto_dreamcatcher: boolean;          // auto-use Dreamcatchers late in the run
    auto_dreamcatcher_pct: number;       // fire when the next rep costs >= this % of current energy
    auto_ring: boolean;                  // spend Magic Rings on last run's best level-gain tasks
    auto_prioritize: boolean;            // regenerate all priorities each reset/prestige/unlock/zone entry

    // Auto-Prestige — at the run-end moment, prestige instead of doing the
    // energy reset when ANY enabled condition is met (see shouldAutoPrestige).
    auto_prestige: boolean;                  // master switch
    auto_prestige_ratio_enabled: boolean;    // spark/reset < pct of its peak since last prestige
    auto_prestige_ratio_pct: number;
    auto_prestige_target_enabled: boolean;   // prospective spark >= absolute target
    auto_prestige_target: number;
    auto_prestige_stall_enabled: boolean;    // K resets in a row without a new highest zone
    auto_prestige_stall_resets: number;
    auto_prestige_wealth_enabled: boolean;   // prospective spark >= pct of owned spark
    auto_prestige_wealth_pct: number;
    auto_buy_cheapest: boolean;              // queue empty: buy the cheapest affordable Divinity purchase
    auto_buy_budget_enabled: boolean;        // Unlock Savings: budget repeatable spending toward the next unlockable
    auto_buy_budget_pct: number;             // repeatable spend since the last unlockable <= this % of the next one's cost

    // Energy Thresholds — skip prioritized tasks that fail the category's
    // configured judgment. Each category has an enable toggle (disabled =
    // exempt, its tasks always run), a metric (THRESHOLD_METRIC_LEVEL: % of
    // max energy per skill level earned; _REP: % of max energy per rep;
    // _RESETS: energy resets until fully completable), a percentage for the
    // two %-based metrics, and a max-resets count for the resets metric. See
    // isThresholdSkipped / getThresholdCategory / estimateResetsToComplete.
    threshold_master: boolean;                   // master switch for the filter
    threshold_all_skipped: number;               // THRESHOLD_ALL_SKIPPED_*: idle / end run / run best-yield task
    threshold_perk_affordable_enabled: boolean;  // awards an unearned perk, finishable within current energy
    threshold_perk_affordable_pct: number;
    threshold_perk_affordable_metric: number;
    threshold_perk_affordable_resets: number;
    threshold_perk_unaffordable_enabled: boolean; // awards an unearned perk, NOT finishable this cycle
    threshold_perk_unaffordable_pct: number;
    threshold_perk_unaffordable_metric: number;
    threshold_perk_unaffordable_resets: number;
    threshold_combat_enabled: boolean;           // Boss tasks whose unlock is already done
    threshold_combat_pct: number;
    threshold_combat_metric: number;
    threshold_combat_resets: number;
    threshold_item_enabled: boolean;             // awards an item each rep (Bosses excluded)
    threshold_item_pct: number;
    threshold_item_metric: number;
    threshold_item_resets: number;
    threshold_prestige_enabled: boolean;         // Prestige tasks
    threshold_prestige_pct: number;
    threshold_prestige_metric: number;
    threshold_prestige_resets: number;
    threshold_progression_enabled: boolean;      // Travel / Mandatory tasks
    threshold_progression_pct: number;
    threshold_progression_metric: number;
    threshold_progression_resets: number;
    threshold_unlocker_enabled: boolean;         // unlocks another task when finished
    threshold_unlocker_pct: number;
    threshold_unlocker_metric: number;
    threshold_unlocker_resets: number;
    threshold_other_enabled: boolean;            // everything else
    threshold_other_pct: number;
    threshold_other_metric: number;
    threshold_other_resets: number;
}

export function defaultMods(): GameMods {
    return {
        award_spark_on_discovery: false,
        discovery_spark_fraction: 0.1,
        force_automation: false,
        advanced_automation: false,
        auto_continue_energy_reset: false,
        suppress_prestige_popup: false,
        show_spark_stats: false,
        instant_mode_allowed: false,
        instant_mode: false,
        resume_automation_on_reset: false,
        auto_haste: false,
        auto_lightning: false,
        auto_use_cycle: false,
        auto_use_cycle_off_resets: 1,
        auto_use_free_items: false,
        artifact_tasks_item_cycle_only: false,
        queue_cycle: false,
        auto_dreamcatcher: false,
        auto_dreamcatcher_pct: 25,
        auto_ring: false,
        auto_prioritize: false,
        auto_prestige: false,
        auto_prestige_ratio_enabled: false,
        auto_prestige_ratio_pct: 50,
        auto_prestige_target_enabled: false,
        auto_prestige_target: 1000,
        auto_prestige_stall_enabled: false,
        auto_prestige_stall_resets: 20,
        auto_prestige_wealth_enabled: false,
        auto_prestige_wealth_pct: 10,
        auto_buy_cheapest: false,
        auto_buy_budget_enabled: false,
        auto_buy_budget_pct: 100,
        threshold_master: false,
        threshold_all_skipped: THRESHOLD_ALL_SKIPPED_IDLE,
        threshold_perk_affordable_enabled: false,
        threshold_perk_affordable_pct: 100,
        threshold_perk_affordable_metric: THRESHOLD_METRIC_RESETS,
        threshold_perk_affordable_resets: 5,
        threshold_perk_unaffordable_enabled: false,
        threshold_perk_unaffordable_pct: 25,
        threshold_perk_unaffordable_metric: THRESHOLD_METRIC_RESETS,
        threshold_perk_unaffordable_resets: 5,
        threshold_combat_enabled: false,
        threshold_combat_pct: 10,
        threshold_combat_metric: THRESHOLD_METRIC_REP,
        threshold_combat_resets: 3,
        threshold_item_enabled: false,
        threshold_item_pct: 5,
        threshold_item_metric: THRESHOLD_METRIC_REP,
        threshold_item_resets: 3,
        threshold_prestige_enabled: false,
        threshold_prestige_pct: 100,
        threshold_prestige_metric: THRESHOLD_METRIC_RESETS,
        threshold_prestige_resets: 10,
        threshold_progression_enabled: false,
        threshold_progression_pct: 100,
        threshold_progression_metric: THRESHOLD_METRIC_RESETS,
        threshold_progression_resets: 5,
        threshold_unlocker_enabled: false,
        threshold_unlocker_pct: 50,
        threshold_unlocker_metric: THRESHOLD_METRIC_RESETS,
        threshold_unlocker_resets: 5,
        threshold_other_enabled: false,
        threshold_other_pct: 1,
        threshold_other_metric: THRESHOLD_METRIC_LEVEL,
        threshold_other_resets: 3,
    };
}

export function getMods(): GameMods {
    return GAMESTATE.mods;
}

export function isModEnabled(name: keyof GameMods): boolean {
    return Boolean(GAMESTATE.mods[name]);
}

export function getMod(name: keyof GameMods): boolean | number {
    return GAMESTATE.mods[name];
}

// Set a mod by name with light type coercion, then apply side-effects.
// Returns false (and logs) for unknown names or invalid numeric values.
export function setMod(name: keyof GameMods, value: boolean | number): boolean {
    if (!(name in GAMESTATE.mods)) {
        console.error(`Unknown mod: ${String(name)}`);
        return false;
    }
    const current = GAMESTATE.mods[name];
    if (typeof current === "number") {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isNaN(num)) {
            console.error(`Invalid numeric value for mod ${String(name)}: ${String(value)}`);
            return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (GAMESTATE.mods as any)[name] = num;
    } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (GAMESTATE.mods as any)[name] = Boolean(value);
    }

    // Queue cycling and the auto-use cycle are mutually exclusive; enabling one
    // turns the other off. Enabling cycling seeds an initial queue from the
    // current plan (if none yet) and makes the active queue the live plan.
    if (name == "queue_cycle" && GAMESTATE.mods.queue_cycle) {
        GAMESTATE.mods.auto_use_cycle = false;
        // Queue cycling means hand-crafted per-queue plans; the autopilot
        // would overwrite the loaded queue every reset.
        GAMESTATE.mods.auto_prioritize = false;
        seedQueueConfigsIfEmpty();
        loadActiveQueue();
    } else if (name == "auto_use_cycle" && GAMESTATE.mods.auto_use_cycle) {
        GAMESTATE.mods.queue_cycle = false;
    } else if (name == "auto_prioritize" && GAMESTATE.mods.auto_prioritize) {
        GAMESTATE.mods.queue_cycle = false;
        maybeAutoPrioritizeAll(); // take effect immediately, not at the next reset
    } else if (name == "instant_mode_allowed" && !GAMESTATE.mods.instant_mode_allowed) {
        // Revoking the Settings gate hides AND disables the toggle: instant
        // mode must not silently resume if the gate is later re-enabled.
        GAMESTATE.mods.instant_mode = false;
    }

    applyMods();
    saveGame();
    return true;
}

// Apply mod side-effects. Safe to call on load and after any mod change.
// Behaviors are filled in across later phases (force_automation perk grant,
// etc.); kept centralized so the window API and UI share one entry point.
export function applyMods() {
    // force_automation: grant the Amulet perk while enabled, without stripping
    // a legitimately earned Amulet when disabled.
    if (GAMESTATE.mods.force_automation && !hasPerk(PerkType.Amulet)) {
        GAMESTATE.perks.set(PerkType.Amulet, true);
        GAMESTATE.mods_granted_amulet = true;
    } else if (!GAMESTATE.mods.force_automation && GAMESTATE.mods_granted_amulet) {
        // Only remove the Amulet if this mod is what granted it — and never if
        // the player legitimately owns the Permanent Automation prestige unlock.
        if (!hasPrestigeUnlock(PrestigeUnlockType.PermanentAutomation)) {
            GAMESTATE.perks.set(PerkType.Amulet, false);
        }
        GAMESTATE.mods_granted_amulet = false;
    }
}

// MARK: Gamestate

export class Gamestate {
    save_version: string = "";

    tasks: Task[] = [];
    active_task: Task | null = null;
    unlocked_tasks: number[] = [];

    // Player-scheduled artifact-use tasks (see ArtifactTaskSpec). The specs are
    // durable; the Task objects are re-injected per zone, so these are excluded
    // from the serialized `tasks` and rebuilt from here on load.
    artifact_tasks: ArtifactTaskSpec[] = [];
    next_artifact_task_id = ARTIFACT_TASK_ID_BASE;

    // Queue cycling (Game Mod): saved automation queues rotated one per energy
    // reset. The active queue's plan is the live automation_prios + artifact_tasks;
    // the others are stored snapshots. See QueueConfig.
    queue_configs: QueueConfig[] = [];
    active_queue_index = 0;
    queue_runs_on_current = 0;

    // Run task history / Auto Magic Ring (Game Mod): tasks started this run
    // and last run's completions, plus the current run's Ring plan (keys from
    // runTaskKey) and which planned keys already got a Ring. All persisted so
    // a mid-run reload neither re-plans nor double-spends; wiped on prestige.
    run_task_history: RunTaskRecord[] = [];
    // Completed-run history per run context (see currentRingContext): plain
    // object keyed by context string, JSON-safe for the save as-is.
    run_history_by_context: Record<string, RunTaskRecord[]> = {};
    ring_plan: string[] = [];
    ring_plan_used: string[] = [];

    // Auto-Fill Priorities (Game Mod): player-configurable category order,
    // sanitized on read by getAutoFillOrder(). Stored as plain strings.
    auto_fill_order: string[] = defaultAutoFillOrder();
    auto_fill_order_collapsed = true;

    // Prestige purchase queue (Game Mod): pending Divinity purchases, bought
    // strictly head-first whenever spark suffices. Survives prestige.
    prestige_buy_queue: PrestigeBuyEntry[] = [];
    // Unlock Savings (auto_buy_budget_*): Spark spent on repeatables since the
    // last unlockable purchase, from ANY buyer (auto-buy, queue, manual click)
    // — all purchases funnel through increasePrestigeRepeatableLevel /
    // addPrestigeUnlock. Persisted; missing in old saves = 0 via the default.
    repeatable_spend_since_unlock = 0;

    // Spark stats (Game Mod): highest calcSparkPerReset() seen since the
    // last prestige. Feeds the display and the ratio auto-prestige trigger.
    peak_spark_per_reset = 0;
    // Consecutive energy resets without reaching a new highest zone; the
    // auto-prestige stall trigger. Zeroed on a new highest zone and prestige.
    resets_since_highest_zone_gain = 0;

    current_zone: number = 0;
    highest_zone: number = 0;
    highest_zone_fully_completed: number = -1;
    highest_zone_ever: number = 0;
    highest_zone_fully_completed_ever: number = -1;

    repeat_tasks = true;
    automation_mode = AutomationMode.Off;
    automation_prios: Map<number, number[]> = new Map();
    automation_end = 99;
    automation_skip_blocked = false;
    auto_use_items = false;
    auto_use_excluded_items: number[] = []; // ItemTypes the active queue excludes from auto-use
    undo_item: [ItemType, amount: number] = [ItemType.Count, 0];
    manual_tooltips = false;

    skills_at_start_of_reset: number[] = [];
    power_at_start_of_reset = 0;
    attunement_at_start_of_reset = 0;

    skills: Skill[] = [];
    unlocked_skills: SkillType[] = [];
    perks: Map<PerkType, boolean> = new Map();
    items: Map<ItemType, number> = new Map();
    items_found_this_energy_reset: ItemType[] = [];
    used_items: Map<ItemType, number> = new Map();
    queued_scrolls_of_haste = 0;
    queued_magic_rings = 0;
    queued_lightning = 0;

    is_in_energy_reset = false;
    is_at_end_of_content = false;
    energy_reset_info = new EnergyResetInfo();
    is_in_zone_skip = false;

    current_energy = STARTING_ENERGY;
    max_energy = STARTING_ENERGY;
    // Substrate hook (fork addition): accumulates ONLY the increases to
    // starting/max energy that come from JtA's own starting-energy bonuses
    // (Energetic Memory, the EnergySpell perk, Divine Supremacy, Energized).
    // It parallels every bonus write to max_energy but is NOT touched by the
    // host energy pin (setEnergy) — so it reports JtA's native starting-energy
    // bonus to the shared loop-mana pool independent of whatever max_energy is
    // pinned to. Resets to 0 wherever max_energy resets to STARTING_ENERGY.
    jta_starting_energy_bonus = 0;
    energy_reset_count = 0;
    auto_use_cycle_counter = 0; // position within the auto-use cycle (Game Mod)

    power = 0;
    has_unlocked_power = false;

    attunement = 0;

    prestige_available = false;
    prestige_count = 0;
    highest_prestige_zone = 0;
    unlocked_new_prestige_this_prestige = false;
    divine_spark = 0;
    prestige_unlocks: PrestigeUnlockType[] = [];
    prestige_repeatables: Map<PrestigeRepeatableType, number> = new Map();
    prestige_layers_unlocked: PrestigeLayer[] = [];

    pending_render_events: RenderEvent[] = [];

    hint_prep_runs_done = 0;
    hint_non_prep_runs_done = 0; // Since unlocking prep runs
    hint_has_gotten_prep_run_hint = false;
    hint_has_gotten_boss_hint = false;

    // Game Mods (opt-in toggles; see GameMods above). mods_granted_amulet
    // tracks whether force_automation is what granted the Amulet perk, so
    // disabling the mod doesn't strip a legitimately earned one.
    mods: GameMods = defaultMods();
    mods_granted_amulet = false;
    mods_automation_panel_collapsed = true; // Advanced Automation panel UI state
    queue_list_collapsed = false;            // Queue Cycle list UI state

    public start() {
        // Managed sessions load from their own substrate save slot (see
        // getSaveLocation); a missing slot falls through to a fresh
        // initialize, same as standalone.
        if (!loadGame()) {
            this.initialize();
        }
    }

    public initialize() {
        // Skills must be initialized before resetTasks(): resetTasks() runs
        // updateEnabledTasks(), which evaluates task progress multipliers via
        // getSkill(). With the old order, GAMESTATE.skills was still empty at
        // that point, so every lookup logged "Couldn't find skill" (~32 errors
        // on a fresh start / every managed-mode boot). initializeSkills() has
        // no dependency on tasks, so it is safe to run first.
        initializeSkills();
        resetTasks();
        GAMESTATE.save_version = SAVE_VERSION;
        applyMods();
    }

    public popRenderEvents(): RenderEvent[] {
        const events = this.pending_render_events;
        this.pending_render_events = [];
        return events;
    }

    public queueRenderEvent(event: RenderEvent) {
        this.pending_render_events.push(event);
    }
}

function advanceZone() {
    const new_zone = GAMESTATE.current_zone + 1;

    if (GAMESTATE.current_zone > GAMESTATE.highest_zone_fully_completed 
        && GAMESTATE.tasks.every((task: Task) => { return isTaskFullyCompleted(task); })) {
        GAMESTATE.highest_zone_fully_completed = GAMESTATE.current_zone;
        GAMESTATE.highest_zone_fully_completed_ever = Math.max(GAMESTATE.highest_zone_fully_completed, GAMESTATE.highest_zone_fully_completed_ever);
        const context: HighestZoneContext = { zone: GAMESTATE.current_zone };
        const event = new RenderEvent(EventType.NewHighestZoneFullyCompleted, context);
        GAMESTATE.queueRenderEvent(event);
    }

    if (GAMESTATE.current_zone >= GAMESTATE.highest_zone) {
        GAMESTATE.highest_zone = new_zone;
        GAMESTATE.highest_zone_ever = Math.max(GAMESTATE.highest_zone, GAMESTATE.highest_zone_ever);
        GAMESTATE.resets_since_highest_zone_gain = 0; // progress! the stall trigger re-arms
        const context: HighestZoneContext = { zone: GAMESTATE.current_zone + 1 };
        const event = new RenderEvent(EventType.NewHighestZone, context);
        GAMESTATE.queueRenderEvent(event);
    }
    if (GAMESTATE.automation_mode == AutomationMode.Zone) {
        GAMESTATE.automation_mode = AutomationMode.Off;
    } else if (GAMESTATE.automation_mode == AutomationMode.All && (new_zone + 1) >= GAMESTATE.automation_end) {
        GAMESTATE.automation_mode = AutomationMode.Off;
    }
    
    // Happens after the highest zone stuff, since we do want the user to get those effects at the end of content
    if (new_zone >= ZONES.length) {
        GAMESTATE.is_at_end_of_content = true;
        return;
    }
    
    GAMESTATE.current_zone = new_zone;
    resetTasks();

    // Auto-Prioritize: (re)plan the zone just entered with current skills —
    // this also covers a newly reached zone that no reset has planned yet.
    maybeAutoPrioritizeZone(new_zone);
    doMasteryOfTimeTaskCompletion();
}

export function calcTickRate() {
    let tick_rate = DEFAULT_TICK_RATE;
    if (hasPrestigeUnlock(PrestigeUnlockType.DivineSpeed)) {
        const overflow = GAMESTATE.max_energy - STARTING_ENERGY;
        tick_rate /= 1 + overflow / DIVINE_SPEED_TICKS_PER_PERCENT / 100;
    }

    return tick_rate;
}

export function updateGamestate() {
    if (_edit_mode) {
        return; // frozen while editing priorities
    }
    if (GAMESTATE.is_in_energy_reset) {
        return;
    }

    updateActiveTask();
    autoUseItems();
    checkEnergyReset();

    // Track the peak spark-per-reset since the last prestige (cheap formula;
    // it can rise mid-run when a new highest zone is reached). Only while
    // prestige is actually AVAILABLE: the base gain exists on paper from run
    // one (100 / 1 run = an instant, meaningless peak of 100 — user-reported)
    // but it isn't claimable until the Prestige task is completed, so the
    // first real peak is gain / the resets it took to first reach it.
    if (GAMESTATE.prestige_available) {
        const spark_rate = calcSparkPerReset();
        if (spark_rate > GAMESTATE.peak_spark_per_reset) {
            GAMESTATE.peak_spark_per_reset = spark_rate;
        }
    }

    if (GAMESTATE.prestige_buy_queue.length > 0) {
        processPrestigeBuyQueue();
    }
    maybeAutoBuyCheapest();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setProgressMult = (new_mult: number) => task_progress_mult = new_mult;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).saveGame = () => saveGame();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).doEnergyReset = () => doEnergyReset();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).advanceZone = () => advanceZone();

// MARK: Instant Mode + Programmatic Control (for simulator / randomizer / substrate)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setInstantMode = (enabled: boolean) => {
    instant_mode = enabled;
    return instant_mode;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).isInstantMode = () => instant_mode;

// Manual tick advancement — useful when running without the interval timer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).stepTick = () => {
    updateGamestate();
    return {
        energy: GAMESTATE.current_energy,
        zone: GAMESTATE.current_zone,
        isInEnergyReset: GAMESTATE.is_in_energy_reset
    };
};

// Start a specific task by id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).performTask = (taskId: number) => {
    const task = GAMESTATE.tasks.find(t => t.task_definition.id === taskId);
    if (!task) {
        return { success: false, error: `Task ${taskId} not found in current zone` };
    }
    if (!task.enabled) {
        return { success: false, error: `Task ${taskId} is not enabled` };
    }
    if (task.reps >= task.task_definition.max_reps) {
        return { success: false, error: `Task ${taskId} is already completed` };
    }

    GAMESTATE.active_task = task;
    applyTaskRepStartEffects(task);
    return { success: true, taskName: task.task_definition.name };
};

// Serialized snapshot of the full game state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getFullState = () => {
    return {
        // Energy
        currentEnergy: GAMESTATE.current_energy,
        maxEnergy: GAMESTATE.max_energy,
        jtaStartingEnergyBonus: GAMESTATE.jta_starting_energy_bonus,
        isInEnergyReset: GAMESTATE.is_in_energy_reset,
        energyResetCount: GAMESTATE.energy_reset_count,

        // Zone
        currentZone: GAMESTATE.current_zone,
        highestZone: GAMESTATE.highest_zone,
        highestZoneFullyCompleted: GAMESTATE.highest_zone_fully_completed,

        // Skills (as array of {type, level, progress})
        skills: GAMESTATE.skills.map(s => ({
            type: s.type,
            level: s.level,
            progress: s.progress
        })),

        // Perks (active perk types)
        perks: Array.from(GAMESTATE.perks.entries())
            .filter(([, active]) => active)
            .map(([perkType]) => perkType),

        // Items (as array of {type, count})
        items: Array.from(GAMESTATE.items.entries())
            .filter(([, count]) => count > 0)
            .map(([itemType, count]) => ({ type: itemType, count })),

        // Tasks in current zone
        tasks: GAMESTATE.tasks.map(t => ({
            id: t.task_definition.id,
            name: t.task_definition.name,
            reps: t.reps,
            maxReps: t.task_definition.max_reps,
            progress: t.progress,
            enabled: t.enabled,
            completed: t.reps >= t.task_definition.max_reps
        })),

        // Active task (null when idle) — substrate bot drivers use this
        // to avoid re-issuing performTask (which re-applies rep-start
        // effects) while a task is already being worked.
        activeTaskId: GAMESTATE.active_task?.task_definition.id ?? null,

        // Extra stats
        power: GAMESTATE.power,
        attunement: GAMESTATE.attunement,

        // Prestige
        prestigeCount: GAMESTATE.prestige_count,
        divineSpark: GAMESTATE.divine_spark,
        prestigeAvailable: GAMESTATE.prestige_available
    };
};

// Use an item by type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).useItem = (itemType: number, useAll: boolean = false) => {
    const count = GAMESTATE.items.get(itemType) ?? 0;
    if (count <= 0) {
        return { success: false, error: `No items of type ${itemType}` };
    }
    clickItem(itemType as ItemType, useAll);
    return { success: true, used: useAll ? count : 1 };
};

// Schedule / unschedule using an artifact as a task in the current zone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).addArtifactTask = (itemType: number) => {
    const id = addArtifactTask(itemType as ItemType);
    RENDERING.createTasks();
    return { success: true, taskId: id };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).removeArtifactTask = (taskId: number) => {
    removeArtifactTask(taskId);
    RENDERING.createTasks();
    return { success: true };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getArtifactTasks = () => getArtifactTasks();

// Queue cycling management.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getQueueConfigs = () => ({ active: getActiveQueueIndex(), configs: getQueueConfigs() });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).autoFillPriorities = () => { autoFillAllPriorities(); RENDERING.createTasks(); return { success: true }; };
// Substrate playback hooks: the host bot drives the automation engine
// directly for the loaded zone, bypassing the Amulet gate — the gate is
// player progression; the bot is a driver, not the player. automation_mode
// is deliberately not persisted, so these are session-transient.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getAutomationMode = () => GAMESTATE.automation_mode;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setAutomationMode = (mode: AutomationMode) => {
    setAutomationMode(mode);
    return GAMESTATE.automation_mode;
};
// Fill the zone's automation priorities only when the player has none
// configured there (their own priorities/thresholds stay untouched).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).ensureZoneAutomationPriorities = (zone?: number) => {
    const z = typeof zone === "number" ? zone : GAMESTATE.current_zone;
    if (!GAMESTATE.automation_prios.get(z)?.length) {
        autoFillPriorities(z);
    }
    return GAMESTATE.automation_prios.get(z) ?? [];
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getPrestigeBuyQueue = () => GAMESTATE.prestige_buy_queue;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).resetPrestigeBuyQueue = () => { resetPrestigeBuyQueue(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getAutoFillOrder = () => getAutoFillOrder();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).moveAutoFillCategory = (category: string, delta: number) => { moveAutoFillCategory(category as AutoFillCategory, delta); RENDERING.createTasks(); return { success: true, order: getAutoFillOrder() }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).resetAutoFillOrder = () => { resetAutoFillOrder(); RENDERING.createTasks(); return { success: true, order: getAutoFillOrder() }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).addQueue = () => { const i = addQueue(); RENDERING.createTasks(); return { success: true, index: i }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).removeQueue = (index: number) => { removeQueue(index); RENDERING.createTasks(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setQueueAutoUseMode = (index: number, mode: AutoUseMode) => { setQueueAutoUseMode(index, mode); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).addQueueExcludedItem = (index: number, item: number) => { addQueueExcludedItem(index, item as ItemType); RENDERING.createTasks(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).removeQueueExcludedItem = (index: number, item: number) => { removeQueueExcludedItem(index, item as ItemType); RENDERING.createTasks(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setQueueRepeatCount = (index: number, value: number) => { setQueueRepeatCount(index, value); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setQueueName = (index: number, name: string) => { setQueueName(index, String(name)); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).moveQueue = (index: number, delta: number) => { moveQueue(index, delta); RENDERING.createTasks(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).advanceQueueCycle = () => { advanceQueueCycle(); RENDERING.createTasks(); return { success: true, active: getActiveQueueIndex() }; };

// Priority edit mode.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).enterEditMode = () => ({ success: enterEditMode() });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).exitEditMode = () => { exitEditMode(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setEditZone = (zone: number) => { setEditZone(zone); return { success: true, zone: GAMESTATE.current_zone }; };

// Available tasks in the current zone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getAvailableTasks = () => {
    return GAMESTATE.tasks
        .filter(t => t.enabled && t.reps < t.task_definition.max_reps)
        .map(t => ({
            id: t.task_definition.id,
            name: t.task_definition.name,
            type: t.task_definition.type,
            reps: t.reps,
            maxReps: t.task_definition.max_reps,
            costMult: t.task_definition.cost_multiplier,
            skills: t.task_definition.skills,
            perk: t.task_definition.perk,
            item: t.task_definition.item
        }));
};

// All zones' action definitions — the substrate action-queue catalog reads
// this so it can offer actions for every zone, not just the loaded one. It
// reads the live ZONES table, which synthetic data replaces wholesale
// (swapZoneTables), so it stays correct under any loaded dataset. Read-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getAllZoneActions = () => {
    return ZONES.map((zone, zoneId) => ({
        zone: zoneId,
        name: zone.name,
        tasks: zone.tasks.map(t => ({
            id: t.id,
            name: t.name,
            maxReps: t.max_reps,
            hidden: t.hidden_by_default === true,
        })),
    }));
};

// Ordered log of the actions performed during the PREVIOUS run (the run that
// ended at the last reset) — every task rep and item use, in sequence.
// Read-only; session-transient (empty until the first reset, and after a
// reload). Returns a shallow copy so callers can't mutate the log.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getPreviousRunActions = () => _previous_run_actions.map(a => ({ ...a }));

// The same log for the CURRENT (in-progress) run, for live inspection.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).getCurrentRunActions = () => _current_run_actions.map(a => ({ ...a }));

// Set energy directly (for testing / substrate sync).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setEnergy = (current: number, max?: number) => {
    GAMESTATE.current_energy = current;
    if (max !== undefined) {
        GAMESTATE.max_energy = max;
    }
    return { current: GAMESTATE.current_energy, max: GAMESTATE.max_energy };
};

// MARK: Substrate Hooks (host-driven persistence, transitions, events)

// Managed mode — when on, host owns persistence + ticking + transitions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setManagedMode = (enabled: boolean) => {
    _managed_mode = !!enabled;
    // Layout hook: managed sessions run in a panel-sized iframe, not a
    // full browser viewport — style.css scopes substrate-friendly
    // overrides (e.g. the fixed 900px top bar) to html.managed-mode.
    if (typeof document !== "undefined" && document.documentElement?.classList) {
        document.documentElement.classList.toggle("managed-mode", _managed_mode);
    }
    return _managed_mode;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).isManagedMode = () => _managed_mode;

// Register a callback fired when a TaskType.Travel task fully completes.
// In managed mode this REPLACES the automatic advanceZone; in non-managed
// mode it fires in addition to advanceZone. Pass null to clear.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setTravelTaskCallback = (fn: ((zone: number, task: { id: number, name: string }) => void) | null) => {
    _travel_task_callback = fn;
};

// Register a callback fired at the end of doEnergyReset (jta's own
// game-over). Pass null to clear.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setEnergyResetCallback = (fn: ((state: { currentEnergy: number, maxEnergy: number, energyResetCount: number }) => void) | null) => {
    _energy_reset_callback = fn;
};

// Load a specific zone by id, optionally in already-completed state.
// completed:true marks all tasks reps = max_reps WITHOUT re-applying
// finish effects (perks / items / power / events) — the player already
// got those on first traversal; this is for the substrate "re-entry"
// case where the zone shows only exit-choice tasks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// Whether the currently loaded zone's tasks were pre-completed by the
// host (loadZone options.completed) — such tasks must not earn the
// "fully completed the zone" credit when the host loads the next zone.
let _zone_loaded_pre_completed = false;

(window as any).loadZone = (zoneId: number, options: { completed?: boolean } = {}) => {
    if (zoneId < 0 || zoneId >= ZONES.length) {
        return { success: false, error: `Invalid zone ${zoneId} (have ${ZONES.length} zones)` };
    }
    // Managed zone transitions must do the same bookkeeping advanceZone
    // does — without it highest_zone stays 0 forever under the substrate
    // host, which breaks Auto-Prioritize coverage (auto-fill plans zones
    // 0..highest_zone), Reflections on the Journey, Divine Spark gain,
    // and the Auto-Prestige stall trigger.
    const prevZone = GAMESTATE.current_zone;
    if (zoneId !== prevZone) {
        // Leaving-zone credit, mirroring advanceZone — but only when the
        // player actually played the old zone (not a host pre-completed
        // re-entry).
        if (!_zone_loaded_pre_completed
            && prevZone > GAMESTATE.highest_zone_fully_completed
            && GAMESTATE.tasks.length > 0
            && GAMESTATE.tasks.every((task: Task) => isTaskFullyCompleted(task))) {
            GAMESTATE.highest_zone_fully_completed = prevZone;
            GAMESTATE.highest_zone_fully_completed_ever = Math.max(GAMESTATE.highest_zone_fully_completed, GAMESTATE.highest_zone_fully_completed_ever);
            const context: HighestZoneContext = { zone: prevZone };
            GAMESTATE.queueRenderEvent(new RenderEvent(EventType.NewHighestZoneFullyCompleted, context));
        }
        // Same automation-mode transitions advanceZone applies.
        if (GAMESTATE.automation_mode == AutomationMode.Zone) {
            GAMESTATE.automation_mode = AutomationMode.Off;
        } else if (GAMESTATE.automation_mode == AutomationMode.All && (zoneId + 1) >= GAMESTATE.automation_end) {
            GAMESTATE.automation_mode = AutomationMode.Off;
        }
    }

    GAMESTATE.current_zone = zoneId;
    if (zoneId > GAMESTATE.highest_zone) {
        GAMESTATE.highest_zone = zoneId;
        GAMESTATE.highest_zone_ever = Math.max(GAMESTATE.highest_zone, GAMESTATE.highest_zone_ever);
        GAMESTATE.resets_since_highest_zone_gain = 0; // progress! the stall trigger re-arms
        const context: HighestZoneContext = { zone: zoneId };
        GAMESTATE.queueRenderEvent(new RenderEvent(EventType.NewHighestZone, context));
    }
    resetTasks();
    _zone_loaded_pre_completed = !!options.completed;
    if (options.completed) {
        for (const task of GAMESTATE.tasks) {
            task.reps = task.task_definition.max_reps;
            task.progress = 0;
        }
        updateEnabledTasks();
    }
    // Auto-Prioritize: (re)plan the zone just entered with current
    // skills — same hook advanceZone fires. Harmless for pre-completed
    // re-entries (nothing runnable to prioritize).
    maybeAutoPrioritizeZone(zoneId);
    doMasteryOfTimeTaskCompletion();
    // resetTasks() creates fresh Task instances. The existing task DOM
    // has click handlers closed over the previous Task instances, so
    // we rebuild it here. RENDERING.createTasks() bails harmlessly if
    // the DOM isn't ready yet (loadZone fired before DOMContentLoaded).
    RENDERING.createTasks();
    return { success: true, zone: GAMESTATE.current_zone, taskCount: GAMESTATE.tasks.length };
};

// Inject a synthetic task into the current zone (e.g. an exit-choice
// task). onComplete fires when the task is fully done (one-shot — the
// callback is dropped after firing). Synthetic task ids should be well
// above the upstream task-id range (≥ 10000) to avoid collisions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).injectSyntheticTask = (spec: { id: number, name: string, costMultiplier?: number, maxReps?: number, free?: boolean, skills?: SkillType[] }, onComplete: () => void) => {
    if (typeof spec?.id !== 'number' || typeof spec?.name !== 'string') {
        return { success: false, error: 'spec.id (number) and spec.name (string) are required' };
    }
    if (_synthetic_task_callbacks.has(spec.id)) {
        return { success: false, error: `Synthetic task ${spec.id} already injected` };
    }
    const def = new TaskDefinition({
        id: spec.id,
        name: spec.name,
        type: TaskType.Normal,
        cost_multiplier: spec.costMultiplier ?? 0,
        skills: spec.skills ?? [],
        max_reps: spec.maxReps ?? 1,
        zone_id: GAMESTATE.current_zone,
        free: spec.free ?? false,
    });
    const t = new Task(def);
    t.enabled = true;
    GAMESTATE.tasks.push(t);
    // Create the DOM for the synthetic task right away — otherwise the
    // next updateTaskRendering tick crashes on a missing task_element.
    RENDERING.appendTask(t);
    _synthetic_task_callbacks.set(spec.id, onComplete);
    return { success: true, id: spec.id };
};

// Remove all injected synthetic tasks. Use when leaving a region (the
// host clears synthetic exit tasks before loading the next zone).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).clearSyntheticTasks = () => {
    const removed = _synthetic_task_callbacks.size;
    GAMESTATE.tasks = GAMESTATE.tasks.filter(t => !_synthetic_task_callbacks.has(t.task_definition.id));
    _synthetic_task_callbacks.clear();
    return { removed };
};

// MARK: Archipelago substrate Tier-1 data/grant hooks
//
// Additive, save-neutral (SAVE_VERSION untouched) runtime hooks the AP
// zone-randomization arc uses. All dormant in standalone play — the
// standalone game never calls them.

// Register the general task-completion callback (see
// _task_completion_callback). Pass null to clear.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setTaskCompletionCallback = (fn: typeof _task_completion_callback) => {
    _task_completion_callback = fn;
};

// Set the Pass-B cost-assignment allowlist (see _costed_task_ids). Accepts an
// array or Set of task ids (copied into a fresh Set for O(1) lookup) or null to
// clear. Dormant in standalone play — the standalone game never calls it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setCostedTaskIds = (ids: number[] | Set<number> | null) => {
    _costed_task_ids = ids === null ? null : new Set(ids);
};

// Register the Pass-B first-start cost callback (see
// _task_first_start_callback). Pass null to clear. Dormant in standalone play.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setTaskFirstStartCallback = (fn: typeof _task_first_start_callback) => {
    _task_first_start_callback = fn;
};

// Tasks the automation must categorize as unearned-perk tasks despite a
// suppressed `perk` field (see _perk_category_task_ids). Accepts an array or
// Set of task ids (copied into a fresh Set) or null to clear. The host retires
// an id once its AP location is checked, so a completed perk task stops being
// prioritized every run. Dormant in standalone play.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).setPerkCategoryTaskIds = (ids: number[] | Set<number> | null) => {
    _perk_category_task_ids = ids === null ? null : new Set(ids);
};

// Grant a perk from outside a task completion — the path an AP-delivered
// perk item takes when local grants are suppressed (by patching the
// granting task's `perk` field to PerkType.Count via applyTaskPatches).
// Accepts a PerkType number or a perk display name (matched against
// PERKS[].name). Persistence-safe: the perk lands in GAMESTATE.perks,
// which the save blob serializes, so an AP-granted perk survives
// save/load even though its task was never completed. Idempotent — a
// perk already held is a no-op. Returns {success, perk?, alreadyHad?,
// error?}.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).grantPerk = (perk: PerkType | string) => {
    let type: PerkType | undefined;
    if (typeof perk === 'number') {
        type = perk;
    } else if (typeof perk === 'string') {
        const match = PERKS.find((p) => p.name === perk);
        type = match?.enum;
    }
    if (type === undefined || type === PerkType.Count
            || type < 0 || type >= PerkType.Count) {
        return { success: false, error: `Unknown perk: ${JSON.stringify(perk)}` };
    }
    if (hasPerk(type)) {
        return { success: true, perk: type, alreadyHad: true };
    }
    tryAddPerk(type);
    return { success: true, perk: type, alreadyHad: false };
};

// Field-level patch of existing zone task definitions, by task id. The
// Tier-1 delivery mechanism for the randomizer/balancer: cost/xp/max_reps
// costing patches and perk/item re-assignment ride each region's sidecar
// payload and get applied here at load time. Idempotent (sets fields to
// values) and NOT part of the save blob — the host re-applies on every
// load. Mutates the static TaskDefinition objects in place, which every
// live Task references via task_definition, so effects are immediate.
//
// Supported fields (unknown keys are ignored, unknown ids skipped and
// reported): cost_multiplier, xp_mult, max_reps, hidden_by_default,
// unlocks_task, perk, item. Perk/item accept a number (enum) or a
// display name. When any patch touches perk/item, the derived
// perk/item reference lists are rebuilt so the reference panels stay
// coherent.
//
// `patches` is either an array of `{ id, ...fields }` or a map
// `{ [id]: { ...fields } }`. Returns { applied, skipped }.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).applyTaskPatches = (patches: any) => {
    const list: Array<{ id: number, fields: any }> = [];
    if (Array.isArray(patches)) {
        for (const p of patches) {
            if (p && typeof p.id === 'number') {
                const { id, ...fields } = p;
                list.push({ id, fields });
            }
        }
    } else if (patches && typeof patches === 'object') {
        for (const [key, fields] of Object.entries(patches)) {
            list.push({ id: Number(key), fields });
        }
    }

    const resolvePerk = (v: unknown): PerkType | undefined => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return PERKS.find((p) => p.name === v)?.enum;
        return undefined;
    };
    const resolveItem = (v: unknown): ItemType | undefined => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') return ITEMS.find((i) => i.name === v)?.enum;
        return undefined;
    };

    const applied: number[] = [];
    const skipped: number[] = [];
    let touchedPerkOrItem = false;
    for (const { id, fields } of list) {
        const def = TASK_LOOKUP.get(id);
        if (!def || !fields || typeof fields !== 'object') {
            skipped.push(id);
            continue;
        }
        if (typeof fields.cost_multiplier === 'number') def.cost_multiplier = fields.cost_multiplier;
        if (typeof fields.xp_mult === 'number') def.xp_mult = fields.xp_mult;
        if (typeof fields.max_reps === 'number') def.max_reps = fields.max_reps;
        if (typeof fields.hidden_by_default === 'boolean') def.hidden_by_default = fields.hidden_by_default;
        if (typeof fields.unlocks_task === 'number') def.unlocks_task = fields.unlocks_task;
        if ('perk' in fields) {
            const pk = resolvePerk(fields.perk);
            if (pk !== undefined) { def.perk = pk; touchedPerkOrItem = true; }
        }
        if ('item' in fields) {
            const it = resolveItem(fields.item);
            if (it !== undefined) { def.item = it; touchedPerkOrItem = true; }
        }
        applied.push(id);
    }
    if (touchedPerkOrItem) rebuildZoneDerivedMaps();
    return { applied, skipped };
};
