export declare const JTA_DATASET_SCHEMA_VERSION = 1;
interface DsEffect {
    kind?: string;
    skill?: number;
    add?: number;
    base_amount?: number;
    mult?: number;
    scope?: string;
}
interface DsRosterEntry {
    placeholder?: boolean;
    name?: string;
    name_plural?: string;
    icon?: string;
    tooltip?: string | null;
    effects?: DsEffect[];
    behavior?: string | null;
}
interface DsSkill {
    placeholder?: boolean;
    name?: string;
    icon?: string;
    xp_needed_mult?: number;
}
interface DsTask {
    id?: number;
    name?: string;
    type?: string;
    skills?: number[];
    cost_multiplier?: number;
    xp_mult?: number;
    max_reps?: number;
    hidden_by_default?: boolean;
    unlocks_task?: number | null;
    perk?: number | null;
    item?: number | null;
    use_item?: number | null;
    prestige_layer?: number | null;
    raw_cost?: number;
    raw_xp?: number;
}
interface DsZone {
    name?: string;
    key?: string;
    tasks?: DsTask[];
    raw_drain?: number;
}
interface DsPrestigeUnlock {
    placeholder?: boolean;
    name?: string;
    layer?: number;
    cost?: number;
    description?: string | null;
    behavior?: string;
}
interface DsPrestigeRepeatable {
    placeholder?: boolean;
    name?: string;
    layer?: number;
    initial_cost?: number;
    scaling_exponent?: number;
    description?: string | null;
    behavior?: string;
}
interface DsPrestige {
    layers?: unknown[];
    unlockables?: DsPrestigeUnlock[];
    repeatables?: DsPrestigeRepeatable[];
    spark_zone_origin?: number;
    sbtv_unlock_task_ids?: number[];
}
interface DsRoles {
    ascension_skill?: number;
    travel_skill?: number;
    attunement_skills?: number[];
    power_skills?: number[];
    spite_skills?: number[];
}
export interface JtaDataset {
    schema_version?: number;
    dataset_id?: string;
    skills?: DsSkill[];
    zones?: DsZone[];
    perks?: DsRosterEntry[];
    items?: DsRosterEntry[];
    prestige?: DsPrestige;
    roles?: DsRoles;
    economy?: Record<string, unknown>;
    item_groups?: Record<string, number[]>;
}
export declare function validateGameDataset(dataset: unknown): string[];
export declare function applyGameDataset(dataset: unknown): {
    ok: boolean;
    alreadyLoaded: boolean;
    errors?: string[];
};
export {};
//# sourceMappingURL=game_data.d.ts.map