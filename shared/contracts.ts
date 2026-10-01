export type Amount = string;
export type ActivityKind = 'idle' | 'meditate' | 'dungeon' | 'practice';
export const FOUNDATION_METHOD_IDS = ['human', 'earth', 'heaven'] as const;
export type FoundationMethodId = typeof FOUNDATION_METHOD_IDS[number];
export type WeaponType = 'sword' | 'gauntlet' | 'staff';
export const PROFICIENCY_IDS = ['sword', 'body', 'spell', 'alchemy', 'forging'] as const;
export type ProficiencyId = typeof PROFICIENCY_IDS[number];
export const EQUIPMENT_SLOTS = ['weapon', 'armor', 'footwear', 'accessory'] as const;
export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];
export const WEAPON_TYPE_LABELS: Readonly<Record<WeaponType, string>> = Object.freeze({
  sword: '剑', gauntlet: '拳套', staff: '杖',
});
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export const RARITY_LABELS: Readonly<Record<Rarity, string>> = Object.freeze({
  common: '凡品', uncommon: '灵品', rare: '玄品', epic: '地品',
});

export interface ActionView {
  name: string;
  damageType: 'physical' | 'magical';
  hits: number;
  coefficient: string;
  mpCost: string;
  baseMpCost?: string;
}

export type GameCommand =
  | { type: 'fate-draw'; lifeId: string }
  | { type: 'fate-select'; lifeId: string; slot: number; fateId: string | null }
  | { type: 'fate-designate'; lifeId: string; slot: number; fateId: string }
  | { type: 'enter-life'; lifeId: string }
  | { type: 'reincarnate'; lifeId: string }
  | { type: 'challenge'; lifeId: string; challengeId: string }
  | { type: 'activity'; kind: ActivityKind; targetId?: string }
  | { type: 'equip'; slot: EquipmentSlot; instanceId: string | null }
  | { type: 'technique'; techniqueId: string }
  | { type: 'learn-technique'; techniqueId: string }
  | { type: 'supply'; enabled: boolean; hpThreshold: number }
  | { type: 'mana-supply'; enabled: boolean; mpThreshold: number }
  | { type: 'craft'; recipeId: string; quantity: number }
  | { type: 'consume'; itemId: string; quantity: number }
  | { type: 'buy'; itemId: string; quantity: number }
  | { type: 'sell'; itemId: string; quantity: number }
  | { type: 'upgrade-dwelling'; track: 'tier' | 'gathering' | 'study' }
  | { type: 'breakthrough'; lifeId: string; methodId: FoundationMethodId };

export interface StatsView {
  maxHp: Amount;
  maxMp: Amount;
  attack: Amount;
  magicAttack: Amount;
  defense: Amount;
  magicDefense: Amount;
  agility: Amount;
  hpRegen: Amount;
  mpRegen: Amount;
  attackIntervalMs: number;
  critChance: number;
  critMultiplier: number;
}

export interface ReincarnationRecord {
  lifeId: string; at: number; level: number; foundationMethodId: FoundationMethodId | null;
  realmPoints: Amount; explorationPoints: Amount; points: Amount; explorationNodes: string[];
}

