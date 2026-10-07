import { z } from 'zod';
import { dec, exactAdd, integerAdd, maximum } from '../numbers';
import {
  addInstance, addStack, cleared, gainCharacterExperience, readCharacter, record, synchronizeCharacter, type CharacterState,
} from './character-state';
import { CharacterCommandError, commandEntry } from './command-error';
import { ITEMS, REGIONS, SAFE_LOCATIONS } from './content';
import { FOUNDATION_LEVEL, LEVEL_CAP, realmAt, realmName } from './growth';
import { foundationRootSchema } from './foundation';
import { FATES, fateIdSchema } from './fates';
import { FURNACES, furnaceTierSchema } from './furnace';
import { MASTERIES, masteryProgress, SKILL_IDS, SKILLS, threshold, type SkillId } from './skills';
import { getPlayerStats, setRecoveryMode, withdraw } from './simulation';
import { nonnegativeSchema } from './types';
import { JOURNEY_LENGTH } from './lake-activities';

const id = z.string().min(1).max(100);
export const DEBUG_STACK_LIMIT = 10000;
export const DEBUG_INSTANCE_LIMIT = 100;
const amount = nonnegativeSchema.refine(value => dec(value).gt(0), 'Expected a positive amount');
export const debugCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('realm'), level: z.number().int().min(1).max(LEVEL_CAP), root: foundationRootSchema.optional() }).strict(),
  z.object({ type: z.literal('cultivation'), amount }).strict(),
  z.object({ type: z.literal('fate'), fateId: fateIdSchema }).strict(),
  z.object({ type: z.literal('furnace'), tier: furnaceTierSchema }).strict(),
  z.object({ type: z.literal('insight'), amount }).strict(),
  z.object({ type: z.literal('clear-test-marker') }).strict(),
  z.object({ type: z.literal('heal') }).strict(),
  z.object({ type: z.literal('money'), amount: z.number().int().min(1).max(1_000_000_000_000) }).strict(),
  z.object({
    type: z.literal('item'), itemId: id, quantity: z.number().int().min(1).max(DEBUG_STACK_LIMIT),
    quality: z.number().int().min(10).max(999),
  }).strict(),
  z.object({ type: z.literal('skill'), skillId: z.enum(SKILL_IDS), level: z.number().int().min(1).max(999) }).strict(),
  z.object({ type: z.literal('learn-skill'), skillId: z.enum(SKILL_IDS) }).strict(),
  z.object({ type: z.literal('skill-xp'), skillId: z.enum(SKILL_IDS), amount }).strict(),
  z.object({ type: z.literal('region'), regionId: id, operation: z.enum(['open', 'complete']) }).strict(),
  z.object({ type: z.literal('travel'), locationId: id }).strict(),
]);
export type DebugCommand = z.infer<typeof debugCommandSchema>;

function unlockSafeLocation(state: CharacterState, id: string, visiting = new Set<string>()) {
  const location = commandEntry(SAFE_LOCATIONS, id, '没有这个安全地点');
  if (location.prerequisite) completeRegion(state, location.prerequisite, visiting);
  if (id === 'jiyuan-ruins' || id === 'ruin-meditation-room') {
    state.skills.footwork ??= { level: 0, xp: '0' };
    state.firstJourney = { progress: JOURNEY_LENGTH };
  }
  if (id === 'ruin-meditation-room') {
    state.jiyuanIntroduced = true;
    state.ruinMeditationOpened = true;
    state.meditationTier = state.meditationTier === 120 ? 120 : 40;
  }
}

function unlockRegion(state: CharacterState, id: string, visiting = new Set<string>()) {
  const region = commandEntry(REGIONS, id, '没有这个历练地点');
  if (region.prerequisite) completeRegion(state, region.prerequisite, visiting);
  unlockSafeLocation(state, region.parent, visiting);
  if (id === 'qixia-loop-array') state.qixiaArray ??= { layers: 6, unlockedMax: 8 };
  if (region.parent === 'chengzhao-lakeshore') state.lakeInsightClaimed = true;
  if (region.parent === 'jiyuan-ruins') state.jiyuanIntroduced = true;
  if (region.parent === 'jiyuan-brokenplain') state.brokenplainIntroduced = true;
}

