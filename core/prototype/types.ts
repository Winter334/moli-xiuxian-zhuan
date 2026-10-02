import { z } from 'zod';
import { dec } from '../numbers';

export const scalarSchema = z.string().max(1000).regex(/^-?(0|[1-9]\d*)(\.\d+)?$/)
  .refine((value) => dec(value).isFinite(), 'Expected a finite decimal');
export const nonnegativeSchema = scalarSchema.refine((value) => dec(value).gte(0));
export const countSchema = z.string().max(1000).regex(/^(0|[1-9]\d*)$/);
const timeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 3_600_000);

export const statFields = {
  maxHp: scalarSchema,
  attack: scalarSchema,
  defense: scalarSchema,
  agility: scalarSchema,
  attackSpeed: scalarSchema,
  critChance: scalarSchema,
  critMultiplier: scalarSchema,
  attackMultiplier: scalarSchema,
  hpRegen: scalarSchema,
  hpRegenPercent: scalarSchema,
};
export const statsSchema = z.object(statFields).strict();
export const effectTagSchema = z.enum([
  'basic-attack', 'direct', 'rest', 'meditation', 'regeneration', 'weapon', 'manual',
  'divine-art', 'skill', 'equipment', 'supply', 'benefit', 'cost', 'mining', 'logging',
  'refining', 'ordinary', 'component', 'assembly', 'trade', 'training', 'activity',
  'kill', 'clear', 'loot', 'fixed',
]);
export const modifierTargetSchema = z.enum([
  'damage.dealt', 'damage.taken', 'healing.received', 'experience.skill', 'experience.cultivation',
  'duration', 'loot.quantity', 'craft.success', 'craft.extra-batch', 'activity.speed',
  'source.benefit', 'source.cost',
  'stat.maxHp', 'stat.attack', 'stat.defense', 'stat.agility', 'stat.attackSpeed',
  'stat.critChance', 'stat.critMultiplier', 'stat.attackMultiplier', 'stat.hpRegen', 'stat.hpRegenPercent',
]);
export const modifierSchema = z.object({
  target: modifierTargetSchema,
  operation: z.enum(['flat', 'increase', 'multiply']),
  value: scalarSchema,
  group: z.string().min(1).max(100).optional(),
  tags: z.array(effectTagSchema).optional(),
  when: z.object({
    hpAtMost: nonnegativeSchema.refine(value => dec(value).lte(1)).optional(),
    everyBasicAttacks: z.number().int().min(2).max(10000).optional(),
  }).strict().optional(),
}).strict().superRefine((modifier, ctx) => {
  if (modifier.operation === 'multiply' && dec(modifier.value).lt(0)) {
    ctx.addIssue({ code: 'custom', message: 'Negative independent multiplier' });
  }
  if (modifier.when && !['damage.dealt', 'damage.taken'].includes(modifier.target)) {
    ctx.addIssue({ code: 'custom', message: 'Conditions require a damage context' });
  }
  if (modifier.when?.everyBasicAttacks !== undefined && modifier.target !== 'damage.dealt') {
    ctx.addIssue({ code: 'custom', message: 'Attack periods require outgoing damage' });
  }
});
const statPolaritySchema = z.partialRecord(statsSchema.keyof(), z.enum(['benefit', 'cost'])).transform(polarity => {
  const ordered: typeof polarity = {};
  // JSONB reorders object keys; settled-source comparisons need a stable order.
  for (const key of (Object.keys(polarity) as (keyof typeof polarity)[]).sort()) {
    ordered[key] = polarity[key];
  }
  return ordered;
});
export const sourceSchema = z.object({
  id: z.string().min(1),
  flat: statsSchema.partial().optional(),
  multiplier: statsSchema.partial().optional(),
  tags: z.array(effectTagSchema).optional(),
  statPolarity: z.object({
    flat: statPolaritySchema.optional(),
    multiplier: statPolaritySchema.optional(),
  }).strict().optional(),
  modifiers: z.array(modifierSchema).max(100).optional(),
  combat: z.object({
    restraint: z.object({ coefficient: nonnegativeSchema, cap: nonnegativeSchema }).strict().optional(),
    minimumAttackDamageRatio: nonnegativeSchema.optional(),
    damageTakenCap: z.object({ threshold: nonnegativeSchema, value: nonnegativeSchema }).strict().optional(),
    attackCoefficients: z.tuple([scalarSchema, scalarSchema]).optional(),
  }).strict().optional(),
}).strict();
export type EffectTag = z.infer<typeof effectTagSchema>;
export type ModifierTarget = z.infer<typeof modifierTargetSchema>;
export type EffectModifier = z.infer<typeof modifierSchema>;

