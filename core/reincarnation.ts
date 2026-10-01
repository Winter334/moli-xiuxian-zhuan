import type { Content } from './content';
import type { GameState } from './types';
import type { GameView, ReincarnationRecord } from '../shared/contracts';
import { RuleError } from './errors';
import { integerAdd } from './numbers';

export function openingTierFor(content: Content, points: string) {
  return content.openingTiers.filter((tier) => BigInt(points) >= BigInt(tier.requiredPoints)).length - 1;
}

function explorationProgress(content: Content, state: GameState) {
  return content.reincarnation.explorationNodes.map((node) => {
    const progress = node.target.kind === 'region'
      ? state.regionKills[node.target.regionId] ?? '0' : state.challengeWins[node.target.challengeId] ?? '0';
    return {
      id: node.id, name: node.name, progress, required: node.target.wins, points: node.points,
      completed: BigInt(progress) >= BigInt(node.target.wins),
    };
  });
}

function lifeHistory(content: Content, state: GameState): GameView['reincarnation']['history'] {
  const visited = content.regions.filter((region) => BigInt(state.regionKills[region.id] ?? '0') > 0n ||
    (state.activity.targetId === region.id && state.activity.kind === 'dungeon')).map((region) => region.id);
  return {
    highestLevel: Math.max(state.history.highestLevel, state.level),
    highestDwellingTier: Math.max(state.history.highestDwellingTier, state.dwelling?.tier ?? 0),
    visitedRegions: [...new Set([...state.history.visitedRegions, ...visited])],
    explorationNodes: [...new Set([...state.history.explorationNodes,
      ...explorationProgress(content, state).filter((node) => node.completed).map((node) => node.id)])],
  };
}

export function recordLifeHistory(content: Content, state: GameState) {
  Object.assign(state.history, lifeHistory(content, state));
}

export function assertReincarnationState(content: Content, state: GameState) {
  const integer = (value: unknown): value is string => typeof value === 'string' &&
    value.length <= 1000 && /^(0|[1-9]\d*)$/.test(value);
  const knownList = (value: unknown, known: string[]): value is string[] =>
    Array.isArray(value) && new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && known.includes(id));
  const history = state.history;
  const record = history.reincarnation;
  const nodeIds = content.reincarnation.explorationNodes.map((node) => node.id);
  if (!record || !integer(record.points) || !integer(record.count) ||
      BigInt(record.count) + 1n !== BigInt(state.lifeId) ||
      history.openingTier !== openingTierFor(content, record.points) ||
      !Number.isInteger(history.highestLevel) || history.highestLevel < 0 || history.highestLevel > 13 ||
      !Number.isInteger(history.highestDwellingTier) || history.highestDwellingTier < 0 ||
      history.highestDwellingTier >= (content.dwelling?.tiers.length ?? 1) ||
      !knownList(history.visitedRegions, content.regions.map((region) => region.id)) ||
      !knownList(history.explorationNodes, nodeIds)) {
    throw new Error('轮回积累或历史进展缺失或非法，不补全旧档');
  }
  const last = record.lastSettlement;
  if ((record.count === '0') !== (last === null) ||
      (record.count === '0' && record.points !== '0') ||
      (last !== null && (!last || !integer(last.lifeId) || last.lifeId === '0' ||
        BigInt(last.lifeId) !== BigInt(record.count) ||
        !Number.isSafeInteger(last.at) || last.at < 0 || last.at > state.clockMs || last.at % 1000 !== 0 ||
        !Number.isInteger(last.level) || last.level < content.reincarnation.minimumLevel || last.level > 13 ||
        (last.foundationMethodId !== null && !history.foundationMethods.includes(last.foundationMethodId)) ||
        (last.level === 13) !== (last.foundationMethodId !== null) ||
        !integer(last.points) || !integer(last.realmPoints) || !integer(last.explorationPoints) ||
        last.points === '0' || BigInt(last.points) !== BigInt(last.realmPoints) + BigInt(last.explorationPoints) ||
        BigInt(last.points) > BigInt(record.points) ||
        !knownList(last.explorationNodes, nodeIds) ||
        last.explorationNodes.some((id) => !history.explorationNodes.includes(id)) ||
        !history.foundationMethods.length))) {
    throw new Error('轮回结算记录缺失或非法');
  }
}