function completeRegion(state: CharacterState, id: string, visiting = new Set<string>()) {
  if (visiting.has(id)) throw new CharacterCommandError('地图前置关系存在循环，未修改进度');
  if (cleared(state, id)) return;
  visiting.add(id);
  unlockRegion(state, id, visiting);
  if (!cleared(state, id)) state.simulation.clearedGroups[id] = String(REGIONS[id].groups);
  if (id === 'essence-condensing-corridor') state.meditationTier = 120;
  visiting.delete(id);
}

function moveToSafety(state: CharacterState, locationId: string) {
  if (state.reactor) state.reactor.active = false;
  delete state.training;
  delete state.gathering;
  delete state.fishing;
  state.simulation = state.simulation.battle
    ? withdraw(state.simulation)
    : setRecoveryMode(state.simulation, 'rest');
  state.locationId = locationId;
  if (locationId === 'qixia-overlook') state.meditationTier ??= 10;
}

function learnSkill(state: CharacterState, id: SkillId) {
  if (state.skills[id]) throw new CharacterCommandError('此技能已经取得');
  const definition = SKILLS[id];
  if ('prerequisite' in definition) completeRegion(state, definition.prerequisite);
  if (id === 'domain') {
    if (!state.learnedDivineArts.includes('circulating-qi')) throw new CharacterCommandError('领域需要先完成筑基');
    state.learnedDivineArts.push('domain');
    if (state.activeDivineArt === 'circulating-qi') state.activeDivineArt = 'domain';
  }
  if (Object.hasOwn(MASTERIES, id)) {
    state.skills[id] = masteryProgress(state.skills, id as keyof typeof MASTERIES);
  } else state.skills[id] = { level: 0, xp: '0' };
}

function editableSkill(state: CharacterState, id: SkillId) {
  if (!state.skills[id] && Object.hasOwn(MASTERIES, id)) {
    state.skills[id] = masteryProgress(state.skills, id as keyof typeof MASTERIES);
  }
  const skill = state.skills[id];
  if (!skill) throw new CharacterCommandError('请先取得此技能或领悟此功法');
  return skill;
}

function setSkillXp(state: CharacterState, id: SkillId, xp: string) {
  const skill = editableSkill(state, id);
  skill.xp = xp;
  while (skill.level < SKILLS[id].max && dec(xp).gte(threshold(id, skill.level + 1))) skill.level++;
}

