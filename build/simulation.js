import { Task, ZONES, TaskType, TASK_LOOKUP, TaskDefinition } from "./zones.js";
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
let _travel_task_callback = null;
// Fires when doEnergyReset() finishes.
let _energy_reset_callback = null;
// Synthetic-task injection: per-task callbacks fired when the synthetic
// task is fully completed. Keyed by task id (use ids well above the
// normal task-id range to avoid collisions — exit-choice tasks use
// ids in the 10000+ range by convention).
const _synthetic_task_callbacks = new Map();
export function isManagedMode() {
    return _managed_mode;
}
const ZONE_SPEEDUP_BASE = 1.05;
export const BOSS_MAX_ENERGY_DISPARITY = 5;
const STARTING_ENERGY = 100;
const DEFAULT_TICK_RATE = 66.6;
export const SAVE_VERSION = "1.6.0";
const TASK_STARTED_PROGRESS = 0.01;
// Player-scheduled "use this artifact here" tasks get ids in this range — well
// above zone task ids and the host's synthetic exit tasks (>= 10000) — so they
// can never collide and are easy to recognise.
const ARTIFACT_TASK_ID_BASE = 1_000_000;
// MARK: Skills
export class Skill {
    type = SkillType.Count;
    level = 0;
    progress = 0;
    speed_modifier = 1;
    constructor(type, level) {
        this.type = type;
        this.level = level;
    }
}
export function calcSkillXp(task, task_progress, ignore_boost = false) {
    const xp_mult = 8;
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
    if (hasPrestigeUnlock(PrestigeUnlockType.UnparalleledLearning)) {
        xp *= FINAL_PRESTIGE_MULT;
    }
    xp *= Math.pow(1.25, task.task_definition.zone_id);
    if (!ignore_boost && task.xp_boosted) {
        xp *= MAGIC_RING_MULT;
    }
    return xp;
}
export function calcSkillXpNeeded(skill) {
    return calcSkillXpNeededAtLevel(skill.level, skill.type);
}
export function calcSkillXpNeededAtLevel(level, skill_type) {
    const exponent_base = 1.02;
    const base_amount = 10;
    const skill_modifier = SKILL_DEFINITIONS[skill_type].xp_needed_mult;
    return Math.pow(exponent_base, level) * base_amount * skill_modifier;
}
function addSkillXp(skill, xp) {
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
        const context = { skill: skill_entry.type, new_level: skill_entry.level, levels_gained: skill_entry.level - old_level };
        const event = new RenderEvent(EventType.SkillUp, context);
        GAMESTATE.queueRenderEvent(event);
    }
}
function removeTemporarySkillBonuses() {
    for (const skill of GAMESTATE.skills.values()) {
        skill.speed_modifier = 1;
    }
}
export function calcSkillTaskProgressMultiplierFromLevel(level) {
    const exponent = 1.01;
    return Math.pow(exponent, level);
}
export function calcSkillTaskProgressWithoutLevel(skill_type) {
    let mult = 1;
    const skill = getSkill(skill_type);
    mult *= skill.speed_modifier;
    for (const [perk_type, active] of GAMESTATE.perks) {
        if (!active) {
            continue;
        }
        const perk = PERKS[perk_type];
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
    if (skill_type == SkillType.Travel && hasPrestigeUnlock(PrestigeUnlockType.GodlyTravel)) {
        mult *= GODLY_TRAVEL_MULT;
    }
    return mult;
}
export function calcSkillTaskProgressMultiplier(skill_type) {
    const skill = getSkill(skill_type);
    let mult = calcSkillTaskProgressWithoutLevel(skill_type);
    mult *= calcSkillTaskProgressMultiplierFromLevel(skill.level);
    return mult;
}
export function getSkill(skill) {
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
        const target_level = skill == SkillType.Ascension ? global_target_level / 2 : global_target_level;
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
export function calcTaskCost(task) {
    const base_cost = 10;
    const normal_exponent = 2.2;
    const boss_exponent = 4;
    const zone_exponent = task.task_definition.type == TaskType.Boss ? boss_exponent : normal_exponent;
    const zone_mult = Math.pow(zone_exponent, task.task_definition.zone_id);
    return base_cost * task.task_definition.cost_multiplier * zone_mult;
}
export function calcTaskProgressMultiplier(task, override_haste = null, override_lightning = null) {
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
    mult *= Math.pow(ZONE_SPEEDUP_BASE, task.task_definition.zone_id);
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
function calcTaskProgressPerTick(task) {
    return calcTaskProgressMultiplier(task);
}
export function calcTaskTicks(progress_per_tick, cost) {
    return Math.ceil(cost / progress_per_tick);
}
function calcTaskEnergyCost(task, hasted, lightning) {
    const progress_per_tick = calcTaskProgressMultiplier(task, hasted, lightning);
    const cost = calcTaskCost(task);
    const energy_per_tick = calcEnergyDrainPerTick(task, isSingleTickTaskImpl(progress_per_tick, cost));
    const ticks = calcTaskTicks(progress_per_tick, cost);
    return ticks * energy_per_tick;
}
function isSingleTickTaskImpl(progress, cost) {
    return (progress + TASK_STARTED_PROGRESS) >= cost;
}
function isSingleTickTask(task) {
    const progress = calcTaskProgressPerTick(task);
    const cost = calcTaskCost(task);
    return isSingleTickTaskImpl(progress, cost);
}
export function willCompleteAllRepsInOneTick(task) {
    if (!hasPerk(PerkType.MajorTimeCompression)) {
        return false;
    }
    return isSingleTickTask(task);
}
function progressTask(task, progress, consume_energy = true) {
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
    }
    else {
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
function completeTaskInstantly(task) {
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
    // Instant mode: complete the entire task in one tick.
    if (instant_mode) {
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
    }
    else if (!fully_finished) {
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
function maybeAutoUseHaste(task) {
    if (!GAMESTATE.mods.auto_haste) {
        return;
    }
    // Only when item auto-use is currently enabled — so under an Auto Use Cycle
    // it fires only on the "on" runs — during automation, and never stacking on
    // top of an already-queued Scroll.
    if (!GAMESTATE.auto_use_items || GAMESTATE.automation_mode == AutomationMode.Off || GAMESTATE.queued_scrolls_of_haste > 0) {
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
// Note that free executions don't call this
export function applyTaskRepStartEffects(task) {
    maybeAutoUseHaste(task);
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
    if (task.task_definition.use_item != ItemType.Count) {
        consumeItem(task.task_definition.use_item, 1);
    }
    task.progress = Math.max(task.progress, TASK_STARTED_PROGRESS); // Slight progress to ensure it counts as started
}
export function clickTask(task) {
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
function onFullyFinishTask(task) {
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
}
function doAllTaskRepsForFree(task) {
    const consume_energy = false;
    while (task.reps < task.task_definition.max_reps) {
        progressTask(task, calcTaskCost(task), consume_energy);
        // Deliberately doesn't call applyTaskRepStartEffects, we get to skip those
    }
}
function applyFinishTaskRepEffects(task) {
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
}
export function isTaskDisabledDueToTooStrongBoss(task) {
    if (task.progress > 0) {
        return false;
    }
    if (task.task_definition.type != TaskType.Boss) {
        return false;
    }
    const lightning = GAMESTATE.queued_lightning > 0 && task.task_definition.type == TaskType.Boss;
    return calcTaskEnergyCost(task, GAMESTATE.queued_scrolls_of_haste > 0, lightning) > (GAMESTATE.current_energy * BOSS_MAX_ENERGY_DISPARITY);
}
export function isTaskDisabledDueToMissingItem(task) {
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
export function isTaskDisabledWithoutBeingFinished(task) {
    if (isTaskDisabledDueToTooStrongBoss(task)) {
        return true;
    }
    if (isTaskDisabledDueToMissingItem(task)) {
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
                        const context = { skill: skill };
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
function taskUnlocksTask(task) {
    return task.task_definition.unlocks_task >= 0 && !GAMESTATE.unlocked_tasks.includes(task.task_definition.unlocks_task);
}
function unlockTask(task_id) {
    if (GAMESTATE.unlocked_tasks.includes(task_id)) {
        return;
    }
    const task = TASK_LOOKUP.get(task_id);
    GAMESTATE.unlocked_tasks.push(task_id);
    if (GAMESTATE.current_zone == task.zone_id) {
        GAMESTATE.tasks.push(new Task(task));
        const context = { task_definition: task };
        const event = new RenderEvent(EventType.UnlockedTask, context);
        GAMESTATE.queueRenderEvent(event);
    }
}
function isTaskFullyCompleted(task) {
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
        const context = { tasks: num_complete };
        const event = new RenderEvent(EventType.SkippedTasks, context);
        GAMESTATE.queueRenderEvent(event);
    }
    GAMESTATE.queued_scrolls_of_haste = old_queued_haste;
    GAMESTATE.queued_magic_rings = old_queued_rings;
    GAMESTATE.queued_lightning = old_queued_lightning;
}
// MARK: Energy
function modifyEnergy(delta) {
    GAMESTATE.current_energy += delta;
}
function modifyMaxEnergy(delta) {
    GAMESTATE.max_energy += delta;
    setTickRate();
}
export function calcReflectionsOnTheJourneyMult(zone) {
    const zone_diff = GAMESTATE.highest_zone - zone;
    const base = getReflectionsOnTheJourneyExponent();
    return Math.pow(base, zone_diff);
}
export function calcEnergyDrainPerTickInZone(zone) {
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
    drain *= Math.pow(ZONE_SPEEDUP_BASE, zone);
    return drain;
}
export function calcEnergyDrainPerTick(task, is_single_tick) {
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
    const off_resets = Math.max(0, Math.floor(GAMESTATE.mods.auto_use_cycle_off_resets));
    if (GAMESTATE.auto_use_cycle_counter >= off_resets) {
        GAMESTATE.auto_use_items = true;
        GAMESTATE.auto_use_cycle_counter = 0;
    }
    else {
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
    // Advance the per-reset cycle (queue swap or auto-use cycle) before
    // doAnyReset rebuilds the zone, so the newly-active queue's priorities and
    // artifact tasks are the ones injected.
    applyResetCycle();
    doAnyReset(); // Gotta be after the current_zone check in calcEnergeticMemoryGain
    if (resume_automation) {
        GAMESTATE.automation_mode = saved_automation_mode;
    }
    GAMESTATE.energy_reset_count += 1;
    handleEnergyResetItemCounts();
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
export function calcItemEnergyGain(base_energy) {
    let value = base_energy;
    value *= (1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.DivineAppetite) * DIVINE_APPETITE_ENERGY_ITEM_BOOST_MULT);
    if (hasPerk(PerkType.SupplyLines)) {
        value *= 1 + SUPPLY_LINES_EFFECT;
    }
    return Math.floor(value);
}
// MARK: Items
export function addItem(item, count) {
    const oldValue = GAMESTATE.items.get(item) ?? 0;
    GAMESTATE.items.set(item, oldValue + count);
    if (!GAMESTATE.items_found_this_energy_reset.includes(item)) {
        GAMESTATE.items_found_this_energy_reset.push(item);
    }
    const event = new RenderEvent(EventType.GainedItem, {});
    GAMESTATE.queueRenderEvent(event);
}
function consumeItem(item, amount) {
    const old_value = GAMESTATE.items.get(item) ?? 0;
    GAMESTATE.items.set(item, old_value - amount);
}
function useItem(item, amount) {
    consumeItem(item, amount);
    const old_use_value = GAMESTATE.used_items.get(item) ?? 0;
    const definition = ITEMS[item];
    definition.applyEffects(amount);
    GAMESTATE.used_items.set(item, old_use_value + amount);
    const context = { item: item, count: Math.abs(amount) };
    const event = new RenderEvent(amount > 0 ? EventType.UsedItem : EventType.UndidItem, context);
    GAMESTATE.queueRenderEvent(event);
    // Can't undo after the item's started having an effect
    if (GAMESTATE.active_task == null && amount > 0) {
        GAMESTATE.undo_item = [item, amount];
    }
    updateEnabledTasks();
}
export function clickItem(item, use_all) {
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
export function calcItemsKeptOnEnergyReset(item, value) {
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
let _last_source_zone = null;
function lastSourceZone(item) {
    if (_last_source_zone == null) {
        const map = new Map();
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
function canStillGainItemThisReset(item) {
    for (const task of GAMESTATE.tasks) {
        if (task.task_definition.item == item && task.reps < task.task_definition.max_reps) {
            return true;
        }
    }
    return lastSourceZone(item) > GAMESTATE.current_zone;
}
// How many copies of an Item can be used right now without changing how many
// would be kept on the next Energy Reset — the "rounding-error" surplus.
function calcFreeToUseItems(item) {
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
function maybeUseRoundingErrorItem(item) {
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
export function isArtifactTaskId(id) {
    return id >= ARTIFACT_TASK_ID_BASE;
}
function getArtifactTaskSpec(id) {
    return GAMESTATE.artifact_tasks.find(spec => spec.task_id == id);
}
function makeArtifactTask(spec) {
    const item_def = ITEMS[spec.item];
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
export function addArtifactTask(item) {
    const spec = {
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
export function removeArtifactTask(task_id) {
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
export function getArtifactTasks() {
    return GAMESTATE.artifact_tasks;
}
// Clear the per-cycle "fired" flags. Called from doAnyReset.
function resetArtifactTaskCycleState() {
    for (const spec of GAMESTATE.artifact_tasks) {
        spec.done = false;
    }
}
function cloneArtifactSpecs(specs) {
    return specs.map(s => ({ ...s }));
}
function clonePrioEntries(entries) {
    return entries.map(([zone, ids]) => [zone, [...ids]]);
}
function activeQueue() {
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
    queue.prios = clonePrioEntries(Array.from(GAMESTATE.automation_prios.entries()));
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
    GAMESTATE.auto_use_items = queue.auto_use_items;
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
            prios: clonePrioEntries(Array.from(GAMESTATE.automation_prios.entries())),
            artifact_tasks: cloneArtifactSpecs(GAMESTATE.artifact_tasks),
            auto_use_items: GAMESTATE.auto_use_items,
            repeat_count: 1,
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
    const repeat = Math.max(1, Math.floor(current?.repeat_count ?? 1));
    if (GAMESTATE.queue_runs_on_current >= repeat) {
        GAMESTATE.active_queue_index = (GAMESTATE.active_queue_index + 1) % GAMESTATE.queue_configs.length;
        GAMESTATE.queue_runs_on_current = 0;
    }
    loadActiveQueue();
}
// Restart the cycle at the first queue (called on prestige).
function resetQueueCycleForPrestige() {
    if (!GAMESTATE.mods.queue_cycle || GAMESTATE.queue_configs.length == 0) {
        return;
    }
    saveActiveQueue();
    GAMESTATE.active_queue_index = 0;
    GAMESTATE.queue_runs_on_current = 0;
    loadActiveQueue();
}
// Per-reset cycle hook: queue cycling and the auto-use cycle are mutually
// exclusive, so at most one runs.
function applyResetCycle() {
    if (GAMESTATE.mods.queue_cycle) {
        applyQueueCycle();
    }
    else if (GAMESTATE.mods.auto_use_cycle) {
        applyAutoUseCycle();
    }
}
// --- Queue editing API (used by the UI and the window bridge) ---
export function getQueueConfigs() {
    return GAMESTATE.queue_configs;
}
export function getActiveQueueIndex() {
    return GAMESTATE.active_queue_index;
}
// Make a queue active so its plan can be viewed/edited. The cycle then
// continues advancing from this queue.
export function setActiveQueue(index) {
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
export function getQueueRunsOnCurrent() {
    return GAMESTATE.queue_runs_on_current;
}
// Save the current plan as a new queue at the end of the cycle.
export function addQueue() {
    GAMESTATE.queue_configs.push({
        prios: clonePrioEntries(Array.from(GAMESTATE.automation_prios.entries())),
        artifact_tasks: cloneArtifactSpecs(GAMESTATE.artifact_tasks),
        auto_use_items: GAMESTATE.auto_use_items,
        repeat_count: 1,
    });
    saveGame();
    return GAMESTATE.queue_configs.length - 1;
}
export function removeQueue(index) {
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
    }
    else if (GAMESTATE.mods.queue_cycle && index == GAMESTATE.active_queue_index) {
        loadActiveQueue();
    }
    saveGame();
}
export function setQueueItemCycle(index, value) {
    const queue = GAMESTATE.queue_configs[index];
    if (!queue) {
        return;
    }
    queue.auto_use_items = value;
    // If editing the running queue, take effect now.
    if (GAMESTATE.mods.queue_cycle && index == GAMESTATE.active_queue_index) {
        GAMESTATE.auto_use_items = value;
    }
    saveGame();
}
export function setQueueRepeatCount(index, value) {
    const queue = GAMESTATE.queue_configs[index];
    if (!queue) {
        return;
    }
    queue.repeat_count = Math.max(1, Math.floor(value));
    saveGame();
}
// Move a queue earlier/later in the cycle order, keeping the active queue selected.
export function moveQueue(index, delta) {
    const target = index + delta;
    if (index < 0 || index >= GAMESTATE.queue_configs.length
        || target < 0 || target >= GAMESTATE.queue_configs.length) {
        return;
    }
    const active = GAMESTATE.queue_configs[GAMESTATE.active_queue_index];
    const [moved] = GAMESTATE.queue_configs.splice(index, 1);
    GAMESTATE.queue_configs.splice(target, 0, moved);
    const new_active = GAMESTATE.queue_configs.indexOf(active);
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
let _edit_saved_tasks = [];
export function isEditMode() {
    return _edit_mode;
}
export function getEditMaxZone() {
    return Math.min(GAMESTATE.highest_zone_ever, ZONES.length - 1);
}
// Enter edit mode. Refused (returns false) while a Task is running.
export function enterEditMode() {
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
export function setEditZone(zone) {
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
export function gatherItemBonuses(skill) {
    const ret = [];
    for (const [item_type, amount] of GAMESTATE.used_items) {
        const item = ITEMS[item_type];
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
    }
    else {
        GAMESTATE.hint_non_prep_runs_done++;
    }
}
export function setHasGottenPrepRunHint() {
    GAMESTATE.hint_has_gotten_prep_run_hint = true;
}
export function setHasGottenBossHint() {
    GAMESTATE.hint_has_gotten_boss_hint = true;
}
export function knowsItem(item) {
    return GAMESTATE.items.get(item) != null;
}
// MARK: Perks
function tryAddPerk(perk, show_notification = true) {
    if (hasPerk(perk)) {
        return;
    }
    if (perk == PerkType.EnergySpell) {
        modifyMaxEnergy(50);
    }
    GAMESTATE.perks.set(perk, true);
    if (show_notification) {
        const context = { perk: perk };
        const event = new RenderEvent(EventType.GainedPerk, context);
        GAMESTATE.queueRenderEvent(event);
    }
}
export function hasPerk(perk) {
    return GAMESTATE.perks.get(perk) == true;
}
export function knowsPerk(perk) {
    return GAMESTATE.perks.get(perk) != null;
}
function skipCurrentZoneIfFree() {
    if (!GAMESTATE.tasks.every(task => {
        // Unlocking stuff the player needs to deal with themselves
        return !taskUnlocksTask(task) && isSingleTickTask(task);
    })) {
        return false;
    }
    // In reverse so travel happens last
    for (const task of GAMESTATE.tasks.slice().reverse()) {
        doAllTaskRepsForFree(task);
    }
    return true;
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
export function gatherPerkBonuses(skill) {
    const ret = [];
    for (const [perk_type, active] of GAMESTATE.perks) {
        const perk = PERKS[perk_type];
        if (!active || !perk.skill_modifiers.affectsSkill(skill)) {
            continue;
        }
        ret.push(perk_type);
    }
    return ret;
}
// MARK: Extra stats
function addPower(amount) {
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
export function calcPowerGain(task) {
    if (task.task_definition.type != TaskType.Boss) {
        return 0;
    }
    const mult = Math.max(task.task_definition.zone_id - 1, 1); // First boss is zone 3, which is internally 2
    let powerAmount = 5 * mult;
    powerAmount *= Math.pow(2, getPrestigeRepeatableLevel(PrestigeRepeatableType.UnlimitedPower));
    if (hasPrestigeUnlock(PrestigeUnlockType.LimitlessPower)) {
        powerAmount *= FINAL_PRESTIGE_MULT;
    }
    return powerAmount;
}
export function calcPowerSpeedBonusAtLevel(level) {
    return 1 + level / 100;
}
export function calcAttunementSpeedBonusAtLevel(level) {
    return 1 + level / 1000;
}
export function calcSpiteTheGodsBonus() {
    return 1 + getPrestigeRepeatableLevel(PrestigeRepeatableType.SpiteTheGods) * SPITE_THE_GODS_MULT;
}
function addAttunement(amount) {
    GAMESTATE.attunement += amount;
}
export function calcAttunementGain(task) {
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
    if (hasPrestigeUnlock(PrestigeUnlockType.LimitlessPower)) {
        value *= FINAL_PRESTIGE_MULT;
    }
    value *= Math.pow(DIVINE_ATTUNEMENT_BASE, getPrestigeRepeatableLevel(PrestigeRepeatableType.DivineAttunement));
    return value;
}
export function calcAttunementSkills() {
    const attunement_skills = [SkillType.Magic, SkillType.Study];
    if (hasPrestigeUnlock(PrestigeUnlockType.FullyAttuned)) {
        attunement_skills.push(SkillType.Search);
    }
    if (hasPrestigeUnlock(PrestigeUnlockType.CraftingBreakthrough)) {
        attunement_skills.push(SkillType.Crafting);
    }
    return attunement_skills;
}
export function getPowerSkills() {
    return [SkillType.Combat, SkillType.Fortitude];
}
export function getSpiteTheGodsSkills() {
    return [SkillType.Ascension, SkillType.Charisma];
}
// MARK: Automation
export var AutomationMode;
(function (AutomationMode) {
    AutomationMode[AutomationMode["All"] = 0] = "All";
    AutomationMode[AutomationMode["Zone"] = 1] = "Zone";
    AutomationMode[AutomationMode["Off"] = 2] = "Off";
})(AutomationMode || (AutomationMode = {}));
function hasAutomatedTask(task) {
    if (!GAMESTATE.automation_prios.has(task.zone_id)) {
        return false;
    }
    const prios = GAMESTATE.automation_prios.get(task.zone_id);
    return prios.includes(task.id);
}
export function toggleAutomation(task) {
    if (!hasPerk(PerkType.Amulet) && !hasAutomatedTask(task)) {
        return;
    }
    if (!GAMESTATE.automation_prios.has(task.zone_id)) {
        GAMESTATE.automation_prios.set(task.zone_id, []);
    }
    const prios = GAMESTATE.automation_prios.get(task.zone_id);
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
function pickNextTaskInAutomationQueue() {
    if (GAMESTATE.automation_mode == AutomationMode.Off) {
        return null;
    }
    const prios = GAMESTATE.automation_prios.get(GAMESTATE.current_zone);
    if (!prios) {
        return null;
    }
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
            return task;
        }
    }
    return null;
}
export function setAutomationMode(mode) {
    // If the player turns off automation they probably want to stop the ongoing task
    if (GAMESTATE.automation_mode != AutomationMode.Off && mode == AutomationMode.Off) {
        GAMESTATE.active_task = null;
    }
    GAMESTATE.automation_mode = mode;
}
export function setAutomationEndZone(zone) {
    GAMESTATE.automation_end = zone;
    if (GAMESTATE.automation_mode == AutomationMode.All && GAMESTATE.current_zone >= zone) {
        setAutomationMode(AutomationMode.Off);
    }
}
// MARK: Energy Reset
export class EnergyResetInfo {
    skill_gains = [];
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
        const starting_level = GAMESTATE.skills_at_start_of_reset[skill];
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
export function calcDivineSparkGainFromHighestZone(zone) {
    const prestige_zone = 15 - 1; // Due to 0-indexing
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
    return calcDivineSparkGainFromHighestZone(GAMESTATE.highest_zone);
}
export function hasPrestigeUnlock(unlock) {
    return GAMESTATE.prestige_unlocks.includes(unlock);
}
export function getPrestigeRepeatableLevel(repeatable) {
    return GAMESTATE.prestige_repeatables.get(repeatable) ?? 0;
}
function applyPrestigeUnlockEffects(unlock, show_notification) {
    if (unlock == PrestigeUnlockType.PermanentAutomation) {
        tryAddPerk(PerkType.Amulet, show_notification);
    }
    else if (unlock == PrestigeUnlockType.LookInTheMirror) {
        tryAddPerk(PerkType.ReflectionsOnTheJourney, show_notification);
    }
    else if (unlock == PrestigeUnlockType.FullyAttuned) {
        tryAddPerk(PerkType.Attunement, show_notification);
    }
    else if (unlock == PrestigeUnlockType.TranscendantMemory) {
        tryAddPerk(PerkType.EnergeticMemory, show_notification);
    }
    else if (unlock == PrestigeUnlockType.MasteryOfTime) {
        tryAddPerk(PerkType.MinorTimeCompression, show_notification);
        tryAddPerk(PerkType.MajorTimeCompression, show_notification);
        doMasteryOfTimeTaskCompletion();
    }
    else if (unlock == PrestigeUnlockType.SeeBeyondTheVeil) {
        unlockTask(17); // Secret Fishing Spot
        unlockTask(28); // Training Dummy
        unlockTask(88); // Train at every Guild
        unlockTask(158); // Divine Notes
        unlockTask(209); // Gaze Beyond the Veil
    }
    else if (unlock == PrestigeUnlockType.DivineSupremacy) {
        GAMESTATE.max_energy += DIVINE_SUPREMACY_ENERGY;
    }
}
export function addPrestigeUnlock(unlock) {
    if (hasPrestigeUnlock(unlock)) {
        console.error("Already has prestige unlock");
        return;
    }
    const definition = PRESTIGE_UNLOCKABLES[unlock];
    if (GAMESTATE.divine_spark < definition.cost) {
        console.error("Not enough prestige currency");
        return;
    }
    GAMESTATE.divine_spark -= definition.cost;
    GAMESTATE.prestige_unlocks.push(unlock);
    const show_notification = true;
    applyPrestigeUnlockEffects(unlock, show_notification);
}
export function calcPrestigeRepeatableCost(repeatable) {
    const definition = PRESTIGE_REPEATABLES[repeatable];
    const current_level = getPrestigeRepeatableLevel(repeatable);
    const base_cost = definition.initial_cost;
    return Math.ceil(base_cost * Math.pow(definition.scaling_exponent, current_level));
}
export function increasePrestigeRepeatableLevel(repeatable) {
    const cost = calcPrestigeRepeatableCost(repeatable);
    if (GAMESTATE.divine_spark < cost) {
        console.error("Not enough prestige currency");
        return;
    }
    const current_level = getPrestigeRepeatableLevel(repeatable);
    GAMESTATE.prestige_repeatables.set(repeatable, current_level + 1);
    GAMESTATE.divine_spark -= cost;
    if (repeatable == PrestigeRepeatableType.TranscendantAptitude) {
        const global_target_level = (current_level + 1) * TRANSCENDANT_APTITUDE_MULT;
        for (const skill of GAMESTATE.skills) {
            const target_level = skill.type == SkillType.Ascension ? global_target_level / 2 : global_target_level;
            skill.level = Math.max(target_level, skill.level);
        }
    }
    else if (repeatable == PrestigeRepeatableType.Energized) {
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
    GAMESTATE.power = 0;
    GAMESTATE.attunement = 0;
    GAMESTATE.prestige_available = false;
    GAMESTATE.auto_use_items = false;
    GAMESTATE.unlocked_new_prestige_this_prestige = false;
    // Re-apply mods after the perk wipe so force_automation re-grants the
    // Amulet that gates automation and auto-use.
    applyMods();
    if (!hasPrestigeUnlock(PrestigeUnlockType.SeeBeyondTheVeil)) {
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
    storeLoopStartNumbersForNextGameOver();
    setTickRate();
    saveGame();
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
export function saveGame() {
    // In managed mode the host owns persistence — skip writing to
    // localStorage entirely. Covers all internal call sites (updateActiveTask,
    // doEnergyReset, resetSave, etc.) without per-site guards.
    if (_managed_mode)
        return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const saveData = {};
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
            const value = GAMESTATE[key];
            // Check if the value is a Map and convert it to an array
            if (value instanceof Map) {
                saveData[key] = Array.from(value.entries());
            }
            else if (key == "tasks") {
                // Artifact tasks are rebuilt from artifact_tasks on load; their
                // ids aren't in TASK_LOOKUP, so excluding them avoids the
                // task_definition reviver yielding undefined.
                saveData[key] = value.filter(t => !isArtifactTaskId(t.task_definition.id));
            }
            else {
                saveData[key] = value;
            }
        }
    }
    // Save to localStorage
    const json = JSON.stringify(saveData, (key, value) => {
        if (typeof value === 'object' && value !== null && 'id' in value) {
            return value.id; // Replace object with its ID
        }
        return value;
    });
    localStorage.setItem(SAVE_LOCATION, json);
}
function parseSave(save) {
    const data = JSON.parse(save, function (key, value) {
        if (key == "task_definition") {
            return TASK_LOOKUP.get(value); // Replace ID with the actual object
        }
        return value;
    });
    return data;
}
function loadGame() {
    const saved_game = localStorage.getItem(SAVE_LOCATION);
    if (!saved_game) {
        return false;
    }
    try {
        const data = parseSave(saved_game);
        loadGameFromData(data);
    }
    catch (e) {
        console.log(e);
        return false;
    }
    return true;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadGameFromData(data) {
    Object.keys(data).forEach(key => {
        const value = data[key];
        // Convert it back to a Map if that's what we want
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        GAMESTATE[key] = GAMESTATE[key] instanceof Map ? new Map(value) : value;
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
    // Merge mods over defaults so saves from before a given mod existed (or
    // from before mods at all) get safe values for any missing field.
    GAMESTATE.mods = { ...defaultMods(), ...(GAMESTATE.mods ?? {}) };
    applyMods();
    // Artifact tasks are excluded from the saved `tasks`; rebuild the current
    // zone's from the persisted specs (load doesn't go through initializeTasks).
    injectArtifactTasksForCurrentZone();
    updateEnabledTasks();
}
export function defaultMods() {
    return {
        award_spark_on_discovery: false,
        discovery_spark_fraction: 0.1,
        force_automation: false,
        auto_continue_energy_reset: false,
        suppress_prestige_popup: false,
        resume_automation_on_reset: false,
        auto_haste: false,
        auto_use_cycle: false,
        auto_use_cycle_off_resets: 1,
        auto_use_free_items: false,
        artifact_tasks_item_cycle_only: false,
        queue_cycle: false,
    };
}
export function getMods() {
    return GAMESTATE.mods;
}
export function isModEnabled(name) {
    return Boolean(GAMESTATE.mods[name]);
}
export function getMod(name) {
    return GAMESTATE.mods[name];
}
// Set a mod by name with light type coercion, then apply side-effects.
// Returns false (and logs) for unknown names or invalid numeric values.
export function setMod(name, value) {
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
        GAMESTATE.mods[name] = num;
    }
    else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        GAMESTATE.mods[name] = Boolean(value);
    }
    // Queue cycling and the auto-use cycle are mutually exclusive; enabling one
    // turns the other off. Enabling cycling seeds an initial queue from the
    // current plan (if none yet) and makes the active queue the live plan.
    if (name == "queue_cycle" && GAMESTATE.mods.queue_cycle) {
        GAMESTATE.mods.auto_use_cycle = false;
        seedQueueConfigsIfEmpty();
        loadActiveQueue();
    }
    else if (name == "auto_use_cycle" && GAMESTATE.mods.auto_use_cycle) {
        GAMESTATE.mods.queue_cycle = false;
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
    }
    else if (!GAMESTATE.mods.force_automation && GAMESTATE.mods_granted_amulet) {
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
    save_version = "";
    tasks = [];
    active_task = null;
    unlocked_tasks = [];
    // Player-scheduled artifact-use tasks (see ArtifactTaskSpec). The specs are
    // durable; the Task objects are re-injected per zone, so these are excluded
    // from the serialized `tasks` and rebuilt from here on load.
    artifact_tasks = [];
    next_artifact_task_id = ARTIFACT_TASK_ID_BASE;
    // Queue cycling (Game Mod): saved automation queues rotated one per energy
    // reset. The active queue's plan is the live automation_prios + artifact_tasks;
    // the others are stored snapshots. See QueueConfig.
    queue_configs = [];
    active_queue_index = 0;
    queue_runs_on_current = 0;
    current_zone = 0;
    highest_zone = 0;
    highest_zone_fully_completed = -1;
    highest_zone_ever = 0;
    highest_zone_fully_completed_ever = -1;
    repeat_tasks = true;
    automation_mode = AutomationMode.Off;
    automation_prios = new Map();
    automation_end = 99;
    automation_skip_blocked = false;
    auto_use_items = false;
    undo_item = [ItemType.Count, 0];
    manual_tooltips = false;
    skills_at_start_of_reset = [];
    power_at_start_of_reset = 0;
    attunement_at_start_of_reset = 0;
    skills = [];
    unlocked_skills = [];
    perks = new Map();
    items = new Map();
    items_found_this_energy_reset = [];
    used_items = new Map();
    queued_scrolls_of_haste = 0;
    queued_magic_rings = 0;
    queued_lightning = 0;
    is_in_energy_reset = false;
    is_at_end_of_content = false;
    energy_reset_info = new EnergyResetInfo();
    is_in_zone_skip = false;
    current_energy = STARTING_ENERGY;
    max_energy = STARTING_ENERGY;
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
    prestige_unlocks = [];
    prestige_repeatables = new Map();
    prestige_layers_unlocked = [];
    pending_render_events = [];
    hint_prep_runs_done = 0;
    hint_non_prep_runs_done = 0; // Since unlocking prep runs
    hint_has_gotten_prep_run_hint = false;
    hint_has_gotten_boss_hint = false;
    // Game Mods (opt-in toggles; see GameMods above). mods_granted_amulet
    // tracks whether force_automation is what granted the Amulet perk, so
    // disabling the mod doesn't strip a legitimately earned one.
    mods = defaultMods();
    mods_granted_amulet = false;
    mods_automation_panel_collapsed = true; // Advanced Automation panel UI state
    start() {
        // In managed mode the host owns persistence — skip reading from
        // localStorage and go straight to a fresh initialize.
        if (_managed_mode || !loadGame()) {
            this.initialize();
        }
    }
    initialize() {
        resetTasks();
        initializeSkills();
        GAMESTATE.save_version = SAVE_VERSION;
        applyMods();
    }
    popRenderEvents() {
        const events = this.pending_render_events;
        this.pending_render_events = [];
        return events;
    }
    queueRenderEvent(event) {
        this.pending_render_events.push(event);
    }
}
function advanceZone() {
    const new_zone = GAMESTATE.current_zone + 1;
    if (GAMESTATE.current_zone > GAMESTATE.highest_zone_fully_completed
        && GAMESTATE.tasks.every((task) => { return isTaskFullyCompleted(task); })) {
        GAMESTATE.highest_zone_fully_completed = GAMESTATE.current_zone;
        GAMESTATE.highest_zone_fully_completed_ever = Math.max(GAMESTATE.highest_zone_fully_completed, GAMESTATE.highest_zone_fully_completed_ever);
        const context = { zone: GAMESTATE.current_zone };
        const event = new RenderEvent(EventType.NewHighestZoneFullyCompleted, context);
        GAMESTATE.queueRenderEvent(event);
    }
    if (GAMESTATE.current_zone >= GAMESTATE.highest_zone) {
        GAMESTATE.highest_zone = new_zone;
        GAMESTATE.highest_zone_ever = Math.max(GAMESTATE.highest_zone, GAMESTATE.highest_zone_ever);
        const context = { zone: GAMESTATE.current_zone + 1 };
        const event = new RenderEvent(EventType.NewHighestZone, context);
        GAMESTATE.queueRenderEvent(event);
    }
    if (GAMESTATE.automation_mode == AutomationMode.Zone) {
        GAMESTATE.automation_mode = AutomationMode.Off;
    }
    else if (GAMESTATE.automation_mode == AutomationMode.All && (new_zone + 1) >= GAMESTATE.automation_end) {
        GAMESTATE.automation_mode = AutomationMode.Off;
    }
    // Happens after the highest zone stuff, since we do want the user to get those effects at the end of content
    if (new_zone >= ZONES.length) {
        GAMESTATE.is_at_end_of_content = true;
        return;
    }
    GAMESTATE.current_zone = new_zone;
    resetTasks();
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
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setProgressMult = (new_mult) => task_progress_mult = new_mult;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.saveGame = () => saveGame();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.doEnergyReset = () => doEnergyReset();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.advanceZone = () => advanceZone();
// MARK: Instant Mode + Programmatic Control (for simulator / randomizer / substrate)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setInstantMode = (enabled) => {
    instant_mode = enabled;
    return instant_mode;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.isInstantMode = () => instant_mode;
// Manual tick advancement — useful when running without the interval timer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.stepTick = () => {
    updateGamestate();
    return {
        energy: GAMESTATE.current_energy,
        zone: GAMESTATE.current_zone,
        isInEnergyReset: GAMESTATE.is_in_energy_reset
    };
};
// Start a specific task by id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.performTask = (taskId) => {
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
window.getFullState = () => {
    return {
        // Energy
        currentEnergy: GAMESTATE.current_energy,
        maxEnergy: GAMESTATE.max_energy,
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
window.useItem = (itemType, useAll = false) => {
    const count = GAMESTATE.items.get(itemType) ?? 0;
    if (count <= 0) {
        return { success: false, error: `No items of type ${itemType}` };
    }
    clickItem(itemType, useAll);
    return { success: true, used: useAll ? count : 1 };
};
// Schedule / unschedule using an artifact as a task in the current zone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.addArtifactTask = (itemType) => {
    const id = addArtifactTask(itemType);
    RENDERING.createTasks();
    return { success: true, taskId: id };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.removeArtifactTask = (taskId) => {
    removeArtifactTask(taskId);
    RENDERING.createTasks();
    return { success: true };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.getArtifactTasks = () => getArtifactTasks();
// Queue cycling management.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.getQueueConfigs = () => ({ active: getActiveQueueIndex(), configs: getQueueConfigs() });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.addQueue = () => { const i = addQueue(); RENDERING.createTasks(); return { success: true, index: i }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.removeQueue = (index) => { removeQueue(index); RENDERING.createTasks(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setQueueItemCycle = (index, value) => { setQueueItemCycle(index, !!value); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setQueueRepeatCount = (index, value) => { setQueueRepeatCount(index, value); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.moveQueue = (index, delta) => { moveQueue(index, delta); RENDERING.createTasks(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.advanceQueueCycle = () => { advanceQueueCycle(); RENDERING.createTasks(); return { success: true, active: getActiveQueueIndex() }; };
// Priority edit mode.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.enterEditMode = () => ({ success: enterEditMode() });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.exitEditMode = () => { exitEditMode(); return { success: true }; };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setEditZone = (zone) => { setEditZone(zone); return { success: true, zone: GAMESTATE.current_zone }; };
// Available tasks in the current zone.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.getAvailableTasks = () => {
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
// Set energy directly (for testing / substrate sync).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setEnergy = (current, max) => {
    GAMESTATE.current_energy = current;
    if (max !== undefined) {
        GAMESTATE.max_energy = max;
    }
    return { current: GAMESTATE.current_energy, max: GAMESTATE.max_energy };
};
// MARK: Substrate Hooks (host-driven persistence, transitions, events)
// Managed mode — when on, host owns persistence + ticking + transitions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setManagedMode = (enabled) => {
    _managed_mode = !!enabled;
    return _managed_mode;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.isManagedMode = () => _managed_mode;
// Register a callback fired when a TaskType.Travel task fully completes.
// In managed mode this REPLACES the automatic advanceZone; in non-managed
// mode it fires in addition to advanceZone. Pass null to clear.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setTravelTaskCallback = (fn) => {
    _travel_task_callback = fn;
};
// Register a callback fired at the end of doEnergyReset (jta's own
// game-over). Pass null to clear.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.setEnergyResetCallback = (fn) => {
    _energy_reset_callback = fn;
};
// Load a specific zone by id, optionally in already-completed state.
// completed:true marks all tasks reps = max_reps WITHOUT re-applying
// finish effects (perks / items / power / events) — the player already
// got those on first traversal; this is for the substrate "re-entry"
// case where the zone shows only exit-choice tasks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.loadZone = (zoneId, options = {}) => {
    if (zoneId < 0 || zoneId >= ZONES.length) {
        return { success: false, error: `Invalid zone ${zoneId} (have ${ZONES.length} zones)` };
    }
    GAMESTATE.current_zone = zoneId;
    resetTasks();
    if (options.completed) {
        for (const task of GAMESTATE.tasks) {
            task.reps = task.task_definition.max_reps;
            task.progress = 0;
        }
        updateEnabledTasks();
    }
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
window.injectSyntheticTask = (spec, onComplete) => {
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
window.clearSyntheticTasks = () => {
    const removed = _synthetic_task_callbacks.size;
    GAMESTATE.tasks = GAMESTATE.tasks.filter(t => !_synthetic_task_callbacks.has(t.task_definition.id));
    _synthetic_task_callbacks.clear();
    return { removed };
};
//# sourceMappingURL=simulation.js.map