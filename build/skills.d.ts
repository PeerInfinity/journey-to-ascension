export declare enum SkillType {
    Charisma = 0,
    Study = 1,
    Combat = 2,
    Search = 3,
    Subterfuge = 4,
    Crafting = 5,
    REMOVED = 6,
    Travel = 7,
    Magic = 8,
    Fortitude = 9,
    REMOVED2 = 10,
    Ascension = 11,
    Count = 12
}
export declare const SKILLS: SkillType[];
export declare class SkillDefinition {
    type: SkillType;
    name: string;
    icon: string;
    xp_needed_mult: number;
    constructor(overrides?: Partial<SkillDefinition>);
}
export declare const SKILL_DEFINITIONS: SkillDefinition[];
//# sourceMappingURL=skills.d.ts.map