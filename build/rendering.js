import { Task, TaskDefinition, ZONES, TaskType, PERKS_BY_ZONE, ITEMS_BY_ZONE } from "./zones.js";
import { clickTask, Skill, calcSkillXpNeeded, calcSkillXpNeededAtLevel, calcTaskProgressMultiplier, calcSkillXp, calcEnergyDrainPerTick, clickItem, calcTaskCost, calcSkillTaskProgressMultiplier, getSkill, hasPerk, doEnergyReset, calcSkillTaskProgressMultiplierFromLevel, saveGame, SAVE_LOCATION, toggleRepeatTasks, calcAttunementGain, calcPowerGain, toggleAutomation, AutomationMode, calcPowerSpeedBonusAtLevel, calcAttunementSpeedBonusAtLevel, calcSkillTaskProgressWithoutLevel, setAutomationMode, hasUnlockedPrestige, calcDivineSparkGain, getPrestigeRepeatableLevel, hasPrestigeUnlock, calcPrestigeRepeatableCost, addPrestigeUnlock, increasePrestigeRepeatableLevel, doPrestige, knowsPerk, calcAttunementSkills, getPrestigeGainExponent, calcTickRate, willCompleteAllRepsInOneTick, isTaskDisabledDueToTooStrongBoss, getBossEnergyDisparityLimit, undoItemUse, gatherItemBonuses, gatherPerkBonuses, getPowerSkills, SAVE_VERSION, setHasGottenPrepRunHint, calcDivineSparkGainFromHighestZone, knowsItem, setHasGottenBossHint, setAutomationEndZone, isTaskDisabledDueToMissingItem, isTaskDisabledWithoutBeingFinished, getSpiteTheGodsSkills, calcSpiteTheGodsBonus, calcEnergyDrainPerTickInZone, setMod, getMod, isModEnabled, addArtifactTask, removeArtifactTask, isArtifactTaskId, getQueueConfigs, getActiveQueueIndex, getQueueRunsOnCurrent, advanceQueueCycle, addQueue, removeQueue, setQueueAutoUseMode, getQueueExcludedItems, addQueueExcludedItem, removeQueueExcludedItem, setQueueRepeatCount, setQueueName, moveQueue, setActiveQueue, isEditMode, enterEditMode, exitEditMode, setEditZone, getEditMaxZone, autoFillAllPriorities, getAutoFillOrder, moveAutoFillCategory, resetAutoFillOrder, THRESHOLD_METRIC_REP, THRESHOLD_METRIC_RESETS, THRESHOLD_ALL_SKIPPED_IDLE } from "./simulation.js";
import { GAMESTATE, RENDERING, resetSave } from "./game.js";
import { ItemType, ItemDefinition, ITEMS, HASTE_MULT, ARTIFACTS, MAGIC_RING_MULT, BOTTLED_LIGHTNING_MULT } from "./items.js";
import { PerkDefinition, PerkType, PERKS, getPerkNameWithEmoji } from "./perks.js";
import { EventType, GainedPerkContext, HighestZoneContext, RenderEvent, SkillUpContext, SkippedTasksContext, UnlockedSkillContext, UnlockedTaskContext, UsedItemContext, UsedItemsContext, AwardedSparkContext } from "./events.js";
import { SKILL_DEFINITIONS, SkillDefinition, SkillType } from "./skills.js";
import { ATTUNEMENT_TEXT, BOTTLED_LIGHTNING_TEXT, DIVINE_SPARK_TEXT, ENERGY_TEXT, HASTE_TEXT, POWER_TEXT, TRAVEL_EMOJI, XP_TEXT } from "./rendering_constants.js";
import { PRESTIGE_UNLOCKABLES, PRESTIGE_REPEATABLES, PrestigeRepeatableType, DIVINE_KNOWLEDGE_MULT, DIVINE_APPETITE_ENERGY_ITEM_BOOST_MULT, GOTTA_GO_FAST_BASE, DIVINE_LIGHTNING_EXPONENT_INCREASE, TRANSCENDANT_APTITUDE_MULT, ENERGIZED_INCREASE, DEENERGIZED_BASE, PrestigeUnlockType, ENERGIZED_PERK_INCREASE, MANDATORY_SCHMANDATORY_MULT, DIVINE_ATTUNEMENT_BASE, DIVINER_KNOWLEDGE_MULT, GODLY_TRAVEL_MULT } from "./prestige_upgrades.js";
import { CHANGELOG } from "./changelog.js";
import { CREDITS } from "./credits.js";
import { AWAKENING_DIVINE_SPARK_MULT, DEFIED_THE_GODS_SPARK_MULT } from "./simulation_constants.js";
// MARK: Helpers
function createChildElement(parent, child_type) {
    const child = document.createElement(child_type);
    parent.appendChild(child);
    return child;
}
function createNumericInput(parent, options) {
    const { min = 1, max = 99, step = 1, largeStep = 10, initialValue, onChange, ariaLabel } = options;
    const wrapper = createChildElement(parent, "div");
    wrapper.className = "numeric-input-wrapper";
    const input = createChildElement(wrapper, "input");
    input.className = "numeric-input";
    input.type = "number";
    input.value = `${initialValue}`;
    input.min = `${min}`;
    input.max = `${max}`;
    if (ariaLabel) {
        input.setAttribute("aria-label", ariaLabel);
    }
    const buttons_container = createChildElement(wrapper, "div");
    buttons_container.className = "numeric-input-buttons";
    const increment_button = createChildElement(buttons_container, "button");
    increment_button.className = "numeric-input-button numeric-input-increment";
    increment_button.type = "button";
    increment_button.setAttribute("aria-label", "Increment");
    const decrement_button = createChildElement(buttons_container, "button");
    decrement_button.className = "numeric-input-button numeric-input-decrement";
    decrement_button.type = "button";
    decrement_button.setAttribute("aria-label", "Decrement");
    function clampValue(value) {
        if (isNaN(value))
            return min;
        return Math.max(min, Math.min(max, value));
    }
    function updateButtonStates() {
        const current = getCurrentValue();
        decrement_button.classList.toggle("disabled", current <= min);
        increment_button.classList.toggle("disabled", current >= max);
    }
    function updateValue(newValue) {
        const clamped = clampValue(newValue);
        input.value = `${clamped}`;
        updateButtonStates();
        onChange(clamped);
    }
    function getCurrentValue() {
        return parseInt(input.value) || min;
    }
    updateButtonStates();
    decrement_button.addEventListener("click", () => {
        updateValue(getCurrentValue() - step);
    });
    increment_button.addEventListener("click", () => {
        updateValue(getCurrentValue() + step);
    });
    // Hold-to-repeat functionality
    let hold_timeout = null;
    let hold_interval = null;
    const HOLD_DELAY = 400;
    const HOLD_REPEAT = 80;
    function startHold(delta) {
        stopHold();
        hold_timeout = window.setTimeout(() => {
            hold_interval = window.setInterval(() => {
                updateValue(getCurrentValue() + delta);
            }, HOLD_REPEAT);
        }, HOLD_DELAY);
    }
    function stopHold() {
        if (hold_timeout) {
            clearTimeout(hold_timeout);
            hold_timeout = null;
        }
        if (hold_interval) {
            clearInterval(hold_interval);
            hold_interval = null;
        }
    }
    decrement_button.addEventListener("mousedown", () => startHold(-step));
    increment_button.addEventListener("mousedown", () => startHold(step));
    // Document-level mouseup to catch releases anywhere
    document.addEventListener("mouseup", stopHold);
    // Keyboard support
    input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp") {
            event.preventDefault();
            updateValue(getCurrentValue() + step);
        }
        else if (event.key === "ArrowDown") {
            event.preventDefault();
            updateValue(getCurrentValue() - step);
        }
        else if (event.key === "PageUp") {
            event.preventDefault();
            updateValue(getCurrentValue() + largeStep);
        }
        else if (event.key === "PageDown") {
            event.preventDefault();
            updateValue(getCurrentValue() - largeStep);
        }
        else if (event.key === "Enter") {
            updateValue(getCurrentValue());
            input.blur();
        }
    });
    // Wheel handler for when focused (works anywhere on page)
    function handleWheelFocused(event) {
        if (document.activeElement !== input)
            return;
        event.preventDefault();
        const delta = event.deltaY < 0 ? step : -step;
        updateValue(getCurrentValue() + delta);
    }
    // Wheel handler for when hovering (works on the wrapper)
    function handleWheelHover(event) {
        if (document.activeElement === input)
            return; // Don't double-handle if focused
        event.preventDefault();
        const delta = event.deltaY < 0 ? step : -step;
        updateValue(getCurrentValue() + delta);
    }
    // Hover-to-scroll: works when hovering over the input
    wrapper.addEventListener("wheel", handleWheelHover, { passive: false });
    // Focus-to-scroll: works anywhere when input is focused
    function handleFocus() {
        input.select();
        document.addEventListener("wheel", handleWheelFocused, { passive: false });
    }
    function handleFocusOut() {
        updateValue(getCurrentValue());
        document.removeEventListener("wheel", handleWheelFocused);
    }
    input.addEventListener("focus", handleFocus);
    input.addEventListener("focusout", handleFocusOut);
    // Cleanup function to remove all document-level listeners
    function destroy() {
        document.removeEventListener("mouseup", stopHold);
        document.removeEventListener("wheel", handleWheelFocused);
        stopHold();
    }
    return { input, destroy };
}
export function joinWithCommasAndAnd(strings) {
    if (strings.length === 0)
        return "";
    if (strings.length === 1)
        return strings[0];
    if (strings.length === 2)
        return `${strings[0]} and ${strings[1]}`;
    const allButLast = strings.slice(0, -1).join(", ");
    const last = strings[strings.length - 1];
    return `${allButLast}, and ${last}`;
}
function createConfirmationOverlay(header_text, description_text, on_confirm) {
    const overlay = RENDERING.confirmation_overlay_element;
    overlay.innerHTML = "";
    const div = createChildElement(overlay, "div");
    div.className = "overlay-box confirmation";
    createChildElement(div, "h1").innerHTML = header_text;
    createChildElement(div, "p").innerHTML = description_text;
    const confirmation_buttons_div = createChildElement(div, "div");
    confirmation_buttons_div.className = "confirmation-buttons";
    const confirm_button = createChildElement(confirmation_buttons_div, "button");
    confirm_button.textContent = "Confirm";
    confirm_button.addEventListener("click", on_confirm);
    confirm_button.addEventListener("click", () => { overlay.classList.add("hidden"); });
    setupTooltipStatic(confirm_button, header_text, "");
    const cancel_button = createChildElement(confirmation_buttons_div, "button");
    cancel_button.textContent = "Cancel";
    cancel_button.addEventListener("click", () => { overlay.classList.add("hidden"); });
    setupTooltipStatic(cancel_button, "Cancel", "");
    overlay.classList.remove("hidden");
}
function areArraysEqual(array1, array2) {
    return array1.length === array2.length &&
        array1.every((value, index) => value === array2[index]);
}
function createTableSection(table, name) {
    const row = createChildElement(table, "tr");
    createChildElement(row, "td").innerHTML = name;
    const contents = createChildElement(row, "td");
    const section = createChildElement(contents, "table");
    section.className = "table simple-table";
    return section;
}
function createTwoElementRow(table, x, y) {
    const row = createChildElement(table, "tr");
    row.innerHTML = `<td>${x}</td><td>${y}</td>`;
}
function createThreeElementRow(table, x, y, z) {
    const row = createChildElement(table, "tr");
    row.innerHTML = `<td>${x}</td><td>${y}</td><td>${z}</td>`;
}
// MARK: Skills
function createSkillDiv(skill, skills_div) {
    const skill_div = document.createElement("div");
    skill_div.className = "skill";
    skill_div.classList.add("sidebar-item");
    const skill_definition = SKILL_DEFINITIONS[skill.type];
    const name = document.createElement("div");
    name.className = "sidebar-item-text";
    name.textContent = `${skill_definition.icon}${skill_definition.name}`;
    const progressFill = document.createElement("div");
    progressFill.className = "progress-fill";
    progressFill.style.width = "0%";
    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressBar.appendChild(progressFill);
    skill_div.appendChild(name);
    skill_div.appendChild(progressBar);
    setupTooltip(skill_div, function () { return `${skill_definition.icon}${skill_definition.name} - Level ${skill.level}`; }, function () {
        let tooltip = `Speed multiplier: x${formatNumber(calcSkillTaskProgressMultiplier(skill.type))}`;
        const other_sources_mult = calcSkillTaskProgressWithoutLevel(skill.type);
        if (other_sources_mult != 1) {
            tooltip += `<br>From level: x${formatNumber(calcSkillTaskProgressMultiplierFromLevel(skill.level))}`;
            tooltip += `<br>From other sources: x${formatNumber(other_sources_mult)}`;
        }
        tooltip += `<br><br>${XP_TEXT}: ${formatNumber(skill.progress)}/${formatNumber(calcSkillXpNeeded(skill))}`;
        tooltip += `<br><br>Skill speed increases 1% per level, while ${XP_TEXT} needed to level up increases 2%`;
        tooltip += `<br>The speed of Tasks with multiple skills scale by the square or cube root of the skill level bonuses`;
        tooltip += `<br>Bonuses not from levels (E.G., from Items and Perks) are not scaled down this way`;
        return tooltip;
    });
    skills_div.appendChild(skill_div);
    RENDERING.skill_elements.set(skill.type, skill_div);
}
function recreateSkills() {
    const skills_div = document.getElementById("skills");
    if (!skills_div) {
        console.error("The element with ID 'skills' was not found.");
        return;
    }
    skills_div.innerHTML = "";
    for (const skill of GAMESTATE.skills) {
        if (GAMESTATE.unlocked_skills.includes(skill.type)) {
            createSkillDiv(skill, skills_div);
        }
    }
}
function updateSkillRendering() {
    for (const skill of GAMESTATE.skills) {
        if (!GAMESTATE.unlocked_skills.includes(skill.type)) {
            continue;
        }
        const element = RENDERING.skill_elements.get(skill.type);
        const fill = element.querySelector(".progress-fill");
        if (fill) {
            fill.style.width = `${skill.progress * 100 / calcSkillXpNeeded(skill)}%`;
        }
        const name = element.querySelector(".sidebar-item-text");
        if (name) {
            const skill_definition = SKILL_DEFINITIONS[skill.type];
            const new_html = `<span>${skill_definition.icon}${skill_definition.name}</span><span>${skill.level}</span>`;
            // Avoid flickering in the debugger
            if (new_html != name.innerHTML) {
                name.innerHTML = new_html;
            }
        }
    }
}
export function getSkillString(type) {
    const skill = SKILL_DEFINITIONS[type];
    return `${skill.icon}${skill.name}`;
}
function calcTotalSkillXp(task, completions) {
    let xp_boost_stacks = GAMESTATE.queued_magic_rings;
    if (task.xp_boosted) {
        xp_boost_stacks += 1;
    }
    const boost_completions = Math.min(completions, xp_boost_stacks);
    const non_boost_completion = completions - boost_completions;
    let xp = 0;
    let xp_per_completion = calcSkillXp(task, calcTaskCost(task), true);
    xp += xp_per_completion * non_boost_completion;
    xp_per_completion *= MAGIC_RING_MULT;
    xp += xp_per_completion * boost_completions;
    return xp;
}
function calcLevelsGained(type, xp_gained) {
    const skill_progress = getSkill(type);
    let resulting_level = skill_progress.level;
    let xp_needed = calcSkillXpNeeded(skill_progress) - skill_progress.progress;
    while (xp_gained > xp_needed) {
        xp_gained -= xp_needed;
        resulting_level += 1;
        xp_needed = calcSkillXpNeededAtLevel(resulting_level, type);
    }
    return resulting_level - skill_progress.level;
}
// MARK: Tasks
const TASK_TYPE_NAMES = ["Normal", "Travel", "Mandatory", "Prestige", "Boss"];
// A transient message in the messages area (used for soft-blocked actions).
function flashMessage(text) {
    const messages = RENDERING.messages_element;
    if (!messages) {
        return;
    }
    const div = document.createElement("div");
    div.className = "message";
    div.textContent = text;
    messages.appendChild(div);
    setTimeout(() => { if (div.parentElement === messages) {
        messages.removeChild(div);
    } }, 3000);
}
// Re-render the view after entering/leaving/navigating edit mode.
function refreshAfterEditChange() {
    recreateTasks();
    setupZone();
    setupControls();
}
// Prominent banner shown at the top of the task list while editing priorities,
// with zone navigation (clamped to zones reached) and a Done button.
function createEditModeBanner(parent) {
    const banner = createChildElement(parent, "div");
    banner.className = "edit-mode-banner";
    const prev = createChildElement(banner, "button");
    prev.className = "edit-mode-nav";
    prev.textContent = "◀";
    prev.classList.toggle("disabled", GAMESTATE.current_zone <= 0);
    prev.addEventListener("click", () => { setEditZone(GAMESTATE.current_zone - 1); refreshAfterEditChange(); });
    const label = createChildElement(banner, "span");
    label.className = "edit-mode-label";
    label.textContent = `✏️ Editing Priorities — Zone ${GAMESTATE.current_zone + 1}`;
    const next = createChildElement(banner, "button");
    next.className = "edit-mode-nav";
    next.textContent = "▶";
    next.classList.toggle("disabled", GAMESTATE.current_zone >= getEditMaxZone());
    next.addEventListener("click", () => { setEditZone(GAMESTATE.current_zone + 1); refreshAfterEditChange(); });
    const done = createChildElement(banner, "button");
    done.className = "edit-mode-done";
    done.textContent = "Done";
    done.addEventListener("click", () => { exitEditMode(); refreshAfterEditChange(); });
}
// A plain section header inside the task list (e.g. "Procgen Exits").
function createTaskSectionHeader(parent, title) {
    const header = createChildElement(parent, "div");
    header.className = "task-section-header";
    const label = createChildElement(header, "span");
    label.className = "task-section-title";
    label.textContent = title;
    return header;
}
// The "Artifacts" header, with Add/Remove pick-mode buttons for scheduling
// artifact-use tasks.
function createArtifactSectionHeader(parent, rendering) {
    const header = createTaskSectionHeader(parent, "Artifacts");
    const add_button = createChildElement(header, "button");
    const adding = rendering.artifact_task_mode == "add";
    add_button.className = "artifact-task-control" + (adding ? " on" : "");
    add_button.textContent = adding ? "Pick an artifact…" : "Add";
    add_button.addEventListener("click", () => {
        rendering.artifact_task_mode = adding ? null : "add";
        rendering.createTasks();
    });
    setupTooltip(add_button, () => "Add Artifact Task", () => "Click here, then click an artifact in your inventory to schedule using it as a task in this zone. Click Add again to cancel.");
    const remove_button = createChildElement(header, "button");
    const removing = rendering.artifact_task_mode == "remove";
    remove_button.className = "artifact-task-control" + (removing ? " on" : "");
    remove_button.textContent = removing ? "Pick a task…" : "Remove";
    remove_button.addEventListener("click", () => {
        rendering.artifact_task_mode = removing ? null : "remove";
        rendering.createTasks();
    });
    setupTooltip(remove_button, () => "Remove Artifact Task", () => "Click here, then click a scheduled artifact task to remove it. Click Remove again to cancel.");
}
function createTaskDiv(task, tasks_div, rendering) {
    const task_div = document.createElement("div");
    task_div.className = "task";
    task_div.classList.add(Object.values(TaskType)[task.task_definition.type]);
    const task_upper_div = document.createElement("div");
    task_upper_div.className = "task-upper";
    const task_button = document.createElement("button");
    task_button.className = "task-button";
    task_button.addEventListener("click", () => {
        // In "remove" pick-mode, clicking an artifact task unschedules it.
        if (rendering.artifact_task_mode == "remove" && isArtifactTaskId(task.task_definition.id)) {
            removeArtifactTask(task.task_definition.id);
            rendering.createTasks();
            return;
        }
        // We do this just via classes rather than the disabled propery
        // As Firefox would also disable right-clicking otherwise
        if (!task_button.classList.contains("disabled")) {
            clickTask(task);
        }
    });
    task_button.addEventListener("contextmenu", (e) => { e.preventDefault(); toggleAutomation(task.task_definition); });
    const task_button_text = createChildElement(task_button, "span");
    task_button_text.textContent = task.task_definition.name;
    task_button_text.className = "task-button-text";
    if (task.task_definition.type == TaskType.Prestige && !GAMESTATE.prestige_layers_unlocked.includes(task.task_definition.prestige_layer)) {
        task_button.classList.add("prestige-glow");
    }
    const task_automation = document.createElement("div");
    task_automation.className = "task-automation";
    task_button.appendChild(task_automation);
    const progressFill = document.createElement("div");
    progressFill.className = "progress-fill";
    progressFill.style.width = "0%";
    const progressBar = document.createElement("div");
    progressBar.className = "progress-bar";
    progressBar.appendChild(progressFill);
    const skillsUsed = document.createElement("p");
    skillsUsed.className = "skills-used-text";
    let skillText = "Skills: ";
    const skillStrings = [];
    for (const skill of task.task_definition.skills) {
        const skill_definition = SKILL_DEFINITIONS[skill];
        skillStrings.push(`${skill_definition.icon}${skill_definition.name}`);
    }
    skillText += skillStrings.join(", ");
    skillsUsed.textContent = skillText;
    if (task.task_definition.item != ItemType.Count) {
        const item_indicator = document.createElement("div");
        item_indicator.className = "task-item-indicator";
        item_indicator.classList.add("indicator");
        item_indicator.textContent = ITEMS[task.task_definition.item].icon;
        task_button.appendChild(item_indicator);
    }
    if (task.task_definition.perk != PerkType.Count && !hasPerk(task.task_definition.perk)) {
        const perk_indicator = document.createElement("div");
        perk_indicator.className = "task-perk-indicator";
        perk_indicator.classList.add("indicator");
        perk_indicator.textContent = PERKS[task.task_definition.perk].icon;
        task_button.appendChild(perk_indicator);
        task_button.classList.add("unlock");
    }
    if (ARTIFACTS.includes(task.task_definition.item)) {
        if (!knowsItem(task.task_definition.item)) {
            task_button.classList.add("unlock");
        }
    }
    const task_reps_div = document.createElement("div");
    task_reps_div.className = "task-reps";
    if (task.task_definition.type != TaskType.Travel) {
        for (let i = 0; i < task.task_definition.max_reps; ++i) {
            const task_rep_div = document.createElement("div");
            task_rep_div.className = "task-rep";
            task_reps_div.appendChild(task_rep_div);
        }
    }
    task_upper_div.appendChild(task_button);
    task_upper_div.appendChild(task_reps_div);
    task_div.appendChild(skillsUsed);
    task_div.appendChild(progressBar);
    task_div.appendChild(task_upper_div);
    setupTooltip(task_div, function () { return `${task.task_definition.name}`; }, function () {
        const task_type = TASK_TYPE_NAMES[task.task_definition.type];
        let tooltip = `<p class="subheader ${task_type}">${task_type} Task</p>`;
        if (!task.enabled) {
            if (task.task_definition.type == TaskType.Travel) {
                const has_prestige_task = GAMESTATE.tasks.find((task) => { return task.task_definition.type == TaskType.Prestige; });
                tooltip += `<p class="disable-reason">Disabled until you complete the <span class="Mandatory">Mandatory</span>${has_prestige_task ? ` and <span class="Prestige">Prestige</span>` : ``} tasks</p>`;
            }
            else if (task.reps >= task.task_definition.max_reps) {
                tooltip += `<p class="disable-reason">Disabled due to being fully completed</p>`;
            }
            else if (isTaskDisabledDueToTooStrongBoss(task)) {
                tooltip += `<p class="disable-reason">Disabled due to this Boss requiring more than ${getBossEnergyDisparityLimit()}x your current ${ENERGY_TEXT}</p>`;
            }
            else if (isTaskDisabledDueToMissingItem(task)) {
                tooltip += `<p class="disable-reason">Disabled due to this requiring a ${getItemNameWithIcon(task.task_definition.use_item)} Item</p>`;
            }
            else {
                console.error("Task disabled for unknown reason");
            }
        }
        const task_table = document.createElement("table");
        task_table.className = "table simple-table";
        let asterisk_count = 0;
        let perk_asterisk_index = -1;
        let partial_skill_gain_asterisk_index = -1;
        let haste_asterisk_index = -1;
        let magic_ring_asterisk_index = -1;
        const remaining_completions = (task.reps == task.task_definition.max_reps) ? task.task_definition.max_reps : (task.task_definition.max_reps - task.reps);
        const single_rep_for_all_ticks = willCompleteAllRepsInOneTick(task);
        const completions = (GAMESTATE.repeat_tasks || single_rep_for_all_ticks) ? remaining_completions : 1;
        const expected_completions = calcExpectedCompletions(task, completions);
        const haste_stacks = task.hasted ? GAMESTATE.queued_scrolls_of_haste + 1 : GAMESTATE.queued_scrolls_of_haste;
        const magic_ring_stacks = task.xp_boosted ? GAMESTATE.queued_magic_rings + 1 : GAMESTATE.queued_magic_rings;
        const lightning_stacks = task.lightning ? GAMESTATE.queued_lightning + 1 : GAMESTATE.queued_lightning;
        if (task.task_definition.max_reps > 1) {
            const table = createTableSection(task_table, "Completions");
            createTwoElementRow(table, "", `${completions}`);
        }
        {
            let table = null;
            function getOrCreateTable() {
                if (!table) {
                    table = createTableSection(task_table, "Rewards");
                }
                return table;
            }
            if (task.task_definition.type == TaskType.Travel) {
                createTwoElementRow(getOrCreateTable(), `${TRAVEL_EMOJI}Move to Zone`, `${task.task_definition.zone_id + 2}`);
            }
            if (task.task_definition.item != ItemType.Count) {
                const plural = completions > 1;
                createTwoElementRow(getOrCreateTable(), `${getItemNameWithIcon(task.task_definition.item)} ${plural ? "Items" : "Item"}`, `${completions}`);
            }
            if (task.task_definition.perk != PerkType.Count && !hasPerk(task.task_definition.perk)) {
                const perk = PERKS[task.task_definition.perk];
                const is_last_rep = (task.reps + completions) == task.task_definition.max_reps;
                if (!is_last_rep) {
                    perk_asterisk_index = ++asterisk_count;
                }
                createTwoElementRow(getOrCreateTable(), `${perk.icon}${knowsPerk(perk.enum) ? perk.name : "Mystery"} Perk`, is_last_rep ? `1` : `0${"*".repeat(perk_asterisk_index)}`);
            }
            const attunement_gain = completions * calcAttunementGain(task);
            if (attunement_gain > 0) {
                createTwoElementRow(getOrCreateTable(), `🌀Attunement`, `${formatInt(attunement_gain)}`);
            }
            const power_gain = completions * calcPowerGain(task);
            if (power_gain > 0 && GAMESTATE.has_unlocked_power) {
                createTwoElementRow(getOrCreateTable(), `💪Power`, `${formatInt(power_gain)}`);
            }
        }
        {
            let skill_gain_text = "Skill Gains";
            if (completions != expected_completions) {
                partial_skill_gain_asterisk_index = ++asterisk_count;
                skill_gain_text += "*".repeat(partial_skill_gain_asterisk_index);
            }
            const table = createTableSection(task_table, skill_gain_text);
            const xp_gained = calcTotalSkillXp(task, completions);
            const xp_gained_before_energy_runs_out = calcTotalSkillXp(task, expected_completions);
            for (const skill of task.task_definition.skills) {
                const skill_progress = getSkill(skill);
                const skill_definition = SKILL_DEFINITIONS[skill];
                let levels = ``;
                const levels_diff = calcLevelsGained(skill, xp_gained);
                const expected_levels_diff = calcLevelsGained(skill, xp_gained_before_energy_runs_out);
                if (levels_diff == expected_levels_diff) {
                    if (levels_diff > 0) {
                        levels = `${levels_diff}`;
                    }
                    else {
                        const level_percentage = xp_gained / calcSkillXpNeeded(skill_progress);
                        if (level_percentage < 0.01) {
                            levels = `<0.01`;
                        }
                        else if (completions == expected_completions) {
                            levels = `${formatNumber(level_percentage)}`;
                        }
                        else {
                            const expected_level_percentage = xp_gained_before_energy_runs_out / calcSkillXpNeeded(skill_progress);
                            levels = `${formatNumber(expected_level_percentage)}-${formatNumber(level_percentage)}`;
                        }
                    }
                }
                else {
                    levels = `${expected_levels_diff}-${levels_diff}`;
                }
                createTwoElementRow(table, `${skill_definition.icon}${skill_definition.name}`, levels);
            }
        }
        {
            const table = createTableSection(task_table, "Cost Estimate");
            if (task.task_definition.use_item != ItemType.Count) {
                const plural = completions > 1;
                createTwoElementRow(table, `${getItemNameWithIcon(task.task_definition.use_item)} ${plural ? "Items" : "Item"}`, `${completions}`);
            }
            const energy_cost = estimateTotalTaskEnergyConsumption(task, completions);
            const energy_cost_ratio = energy_cost / GAMESTATE.current_energy;
            let energy_cost_class = "";
            if (energy_cost_ratio < 0.05) {
                energy_cost_class = "very-low";
            }
            else if (energy_cost_ratio < 0.5) {
                energy_cost_class = "low";
            }
            else if (energy_cost_ratio < 0.75) {
                energy_cost_class = "normal";
            }
            else if (energy_cost_ratio < 1.0) {
                energy_cost_class = "high";
            }
            else if (energy_cost_ratio < 1.25) {
                energy_cost_class = "very-high";
            }
            else {
                energy_cost_class = "extreme";
            }
            const energy_cost_text = `<span class="${energy_cost_class}">${formatNumber(energy_cost, energy_cost > 0)}</span>`;
            createTwoElementRow(table, ENERGY_TEXT, `${energy_cost_text}`);
            const task_ticks = estimateTotalTaskTicks(task, completions);
            if (task_ticks > completions) {
                createTwoElementRow(table, `⏰Seconds`, formatNumber(estimateTaskTimeInSeconds(task, completions)));
            }
            else {
                createTwoElementRow(table, `⏰Ticks`, `${task_ticks}`);
            }
        }
        {
            let table = null;
            function getOrCreateTable() {
                if (!table) {
                    table = createTableSection(task_table, "Modifiers");
                }
                return table;
            }
            if (haste_stacks > 0) {
                const needs_asterisk = haste_stacks < completions && !single_rep_for_all_ticks;
                if (needs_asterisk) {
                    haste_asterisk_index = ++asterisk_count;
                }
                createTwoElementRow(getOrCreateTable(), `${HASTE_TEXT}${needs_asterisk ? "*".repeat(haste_asterisk_index) : ""}`, `<span class="good">x${HASTE_MULT}</span>`);
            }
            if (lightning_stacks > 0 && task.task_definition.type == TaskType.Boss) {
                createTwoElementRow(getOrCreateTable(), BOTTLED_LIGHTNING_TEXT, `<span class="good">x${BOTTLED_LIGHTNING_MULT}</span>`);
            }
            if (magic_ring_stacks > 0) {
                const needs_asterisk = magic_ring_stacks < completions && !single_rep_for_all_ticks;
                if (needs_asterisk) {
                    magic_ring_asterisk_index = ++asterisk_count;
                }
                createTwoElementRow(getOrCreateTable(), `${XP_TEXT} (Magic Ring)${needs_asterisk ? "*".repeat(magic_ring_asterisk_index) : ""}`, `<span class="good">x${MAGIC_RING_MULT}</span>`);
            }
        }
        tooltip += task_table.outerHTML;
        if (perk_asterisk_index >= 0) {
            tooltip += `<p class="tooltip-asterisk">${"*".repeat(perk_asterisk_index)} Perk is only gained on completing all Reps of the Task</p>`;
        }
        if (partial_skill_gain_asterisk_index >= 0) {
            tooltip += `<p class="tooltip-asterisk">${"*".repeat(partial_skill_gain_asterisk_index)} Skill gain as range since you're expected to run out of ${ENERGY_TEXT} before fully completing this Task</p>`;
        }
        if (haste_asterisk_index >= 0) {
            tooltip += `<p class="tooltip-asterisk">${"*".repeat(haste_asterisk_index)} Haste will only apply to the first ${haste_stacks} reps</p>`;
        }
        if (magic_ring_asterisk_index >= 0) {
            tooltip += `<p class="tooltip-asterisk">${"*".repeat(magic_ring_asterisk_index)} Magic Ring will only apply to the first ${magic_ring_stacks} reps</p>`;
        }
        return tooltip;
    });
    tasks_div.appendChild(task_div);
    rendering.task_elements.set(task.task_definition, task_div);
}
function recreateTasks() {
    RENDERING.createTasks();
}
function updateTaskRendering() {
    for (const task of GAMESTATE.tasks) {
        const task_element = RENDERING.task_elements.get(task.task_definition);
        const fill = task_element.querySelector(".progress-fill");
        if (fill) {
            fill.style.width = `${task.progress * 100 / calcTaskCost(task)}%`;
        }
        else {
            console.error("No progress-fill");
        }
        const button = task_element.querySelector(".task-button");
        if (button) {
            button.classList.toggle("disabled", !task.enabled);
            const disabled_with_reason = !task.enabled && isTaskDisabledWithoutBeingFinished(task);
            const button_text = task_element.querySelector(".task-button-text");
            if (button_text) {
                button_text.textContent = (disabled_with_reason ? `🚫` : ``) + task.task_definition.name;
            }
            else {
                console.error("No task-button-text");
            }
        }
        else {
            console.error("No task-button");
        }
        const automation = task_element.querySelector(".task-automation");
        if (automation) {
            let prios = GAMESTATE.automation_prios.get(GAMESTATE.current_zone) ?? [];
            prios = prios.filter((task_id) => {
                return GAMESTATE.tasks.find((task) => { return task.task_definition.id == task_id; }) != undefined;
            });
            const index = prios.indexOf(task.task_definition.id);
            const index_str = index >= 0 ? `${index + 1}` : "";
            if (automation.textContent != index_str) {
                automation.textContent = index_str;
            }
        }
        else {
            console.error("No task-automation");
        }
        if (task.task_definition.type != TaskType.Travel) {
            const reps = task_element.getElementsByClassName("task-rep");
            for (let i = 0; i < task.reps; ++i) {
                reps[i].classList.add("finished");
            }
        }
    }
}
function calcExpectedCompletions(task, desired_completions) {
    const { normal, haste, haste_completions } = calcSplitTotalTaskTicks(task, desired_completions);
    const cost_per_tick = calcEnergyDrainPerTick(task, (normal + haste) <= desired_completions);
    let remaining_energy = GAMESTATE.current_energy;
    const haste_cost = haste * cost_per_tick;
    const normal_cost = normal * cost_per_tick;
    if (haste_cost + normal_cost <= remaining_energy) {
        return desired_completions;
    }
    const actual_haste_completions = Math.min(remaining_energy / haste_cost, 1) * haste_completions;
    if (actual_haste_completions < haste_completions) {
        return actual_haste_completions;
    }
    remaining_energy -= haste_cost;
    return haste_completions + Math.min(remaining_energy / normal_cost, 1) * (desired_completions - haste_completions);
}
function calcSplitTotalTaskTicks(task, completions) {
    if (willCompleteAllRepsInOneTick(task)) {
        return { normal: 1, haste: 0, haste_completions: 0 }; // Major Time Compression combines all single-tick reps
    }
    const lightning = task.lightning || (GAMESTATE.queued_lightning > 0 && task.task_definition.type == TaskType.Boss);
    let progress_mult = calcTaskProgressMultiplier(task, false, lightning);
    let haste_stacks = GAMESTATE.queued_scrolls_of_haste;
    if (task.hasted) {
        haste_stacks += 1;
    }
    const haste_completions = Math.min(completions, haste_stacks);
    const non_haste_completions = completions - haste_completions;
    const normal_ticks = Math.ceil(calcTaskCost(task) / progress_mult) * non_haste_completions;
    progress_mult *= HASTE_MULT;
    const haste_ticks = Math.ceil(calcTaskCost(task) / progress_mult) * haste_completions;
    return { normal: normal_ticks, haste: haste_ticks, haste_completions: haste_completions };
}
function estimateTotalTaskTicks(task, completions) {
    const { normal, haste } = calcSplitTotalTaskTicks(task, completions);
    return normal + haste;
}
function estimateTaskTimeInSeconds(task, completions) {
    return estimateTotalTaskTicks(task, completions) * calcTickRate() / 1000;
}
// MARK: Energy
function updateEnergyRendering() {
    const fill = RENDERING.energy_element.querySelector(".progress-fill");
    if (fill) {
        fill.style.width = `${GAMESTATE.current_energy * 100 / GAMESTATE.max_energy}%`;
    }
    const value = RENDERING.energy_element.querySelector(".progress-value");
    if (value) {
        const new_html = `${GAMESTATE.current_energy.toFixed(0)}`;
        // Avoid flickering in the debugger
        if (new_html != value.innerHTML) {
            value.textContent = new_html;
        }
    }
    const energy_percentage = GAMESTATE.current_energy / GAMESTATE.max_energy;
    RENDERING.energy_element.classList.toggle("low-energy", energy_percentage < 0.15);
}
function estimateTotalTaskEnergyConsumption(task, completions) {
    const num_ticks = estimateTotalTaskTicks(task, completions);
    // Note that this will be an overestimate if you use haste to get stuff down to 1 tick
    // Not fixing atm because why would you ever do that? And pessimism isn't too bad
    return num_ticks * calcEnergyDrainPerTick(task, num_ticks <= completions);
}
function setupTooltip(element, header_callback, body_callback) {
    element.generateTooltipHeader = header_callback;
    element.generateTooltipBody = body_callback;
    element.addEventListener("pointerenter", (event) => {
        RENDERING.potential_tooltipped_element = element;
        if (!GAMESTATE.manual_tooltips || event.ctrlKey) {
            showTooltip(element);
        }
    });
    element.addEventListener("pointerleave", () => {
        hideTooltip();
        RENDERING.potential_tooltipped_element = null;
    });
}
function setupTooltipStaticHeader(element, header, body_callback) {
    setupTooltip(element, () => { return header; }, body_callback);
}
function setupTooltipStatic(element, header, body) {
    setupTooltip(element, () => { return header; }, () => { return body; });
}
function setupInfoTooltips() {
    const item_info = document.querySelector("#items .section-info");
    if (!item_info) {
        console.error("No item info element");
        return;
    }
    setupTooltipStaticHeader(item_info, `Items`, function () {
        let tooltip = `Items can be used to get bonuses that last until the next Energy Reset`;
        tooltip += `<br>The bonuses stack additively; 2 +100% results in 3x speed, not 4x`;
        tooltip += `<br>Bonuses to different Task types stack multiplicatively with one another`;
        tooltip += `<br><br>Right-click to use all rather than just one`;
        tooltip += `<br><br>Current Skill bonuses:`;
        const table = document.createElement("table");
        table.className = "table simple-table";
        createThreeElementRow(table, "<h3>Skill</h3>", "<h3>Item(s)</h3>", "<h3>Bonus</h3>");
        for (const skill_type of GAMESTATE.unlocked_skills) {
            const skill = getSkill(skill_type);
            if (skill.speed_modifier <= 1) {
                continue;
            }
            let items_string = "";
            const item_bonuses = gatherItemBonuses(skill_type);
            for (const [item_type,] of item_bonuses) {
                items_string += ITEMS[item_type]?.icon;
            }
            createThreeElementRow(table, getSkillString(skill_type), items_string, `+${formatPercentage((skill.speed_modifier - 1))}`);
        }
        if (table.children.length == 1) {
            tooltip += "<br>None";
        }
        else {
            tooltip += table.outerHTML;
        }
        return tooltip;
    });
    const artifact_info = document.querySelector("#artifacts .section-info");
    if (!artifact_info) {
        console.error("No artifact info element");
        return;
    }
    setupTooltipStaticHeader(artifact_info, `Artifacts`, function () {
        let tooltip = `Artifacts are special Items with powerful single-use effects`;
        tooltip += `<br>The effects apply to just a single rep of the next Task started`;
        tooltip += `<br>They otherwise behave identically to other Items`;
        tooltip += `<br>That includes keeping half after ${ENERGY_TEXT} resets`;
        return tooltip;
    });
    const perk_info = document.querySelector("#perks .section-info");
    if (!perk_info) {
        console.error("No perk info element");
        return;
    }
    setupTooltipStaticHeader(perk_info, `Perks`, function () {
        let tooltip = `Perks are permanent bonuses with a variety of effects`;
        tooltip += `<br>The bonuses stack multiplicatively; 2 +100% results in 4x speed, not 3x`;
        tooltip += `<br><br>Current Skill bonuses:`;
        const table = document.createElement("table");
        table.className = "table simple-table";
        createThreeElementRow(table, "<h3>Skill</h3>", "<h3>Perk(s)</h3>", "<h3>Bonus</h3>");
        for (const skill_type of GAMESTATE.unlocked_skills) {
            const perk_bonuses = gatherPerkBonuses(skill_type);
            if (perk_bonuses.length <= 0) {
                continue;
            }
            let total_effect = 1;
            let perks_string = "";
            for (const perk_type of perk_bonuses) {
                const perk = PERKS[perk_type];
                perks_string += perk.icon;
                total_effect *= 1 + perk.skill_modifiers.getSkillEffect(skill_type);
            }
            createThreeElementRow(table, getSkillString(skill_type), perks_string, `x${formatNumber(total_effect)}`);
        }
        if (table.children.length == 1) {
            tooltip += "<br>None";
        }
        else {
            tooltip += table.outerHTML;
        }
        return tooltip;
    });
}
function queueUpdateTooltip() {
    if (RENDERING.tooltipped_element) {
        RENDERING.queued_update_tooltip = true;
    }
}
// MARK: Items
function createItemDiv(item, items_div) {
    const button = createChildElement(items_div, "button");
    button.className = "item-button";
    button.classList.add("element");
    const item_definition = ITEMS[item];
    button.innerHTML = `<span class="text">${item_definition.icon}</span>`;
    const count_text = createChildElement(button, "p");
    count_text.className = "item-count";
    button.addEventListener("click", () => {
        // In "add" pick-mode, clicking an artifact schedules it as a task here
        // instead of using it.
        if (RENDERING.artifact_task_mode == "add" && ARTIFACTS.includes(item)) {
            addArtifactTask(item);
            RENDERING.createTasks();
            return;
        }
        // In exclude pick-mode, clicking a regular item adds it to the queue's
        // exclude list instead of using it.
        if (RENDERING.exclude_pick_queue != null && !ARTIFACTS.includes(item)) {
            addQueueExcludedItem(RENDERING.exclude_pick_queue, item);
            setupControls();
            return;
        }
        clickItem(item, false);
    });
    button.addEventListener("contextmenu", (e) => { e.preventDefault(); clickItem(item, true); });
    setupTooltipStaticHeader(button, `${item_definition.name}`, () => `${item_definition.getTooltip()}`);
    RENDERING.item_elements.set(item, button);
}
function setupItemUndoForButton(button) {
    button.addEventListener("click", () => { undoItemUse(); });
    setupTooltip(button, () => {
        const [item_type, amount] = GAMESTATE.undo_item;
        if (item_type == ItemType.Count) {
            return "Undo Last Item Use";
        }
        return `Undo Use of ${amount} ${getItemNameWithIcon(item_type, amount != 1)}`;
    }, () => {
        const [item_type,] = GAMESTATE.undo_item;
        const conditions = "Item undo is available until you start your next Task<br>Using an Item while already having a Task active will prevent undoing<br>Automatically used Items also cannot be undone";
        if (item_type == ItemType.Count) {
            return `<span class="disable-reason">No Item to undo</span><br><br>` + conditions;
        }
        return conditions;
    });
}
function setupItemUndo() {
    setupItemUndoForButton(RENDERING.item_undo_element);
    setupItemUndoForButton(RENDERING.artifact_undo_element);
}
function recreateItemsIfNeeded() {
    const items_div = document.getElementById("items-list");
    if (!items_div) {
        console.error("The element with ID 'items-list' was not found.");
        return;
    }
    const artifacts_div = document.getElementById("artifacts-list");
    if (!artifacts_div) {
        console.error("The element with ID 'artifacts-list' was not found.");
        return;
    }
    const items = [];
    const artifacts = [];
    for (const item of ITEMS_BY_ZONE) {
        const amount = GAMESTATE.items.get(item);
        if (amount !== undefined) {
            const list = ARTIFACTS.includes(item) ? artifacts : items;
            list.push([item, amount]);
        }
    }
    sortItems(items);
    sortItems(artifacts);
    const item_order = [];
    const artifact_order = [];
    for (const [item,] of items) {
        item_order.push(item);
    }
    for (const [item,] of artifacts) {
        artifact_order.push(item);
    }
    if (!areArraysEqual(item_order, RENDERING.item_order)) {
        RENDERING.item_order = item_order;
        items_div.innerHTML = "";
        for (const item of item_order) {
            createItemDiv(item, items_div);
        }
    }
    if (!areArraysEqual(artifact_order, RENDERING.artifact_order)) {
        RENDERING.artifact_order = item_order;
        artifacts_div.innerHTML = "";
        for (const item of artifact_order) {
            createItemDiv(item, artifacts_div);
        }
        const artifacts_container = document.getElementById("artifacts");
        if (!artifacts_container) {
            console.error("The element with ID 'artifacts' was not found.");
            return;
        }
        artifacts_container.classList.remove("hidden");
    }
}
function sortItems(items) {
    items.sort((a, b) => {
        // Items we actually have first
        if ((a[1] == 0) != (b[1] == 0)) {
            return (a[1] == 0) ? 1 : -1;
        }
        // Then just stick with the order provided
        return 0;
    });
}
function setupAutoUseItemsControl(parent) {
    if (!hasPerk(PerkType.Amulet)) {
        return;
    }
    const item_control = document.createElement("button");
    item_control.className = "element";
    function setItemControlName() {
        item_control.textContent = GAMESTATE.auto_use_items ? "Auto Use Items" : "Manual Use Items";
        queueUpdateTooltip();
    }
    setItemControlName();
    item_control.addEventListener("click", () => {
        GAMESTATE.auto_use_items = !GAMESTATE.auto_use_items;
        setItemControlName();
    });
    setupTooltip(item_control, () => { return `${item_control.textContent}`; }, function () {
        let tooltip = "Toggle between items being used automatically, and only being used manually";
        tooltip += "<br>Won't use Artifacts";
        tooltip += "<br><br>Hotkey: I";
        return tooltip;
    });
    parent.appendChild(item_control);
}
function updateItems() {
    RENDERING.item_undo_element.disabled = GAMESTATE.undo_item[0] == ItemType.Count;
    RENDERING.artifact_undo_element.disabled = GAMESTATE.undo_item[0] == ItemType.Count;
    for (const [item, button] of RENDERING.item_elements) {
        const item_count = GAMESTATE.items.get(item);
        // While picking exclusions, keep (non-artifact) items clickable even at
        // zero count, so you can exclude items you don't currently hold. Likewise
        // while picking an artifact to schedule, keep artifacts clickable at zero
        // count, so you can schedule one you don't currently hold.
        const exclude_pickable = RENDERING.exclude_pick_queue != null && !ARTIFACTS.includes(item);
        const artifact_pickable = RENDERING.artifact_task_mode == "add" && ARTIFACTS.includes(item);
        const pickable = exclude_pickable || artifact_pickable;
        button.disabled = item_count == 0 && !pickable;
        button.classList.toggle("disabled", button.disabled);
        const count_text = button.querySelector(".item-count");
        count_text.textContent = `${item_count}`;
    }
}
export function getItemNameWithIcon(item_type, plural = false) {
    const item = ITEMS[item_type];
    return `${item.icon}${plural ? item.name_plural : item.name}`;
}
// MARK: Perks
function createPerkDiv(perk, perks_div, enabled) {
    const perk_div = document.createElement("div");
    perk_div.className = "perk";
    perk_div.classList.add("element");
    perk_div.classList.toggle("disabled", !enabled);
    const perk_text = document.createElement("span");
    perk_text.className = "text";
    const perk_definition = PERKS[perk];
    perk_text.textContent = perk_definition.icon;
    const zone = ZONES.findIndex((zone) => {
        return zone.tasks.find((task) => { return task.perk == perk; }) !== undefined;
    });
    setupTooltip(perk_div, () => `${perk_definition.name}`, () => `${perk_definition.getTooltip()}<br><br>Unlocked in Zone ${zone + 1}`);
    perk_div.appendChild(perk_text);
    perks_div.appendChild(perk_div);
    RENDERING.perk_elements.set(perk, perk_div);
}
function recreatePerks() {
    const perks_div = document.getElementById("perks-list");
    if (!perks_div) {
        console.error("The element with ID 'perks-list' was not found.");
        return;
    }
    perks_div.innerHTML = "";
    const perks = [];
    for (const perk of PERKS_BY_ZONE) {
        if (knowsPerk(perk)) {
            perks.push(perk);
        }
    }
    // Show enabled perks first
    perks.sort((a, b) => {
        return Number(hasPerk(b)) - Number(hasPerk(a));
    });
    for (const perk of perks) {
        createPerkDiv(perk, perks_div, hasPerk(perk));
    }
}
// MARK: Energy reset
function populateEnergyReset(energy_reset_div) {
    const open_button = RENDERING.open_energy_reset_element;
    open_button.disabled = false;
    energy_reset_div.classList.remove("hidden");
    energy_reset_div.innerHTML = "";
    RENDERING.viewing_last_reset = !GAMESTATE.is_in_energy_reset;
    if (GAMESTATE.is_in_energy_reset) {
        energy_reset_div.innerHTML = "<h2>Out of Energy</h2>" +
            "<p>You used up all your Energy, but this is not the end.</p>" +
            (hasPerk(PerkType.UnderstandingTheReset) ? "<p>You keep half your Items (rounded up).</p>" : "<p>You lose your unused Items.</p>") +
            "<p>The effects of used Items disappear.</p>" +
            "<p>You keep all your Skills and Perks.</p>";
    }
    else {
        energy_reset_div.innerHTML = "<h2>Last Run</h2>";
    }
    const hasHadItemInheritance = hasPerk(PerkType.UnderstandingTheReset) || GAMESTATE.prestige_count > 0;
    function handleReset() {
        energy_reset_div.classList.add("hidden");
        doEnergyReset();
        if (shouldShowBossHint()) {
            showHint("You've gotten to Zone 10 now without beating any Bosses.<br>Consider that it might be time to beat one up");
            setHasGottenBossHint();
        }
        else if (shouldShowPrepRunHint()) {
            showHint("You've used Items for the past several runs.<br>Have you considered doing a run without using any Items, so you'll have more items for the next run?");
            setHasGottenPrepRunHint();
        }
    }
    if (!GAMESTATE.is_in_energy_reset || !hasHadItemInheritance) {
        const button = createChildElement(energy_reset_div, "button");
        button.className = "dismiss";
        button.textContent = GAMESTATE.is_in_energy_reset ? "Start the Journey Over, Wiser" : "Dismiss";
        button.addEventListener("click", () => {
            energy_reset_div.classList.add("hidden");
            if (GAMESTATE.is_in_energy_reset) {
                handleReset();
            }
            RENDERING.viewing_last_reset = false;
        });
        setupTooltipStatic(button, button.textContent, GAMESTATE.is_in_energy_reset ? "Do Energy Reset" : "Return to the game");
    }
    else {
        const auto_button = createChildElement(energy_reset_div, "button");
        const no_auto_button = createChildElement(energy_reset_div, "button");
        auto_button.className = "dismiss";
        no_auto_button.className = "dismiss";
        auto_button.textContent = "Reset, With Auto Use Items";
        no_auto_button.textContent = "Reset, Without Auto Use Items";
        auto_button.addEventListener("click", () => {
            GAMESTATE.auto_use_items = true;
            handleReset();
        });
        no_auto_button.addEventListener("click", () => {
            GAMESTATE.auto_use_items = false;
            handleReset();
        });
    }
    const skill_gain = document.createElement("div");
    skill_gain.innerHTML = "";
    createChildElement(skill_gain, "h3").textContent = "Skills gained:";
    const info = GAMESTATE.energy_reset_info;
    for (const [skill, skill_diff] of info.skill_gains) {
        const skill_gain_text = document.createElement("p");
        const skill_definition = SKILL_DEFINITIONS[skill];
        skill_gain_text.textContent = `${skill_definition.icon}${skill_definition.name}: +${skill_diff} (x${calcSkillTaskProgressMultiplierFromLevel(skill_diff).toFixed(2)} speed)`;
        skill_gain.appendChild(skill_gain_text);
    }
    ;
    const power_gain = info.power_at_end - info.power_at_start;
    if (power_gain > 0) {
        const power_gain_text = document.createElement("p");
        const speed_bonus = calcPowerSpeedBonusAtLevel(info.power_at_end) / calcPowerSpeedBonusAtLevel(info.power_at_start);
        power_gain_text.textContent = `${POWER_TEXT}: +${formatInt(power_gain)} (x${speed_bonus.toFixed(2)} speed)`;
        skill_gain.appendChild(power_gain_text);
    }
    const attunement_gain = info.attunement_at_end - info.attunement_at_start;
    if (attunement_gain > 0) {
        const attunement_gain_text = document.createElement("p");
        const speed_bonus = calcAttunementSpeedBonusAtLevel(info.attunement_at_end) / calcAttunementSpeedBonusAtLevel(info.attunement_at_start);
        attunement_gain_text.textContent = `${ATTUNEMENT_TEXT}: +${formatInt(attunement_gain)} (x${speed_bonus.toFixed(2)} speed)`;
        skill_gain.appendChild(attunement_gain_text);
    }
    if (hasPerk(PerkType.EnergeticMemory)) {
        const energetic_memory_gain_text = document.createElement("p");
        energetic_memory_gain_text.textContent = `Max ${ENERGY_TEXT}: +${info.energetic_memory_gain.toFixed(1)} (Energetic Memory Perk)`;
        skill_gain.appendChild(energetic_memory_gain_text);
    }
    if (skill_gain.childNodes.length == 0) {
        const skill_gain_text = document.createElement("p");
        skill_gain_text.textContent = `None`;
        skill_gain.appendChild(skill_gain_text);
    }
    energy_reset_div.appendChild(skill_gain);
    const reset_count = document.createElement("h3");
    reset_count.textContent = GAMESTATE.is_in_energy_reset ? `You've now done your ${formatOrdinal(GAMESTATE.energy_reset_count + 1)} Energy Reset` : `This was your ${formatOrdinal(GAMESTATE.energy_reset_count)} Energy Reset`;
    energy_reset_div.appendChild(reset_count);
}
function setupEnergyReset(energy_reset_div) {
    const open_button = RENDERING.open_energy_reset_element;
    open_button.addEventListener("click", () => {
        populateEnergyReset(RENDERING.energy_reset_element);
        energy_reset_div.classList.remove("hidden");
    });
    open_button.disabled = GAMESTATE.energy_reset_count == 0;
    setupTooltipStaticHeader(open_button, `View Last Energy Reset Summary`, function () {
        let tooltip = `Lets you reopen the last Energy Reset Summary`;
        if (open_button.disabled) {
            tooltip += `<p class="disable-reason">Disabled until you do your first Energy Reset</p>`;
        }
        return tooltip;
    });
}
function populateEndOfContent(end_of_content_div) {
    end_of_content_div.classList.remove("hidden");
    const reset_count = end_of_content_div.querySelector("#end-of-content-reset-count");
    if (!reset_count) {
        console.error("No reset count text");
        return;
    }
    reset_count.innerHTML = `You've done ${GAMESTATE.energy_reset_count} Energy Resets this Prestige`;
    reset_count.innerHTML += `<br>You've done ${GAMESTATE.prestige_count} Prestiges`;
    const energy_reset_button = end_of_content_div.querySelector("#end-of-content-reset");
    if (!energy_reset_button) {
        console.error("No reset button");
        return;
    }
    energy_reset_button.innerHTML = "";
    energy_reset_button.textContent = "Do Energy Reset";
    setupTooltipStatic(energy_reset_button, "Do Energy Reset", "Do a regular Energy Reset to keep on playing");
    energy_reset_button.addEventListener("click", () => {
        doEnergyReset();
    });
    const prestige_button = end_of_content_div.querySelector("#end-of-content-prestige");
    if (!prestige_button) {
        console.error("No prestige button");
        return;
    }
    prestige_button.innerHTML = "";
    prestige_button.textContent = "Prestige";
    setupTooltipStatic(prestige_button, "Prestige", "Do a Prestige to keep on playing");
    prestige_button.addEventListener("click", () => {
        triggerPrestigeConfirmation();
    });
    const credits_button = end_of_content_div.querySelector("#end-of-content-credits");
    if (!credits_button) {
        console.error("No credits button");
        return;
    }
    credits_button.innerHTML = "";
    credits_button.textContent = "Credits";
    setupTooltipStatic(credits_button, "Credits", "View the game's Credits");
    credits_button.addEventListener("click", () => {
        showCredits();
    });
}
function updateGameOver() {
    // Game Mod — skip the energy-reset summary overlay and continue
    // immediately (keeps the current Auto Use Items setting). doEnergyReset
    // restores energy, so this can't re-trigger on the same depletion.
    if (GAMESTATE.is_in_energy_reset && isModEnabled("auto_continue_energy_reset")) {
        RENDERING.energy_reset_element.classList.add("hidden");
        doEnergyReset();
        return;
    }
    const showing_energy_reset = !RENDERING.energy_reset_element.classList.contains("hidden") && !RENDERING.viewing_last_reset;
    if (!showing_energy_reset && GAMESTATE.is_in_energy_reset) {
        populateEnergyReset(RENDERING.energy_reset_element);
    }
    const showing_end_of_content = !RENDERING.end_of_content_element.classList.contains("hidden");
    if (!showing_end_of_content && GAMESTATE.is_at_end_of_content) {
        populateEndOfContent(RENDERING.end_of_content_element);
    }
    else if (showing_end_of_content && !GAMESTATE.is_at_end_of_content) {
        RENDERING.end_of_content_element.classList.add("hidden");
    }
}
// MARK: Prestige
function triggerPrestigeConfirmation() {
    let warning = `Will give ${formatInt(calcDivineSparkGain())} ${DIVINE_SPARK_TEXT}, but reset everything except that which is granted by Divinity purchases`;
    if (!hasPrestigeUnlock(PrestigeUnlockType.SeeBeyondTheVeil)) {
        warning += `<br>Will also remove all Boss Tasks from automation`;
    }
    createConfirmationOverlay("Do Prestige", warning, () => {
        doPrestige();
        populatePrestigeView();
    });
}
function populatePrestigeView() {
    const prestige_overlay = RENDERING.prestige_overlay_element;
    const prestige_div = prestige_overlay.querySelector("#prestige-box");
    if (!prestige_div) {
        console.error("No prestige-box");
        return;
    }
    let scrollTop = 0;
    const existing_scroll_area = prestige_overlay.querySelector(".scroll-area");
    if (existing_scroll_area) {
        scrollTop = existing_scroll_area.scrollTop;
    }
    prestige_div.innerHTML = "";
    const scroll_area = createChildElement(prestige_div, "div");
    scroll_area.className = "scroll-area";
    {
        const close_button = createChildElement(prestige_div, "button");
        close_button.className = "close close-scroll";
        close_button.textContent = "X";
        close_button.addEventListener("click", () => {
            prestige_overlay.classList.add("hidden");
        });
        setupTooltipStatic(close_button, `Close Prestige Menu`, ``);
    }
    {
        const summary_div = createChildElement(scroll_area, "div");
        const header = createChildElement(summary_div, "h1");
        header.textContent = "Divinity";
        const prestige_button = createChildElement(summary_div, "button");
        prestige_button.textContent = "Prestige";
        prestige_button.className = "do-prestige";
        prestige_button.disabled = !GAMESTATE.prestige_available;
        setupTooltipStaticHeader(prestige_button, "Do Prestige Reset", () => {
            let desc = "";
            if (!GAMESTATE.prestige_available) {
                desc += `<p class="disable-reason">Disabled until you complete the <span class="Prestige">Prestige</span> task in Zone 15</p>`;
            }
            desc += `Will reset <b><i>everything</i></b> except that which is granted by Divinity purchases, but gives ${DIVINE_SPARK_TEXT} in return`;
            return desc;
        });
        prestige_button.addEventListener("click", () => {
            triggerPrestigeConfirmation();
        });
        prestige_button.classList.toggle("prestige-glow", GAMESTATE.unlocked_new_prestige_this_prestige);
        const divine_spark = createChildElement(summary_div, "p");
        divine_spark.innerHTML = `${DIVINE_SPARK_TEXT}: ${formatInt(GAMESTATE.divine_spark)} (+${formatInt(calcDivineSparkGain())})<span class="divine-spark-info">ℹ</span>`;
        divine_spark.className = "divine-spark-text";
        setupTooltipStaticHeader(divine_spark, `${DIVINE_SPARK_TEXT} Gain`, () => {
            const dummy_div = document.createElement("div");
            const divine_spark = createChildElement(dummy_div, "p");
            divine_spark.innerHTML = `${DIVINE_SPARK_TEXT} gain if you Prestige now: +${formatInt(calcDivineSparkGain())}`;
            const divine_spark_gain = createChildElement(dummy_div, "p");
            divine_spark_gain.innerHTML = `${DIVINE_SPARK_TEXT} gain formula:<br>100, multiplied by ${formatNumber(getPrestigeGainExponent())} for each Zone past 15`;
            if (hasPerk(PerkType.Awakening)) {
                divine_spark_gain.innerHTML += `<br>Multiplier from ${getPerkNameWithEmoji(PerkType.Awakening)}: ${formatNumber(1 + AWAKENING_DIVINE_SPARK_MULT)}`;
            }
            if (hasPerk(PerkType.DefiedTheGods)) {
                divine_spark_gain.innerHTML += `<br>Multiplier from ${getPerkNameWithEmoji(PerkType.DefiedTheGods)}: ${formatNumber(1 + DEFIED_THE_GODS_SPARK_MULT)}`;
            }
            const divine_spark_gain_stats = createChildElement(dummy_div, "p");
            divine_spark_gain_stats.innerHTML = `Highest Zone reached: ${GAMESTATE.highest_zone + 1}`;
            const potentialReachGain = calcDivineSparkGainFromHighestZone(GAMESTATE.highest_zone + 1) - calcDivineSparkGainFromHighestZone(GAMESTATE.highest_zone);
            divine_spark_gain_stats.innerHTML += `<br><br>Additional ${DIVINE_SPARK_TEXT} for reaching Zone ${GAMESTATE.highest_zone + 2}: ${formatInt(potentialReachGain)}`;
            return dummy_div.innerHTML;
        });
        const prestiges_done_text = createChildElement(summary_div, "p");
        prestiges_done_text.textContent = `Prestiges done: ${GAMESTATE.prestige_count}`;
    }
    const PRESTIGE_LAYER_NAMES = ["Touch the Divine", "Transcend Humanity", "Embrace Divinity", "Ascend to Godhood"];
    for (const prestige_layer of GAMESTATE.prestige_layers_unlocked) {
        const touch_the_divine_div = createChildElement(scroll_area, "div");
        touch_the_divine_div.className = "prestige-section";
        const header = createChildElement(touch_the_divine_div, "h2");
        header.textContent = PRESTIGE_LAYER_NAMES[prestige_layer];
        const unlockables_div = createChildElement(touch_the_divine_div, "div");
        const unlockables_header = createChildElement(unlockables_div, "h3");
        unlockables_header.textContent = "Unlockables";
        const unlockables_purchases = createChildElement(unlockables_div, "div");
        unlockables_purchases.className = "prestige-purchases";
        for (const unlock of PRESTIGE_UNLOCKABLES.filter((unlock) => { return unlock.layer == prestige_layer; })) {
            const is_unlocked = hasPrestigeUnlock(unlock.type);
            const unlock_button = createChildElement(unlockables_purchases, is_unlocked ? "div" : "button");
            unlock_button.className = "prestige-purchase";
            if (is_unlocked) {
                unlock_button.classList.add("prestige-upgrade-unlocked");
            }
            unlock_button.innerHTML = `${unlock.name}`;
            if (!is_unlocked) {
                unlock_button.innerHTML += `<br>Cost: ${formatInt(unlock.cost)}`;
            }
            if (!is_unlocked) {
                unlock_button.disabled = unlock.cost > GAMESTATE.divine_spark;
            }
            setupTooltipStatic(unlock_button, unlock.name, unlock.get_description());
            if (!is_unlocked) {
                unlock_button.addEventListener("click", () => {
                    addPrestigeUnlock(unlock.type);
                    populatePrestigeView();
                });
            }
        }
        const repeatables = PRESTIGE_REPEATABLES.filter((unlock) => { return unlock.layer == prestige_layer; });
        if (repeatables.length != 0) {
            const upgrades_div = createChildElement(touch_the_divine_div, "div");
            const upgrades_header = createChildElement(upgrades_div, "h3");
            upgrades_header.textContent = "Repeatable Upgrades";
            const repeatables_purchases = createChildElement(upgrades_div, "div");
            repeatables_purchases.className = "prestige-purchases";
            for (const upgrade of repeatables) {
                const unlock_button = createChildElement(repeatables_purchases, "button");
                unlock_button.className = "prestige-purchase prestige-purchase-repeatable";
                const cost = calcPrestigeRepeatableCost(upgrade.type);
                const level = getPrestigeRepeatableLevel(upgrade.type);
                unlock_button.innerHTML = `${upgrade.name}<br>Cost: ${formatInt(cost)}<br>Level: ${level}`;
                unlock_button.disabled = cost > GAMESTATE.divine_spark;
                setupTooltipStaticHeader(unlock_button, upgrade.name, () => {
                    let desc = upgrade.get_description();
                    desc += "<br><br>Current Effect: ";
                    switch (upgrade.type) {
                        case PrestigeRepeatableType.DivineKnowledge:
                            desc += `+${formatPercentage(DIVINE_KNOWLEDGE_MULT * level)}`;
                            break;
                        case PrestigeRepeatableType.DivinerKnowledge:
                            desc += `+${formatPercentage(DIVINER_KNOWLEDGE_MULT * level)}`;
                            break;
                        case PrestigeRepeatableType.UnlimitedPower:
                            desc += `x${formatInt(Math.pow(2, level))}`;
                            break;
                        case PrestigeRepeatableType.DivineAppetite:
                            desc += `+${formatPercentage(DIVINE_APPETITE_ENERGY_ITEM_BOOST_MULT * level)}`;
                            break;
                        case PrestigeRepeatableType.GottaGoFast:
                            desc += `x${formatNumber(Math.pow(GOTTA_GO_FAST_BASE, level))}`;
                            break;
                        case PrestigeRepeatableType.DivineLightning:
                            desc += `+${formatNumber(level * DIVINE_LIGHTNING_EXPONENT_INCREASE)}`;
                            break;
                        case PrestigeRepeatableType.TranscendantAptitude:
                            desc += `+${level * TRANSCENDANT_APTITUDE_MULT}`;
                            break;
                        case PrestigeRepeatableType.Energized:
                            desc += `+${level * ENERGIZED_INCREASE}`;
                            desc += ` and +${formatPercentage(level * ENERGIZED_PERK_INCREASE)}`;
                            break;
                        case PrestigeRepeatableType.Deenergized:
                            desc += `x${formatNumber(Math.pow(DEENERGIZED_BASE, level))}`;
                            break;
                        case PrestigeRepeatableType.MandatorySchmandatory:
                            desc += `+${formatPercentage(level * MANDATORY_SCHMANDATORY_MULT)}`;
                            break;
                        case PrestigeRepeatableType.DivineAttunement:
                            desc += `x${formatNumber(Math.pow(DIVINE_ATTUNEMENT_BASE, level))}`;
                            break;
                        case PrestigeRepeatableType.SpiteTheGods:
                            desc += `+${formatPercentage(calcSpiteTheGodsBonus() - 1)}`;
                            break;
                        default:
                            console.error("Unhandled upgrade");
                            break;
                    }
                    return desc;
                });
                unlock_button.addEventListener("click", () => {
                    increasePrestigeRepeatableLevel(upgrade.type);
                    populatePrestigeView();
                });
            }
        }
    }
    scroll_area.scrollTop = scrollTop;
}
function setupOpenPrestige() {
    const prestige_overlay = RENDERING.prestige_overlay_element;
    const open_button = RENDERING.open_prestige_element;
    open_button.addEventListener("click", () => {
        populatePrestigeView();
        prestige_overlay.classList.remove("hidden");
    });
    prestige_overlay.addEventListener("click", (e) => {
        if (e.target == prestige_overlay) { // Clicking outside the window
            prestige_overlay.classList.add("hidden");
        }
    });
    setupTooltip(open_button, function () { return `${DIVINE_SPARK_TEXT} - ${formatInt(GAMESTATE.divine_spark)}`; }, function () {
        const tooltip = `Within this menu you can Prestige to gain ${DIVINE_SPARK_TEXT}, and buy powerful upgrades`;
        return tooltip;
    });
}
// MARK: Formatting
function formatOrdinal(n) {
    const suffix = ["th", "st", "nd", "rd"];
    const remainder = n % 100;
    return n + (suffix[(remainder - 20) % 10] || suffix[remainder] || suffix[0]);
}
export function formatNumber(n, allow_decimals = true) {
    if (n < 0) {
        console.error("Tried to format negative number");
        return n + "";
    }
    if (allow_decimals && n < 10) {
        if (n < 10) {
            return n.toFixed(2);
        }
        else if (n < 100) {
            return n.toFixed(1);
        }
    }
    if (n < 10000) {
        return n.toFixed(0);
    }
    const postfixes = ["k", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
    let postfix_index = -1;
    while (n >= 1000 && (postfix_index + 1) < postfixes.length) {
        n = n / 1000;
        postfix_index++;
    }
    if (n < 10) {
        return n.toFixed(2) + postfixes[postfix_index];
    }
    else if (n < 100) {
        return n.toFixed(1) + postfixes[postfix_index];
    }
    else {
        return n.toFixed(0) + postfixes[postfix_index];
    }
}
export function formatInt(n) {
    return formatNumber(n, false);
}
export function formatPercentage(n) {
    return `${formatInt(n * 100)}%`;
}
// MARK: Settings
// Boolean "Game Mods" toggles shown in the Settings overlay (the
// purple-button set from the prismatic mod, mapped to JtA). The Advanced
// Automation mods live in the Controls section instead (see phase 5).
const SETTINGS_MOD_TOGGLES = [
    {
        id: "mod-force-automation",
        label: "Force Automation",
        tooltip: "Permanently grants the Amulet perk, unlocking Zone Automation and automatic Item use. Turning this off won't remove an Amulet you earned legitimately.",
        mod: "force_automation",
    },
    {
        id: "mod-award-spark-on-discovery",
        label: "Award Spark on Discovery",
        tooltip: "Awards a fraction of the full prestige Divine Spark each time you complete a Prestige task. Manual prestige still awards the full amount on top.",
        mod: "award_spark_on_discovery",
    },
    {
        id: "mod-auto-continue-energy-reset",
        label: "Auto-continue Energy Reset",
        tooltip: "Skips the Energy Reset summary overlay and continues immediately.",
        mod: "auto_continue_energy_reset",
    },
    {
        id: "mod-suppress-prestige-popup",
        label: "Suppress Prestige Popup",
        tooltip: "Suppresses the notification shown when Prestige first becomes available.",
        mod: "suppress_prestige_popup",
    },
];
function setupSettings() {
    const settings_div = RENDERING.settings_element;
    const open_button = document.querySelector("#open-settings");
    if (!open_button) {
        console.error("No open settings button");
        return;
    }
    open_button.addEventListener("click", () => {
        settings_div.classList.remove("hidden");
    });
    setupTooltipStatic(open_button, `Open Settings Menu`, `Deal with saving and tooltips, or view the Changelog and Credits`);
    const close_button = settings_div.querySelector(".close");
    if (!close_button) {
        console.error("No close button");
        return;
    }
    close_button.addEventListener("click", () => {
        settings_div.classList.add("hidden");
    });
    settings_div.addEventListener("click", (e) => {
        if (e.target == settings_div) {
            settings_div.classList.add("hidden");
        }
    });
    setupTooltipStatic(close_button, `Close Settings Menu`, ``);
    setupPersistence(settings_div);
    const changelog_button = settings_div.querySelector("#changelog");
    if (!changelog_button) {
        console.error("No changelog button");
        return;
    }
    setupTooltipStatic(changelog_button, "Open Changelog", "View the full Changelog of Journey to Ascension");
    changelog_button.addEventListener("click", () => {
        showChangelog();
    });
    const changelog_overlay = RENDERING.changelog_overlay_element;
    changelog_overlay.addEventListener("click", (e) => {
        if (e.target == changelog_overlay) { // Clicking outside the window
            changelog_overlay.classList.add("hidden");
        }
    });
    const credits_button = settings_div.querySelector("#credits");
    if (!credits_button) {
        console.error("No credits button");
        return;
    }
    setupTooltipStatic(credits_button, "Open Credits", "View the game credits");
    credits_button.addEventListener("click", () => {
        showCredits();
    });
    const credits_overlay = RENDERING.credits_overlay_element;
    credits_overlay.addEventListener("click", (e) => {
        if (e.target == credits_overlay) { // Clicking outside the window
            credits_overlay.classList.add("hidden");
        }
    });
    const manual_tooltips_button = settings_div.querySelector("#manual-tooltips");
    if (!manual_tooltips_button) {
        console.error("No manual-tooltips button");
        return;
    }
    manual_tooltips_button.addEventListener("click", () => {
        GAMESTATE.manual_tooltips = !GAMESTATE.manual_tooltips;
        updateSettingsDisplay();
        queueUpdateTooltip();
    });
    setupTooltip(manual_tooltips_button, function () { return GAMESTATE.manual_tooltips ? "Switch to Manual Tooltips" : "Switch to Automatic Tooltips"; }, function () {
        return "With Manual Tooltips enabled, tooltips only show up while CTRL is held";
    });
    const skip_blocked_button = settings_div.querySelector("#skip-blocked");
    if (!skip_blocked_button) {
        console.error("No skip-blocked button");
        return;
    }
    skip_blocked_button.addEventListener("click", () => {
        GAMESTATE.automation_skip_blocked = !GAMESTATE.automation_skip_blocked;
        updateSettingsDisplay();
    });
    setupTooltip(skip_blocked_button, function () { return GAMESTATE.automation_skip_blocked ? "Switch to Pause on Blocked Tasks" : "Switch to Skip on Blocked Tasks"; }, function () {
        return "When using Task Autmation, this setting decides what to do if the next queued Task is blocked (E.G., too strong a Boss). Will either pause the automation, or keep running automated with the Task skipped";
    });
    // Game Mods toggles
    for (const toggle of SETTINGS_MOD_TOGGLES) {
        const button = settings_div.querySelector(`#${toggle.id}`);
        if (!button) {
            console.error(`No ${toggle.id} button`);
            continue;
        }
        button.addEventListener("click", () => {
            setMod(toggle.mod, !isModEnabled(toggle.mod));
            updateSettingsDisplay();
            setupControls(); // rebuild so the automation panel appears/hides with the Amulet
            updateRendering(); // reflect other effects immediately
        });
        setupTooltip(button, () => `${toggle.label}: ${isModEnabled(toggle.mod) ? "On" : "Off"}`, () => toggle.tooltip);
    }
    // Discovery spark fraction (decimal, unbounded)
    const fraction_input = settings_div.querySelector("#mod-discovery-fraction");
    if (!fraction_input) {
        console.error("No mod-discovery-fraction input");
    }
    else {
        fraction_input.addEventListener("change", () => {
            const val = parseFloat(fraction_input.value);
            if (!Number.isNaN(val)) {
                setMod("discovery_spark_fraction", val);
            }
            updateSettingsDisplay();
        });
    }
    updateSettingsDisplay();
}
export function updateSettingsDisplay() {
    const settings_div = RENDERING.settings_element;
    const manual_tooltips_button = settings_div.querySelector("#manual-tooltips");
    if (!manual_tooltips_button) {
        console.error("No manual-tooltips button");
        return;
    }
    manual_tooltips_button.textContent = GAMESTATE.manual_tooltips ? "Manual Tooltips" : "Auto Tooltips";
    const skip_blocked_button = settings_div.querySelector("#skip-blocked");
    if (!skip_blocked_button) {
        console.error("No skip-blocked button");
        return;
    }
    skip_blocked_button.textContent = GAMESTATE.automation_skip_blocked ? "Skip on Block" : "Pause on Block";
    // Game Mods toggle labels
    for (const toggle of SETTINGS_MOD_TOGGLES) {
        const button = settings_div.querySelector(`#${toggle.id}`);
        if (button) {
            button.textContent = `${toggle.label}: ${isModEnabled(toggle.mod) ? "On" : "Off"}`;
        }
    }
    // Discovery spark fraction (don't clobber the field while it's being edited)
    const fraction_input = settings_div.querySelector("#mod-discovery-fraction");
    if (fraction_input && document.activeElement !== fraction_input) {
        fraction_input.value = `${getMod("discovery_spark_fraction")}`;
    }
}
// MARK: Settings: Saves
function setupPersistence(settings_div) {
    const save_button = settings_div.querySelector("#save");
    if (!save_button) {
        console.error("No save button");
        return;
    }
    save_button.addEventListener("click", () => {
        saveGame();
        const save_data = localStorage.getItem(SAVE_LOCATION);
        if (!save_data) {
            console.error("No save data");
            return;
        }
        let file_name = "JourneyToAscension";
        if (GAMESTATE.prestige_count > 0) {
            file_name += "_Prestige" + GAMESTATE.prestige_count;
        }
        file_name += `_Reset_${GAMESTATE.energy_reset_count}_energy_${GAMESTATE.current_energy.toFixed(0)}`;
        const blob = new Blob([save_data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file_name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });
    setupTooltipStatic(save_button, `Export Save`, `Save the game's progress to disk`);
    const load_button = settings_div.querySelector("#load");
    if (!load_button) {
        console.error("No load button");
        return;
    }
    load_button.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json";
        input.addEventListener("change", (e) => {
            const element = e.target;
            const file = element.files[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = (event) => {
                if (!event.target) {
                    return;
                }
                const fileText = event.target.result;
                localStorage.setItem(SAVE_LOCATION, fileText);
                location.reload();
            };
            reader.readAsText(file);
        });
        input.click();
    });
    setupTooltipStatic(load_button, `Import Save`, `Load the game's progress from disk`);
    const reset_button = settings_div.querySelector("#reset-save");
    if (!reset_button) {
        console.error("No reset-save button");
        return;
    }
    reset_button.addEventListener("click", () => {
        createConfirmationOverlay("Reset Save", `Will reset absolutely all progress. It's highly recommendex you export a Save first`, () => {
            resetSave();
        });
    });
    setupTooltipStatic(reset_button, `Reset Save`, `Resets *everything*`);
}
// MARK: Events
function handleEvents() {
    const events = GAMESTATE.popRenderEvents();
    const messages = RENDERING.messages_element;
    for (const event of events) {
        if (event.type == EventType.TaskCompleted) {
            queueUpdateTooltip();
            continue; // No message, just forces tooltips to update
        }
        if (event.type == EventType.GainedItem) {
            if (RENDERING.item_elements.size != GAMESTATE.items.size) {
                recreateTasks(); // Get rid of potential glow
            }
            recreateItemsIfNeeded();
            continue; // No message, just forces item list to update
        }
        const message_div = document.createElement("div");
        message_div.className = "message";
        let message_to_replace = null;
        function removeMessage(message) {
            messages.removeChild(message);
            RENDERING.message_contexts.delete(message);
        }
        let context = event.context;
        if (event.type == EventType.UsedItem) {
            const new_item_context = context;
            const is_artifact = ARTIFACTS.includes(new_item_context.item);
            let event_count = 0;
            for (const [message, old_event] of RENDERING.message_contexts) {
                if (old_event.type == EventType.UsedItem) {
                    const old_item_context = old_event.context;
                    if (old_item_context.item == new_item_context.item) {
                        new_item_context.count += old_item_context.count;
                        message_to_replace = message;
                    }
                    else {
                        event_count++;
                    }
                }
                else if (old_event.type == EventType.UsedItems && !is_artifact) {
                    const old_item_context = old_event.context;
                    old_item_context.count += new_item_context.count;
                    event.type = EventType.UsedItems;
                    context = old_item_context;
                    event.context = old_item_context;
                    message_to_replace = message;
                }
            }
            // Consolidate multiple item uses
            if (event_count >= 3 && !is_artifact) {
                let count = new_item_context.count;
                for (const [message, old_event] of RENDERING.message_contexts) {
                    if (old_event.type != EventType.UsedItem) {
                        continue;
                    }
                    const old_item_context = old_event.context;
                    if (ARTIFACTS.includes(old_item_context.item)) {
                        continue;
                    }
                    count += old_item_context.count;
                    removeMessage(message);
                    message_to_replace = null;
                }
                context = { count: count };
                event.type = EventType.UsedItems;
                event.context = context;
            }
        }
        else if (event.type == EventType.SkillUp) {
            const new_skill_context = context;
            for (const [message, old_event] of RENDERING.message_contexts) {
                if (old_event.type == event.type) {
                    const old_skill_context = old_event.context;
                    if (old_skill_context.skill == new_skill_context.skill) {
                        new_skill_context.levels_gained += old_skill_context.levels_gained;
                        message_to_replace = message;
                    }
                }
            }
        }
        else if (event.type == EventType.SkippedTasks) {
            const new_context = context;
            for (const [message, old_event] of RENDERING.message_contexts) {
                if (old_event.type == event.type) {
                    const old_context = old_event.context;
                    new_context.tasks += old_context.tasks;
                    message_to_replace = message;
                }
            }
        }
        switch (event.type) {
            case EventType.SkillUp:
                {
                    const skill_context = context;
                    const skill_definition = SKILL_DEFINITIONS[skill_context.skill];
                    message_div.textContent = `${skill_definition.icon}${skill_definition.name} is now ${skill_context.new_level} (+${skill_context.levels_gained})`;
                    break;
                }
            case EventType.GainedPerk:
                {
                    const perk_context = context;
                    const perk = PERKS[perk_context.perk];
                    message_div.innerHTML = `Unlocked ${perk.icon}${perk.name}`;
                    message_div.innerHTML += `<br>${perk.getTooltip()}`;
                    setupControls(); // Show the automation controls
                    recreateTasks(); // Get rid of Perk indicator
                    recreatePerks();
                    break;
                }
            case EventType.UsedItem:
                {
                    const item_context = context;
                    const item = ITEMS[item_context.item];
                    const plural = item_context.count > 1;
                    message_div.innerHTML = `Used ${item_context.count} ${getItemNameWithIcon(item_context.item, plural)}`;
                    message_div.innerHTML += `<br>${item.getEffectText(item_context.count)}`;
                    recreateItemsIfNeeded();
                    break;
                }
            case EventType.UsedItems:
                {
                    const item_context = context;
                    message_div.innerHTML = `Used ${item_context.count} Items`;
                    recreateItemsIfNeeded();
                    break;
                }
            case EventType.UndidItem:
                {
                    const item_context = context;
                    const plural = item_context.count > 1;
                    message_div.innerHTML = `Undid use of ${item_context.count} ${getItemNameWithIcon(item_context.item, plural)}`;
                    recreateItemsIfNeeded();
                    break;
                }
            case EventType.UnlockedTask:
                {
                    const unlock_context = context;
                    message_div.innerHTML = `Unlocked Task ${unlock_context.task_definition.name}`;
                    recreateTasks();
                    break;
                }
            case EventType.UnlockedSkill:
                {
                    const unlock_skill_context = context;
                    const skill_definition = SKILL_DEFINITIONS[unlock_skill_context.skill];
                    message_div.innerHTML = `Unlocked Skill ${skill_definition.icon}${skill_definition.name}`;
                    recreateSkills();
                    break;
                }
            case EventType.UnlockedPower:
                {
                    message_div.innerHTML = `Unlocked 💪Power mechanic`;
                    message_div.innerHTML += `<br>Boosts ${getSkillString(SkillType.Combat)} and ${getSkillString(SkillType.Fortitude)}`;
                    recreateTasks();
                    break;
                }
            case EventType.PrestigeAvailable:
                {
                    message_div.innerHTML = `Prestige now availble`;
                    message_div.innerHTML += `<br>Lets you reset most everything to gain the ${DIVINE_SPARK_TEXT} currency`;
                    recreateTasks();
                    break;
                }
            case EventType.NewPrestigeLayer:
                {
                    message_div.innerHTML = `Unlocked more Prestige upgrades`;
                    break;
                }
            case EventType.AwardedSparkOnDiscovery:
                {
                    const spark_context = context;
                    message_div.innerHTML = `Discovery reward: +${formatInt(spark_context.amount)} ${DIVINE_SPARK_TEXT}`;
                    break;
                }
            case EventType.ThresholdStall:
                {
                    message_div.innerHTML = `Automation is idle: every remaining Task is over its Energy Threshold`;
                    break;
                }
            case EventType.NewHighestZone:
            case EventType.NewHighestZoneFullyCompleted:
                {
                    const highest_zone_context = context;
                    message_div.innerHTML = `New highest Zone${event.type == EventType.NewHighestZoneFullyCompleted ? " fully completed" : ""}: ${highest_zone_context.zone + 1}`;
                    break;
                }
            case EventType.SkippedZones:
                {
                    message_div.innerHTML = `Skipped to Zone ${GAMESTATE.current_zone + 1} thanks to ${getPerkNameWithEmoji(PerkType.MinorTimeCompression)}`;
                    break;
                }
            case EventType.SkippedTasks:
                {
                    const skipped_tasks_context = context;
                    const num = skipped_tasks_context.tasks;
                    message_div.innerHTML = `Skipped ${num} ${num > 1 ? "Tasks" : "Task"} thanks to Mastery of Time`;
                    break;
                }
            default:
                break;
        }
        messages.insertBefore(message_div, message_to_replace ? message_to_replace : messages.firstChild);
        RENDERING.message_contexts.set(message_div, event);
        if (message_to_replace) {
            removeMessage(message_to_replace);
        }
        while (messages.children.length > 5) {
            removeMessage(messages.lastElementChild);
        }
        setTimeout(() => {
            if (message_div.parentNode) {
                removeMessage(message_div);
            }
        }, 5000);
    }
}
// MARK: Controls
export function setupControls() {
    RENDERING.controls_list_element.innerHTML = "";
    // First row: toggle buttons
    const toggles_row = createChildElement(RENDERING.controls_list_element, "div");
    toggles_row.className = "controls-row";
    setupRepeatTasksControl(toggles_row);
    setupAutoUseItemsControl(toggles_row);
    // Second row: automation (with border)
    setupAutomationControls();
}
function setupRepeatTasksControl(parent) {
    const rep_control = document.createElement("button");
    rep_control.className = "element";
    function setRepControlName() {
        rep_control.textContent = GAMESTATE.repeat_tasks ? "Repeat Tasks" : "Don't Repeat Tasks";
        queueUpdateTooltip();
    }
    setRepControlName();
    rep_control.addEventListener("click", () => {
        toggleRepeatTasks();
        setRepControlName();
    });
    setupTooltip(rep_control, function () { return rep_control.textContent; }, function () {
        return "Toggle between repeating Tasks if they have multiple reps, or only doing a single rep<br>When repeating, the Task tooltip will show the numbers for doing all remaining reps rather than just one<br><br>Hotkey: R";
    });
    parent.appendChild(rep_control);
}
// MARK: Controls - Automation
function toggleAutomationMode(mode) {
    if (mode == GAMESTATE.automation_mode) {
        setAutomationMode(AutomationMode.Off);
    }
    else {
        setAutomationMode(mode);
    }
    setupControls();
}
function setupAutomationControls() {
    if (!hasPerk(PerkType.Amulet)) {
        return;
    }
    const automation_div = createChildElement(RENDERING.controls_list_element, "div");
    automation_div.className = "automation";
    const automation_text = createChildElement(automation_div, "div");
    automation_text.className = "automation-text";
    automation_text.textContent = "Task Automation";
    const automation_controls_div = createChildElement(automation_div, "div");
    automation_controls_div.className = "automation-controls";
    const all_control = createChildElement(automation_controls_div, "button");
    const to_zone_disabled = GAMESTATE.automation_mode != AutomationMode.All && GAMESTATE.current_zone >= GAMESTATE.automation_end;
    all_control.disabled = to_zone_disabled;
    function updateZoneButtonText() {
        all_control.innerHTML = `To<br>Zone ${GAMESTATE.automation_end}`;
    }
    updateZoneButtonText();
    const { input: until_zone_input } = createNumericInput(automation_controls_div, {
        min: 1,
        max: 99,
        initialValue: GAMESTATE.automation_end,
        onChange: (value) => {
            setAutomationEndZone(value);
            setupControls();
        },
        ariaLabel: "Target zone for automation"
    });
    const zone_control = createChildElement(automation_controls_div, "button");
    zone_control.textContent = "Current Zone";
    all_control.className = GAMESTATE.automation_mode == AutomationMode.All ? "on" : "off";
    zone_control.className = GAMESTATE.automation_mode == AutomationMode.Zone ? "on" : "off";
    all_control.addEventListener("click", () => {
        toggleAutomationMode(AutomationMode.All);
    });
    zone_control.addEventListener("click", () => {
        toggleAutomationMode(AutomationMode.Zone);
    });
    setupTooltip(all_control, function () { return `Automate To Zone ${GAMESTATE.automation_end}`; }, function () {
        let tooltip = ``;
        if (to_zone_disabled) {
            tooltip += `<p class="disable-reason">Disabled due to the target Zone (${GAMESTATE.automation_end + 1}) not being higher than the current Zone (${GAMESTATE.current_zone + 1})</p>`;
        }
        tooltip += `Toggle between no automation, and automating Tasks until the specified Zone (${GAMESTATE.automation_end}) is reached`;
        tooltip += "<br>Right-click Tasks to designate them as automated";
        tooltip += "<br>They'll be executed in the order you right-clicked them, as indicated by the number in their corner";
        tooltip += "<br><br>Hotkey: A";
        return tooltip;
    });
    setupTooltip(zone_control, function () { return `Automate ${zone_control.textContent}`; }, function () {
        let tooltip = "Toggle between no automation, automating Tasks in the current zone";
        tooltip += "<br>Right-click Tasks to designate them as automated";
        tooltip += "<br>They'll be executed in the order you right-clicked them, as indicated by the number in their corner";
        tooltip += "<br><br>Hotkey: Z";
        return tooltip;
    });
    setupTooltip(until_zone_input, function () { return `Specify Target Zone`; }, function () {
        const tooltip = "The Zone you specify here will be used by the 'To Zone' automation";
        return tooltip;
    });
    setupAdvancedAutomationControls(automation_div);
}
// Game Mods — extra automation toggles, shown as a collapsible panel under
// the Task Automation controls (Amulet-gated, since the parent is).
const ADVANCED_AUTOMATION_TOGGLES = [
    {
        label: "Resume on Reset",
        tooltip: "Keep automating after an Energy Reset instead of stopping. Restores the automation mode that was active before the reset.",
        mod: "resume_automation_on_reset",
    },
    {
        label: "Auto Scroll of Haste",
        tooltip: "Automatically spend held Scrolls of Haste during automation, on Task reps you couldn't otherwise afford — when a single rep would cost more energy than you have left. The Scroll's speed-up lowers that rep's energy cost so the run can continue. Only acts while Auto Use Items is enabled, so under an Auto Use Cycle it runs only on the cycles that spend items.",
        mod: "auto_haste",
    },
    {
        label: "Auto Bottled Lightning",
        tooltip: "Automatically spend held Bottled Lightning on Boss Tasks during automation, on reps you couldn't otherwise afford — when a single rep would cost more energy than you have left. The Lightning's speed-up lowers that Boss rep's energy cost so the run can continue. Like Auto Scroll of Haste, but only for Bosses. Only acts while Auto Use Items is enabled.",
        mod: "auto_lightning",
    },
    {
        label: "Auto Magic Ring",
        tooltip: "Automatically spend held Magic Rings (5x XP for one rep) where they help most: the Tasks completed by your last comparable run — history is kept separately per queue (Queue Cycle) and per banking/spending phase (Auto Use Cycle) — are ranked by the extra skill levels a Ring would earn at your current skills, and Tasks ranked within your Ring budget (Rings held plus Rings already spent this run) each get one Ring when they start. Rings found mid-run widen the budget immediately. Needs one completed run of matching history; only acts while Auto Use Items is enabled.",
        mod: "auto_ring",
    },
    {
        label: "Use Free Items",
        tooltip: "Even on cycles where Auto Use Items is off, automatically use Items you can spend without reducing how many you keep on the next Energy Reset (the surplus left by the keep rounding). Each Item is used once the last Task rep that could grant it this cycle has finished, so its kept count is unaffected. Artifacts (such as Scrolls of Haste) are excluded.",
        mod: "auto_use_free_items",
    },
    {
        label: "Artifact Tasks: Item Cycles Only",
        tooltip: "Only run scheduled artifact tasks (the Artifacts section of the task list) on item cycles — i.e. while Auto Use Items is enabled. On banking cycles they're skipped, so artifacts are saved instead of spent.",
        mod: "artifact_tasks_item_cycle_only",
    },
];
function setupAdvancedAutomationControls(parent) {
    const panel = createChildElement(parent, "div");
    panel.className = "advanced-automation";
    const header = createChildElement(panel, "div");
    header.className = "advanced-automation-header";
    const title = createChildElement(header, "span");
    title.textContent = "Advanced Automation";
    const toggle_icon = createChildElement(header, "span");
    toggle_icon.className = "advanced-automation-icon";
    toggle_icon.textContent = GAMESTATE.mods_automation_panel_collapsed ? "▶" : "▼";
    const content = createChildElement(panel, "div");
    content.className = "advanced-automation-content";
    content.style.display = GAMESTATE.mods_automation_panel_collapsed ? "none" : "flex";
    header.addEventListener("click", () => {
        GAMESTATE.mods_automation_panel_collapsed = !GAMESTATE.mods_automation_panel_collapsed;
        content.style.display = GAMESTATE.mods_automation_panel_collapsed ? "none" : "flex";
        toggle_icon.textContent = GAMESTATE.mods_automation_panel_collapsed ? "▶" : "▼";
    });
    setupEditPrioritiesControl(content);
    setupAutoFillControl(content);
    setupAutoPrioritizeControl(content);
    setupAutoFillOrderControl(content);
    for (const toggle of ADVANCED_AUTOMATION_TOGGLES) {
        const button = createChildElement(content, "button");
        function refresh() {
            button.className = isModEnabled(toggle.mod) ? "on" : "off";
            button.textContent = `${toggle.label}: ${isModEnabled(toggle.mod) ? "On" : "Off"}`;
        }
        refresh();
        button.addEventListener("click", () => {
            setMod(toggle.mod, !isModEnabled(toggle.mod));
            refresh();
        });
        setupTooltip(button, () => `${toggle.label}: ${isModEnabled(toggle.mod) ? "On" : "Off"}`, () => toggle.tooltip);
    }
    setupAutoDreamcatcherControl(content);
    setupAutoUseCycleControl(content);
    setupQueueCycleControl(content);
    setupThresholdControls(content);
}
// Auto Dreamcatcher (Game Mod): a toggle plus the trigger percentage. A
// Dreamcatcher duplicates every Item type found this energy reset, so it's
// best used late in the run; "late" is proxied by the next rep costing at
// least this percentage of current Energy.
function setupAutoDreamcatcherControl(content) {
    const on = GAMESTATE.mods.auto_dreamcatcher;
    const button = createChildElement(content, "button");
    button.className = on ? "on" : "off";
    button.textContent = `Auto Dreamcatcher: ${on ? "On" : "Off"}`;
    button.addEventListener("click", () => {
        setMod("auto_dreamcatcher", !GAMESTATE.mods.auto_dreamcatcher);
        setupControls(); // rebuild: shows/hides the trigger input
    });
    setupTooltip(button, () => `Auto Dreamcatcher: ${GAMESTATE.mods.auto_dreamcatcher ? "On" : "Off"}`, () => "Automatically use a held Dreamcatcher (duplicates one copy of every Item type found this Energy Reset) before a Task rep that would consume at least the set percentage of your current Energy — i.e. when the run is winding down and the haul is near its biggest. One Dreamcatcher per qualifying rep. Only acts while Auto Use Items is enabled.");
    if (!on) {
        return;
    }
    const label = createChildElement(content, "label");
    label.className = "advanced-automation-label";
    label.textContent = "Trigger at % of current Energy:";
    createNumericInput(label, {
        min: 1,
        max: 100,
        initialValue: GAMESTATE.mods.auto_dreamcatcher_pct,
        ariaLabel: "Auto Dreamcatcher trigger, % of current Energy the next rep would consume",
        onChange: (value) => {
            setMod("auto_dreamcatcher_pct", value);
        },
    });
}
// Edit Priorities: enters/leaves the zone-navigable priority edit mode. Styled
// like the other Advanced Automation buttons.
function setupEditPrioritiesControl(content) {
    const editing = isEditMode();
    const button = createChildElement(content, "button");
    button.className = editing ? "on" : "off";
    button.textContent = editing ? "Done Editing Priorities" : "Edit Priorities";
    button.addEventListener("click", () => {
        if (editing) {
            exitEditMode();
        }
        else if (!enterEditMode()) {
            flashMessage("Stop the current task before editing priorities.");
            return;
        }
        refreshAfterEditChange();
    });
    setupTooltip(button, () => editing ? "Done editing" : "Edit priorities", () => "Browse the zones you've reached and set Task automation priorities for each, without anything running. Requires no Task to be in progress.");
}
// Energy Thresholds (Game Mod): skip prioritized Tasks that fail a
// per-category judgment — Energy per skill level earned (/lvl), the rep's
// total Energy (/rep), or estimated Energy Resets until fully completable
// (/rst), switchable per row. One row per category: a toggle (Off = that
// category is exempt and always runs), the metric switch, and the value (a
// percentage of max Energy for /lvl and /rep, a reset count for /rst).
// Categories match getThresholdCategory's precedence.
const THRESHOLD_ROWS = [
    {
        label: "New Perk (finishable)",
        tooltip: "Tasks that award a Perk you haven't earned this Prestige, when finishing all remaining reps fits in your current Energy — counting the speed-up your held Scrolls of Haste (and, for Bosses, Bottled Lightning) could provide.",
        enabled: "threshold_perk_affordable_enabled",
        pct: "threshold_perk_affordable_pct",
        metric: "threshold_perk_affordable_metric",
        resets: "threshold_perk_affordable_resets",
    },
    {
        label: "New Perk (out of reach)",
        tooltip: "Tasks that award a Perk you haven't earned this Prestige, when finishing all remaining reps does NOT fit in your current Energy, even counting your Artifacts' speed-ups.",
        enabled: "threshold_perk_unaffordable_enabled",
        pct: "threshold_perk_unaffordable_pct",
        metric: "threshold_perk_unaffordable_metric",
        resets: "threshold_perk_unaffordable_resets",
    },
    {
        label: "Unlocks a Task",
        tooltip: "Tasks whose unlock target you haven't unlocked yet — in practice, the Bosses that reveal a hidden follow-up Task. Once the unlock is done (unlocks persist across Energy Resets, until Prestige), the Task counts as an Item task instead.",
        enabled: "threshold_unlocker_enabled",
        pct: "threshold_unlocker_pct",
        metric: "threshold_unlocker_metric",
        resets: "threshold_unlocker_resets",
    },
    {
        label: "Awards an Item",
        tooltip: "Tasks that award an Item on each rep (and don't award an unearned Perk or a still-locked unlock).",
        enabled: "threshold_item_enabled",
        pct: "threshold_item_pct",
        metric: "threshold_item_metric",
        resets: "threshold_item_resets",
    },
    {
        label: "Progression",
        tooltip: "Travel, Mandatory, and Prestige Tasks — the ones required to reach the next Zone. Avoid /lvl here: their value is progression, not XP, and a high skill level makes Energy-per-level explode and strand the run.",
        enabled: "threshold_progression_enabled",
        pct: "threshold_progression_pct",
        metric: "threshold_progression_metric",
        resets: "threshold_progression_resets",
    },
    {
        label: "Everything else",
        tooltip: "Tasks that fit none of the other categories.",
        enabled: "threshold_other_enabled",
        pct: "threshold_other_pct",
        metric: "threshold_other_metric",
        resets: "threshold_other_resets",
    },
];
function setupThresholdControls(content) {
    const on = GAMESTATE.mods.threshold_master;
    const master = createChildElement(content, "button");
    master.className = on ? "on" : "off";
    master.textContent = `Energy Thresholds: ${on ? "On" : "Off"}`;
    master.addEventListener("click", () => {
        setMod("threshold_master", !GAMESTATE.mods.threshold_master);
        setupControls(); // rebuild: shows/hides the per-category rows
    });
    setupTooltip(master, () => `Energy Thresholds: ${GAMESTATE.mods.threshold_master ? "On" : "Off"}`, () => "Skip prioritized Tasks that fail their category's judgment. Each category picks its metric: /lvl (Energy per skill level earned vs a % of max Energy — \"worth it as XP?\"), /rep (the rep's total Energy vs that % — \"can I afford it?\"), or /rst (estimated Energy Resets until fully completable vs a count — \"reachable soon?\", the default). Each category can be toggled off to exempt it — its Tasks then always run.");
    if (!on) {
        return;
    }
    const ALL_SKIPPED_LABELS = ["Idle", "End Run", "Best Task"];
    const all_skipped = createChildElement(content, "button");
    function refreshAllSkipped() {
        const action = GAMESTATE.mods.threshold_all_skipped;
        all_skipped.className = action == THRESHOLD_ALL_SKIPPED_IDLE ? "off" : "on";
        all_skipped.textContent = `When All Skipped: ${ALL_SKIPPED_LABELS[action] ?? "Idle"}`;
    }
    refreshAllSkipped();
    all_skipped.addEventListener("click", () => {
        setMod("threshold_all_skipped", (GAMESTATE.mods.threshold_all_skipped + 1) % 3);
        refreshAllSkipped();
    });
    setupTooltip(all_skipped, () => `When All Skipped: ${ALL_SKIPPED_LABELS[GAMESTATE.mods.threshold_all_skipped] ?? "Idle"}`, () => "What automation does when every remaining prioritized Task is over its Energy Threshold. Click to cycle.<br><br>Idle: stop and show a notification.<br>End Run: trigger the Energy Reset — leftover Energy was only spendable at rates you've said aren't worth it.<br>Best Task: run the skipped Task that would earn the most total skill levels from your remaining Energy (re-chosen every rep as Energy drains), so the run ends by conversion rather than idling.");
    for (const row of THRESHOLD_ROWS) {
        const row_div = createChildElement(content, "div");
        row_div.className = "threshold-row";
        const button = createChildElement(row_div, "button");
        function refresh() {
            button.className = isModEnabled(row.enabled) ? "on" : "off";
            button.textContent = row.label;
        }
        refresh();
        button.addEventListener("click", () => {
            setMod(row.enabled, !isModEnabled(row.enabled));
            refresh();
        });
        const metric = GAMESTATE.mods[row.metric];
        const skip_when = metric == THRESHOLD_METRIC_RESETS ? "completing it would take more Energy Resets than the set count"
            : metric == THRESHOLD_METRIC_REP ? "one rep costs more than the set percentage of max Energy"
                : "one skill level costs more than the set percentage of max Energy";
        setupTooltip(button, () => `${row.label}: ${isModEnabled(row.enabled) ? "On" : "Off"}`, () => `${row.tooltip}<br><br>On: skip these Tasks when ${skip_when}. Off: these Tasks are exempt and always run.`);
        const mode_button = createChildElement(row_div, "button");
        mode_button.classList.add("threshold-mode");
        mode_button.textContent =
            metric == THRESHOLD_METRIC_RESETS ? "/rst"
                : metric == THRESHOLD_METRIC_REP ? "/rep"
                    : "/lvl";
        mode_button.addEventListener("click", () => {
            setMod(row.metric, (metric + 1) % 3);
            setupControls(); // rebuild: the value input's meaning and range change with the metric
        });
        setupTooltip(mode_button, () => metric == THRESHOLD_METRIC_RESETS ? "Metric: Energy Resets to complete"
            : `Metric: % of max Energy ${metric == THRESHOLD_METRIC_REP ? "per rep" : "per skill level"}`, () => "What this category's number measures. Click to cycle.<br><br>/lvl: Energy one rep costs divided by the skill levels it would earn — \"is this worth the Energy as XP?\". Beware on progression-style Tasks: a high skill level makes this explode.<br>/rep: the rep's total Energy cost — \"can I afford to just do this?\".<br>/rst: how many Energy Resets it would take until the Task could be fully completed, assuming runs like right now (current remaining Energy and boosts) spent grinding it — \"is this reachable soon?\". 0 means it must be completable this run.");
        if (metric == THRESHOLD_METRIC_RESETS) {
            createNumericInput(row_div, {
                min: 0,
                max: 99,
                initialValue: GAMESTATE.mods[row.resets],
                ariaLabel: `${row.label} threshold, max Energy Resets to complete`,
                onChange: (value) => {
                    setMod(row.resets, value);
                },
            });
        }
        else {
            createNumericInput(row_div, {
                min: 1,
                max: 1000,
                initialValue: GAMESTATE.mods[row.pct],
                ariaLabel: `${row.label} threshold, % of max Energy ${metric == THRESHOLD_METRIC_REP ? "per rep" : "per skill level"}`,
                onChange: (value) => {
                    setMod(row.pct, value);
                },
            });
        }
    }
}
// Auto-Fill Priorities: one click overwrites every reached zone's priority
// list with the heuristic order from autoFillPriorities. An action button,
// not a toggle — styled like Edit Priorities.
function setupAutoFillControl(content) {
    const button = createChildElement(content, "button");
    button.className = "off";
    button.textContent = "Auto-Fill Priorities";
    button.addEventListener("click", () => {
        autoFillAllPriorities();
        recreateTasks(); // refresh the priority numbers on the task list
        flashMessage(`Auto-filled priorities for Zones 1-${GAMESTATE.highest_zone + 1}.`);
    });
    setupTooltip(button, () => "Auto-Fill Priorities", () => "Overwrite ALL reached Zones' automation priorities with a heuristic order: Item-awarding Tasks first, then unearned Perk Tasks (cheapest to finish first), then Prestige Tasks (cheap, one-shot, and the fresh Items boost them), then Task-unlockers, then the rest by skill levels per Energy, with Mandatory and Travel last. Combine with Energy Thresholds to skip whatever isn't currently worth running, and Edit Priorities for touch-ups. Newly unlocked or newly reached content isn't added automatically — click again to include it.");
}
// Auto-Fill Order: the player-configurable category order behind Auto-Fill
// Priorities / Auto-Prioritize. One row per category with up/down arrows;
// reordering takes effect immediately while the autopilot is on.
const AUTO_FILL_CATEGORY_LABELS = {
    item: { label: "Awards an Item", tooltip: "Tasks that award an Item on each rep." },
    perk: { label: "New Perks", tooltip: "Tasks whose Perk you haven't earned this Prestige, cheapest to finish first. Earned Perks sort as Everything Else." },
    prestige: { label: "Prestige", tooltip: "Prestige Tasks — one-shot and cheap for their Zone; early completion enables Prestige (and Discovery Spark every run, with that mod on)." },
    unlocker: { label: "Unlocks a Task", tooltip: "Tasks whose unlock target is still locked. Once unlocked they sort by their remaining traits (usually Awards an Item)." },
    plain: { label: "Everything Else", tooltip: "Tasks that fit no other category, ordered by skill levels per Energy." },
    mandatory: { label: "Mandatory", tooltip: "Mandatory Tasks — required (with Prestige Tasks) before Travel unlocks." },
    travel: { label: "Travel", tooltip: "The Zone's Travel Task. Moving this off the end makes automation leave a Zone as soon as Travel is enabled." },
};
function setupAutoFillOrderControl(content) {
    const collapsed = GAMESTATE.auto_fill_order_collapsed;
    const header = createChildElement(content, "button");
    header.className = collapsed ? "off" : "on";
    header.textContent = `Auto-Fill Order ${collapsed ? "▶" : "▼"}`;
    header.addEventListener("click", () => {
        GAMESTATE.auto_fill_order_collapsed = !GAMESTATE.auto_fill_order_collapsed;
        setupControls();
    });
    setupTooltip(header, () => "Auto-Fill Order", () => "The category order Auto-Fill Priorities and Auto-Prioritize use: within each Zone, Tasks are grouped by category and the groups are laid out in this order. Rearrange with the arrows; changes apply immediately while Auto-Prioritize is on. The default is: Items, New Perks, Prestige, Unlockers, Everything Else, Mandatory, Travel.");
    if (collapsed) {
        return;
    }
    const order = getAutoFillOrder();
    order.forEach((category, index) => {
        const info = AUTO_FILL_CATEGORY_LABELS[category] ?? { label: category, tooltip: "" };
        const row = createChildElement(content, "div");
        row.className = "threshold-row";
        const label = createChildElement(row, "span");
        label.className = "auto-fill-order-label";
        label.textContent = `${index + 1}. ${info.label}`;
        setupTooltip(label, () => info.label, () => info.tooltip);
        const up = createChildElement(row, "button");
        up.classList.add("threshold-mode");
        up.textContent = "↑";
        up.disabled = index == 0;
        up.addEventListener("click", () => {
            moveAutoFillCategory(category, -1);
            setupControls();
            recreateTasks(); // the autopilot may have refilled priorities
        });
        const down = createChildElement(row, "button");
        down.classList.add("threshold-mode");
        down.textContent = "↓";
        down.disabled = index == order.length - 1;
        down.addEventListener("click", () => {
            moveAutoFillCategory(category, 1);
            setupControls();
            recreateTasks();
        });
    });
    const reset = createChildElement(content, "button");
    reset.className = "off";
    reset.textContent = "Reset Order to Default";
    reset.addEventListener("click", () => {
        resetAutoFillOrder();
        setupControls();
        recreateTasks();
    });
}
// Auto-Prioritize (Game Mod): the autopilot form of Auto-Fill Priorities.
// Dedicated control (not an ADVANCED_AUTOMATION_TOGGLES row) because enabling
// it turns Queue Cycle off, so the panel needs a rebuild — same reason
// setupQueueCycleControl exists.
function setupAutoPrioritizeControl(content) {
    const on = GAMESTATE.mods.auto_prioritize;
    const button = createChildElement(content, "button");
    button.className = on ? "on" : "off";
    button.textContent = `Auto-Prioritize: ${on ? "On" : "Off"}`;
    button.addEventListener("click", () => {
        setMod("auto_prioritize", !GAMESTATE.mods.auto_prioritize);
        setupControls(); // rebuild: reflects mutual exclusion with Queue Cycle
        recreateTasks(); // enabling refills priorities immediately
    });
    setupTooltip(button, () => `Auto-Prioritize: ${GAMESTATE.mods.auto_prioritize ? "On" : "Off"}`, () => "Autopilot for priorities: automatically re-runs Auto-Fill Priorities at every Energy Reset and Prestige, when a Task is unlocked, and when you enter a Zone — so the order always reflects your current skills and Energy. Manual priority edits are overwritten while this is on. Mutually exclusive with Queue Cycle.");
}
// Auto Use Cycle (Game Mod): a toggle plus a numeric input for how many Energy
// Resets run with Auto Use Items off before one runs with it on. Lives in the
// Advanced Automation panel alongside the simple toggles.
function setupAutoUseCycleControl(content) {
    const on = GAMESTATE.mods.auto_use_cycle;
    const cycle_button = createChildElement(content, "button");
    cycle_button.className = on ? "on" : "off";
    cycle_button.textContent = `Auto Use Cycle: ${on ? "On" : "Off"}`;
    cycle_button.addEventListener("click", () => {
        setMod("auto_use_cycle", !GAMESTATE.mods.auto_use_cycle);
        setupControls(); // rebuild: reflects mutual exclusion with Queue Cycle
    });
    setupTooltip(cycle_button, () => `Auto Use Cycle: ${GAMESTATE.mods.auto_use_cycle ? "On" : "Off"}`, () => "Cycle Auto Use Items across Energy Resets: keep it off for the set number of resets (banking Items), then on for one reset (spending them), and repeat. Overrides the manual Auto Use Items toggle while enabled. The cycle restarts on Prestige. Mutually exclusive with Queue Cycle.");
    if (!on) {
        return;
    }
    const cycle_label = createChildElement(content, "label");
    cycle_label.className = "advanced-automation-label";
    cycle_label.textContent = "Resets off per cycle:";
    createNumericInput(cycle_label, {
        min: 0,
        max: 99,
        initialValue: GAMESTATE.mods.auto_use_cycle_off_resets,
        ariaLabel: "Energy Resets with Auto Use Items off per cycle",
        onChange: (value) => {
            setMod("auto_use_cycle_off_resets", value);
        },
    });
}
function setupQueueCycleControl(content) {
    const on = GAMESTATE.mods.queue_cycle;
    const button = createChildElement(content, "button");
    button.className = on ? "on" : "off";
    button.textContent = `Queue Cycle: ${on ? "On" : "Off"}`;
    button.addEventListener("click", () => {
        setMod("queue_cycle", !GAMESTATE.mods.queue_cycle);
        RENDERING.exclude_pick_queue = null;
        setupControls();
        recreateTasks(); // the active queue's plan may now be live
    });
    setupTooltip(button, () => `Queue Cycle: ${GAMESTATE.mods.queue_cycle ? "On" : "Off"}`, () => "Rotate through saved automation queues, advancing one per Energy Reset. Each queue has its own task priorities, scheduled artifact tasks, and whether it's an item cycle (Auto Use Items on). Mutually exclusive with Auto Use Cycle; restarts at the first queue on Prestige.");
    if (!on) {
        return;
    }
    const configs = getQueueConfigs();
    const active = getActiveQueueIndex();
    const runs_done = getQueueRunsOnCurrent();
    // Active-queue summary, shown on the (collapsible) list header so it's
    // visible even when collapsed.
    const active_queue = configs[active];
    const active_progress = active_queue && active_queue.repeat_count > 1
        ? ` (run ${Math.min(runs_done + 1, active_queue.repeat_count)}/${active_queue.repeat_count})` : "";
    const active_name = active_queue && active_queue.name ? `: ${active_queue.name}` : "";
    const summary = configs.length > 0 ? `Queue ${active + 1}${active_name}${active_progress}` : "no queues";
    const collapsed = GAMESTATE.queue_list_collapsed;
    const list_header = createChildElement(content, "div");
    list_header.className = "queue-list-header";
    const list_icon = createChildElement(list_header, "span");
    list_icon.className = "queue-list-icon";
    list_icon.textContent = collapsed ? "▶" : "▼";
    const list_title = createChildElement(list_header, "span");
    list_title.className = "queue-list-title";
    list_title.textContent = `Queues — ${summary}`;
    list_header.addEventListener("click", () => {
        GAMESTATE.queue_list_collapsed = !GAMESTATE.queue_list_collapsed;
        RENDERING.exclude_pick_queue = null;
        saveGame();
        setupControls();
    });
    if (collapsed) {
        return;
    }
    if (configs.length >= 2) {
        const advance_button = createChildElement(content, "button");
        advance_button.className = "queue-config-add";
        advance_button.textContent = "⏭ Advance to next queue now";
        advance_button.addEventListener("click", () => { advanceQueueCycle(); recreateTasks(); setupControls(); });
        setupTooltip(advance_button, () => "Advance cycle", () => "Switch to the next queue immediately (wrapping), applying its plan now instead of waiting for the next Energy Reset.");
    }
    for (let i = 0; i < configs.length; i++) {
        const queue = configs[i];
        if (!queue) {
            continue;
        }
        const is_active = i === active;
        const entry = createChildElement(content, "div");
        entry.className = "queue-config-entry" + (is_active ? " active" : "");
        // Row 1: "Queue N (run k/M)" label + optional name input filling the rest.
        const top_row = createChildElement(entry, "div");
        top_row.className = "queue-config-top";
        const label = createChildElement(top_row, "span");
        label.className = "queue-config-label";
        const progress = queue.repeat_count <= 0 ? " (skipped)"
            : is_active && queue.repeat_count > 1 ? ` (run ${Math.min(runs_done + 1, queue.repeat_count)}/${queue.repeat_count})` : "";
        label.textContent = `${is_active ? "▶ " : ""}Queue ${i + 1}${progress}`;
        const name_input = createChildElement(top_row, "input");
        name_input.type = "text";
        name_input.className = "queue-name-input";
        name_input.placeholder = "label (optional)";
        name_input.value = queue.name ?? "";
        name_input.addEventListener("change", () => {
            setQueueName(i, name_input.value);
            // Refresh the collapsed-header summary for the active queue without
            // a full rebuild (which would swallow an adjacent click).
            if (is_active) {
                const np = queue.repeat_count > 1 ? ` (run ${Math.min(runs_done + 1, queue.repeat_count)}/${queue.repeat_count})` : "";
                const nn = name_input.value ? `: ${name_input.value}` : "";
                list_title.textContent = `Queues — Queue ${i + 1}${nn}${np}`;
            }
        });
        // Row 2: the queue's controls.
        const row = createChildElement(entry, "div");
        row.className = "queue-config-row";
        const edit_button = createChildElement(row, "button");
        // Green only while this queue is actually being edited.
        edit_button.className = "queue-config-btn" + (isEditMode() && is_active ? " on" : "");
        edit_button.textContent = "Edit";
        edit_button.addEventListener("click", () => {
            if (!isEditMode() && !enterEditMode()) {
                flashMessage("Stop the current task before editing priorities.");
                return;
            }
            setActiveQueue(i);
            setEditZone(GAMESTATE.current_zone); // rebuild the view under the now-active queue
            refreshAfterEditChange();
        });
        setupTooltip(edit_button, () => "Edit this queue", () => "Make this queue active so you can view and edit its task priorities and artifact tasks. The cycle continues from here.");
        const modes = ["all", "none", "exclude"];
        const mode = queue.auto_use_mode;
        const mode_label = mode == "all" ? "All" : mode == "none" ? "None" : "Exclude";
        const item_button = createChildElement(row, "button");
        item_button.className = "queue-config-btn" + (mode != "none" ? " on" : "");
        item_button.textContent = `Items: ${mode_label}`;
        item_button.addEventListener("click", () => {
            setQueueAutoUseMode(i, modes[(modes.indexOf(mode) + 1) % modes.length]);
            setupControls();
        });
        setupTooltip(item_button, () => `Items: ${mode_label}`, () => "Auto-use for this queue. All: use everything. None: use nothing. Exclude: use everything except the listed items (saving them for a later queue). Click to cycle.");
        const repeat_label = createChildElement(row, "label");
        repeat_label.className = "queue-config-repeat";
        repeat_label.textContent = "×";
        createNumericInput(repeat_label, {
            min: 0,
            max: 99,
            initialValue: queue.repeat_count,
            ariaLabel: `Energy Resets to run queue ${i + 1} before advancing (0 to skip)`,
            onChange: (value) => { setQueueRepeatCount(i, value); },
        });
        const up_button = createChildElement(row, "button");
        up_button.className = "queue-config-btn";
        up_button.textContent = "↑";
        up_button.addEventListener("click", () => { moveQueue(i, -1); setupControls(); });
        const down_button = createChildElement(row, "button");
        down_button.className = "queue-config-btn";
        down_button.textContent = "↓";
        down_button.addEventListener("click", () => { moveQueue(i, 1); setupControls(); });
        const delete_button = createChildElement(row, "button");
        delete_button.className = "queue-config-btn";
        delete_button.textContent = "✕";
        delete_button.addEventListener("click", () => { removeQueue(i); recreateTasks(); setupControls(); });
        setupTooltip(delete_button, () => "Delete this queue", () => "Remove this saved queue from the cycle.");
        // Row 3 (Exclude mode only): the excluded items + an Add pick-mode button.
        if (mode == "exclude") {
            const exclude_row = createChildElement(entry, "div");
            exclude_row.className = "queue-exclude-row";
            const exclude_label = createChildElement(exclude_row, "span");
            exclude_label.className = "queue-exclude-label";
            exclude_label.textContent = "Exclude:";
            for (const item of getQueueExcludedItems(i)) {
                const definition = ITEMS[item];
                const chip = createChildElement(exclude_row, "button");
                chip.className = "queue-exclude-chip";
                chip.textContent = definition ? definition.icon : "?";
                chip.addEventListener("click", () => { removeQueueExcludedItem(i, item); setupControls(); });
                setupTooltip(chip, () => definition ? definition.name : "Item", () => `Click to stop excluding ${definition ? definition.name : "this item"}.`);
            }
            const picking = RENDERING.exclude_pick_queue == i;
            const add_exclude = createChildElement(exclude_row, "button");
            add_exclude.className = "queue-config-btn" + (picking ? " on" : "");
            add_exclude.textContent = picking ? "Click items…" : "Add";
            add_exclude.addEventListener("click", () => {
                RENDERING.exclude_pick_queue = picking ? null : i;
                RENDERING.artifact_task_mode = null; // pick modes are mutually exclusive
                setupControls();
            });
            setupTooltip(add_exclude, () => "Add excluded item", () => "Click here, then click items in your inventory to add them to this queue's exclude list. Click Add again to stop.");
        }
    }
    const add_button = createChildElement(content, "button");
    add_button.className = "queue-config-add";
    add_button.textContent = "Save current as new queue";
    add_button.addEventListener("click", () => { addQueue(); setupControls(); });
    setupTooltip(add_button, () => "Add queue", () => "Save the current task priorities and artifact tasks as a new queue at the end of the cycle.");
}
// MARK: Extra stats
function updateExtraStats() {
    if (GAMESTATE.has_unlocked_power && RENDERING.power_element.classList.contains("hidden")) {
        RENDERING.power_element.classList.remove("hidden");
        setupTooltip(RENDERING.power_element, function () { return `💪Power - ${formatInt(GAMESTATE.power)}`; }, function () {
            let tooltip = `Increases ${getSkillString(SkillType.Combat)} and ${getSkillString(SkillType.Fortitude)} speed by ${formatInt(GAMESTATE.power)}%`;
            tooltip += `<br><br>Increased by fighting Bosses`;
            return tooltip;
        });
    }
    const power_text = `<span>💪Power</span><span>${formatInt(GAMESTATE.power)}</span>`;
    if (RENDERING.power_element.innerHTML != power_text) {
        RENDERING.power_element.innerHTML = power_text;
    }
    if (hasPerk(PerkType.Attunement) && RENDERING.attunement_element.classList.contains("hidden")) {
        RENDERING.attunement_element.classList.remove("hidden");
        setupTooltip(RENDERING.attunement_element, function () { return `🌀Attunement - ${formatInt(GAMESTATE.attunement)}`; }, function () {
            const attunement_skill_strings = [];
            calcAttunementSkills().forEach((value) => { attunement_skill_strings.push(getSkillString(value)); });
            let tooltip = `Increases ${joinWithCommasAndAnd(attunement_skill_strings)} speed by ${formatNumber(GAMESTATE.attunement / 10)}%`;
            tooltip += `<br>Note that the bonus does not stack if a Task uses more than one of these Skills`;
            tooltip += `<br><br>Increased by all Tasks it boosts`;
            return tooltip;
        });
    }
    const attunement_text = `<span>🌀Attunement</span><span>${formatInt(GAMESTATE.attunement)}</span>`;
    if (RENDERING.attunement_element.innerHTML != attunement_text) {
        RENDERING.attunement_element.innerHTML = attunement_text;
    }
    if (hasUnlockedPrestige() && RENDERING.open_prestige_element.classList.contains("hidden")) {
        RENDERING.open_prestige_element.classList.remove("hidden");
    }
    const prestige_text = GAMESTATE.prestige_available ? `<h2>${DIVINE_SPARK_TEXT}<br>${formatInt(GAMESTATE.divine_spark)} (+${formatInt(calcDivineSparkGain())})</h2>` : `<h2>${DIVINE_SPARK_TEXT}<br>${formatInt(GAMESTATE.divine_spark)}</h2>`;
    if (RENDERING.open_prestige_element.innerHTML != prestige_text) {
        RENDERING.open_prestige_element.innerHTML = prestige_text;
    }
    const prestige_glow = GAMESTATE.unlocked_new_prestige_this_prestige || GAMESTATE.highest_zone > GAMESTATE.highest_prestige_zone;
    RENDERING.open_prestige_element.classList.toggle("prestige-glow", prestige_glow);
}
// MARK: Stats
function setupOpenStats() {
    const stats_overlay = RENDERING.stats_overlay_element;
    const open_button = RENDERING.open_stats_element;
    open_button.addEventListener("click", () => {
        populateStatsView();
        stats_overlay.classList.remove("hidden");
    });
    stats_overlay.addEventListener("click", (e) => {
        if (e.target == stats_overlay) { // Clicking outside the window
            stats_overlay.classList.add("hidden");
        }
    });
    setupTooltipStaticHeader(open_button, "Stats", function () {
        const tooltip = `Within this menu you can see the effects of your Items on your Skills`;
        return tooltip;
    });
}
function populateStatsView() {
    const stats_overlay = RENDERING.stats_overlay_element;
    const stats_div = stats_overlay.querySelector("#stats-box");
    if (!stats_div) {
        console.error("No prestige-box");
        return;
    }
    stats_div.innerHTML = "";
    const scroll_area = createChildElement(stats_div, "div");
    scroll_area.className = "scroll-area";
    {
        const close_button = createChildElement(stats_div, "button");
        close_button.className = "close close-scroll";
        close_button.textContent = "X";
        close_button.addEventListener("click", () => {
            stats_overlay.classList.add("hidden");
        });
        setupTooltipStatic(close_button, `Close Stats Menu`, ``);
    }
    createChildElement(scroll_area, "h1").textContent = "Stats";
    createChildElement(scroll_area, "span").textContent = `Highest Zone reached: ${GAMESTATE.highest_zone + 1}`;
    createChildElement(scroll_area, "span").textContent = `Highest Zone fully completed: ${GAMESTATE.highest_zone_fully_completed + 1}`;
    if (GAMESTATE.prestige_count > 0) {
        createChildElement(scroll_area, "span").textContent = `Highest Zone reached (any Prestige): ${GAMESTATE.highest_zone_ever + 1}`;
        createChildElement(scroll_area, "span").textContent = `Highest Zone fully completed (any Prestige): ${GAMESTATE.highest_zone_fully_completed_ever + 1}`;
    }
    const attunement_skills = calcAttunementSkills();
    const power_skills = getPowerSkills();
    for (const skill_type of GAMESTATE.unlocked_skills) {
        const skill = getSkill(skill_type);
        const div = createChildElement(scroll_area, "div");
        div.className = "stat-section";
        createChildElement(div, "h2").textContent = getSkillString(skill_type);
        const table = createChildElement(div, "table");
        table.className = "table simple-table";
        {
            const skill_table = createTableSection(table, "Basic");
            createTwoElementRow(skill_table, `Level`, `x${formatNumber(calcSkillTaskProgressMultiplierFromLevel(skill.level))}`);
            if (GAMESTATE.attunement > 0 && attunement_skills.includes(skill_type)) {
                createTwoElementRow(skill_table, ATTUNEMENT_TEXT, `x${formatNumber(calcAttunementSpeedBonusAtLevel(GAMESTATE.attunement))}`);
            }
            if (GAMESTATE.power > 0 && power_skills.includes(skill_type)) {
                createTwoElementRow(skill_table, POWER_TEXT, `x${formatNumber(calcPowerSpeedBonusAtLevel(GAMESTATE.attunement))}`);
            }
            const spite_the_gods_level = getPrestigeRepeatableLevel(PrestigeRepeatableType.SpiteTheGods);
            if (spite_the_gods_level > 0 && getSpiteTheGodsSkills().includes(skill_type)) {
                createTwoElementRow(skill_table, "Spite the Gods", `x${formatNumber(calcSpiteTheGodsBonus())}`);
            }
            if (skill_type == SkillType.Travel && hasPrestigeUnlock(PrestigeUnlockType.GodlyTravel)) {
                createTwoElementRow(skill_table, "Godly Travel", `x${GODLY_TRAVEL_MULT}`);
            }
        }
        const item_bonuses = gatherItemBonuses(skill_type);
        if (item_bonuses.length > 0) {
            const item_table = createTableSection(table, "Items");
            for (const [item_type, amount] of item_bonuses) {
                const item = ITEMS[item_type];
                const modifier = item.skill_modifiers.getStacked(amount);
                const effect = modifier.getSkillEffect(skill_type);
                createTwoElementRow(item_table, `${amount} ${item.getNameWithEmoji(amount)}`, `+${formatPercentage(effect)}`);
            }
            createTwoElementRow(item_table, "Total Item bonus", `x${formatNumber(skill.speed_modifier)}`);
        }
        const perk_bonuses = gatherPerkBonuses(skill_type);
        if (perk_bonuses.length > 0) {
            const perk_table = createTableSection(table, "Perks");
            let total_effect = 1;
            for (const perk_type of perk_bonuses) {
                const perk = PERKS[perk_type];
                const effect = 1 + perk.skill_modifiers.getSkillEffect(skill_type);
                createTwoElementRow(perk_table, `${getPerkNameWithEmoji(perk_type)}`, `x${effect}`);
                total_effect *= effect;
            }
            createTwoElementRow(perk_table, "Total Perk bonus", `x${formatNumber(total_effect)}`);
        }
        {
            const total_table = createTableSection(table, "Total Speed");
            createTwoElementRow(total_table, "", `x${formatNumber(calcSkillTaskProgressMultiplier(skill_type))}`);
        }
    }
}
// MARK: Changelog
function showChangelog(since_version = "") {
    RENDERING.changelog_overlay_element.classList.remove("hidden");
    const changelog_overlay = RENDERING.changelog_overlay_element;
    const changelog_div = changelog_overlay.querySelector("#changelog-box");
    if (!changelog_div) {
        console.error("No changelog-box");
        return;
    }
    changelog_div.innerHTML = "";
    const scroll_area = createChildElement(changelog_div, "div");
    scroll_area.className = "scroll-area";
    {
        const close_button = createChildElement(changelog_div, "button");
        close_button.className = "close close-scroll";
        close_button.textContent = "X";
        close_button.addEventListener("click", () => {
            changelog_overlay.classList.add("hidden");
        });
        setupTooltipStatic(close_button, `Close Changelog`, ``);
    }
    createChildElement(scroll_area, "h1").textContent = "Changelog";
    if (SAVE_VERSION != CHANGELOG[0]?.version) {
        const error = createChildElement(scroll_area, "h2");
        error.textContent = "Save version and changelog doesn't match";
        error.className = "error";
    }
    const end_index = since_version.length == 0
        ? CHANGELOG.length
        : CHANGELOG.findIndex((entry) => { return entry.version == since_version; });
    if (since_version.length != 0) {
        createChildElement(scroll_area, "p").textContent = `Changes since you last played (${since_version})`;
    }
    for (const entry of CHANGELOG.slice(0, end_index)) {
        const entry_div = createChildElement(scroll_area, "div");
        entry_div.className = "changelog-entry";
        createChildElement(entry_div, "h2").textContent = `${entry.version} (${entry.date})`;
        createChildElement(entry_div, "p").innerHTML = entry.changes;
    }
}
// MARK: Credits
function showCredits() {
    RENDERING.credits_overlay_element.classList.remove("hidden");
    const credits_overlay = RENDERING.credits_overlay_element;
    const credits_div = credits_overlay.querySelector("#credits-box");
    if (!credits_div) {
        console.error("No credits-box");
        return;
    }
    credits_div.innerHTML = "";
    const scroll_area = createChildElement(credits_div, "div");
    scroll_area.className = "scroll-area";
    {
        const close_button = createChildElement(credits_div, "button");
        close_button.className = "close";
        close_button.textContent = "X";
        close_button.addEventListener("click", () => {
            credits_overlay.classList.add("hidden");
        });
        setupTooltipStatic(close_button, `Close Credits`, ``);
    }
    createChildElement(scroll_area, "h1").textContent = "Credits";
    createChildElement(scroll_area, "p").innerHTML = CREDITS;
}
// MARK: Hints
function shouldShowPrepRunHint() {
    if (GAMESTATE.hint_has_gotten_prep_run_hint) {
        return false;
    }
    // Pretty arbitrary numbers for when the player needs to be told if they've not figured it out themselves
    const prep_run_count_to_ignore_hint = 3; // Not 1, since the player might accidentally do it once. Thrice though is clearly deliberate
    const non_prep_run_count_to_trigger_hint = 15;
    return GAMESTATE.hint_prep_runs_done < prep_run_count_to_ignore_hint && GAMESTATE.hint_non_prep_runs_done >= non_prep_run_count_to_trigger_hint;
}
function shouldShowBossHint() {
    if (GAMESTATE.hint_has_gotten_boss_hint) {
        return false;
    }
    const zone_for_hint = 10 - 1; // 0-indexing
    return GAMESTATE.highest_zone >= zone_for_hint && GAMESTATE.power == 0 && GAMESTATE.prestige_count == 0;
}
function showHint(text) {
    const overlay = RENDERING.hints_overlay_element;
    overlay.classList.remove("hidden");
    createChildElement(overlay, "h1").textContent = "Hint";
    createChildElement(overlay, "p").innerHTML = text;
    {
        const close_button = createChildElement(overlay, "button");
        close_button.className = "dismiss";
        close_button.textContent = "Dismiss";
        close_button.addEventListener("click", () => {
            overlay.classList.add("hidden");
        });
        setupTooltipStatic(close_button, `Dismiss Hint`, ``);
    }
}
// MARK: Rendering
export class Rendering {
    tooltipped_element = null;
    potential_tooltipped_element = null;
    queued_update_tooltip = false;
    tooltip_element;
    energy_reset_element;
    open_energy_reset_element;
    end_of_content_element;
    settings_element;
    energy_element;
    messages_element;
    message_contexts = new Map();
    power_element;
    attunement_element;
    open_prestige_element;
    prestige_overlay_element;
    confirmation_overlay_element;
    item_undo_element;
    artifact_undo_element;
    task_elements = new Map();
    skill_elements = new Map();
    item_elements = new Map();
    perk_elements = new Map();
    controls_list_element;
    open_stats_element;
    stats_overlay_element;
    changelog_overlay_element;
    credits_overlay_element;
    hints_overlay_element;
    energy_reset_count = 0;
    current_zone = 0;
    item_order = [];
    artifact_order = [];
    viewing_last_reset = false;
    // Pick-mode for scheduling artifact tasks: "add" intercepts the next
    // inventory-artifact click, "remove" intercepts the next artifact-task click.
    artifact_task_mode = null;
    // When set, clicking a (non-artifact) inventory item adds it to this queue's
    // exclude list instead of using it.
    exclude_pick_queue = null;
    createTasks() {
        const tasks_div = document.getElementById("tasks");
        if (!tasks_div) {
            console.error("The element with ID 'tasks' was not found.");
            return;
        }
        tasks_div.innerHTML = "";
        if (isEditMode()) {
            createEditModeBanner(tasks_div);
        }
        // Split into the zone's own tasks, host-injected procgen exit tasks
        // (ids >= 10000, managed mode only), and player artifact tasks.
        const normal_tasks = [];
        const exit_tasks = [];
        const artifact_tasks = [];
        for (const task of GAMESTATE.tasks) {
            const id = task.task_definition.id;
            if (isArtifactTaskId(id)) {
                artifact_tasks.push(task);
            }
            else if (id >= 10000) {
                exit_tasks.push(task);
            }
            else {
                normal_tasks.push(task);
            }
        }
        for (const task of normal_tasks) {
            createTaskDiv(task, tasks_div, this);
        }
        if (exit_tasks.length > 0) {
            createTaskSectionHeader(tasks_div, "Procgen Exits");
            for (const task of exit_tasks) {
                createTaskDiv(task, tasks_div, this);
            }
        }
        // Artifact-task scheduling is an automation feature; show it once the
        // Amulet (which gates automation) is held.
        if (hasPerk(PerkType.Amulet)) {
            createArtifactSectionHeader(tasks_div, this);
            for (const task of artifact_tasks) {
                createTaskDiv(task, tasks_div, this);
            }
        }
    }
    // Append the DOM for a single task without rebuilding the rest.
    // Used by injectSyntheticTask so the synthetic task gets an entry
    // in task_elements before the next updateTaskRendering tick (which
    // would otherwise crash on a missing task_element).
    appendTask(task) {
        const tasks_div = document.getElementById("tasks");
        if (!tasks_div) {
            console.error("The element with ID 'tasks' was not found.");
            return;
        }
        createTaskDiv(task, tasks_div, this);
    }
    constructor() {
        function getElement(name) {
            const energy_div = document.getElementById(name);
            if (energy_div) {
                return energy_div;
            }
            else {
                console.error(`The element with ID '${name}' was not found.`);
                return new HTMLElement();
            }
        }
        this.energy_element = getElement("energy");
        setupTooltip(this.energy_element, function () { return `${ENERGY_TEXT} - ${GAMESTATE.current_energy.toFixed(0)}/${GAMESTATE.max_energy.toFixed(0)}`; }, function () {
            let tooltip = `${ENERGY_TEXT} goes down over time while you have a Task active`;
            tooltip += `<br>Drain is proportional to the time spent on a Task. The drain per unit time increases slightly per Zone`;
            const tick_rate = 1000 / calcTickRate();
            tooltip += `<br><br>⏰Ticks per second: ${formatNumber(tick_rate)}`;
            tooltip += `<br>${ENERGY_TEXT} use per second: ${formatNumber(tick_rate * calcEnergyDrainPerTickInZone(GAMESTATE.current_zone))} (in Zone ${GAMESTATE.current_zone + 1})`;
            return tooltip;
        });
        this.tooltip_element = getElement("tooltip");
        this.energy_reset_element = getElement("game-over-overlay");
        this.open_energy_reset_element = getElement("open-energy-reset");
        this.end_of_content_element = getElement("end-of-content-overlay");
        this.settings_element = getElement("settings-overlay");
        this.messages_element = getElement("messages");
        this.controls_list_element = getElement("controls-list");
        this.power_element = getElement("power");
        this.attunement_element = getElement("attunement");
        this.open_prestige_element = getElement("open-prestige");
        this.prestige_overlay_element = getElement("prestige-overlay");
        this.confirmation_overlay_element = getElement("confirmation-overlay");
        this.item_undo_element = getElement("item-undo");
        this.artifact_undo_element = getElement("artifact-undo");
        this.open_stats_element = getElement("open-stats");
        this.stats_overlay_element = getElement("stats-overlay");
        this.changelog_overlay_element = getElement("changelog-overlay");
        this.credits_overlay_element = getElement("credits-overlay");
        this.hints_overlay_element = getElement("hints-overlay");
    }
    initialize() {
        setupEnergyReset(this.energy_reset_element);
        setupSettings();
        setupControls();
        setupInfoTooltips();
        setupOpenPrestige();
        setupOpenStats();
        setupItemUndo();
    }
    start() {
        this.createTasks();
        recreateSkills();
        setupZone();
        recreatePerks();
        recreateItemsIfNeeded();
        updateRendering();
        // Unhide the game now that it's ready
        document.getElementById("game-area").classList.remove("hidden");
        // Auto-show of the changelog on save-version mismatch removed
        // on the `substrate` branch: the bridge can't inject its
        // managed-mode flag in time (jta's DOMContentLoaded — which
        // runs this code — fires before the iframe `load` event that
        // triggers bridge injection), so a managed-mode gate would not
        // suppress the popup. Removing unconditionally is the minimal
        // fix; the manual "Changelog" button in Settings still works.
        // if (GAMESTATE.save_version != SAVE_VERSION || SAVE_VERSION != CHANGELOG[0]?.version) {
        //     showChangelog(GAMESTATE.save_version);
        // }
    }
}
function checkForZoneAndReset() {
    if (RENDERING.current_zone == GAMESTATE.current_zone && RENDERING.energy_reset_count == GAMESTATE.energy_reset_count) {
        return;
    }
    const was_reset = GAMESTATE.current_zone == 0;
    RENDERING.current_zone = GAMESTATE.current_zone;
    RENDERING.energy_reset_count = GAMESTATE.energy_reset_count;
    recreateTasks();
    if (was_reset) {
        recreateItemsIfNeeded();
        recreatePerks();
    }
    setupControls();
    setupZone();
    RENDERING.open_energy_reset_element.disabled = GAMESTATE.energy_reset_count == 0;
}
function setupZone() {
    const zone_name = document.getElementById("zone-name");
    if (!zone_name) {
        console.error("The element with ID 'zone-name' was not found.");
        return;
    }
    const zone = ZONES[GAMESTATE.current_zone];
    if (zone) {
        zone_name.innerHTML = `Zone ${GAMESTATE.current_zone + 1} - ${zone.name}`;
        setupTooltipStatic(zone_name, zone_name.innerHTML, `This is Zone ${GAMESTATE.current_zone + 1} of 30`);
    }
}
function hideTooltip() {
    RENDERING.tooltip_element.classList.add("hidden");
    RENDERING.tooltipped_element = null;
}
function showTooltip(element) {
    if (!element.generateTooltipBody || !element.generateTooltipHeader) {
        console.error("No generateTooltip callback");
        return;
    }
    if (!element.parentNode) {
        hideTooltip();
        return;
    }
    const tooltip_element = RENDERING.tooltip_element;
    // Hide first so it doesn't affect the layout while we're calculating things
    tooltip_element.classList.add("hidden");
    tooltip_element.innerHTML = "";
    RENDERING.tooltipped_element = element;
    tooltip_element.innerHTML = `<h3>${element.generateTooltipHeader()}</h3>`;
    const body_text = element.generateTooltipBody();
    if (body_text != ``) {
        tooltip_element.innerHTML += `<hr />`;
        tooltip_element.innerHTML += body_text;
    }
    tooltip_element.style.top = "";
    tooltip_element.style.bottom = "";
    tooltip_element.style.left = "";
    tooltip_element.style.right = "";
    const elementRect = element.getBoundingClientRect();
    const beyondVerticalCenter = elementRect.top > (window.innerHeight / 2);
    const beyondHorizontalCenter = elementRect.left > (window.innerWidth / 2);
    let x = (beyondHorizontalCenter ? elementRect.left : elementRect.right) + window.scrollX;
    let y = (beyondVerticalCenter ? elementRect.bottom : elementRect.top) + window.scrollY;
    // Energy element covers basically full width so needs its own logic to look good
    if (element.id == "energy") {
        x = elementRect.left + window.scrollX;
        tooltip_element.style.left = x + "px";
        y = elementRect.bottom + scrollY + 5;
        tooltip_element.style.top = y + "px";
    }
    else {
        if (beyondHorizontalCenter) {
            x = document.documentElement.clientWidth - x;
            tooltip_element.style.right = x + "px";
        }
        else {
            tooltip_element.style.left = x + "px";
        }
        if (beyondVerticalCenter) {
            y = document.documentElement.clientHeight - y;
            tooltip_element.style.bottom = y + "px";
        }
        else {
            tooltip_element.style.top = y + "px";
        }
    }
    tooltip_element.classList.remove("hidden");
}
export function updateRendering() {
    handleEvents();
    checkForZoneAndReset();
    updateTaskRendering();
    updateSkillRendering();
    updateEnergyRendering();
    updateExtraStats();
    updateItems();
    updateGameOver();
    if (RENDERING.queued_update_tooltip) {
        RENDERING.queued_update_tooltip = false;
        if (RENDERING.tooltipped_element) {
            showTooltip(RENDERING.tooltipped_element);
        }
    }
}
function inputIsBeingHandled() {
    const activeElement = document.activeElement;
    if (!activeElement) {
        return false;
    }
    const isInputField = activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        activeElement.getAttribute("contenteditable") === "true";
    return isInputField;
}
export function handleHotkeyReleased(event) {
    // Checked before input handling, since you might be looking at tooltips still
    if (GAMESTATE.manual_tooltips && event.key == "Control") {
        hideTooltip();
    }
    if (inputIsBeingHandled()) {
        return;
    }
    if (hasPerk(PerkType.Amulet)) {
        if (event.key == "a") {
            toggleAutomationMode(AutomationMode.All);
        }
        else if (event.key == "z") {
            toggleAutomationMode(AutomationMode.Zone);
        }
    }
    if (event.key == "i") {
        GAMESTATE.auto_use_items = !GAMESTATE.auto_use_items;
        setupControls();
    }
    else if (event.key == "r") {
        GAMESTATE.repeat_tasks = !GAMESTATE.repeat_tasks;
        setupControls();
    }
}
export function handleHotkeyPressed(event) {
    if (GAMESTATE.manual_tooltips && event.key == "Control") {
        if (RENDERING.potential_tooltipped_element) {
            showTooltip(RENDERING.potential_tooltipped_element);
        }
    }
}
//# sourceMappingURL=rendering.js.map