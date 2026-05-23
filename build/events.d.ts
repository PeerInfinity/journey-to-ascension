import { ItemType } from "./items.js";
import { PerkType } from "./perks.js";
import { SkillType } from "./skills.js";
import { TaskDefinition } from "./zones.js";
export declare enum EventType {
    SkillUp = 0,
    GainedPerk = 1,
    GainedItem = 2,
    UsedItem = 3,
    UndidItem = 4,
    UnlockedTask = 5,
    UnlockedSkill = 6,
    UnlockedPower = 7,
    TaskCompleted = 8,
    PrestigeAvailable = 9,
    NewHighestZone = 10,
    NewHighestZoneFullyCompleted = 11,
    NewPrestigeLayer = 12,
    SkippedZones = 13,
    SkippedTasks = 14,
    UsedItems = 15,
    Count = 16
}
export declare class EventContext {
}
export declare class RenderEvent {
    type: EventType;
    context: EventContext;
    constructor(type: EventType, context: EventContext);
}
export declare class SkillUpContext extends EventContext {
    skill: SkillType;
    new_level: number;
    levels_gained: number;
}
export declare class GainedPerkContext extends EventContext {
    perk: PerkType;
}
export declare class UsedItemContext extends EventContext {
    item: ItemType;
    count: number;
}
export declare class UsedItemsContext extends EventContext {
    count: number;
}
export declare class UnlockedTaskContext extends EventContext {
    task_definition: TaskDefinition;
}
export declare class UnlockedSkillContext extends EventContext {
    skill: SkillType;
}
export declare class HighestZoneContext extends EventContext {
    zone: number;
}
export declare class SkippedTasksContext extends EventContext {
    tasks: number;
}
//# sourceMappingURL=events.d.ts.map