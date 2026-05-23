import { ItemType } from "./items.js";
import { PerkType } from "./perks.js";
import { PrestigeLayer } from "./prestige_upgrades.js";
import { SkillType } from "./skills.js";
export declare enum TaskType {
    Normal = 0,
    Travel = 1,
    Mandatory = 2,
    Prestige = 3,
    Boss = 4
}
export declare class TaskDefinition {
    id: number;
    name: string;
    type: TaskType;
    cost_multiplier: number;
    skills: SkillType[];
    xp_mult: number;
    item: ItemType;
    use_item: ItemType;
    perk: PerkType;
    prestige_layer: PrestigeLayer;
    max_reps: number;
    hidden_by_default: boolean;
    unlocks_task: number;
    zone_id: number;
    constructor(overrides?: Partial<TaskDefinition>);
}
export declare class Task {
    task_definition: TaskDefinition;
    progress: number;
    reps: number;
    enabled: boolean;
    hasted: boolean;
    xp_boosted: boolean;
    lightning: boolean;
    constructor(definition: TaskDefinition);
}
export declare class Zone {
    name: string;
    tasks: TaskDefinition[];
}
export declare const ZONES: Zone[];
export declare const TASK_LOOKUP: Map<number, TaskDefinition>;
export declare const PERKS_BY_ZONE: PerkType[];
export declare const ITEMS_BY_ZONE: ItemType[];
//# sourceMappingURL=zones.d.ts.map