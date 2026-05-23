import { PerkSkillModifierList } from "./modifiers.js";
export declare enum PerkType {
    Reading = 0,
    Writing = 1,
    VillagerGratitude = 2,
    Amulet = 3,
    EnergySpell = 4,
    ExperiencedTraveler = 5,
    UndergroundConnection = 6,
    MinorTimeCompression = 7,
    HighAltitudeClimbing = 8,
    DELETED = 9,
    VillageHero = 10,
    Attunement = 11,
    GoblinScourge = 12,
    SunkenTreasure = 13,
    LostTemple = 14,
    WalkWithoutRhythm = 15,
    ReflectionsOnTheJourney = 16,
    PurgedBureaucracy = 17,
    DeepSeaDiving = 18,
    EnergeticMemory = 19,
    TheWorm = 20,
    TowerOfBabel = 21,
    Awakening = 22,
    MajorTimeCompression = 23,
    HideInPlainSight = 24,
    DreamPrism = 25,
    DragonKillingPlan = 26,
    UnifiedTheoryOfMagic = 27,
    Headmaster = 28,
    DragonSlayer = 29,
    UnderstandingTheReset = 30,
    OvercameFearOfSkydiving = 31,
    DestroyedTheRing = 32,
    GazedBeyondTheVeil = 33,
    UndergroundForge = 34,
    UnderstandingLeviathan = 35,
    PurgedDemonicInfluences = 36,
    DefiedTheGods = 37,
    SurvivedTheVoid = 38,
    CommunedWithDamnedSouls = 39,
    DivinePower = 40,
    SecondInCommand = 41,
    SupplyLines = 42,
    FinalRitual = 43,
    ReturnedHeraldHead = 44,
    AvoidedGodlyRevenge = 45,
    Ascended = 46,
    Count = 47
}
export declare function getPerkNameWithEmoji(type: PerkType): string;
type PerkTooltipLambda = () => string;
export declare class PerkDefinition {
    enum: PerkType;
    name: string;
    get_custom_tooltip: PerkTooltipLambda;
    icon: string;
    skill_modifiers: PerkSkillModifierList;
    constructor(overrides?: Partial<PerkDefinition>);
    getTooltip(): string;
}
export declare function getReflectionsOnTheJourneyExponent(): 0.95 | 0.9;
export declare const PERKS: PerkDefinition[];
export {};
//# sourceMappingURL=perks.d.ts.map