export interface GameView {
  contentVersion: string;
  presentationVersion: string;
  clockMs: number;
  name: string;
  life: {
    id: string; phase: 'preparing' | 'active'; luckBonus: Amount;
    innateFates: FateView[];
    opening: null | {
      slots: number; candidatesPerDraw: number; drawsRemaining: number; designationsRemaining: number;
      selected: (FateView | null)[]; candidates: FateView[]; designatable: FateView[]; ready: boolean;
    };
  };
  reincarnation: {
    lifeId: string; unlocked: boolean; ready: boolean; requirements: string[];
    minimumLevel: number; points: Amount; count: Amount; pointsAfter: Amount;
    reward: { realmPoints: Amount; explorationPoints: Amount; total: Amount };
    openingTier: number; openingTierAfter: number;
    tiers: { requiredPoints: Amount; slots: number; candidates: number; draws: number; designations: number; unlocked: boolean }[];
    nodes: { id: string; name: string; progress: Amount; required: Amount; completed: boolean; points: Amount }[];
    history: { highestLevel: number; visitedRegions: string[]; explorationNodes: string[]; highestDwellingTier: number };
    lastSettlement: ReincarnationRecord | null;
    retained: string[]; reset: string[];
    losses: { stones: Amount; itemStacks: number; equipmentCount: number };
  };
  realm: { level: number; name: string };
  cultivation: {
    current: Amount;
    required: Amount;
    reserve: Amount;
    capacity: Amount;
    efficiency: number;
  };
  // Configured technique action; combat uses the basic action when mana is insufficient.
  player: {
    hp: Amount; mp: Amount; stats: StatsView; pillAttack: Amount; action: ActionView;
    pillMagicAttack: Amount; pillDefense: Amount; pillMagicDefense: Amount; pillMaxHp: Amount;
  };
  stones: Amount;
  proficiencies: {
    id: ProficiencyId; name: string; xp: Amount; level: number; maxLevel: number;
    nextLevelXp: Amount | null; active: boolean; effects: string[];
    historicalXp: Amount; perLevelEffects: string[];
    retraining: { bonus: Amount; untilXp: Amount };
    combatProgress?: { current: number; required: number } | { used: boolean };
    milestones: { level: number; name: string; reached: boolean; effects: string[] }[];
  }[];
  dwelling?: {
    name: string;
    tier: number;
    gathering: number;
    study: number;
    meditationPerSecond: Amount;
    practicePerSecond: Amount;
    meditationBonus: Amount;
    practiceBonus: Amount;
    upgrades: {
      track: 'tier' | 'gathering' | 'study'; name: string; completed: boolean;
      ready: boolean; requirement: string; effects: string[];
      costs: { itemId: string; name: string; quantity: Amount; owned: Amount }[];
    }[];
  };
  activity: {
    kind: ActivityKind;
    targetId?: string;
    challengeId?: string;
    startedAt: number;
    stoppedAt?: number;
    stopReason?: string;
  };
  battle: null | {
    enemyId: string;
    name: string;
    lore: string;
    action: ActionView;
    hp: Amount;
    maxHp: Amount;
    mp: Amount;
    maxMp: Amount;
    hitChance: number;
    abilities: string[];
    realm?: { level: number; name: string };
    rank?: 'normal' | 'elite' | 'boss';
    shield?: Amount;
  };
  supply: { enabled: boolean; hpThreshold: number };
  manaSupply?: { enabled: boolean; mpThreshold: number; itemId: string; cooldownMs: number };
  inventory: {
    id: string;
    name: string;
    kind: string;
    quantity: Amount;
    description: string;
    lore: string;
    rarity: Rarity;
    effects: string[];
    source: string;
    buyPrice?: Amount;
    sellPrice?: Amount;
    canConsume: boolean;
    unlocked: boolean;
    growth?: {
      stat: 'attack' | 'magicAttack' | 'defense' | 'magicDefense' | 'maxHp';
      tier: { id: string; name: string };
      baseGain: Amount; nextGain: Amount; cumulative: Amount; scale: Amount;
    };
  }[];
  equipment: {
    instanceId: string;
    definitionId: string;
    name: string;
    description: string;
    lore: string;
    rarity: Rarity;
    slot: EquipmentSlot;
    category?: WeaponType;
    quality?: { id: string; name: string };
    stats: { label: string; value: string }[];
    effects: string[];
    equipped: boolean;
    affixes: string[];
  }[];
  techniques: {
    id: string;
    name: string;
    description: string;
    lore: string;
    rarity: Rarity;
    // Omitted: not configured; null: explicitly untyped. A type alone grants no bonus.
    weaponType?: WeaponType | null;
    weaponMatch?: {
      conditionMet: boolean;
      active: boolean;
      effects: string[];
      actionDamagePercent: Amount;
    };
    effects: string[];
    action: ActionView;
    xpCap: string;
    masteryEffects: string[];
    requirement: string;
    xp: Amount;
    active: boolean;
    unlocked: boolean;
    learning?: { discovered: boolean; learned: boolean; manualItemId?: string; owned: Amount };
  }[];
  regions: {
    id: string;
    parentId?: string;
    name: string;
    description: string;
    lore: string;
    enemies: {
      id: string; name: string; lore: string; action: ActionView; abilities: string[];
      realm?: { level: number; name: string }; rank?: 'normal' | 'elite' | 'boss'; encounterChance?: Amount;
      drops: DropView[];
    }[];
    drops: string[];
    clear?: {
      wavesPerClear: number;
      completedWaves: number;
      clears: Amount;
      reward: { stones: Amount; cultivation: Amount };
      firstBonus?: { stones: Amount; cultivation: Amount };
    };
    unlocked: boolean;
    requirement: string;
  }[];
  recipes: {
    id: string;
    name: string;
    description: string;
    lore: string;
    rarity: Rarity;
    effects: string[];
    outputId: string;
    outputName: string;
    outputQuantity: string;
    outputKind?: 'equipment';
    equipmentSlot?: EquipmentSlot;
    qualities?: { id: string; name: string; rarity: Rarity; probability: Amount; statMultiplier: Amount; effectMultiplier: Amount }[];
    production: {
      proficiencyId: 'alchemy' | 'forging'; difficulty: number; successChance: Amount;
      successXp: Amount; failureXp: Amount; attempts: Amount; successes: Amount;
      extraOutputChance: Amount; qualityRolls: number;
    };
    learning?: { learned: boolean; requiredAlchemyLevel: number };
    costs: { name: string; itemId: string; quantity: Amount; owned: Amount }[];
    unlocked: boolean;
    requirement: string;
  }[];
  challenges: {
    id: string; name: string; lore: string; requirement: string; maxLevel: number;
    unlocked: boolean; canStart: boolean; wins: Amount;
    enemy: GameView['regions'][number]['enemies'][number] & { stats: StatsView };
  }[];
  achievements: {
    id: string; name: string; description: string; completed: boolean;
    completedAt?: number; lifeId?: string;
  }[];
  breakthrough: {
    ready: boolean; requirements: string[];
    methodId: FoundationMethodId | null; attempts: Amount;
    lastAttempt: { methodId: FoundationMethodId; at: number; success: boolean } | null;
    effects: string[];
    methods: {
      id: FoundationMethodId; name: string; successChance: Amount; ready: boolean; effects: string[];
      costs: { itemId: string; name: string; owned: Amount; quantity: Amount; failureQuantity: Amount }[];
    }[];
  };
  totals: { kills: Amount; pillsUsed: Amount; cultivationGained: Amount; activeSeconds: Amount };
  journal: { at: number; text: string; kind: 'combat' | 'gain' | 'stop' | 'progress'; category?: 'damage' | 'recovery' | 'loot' }[];
}

export interface FateView {
  id: string; name: string; rarity: Rarity; lore: string; effects: string[];
}

export interface DropView {
  id: string; name: string; kind: 'item' | 'equipment'; quantity: Amount;
  baseChance: Amount; effectiveChance: Amount; luckEligible: boolean; luckExcludedReason?: string;
}

export interface GameResponse {
  game: GameView;
  revision: string;
  serverTime: number;
  mode: 'local-development';
}
