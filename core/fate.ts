import type { Content, Fate, FateEffect, Modifier } from './content';
import type { GameState } from './types';
import type { FateView, GameView, WeaponType } from '../shared/contracts';
import { RuleError } from './errors';
import { dec, maximum, minimum, random, text } from './numbers';
import { describeEffect, describeModifier, getPresentation } from './presentation';

type ExperienceTarget = Extract<FateEffect, { kind: 'experience' }>['target'];

export function fateEffects(content: Content, state: GameState): FateEffect[] {
  return state.phase === 'active'
    ? content.fates.filter((fate) => state.innateFates.includes(fate.id)).flatMap((fate) => fate.effects) : [];
}

export function experienceBonus(content: Content, state: GameState, target: ExperienceTarget) {
  return fateEffects(content, state).reduce((sum, effect) =>
    effect.kind === 'experience' && effect.target === target ? sum.plus(effect.value) : sum, dec(0)).toFixed();
}

export function fateModifiers(content: Content, state: GameState, weapon: WeaponType | undefined): Modifier[] {
  return fateEffects(content, state).flatMap((effect) => effect.kind === 'stat' &&
    (!effect.when || (effect.when === 'sword' ? weapon === 'sword' : !weapon || weapon === 'gauntlet'))
    ? [effect.modifier] : []);
}

export function luckBonus(content: Content, state: GameState) {
  return fateEffects(content, state).reduce((sum, effect) =>
    effect.kind === 'luck' ? sum.plus(effect.value) : sum, dec(0)).toFixed();
}

export function effectiveDrop(
  content: Content, state: GameState,
  drop: { chance: number; luckExcludedReason?: string; itemId?: string },
) {
  const randomDrop = drop.chance > 0 && drop.chance < 1;
  const luckEligible = randomDrop && !drop.luckExcludedReason;
  let bonus = dec(luckEligible ? luckBonus(content, state) : '0');
  if (randomDrop) {
    for (const effect of fateEffects(content, state)) {
      if (effect.kind === 'item-drop' && drop.itemId && effect.itemIds.includes(drop.itemId)) bonus = bonus.plus(effect.value);
    }
  }
  return {
    baseChance: text(drop.chance),
    effectiveChance: minimum(1, dec(drop.chance).mul(bonus.plus(1))),
    luckEligible,
    ...(!luckEligible ? {
      luckExcludedReason: drop.chance === 1 ? '保证掉落，不增加份数'
        : drop.chance === 0 ? '未开放的掉落' : drop.luckExcludedReason,
    } : {}),
  };
}

export function effectiveManaCost(content: Content, state: GameState, base: string) {
  const bonus = fateEffects(content, state).reduce((sum, effect) =>
    effect.kind === 'mana-cost' ? sum.plus(effect.value) : sum, dec(0));
  // Ordinary cost reductions never grant free casts; spell surge is a separate ability.
  return text(dec(base).mul(maximum('0.1', bonus.plus(1))));
}

export function effectiveBuyPrice(content: Content, state: GameState, item: Content['items'][number]) {
  if (!item.buyPrice) return undefined;
  const discount = fateEffects(content, state).reduce((sum, effect) =>
    effect.kind === 'purchase-discount' && effect.itemIds.includes(item.id) ? sum.plus(effect.value) : sum, dec(0));
  return maximum(maximum(1, item.sellPrice ?? '0'),
    dec(item.buyPrice).mul(dec(1).minus(minimum(1, discount))).ceil());
}

export function productionSuccessBonus(content: Content, state: GameState, target: 'alchemy' | 'forging') {
  return fateEffects(content, state).reduce((sum, effect) =>
    effect.kind === 'production-success' && effect.target === target ? sum.plus(effect.value) : sum, dec(0)).toFixed();
}

export function openingLimits(content: Content, state: GameState) {
  return content.openingTiers[state.history.openingTier];
}

export function canDesignate(state: GameState, fate: Fate) {
  return state.history.enteredFates.includes(fate.id) || fate.designatable === true;
}

export function assertFateState(content: Content, state: GameState) {
  const ids = new Set(content.fates.map((fate) => fate.id));
  const validIds = (value: unknown): value is string[] => Array.isArray(value) &&
    new Set(value).size === value.length && value.every((id) => typeof id === 'string' && ids.has(id));
  if (typeof state.lifeId !== 'string' || !/^[1-9]\d*$/.test(state.lifeId) || state.lifeId.length > 100 ||
      !state.history || !Number.isInteger(state.history.openingTier) ||
      !content.openingTiers[state.history.openingTier] || !validIds(state.history.enteredFates) ||
      !validIds(state.innateFates)) throw new Error('本世或气运历史状态缺失或非法，不补全旧档');
  const limits = openingLimits(content, state);
  if (state.phase === 'active') {
    if (state.opening !== null || state.innateFates.length !== limits.slots ||
        state.innateFates.some((id) => !state.history.enteredFates.includes(id))) throw new Error('入世气运状态非法');
  } else if (state.phase === 'preparing') {
    const opening = state.opening;
    if (state.innateFates.length || !opening || !validIds(opening.candidates) ||
        opening.candidates.length > limits.candidates || !Array.isArray(opening.selected) ||
        opening.selected.length !== limits.slots ||
        opening.selected.some((id) => id !== null && (typeof id !== 'string' || !ids.has(id))) ||
        !validIds(opening.selected.filter((id) => id !== null)) ||
        !Number.isInteger(opening.drawsUsed) || opening.drawsUsed < 1 || opening.drawsUsed > limits.draws ||
        !Number.isInteger(opening.designationsUsed) || opening.designationsUsed < 0 || opening.designationsUsed > limits.designations ||
        state.activity.kind !== 'idle' || state.battle !== null || state.stones !== '0' ||
        Object.keys(state.inventory).length || state.equipment.length ||
        state.level !== 0 || state.cultivation !== '0' || state.reserve !== '0') {
      throw new Error('开局准备状态缺失或非法');
    }
  } else throw new Error('本世阶段缺失或非法');
}

