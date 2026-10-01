import type { ActivityKind, EquipmentSlot, FoundationMethodId, GameView, ProficiencyId, ReincarnationRecord } from '../shared/contracts';
import type { Effect, Modifier, EquipmentQualitySnapshot } from './content';

export interface EquipmentInstance {
  instanceId: string;
  definitionId: string;
  contentVersion: string;
  affixes: { definitionId: string; value: string; modifier?: Modifier; effect?: Effect }[];
  quality?: EquipmentQualitySnapshot;
}

export interface Combatant {
  hp: string;
  mp: string;
  shield: string;
  nextActionMs: number;
}

export interface ProficiencyCombatState {
  swordActions: number;
  spellCasts: number;
  bodyWardUsed: boolean;
}

export interface GameState {
  schemaVersion: number;
  contentVersion: string;
  rulesVersion: string;
  clockMs: number;
  rng: number;
  nextInstance: string;
  lifeId: string;
  phase: 'preparing' | 'active';
  innateFates: string[];
  opening: {
    candidates: string[];
    selected: (string | null)[];
    drawsUsed: number;
    designationsUsed: number;
  } | null;
  stones: string;
  inventory: Record<string, string>;
  equipment: EquipmentInstance[];
  loadout: Record<EquipmentSlot, string | null>;
  level: number;
  cultivation: string;
  reserve: string;
  foundation: {
    methodId: FoundationMethodId | null; attempts: string;
    lastAttempt: { methodId: FoundationMethodId; at: number; success: boolean } | null;
  };
  dwelling?: { tier: number; gathering: number; study: number };
  player: Combatant & {
    pillAttack: string; pillMagicAttack: string; pillDefense: string; pillMagicDefense: string; pillMaxHp: string;
  };
  techniqueId: string;
  techniqueXp: Record<string, string>;
  proficiencyXp: Record<ProficiencyId, string>;
  // Persistent knowledge/history; current-life XP and combat charges remain separate.
  history: {
    proficiencyXp: Record<ProficiencyId, string>; learnedRecipes: string[];
    enteredFates: string[]; openingTier: number;
    foundationMethods: FoundationMethodId[];
    achievements: Record<string, { at: number; lifeId: string }>;
    highestLevel: number; visitedRegions: string[]; explorationNodes: string[]; highestDwellingTier: number;
    reincarnation: { points: string; count: string; lastSettlement: ReincarnationRecord | null };
  };
  proficiencyCombat: ProficiencyCombatState;
  crafting: Record<string, { attempts: string; successes: string }>;
  learnedTechniques?: string[];
  regionKills: Record<string, string>;
  challengeWins: Record<string, string>;
  pendingEncounters?: Record<string, string>;
  activity: {
    kind: ActivityKind;
    targetId?: string;
    challengeId?: string;
    startedAt: number;
    stoppedAt?: number;
    stopReason?: string;
  };
  battle: (Combatant & { enemyId: string; startedAt: number; lastProgressMs: number }) | null;
  supply: { enabled: boolean; hpThreshold: number; readyAt: number };
  manaSupply?: { enabled: boolean; mpThreshold: number; readyAt: number };
  totals: GameView['totals'];
  journal: GameView['journal'];
}

export interface Stats {
  maxHp: string;
  maxMp: string;
  attack: string; // Physical attack, never an alias for magicAttack.
  magicAttack: string;
  defense: string;
  magicDefense: string;
  agility: string;
  hpRegen: string;
  mpRegen: string;
  attackIntervalMs: number;
  critChance: string;
  critMultiplier: string;
}

export type { GameCommand, GameView } from '../shared/contracts';
