import { SkillType } from "./skills.js";
declare enum SkillModifierType {
    Item = 0,
    Perk = 1,
    Count = 2
}
export declare class SkillModifier {
    skill: SkillType;
    effect: number;
    constructor(skill: SkillType, effect: number);
}
declare class SkillModifierList {
    modifiers: SkillModifier[];
    type: SkillModifierType;
    constructor(type: SkillModifierType, modifiers: [skill: SkillType, effect: number][]);
    getStacked(stacks: number): SkillModifierList;
    private buildSkillMap;
    getDescription(): string;
    getAppliedDescription(): string;
    applyEffect(): void;
    getSkillEffect(type: SkillType): number;
    affectsSkill(type: SkillType): boolean;
}
export declare class ItemSkillModifierList extends SkillModifierList {
    constructor(modifiers: [skill: SkillType, effect: number][]);
}
export declare class PerkSkillModifierList extends SkillModifierList {
    constructor(modifiers: [skill: SkillType, effect: number][]);
}
export {};
//# sourceMappingURL=modifiers.d.ts.map