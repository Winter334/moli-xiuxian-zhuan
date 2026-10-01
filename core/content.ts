import { z } from 'zod';
import rawContent from './content/stage-1.json';
import { dec } from './numbers';
import { FOUNDATION_METHOD_IDS, PROFICIENCY_IDS } from '../shared/contracts';

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const amount = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/).max(100);
const positive = amount.refine((v) => dec(v).gt(0), 'Must be positive');
const integer = z.string().regex(/^(0|[1-9]\d*)$/);
const positiveInteger = integer.refine((v) => BigInt(v) > 0n);
const probability = amount.refine((v) => dec(v).lte(1));
const duration = z.number().int().min(1000).max(3_600_000).multipleOf(1000);
const stat = z.enum(['maxHp', 'maxMp', 'attack', 'magicAttack', 'defense', 'magicDefense', 'agility', 'hpRegen', 'mpRegen']);
export const growthStat = z.enum(['attack', 'magicAttack', 'defense', 'magicDefense', 'maxHp']);
const modifier = z.strictObject({ stat, mode: z.enum(['flat', 'percent']), value: amount });
const signedRatio = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/).max(100)
  .refine((v) => dec(v).gt(-1) && dec(v).lte(10));
const weaponType = z.enum(['sword', 'gauntlet', 'staff']);
const trigger = z.enum(['hit', 'hurt', 'action', 'kill']);
const commonEffect = { id, name: z.string().min(1), trigger, amount };
const effect = z.discriminatedUnion('kind', [
  z.strictObject({ ...commonEffect, kind: z.literal('restore'), resource: z.enum(['hp', 'mp']) }),
  z.strictObject({ ...commonEffect, kind: z.literal('restore-percent'), resource: z.enum(['hp', 'mp']), amount: probability }),
  z.strictObject({ ...commonEffect, kind: z.literal('shield') }),
  z.strictObject({ ...commonEffect, kind: z.literal('damage'), damageType: z.enum(['physical', 'magical']) }),
]);
const enemyEffect = z.union([
  effect,
  z.strictObject({ id, name: z.string().min(1), trigger: z.literal('encounter'), kind: z.literal('shield'), amount: positive }),
]);
export const enemyAllocationSchema = z.strictObject({
  level: z.number().int().min(0).max(13),
  rank: z.enum(['normal', 'elite', 'boss']),
  multipliers: z.strictObject({
    maxHp: positive, maxMp: amount, attack: amount, magicAttack: amount,
    defense: amount, magicDefense: amount, agility: positive,
  }),
});
const unlock = z.union([
  z.strictObject({ level: z.number().int().min(0).max(13) }),
  z.strictObject({ regionId: id, kills: positiveInteger }),
]);
const stats = {
  maxHp: positive, maxMp: amount, attack: amount, magicAttack: amount,
  defense: amount, magicDefense: amount, agility: positive,
  hpRegen: amount, mpRegen: amount, attackIntervalMs: duration,
  critChance: probability, critMultiplier: amount.refine((v) => dec(v).gte(1)),
};
const itemUse = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('restore'), resource: z.enum(['hp', 'mp']), amount: positive }),
  z.strictObject({
    kind: z.literal('growth'), amount: positive, scale: positive,
    stat: growthStat, tierId: id.optional(),
  }),
]);
const dwellingCost = {
  stones: integer,
  costs: z.array(z.strictObject({ itemId: id, quantity: positiveInteger })),
};
const dwelling = z.strictObject({
  tiers: z.array(z.strictObject({
    id, name: z.string().min(1), meditationBonus: amount, practiceBonus: amount,
    requiredGathering: z.number().int().min(0), ...dwellingCost,
  })).min(1),
  gathering: z.array(z.strictObject({
    requiredTier: z.number().int().min(0), bonus: amount, ...dwellingCost,
  })),
  study: z.array(z.strictObject({
    requiredTier: z.number().int().min(0), bonus: amount, ...dwellingCost,
  })),
});
const clearReward = z.strictObject({ stones: integer, cultivation: amount });
const rarity = z.enum(['common', 'uncommon', 'rare', 'epic']);
const fateEffect = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('stat'), modifier: z.strictObject({ stat, mode: z.literal('percent'), value: signedRatio }),
    when: z.enum(['sword', 'body']).optional(),
  }),
  z.strictObject({
    kind: z.literal('experience'), target: z.enum(['technique', 'meditation', 'combat-cultivation', ...PROFICIENCY_IDS]),
    value: amount,
  }),
  z.strictObject({ kind: z.literal('production-success'), target: z.enum(['alchemy', 'forging']), value: probability }),
  z.strictObject({ kind: z.literal('mana-cost'), value: signedRatio }),
  z.strictObject({ kind: z.literal('luck'), value: amount }),
  z.strictObject({ kind: z.literal('item-drop'), itemIds: z.array(id).min(1), value: amount }),
  z.strictObject({ kind: z.literal('purchase-discount'), itemIds: z.array(id).min(1), value: probability }),
  z.strictObject({ kind: z.literal('gift-stones'), amount: integer }),
  z.strictObject({
    kind: z.literal('combat'), effect: z.strictObject({
      id, name: z.string().min(1), kind: z.literal('restore-percent'), trigger: z.literal('kill'),
      resource: z.enum(['hp', 'mp']), amount: probability,
    }),
  }),
]);
const openingLimits = z.strictObject({
  requiredPoints: integer,
  slots: z.number().int().min(1).max(8),
  candidates: z.number().int().min(1).max(100),
  draws: z.number().int().min(1).max(100),
  designations: z.number().int().min(0).max(8),
});
const qualityIdentity = { id, name: z.string().min(1), rarity };
const equipmentFields = {
  id, name: z.string().min(1), modifiers: z.array(modifier), effects: z.array(id),
  affixPool: z.array(id), affixCount: z.number().int().min(0).max(8),
};
const proficiencyAbility = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('sword-followup'), everyActions: z.number().int().min(1).max(100), coefficient: positive }),
  z.strictObject({ kind: z.literal('body-ward'), hpThreshold: probability, maxHpFraction: probability }),
  z.strictObject({ kind: z.literal('spell-surge'), casts: z.number().int().min(1).max(100), powerBonus: positive }),
  z.strictObject({ kind: z.literal('quality-reroll') }),
]);
export const equipmentQualitySnapshotSchema = z.strictObject({
  ...qualityIdentity, modifiers: z.array(modifier), effects: z.array(effect),
});
const enemyDefinition = z.strictObject({
  id, name: z.string().min(1), level: z.number().int().min(0).max(13), ...stats, actionId: id, effects: z.array(id),
  allocation: enemyAllocationSchema.optional(), eliteOf: id.optional(),
  cultivation: amount, stones: integer,
  drops: z.array(z.strictObject({
    itemId: id, quantity: positiveInteger, chance: z.number().min(0).max(1), luckExcludedReason: z.string().min(1).optional(),
  })),
  equipmentDrops: z.array(z.strictObject({
    equipmentId: id, chance: z.number().min(0).max(1), luckExcludedReason: z.string().min(1).optional(),
  })),
});
const schema = z.strictObject({
  version: z.string().min(1),
  rulesVersion: z.string().min(1),
  schemaVersion: z.literal(14),
  reincarnation: z.strictObject({
    minimumLevel: z.number().int().min(1).max(12),
    retrainingBonus: probability,
    realmRewards: z.array(z.strictObject({
      level: z.number().int().min(1).max(13), points: positiveInteger,
    })).min(1),
    explorationNodes: z.array(z.strictObject({
      id, name: z.string().min(1), points: positiveInteger,
      target: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('region'), regionId: id, wins: positiveInteger }),
        z.strictObject({ kind: z.literal('challenge'), challengeId: id, wins: positiveInteger }),
      ]),
    })),
  }),
  foundationMethods: z.array(z.strictObject({
    id: z.enum(FOUNDATION_METHOD_IDS), name: z.string().min(1),
    successChance: probability.refine((v) => dec(v).gt(0) && dec(v).lt(1)),
    extraCosts: z.array(z.strictObject({ itemId: id, quantity: positiveInteger, failureQuantity: integer })),
    modifiers: z.array(modifier),
  })).length(3),
  achievements: z.array(z.strictObject({
    id, name: z.string().min(1), description: z.string().min(1),
    foundationMethodId: z.enum(FOUNDATION_METHOD_IDS),
  })),
  challenges: z.array(z.strictObject({
    id, name: z.string().min(1), unlock, maxLevel: z.number().int().min(0).max(12), enemy: enemyDefinition,
  })),
  openingTiers: z.array(openingLimits).min(1),
  fates: z.array(z.strictObject({
    id, name: z.string().min(1), rarity, weight: z.number().int().min(1).max(1_000_000),
    effects: z.array(fateEffect).min(1), designatable: z.boolean().optional(),
  })).min(1),
  proficiencyRules: z.strictObject({
    combatXpPerAction: positive, eliteXpMultiplier: positive,
    realmXpMultipliers: z.array(positive).length(14),
    successBase: probability.refine((v) => dec(v).gt(0) && dec(v).lt(1)),
    minimumSuccess: probability.refine((v) => dec(v).gt(0)),
    qualityWeightPerLevel: amount, alchemyExtraChancePerLevel: probability,
  }),
  proficiencies: z.array(z.strictObject({
    id: z.enum(PROFICIENCY_IDS), name: z.string().min(1),
    xpBase: positive, xpGrowth: amount.refine((v) => dec(v).gt(1)),
    maxLevel: z.number().int().min(1).max(100),
    perLevel: z.array(modifier),
    milestones: z.array(z.strictObject({
      level: z.number().int().min(1), name: z.string().min(1),
      modifiers: z.array(modifier), successBonus: probability,
      ability: proficiencyAbility.optional(),
      extraOutputChance: probability.optional(), qualityWeightBonus: amount.optional(),
    })),
  })).length(PROFICIENCY_IDS.length),
  growthPillTiers: z.array(z.strictObject({ id, name: z.string().min(1) })).min(1).max(8).optional(),
  dwelling: dwelling.optional(),
  equipmentAcquisition: z.literal('crafting-only').optional(),
  equipmentQualities: z.array(z.strictObject({
    ...qualityIdentity, weight: z.number().int().min(0).max(1_000_000),
    statMultiplier: positive, effectMultiplier: positive,
  })).min(1).max(8).optional(),
  techniqueAcquisition: z.literal('manuals').optional(),
  settings: z.strictObject({
    restHpFraction: probability,
    baseMpRegenFraction: probability,
    supplyCooldownMs: duration,
    supplyItemId: id,
    manaSupply: z.strictObject({ itemId: id, cooldownMs: duration }).optional(),
    stalemateMs: duration,
    battleLimitMs: duration,
    reserveCapacity: positive,
    reserveBands: z.array(z.strictObject({ until: positive, efficiency: probability.refine((v) => dec(v).gt(0)) })).min(1),
    practicePerSecond: positive,
    combatPracticePerAction: positive,
    starterStones: integer,
    starterItems: z.record(id, integer),
    starterEquipmentId: id.nullable(),
    starterTechniqueId: id,
    baseActionId: id,
    breakthroughItemId: id,
    breakthroughQuantity: positiveInteger,
  }),
  realms: z.array(z.strictObject({
    level: z.number().int().min(0).max(13), name: z.string().min(1),
    required: positive, meditation: positive, maxHp: positive, maxMp: amount,
    attack: amount, magicAttack: amount, defense: amount, magicDefense: amount, agility: positive,
  })).length(14),
  baseStats: z.strictObject({
    hpRegen: amount, mpRegen: amount, attackIntervalMs: duration,
    critChance: probability, critMultiplier: amount.refine((v) => dec(v).gte(1)),
  }),
  effects: z.array(effect),
  enemyEffects: z.array(enemyEffect).optional(),
  actions: z.array(z.strictObject({
    id, name: z.string().min(1), mpCost: amount,
    damageType: z.enum(['physical', 'magical']), coefficient: positive,
    hits: z.number().int().min(1).max(8),
  })).min(1),
  affixes: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ id, name: z.string().min(1), min: integer, max: integer, kind: z.literal('stat'), stat, mode: z.enum(['flat', 'percent']) }),
    z.strictObject({ id, name: z.string().min(1), min: integer, max: integer, kind: z.literal('effect'), effectId: id }),
  ])),
  equipment: z.array(z.discriminatedUnion('slot', [
    z.strictObject({ ...equipmentFields, slot: z.literal('weapon'), category: weaponType }),
    z.strictObject({
      ...equipmentFields, slot: z.enum(['armor', 'footwear', 'accessory']), category: z.never().optional(),
    }),
  ])).min(1),
  techniques: z.array(z.strictObject({
    id, name: z.string().min(1), unlock, actionId: id,
    modifiers: z.array(modifier), effects: z.array(id),
    weaponType: weaponType.nullable().optional(),
    weaponMatch: z.strictObject({
      modifiers: z.array(modifier), effects: z.array(id), actionDamagePercent: amount,
    }).optional(),
    xpCap: positive, practiceBonuses: z.array(z.strictObject({ stat, value: amount })),
    manualItemId: id.optional(),
  })).min(1),
  items: z.array(z.strictObject({
    id, name: z.string().min(1), kind: z.enum(['material', 'recovery', 'growth', 'breakthrough', 'manual']),
    unlock, buyPrice: positiveInteger.optional(), sellPrice: integer.optional(), use: itemUse.optional(),
  })).min(1),
  recipes: z.array(z.strictObject({
    id, name: z.string().min(1), unlock,
    costs: z.array(z.strictObject({ itemId: id, quantity: positiveInteger })).min(1),
    stones: integer, outputId: id, outputQuantity: positiveInteger,
    outputKind: z.literal('equipment').optional(),
    training: z.strictObject({ difficulty: z.number().int().min(1).max(100), xp: positive }),
    alchemyLevel: z.number().int().min(1).max(100).optional(),
    extraOutputEligible: z.boolean().optional(),
  })),
  enemies: z.array(enemyDefinition).min(1),
  regions: z.array(z.strictObject({
    id, name: z.string().min(1), description: z.string(), unlock,
    enemies: z.array(id).min(1), firstClearEquipmentId: id.optional(),
    enemyWeights: z.record(id, z.number().int().min(1).max(1_000_000)).optional(),
    clear: z.strictObject({
      waves: z.number().int().min(1).max(10_000),
      reward: clearReward, firstBonus: clearReward.optional(),
    }).optional(),
  })).min(1),
});