export function needOpening(state: GameState, lifeId: string) {
  if (lifeId !== state.lifeId) throw new RuleError('本世标识已失效，请刷新后重试');
  if (state.phase !== 'preparing' || !state.opening) throw new RuleError('已经入世，先天气运不能再次调整或领取');
  return state.opening;
}

export function drawFates(content: Content, state: GameState) {
  const opening = state.opening!;
  const limits = openingLimits(content, state);
  if (opening.drawsUsed >= limits.draws) throw new RuleError('本世抽取次数已用完');
  const pool = content.fates.filter((fate) => !opening.selected.includes(fate.id));
  opening.candidates = [];
  while (opening.candidates.length < limits.candidates && pool.length) {
    let roll = random(state) * pool.reduce((sum, fate) => sum + fate.weight, 0);
    const index = pool.findIndex((fate) => { roll -= fate.weight; return roll < 0; });
    opening.candidates.push(pool.splice(index, 1)[0].id);
  }
  opening.drawsUsed++;
}

export function selectFate(content: Content, state: GameState, slot: number, fateId: string | null, designated = false) {
  const opening = state.opening!;
  const limits = openingLimits(content, state);
  if (!Number.isInteger(slot) || slot < 0 || slot >= limits.slots) throw new RuleError('气运槽位无效');
  if (fateId === null && !designated) { opening.selected[slot] = null; return; }
  const fate = content.fates.find((fate) => fate.id === fateId);
  if (!fate) throw new RuleError('气运不存在');
  if (!designated && opening.selected[slot] === fateId) return;
  if (opening.selected.includes(fate.id)) throw new RuleError('同一气运不可重复选择');
  if (designated) {
    if (opening.designationsUsed >= limits.designations) throw new RuleError('本世没有剩余指定次数');
    if (!canDesignate(state, fate)) throw new RuleError('尚未取得该气运的指定资格');
    opening.designationsUsed++;
  } else if (!opening.candidates.includes(fate.id)) {
    throw new RuleError('只能选择当前批次候选，旧批未选项不可取回');
  }
  opening.selected[slot] = fate.id;
}

export function confirmFates(state: GameState) {
  const selected = state.opening!.selected;
  if (selected.some((id) => id === null)) throw new RuleError('须填满先天气运槽位才能入世');
  state.innateFates = selected as string[];
  state.history.enteredFates = [...new Set([...state.history.enteredFates, ...state.innateFates])];
  state.phase = 'active';
  state.opening = null;
}

export function fateView(content: Content, fate: Fate): FateView {
  const percent = (value: string) => dec(value).mul(100).toFixed();
  const targetNames: Record<ExperienceTarget, string> = {
    technique: '功法修习经验', meditation: '打坐修为', 'combat-cultivation': '普通历练战斗修为',
    sword: '剑道经验', body: '体术经验', spell: '道法经验', alchemy: '丹道经验', forging: '炼器经验',
  };
  const itemNames = (ids: string[]) => ids.map((id) => content.items.find((item) => item.id === id)!.name).join('、');
  return {
    id: fate.id, name: fate.name, rarity: fate.rarity, ...getPresentation('fates', fate),
    effects: fate.effects.map((effect) => {
      switch (effect.kind) {
        case 'stat': return `${effect.when === 'sword' ? '持剑时：' : effect.when === 'body' ? '空手或持拳套时：' : ''}${describeModifier(effect.modifier)}`;
        case 'experience': return `${targetNames[effect.target]} +${percent(effect.value)}%`;
        case 'production-success': return `${effect.target === 'alchemy' ? '炼丹' : '炼器'}成功率 +${percent(effect.value)} 个百分点，最高 100%`;
        case 'mana-cost': return `正耗灵行动消耗 ${dec(effect.value).gte(0) ? '+' : ''}${percent(effect.value)}%，与其它增减合并，至少保留原消耗的 10%；零消耗不变`;
        case 'luck': return `幸运 +${percent(effect.value)}%：适用随机物品掉率相对提高，最高 100%，不增加数量`;
        case 'item-drop': return `${itemNames(effect.itemIds)}随机掉率相对 +${percent(effect.value)}%，与幸运相加，最高 100%`;
        case 'purchase-discount': return `${itemNames(effect.itemIds)}购买价 -${percent(effect.value)}%，单价向上取整且不低于 1 灵石或回收价`;
        case 'gift-stones': return `正式入世时一次获得 ${effect.amount} 灵石`;
        case 'combat': return describeEffect(effect.effect);
      }
    }),
  };
}

export function lifeView(content: Content, state: GameState): GameView['life'] {
  const view = (id: string) => fateView(content, content.fates.find((fate) => fate.id === id)!);
  const limits = openingLimits(content, state);
  return {
    id: state.lifeId, phase: state.phase, luckBonus: luckBonus(content, state),
    innateFates: state.innateFates.map(view),
    opening: state.opening ? {
      slots: limits.slots, candidatesPerDraw: limits.candidates,
      drawsRemaining: limits.draws - state.opening.drawsUsed,
      designationsRemaining: limits.designations - state.opening.designationsUsed,
      selected: state.opening.selected.map((id) => id === null ? null : view(id)),
      candidates: state.opening.candidates.map(view),
      designatable: content.fates.filter((fate) => canDesignate(state, fate)).map((fate) => view(fate.id)),
      ready: state.opening.selected.every((id) => id !== null),
    } : null,
  };
}
