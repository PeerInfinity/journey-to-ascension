export declare enum PrestigeLayer {
    TouchTheDivine = 0,
    TranscendHumanity = 1,
    EmbraceDivinity = 2,
    AscendToGodhood = 3,
    Count = 4
}
export declare enum PrestigeUnlockType {
    PermanentAutomation = 0,
    DivineInspiration = 1,
    LookInTheMirror = 2,
    FullyAttuned = 3,
    TranscendantMemory = 4,
    DivineSpeed = 5,
    MasteryOfTime = 6,
    SeeBeyondTheVeil = 7,
    Perky = 8,
    CompulsiveNotetaking = 9,
    CraftingBreakthrough = 10,
    GodlyTravel = 11,
    AmazingSpeed = 12,
    LimitlessPower = 13,
    UnparalleledLearning = 14,
    DivineSupremacy = 15,
    Count = 16
}
export declare enum PrestigeRepeatableType {
    DivineKnowledge = 0,
    UnlimitedPower = 1,
    DivineAppetite = 2,
    GottaGoFast = 3,
    DivineLightning = 4,
    TranscendantAptitude = 5,
    Energized = 6,
    Deenergized = 7,
    MandatorySchmandatory = 8,
    DivineAttunement = 9,
    SpiteTheGods = 10,
    DivinerKnowledge = 11,
    Count = 12
}
type PrestigeDescLambda = () => string;
export declare class PrestigeUnlock {
    type: PrestigeUnlockType;
    layer: PrestigeLayer;
    name: string;
    get_description: PrestigeDescLambda;
    cost: number;
}
export declare class PrestigeRepeatable {
    type: PrestigeRepeatableType;
    layer: PrestigeLayer;
    name: string;
    get_description: PrestigeDescLambda;
    initial_cost: number;
    scaling_exponent: number;
}
export declare const DIVINE_SPEED_TICKS_PER_PERCENT = 4;
export declare const PERKY_BASE = 1.01;
export declare const COMPULSIVE_NOTE_TAKING_AMOUNT = 2;
export declare const GODLY_TRAVEL_MULT = 5;
export declare const FINAL_PRESTIGE_MULT = 5;
export declare const DIVINE_SUPREMACY_ENERGY = 1000;
export declare const PRESTIGE_UNLOCKABLES: PrestigeUnlock[];
export declare const DIVINE_KNOWLEDGE_MULT = 0.5;
export declare const DIVINER_KNOWLEDGE_MULT = 1;
export declare const DIVINE_APPETITE_ENERGY_ITEM_BOOST_MULT = 0.2;
export declare const GOTTA_GO_FAST_BASE = 1.1;
export declare const TRANSCENDANT_APTITUDE_MULT = 100;
export declare const DIVINE_LIGHTNING_EXPONENT_INCREASE = 0.12;
export declare const ENERGIZED_INCREASE = 20;
export declare const ENERGIZED_PERK_INCREASE = 0.05;
export declare const DEENERGIZED_BASE = 0.9;
export declare const MANDATORY_SCHMANDATORY_MULT = 0.2;
export declare const DIVINE_ATTUNEMENT_BASE = 1.25;
export declare const SPITE_THE_GODS_MULT = 0.25;
export declare const PRESTIGE_REPEATABLES: PrestigeRepeatable[];
export {};
//# sourceMappingURL=prestige_upgrades.d.ts.map