// Kept separate from normal player commands; deployed callers must verify administrator identity.
export function executeDebugCommand(input: CharacterState, raw: DebugCommand): CharacterState {
  const parsed = debugCommandSchema.safeParse(raw);
  if (!parsed.success) throw new CharacterCommandError('测试参数无效，请检查数值范围');
  const command = parsed.data;
  const state = readCharacter(input);
  let fullHeal = false;
  switch (command.type) {
    case 'realm': {
      if (command.level <= state.level) throw new CharacterCommandError('目标境界须高于当前境界');
      if (state.foundationRoot && command.root && command.root !== state.foundationRoot) {
        throw new CharacterCommandError('已有筑基根基不能更换');
      }
      const amount = dec(realmAt(command.level).cumulativeCost)
        .minus(realmAt(state.level).cumulativeCost).minus(state.cultivation);
      ({ fullHeal } = gainCharacterExperience(state, maximum(amount, 0),
        command.level >= FOUNDATION_LEVEL ? state.foundationRoot ?? command.root ?? 'human' : undefined, false, ['fixed'], true));
      record(state, `[测试] 境界提升至${realmName(state.level)}`);
      break;
    }
    case 'cultivation': {
      const result = gainCharacterExperience(state, command.amount, undefined, false);
      fullHeal = result.fullHeal;
      if (dec(result.credited).lte(0)) throw new CharacterCommandError('修为已达突破前上限，请先完成突破');
      record(state, `[测试] 增加修为${result.credited}${dec(result.credited).lt(command.amount) ? '，封顶溢出未计入' : ''}`);
      break;
    }
    case 'fate':
      if (state.fateId === command.fateId) throw new CharacterCommandError('当前已是此气运');
      record(state, `[测试] 气运由${FATES[state.fateId].name}更换为${FATES[command.fateId].name}`);
      state.fateId = command.fateId;
      break;
    case 'furnace':
      if (command.tier <= state.furnaceTier) throw new CharacterCommandError('目标炉鼎须高于当前炉阶');
      state.furnaceTier = command.tier;
      record(state, `[测试] 炉鼎提升为${FURNACES[command.tier].name}`);
      break;
    case 'insight':
      if (state.level < FOUNDATION_LEVEL) throw new CharacterCommandError('筑基后才能增加化悟值');
      state.marrowInsight = exactAdd(state.marrowInsight ?? '0', command.amount);
      record(state, `[测试] 化悟值增加${command.amount}`);
      break;
    case 'clear-test-marker':
      if (!state.history.testAssisted) throw new CharacterCommandError('当前角色没有旧测试标记');
      record(state, '[测试] 清除旧测试标记');
      break;
    case 'heal':
      state.simulation.player.hp = getPlayerStats(state.simulation).maxHp;
      record(state, '[测试] 气血回满');
      break;
    case 'money':
      state.money = integerAdd(state.money, command.amount);
      record(state, `[测试] 灵石余额增加${command.amount}`);
      break;
    case 'item': {
      const item = commandEntry(ITEMS, command.itemId, '没有这个物品');
      const instanced = item.kind === 'equipment' || item.kind === 'part';
      if (instanced) {
        if (command.quantity > DEBUG_INSTANCE_LIMIT) {
          throw new CharacterCommandError(`器物每次最多发放${DEBUG_INSTANCE_LIMIT}件`);
        }
        for (let i = 0; i < command.quantity; i++) addInstance(state, state.instances, command.itemId, command.quality);
      } else addStack(state.inventory, command.itemId, command.quantity);
      record(state, `[测试] 发放${item.name}×${command.quantity}${instanced ? `，品质${command.quality}` : ''}`);
      break;
    }
    case 'skill': {
      const skill = editableSkill(state, command.skillId);
      const definition = SKILLS[command.skillId];
      if (command.level <= skill.level || command.level > definition.max) {
        throw new CharacterCommandError(`目标等级须高于当前等级，且不超过${definition.max}级`);
      }
      setSkillXp(state, command.skillId, maximum(skill.xp, threshold(command.skillId, command.level)));
      record(state, `[测试] ${definition.name}提升至${command.level}级`);
      break;
    }
    case 'learn-skill':
      learnSkill(state, command.skillId);
      record(state, `[测试] 取得${SKILLS[command.skillId].name}，补齐必要前置，未发放战斗奖励`);
      break;
    case 'skill-xp': {
      const skill = editableSkill(state, command.skillId);
      setSkillXp(state, command.skillId, exactAdd(skill.xp, command.amount));
      record(state, `[测试] ${SKILLS[command.skillId].name}累计熟练增加${command.amount}`);
      break;
    }
    case 'region': {
      const region = commandEntry(REGIONS, command.regionId, '没有这个历练地点');
      if (command.operation === 'complete') completeRegion(state, command.regionId);
      else unlockRegion(state, command.regionId);
      moveToSafety(state, region.parent);
      record(state, `[测试] ${command.operation === 'complete' ? '完成' : '开放'}${region.name}及必要前置，前往${SAFE_LOCATIONS[region.parent].name}，未发放战斗奖励`);
      break;
    }
    case 'travel':
      unlockSafeLocation(state, command.locationId);
      moveToSafety(state, command.locationId);
      record(state, `[测试] 前往${SAFE_LOCATIONS[command.locationId].name}，补齐必要前置，未发放战斗奖励`);
      break;
  }
  state.history.testAssisted = false;
  synchronizeCharacter(state);
  if (fullHeal) state.simulation.player.hp = getPlayerStats(state.simulation).maxHp;
  return readCharacter(state);
}