const attackCoefficientSchema = scalarSchema.refine((value) => dec(value).gt(0));
const abilitiesSchema = z.object({
  ignoreDefense: z.boolean(),
  sturdy: z.boolean(),
  restraint: z.boolean(),
  entryStrikes: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(4), z.literal(5)]),
  // A count means equal strikes; a tuple defines the attack coefficient of each segment.
  strikes: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6),
    z.tuple([attackCoefficientSchema, attackCoefficientSchema])]),
  rending: z.boolean().optional(),
  weakening: z.number().min(0).max(100).optional(),
  reversal: z.boolean().optional(),
  walletSuppressionUnit: attackCoefficientSchema.optional(),
  rampingDamage: z.boolean().optional(),
  rampingDamageStep: z.number().int().positive().optional(),
  mirrorOpening: z.boolean().optional(),
  arrayStrikes: z.boolean().optional(),
  entryDamageMultiplier: attackCoefficientSchema.optional(),
  entryAttackCoefficient: attackCoefficientSchema.optional(),
  entryStatRatio: attackCoefficientSchema.optional(),
  entryHealthRatio: attackCoefficientSchema.optional(),
  extraStrike: z.object({
    coefficient: attackCoefficientSchema, damageMultiplier: attackCoefficientSchema,
  }).strict().optional(),
  periodicStrike: z.object({
    every: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER), coefficient: attackCoefficientSchema,
  }).strict().optional(),
  attackCoefficientMultiplier: attackCoefficientSchema.optional(),
  agilityDeficit: z.object({
    threshold: nonnegativeSchema, scale: attackCoefficientSchema,
  }).strict().optional(),
  defensiveFlash: z.boolean().optional(),
  softBones: z.boolean().optional(),
  missPunishment: nonnegativeSchema.optional(),
  currentHpAttackDivisor: attackCoefficientSchema.optional(),
  noToughnessXp: z.boolean().optional(),
  entryAgilityAttackRatio: attackCoefficientSchema.optional(),
  hitHealingRatio: nonnegativeSchema.refine(value => dec(value).gt(0) && dec(value).lte(1)).optional(),
  reflectionRatio: nonnegativeSchema.refine(value => dec(value).gt(0) && dec(value).lte(1)).optional(),
  bullying: z.boolean().optional(),
  entrySequence: z.array(z.object({
    count: z.number().int().min(1).max(6),
    coefficient: attackCoefficientSchema, damageMultiplier: attackCoefficientSchema,
  }).strict()).min(1).max(2).optional(),
  attackAfterDamageThreshold: nonnegativeSchema.optional(),
  healthBurst: z.object({
    round: z.number().int().positive(), multiplier: attackCoefficientSchema,
  }).strict().optional(),
}).strict();
const defaultAbilities = { ignoreDefense: false, sturdy: false, restraint: false, entryStrikes: 0, strikes: 1 } as const;
const enemySnapshotSchema = z.object({
  id: z.string().min(1),
  stats: statsSchema,
  abilities: abilitiesSchema,
}).strict();
// Defaults belong to new content definitions, never to saved combat snapshots.
export const enemySchema = enemySnapshotSchema.extend({
  abilities: abilitiesSchema.partial().default({}).transform((abilities) => ({ ...defaultAbilities, ...abilities })),
});

export const encounterEntrySchema = z.object({
  attack: nonnegativeSchema, defense: nonnegativeSchema, agility: nonnegativeSchema,
  manorSeal: z.boolean(),
}).strict();
export type EncounterEntry = z.infer<typeof encounterEntrySchema>;

export const simulationSchema = z.object({
  kernelVersion: z.literal('neko-kernel-5'),
  clockMs: timeSchema,
  nextPulseAt: timeSchema,
  rng: z.number().int().min(1).max(0xffffffff),
  actionCounts: z.object({ basicAttack: countSchema }).strict(),
  mode: z.enum(['idle', 'rest', 'sleep', 'combat']),
  player: z.object({
    base: statsSchema,
    sources: z.array(sourceSchema),
    hp: nonnegativeSchema,
    nextActionAt: timeSchema.nullable(),
  }).strict(),
  effects: z.array(z.object({
    id: z.string().min(1),
    expiresAt: timeSchema,
    source: sourceSchema,
  }).strict()),
  clearedGroups: z.record(z.string(), z.string().regex(/^(0|[1-9]\d*)$/)),
  battle: z.object({
    regionId: z.string().min(1),
    entry: encounterEntrySchema.optional(),
    enemies: z.array(z.object({
      definition: enemySnapshotSchema,
      hp: nonnegativeSchema,
      nextActionAt: timeSchema,
      nextRound: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    }).strict()).min(1).max(2),
  }).strict().nullable(),
}).strict();

export type Stats = z.infer<typeof statsSchema>;
export type StatSource = z.infer<typeof sourceSchema>;
export type EnemyDefinition = z.input<typeof enemySchema>;
export type ResolvedEnemy = z.infer<typeof enemySchema>;
export type SimulationState = z.infer<typeof simulationSchema>;

export interface Strike {
  hit: boolean;
  critical: boolean;
  damage: string;
  // Iron skin uses pre-defense power, including fluctuation and critical damage.
  incomingPower: string;
}

export type SimulationEvent =
  | ({ kind: 'strike'; at: number; side: 'player' | 'enemy'; slot: number; hpLost: string } & Strike)
  | { kind: 'miss-punishment'; at: number; slot: number; damage: string; hpLost: string }
  | { kind: 'reflection'; at: number; slot: number; damage: string; hpLost: string }
  | { kind: 'tidal-pressure' | 'health-burst'; at: number; slot: number; damage: string; hpLost: string }
  | { kind: 'enemy-healed'; at: number; slot: number; amount: string }
  | { kind: 'player-action-completed'; at: number; regionId: string; targetIds: string[] }
  | { kind: 'enemy-defeated'; at: number; regionId: string; enemyId: string; slot: number; groupSize: number }
  | { kind: 'group-cleared'; at: number; regionId: string; total: string }
  | { kind: 'fainted'; at: number }
  | { kind: 'effect-expired'; at: number; effectId: string };

export interface SimulationResult {
  state: SimulationState;
  events: SimulationEvent[];
}

export interface PlayerUpdate {
  base?: Stats;
  sources?: StatSource[];
  fullHeal?: boolean;
}

// Trusted rule callbacks run inside the event loop, never as client commands.
export interface SimulationHooks {
  getMoney?: () => string;
  getSturdyCap?: () => number;
  getPlayerTargetCount?: () => number;
  settle?: (
    state: SimulationState,
    event: SimulationEvent | { kind: 'pulse'; at: number; sleeping: boolean },
  ) => PlayerUpdate | void;
  stopOnEncounterEnd?: boolean;
}
