import { z } from 'zod';
import { dec, integerAdd, text } from '../numbers';
import { CONTENT_VERSION, ITEMS, MANOR_AID, REGIONS, SAFE_LOCATIONS, SHOPS, SHOP_IDS, SLOTS, encounterEnemy, encounterNeedsEntry, encounterPool, expandEncounter, temporaryEffect, lookup } from './content';
import { activeSources, positiveValue } from './effects';
import { DIVINE_ARTS, DIVINE_ART_IDS, FOUNDATION_DIVINE_ART, divineArtIdSchema, divineArtSource } from './divine-arts';
import { equipmentSource, instanceSchema, type ItemInstance } from './equipment';
import { drawFate, FATES, FATE_TIERS, fateIdSchema, fateSource } from './fates';
import { furnaceTierSchema } from './furnace';
import { foundationBase, foundationRootSchema, FOUNDATION_ROOTS, type FoundationRoot } from './foundation';
import { FOUNDATION_LEVEL, gainCultivation, LEVEL_CAP, realmAt, realmName } from './growth';
import { gatheringSchema, gatheringSkill, LOGGING, MINING, MINING_SITES, miningCountSchema, miningEfficiency } from './gathering';
import { historySchema, initialHistory, markMilestone, validateHistory } from './history';
import { RECENT_LOG_LIMIT } from './log';
import { fishingSchema, journeySchema, JOURNEY_LENGTH } from './lake-activities';
import { reactorSchema } from './ark-reactor';
import { ARTIFACT_SKILLS, gainSkill, initialSkills, MANUAL_IDS, MANUALS, manualIdSchema, manualSource, pressureSource, SKILL_IDS, SKILLS, skillSources, skillsSchema, threshold, TRAINING_IDS, TRAININGS, trainingAt, trainingIdSchema, type ArtifactSkillId, type SkillId, type WeaponSkill } from './skills';
import { createSimulation, getPlayerStats, readSimulation, updatePlayerStats } from './simulation';
import { countSchema, enemySchema, nonnegativeSchema, simulationSchema, sourceSchema, type EffectTag, type PlayerUpdate } from './types';

