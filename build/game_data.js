// Synthetic game data boundary (fork addition; jta-synthetic-data plan §3).
//
// applyGameDataset() validates a versioned dataset document and then swaps
// the engine's content tables IN PLACE: skills, perks, items (with the
// derived ARTIFACTS/NOTE_ITEMS groups), prestige tables, zones/tasks (with
// zone_id stamping and the derived task maps), skill roles, and the economy
// backbone. The runtime enum objects' `Count` members are rewritten so counts
// track the dataset; member values (PerkType.Amulet etc.) never move —
// engine behaviors stay compiled against fixed enum slots ("fixed behavior
// slots"), and a dataset entry that wants such a behavior must occupy that
// slot, which the validator enforces.
//
// The caller (window.loadGameData in game.ts) follows a successful swap with
// a full re-initialize against the dataset-keyed save slot — live Task/
// Skill/perk state references the old tables, so a dataset swap mid-game is
// a reset by definition.
//
// Validation here covers the structural essentials that would corrupt the
// engine tables; the host repo's datasetValidator.js remains the
// authoritative pre-flight (uniqueness of names, C1/C3 topology rules,
// warnings). Nothing is applied on any validation failure.
//
// Dormant when never called: with no dataset loaded, no table is touched and
// standalone play is byte-identical to the pre-hook fork.
import { GAMESTATE } from "./game.js";
import { SkillType, SKILLS, SKILL_DEFINITIONS, SkillDefinition } from "./skills.js";
import { PerkType, PERKS, PerkDefinition } from "./perks.js";
import { ItemType, ITEMS, ItemDefinition, ARTIFACTS, NOTE_ITEMS } from "./items.js";
import { PrestigeLayer, PrestigeUnlockType, PrestigeRepeatableType, PRESTIGE_UNLOCKABLES, PRESTIGE_REPEATABLES, } from "./prestige_upgrades.js";
import { ZONES, TaskDefinition, TaskType, rebuildZoneDerivedMaps } from "./zones.js";
import { PerkSkillModifierList, ItemSkillModifierList } from "./modifiers.js";
import { calcItemEnergyGain, ECONOMY, SKILL_ROLES, PRESTIGE_DATA, EFFECTS, setLoadedDataset, getLoadedDatasetId, } from "./simulation.js";
import { ENERGY_TEXT } from "./rendering_constants.js";
export const JTA_DATASET_SCHEMA_VERSION = 1;
// MARK: Behavior-slot tables
//
// Mirror of the host repo's datasetBehaviors.js keys — the stable vocabulary
// naming each engine behavior that is compiled against an exact enum slot.
// The slot values reference the enum MEMBERS (never renumbered), so these
// stay correct across dataset swaps that change only `Count`.
const PERK_BEHAVIOR_SLOTS = {
    automation_unlock: PerkType.Amulet,
    // starting_energy_flat (EnergySpell) / starting_energy_growth
    // (EnergeticMemory) migrated to the declarative starting_energy effect
    // kind (Phase-D rung 2) — those slots are no longer behavior-constrained.
    time_compression_minor: PerkType.MinorTimeCompression,
    energy_drain_reduction: PerkType.HighAltitudeClimbing,
    attunement_enable: PerkType.Attunement,
    energy_drain_zone_history: PerkType.ReflectionsOnTheJourney,
    spark_gain_mult_a: PerkType.Awakening,
    time_compression_major: PerkType.MajorTimeCompression,
    speed_per_completed_zone: PerkType.UnifiedTheoryOfMagic,
    keep_items_on_reset: PerkType.UnderstandingTheReset,
    // xp_all_mult_a/_b (Writing / GazedBeyondTheVeil) migrated to the
    // declarative xp_all_mult effect kind (Phase-D rung 1) — those slots
    // are no longer behavior-constrained.
    spark_gain_mult_b: PerkType.DefiedTheGods,
    attunement_gain_mult: PerkType.CommunedWithDamnedSouls,
    item_energy_mult: PerkType.SupplyLines,
    spark_gain_mult_c: PerkType.Ascended,
};
const ITEM_BEHAVIOR_SLOTS = {
    artifact_haste_queue: ItemType.ScrollOfHaste,
    artifact_duplicate_found: ItemType.Dreamcatcher,
    artifact_xp_queue: ItemType.MagicRing,
    artifact_boss_haste_queue: ItemType.BottledLightning,
};
// Every prestige unlockable/repeatable slot is behavior-coupled; keys by slot.
const PRESTIGE_UNLOCK_BEHAVIOR_KEYS = [
    "permanent_automation", "xp_all_prestige_mult", "grant_drain_reflections",
    "attunement_expand_search", "starting_energy_growth_square",
    "tick_rate_from_energy_overflow", "mastery_of_time", "see_beyond_the_veil",
    "speed_per_perk_held", "note_item_floor_on_reset",
    "attunement_expand_crafting", "travel_skill_prestige_mult",
    "spark_gain_double_a", "spark_gain_double_b", "xp_all_prestige_mult_b",
    "starting_energy_prestige_flat",
];
const PRESTIGE_REPEATABLE_BEHAVIOR_KEYS = [
    "xp_all_level_a", "power_rate_level", "item_energy_level", "speed_level",
    "spark_exponent_level", "skill_start_level", "starting_energy_level",
    "drain_reduction_level", "mandatory_speed_level", "attunement_effect_level",
    "spite_skills_level", "xp_all_level_b",
];
const TASK_TYPE_BY_NAME = {
    Normal: TaskType.Normal,
    Travel: TaskType.Travel,
    Mandatory: TaskType.Mandatory,
    Prestige: TaskType.Prestige,
    Boss: TaskType.Boss,
};
const ECONOMY_KEYS = [
    "base_task_cost", "zone_cost_exponent", "boss_cost_exponent",
    "xp_base", "xp_zone_mult", "level_curve", "zone_speedup_base",
];
// Pristine vanilla definitions, snapshotted before any swap. Behavior-slot
// dataset entries inherit their compiled lambdas (tooltips, on_consume,
// effect text) from these when the dataset doesn't override them.
const VANILLA_PERK_DEFS = PERKS.slice();
const VANILLA_ITEM_DEFS = ITEMS.slice();
const VANILLA_UNLOCK_DEFS = PRESTIGE_UNLOCKABLES.slice();
const VANILLA_REPEATABLE_DEFS = PRESTIGE_REPEATABLES.slice();
// MARK: Validation (structural essentials)
function isPlaceholder(entry) {
    return typeof entry === "object" && entry !== null
        && entry.placeholder === true;
}
export function validateGameDataset(dataset) {
    const errors = [];
    const err = (msg) => { errors.push(msg); };
    if (typeof dataset !== "object" || dataset === null || Array.isArray(dataset)) {
        return ["dataset is not an object"];
    }
    const ds = dataset;
    if (ds.schema_version !== JTA_DATASET_SCHEMA_VERSION) {
        err(`schema_version must be ${JTA_DATASET_SCHEMA_VERSION}, got ${JSON.stringify(ds.schema_version)}`);
    }
    if (typeof ds.dataset_id !== "string" || ds.dataset_id.length === 0) {
        err("dataset_id must be a non-empty string");
    }
    // Skills
    const skills = Array.isArray(ds.skills) ? ds.skills : [];
    if (!Array.isArray(ds.skills) || skills.length === 0)
        err("skills must be a non-empty array");
    let live_skills = 0;
    skills.forEach((s, i) => {
        if (isPlaceholder(s))
            return;
        live_skills += 1;
        if (typeof s?.name !== "string" || s.name.length === 0)
            err(`skills[${i}].name must be a non-empty string`);
        if (s?.xp_needed_mult !== undefined && !(typeof s.xp_needed_mult === "number" && s.xp_needed_mult > 0)) {
            err(`skills[${i}].xp_needed_mult must be a positive number`);
        }
    });
    if (live_skills === 0)
        err("skills must contain at least one non-placeholder entry");
    const validSkill = (idx) => typeof idx === "number" && Number.isInteger(idx) && idx >= 0
        && idx < skills.length && !isPlaceholder(skills[idx]);
    // Perks / items — behavior-slot asserts and effect shapes
    const checkRoster = (list, label, slots) => {
        const arr = Array.isArray(list) ? list : [];
        if (!Array.isArray(list))
            err(`${label} must be an array`);
        const key_by_slot = new Map();
        for (const [key, slot] of Object.entries(slots))
            key_by_slot.set(slot, key);
        arr.forEach((entry, i) => {
            if (isPlaceholder(entry))
                return;
            const where = `${label}[${i}]`;
            if (typeof entry?.name !== "string" || entry.name.length === 0) {
                err(`${where}.name must be a non-empty string`);
                return;
            }
            const behavior = entry.behavior ?? null;
            if (behavior !== null) {
                const slot = slots[behavior];
                if (slot === undefined) {
                    err(`${where} ("${entry.name}") declares unknown behavior ${JSON.stringify(behavior)}`);
                }
                else if (slot !== i) {
                    err(`${where} ("${entry.name}") declares behavior "${behavior}" but its engine slot is ${slot} (fixed behavior slots)`);
                }
            }
            const slot_key = key_by_slot.get(i);
            if (slot_key !== undefined && behavior !== slot_key) {
                err(`${where} ("${entry.name}") occupies engine behavior slot "${slot_key}" but declares ${JSON.stringify(behavior)}`);
            }
            for (const e of entry.effects ?? []) {
                if (e?.kind === "skill_speed") {
                    if (!validSkill(e.skill))
                        err(`${where} skill_speed effect: skill index ${JSON.stringify(e.skill)} is not a live skill`);
                    if (typeof e.add !== "number")
                        err(`${where} skill_speed effect: add must be a number`);
                }
                else if (e?.kind === "energy_on_consume") {
                    if (!(typeof e.base_amount === "number" && e.base_amount > 0)) {
                        err(`${where} energy_on_consume effect: base_amount must be a positive number`);
                    }
                }
                else if (e?.kind === "xp_all_mult") {
                    // Phase-D rung 1: run scope on perk entries only. The
                    // prestige scope stays a compiled behavior until the
                    // attunement/spark kinds migrate (see EFFECTS).
                    if (label !== "perks") {
                        err(`${where} xp_all_mult effect: only perk entries may carry it`);
                    }
                    if (!(typeof e.mult === "number" && Number.isFinite(e.mult) && e.mult > 0)) {
                        err(`${where} xp_all_mult effect: mult must be a positive finite number`);
                    }
                    if (e.scope !== "run") {
                        err(`${where} xp_all_mult effect: scope must be "run" (prestige scope not yet migrated)`);
                    }
                }
                else if (e?.kind === "starting_energy") {
                    // Phase-D rung 2: run scope on perk entries only, one of
                    // {flat} (applied once on perk grant) or {per_reset,
                    // curve "linear"} (per-energy-reset growth). The
                    // prestige-side starting-energy keys (TranscendantMemory
                    // square, DivineSupremacy flat) stay compiled behaviors
                    // — impure, entangled with other engine branches (see
                    // EFFECTS) — so scope "prestige" and curve "square" are
                    // reserved.
                    if (label !== "perks") {
                        err(`${where} starting_energy effect: only perk entries may carry it`);
                    }
                    const hasFlat = e.flat !== undefined;
                    const hasGrowth = e.per_reset !== undefined;
                    if (hasFlat === hasGrowth) {
                        err(`${where} starting_energy effect: exactly one of flat / per_reset is required`);
                    }
                    else if (hasFlat) {
                        if (!(typeof e.flat === "number" && Number.isFinite(e.flat) && e.flat > 0)) {
                            err(`${where} starting_energy effect: flat must be a positive finite number`);
                        }
                        if (e.curve !== undefined) {
                            err(`${where} starting_energy effect: curve only applies to the per_reset variant`);
                        }
                    }
                    else {
                        if (!(typeof e.per_reset === "number" && Number.isFinite(e.per_reset) && e.per_reset > 0)) {
                            err(`${where} starting_energy effect: per_reset must be a positive finite number`);
                        }
                        if (e.curve !== undefined && e.curve !== "linear") {
                            err(`${where} starting_energy effect: curve must be "linear" ("square" is the compiled TranscendantMemory modifier, not yet migrated)`);
                        }
                    }
                    if (e.scope !== "run") {
                        err(`${where} starting_energy effect: scope must be "run" (prestige scope not yet migrated)`);
                    }
                }
                else {
                    err(`${where} has an effect of unknown kind ${JSON.stringify(e?.kind)}`);
                }
            }
        });
        return arr;
    };
    const perks = checkRoster(ds.perks, "perks", PERK_BEHAVIOR_SLOTS);
    const items = checkRoster(ds.items, "items", ITEM_BEHAVIOR_SLOTS);
    const validRosterIndex = (arr) => (idx) => typeof idx === "number" && Number.isInteger(idx) && idx >= 0
        && idx < arr.length && !isPlaceholder(arr[idx]);
    const validPerk = validRosterIndex(perks);
    const validItem = validRosterIndex(items);
    // Zones / tasks
    const value_mode = ds.economy?.["value_mode"];
    const raw_mode = value_mode === "raw";
    const zones = Array.isArray(ds.zones) ? ds.zones : [];
    if (!Array.isArray(ds.zones) || zones.length === 0)
        err("zones must be a non-empty array");
    const task_ids = new Set();
    const unlock_refs = [];
    zones.forEach((zone, zi) => {
        if (typeof zone?.name !== "string" || zone.name.length === 0)
            err(`zones[${zi}].name must be a non-empty string`);
        if (raw_mode && !(typeof zone?.raw_drain === "number" && zone.raw_drain > 0)) {
            err(`zones[${zi}].raw_drain must be a positive number under value_mode "raw"`);
        }
        const tasks = Array.isArray(zone?.tasks) ? zone.tasks : [];
        if (!Array.isArray(zone?.tasks) || tasks.length === 0)
            err(`zones[${zi}] must have a non-empty tasks array`);
        tasks.forEach((t, ti) => {
            const where = `zones[${zi}].tasks[${ti}]`;
            if (!(typeof t?.id === "number" && Number.isInteger(t.id) && t.id >= 0 && t.id < 10000)) {
                err(`${where}.id must be an integer in [0, 10000) (>= 10000 is the synthetic-injection range)`);
            }
            else if (task_ids.has(t.id)) {
                err(`duplicate task id ${t.id} (${where})`);
            }
            else {
                task_ids.add(t.id);
            }
            if (typeof t?.name !== "string" || t.name.length === 0)
                err(`${where}.name must be a non-empty string`);
            if (typeof t?.type !== "string" || TASK_TYPE_BY_NAME[t.type] === undefined) {
                err(`${where}.type must be one of ${Object.keys(TASK_TYPE_BY_NAME).join("/")}`);
            }
            if (!Array.isArray(t?.skills) || !t.skills.every(validSkill))
                err(`${where}.skills must be an array of live skill indices`);
            if (!(typeof t?.cost_multiplier === "number" && t.cost_multiplier > 0))
                err(`${where}.cost_multiplier must be a positive number`);
            if (!(typeof t?.xp_mult === "number" && t.xp_mult >= 0))
                err(`${where}.xp_mult must be a non-negative number`);
            if (raw_mode) {
                if (!(typeof t?.raw_cost === "number" && t.raw_cost > 0))
                    err(`${where}.raw_cost must be a positive number under value_mode "raw"`);
                if (!(typeof t?.raw_xp === "number" && t.raw_xp >= 0))
                    err(`${where}.raw_xp must be a non-negative number under value_mode "raw"`);
            }
            if (!(typeof t?.max_reps === "number" && Number.isInteger(t.max_reps) && t.max_reps >= 1))
                err(`${where}.max_reps must be an integer >= 1`);
            if (t?.perk != null && !validPerk(t.perk))
                err(`${where}.perk must be null or a live perk index`);
            if (t?.item != null && !validItem(t.item))
                err(`${where}.item must be null or a live item index`);
            if (t?.use_item != null && !validItem(t.use_item))
                err(`${where}.use_item must be null or a live item index`);
            if (t?.prestige_layer != null
                && !(Number.isInteger(t.prestige_layer) && t.prestige_layer >= 0 && t.prestige_layer < PrestigeLayer.Count)) {
                err(`${where}.prestige_layer must be null or a layer index`);
            }
            if (t?.unlocks_task != null && typeof t.id === "number")
                unlock_refs.push([t.id, t.unlocks_task]);
        });
    });
    for (const [from, to] of unlock_refs) {
        if (!task_ids.has(to))
            err(`task ${from} unlocks_task ${to} does not exist`);
    }
    // Prestige
    const prestige = ds.prestige;
    if (prestige == null || typeof prestige !== "object") {
        err("prestige object is required");
    }
    else {
        const layers = Array.isArray(prestige.layers) ? prestige.layers : [];
        if (layers.length !== PrestigeLayer.Count)
            err(`prestige.layers must have exactly ${PrestigeLayer.Count} entries`);
        const checkPrestigeRoster = (list, label, keys, costField) => {
            const arr = Array.isArray(list) ? list : [];
            if (arr.length !== keys.length) {
                err(`prestige.${label} must have exactly ${keys.length} entries (every engine slot is behavior-coupled)`);
                return;
            }
            arr.forEach((entry, i) => {
                if (isPlaceholder(entry))
                    return;
                if (typeof entry?.name !== "string" || entry.name.length === 0)
                    err(`prestige.${label}[${i}].name must be a non-empty string`);
                if (entry?.behavior !== keys[i]) {
                    err(`prestige.${label}[${i}] must declare behavior "${keys[i]}", got ${JSON.stringify(entry?.behavior)}`);
                }
                const cost = entry[costField];
                if (!(typeof cost === "number" && cost > 0))
                    err(`prestige.${label}[${i}].${costField} must be a positive number`);
                if (!(typeof entry?.layer === "number" && Number.isInteger(entry.layer)
                    && entry.layer >= 0 && entry.layer < PrestigeLayer.Count)) {
                    err(`prestige.${label}[${i}].layer must be a layer index`);
                }
            });
        };
        checkPrestigeRoster(prestige.unlockables, "unlockables", PRESTIGE_UNLOCK_BEHAVIOR_KEYS, "cost");
        checkPrestigeRoster(prestige.repeatables, "repeatables", PRESTIGE_REPEATABLE_BEHAVIOR_KEYS, "initial_cost");
        if (!(typeof prestige.spark_zone_origin === "number" && Number.isInteger(prestige.spark_zone_origin)
            && prestige.spark_zone_origin >= 0 && prestige.spark_zone_origin < zones.length)) {
            err("prestige.spark_zone_origin must be a zone index");
        }
        if (!Array.isArray(prestige.sbtv_unlock_task_ids)) {
            err("prestige.sbtv_unlock_task_ids must be an array (may be empty)");
        }
        else {
            for (const id of prestige.sbtv_unlock_task_ids) {
                if (!task_ids.has(id))
                    err(`prestige.sbtv_unlock_task_ids id ${id} does not exist`);
            }
        }
    }
    // Roles
    const roles = ds.roles;
    if (roles == null || typeof roles !== "object") {
        err("roles object is required");
    }
    else {
        if (!validSkill(roles.ascension_skill))
            err("roles.ascension_skill must be a live skill index");
        if (!validSkill(roles.travel_skill))
            err("roles.travel_skill must be a live skill index");
        for (const key of ["attunement_skills", "power_skills", "spite_skills"]) {
            const arr = roles[key];
            if (!Array.isArray(arr) || arr.length === 0 || !arr.every(validSkill)) {
                err(`roles.${key} must be a non-empty array of live skill indices`);
            }
        }
    }
    // Economy
    const economy = ds.economy;
    if (economy == null || typeof economy !== "object") {
        err("economy object is required");
    }
    else {
        for (const key of ECONOMY_KEYS) {
            const value = economy[key];
            if (!(typeof value === "number" && value > 0))
                err(`economy.${key} must be a positive number`);
        }
        if (value_mode !== undefined && value_mode !== "zone_formula" && value_mode !== "raw") {
            err(`economy.value_mode must be "zone_formula" or "raw", got ${JSON.stringify(value_mode)}`);
        }
    }
    // Item groups
    if (ds.item_groups != null) {
        for (const [group, arr] of Object.entries(ds.item_groups)) {
            if (!Array.isArray(arr) || !arr.every(validItem)) {
                err(`item_groups.${group} must be an array of live item indices`);
            }
        }
    }
    return errors;
}
// MARK: Table swap
// Rewrite a compiled enum object's Count member (and its reverse mapping) so
// counts track the dataset. Member values never move; reverse-map entries for
// vanilla members above a smaller dataset's Count are left in place — nothing
// reads them at runtime.
function setEnumCount(enum_obj, new_count) {
    const obj = enum_obj;
    const old_count = obj["Count"];
    if (old_count === new_count)
        return;
    if (obj[old_count] === "Count")
        delete obj[old_count];
    obj["Count"] = new_count;
    obj[new_count] = "Count";
}
function skillSpeedPairs(effects) {
    const pairs = [];
    for (const e of effects ?? []) {
        if (e.kind === "skill_speed")
            pairs.push([e.skill, e.add]);
    }
    return pairs;
}
function energyOnConsume(effects) {
    for (const e of effects ?? []) {
        if (e.kind === "energy_on_consume")
            return e.base_amount;
    }
    return null;
}
function staticText(text) {
    if (typeof text === "string" && text.length > 0) {
        return () => text;
    }
    return null;
}
function swapSkillTables(ds) {
    const skills = ds.skills;
    SKILL_DEFINITIONS.length = 0;
    SKILLS.length = 0;
    skills.forEach((s, i) => {
        const type = i;
        if (isPlaceholder(s)) {
            SKILL_DEFINITIONS.push(new SkillDefinition({ type, name: "REMOVED", icon: "⁉" }));
            return;
        }
        SKILL_DEFINITIONS.push(new SkillDefinition({
            type,
            name: s.name,
            icon: s.icon ?? "",
            xp_needed_mult: s.xp_needed_mult ?? 1,
        }));
        SKILLS.push(type);
    });
    setEnumCount(SkillType, skills.length);
}
function swapPerkTables(ds) {
    const perks = ds.perks;
    PERKS.length = 0;
    perks.forEach((entry, i) => {
        const slot = i;
        if (isPlaceholder(entry)) {
            PERKS.push(new PerkDefinition({ enum: slot, name: "DELETED", icon: "❓" }));
            return;
        }
        const def = new PerkDefinition({
            enum: slot,
            name: entry.name,
            icon: entry.icon ?? "",
            skill_modifiers: new PerkSkillModifierList(skillSpeedPairs(entry.effects)),
        });
        // Behavior-slot entries keep their compiled tooltip lambda (often
        // state-dependent) unless the dataset provides text; declarative
        // entries fall back to the skill_modifiers description.
        const tooltip = staticText(entry.tooltip);
        const base = entry.behavior != null ? VANILLA_PERK_DEFS[i] : undefined;
        if (tooltip) {
            def.get_custom_tooltip = tooltip;
        }
        else if (base) {
            def.get_custom_tooltip = base.get_custom_tooltip;
        }
        PERKS.push(def);
    });
    setEnumCount(PerkType, perks.length);
}
function swapItemTables(ds) {
    const items = ds.items;
    ITEMS.length = 0;
    items.forEach((entry, i) => {
        const slot = i;
        if (isPlaceholder(entry)) {
            ITEMS.push(new ItemDefinition({ enum: slot, name: "DELETED", name_plural: "DELETED", icon: "❓" }));
            return;
        }
        const def = new ItemDefinition({
            enum: slot,
            name: entry.name,
            name_plural: entry.name_plural ?? entry.name,
            icon: entry.icon ?? "",
            skill_modifiers: new ItemSkillModifierList(skillSpeedPairs(entry.effects)),
        });
        const tooltip = staticText(entry.tooltip);
        const energy_base = energyOnConsume(entry.effects);
        if (entry.behavior != null) {
            // Artifact behaviors: the queue mechanics live in compiled code;
            // keep the vanilla slot's lambdas, take dataset name/icon/tooltip.
            const base = VANILLA_ITEM_DEFS[i];
            def.on_consume = base.on_consume;
            def.get_custom_effect_text = base.get_custom_effect_text;
            def.get_custom_tooltip = tooltip ?? base.get_custom_tooltip;
        }
        else if (energy_base !== null) {
            // Declarative energy grant — synthesized on the vanilla Food
            // pattern so magnitude and text scale with calcItemEnergyGain.
            def.on_consume = (amount) => { GAMESTATE.current_energy += calcItemEnergyGain(energy_base) * amount; };
            def.get_custom_tooltip = () => `Gives ${calcItemEnergyGain(energy_base)} ${ENERGY_TEXT} each<br>Can take you above your Max Energy<br><br>Right-click to use all`;
            def.get_custom_effect_text = (amount) => `Gained ${amount * calcItemEnergyGain(energy_base)} ${ENERGY_TEXT}`;
        }
        else if (tooltip) {
            def.get_custom_tooltip = tooltip;
        }
        ITEMS.push(def);
    });
    setEnumCount(ItemType, items.length);
    // Derived groups. ARTIFACTS = the items occupying the artifact behavior
    // slots (ascending slot order, matching vanilla); NOTE_ITEMS comes from
    // the dataset's item_groups (empty when absent — Compulsive Notetaking
    // then floors nothing, which is what a dataset without the group asked for).
    ARTIFACTS.length = 0;
    items.forEach((entry, i) => {
        if (!isPlaceholder(entry) && entry.behavior != null && ITEM_BEHAVIOR_SLOTS[entry.behavior] !== undefined) {
            ARTIFACTS.push(i);
        }
    });
    NOTE_ITEMS.length = 0;
    for (const idx of ds.item_groups?.["note_items"] ?? []) {
        NOTE_ITEMS.push(idx);
    }
}
function swapPrestigeTables(ds) {
    const prestige = ds.prestige;
    prestige.unlockables.forEach((entry, i) => {
        const base = VANILLA_UNLOCK_DEFS[i];
        if (isPlaceholder(entry)) {
            // An unused prestige slot keeps its vanilla definition — the
            // engine renders every slot, and dead prestige slots have no
            // vanilla precedent to mimic. v1 datasets carry full tables.
            PRESTIGE_UNLOCKABLES[i] = base;
            return;
        }
        PRESTIGE_UNLOCKABLES[i] = {
            type: i,
            layer: entry.layer,
            name: entry.name,
            get_description: staticText(entry.description) ?? base.get_description,
            cost: entry.cost,
        };
    });
    prestige.repeatables.forEach((entry, i) => {
        const base = VANILLA_REPEATABLE_DEFS[i];
        if (isPlaceholder(entry)) {
            PRESTIGE_REPEATABLES[i] = base;
            return;
        }
        PRESTIGE_REPEATABLES[i] = {
            type: i,
            layer: entry.layer,
            name: entry.name,
            get_description: staticText(entry.description) ?? base.get_description,
            initial_cost: entry.initial_cost,
            scaling_exponent: entry.scaling_exponent,
        };
    });
    PRESTIGE_DATA.spark_zone_origin = prestige.spark_zone_origin;
    PRESTIGE_DATA.sbtv_unlock_task_ids = [...prestige.sbtv_unlock_task_ids];
}
function swapZoneTables(ds) {
    const zones = ds.zones;
    ZONES.length = 0;
    zones.forEach((zone, zi) => {
        const tasks = zone.tasks.map((t) => new TaskDefinition({
            id: t.id,
            name: t.name,
            type: TASK_TYPE_BY_NAME[t.type],
            cost_multiplier: t.cost_multiplier,
            skills: [...t.skills],
            xp_mult: t.xp_mult,
            // "None" is null in the dataset; the engine's sentinel is the
            // (dataset-sized) Count value.
            item: (t.item ?? ItemType.Count),
            use_item: (t.use_item ?? ItemType.Count),
            perk: (t.perk ?? PerkType.Count),
            prestige_layer: (t.prestige_layer ?? PrestigeLayer.Count),
            max_reps: t.max_reps,
            hidden_by_default: t.hidden_by_default === true,
            unlocks_task: t.unlocks_task ?? -1,
            zone_id: zi,
            raw_cost: t.raw_cost,
            raw_xp: t.raw_xp,
        }));
        ZONES.push({ name: zone.name, tasks, raw_drain: zone.raw_drain });
    });
    rebuildZoneDerivedMaps();
}
function applyRolesAndEconomy(ds) {
    const roles = ds.roles;
    SKILL_ROLES.ascension_skill = roles.ascension_skill;
    SKILL_ROLES.travel_skill = roles.travel_skill;
    SKILL_ROLES.attunement_skills = [...roles.attunement_skills];
    SKILL_ROLES.power_skills = [...roles.power_skills];
    SKILL_ROLES.spite_skills = [...roles.spite_skills];
    const economy = ds.economy;
    for (const key of ECONOMY_KEYS) {
        ECONOMY[key] = economy[key];
    }
    // Absent ⇒ zone_formula; also RESETS the mode when a formula dataset is
    // loaded after a raw one.
    ECONOMY.value_mode = economy["value_mode"] === "raw" ? "raw" : "zone_formula";
}
// Rebuild the declarative effect handler tables (simulation.ts EFFECTS) from
// the dataset roster — the Phase-D migration seam. Rebuilt wholesale on every
// load: entries in ascending perk-index order, matching the vanilla defaults'
// application order.
function applyEffects(ds) {
    const xp_all_mult_run = [];
    const starting_energy_flat_run = [];
    const starting_energy_growth_run = [];
    ds.perks.forEach((entry, i) => {
        for (const e of entry.effects ?? []) {
            if (e.kind === "xp_all_mult") {
                xp_all_mult_run.push([i, e.mult]);
            }
            else if (e.kind === "starting_energy") {
                if (e.flat !== undefined) {
                    starting_energy_flat_run.push([i, e.flat]);
                }
                else {
                    starting_energy_growth_run.push([i, e.per_reset]);
                }
            }
        }
    });
    EFFECTS.xp_all_mult_run = xp_all_mult_run;
    EFFECTS.starting_energy_flat_run = starting_energy_flat_run;
    EFFECTS.starting_energy_growth_run = starting_energy_growth_run;
}
// Validate, then swap every content table atomically (validation is complete
// before the first mutation — a failing dataset changes nothing). Idempotent
// per dataset_id. The caller re-initializes the game after a real swap.
export function applyGameDataset(dataset) {
    const errors = validateGameDataset(dataset);
    if (errors.length > 0) {
        return { ok: false, alreadyLoaded: false, errors };
    }
    const ds = dataset;
    if (getLoadedDatasetId() === ds.dataset_id) {
        return { ok: true, alreadyLoaded: true };
    }
    swapSkillTables(ds);
    swapPerkTables(ds);
    swapItemTables(ds);
    swapPrestigeTables(ds);
    swapZoneTables(ds);
    applyRolesAndEconomy(ds);
    applyEffects(ds);
    setLoadedDataset(ds.dataset_id, ds.schema_version);
    return { ok: true, alreadyLoaded: false };
}
//# sourceMappingURL=game_data.js.map