export type Content = z.infer<typeof schema>;
export type Effect = z.infer<typeof effect>;
export type Modifier = z.infer<typeof modifier>;
export type Unlock = z.infer<typeof unlock>;
export type Action = Content['actions'][number];
export type EquipmentQualitySnapshot = z.infer<typeof equipmentQualitySnapshotSchema>;
export type GrowthStat = z.infer<typeof growthStat>;
export type EnemyEffect = z.infer<typeof enemyEffect>;
export type EnemyAllocation = z.infer<typeof enemyAllocationSchema>;
export type Proficiency = Content['proficiencies'][number];
export type ProficiencyAbility = z.infer<typeof proficiencyAbility>;
export type Fate = Content['fates'][number];
export type FateEffect = z.infer<typeof fateEffect>;
export type OpeningLimits = z.infer<typeof openingLimits>;

// Resolve authoring allocations once; combat and views use these same validated stats.
export function allocatedEnemyStats(realms: Content['realms'], allocation: EnemyAllocation) {
  const realm = realms[allocation.level];
  if (!realm) throw new Error('怪物境界基准不存在');
  return {
    maxHp: dec(realm.maxHp).mul(allocation.multipliers.maxHp).toFixed(),
    maxMp: dec(realm.maxMp).mul(allocation.multipliers.maxMp).toFixed(),
    attack: dec(realm.attack).mul(allocation.multipliers.attack).toFixed(),
    magicAttack: dec(realm.magicAttack).mul(allocation.multipliers.magicAttack).toFixed(),
    defense: dec(realm.defense).mul(allocation.multipliers.defense).toFixed(),
    magicDefense: dec(realm.magicDefense).mul(allocation.multipliers.magicDefense).toFixed(),
    agility: dec(realm.agility).mul(allocation.multipliers.agility).toFixed(),
  };
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function loadContent(raw: unknown): Content {
  const c = schema.parse(raw);
  const fail = (message: string): never => { throw new Error(`内容校验失败：${message}`); };
  if (new Set(c.proficiencies.map((p) => p.id)).size !== PROFICIENCY_IDS.length) fail('熟练度门类须完整且唯一');
  c.proficiencyRules.realmXpMultipliers.forEach((value, index, values) => {
    if (index && dec(value).lt(values[index - 1])) fail('境界熟练度经验系数不可递减');
  });
  const abilityOwners = { 'sword-followup': 'sword', 'body-ward': 'body', 'spell-surge': 'spell', 'quality-reroll': 'forging' };
  for (const p of c.proficiencies) {
    let previous = 0;
    for (const milestone of p.milestones) {
      if (milestone.level <= previous || milestone.level > p.maxLevel) fail(`熟练度奖励等级须递增且不超上限：${p.id}`);
      if (milestone.ability && abilityOwners[milestone.ability.kind] !== p.id) fail(`阶段能力门类不匹配：${p.id}`);
      if (milestone.extraOutputChance !== undefined && p.id !== 'alchemy') fail('额外成丹仅适用于丹道');
      if (milestone.qualityWeightBonus !== undefined && p.id !== 'forging') fail('品质奖励仅适用于炼器');
      previous = milestone.level;
    }
    if (p.id === 'alchemy' || p.id === 'forging') {
      if (p.perLevel.length || p.milestones.some((m) => m.modifiers.length)) fail('生产熟练度不提供通用战斗属性');
    } else if (p.milestones.some((m) => dec(m.successBonus).gt(0))) fail('战斗熟练度不提供生产成功率');
  }
  const groups = ['fates', 'foundationMethods', 'achievements', 'challenges', 'effects', 'actions', 'affixes', 'equipment', 'techniques', 'items', 'recipes', 'enemies', 'regions'] as const;
  for (const group of groups) {
    const ids = c[group].map((entry) => entry.id);
    if (new Set(ids).size !== ids.length) fail(`${group} 标识重复`);
  }
  function ref(group: typeof groups[number], key: string) {
    if (!c[group].some((entry) => entry.id === key)) fail(`${group} 引用不存在：${key}`);
  }
  function gate(value: Unlock) {
    if ('regionId' in value) ref('regions', value.regionId);
  }
  function reachableAt(value: Unlock, maxLevel: number) {
    const visited = new Set<string>();
    let current = value;
    while ('regionId' in current) {
      const regionId = current.regionId;
      if (visited.has(regionId)) return false;
      visited.add(regionId);
      const region = c.regions.find((entry) => entry.id === regionId);
      if (!region) return false;
      current = region.unlock;
    }
    return current.level <= maxLevel;
  }
  function effects(ids: string[]) { ids.forEach((key) => ref('effects', key)); }
  const human = c.foundationMethods.find((method) => method.id === 'human')!;
  const earth = c.foundationMethods.find((method) => method.id === 'earth')!;
  const heaven = c.foundationMethods.find((method) => method.id === 'heaven')!;
  if (!human || !earth || !heaven || human.extraCosts.length || !earth.extraCosts.length ||
      !heaven.extraCosts.length || !dec(human.successChance).gt(earth.successChance) ||
      !dec(earth.successChance).gt(heaven.successChance)) fail('筑基三种方式须完整，材料及成功率顺序须符合路线定义');
  for (const method of c.foundationMethods) {
    if (new Set(method.extraCosts.map((cost) => cost.itemId)).size !== method.extraCosts.length) fail('筑基附材不可重复');
    for (const cost of method.extraCosts) {
      ref('items', cost.itemId);
      const item = c.items.find((entry) => entry.id === cost.itemId)!;
      if (item.kind !== 'material' || BigInt(cost.failureQuantity) > BigInt(cost.quantity)) fail('筑基附材或失败损耗非法');
      const available = reachableAt(item.unlock, 12) &&
        (Boolean(item.buyPrice) || c.regions.some((region) => reachableAt(region.unlock, 12) && region.enemies.some((id) =>
          c.enemies.find((enemy) => enemy.id === id)?.drops.some((drop) => drop.itemId === item.id && drop.chance > 0))) ||
          c.challenges.some((challenge) => reachableAt(challenge.unlock, challenge.maxLevel) &&
            challenge.enemy.drops.some((drop) => drop.itemId === item.id && drop.chance > 0)));
      if (!available) fail(`筑基附材缺少突破前来源：${item.id}`);
    }
  }
  for (const achievement of c.achievements) ref('foundationMethods', achievement.foundationMethodId);
  const enemyIds = [...c.enemies, ...c.challenges.map((challenge) => challenge.enemy)].map((enemy) => enemy.id);
  if (new Set(enemyIds).size !== enemyIds.length) fail('挑战首领与普通怪物标识不可重复');
  for (const challenge of c.challenges) {
    gate(challenge.unlock);
    if (!reachableAt(challenge.unlock, challenge.maxLevel)) fail('挑战开放条件超出挑战境界上限或不可达');
    if (challenge.enemy.allocation?.rank !== 'boss' || challenge.enemy.level !== 13) fail('筑基准备挑战须使用独立筑基首领');
  }
  c.openingTiers.forEach((tier, index) => {
    if (tier.slots > c.fates.length || tier.designations > tier.slots ||
        tier.candidates < tier.slots) fail('开局气运池或候选不足以填满槽位，或指定额度超出槽数');
    const previous = c.openingTiers[index - 1];
    if ((!index && tier.requiredPoints !== '0') || (previous &&
        (BigInt(tier.requiredPoints) <= BigInt(previous.requiredPoints) ||
          tier.slots < previous.slots || tier.candidates < previous.candidates ||
          tier.draws < previous.draws || tier.designations < previous.designations))) fail('开局能力门槛须递增且能力不可倒退');
  });
  c.reincarnation.realmRewards.forEach((reward, index, rewards) => {
    if ((!index && reward.level !== c.reincarnation.minimumLevel) || (index &&
        (reward.level <= rewards[index - 1].level || BigInt(reward.points) <= BigInt(rewards[index - 1].points)))) {
      fail('轮回境界奖励须从最低计奖境界开始递增');
    }
  });
  const nodes = c.reincarnation.explorationNodes;
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length ||
      new Set(nodes.map((node) => node.target.kind === 'region'
        ? `region:${node.target.regionId}` : `challenge:${node.target.challengeId}`)).size !== nodes.length) {
    fail('轮回探索节点及来源不可重复计奖');
  }
  for (const node of nodes) {
    if (node.target.kind === 'region') ref('regions', node.target.regionId);
    else ref('challenges', node.target.challengeId);
  }
  for (const fate of c.fates) {
    for (const effect of fate.effects) {
      if (effect.kind !== 'item-drop' && effect.kind !== 'purchase-discount') continue;
      if (new Set(effect.itemIds).size !== effect.itemIds.length) fail(`气运物品范围重复：${fate.id}`);
      for (const key of effect.itemIds) {
        ref('items', key);
        const item = c.items.find((entry) => entry.id === key)!;
        if (effect.kind === 'item-drop' && item.kind !== 'material') fail('定向掉落气运仅支持明确列出的材料');
        if (effect.kind === 'purchase-discount' && (item.kind !== 'recovery' || !item.buyPrice)) {
          fail('采购气运仅支持明确出售的恢复丹');
        }
      }
    }
  }
  if (c.growthPillTiers) {
    const tiers = c.growthPillTiers;
    if (new Set(tiers.map((tier) => tier.id)).size !== tiers.length) fail('属性丹等级标识重复');
    for (const attribute of growthStat.options) {
      const uses = c.items.flatMap((item) =>
        item.use?.kind === 'growth' && item.use.stat === attribute ? [item.use] : []);
      if (!uses.length) continue;
      if (uses.length !== tiers.length) fail(`属性丹须覆盖各等级且不可重复：${attribute}`);
      let previous = dec(0);
      for (const tier of tiers) {
        const use = uses.find((entry) => entry.tierId === tier.id) ?? fail(`属性丹等级缺失：${attribute}`);
        if (dec(use.amount).lte(previous)) fail(`属性丹各档药效须递增：${attribute}`);
        if (use.scale !== uses[0].scale) fail(`同属性各档共用递减尺度：${attribute}`);
        previous = dec(use.amount);
      }
    }
  }
  if (c.equipmentQualities) {
    const qualities = c.equipmentQualities;
    if (new Set(qualities.map((entry) => entry.id)).size !== qualities.length ||
        new Set(qualities.map((entry) => entry.rarity)).size !== qualities.length) fail('品质标识与稀有度不可重复');
    if (!qualities.some((entry) => entry.weight > 0)) fail('品质权重总和须大于零');
    if (qualities[0].statMultiplier !== '1' || qualities[0].effectMultiplier !== '1' ||
        qualities[0].rarity !== 'common') fail('基础品质须为凡品且倍率为一');
    const rarityOrder = ['common', 'uncommon', 'rare', 'epic'];
    qualities.forEach((entry, index) => {
      if (dec(entry.statMultiplier).gt(10) || dec(entry.effectMultiplier).gt(10)) fail('品质倍率超出首段支持范围');
      if (index && (dec(entry.statMultiplier).lte(qualities[index - 1].statMultiplier) ||
          dec(entry.effectMultiplier).lt(qualities[index - 1].effectMultiplier) ||
          rarityOrder.indexOf(entry.rarity) <= rarityOrder.indexOf(qualities[index - 1].rarity))) fail('品质属性、效果与稀有度须递增');
    });
  }
  if (c.dwelling) {
    const home = c.dwelling;
    if (new Set(home.tiers.map((tier) => tier.id)).size !== home.tiers.length) fail('居所标识重复');
    const starter = home.tiers[0];
    if (starter.stones !== '0' || starter.costs.length || starter.requiredGathering !== 0) fail('初始居所必须免费且无前置');
    for (const line of [home.gathering, home.study]) {
      let lastTier = 0;
      let lastBonus = dec(0);
      for (const level of line) {
        if (level.requiredTier < lastTier || level.requiredTier >= home.tiers.length ||
            dec(level.bonus).lte(lastBonus)) fail('设施品阶须可达且有序，累计收益须递增');
        lastTier = level.requiredTier;
        lastBonus = dec(level.bonus);
      }
    }
    home.tiers.forEach((tier, index) => {
      if (tier.requiredGathering > home.gathering.filter((level) => level.requiredTier < index).length) {
        fail('居所前置聚灵阵不可依赖待升级品阶');
      }
      if (index && (dec(tier.meditationBonus).lt(home.tiers[index - 1].meditationBonus) ||
          dec(tier.practiceBonus).lt(home.tiers[index - 1].practiceBonus))) fail('居所环境收益不可倒退');
    });
    for (const upgrade of [...home.tiers, ...home.gathering, ...home.study]) {
      if (new Set(upgrade.costs.map((cost) => cost.itemId)).size !== upgrade.costs.length) fail('洞府材料不可重复扣费');
      for (const cost of upgrade.costs) {
        ref('items', cost.itemId);
        const item = c.items.find((entry) => entry.id === cost.itemId)!;
        if (item.kind !== 'material') fail('洞府改造只消耗材料与灵石');
        const buyable = item.buyPrice && ('regionId' in item.unlock || item.unlock.level <= 12);
        const farmable = c.regions.some((region) => region.enemies.some((enemyId) =>
          c.enemies.find((enemy) => enemy.id === enemyId && !enemy.eliteOf)?.drops.some((drop) =>
            drop.itemId === item.id && drop.chance > 0)));
        if (!buyable && !farmable) fail(`洞府材料缺少突破前可重复来源：${item.id}`);
      }
    }
  }
  c.realms.forEach((realm, index) => {
    if (realm.level !== index) fail('境界必须按凡人、炼气十二层、筑基初期连续排列');
  });
  for (const entry of c.affixes) {
    if (dec(entry.min).gt(entry.max) || dec(entry.max).gt(1_000_000)) fail(`词条区间非法：${entry.id}`);
    if (entry.kind === 'effect') ref('effects', entry.effectId);
  }
  for (const entry of c.equipment) {
    effects(entry.effects);
    entry.affixPool.forEach((key) => ref('affixes', key));
    if (new Set(entry.affixPool).size !== entry.affixPool.length || entry.affixCount > entry.affixPool.length) {
      fail(`词条池不能重复或少于抽取数量：${entry.id}`);
    }
  }
  for (const entry of c.techniques) {
    gate(entry.unlock);
    ref('actions', entry.actionId);
    effects(entry.effects);
    if (new Set(entry.practiceBonuses.map((bonus) => bonus.stat)).size !== entry.practiceBonuses.length) {
      fail(`功法修习属性不可重复：${entry.id}`);
    }
    if (entry.weaponMatch) {
      if (!entry.weaponType) fail(`武器适配词条须指定功法类型：${entry.id}`);
      effects(entry.weaponMatch.effects);
      if (!entry.weaponMatch.effects.length && !entry.weaponMatch.modifiers.some((m) => dec(m.value).gt(0)) &&
          dec(entry.weaponMatch.actionDamagePercent).isZero()) fail(`武器适配词条不能为空：${entry.id}`);
    }
  }
  for (const entry of c.items) {
    gate(entry.unlock);
    if ((entry.kind === 'recovery') !== (entry.use?.kind === 'restore')) fail(`恢复物品用途不匹配：${entry.id}`);
    if ((entry.kind === 'growth') !== (entry.use?.kind === 'growth')) fail(`养成物品用途不匹配：${entry.id}`);
    if (entry.use?.kind === 'growth') {
      const use = entry.use;
      if (c.growthPillTiers) {
        if (!use.stat || !c.growthPillTiers.some((tier) => tier.id === use.tierId)) {
          fail(`属性丹缺少属性或有效等级：${entry.id}`);
        }
        if (!c.recipes.some((recipe) => !recipe.outputKind && recipe.outputId === entry.id)) {
          fail(`属性丹不能仅依赖随机掉落：${entry.id}`);
        }
      } else if (entry.use.tierId !== undefined) {
        fail('属性丹等级须在目录中定义');
      }
    }
    if (entry.buyPrice && entry.sellPrice && BigInt(entry.sellPrice) > BigInt(entry.buyPrice)) fail(`购销套利：${entry.id}`);
  }
  for (const entry of c.recipes) {
    gate(entry.unlock); ref(entry.outputKind === 'equipment' ? 'equipment' : 'items', entry.outputId);
    entry.costs.forEach((cost) => ref('items', cost.itemId));
    if (new Set(entry.costs.map((cost) => cost.itemId)).size !== entry.costs.length) fail(`配方成本重复：${entry.id}`);
    if (entry.outputKind === 'equipment' && entry.outputQuantity !== '1') fail(`每次打造须生成一件独立装备：${entry.id}`);
    if (entry.alchemyLevel !== undefined && (entry.outputKind === 'equipment' ||
        !c.proficiencies.find((p) => p.id === 'alchemy')!.milestones.some((m) => m.level === entry.alchemyLevel))) {
      fail(`专属丹方须对应丹道阶段：${entry.id}`);
    }
    if (entry.extraOutputEligible && (entry.outputKind === 'equipment' ||
        !['recovery', 'growth'].includes(c.items.find((item) => item.id === entry.outputId)!.kind))) {
      fail(`额外成丹只开放给明确配置的恢复丹或养成丹：${entry.id}`);
    }
  }
  for (const entry of [...c.enemies, ...c.challenges.map((challenge) => challenge.enemy)]) {
    const boss = c.challenges.some((challenge) => challenge.enemy.id === entry.id);
    if (c.enemyEffects) {
      if (!entry.allocation) fail(`怪物缺少境界分配：${entry.id}`);
      for (const key of entry.effects) {
        if (!c.enemyEffects.some((effect) => effect.id === key)) fail(`怪物专属效果引用不存在：${key}`);
      }
    } else {
      effects(entry.effects);
      if ((!boss && entry.allocation) || entry.eliteOf) fail('怪物境界分配须启用独立怪物效果目录');
    }
    if (entry.allocation) {
      if (entry.level !== entry.allocation.level) fail(`怪物境界与属性分配不符：${entry.id}`);
      const resolved = allocatedEnemyStats(c.realms, entry.allocation);
      for (const key of Object.keys(resolved) as (keyof typeof resolved)[]) {
        if (!dec(entry[key]).eq(resolved[key])) fail(`怪物属性与境界分配不符：${entry.id}.${key}`);
      }
      if ((entry.allocation.rank === 'elite') !== Boolean(entry.eliteOf)) fail(`精英须显式关联普通模板：${entry.id}`);
      if ((entry.allocation.rank === 'boss') !== boss) fail('首领不能进入普通遭遇目录');
    }
    if (entry.eliteOf) {
      ref('enemies', entry.eliteOf);
      const base = c.enemies.find((enemy) => enemy.id === entry.eliteOf)!;
      if (base.eliteOf || base.allocation?.rank !== 'normal') fail(`精英来源必须为普通怪物：${entry.id}`);
    }
    ref('actions', entry.actionId);
    entry.drops.forEach((drop) => ref('items', drop.itemId));
    entry.equipmentDrops.forEach((drop) => ref('equipment', drop.equipmentId));
  }
  if (c.enemyEffects) {
    const keys = c.enemyEffects.map((entry) => entry.id);
    if (new Set(keys).size !== keys.length || keys.some((key) => c.effects.some((entry) => entry.id === key))) {
      fail('怪物效果标识不可重复或混入玩家效果目录');
    }
  }
  for (const entry of c.regions) {
    gate(entry.unlock); entry.enemies.forEach((key) => ref('enemies', key));
    if (entry.enemyWeights) {
      if (new Set(entry.enemies).size !== entry.enemies.length ||
          Object.keys(entry.enemyWeights).length !== entry.enemies.length ||
          entry.enemies.some((key) => !entry.enemyWeights![key])) fail(`遭遇权重须完整且唯一：${entry.id}`);
    }
    if (entry.firstClearEquipmentId) ref('equipment', entry.firstClearEquipmentId);
    if (entry.clear && entry.firstClearEquipmentId) fail(`波次通关不能混用旧首胜送装备：${entry.id}`);
    const visited = new Set([entry.id]);
    let current = entry;
    while ('regionId' in current.unlock) {
      const key = current.unlock.regionId;
      if (visited.has(key)) fail(`区域开放依赖循环：${entry.id}`);
      visited.add(key);
      current = c.regions.find((region) => region.id === key)!;
    }
    if (current.unlock.level > 12) fail(`首段区域不可要求筑基：${entry.id}`);
  }
  const s = c.settings;
  ref('items', s.supplyItemId); ref('items', s.breakthroughItemId);
  if (s.starterEquipmentId !== null) ref('equipment', s.starterEquipmentId);
  ref('techniques', s.starterTechniqueId);
  if (c.techniqueAcquisition) {
    const manuals = new Set<string>();
    for (const technique of c.techniques) {
      if (technique.id === s.starterTechniqueId) {
        if (technique.manualItemId || !('level' in technique.unlock) || technique.unlock.level !== 0) fail('起步功法须免费且直接可用');
        continue;
      }
      if (!technique.manualItemId) fail(`功法缺少学习载体：${technique.id}`);
      const manualId = technique.manualItemId!;
      ref('items', manualId);
      if (c.items.find((item) => item.id === manualId)!.kind !== 'manual' || manuals.has(manualId)) fail('功法载体须唯一且为书册');
      manuals.add(manualId);
    }
    if (c.items.some((item) => item.kind === 'manual' && !manuals.has(item.id))) fail('书册缺少对应功法');
  } else if (c.techniques.some((entry) => entry.manualItemId) || c.items.some((item) => item.kind === 'manual')) {
    fail('书册须启用显式功法学习');
  }
  ref('actions', s.baseActionId);
  Object.keys(s.starterItems).forEach((key) => ref('items', key));
  const supply = c.items.find((item) => item.id === s.supplyItemId)!;
  if (supply.use?.kind !== 'restore' || supply.use.resource !== 'hp') fail('自动补给必须恢复气血');
  if (s.manaSupply) {
    ref('items', s.manaSupply.itemId);
    const mana = c.items.find((item) => item.id === s.manaSupply!.itemId)!;
    if (mana.use?.kind !== 'restore' || mana.use.resource !== 'mp') fail('回灵补给必须恢复灵力');
  }
  if (c.items.find((item) => item.id === s.breakthroughItemId)!.kind !== 'breakthrough') fail('突破资源种类错误');
  if (dec(c.actions.find((action) => action.id === s.baseActionId)!.mpCost).gt(0)) fail('基础攻击必须零消耗');
  if (s.battleLimitMs < s.stalemateMs) fail('战斗上限必须不小于无进展上限');
  if (c.equipmentAcquisition === 'crafting-only') {
    if (s.starterEquipmentId !== null || c.enemies.some((enemy) => enemy.equipmentDrops.length) ||
        c.challenges.some((challenge) => challenge.enemy.equipmentDrops.length) ||
        c.regions.some((region) => region.firstClearEquipmentId)) fail('打造路线不能赠送或掉落成品装备');
    for (const entry of c.equipment) {
      if (!c.recipes.some((recipe) => recipe.outputKind === 'equipment' && recipe.outputId === entry.id)) {
        fail(`装备缺少打造来源：${entry.id}`);
      }
    }
  }
  let last = dec(0);
  let efficiency = dec(1);
  for (const band of s.reserveBands) {
    if (dec(band.until).lte(last) || dec(band.efficiency).gt(efficiency)) fail('储备区间必须递增，效率不得递增');
    last = dec(band.until); efficiency = dec(band.efficiency);
  }
  if (!last.eq(s.reserveCapacity) || last.gte(c.realms[13].required)) fail('储备终点须等于容量且小于筑基初期修为');
  return freeze(c);
}

