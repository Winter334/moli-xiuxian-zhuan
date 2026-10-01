import type { Content, Modifier } from './content';
import type { GameState } from './types';
import type { FoundationMethodId, GameView } from '../shared/contracts';
import { FOUNDATION_METHOD_IDS } from '../shared/contracts';
import { RuleError } from './errors';
import { dec, integerAdd, random } from './numbers';
import { describeModifier } from './presentation';

export function foundationCosts(content: Content, method: Content['foundationMethods'][number]) {
  return [
    { itemId: content.settings.breakthroughItemId, quantity: content.settings.breakthroughQuantity,
      failureQuantity: content.settings.breakthroughQuantity },
    ...method.extraCosts,
  ];
}

export function foundationModifiers(content: Content, state: GameState): Modifier[] {
  return state.foundation.methodId
    ? content.foundationMethods.find((method) => method.id === state.foundation.methodId)!.modifiers : [];
}

export function assertFoundationState(content: Content, state: GameState) {
  const validMethod = (id: unknown): id is FoundationMethodId => FOUNDATION_METHOD_IDS.includes(id as FoundationMethodId);
  const record = state.foundation;
  if (!record || (record.methodId !== null && !validMethod(record.methodId)) ||
      typeof record.attempts !== 'string' || record.attempts.length > 1000 || !/^(0|[1-9]\d*)$/.test(record.attempts) ||
      (state.level >= 13) !== (record.methodId !== null) ||
      !Array.isArray(state.history.foundationMethods) ||
      new Set(state.history.foundationMethods).size !== state.history.foundationMethods.length ||
      state.history.foundationMethods.some((id) => !validMethod(id)) ||
      (record.methodId && !state.history.foundationMethods.includes(record.methodId))) {
    throw new Error('筑基根基或历史记录缺失或非法，不补全旧档');
  }
  const last = record.lastAttempt;
  if ((record.attempts === '0') !== (last === null) ||
      (record.methodId !== null) !== (last?.success === true) ||
      (last !== null && (!last || !validMethod(last.methodId) || typeof last.success !== 'boolean' ||
        !Number.isSafeInteger(last.at) || last.at < 0 || last.at > state.clockMs || last.at % 1000 !== 0 ||
        (last.success ? record.methodId !== last.methodId : record.methodId !== null)))) {
    throw new Error('筑基尝试记录缺失或非法');
  }
  const achievements = state.history.achievements;
  if (!achievements || typeof achievements !== 'object' || Array.isArray(achievements) ||
      Object.entries(achievements).some(([id, entry]) => {
        const definition = content.achievements.find((achievement) => achievement.id === id);
        return !definition || !entry || !state.history.foundationMethods.includes(definition.foundationMethodId) ||
          !Number.isSafeInteger(entry.at) || entry.at < 0 || entry.at > state.clockMs || entry.at % 1000 !== 0 ||
          typeof entry.lifeId !== 'string' || !/^[1-9]\d*$/.test(entry.lifeId) || entry.lifeId.length > 100 ||
          BigInt(entry.lifeId) > BigInt(state.lifeId);
      }) || content.achievements.some((achievement) =>
        state.history.foundationMethods.includes(achievement.foundationMethodId) && !Object.hasOwn(achievements, achievement.id))) {
    throw new Error('成就记录缺失或非法');
  }
}

export function attemptFoundation(content: Content, state: GameState, methodId: FoundationMethodId, lifeId: string) {
  if (lifeId !== state.lifeId) throw new RuleError('本世标识已失效，请刷新后重试');
  const method = content.foundationMethods.find((method) => method.id === methodId);
  if (!method) throw new RuleError('请选择有效筑基方式');
  if (state.phase !== 'active' || state.level !== 12 || dec(state.cultivation).lt(content.realms[12].required)) {
    throw new RuleError('须先入世并修满炼气十二层，已筑基者不可重复尝试');
  }
  if (state.activity.kind === 'dungeon') throw new RuleError('请先结束历练或挑战，脱战后筑基');
  const costs = foundationCosts(content, method);
  // All eligibility and the full preparation are checked before consuming the one outcome roll.
  for (const cost of costs) {
    if (BigInt(state.inventory[cost.itemId] ?? '0') < BigInt(cost.quantity)) {
      throw new RuleError(`${content.items.find((item) => item.id === cost.itemId)!.name}数量不足`);
    }
  }
  const success = dec(random(state)).lt(method.successChance);
  for (const cost of costs) {
    state.inventory[cost.itemId] = integerAdd(state.inventory[cost.itemId] ?? '0',
      -BigInt(success ? cost.quantity : cost.failureQuantity));
  }
  state.foundation.attempts = integerAdd(state.foundation.attempts, 1);
  state.foundation.lastAttempt = { methodId, at: state.clockMs, success };
  const achievements: string[] = [];
  if (success) {
    state.foundation.methodId = methodId;
    state.history.foundationMethods = [...new Set([...state.history.foundationMethods, methodId])];
    state.level = 13;
    state.cultivation = state.reserve;
    state.reserve = '0';
    for (const achievement of content.achievements) {
      if (achievement.foundationMethodId !== methodId || Object.hasOwn(state.history.achievements, achievement.id)) continue;
      state.history.achievements[achievement.id] = { at: state.clockMs, lifeId: state.lifeId };
      achievements.push(achievement.id);
    }
  }
  return { method, success, achievements };
}

export function foundationView(content: Content, state: GameState): GameView['breakthrough'] {
  const eligible = state.phase === 'active' && state.level === 12 &&
    dec(state.cultivation).gte(content.realms[12].required) && state.activity.kind !== 'dungeon';
  const methods = content.foundationMethods.map((method) => {
    const costs = foundationCosts(content, method).map((cost) => ({
      ...cost, name: content.items.find((item) => item.id === cost.itemId)!.name,
      owned: state.inventory[cost.itemId] ?? '0',
    }));
    return {
      id: method.id, name: method.name, successChance: method.successChance,
      ready: eligible && costs.every((cost) => BigInt(cost.owned) >= BigInt(cost.quantity)),
      effects: method.modifiers.map(describeModifier), costs,
    };
  });
  return {
    ready: methods.some((method) => method.ready), methods,
    methodId: state.foundation.methodId, attempts: state.foundation.attempts,
    lastAttempt: state.foundation.lastAttempt ? { ...state.foundation.lastAttempt } : null,
    effects: foundationModifiers(content, state).map(describeModifier),
    requirements: [
      `入世并修满炼气十二层 ${content.realms[12].required} 修为`,
      '脱战后选择筑基方式并备齐材料，不要求储满修为；三种方式均可能失败',
      '筑基丹成功失败均消耗；附材损耗按所选方式，失败保留境界、修为与储备',
    ],
  };
}
