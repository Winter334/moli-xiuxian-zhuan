import { z } from 'zod';
import { dec, integerAdd, maximum } from '../numbers';
import {
  addInstance, addStack, cleared, gainCharacterExperience, readCharacter, record, synchronizeCharacter, type CharacterState,
} from './character-state';
import { CharacterCommandError, commandEntry } from './command-error';
import { ITEMS, REGIONS, SAFE_LOCATIONS } from './content';
import { FOUNDATION_LEVEL, LEVEL_CAP, realmAt, realmName } from './growth';
import { SKILL_IDS, SKILLS, threshold } from './skills';
import { getPlayerStats, setRecoveryMode, withdraw } from './simulation';

const id = z.string().min(1).max(100);
export const DEBUG_STACK_LIMIT = 10000;
export const DEBUG_INSTANCE_LIMIT = 100;
const debugCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('realm'), level: z.number().int().min(1).max(LEVEL_CAP) }).strict(),
  z.object({ type: z.literal('heal') }).strict(),
  z.object({ type: z.literal('money'), amount: z.number().int().min(1).max(1_000_000_000_000) }).strict(),
  z.object({
    type: z.literal('item'), itemId: id, quantity: z.number().int().min(1).max(DEBUG_STACK_LIMIT),
    quality: z.number().int().min(10).max(999),
  }).strict(),
  z.object({ type: z.literal('skill'), skillId: z.enum(SKILL_IDS), level: z.number().int().min(1).max(999) }).strict(),
  z.object({ type: z.literal('region'), regionId: id, operation: z.enum(['open', 'complete']) }).strict(),
  z.object({ type: z.literal('travel'), locationId: id }).strict(),
]);
export type DebugCommand = z.infer<typeof debugCommandSchema>;

function unlockSafeLocation(state: CharacterState, id: string, visiting = new Set<string>()) {
  const location = commandEntry(SAFE_LOCATIONS, id, '没有这个安全地点');
  if (location.prerequisite) completeRegion(state, location.prerequisite, visiting);
}

function unlockRegion(state: CharacterState, id: string, visiting = new Set<string>()) {
  const region = commandEntry(REGIONS, id, '没有这个历练地点');
  if (region.prerequisite) completeRegion(state, region.prerequisite, visiting);
  unlockSafeLocation(state, region.parent, visiting);
}

function completeRegion(state: CharacterState, id: string, visiting = new Set<string>()) {
  if (visiting.has(id)) throw new CharacterCommandError('地图前置关系存在循环，未修改进度');
  visiting.add(id);
  unlockRegion(state, id, visiting);
  if (!cleared(state, id)) state.simulation.clearedGroups[id] = String(REGIONS[id].groups);
  visiting.delete(id);
}

function moveToSafety(state: CharacterState, locationId: string) {
  delete state.training;
  delete state.gathering;
  state.simulation = state.simulation.battle
    ? withdraw(state.simulation)
    : setRecoveryMode(state.simulation, 'rest');
  state.locationId = locationId;
}

// Not part of the normal command protocol. Only the development client imports this entry.
export function executeDebugCommand(input: CharacterState, raw: DebugCommand): CharacterState {
  const parsed = debugCommandSchema.safeParse(raw);
  if (!parsed.success) throw new CharacterCommandError('测试参数无效，请检查整数范围');
  const command = parsed.data;
  const state = readCharacter(input);
  let fullHeal = false;
  switch (command.type) {
    case 'realm': {
      if (command.level <= state.level) throw new CharacterCommandError('目标境界须高于当前境界');
      const amount = dec(realmAt(command.level).cumulativeCost)
        .minus(realmAt(state.level).cumulativeCost).minus(state.cultivation);
      ({ fullHeal } = gainCharacterExperience(state, maximum(amount, 0), command.level >= FOUNDATION_LEVEL ? 'human' : undefined, false));
      record(state, `[测试] 境界提升至${realmName(state.level)}`);
      break;
    }
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
      const skill = state.skills[command.skillId];
      const definition = SKILLS[command.skillId];
      if (!skill) throw new CharacterCommandError('请先取得此技能或领悟此功法');
      if (command.level <= skill.level || command.level > definition.max) {
        throw new CharacterCommandError(`目标等级须高于当前等级，且不超过${definition.max}级`);
      }
      skill.level = command.level;
      skill.xp = threshold(command.skillId, command.level);
      record(state, `[测试] ${definition.name}提升至${command.level}级`);
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
  state.history.testAssisted = true;
  synchronizeCharacter(state);
  if (fullHeal) state.simulation.player.hp = getPlayerStats(state.simulation).maxHp;
  return readCharacter(state);
}