export function reincarnationView(content: Content, state: GameState): GameView['reincarnation'] {
  const rules = content.reincarnation;
  const unlocked = state.history.foundationMethods.length > 0;
  const ready = unlocked && state.phase === 'active' && state.level >= rules.minimumLevel;
  const nodes = explorationProgress(content, state);
  const realmPoints = ready ? rules.realmRewards.filter((reward) => state.level >= reward.level).at(-1)!.points : '0';
  const explorationPoints = ready
    ? nodes.reduce((sum, node) => node.completed ? integerAdd(sum, node.points) : sum, '0') : '0';
  const total = integerAdd(realmPoints, explorationPoints);
  const { points, count, lastSettlement } = state.history.reincarnation;
  const pointsAfter = integerAdd(points, total);
  return {
    lifeId: state.lifeId, unlocked, ready, minimumLevel: rules.minimumLevel,
    requirements: [
      '历史上任意一种筑基方式实际成功后开放，后世保留资格',
      `本世正式入世并达到${content.realms[rules.minimumLevel].name}，不允许零进展重开`,
      '仅主动确认轮回时结算；当前活动与战斗结束，进入新世准备',
    ],
    points, count, pointsAfter, reward: { realmPoints, explorationPoints, total },
    openingTier: state.history.openingTier, openingTierAfter: openingTierFor(content, pointsAfter),
    tiers: content.openingTiers.map((tier) => ({ ...tier, unlocked: BigInt(points) >= BigInt(tier.requiredPoints) })),
    nodes, history: lifeHistory(content, state),
    lastSettlement: lastSettlement ? structuredClone(lastSettlement) : null,
    retained: [
      '已学功法与丹方知识，使用仍须满足本世条件',
      '历史熟练度最高经验、探索与居所记录、成功筑基方式、成就',
      '轮回积累、开局能力与曾入世气运的指定资格',
      '自动补给偏好；新世不继承旧冷却或旧活动',
    ],
    reset: [
      '境界、修为、储备、本世根基及先天气运组合',
      '灵石、材料、丹药、装备及服丹属性',
      '功法修习、本世门类经验及其直接加成，洞府与改造回到基础',
      '区域与挑战进度、制作计数、本世统计、战斗与护盾',
    ],
    losses: {
      stones: state.stones, itemStacks: Object.values(state.inventory).filter((count) => BigInt(count) > 0n).length,
      equipmentCount: state.equipment.length,
    },
  };
}

export function settleReincarnation(content: Content, state: GameState, lifeId: string) {
  if (lifeId !== state.lifeId) throw new RuleError('本世标识已失效，请刷新后重试');
  const view = reincarnationView(content, state);
  if (!view.unlocked) throw new RuleError('须先实际成功筑基一次才能开放轮回');
  if (!view.ready) throw new RuleError(`须正式入世并达到${content.realms[view.minimumLevel].name}才能轮回`);
  if (integerAdd(state.lifeId, 1).length > 100) throw new RuleError('世次超出支持范围');
  recordLifeHistory(content, state);
  const record: ReincarnationRecord = {
    lifeId: state.lifeId, at: state.clockMs, level: state.level, foundationMethodId: state.foundation.methodId,
    realmPoints: view.reward.realmPoints, explorationPoints: view.reward.explorationPoints, points: view.reward.total,
    explorationNodes: view.nodes.filter((node) => node.completed).map((node) => node.id),
  };
  state.history.reincarnation = {
    points: view.pointsAfter, count: integerAdd(view.count, 1), lastSettlement: record,
  };
  state.history.openingTier = view.openingTierAfter;
  return record;
}