export const content = loadContent(rawContent);

export function indexById<T extends { id: string }>(entries: T[]): Record<string, T> {
  return Object.freeze(Object.assign(Object.create(null), Object.fromEntries(entries.map((entry) => [entry.id, entry]))));
}

const statNames: Record<Modifier['stat'], string> = {
  maxHp: '气血上限', maxMp: '灵力上限', attack: '物攻', magicAttack: '法攻',
  defense: '物防', magicDefense: '法防',
  agility: '身法', hpRegen: '每秒气血回复', mpRegen: '每秒灵力回复',
};
export function describeModifier(value: Modifier): string {
  return `${statNames[value.stat]} ${dec(value.value).gte(0) ? '+' : ''}${value.mode === 'percent' ? dec(value.value).mul(100).toFixed() + '%' : value.value}`;
}
export function describeEffect(value: Effect): string {
  const when = { hit: '每段命中后', hurt: '损失气血且存活后', action: '每次行动后', kill: '击败后' }[value.trigger];
  if (value.kind === 'restore') return `${when}恢复${value.amount}${value.resource === 'hp' ? '气血' : '灵力'}`;
  if (value.kind === 'restore-percent') return `${when}恢复最大${value.resource === 'hp' ? '气血' : '灵力'}的${dec(value.amount).mul(100)}%`;
  if (value.kind === 'shield') return `${when}获得${value.amount}护盾（总量不超过气血上限）`;
  return `${when}对对方造成${value.amount}${value.damageType === 'physical' ? '物理' : '法术'}派生伤害（不暴击、不触发）`;
}
