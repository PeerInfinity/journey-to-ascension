import { ItemSkillModifierList } from "./modifiers.js";
export declare enum ItemType {
    Food = 0,
    Arrow = 1,
    Coin = 2,
    Mushroom = 3,
    GoblinSupplies = 4,
    TravelEquipment = 5,
    Book = 6,
    ScrollOfHaste = 7,
    GoblinWaraxe = 8,
    CampingEquipment = 9,
    Reagents = 10,
    MagicalRoots = 11,
    GoblinTreasure = 12,
    Fish = 13,
    BanditWeapons = 14,
    Cactus = 15,
    CityChain = 16,
    WerewolfFur = 17,
    OasisWater = 18,
    Calamari = 19,
    MysticIncense = 20,
    OracleBones = 21,
    WormHideCoat = 22,
    DjinnLamp = 23,
    Dreamcatcher = 24,
    MagicEssence = 25,
    CraftingRecipe = 26,
    KnightlyBoots = 27,
    DragonScale = 28,
    CaveInsects = 29,
    MagicalVessel = 30,
    MagicRing = 31,
    BottledLightning = 32,
    HeatEssence = 33,
    DivineNotes = 34,
    GriffinQuill = 35,
    WingsOfShadow = 36,
    RitualSymbol = 37,
    Glasses = 38,
    Light = 39,
    MadContraption = 40,
    Recording = 41,
    DivineSpark = 42,
    VoidEssence = 43,
    ArmyFood = 44,
    RitualSacrifice = 45,
    Count = 46
}
type ItemUseLambda = (amount: number) => void;
type ItemEffectTextLambda = (amount: number) => string;
type ItemTooltipLambda = () => string;
export declare class ItemDefinition {
    enum: ItemType;
    name: string;
    name_plural: string;
    icon: string;
    skill_modifiers: ItemSkillModifierList;
    get_custom_tooltip: ItemTooltipLambda;
    get_custom_effect_text: ItemEffectTextLambda;
    on_consume: ItemUseLambda;
    constructor(overrides?: Partial<ItemDefinition>);
    getTooltip(): string;
    getEffectText(amount: number): string;
    applyEffects(amount: number): void;
    getNameWithEmoji(amount: number): string;
}
export declare const HASTE_MULT = 5;
export declare const MAGIC_RING_MULT = 5;
export declare const BOTTLED_LIGHTNING_MULT = 2;
export declare const ITEMS: ItemDefinition[];
export declare const ARTIFACTS: ItemType[];
export declare const NOTE_ITEMS: ItemType[];
export {};
//# sourceMappingURL=items.d.ts.map