export { countSchema } from './types';
const inventorySchema = z.record(z.string(), countSchema);
const instancesSchema = z.record(z.string().regex(/^item-[1-9]\d*$/), instanceSchema);
const shopSchema = z.object({
  dayIndex: z.number().int().nonnegative().nullable(),
  inventory: inventorySchema, instances: instancesSchema,
}).strict();
export type ShopState = z.infer<typeof shopSchema>;
export const characterSchema = z.object({
  schemaVersion: z.literal('neko-character-9'),
  contentVersion: z.literal(CONTENT_VERSION),
  life: z.object({
    number: countSchema.refine(value => BigInt(value) > 0n),
    startedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  fateId: fateIdSchema,
  simulation: simulationSchema,
  locationId: z.string().min(1),
  furnaceTier: furnaceTierSchema,
  level: z.number().int().min(0).max(LEVEL_CAP),
  foundationRoot: foundationRootSchema.nullable(),
  cultivation: nonnegativeSchema,
  marrowInsight: nonnegativeSchema.optional(),
  skills: skillsSchema,
  activeManual: manualIdSchema.optional(),
  learnedDivineArts: z.array(divineArtIdSchema).max(DIVINE_ART_IDS.length)
    .refine(ids => new Set(ids).size === ids.length),
  activeDivineArt: divineArtIdSchema.nullable(),
  history: historySchema,
  training: trainingIdSchema.optional(),
  gathering: gatheringSchema.optional(),
  fishing: fishingSchema.optional(),
  reactor: reactorSchema.optional(),
  arkContractClaimed: z.literal(true).optional(),
  lakeInsightClaimed: z.literal(true).optional(),
  firstJourney: journeySchema.optional(),
  jadeSeamCompletions: miningCountSchema.optional(),
  qixiaFragmentCompletions: miningCountSchema.optional(),
  brokenplainSeamCompletions: miningCountSchema.optional(),
  meditationTier: z.union([z.literal(10), z.literal(40), z.literal(120)]).optional(),
  jiyuanIntroduced: z.literal(true).optional(),
  jiyuanMerchantFound: z.literal(true).optional(),
  ruinMeditationOpened: z.literal(true).optional(),
  brokenplainIntroduced: z.literal(true).optional(),
  qixiaArray: z.object({
    layers: z.number().int().min(6).max(9999),
    unlockedMax: z.number().int().min(8).max(9999),
  }).strict().refine(value => value.layers <= value.unlockedMax).optional(),
  manorAidClaimed: z.literal(true).optional(),
  marrow: z.object({
    attack: nonnegativeSchema, defense: nonnegativeSchema, agility: nonnegativeSchema, maxHp: nonnegativeSchema,
  }).strict(),
  money: countSchema,
  inventory: inventorySchema,
  instances: instancesSchema,
  nextInstanceId: countSchema.refine((value) => BigInt(value) > 0n),
  equipment: z.object({
    weapon: z.string().nullable(), head: z.string().nullable(), body: z.string().nullable(),
    legs: z.string().nullable(), feet: z.string().nullable(),
    accessory: z.string().nullable().optional(), artifact: z.string().nullable().optional(), special: z.string().nullable().optional(),
  }).strict(),
  shop: shopSchema,
  marketShop: shopSchema.optional(),
  stoneforgeShop: shopSchema.optional(),
  manorShop: shopSchema.optional(),
  forestShop: shopSchema.optional(),
  zhaoyeShop: shopSchema.optional(),
  jiyuanShop: shopSchema.optional(),
  arkShop: shopSchema.optional(),
  log: z.array(z.object({ at: z.number().int().nonnegative(), message: z.string().max(500) }).strict()).max(RECENT_LOG_LIMIT),
}).strict();
export type CharacterState = z.infer<typeof characterSchema>;

export function storedShops(state: CharacterState) {
  return SHOP_IDS.flatMap(id => {
    const stock = state[SHOPS[id].stateKey];
    return stock ? [{ id, stock }] : [];
  });
}

export function cleared(state: CharacterState, regionId: string): boolean {
  return BigInt(state.simulation.clearedGroups[regionId] ?? '0') >= BigInt(lookup(REGIONS, regionId).groups);
}
export function isUnlocked(state: CharacterState, locationId: string): boolean {
  const parent = REGIONS[locationId]?.parent;
  if ((locationId === 'jiyuan-ruins' || locationId === 'ruin-meditation-room' || parent === 'jiyuan-ruins') &&
      state.firstJourney?.progress !== JOURNEY_LENGTH) return false;
  if (parent === 'jiyuan-ruins' && !state.jiyuanIntroduced) return false;
  if (parent === 'jiyuan-brokenplain' && !state.brokenplainIntroduced) return false;
  if (locationId === 'ruin-meditation-room' && !state.ruinMeditationOpened) return false;
  if (locationId === 'qixia-loop-array' && !state.qixiaArray) return false;
  if (REGIONS[locationId]?.parent === 'chengzhao-lakeshore' && !state.lakeInsightClaimed) return false;
  const target = Object.hasOwn(REGIONS, locationId) ? REGIONS[locationId] : lookup(SAFE_LOCATIONS, locationId);
  return target.prerequisite === null || cleared(state, target.prerequisite);
}

export function defeatDestination(state: CharacterState): string {
  const locations = { ...REGIONS, ...SAFE_LOCATIONS };
  const connections = new Map(Object.keys(locations).map(id => [id, [] as string[]]));
  // Use the map's prerequisite links in both directions, not the retired travel restrictions.
  for (const [id, location] of Object.entries(locations)) {
    const parent = location.prerequisite ?? ('parent' in location ? location.parent : null);
    if (parent === null) continue;
    connections.get(id)!.push(parent);
    connections.get(parent)!.push(id);
  }
  const queue = [state.locationId];
  const visited = new Set(queue);
  for (const id of queue) {
    if (SAFE_LOCATIONS[id]?.meditation) return id;
    for (const next of connections.get(id) ?? []) {
      if (visited.has(next) || !isUnlocked(state, next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  throw new Error('No reachable meditation location');
}

export function equippedWeaponSkill(state: CharacterState): WeaponSkill {
  const uid = state.equipment.weapon;
  return uid === null ? 'unarmed' : lookup(ITEMS, lookup(state.instances, uid).itemId).weaponSkill ?? 'sword';
}

export function characterStats(state: CharacterState, excludeStageAid = false): Required<Pick<PlayerUpdate, 'base' | 'sources'>> {
  return {
    base: foundationBase(state.level, state.foundationRoot),
    sources: [
      { id: 'marrow', flat: { ...state.marrow } },
      fateSource(state.fateId),
      ...skillSources(state.skills, equippedWeaponSkill(state)),
      ...SLOTS.flatMap((slot) => {
        const uid = state.equipment[slot];
        return uid == null || (excludeStageAid && state.instances[uid].itemId === MANOR_AID.itemId)
          ? [] : [equipmentSource(uid, lookup(state.instances, uid))];
      }),
      ...(state.activeManual ? [manualSource(state.activeManual, state.skills[state.activeManual]!.level)] : []),
      ...(state.activeDivineArt ? [divineArtSource(state.activeDivineArt, state.skills.domain?.level)] : []),
      ...(REGIONS[state.locationId]?.pressure
        ? [pressureSource(REGIONS[state.locationId].pressure!.stage, state.skills.pressure?.level)] : []),
    ].map((source) => sourceSchema.parse(source)),
  };
}

export function synchronizeCharacter(state: CharacterState) {
  const derived = characterStats(state);
  state.simulation = updatePlayerStats(state.simulation, derived).state;
  if (!state.simulation.battle && state.simulation.mode !== 'idle' && Object.hasOwn(REGIONS, state.locationId)) {
    state.locationId = defeatDestination(state);
  }
}

export function addStack(inventory: Record<string, string>, itemId: string, count: string | number) {
  const item = lookup(ITEMS, itemId);
  if (item.kind === 'equipment' || item.kind === 'part') throw new Error('This item requires an instance');
  const result = integerAdd(inventory[itemId] ?? '0', count);
  if (BigInt(result) < 0n) throw new Error('材料或物品不足');
  if (result === '0') delete inventory[itemId];
  else inventory[itemId] = result;
}

export function addInstance(
  state: CharacterState, target: Record<string, ItemInstance>, itemId: string, quality: number,
): string {
  const item = lookup(ITEMS, itemId);
  if (item.kind !== 'equipment' && item.kind !== 'part') throw new Error('This item must be stacked');
  const uid = `item-${state.nextInstanceId}`;
  state.nextInstanceId = integerAdd(state.nextInstanceId, 1);
  target[uid] = instanceSchema.parse({ itemId, quality });
  return uid;
}

export function awardItem(state: CharacterState, itemId: string, count: string | number, quality = 100) {
  const item = lookup(ITEMS, itemId);
  countSchema.parse(String(count));
  if (item.kind === 'equipment' || item.kind === 'part') {
    for (let index = 0n; index < BigInt(count); index++) addInstance(state, state.instances, itemId, quality);
  } else addStack(state.inventory, itemId, count);
}

export function record(state: CharacterState, message: string) {
  state.log.push({ at: state.simulation.clockMs, message });
  if (state.log.length > RECENT_LOG_LIMIT) state.log.splice(0, state.log.length - RECENT_LOG_LIMIT);
}

export function gainCharacterSkill(state: CharacterState, id: SkillId, amount: string): boolean {
  return gainSkill(state.skills, id, amount, state.level, state.marrowInsight, activeSources(state.simulation));
}

export function gainCharacterExperience(
  state: CharacterState, amount: string, root?: FoundationRoot, recordHistory = true, tags: readonly EffectTag[] = ['fixed'],
) {
  const earned = tags.includes('activity')
    ? positiveValue(amount, 'experience.cultivation', activeSources(state.simulation), { tags }) : amount;
  const before = dec(realmAt(state.level).cumulativeCost).plus(state.cultivation);
  const result = gainCultivation(state.level, state.cultivation, earned, root !== undefined);
  const credited = dec(realmAt(result.level).cumulativeCost).plus(result.cultivation).minus(before).toFixed();
  state.level = result.level;
  state.cultivation = result.cultivation;
  if (recordHistory) for (const level of result.levels) markMilestone(state, 'firstRealms', String(level), level);
  if (result.levels.length) record(state, `晋升${realmName(result.level)}`);
  if (result.levels.includes(FOUNDATION_LEVEL)) {
    state.foundationRoot = foundationRootSchema.parse(root);
    record(state, `根基已定：${FOUNDATION_ROOTS[state.foundationRoot].name}`);
    state.learnedDivineArts.push(FOUNDATION_DIVINE_ART);
    record(state, `掌握神通：${DIVINE_ARTS[FOUNDATION_DIVINE_ART].name}，灵髓化悟已开放`);
  }
  return { changed: result.levels.length > 0, fullHeal: result.referencePromotions > 0, earned, credited };
}

export function createCharacter(clockMs: number, seed: number): CharacterState {
  const simulation = createSimulation({ clockMs, seed });
  const fateId = drawFate(simulation);
  const state: CharacterState = {
    schemaVersion: 'neko-character-9', contentVersion: CONTENT_VERSION,
    life: { number: '1', startedAt: clockMs },
    fateId, simulation,
    locationId: 'qingshi-village', furnaceTier: 0, level: 0, foundationRoot: null, cultivation: '0', skills: initialSkills(),
    learnedDivineArts: [], activeDivineArt: null,
    history: initialHistory(clockMs),
    marrow: { attack: '0', defense: '0', agility: '0', maxHp: '0' }, money: '0',
    inventory: { 'copper-coin': '32', 'cloudy-jade': '1', charcoal: '3' },
    instances: {}, nextInstanceId: '1',
    equipment: { weapon: null, head: null, body: null, legs: null, feet: null },
    shop: { dayIndex: null, inventory: {}, instances: {} }, log: [],
  };
  const derived = characterStats(state);
  state.simulation.player.base = derived.base;
  state.simulation.player.sources = derived.sources;
  state.simulation.player.hp = getPlayerStats(state.simulation).maxHp;
  record(state, `本世气运：${FATES[fateId].name}（${FATE_TIERS[FATES[fateId].tier].name}）`);
  return readCharacter(state);
}

export function readCharacter(raw: unknown): CharacterState {
  const state = characterSchema.parse(raw);
  if (state.life.startedAt > state.simulation.clockMs) throw new Error('Life starts after the character clock');
  validateHistory(state);
  if ((state.level >= FOUNDATION_LEVEL) !== (state.foundationRoot !== null)) throw new Error('Foundation root does not match realm');
  if (state.learnedDivineArts.some(id => state.level < DIVINE_ARTS[id].minLevel) ||
      (state.level >= FOUNDATION_LEVEL && !state.learnedDivineArts.includes(FOUNDATION_DIVINE_ART))) {
    throw new Error('Learned divine arts do not match realm');
  }
  if (state.activeDivineArt && !state.learnedDivineArts.includes(state.activeDivineArt)) {
    throw new Error('Active divine art has not been learned');
  }
  if (Boolean(state.skills.domain) !== state.learnedDivineArts.includes('domain') ||
      (state.skills.domain && (!state.brokenplainIntroduced || !cleared(state, 'bone-array-gully') ||
        state.activeDivineArt === 'circulating-qi'))) throw new Error('Invalid domain acquisition or replacement');
  state.simulation = readSimulation(state.simulation);
  const shops = storedShops(state);
  const inventories = [state, ...shops.map(shop => shop.stock)];
  for (const { inventory } of inventories) {
    for (const [id, count] of Object.entries(inventory)) {
      const item = lookup(ITEMS, id);
      if (item.kind === 'equipment' || item.kind === 'part' || BigInt(count) <= 0n) throw new Error('Invalid inventory stack');
    }
  }
  const instanceIds = new Set<string>();
  for (const { instances } of inventories) {
    for (const [uid, instance] of Object.entries(instances)) {
      const item = lookup(ITEMS, instance.itemId);
      if ((item.kind !== 'equipment' && item.kind !== 'part') || instanceIds.has(uid) ||
          BigInt(uid.slice(5)) >= BigInt(state.nextInstanceId)) throw new Error('Invalid item instance');
      instanceIds.add(uid);
    }
  }
  for (const slot of SLOTS) {
    const uid = state.equipment[slot];
    if (uid != null && lookup(ITEMS, lookup(state.instances, uid).itemId).slot !== slot) throw new Error('Invalid equipped slot');
  }
  if (!state.skills[equippedWeaponSkill(state)]) throw new Error('Equipped weapon proficiency is missing');
  if (state.marrowInsight !== undefined && (state.level < FOUNDATION_LEVEL || dec(state.marrowInsight).lte(0))) {
    throw new Error('Invalid marrow insight progress');
  }
  if (state.equipment.artifact) {
    const itemId = state.instances[state.equipment.artifact].itemId;
    if (Object.hasOwn(ARTIFACT_SKILLS, itemId) && !state.skills[itemId as ArtifactSkillId]) {
      throw new Error('Equipped artifact proficiency is missing');
    }
  }
  for (const id of SKILL_IDS) {
    const skill = state.skills[id];
    if (!skill) continue;
    if (dec(skill.xp).lt(threshold(id, skill.level)) ||
        (skill.level < SKILLS[id].max && dec(skill.xp).gte(threshold(id, skill.level + 1)))) {
      throw new Error('Invalid skill progress');
    }
  }
  for (const id of MANUAL_IDS) {
    if (state.skills[id] && !cleared(state, MANUALS[id].prerequisite)) throw new Error('Manual prerequisite is not complete');
  }
  if (state.activeManual && !state.skills[state.activeManual]) throw new Error('Active manual has not been learned');
  for (const id of TRAINING_IDS) {
    if (state.skills[id] && !cleared(state, TRAININGS[id].prerequisite)) throw new Error('Training prerequisite is not complete');
  }
  if (state.training && (!state.skills[state.training] || state.simulation.mode !== 'rest' ||
      !trainingAt(state.training, state.locationId) ||
      !cleared(state, trainingAt(state.training, state.locationId)!.prerequisite))) throw new Error('Invalid training activity');
  if (state.skills.mining && !cleared(state, MINING.prerequisite)) throw new Error('Mining prerequisite is not complete');
  if (state.skills.logging && !cleared(state, LOGGING.prerequisite)) throw new Error('Logging prerequisite is not complete');
  if (state.jadeSeamCompletions !== undefined && (!state.skills.mining || !cleared(state, 'shrine-gate-duel'))) {
    throw new Error('Invalid depleted mining progress');
  }
  if (state.qixiaFragmentCompletions !== undefined && (!state.skills.mining || !cleared(state, 'hanging-radiance-platform'))) {
    throw new Error('Invalid array fragment progress');
  }
  if (state.brokenplainSeamCompletions !== undefined && (!state.skills.mining || !cleared(state, 'resting-armor-plain'))) {
    throw new Error('Invalid brokenplain mining progress');
  }
  if (state.brokenplainIntroduced && !cleared(state, 'jiyuan-lightchaser')) throw new Error('Invalid brokenplain introduction');
  if ((state.reactor || state.skills.pressure) && !cleared(state, 'layered-armor-gate')) throw new Error('Invalid ark acquisition');
  if (state.arkContractClaimed && !cleared(state, 'armor-bearing-cabin')) throw new Error('Invalid ark contract acquisition');
  if (state.reactor?.active && (state.locationId !== 'fallen-ark-outer' || state.simulation.mode !== 'rest' ||
      state.training || state.gathering || state.fishing)) throw new Error('Invalid reactor operation');
  if (state.qixiaArray && !cleared(state, 'qixia-veinguard')) throw new Error('Invalid array negotiation');
  if (state.meditationTier !== undefined && !cleared(state, 'linzhao-crossing')) {
    throw new Error('Invalid meditation tier acquisition');
  }
  if (state.lakeInsightClaimed && !cleared(state, 'qixia-veinguard')) throw new Error('Invalid lakeshore teaching');
  if (state.skills.fishing && !cleared(state, 'qixia-veinguard')) throw new Error('Invalid fishing acquisition');
  if (state.firstJourney && (!state.skills.footwork || !cleared(state, 'chengzhao-gathering-array'))) {
    throw new Error('Invalid first journey');
  }
  if ((state.jiyuanIntroduced || state.jiyuanMerchantFound || state.ruinMeditationOpened) &&
      state.firstJourney?.progress !== JOURNEY_LENGTH) throw new Error('Invalid ruin acquisition');
  if ((state.jiyuanMerchantFound || state.ruinMeditationOpened) && !state.jiyuanIntroduced) throw new Error('Missing ruin introduction');
  if ((state.meditationTier === 40 && !state.ruinMeditationOpened) ||
      (state.ruinMeditationOpened && (state.meditationTier ?? 0) < 40)) throw new Error('Invalid ruin meditation tier');
  if (state.meditationTier === 120 && !cleared(state, 'essence-condensing-corridor')) {
    throw new Error('Invalid ark meditation tier');
  }
  if (state.fishing && (!state.skills.fishing || state.locationId !== 'chengzhao-lakeshore' ||
      state.simulation.mode !== 'rest' || state.training || state.gathering ||
      (state.fishing.fish && state.fishing.fish.rodLength > 40 + state.skills.fishing.level * 4))) {
    throw new Error('Invalid fishing activity');
  }
  if (state.gathering) {
    const activity = state.gathering;
    const site = MINING_SITES[activity.siteId];
    if (!state.skills[gatheringSkill(activity.siteId)] || state.training || state.simulation.mode !== 'rest' ||
        state.locationId !== site.location || !cleared(state, site.prerequisite) ||
        (activity.siteId === 'jade-seam' && state.jadeSeamCompletions === undefined)) throw new Error('Invalid gathering activity');
    if (activity.siteId === 'qixia-array-fragments' && state.qixiaFragmentCompletions === undefined) {
      throw new Error('Missing array fragment count');
    }
    if (activity.siteId === 'brokenplain-marrow-seam' && state.brokenplainSeamCompletions === undefined) {
      throw new Error('Missing brokenplain mining count');
    }
    const completed = activity.siteId === 'jade-seam' ? state.jadeSeamCompletions!
      : activity.siteId === 'qixia-array-fragments' ? state.qixiaFragmentCompletions!
        : activity.siteId === 'brokenplain-marrow-seam' ? state.brokenplainSeamCompletions! : 0;
    if (BigInt(activity.cycleSeconds) < BigInt(miningEfficiency(activity.siteId, MINING.max, completed).cycleSeconds) ||
        BigInt(activity.cycleSeconds) > BigInt(miningEfficiency(activity.siteId, 0, completed).cycleSeconds)) {
      throw new Error('Invalid gathering period');
    }
  }
  if (state.manorAidClaimed && !cleared(state, MANOR_AID.prerequisite)) throw new Error('Invalid assistance acquisition');
  if ((state.level < FOUNDATION_LEVEL - 1 || (state.level > FOUNDATION_LEVEL && state.level < LEVEL_CAP)) &&
      dec(state.cultivation).gte(realmAt(state.level + 1).entryCost)) {
    throw new Error('Unsettled cultivation');
  }
  if (state.level === FOUNDATION_LEVEL - 1 && dec(state.cultivation).gt(realmAt(FOUNDATION_LEVEL).entryCost)) {
    throw new Error('Cultivation exceeds breakthrough cap');
  }
  for (const [id, count] of Object.entries(state.simulation.clearedGroups)) {
    const region = lookup(REGIONS, id);
    if ((region.challenge && BigInt(count) > BigInt(region.groups)) || !isUnlocked(state, id)) throw new Error('Invalid region progress');
  }
  if (!isUnlocked(state, state.locationId)) throw new Error('Location is not unlocked');
  const battle = state.simulation.battle;
  const inRegion = Object.hasOwn(REGIONS, state.locationId);
  if (inRegion && !battle && state.simulation.mode !== 'idle') throw new Error('Invalid active region');
  if (!inRegion && state.simulation.mode === 'idle') throw new Error('Idle outside a region');
  if (inRegion && battle) {
    const region = REGIONS[state.locationId];
    const count = region.allowSummons ? battle.origins?.length ?? 0 : battle.enemies.length;
    const allowed = region.enemyCountRange
      ? count >= Math.floor(region.enemyCountRange[0]) && count <= Math.ceil(region.enemyCountRange[1]) - 1
      : region.randomGroupSize ? [1, 2].includes(count) : count === region.groupSize;
    if (battle.regionId !== state.locationId || !allowed ||
        (region.challenge && cleared(state, state.locationId))) throw new Error('Invalid active region');
    if (encounterNeedsEntry(battle.regionId, battle.enemies.map(enemy => enemy.definition.id)) !== (battle.entry !== undefined)) {
      throw new Error('Invalid encounter entry checkpoint');
    }
    const pool = encounterPool(battle.regionId, state.simulation.clearedGroups[battle.regionId] ?? '0');
    const expectedIds = battle.origins ? expandEncounter(battle.regionId, battle.origins) : undefined;
    if (region.allowSummons && (!battle.origins || battle.origins.some(id => !pool.includes(id)))) {
      throw new Error('Invalid summon origins');
    }
    if (expectedIds && (expectedIds.length !== battle.enemies.length ||
        expectedIds.some((id, slot) => id !== battle.enemies[slot].definition.id))) {
      throw new Error('Invalid encounter origins');
    }
    if (region.fixedEnemies && region.fixedEnemies.some((id, slot) => id !== battle.enemies[slot].definition.id)) {
      throw new Error('Invalid fixed enemy order');
    }
    const entry = battle.entry;
    if (battle.regionId === 'qixia-loop-array') {
      if (!battle.origins || !entry?.arrayLayers || entry.arrayFragments !== undefined ||
          entry.arrayLayers > state.qixiaArray!.unlockedMax ||
          entry.enemyMultiplier !== text(dec('0.08').mul(entry.arrayLayers).plus(1))) {
        throw new Error('Invalid loop array checkpoint');
      }
    } else if (battle.regionId === 'qixia-veinguard' || battle.regionId === 'chengzhao-gathering-array') {
      if (!battle.origins || entry?.arrayFragments === undefined || entry.arrayLayers !== undefined ||
          entry.arrayFragments > (battle.regionId === 'qixia-veinguard' ? 5 : 4) ||
          entry.enemyMultiplier !== text(dec(battle.regionId === 'qixia-veinguard' ? '1.4' : '1.32')
            .minus(dec('.08').mul(entry.arrayFragments)))) {
        throw new Error('Invalid array fragment entry checkpoint');
      }
    } else if (entry && (entry.enemyMultiplier !== undefined || entry.arrayFragments !== undefined ||
        entry.arrayLayers !== undefined)) throw new Error('Unexpected dynamic encounter context');
    for (const enemy of battle.enemies) {
      if (!(region.allowSummons ? expectedIds!.includes(enemy.definition.id) : pool.includes(enemy.definition.id)) ||
          JSON.stringify(enemy.definition) !== JSON.stringify(enemySchema.parse(encounterEnemy(battle.regionId, enemy.definition.id, battle.entry).definition))) {
        throw new Error('Enemy snapshot does not match content');
      }
    }
  } else if (battle) throw new Error('Combat outside a region');
  if (state.simulation.mode === 'sleep' && !SAFE_LOCATIONS[state.locationId]?.meditation) {
    throw new Error('Meditation is not available here');
  }
  for (const { id, stock } of shops) {
    const prerequisite = SHOPS[id].prerequisite;
    if (prerequisite && !cleared(state, prerequisite)) throw new Error('Shop prerequisite is not complete');
    if (id === 'jiyuan-supplies' && !state.jiyuanMerchantFound) throw new Error('Ruin merchant not discovered');
    if (stock.dayIndex === null && (Object.keys(stock.inventory).length || Object.keys(stock.instances).length)) {
      throw new Error('Uninitialized shop has stock');
    }
  }
  const expected = characterStats(state);
  const actual = state.simulation.player;
  if (JSON.stringify(actual.base) !== JSON.stringify(expected.base) ||
      JSON.stringify(actual.sources) !== JSON.stringify(expected.sources)) throw new Error('Character stats are not settled');
  if (state.simulation.effects.some((effect) => !temporaryEffect(effect.id) ||
      JSON.stringify(effect.source) !== JSON.stringify(sourceSchema.parse(temporaryEffect(effect.id)!.source)) ||
      (effect.id.startsWith('moon-blessing:') && !cleared(state, 'split-stoneplain')))) {
    throw new Error('Unknown opening effect');
  }
  getPlayerStats(state.simulation);
  return state;
}
