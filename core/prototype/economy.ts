import { dec, integerAdd, random, text } from '../numbers';
import { worldCalendarAt } from './calendar';
import {
  addInstance, addStack, awardItem, cleared, gainCharacterExperience, gainCharacterSkill, record, synchronizeCharacter, type CharacterState, type ShopState,
} from './character-state';
import { CharacterCommandError, commandEntry } from './command-error';
import { ARMOR_ASSEMBLIES, ASSEMBLIES, FOOD_EFFECTS, ITEMS, RECIPES, SHOPS, foodEffectSource, lookup, type RecipeDefinition, type ShopId } from './content';
import { activeSources, effectDuration, probability } from './effects';
import { assemblyQuality, componentQuality, itemValue, roundPrice, type ItemInstance } from './equipment';
import { FURNACES, type FurnaceTier } from './furnace';
import { effectiveRealm, FOUNDATION_LEVEL, realmAt } from './growth';
import { incrementRecord, recordCraft } from './history';
import { describeLogGain } from './log';
import { insightExperienceMultiplier } from './skills';
import { applyTimedEffect, getPlayerStats } from './simulation';

function requireWorkshop(state: CharacterState) {
  if (state.simulation.mode !== 'rest' && state.simulation.mode !== 'idle') {
    throw new CharacterCommandError('请先退出战斗');
  }
  return { ...FURNACES[state.furnaceTier], tier: state.furnaceTier };
}
function requireShop(state: CharacterState, shopId: ShopId) {
  const shop = commandEntry(SHOPS, shopId, '没有这家商铺');
  if (state.locationId !== shop.locationId) throw new CharacterCommandError(`请先前往${shop.name}所在地点`);
  if (shop.prerequisite && !cleared(state, shop.prerequisite)) throw new CharacterCommandError('商铺尚未开放');
  if (shopId === 'jiyuan-supplies' && !state.jiyuanMerchantFound) throw new CharacterCommandError('尚未发现霁原墟商');
  return shop;
}

export function refiningChance(difficulty: number, level: number, workshopTier = 0): string {
  return text(dec('.85').pow(Math.max(difficulty - level - workshopTier, 0)));
}

export function craftingRates(state: CharacterState, recipe: RecipeDefinition) {
  const sources = activeSources(state.simulation);
  return recipe.path === 'ordinary' ? {
    successChance: probability(refiningChance(recipe.difficulty, state.skills.refining.level, state.furnaceTier),
      'craft.success', sources, ['refining', 'ordinary']),
    extraBatchChance: probability('0', 'craft.extra-batch', sources, ['refining', 'ordinary']),
  } : { successChance: '1', extraBatchChance: '0' };
}

export function foodDuration(state: CharacterState, effectId: string, itemId?: string): number {
  const effect = lookup(FOOD_EFFECTS, effectId);
  return effectDuration((itemId ? ITEMS[itemId].foodOverride?.durationMs : undefined) ?? effect.durationMs,
    activeSources(state.simulation), ['supply', effect.polarity]);
}

export function upgradeFurnace(state: CharacterState, targetTier: FurnaceTier) {
  const upgrade = requireWorkshop(state).upgrade;
  if (!upgrade || upgrade.tier !== targetTier) throw new CharacterCommandError('此炉阶不是当前可升级的目标');
  for (const [itemId, count] of Object.entries(upgrade.materials)) {
    if (BigInt(state.inventory[itemId] ?? '0') < BigInt(count)) throw new CharacterCommandError('升鼎材料不足');
  }
  for (const [itemId, count] of Object.entries(upgrade.materials)) addStack(state.inventory, itemId, -count);
  state.furnaceTier = upgrade.tier;
  record(state, `炉鼎升至${upgrade.tier}阶：${FURNACES[upgrade.tier].name}`);
}

export function itemUseIssue(state: CharacterState, itemId: string): string | null {
  const item = commandEntry(ITEMS, itemId, '没有这个物品');
  if (item.kind !== 'food' && item.kind !== 'marrow' && item.kind !== 'insight' && item.kind !== 'foundation-pill' &&
      item.kind !== 'meditation-kit') return '此物品不能直接使用';
  if (item.kind === 'meditation-kit') {
    if (state.ruinMeditationOpened) return '墟纹静室已开放';
    if (!state.jiyuanIntroduced) return '须先到旧墟听取路线介绍';
    if (state.simulation.battle) return '请先退出战斗';
  }
  if (item.kind === 'foundation-pill') {
    if (state.level !== FOUNDATION_LEVEL - 1) return '筑基丹仅限炼气十二层使用';
    if (!dec(state.cultivation).eq(realmAt(FOUNDATION_LEVEL).entryCost)) return '须修满6000万修为才能服丹筑基';
  }
  if (item.kind === 'food' && item.foodEffects!.some(id =>
    dec(effectiveRealm(state.level)).gt(item.foodOverride?.maxRealm ?? lookup(FOOD_EFFECTS, id).maxRealm))) {
    return `当前境界已超出${item.name}适用上限`;
  }
  return null;
}

export function craft(state: CharacterState, recipeId: string, quantity: number) {
  const workshop = requireWorkshop(state);
  const recipe = commandEntry(RECIPES, recipeId, '没有这个配方');
  if (recipe.output === 'ruin-meditation-kit' &&
      (quantity !== 1 || state.ruinMeditationOpened || BigInt(state.inventory[recipe.output] ?? '0') > 0n)) {
    throw new CharacterCommandError('静修套件仅需取得一次，购买与自制择一');
  }
  for (const [id, count] of Object.entries(recipe.materials)) {
    if (BigInt(state.inventory[id] ?? '0') < BigInt(count) * BigInt(quantity)) throw new CharacterCommandError('整批炼制材料不足');
  }
  let successes = 0;
  let bonusOutput = 0;
  for (let index = 0; index < quantity; index++) {
    for (const [id, count] of Object.entries(recipe.materials)) addStack(state.inventory, id, -count);
    const level = state.skills.refining.level;
    let produced = 0;
    let bonusProduced = 0;
    let quality: number | undefined;
    let xp;
    if (recipe.path === 'ordinary') {
      const rates = craftingRates(state, recipe);
      const chance = dec(rates.successChance);
      const success = dec(random(state.simulation)).lt(chance);
      if (success) {
        produced = recipe.outputCount ?? 1;
        if (dec(rates.extraBatchChance).gt(0) && dec(random(state.simulation)).lt(rates.extraBatchChance)) {
          bonusProduced = produced;
          produced += bonusProduced;
        }
        if (['equipment', 'part'].includes(ITEMS[recipe.output].kind)) {
          quality = recipe.outputQuality ?? 100;
          for (let item = 0; item < produced; item++) addInstance(state, state.instances, recipe.output, quality);
        } else awardItem(state, recipe.output, produced);
        successes++;
      }
      xp = dec('1.2').pow(recipe.difficulty);
      if (xp.lt(2)) xp = dec(2);
      if (!success) xp = xp.div(2);
    } else {
      const item = lookup(ITEMS, recipe.output);
      quality = componentQuality(state.simulation, level, item.tier!, workshop.tier);
      addInstance(state, state.instances, recipe.output, quality);
      produced = 1;
      successes++;
      xp = dec(4).mul(dec('1.2').pow(4 * item.tier!))
        .mul(Object.values(recipe.materials).reduce((sum, count) => sum + count, 0)).div(3);
    }
    recordCraft(state, `recipe:${recipeId}`, recipe.output, produced, quality, bonusProduced);
    bonusOutput += bonusProduced;
    if (gainCharacterSkill(state, 'refining', text(xp))) synchronizeCharacter(state);
  }
  record(state, `${recipe.name}：完成 ${successes}/${quantity}${bonusOutput ? `，额外产出${ITEMS[recipe.output].name}×${bonusOutput}` : ''}`);
}

export function assemble(state: CharacterState, bladeId: string, hiltId: string) {
  requireWorkshop(state);
  const blade = commandEntry(state.instances, bladeId, '所选主材已不在行囊中');
  const hilt = commandEntry(state.instances, hiltId, '所选辅料已不在行囊中');
  const recipe = ASSEMBLIES.find((entry) => entry.blade === blade.itemId && entry.hilt === hilt.itemId);
  if (bladeId === hiltId || !recipe) throw new CharacterCommandError('炼器需一份精炼主材与一份淬炼辅料');
  finishAssembly(state, bladeId, hiltId, recipe.output, 'assemble');
}

export function assembleArmor(state: CharacterState, interiorId: string, exteriorId: string) {
  requireWorkshop(state);
  const interior = commandEntry(state.instances, interiorId, '待升炼防具已不在行囊中');
  const exterior = commandEntry(state.instances, exteriorId, '所选升炼材料已不在行囊中');
  const recipe = ARMOR_ASSEMBLIES.find(entry => entry.interior === interior.itemId && entry.exterior === exterior.itemId);
  if (interiorId === exteriorId || !recipe) throw new CharacterCommandError('升炼需一件防具与对应部位的升炼材料');
  if (Object.values(state.equipment).includes(interiorId)) throw new CharacterCommandError('请先卸下待升炼的防具');
  finishAssembly(state, interiorId, exteriorId, recipe.output, 'upgrade');
}

function finishAssembly(state: CharacterState, firstId: string, secondId: string, output: string, source: 'assemble' | 'upgrade') {
  const first = state.instances[firstId];
  const second = state.instances[secondId];
  const quality = assemblyQuality(state.simulation, state.skills.refining.level, first, second);
  delete state.instances[firstId];
  delete state.instances[secondId];
  addInstance(state, state.instances, output, quality);
  recordCraft(state, `${source}:${output}`, output, 1, quality);
  const xp = text(dec(4).mul(dec('1.2').pow(4 * Math.max(ITEMS[first.itemId].tier!, ITEMS[second.itemId].tier!))));
  if (gainCharacterSkill(state, 'refining', xp)) synchronizeCharacter(state);
  record(state, `${ITEMS[output].interior ? '升炼' : '炼器'} ${ITEMS[output].name}，品质 ${quality}`);
}

export function refreshShop(state: CharacterState, shopId: ShopId, worldTimeMs: number): ShopState {
  const shop = requireShop(state, shopId);
  const dayIndex = worldCalendarAt(worldTimeMs).dayIndex;
  const previous = state[shop.stateKey];
  // A backwards clock correction must not produce another stock roll.
  if (previous?.dayIndex != null && previous.dayIndex >= dayIndex) return previous;
  const stock: ShopState = { dayIndex, inventory: {}, instances: {} };
  state[shop.stateKey] = stock;
  for (const entry of shop.stock) {
    if (random(state.simulation) >= entry.chance) continue;
    const quantity = Math.round(entry.min + random(state.simulation) * (entry.max - entry.min));
    if (entry.quality) {
      for (let i = 0; i < quantity; i++) {
        const quality = Math.round(entry.quality[0] + random(state.simulation) * (entry.quality[1] - entry.quality[0]));
        addInstance(state, stock.instances, entry.itemId, quality);
      }
    } else addStack(stock.inventory, entry.itemId, quantity);
  }
  return stock;
}

export function purchasePrice(state: CharacterState, shopId: ShopId, itemId: string, quality?: number): string {
  const margin = dec(SHOPS[shopId].margin).mul(dec('.98').pow(state.skills.trade.level));
  const override = SHOPS[shopId].priceOverrides?.[itemId];
  const base = override ? dec(override).div(SHOPS[shopId].margin) : dec(itemValue(itemId, quality));
  return roundPrice(text(base.mul(margin.lt('1.1') ? '1.1' : margin)));
}

export type TradeSelection = { kind: 'stack'; itemId: string } | { kind: 'instance'; instanceId: string };
export function sellInstances(state: CharacterState, shopId: ShopId, instanceIds: readonly string[], worldTimeMs: number) {
  requireShop(state, shopId);
  if (new Set(instanceIds).size !== instanceIds.length) throw new CharacterCommandError('不能重复选择同一件器物');
  for (const instanceId of instanceIds) {
    commandEntry(state.instances, instanceId, '所选器物已不在行囊中，请重新选择');
    if (Object.values(state.equipment).includes(instanceId)) throw new CharacterCommandError('请先卸下所选装备');
  }
  for (const instanceId of instanceIds) {
    trade(state, shopId, 'sell', { kind: 'instance', instanceId }, 1, worldTimeMs);
  }
}

export function trade(
  state: CharacterState, shopId: ShopId, side: 'buy' | 'sell', target: TradeSelection, quantity: number, worldTimeMs: number,
) {
  const shop = refreshShop(state, shopId, worldTimeMs);
  const from = side === 'buy' ? shop : state;
  const to = side === 'buy' ? state : shop;
  let itemId: string;
  let instance: ItemInstance | undefined;
  if (target.kind === 'instance') {
    if (quantity !== 1) throw new CharacterCommandError('每件装备须独立交易');
    instance = commandEntry(from.instances, target.instanceId, '此物品已不在当前库存中，请重新查看货摊');
    if (side === 'sell' && Object.values(state.equipment).includes(target.instanceId)) throw new CharacterCommandError('请先卸下装备');
    itemId = instance.itemId;
  } else {
    itemId = target.itemId;
    const item = commandEntry(ITEMS, itemId, '没有这个物品');
    if (item.kind === 'equipment' || item.kind === 'part') throw new CharacterCommandError('器物须逐件交易');
    if (BigInt(from.inventory[itemId] ?? '0') < BigInt(quantity)) throw new CharacterCommandError('库存不足');
  }
  const unitPrice = side === 'buy' ? purchasePrice(state, shopId, itemId, instance?.quality) : itemValue(itemId, instance?.quality);
  if (side === 'buy' && itemId === 'ruin-meditation-kit' &&
      (quantity !== 1 || state.ruinMeditationOpened || BigInt(state.inventory[itemId] ?? '0') > 0n)) {
    throw new CharacterCommandError('静修套件仅需取得一次，购买与自制择一');
  }
  const cost = text(dec(unitPrice).mul(quantity));
  if (side === 'buy' && dec(state.money).lt(cost)) throw new CharacterCommandError('灵石不足');
  if (target.kind === 'instance') {
    to.instances[target.instanceId] = instance!;
    delete from.instances[target.instanceId];
  } else {
    addStack(from.inventory, itemId, -quantity);
    addStack(to.inventory, itemId, quantity);
  }
  state.money = integerAdd(state.money, side === 'buy' ? `-${cost}` : cost);
  const counter = side === 'buy' ? 'purchaseSpent' : 'saleEarned';
  state.history[counter] = integerAdd(state.history[counter], cost);
  if (side === 'buy' && gainCharacterSkill(state, 'trade', text(dec(cost).div(5)))) synchronizeCharacter(state);
  record(state, `${SHOPS[shopId].name}：${side === 'buy' ? '购入' : '售出'} ${ITEMS[itemId].name} ×${quantity}，${cost}灵石`);
}

export function useItem(state: CharacterState, itemId: string, quantity: number) {
  const issue = itemUseIssue(state, itemId);
  if (issue) throw new CharacterCommandError(issue);
  const item = ITEMS[itemId];
  if ((item.kind === 'foundation-pill' || item.kind === 'meditation-kit') && quantity !== 1) {
    throw new CharacterCommandError('此物品每次只能使用一份');
  }
  if (BigInt(state.inventory[itemId] ?? '0') < BigInt(quantity)) throw new CharacterCommandError('物品不足');
  const marrowBefore = { ...state.marrow };
  let cultivationGained = dec(0);
  let cultivationOverflow = false;
  for (let index = 0; index < quantity; index++) {
    addStack(state.inventory, itemId, -1);
    if (item.kind === 'food') {
      for (const id of item.foodEffects!) {
        state.simulation = applyTimedEffect(state.simulation, {
          id, durationMs: item.foodOverride?.durationMs ?? lookup(FOOD_EFFECTS, id).durationMs, source: foodEffectSource(id),
        }).state;
      }
    } else if (item.kind === 'meditation-kit') {
      state.ruinMeditationOpened = true;
      state.meditationTier = state.meditationTier === 120 ? 120 : 40;
      record(state, `墟纹静室已开放，养息基础熟练为${state.meditationTier}/秒`);
    } else if (item.kind === 'insight') {
      const result = gainCharacterExperience(state, item.experience!.amount, undefined, true, ['fixed'], itemId === 'huashen-crystal');
      cultivationGained = cultivationGained.plus(result.credited);
      cultivationOverflow ||= dec(result.earned).gt(result.credited);
      if (result.changed) synchronizeCharacter(state);
      if (result.fullHeal) state.simulation.player.hp = getPlayerStats(state.simulation).maxHp;
    } else if (item.kind === 'foundation-pill') {
      const result = gainCharacterExperience(state, '0', item.foundationRoot!);
      synchronizeCharacter(state);
      if (result.fullHeal) state.simulation.player.hp = getPlayerStats(state.simulation).maxHp;
    } else {
      const keys = ['attack', 'defense', 'agility', 'maxHp'] as const;
      const q = item.marrowValue!;
      const healthFactor = q > 7500 ? 100 : 50;
      const ratios = keys.map((key) => dec(state.marrow[key]).div(q * (key === 'maxHp' ? healthFactor : 1) * 30));
      const weights = ratios.map((ratio) => ratio.mul(30).plus(1).pow('-1.5').mul(ratio.gte(1) ? '.5' : 1));
      let roll = dec(random(state.simulation)).mul(weights.reduce((sum, weight) => sum.plus(weight), dec(0)));
      let selected = 3;
      for (let slot = 0; slot < keys.length; slot++) {
        if (roll.lt(weights[slot])) { selected = slot; break; }
        roll = roll.minus(weights[slot]);
      }
      const key = keys[selected];
      const ratio = ratios[selected];
      const gain = dec(q * (key === 'maxHp' ? healthFactor : 1)).mul(ratio.lt(1)
        ? 1 : ratio.plus(1).minus(ratio.sqrt().mul(2)).mul(-5).exp());
      state.marrow[key] = text(dec(state.marrow[key]).plus(gain));
      synchronizeCharacter(state);
    }
  }
  incrementRecord(state.history.used, itemId, quantity);
  const gains = item.kind === 'marrow'
    ? (['attack', 'defense', 'agility', 'maxHp'] as const).flatMap(key => {
      const gain = dec(state.marrow[key]).minus(marrowBefore[key]);
      return gain.gt(0) ? [describeLogGain({ attack: '攻击', defense: '防御', agility: '敏捷', maxHp: '气血上限' }[key], gain.toFixed())] : [];
    }).join('、')
    : item.kind === 'insight' ? `${describeLogGain('修为', cultivationGained.toFixed())}${cultivationOverflow ? '（封顶溢出未计入）' : ''}` : '';
  record(state, `使用 ${item.name} ×${quantity}${gains ? `，${item.kind === 'marrow' ? '灵髓积蕴：' : ''}${gains}` : ''}`);
}

export function marrowAbsorptionPreview(state: CharacterState) {
  const materials = Object.entries(state.inventory).flatMap(([itemId, quantity]) => {
    const item = ITEMS[itemId];
    return item.kind === 'marrow' ? [{ itemId, name: item.name, quantity, value: item.marrowValue! }] : [];
  });
  const gained = materials.reduce((sum, item) => sum.plus(dec(item.value).pow(2).mul(item.quantity).div(10000)), dec(0));
  const current = state.marrowInsight ?? '0';
  const next = text(dec(current).plus(gained));
  return {
    unlocked: state.level >= FOUNDATION_LEVEL, materials, points: current, gained: text(gained),
    currentMultiplier: insightExperienceMultiplier(current), nextMultiplier: insightExperienceMultiplier(next),
  };
}

export function absorbMarrow(state: CharacterState) {
  const preview = marrowAbsorptionPreview(state);
  if (!preview.unlocked) throw new CharacterCommandError('筑基后才能将灵髓化悟');
  if (!preview.materials.length) throw new CharacterCommandError('行囊中没有灵髓');
  for (const item of preview.materials) {
    addStack(state.inventory, item.itemId, `-${item.quantity}`);
    incrementRecord(state.history.absorbedMarrow, item.itemId, item.quantity);
  }
  state.marrowInsight = text(dec(preview.points).plus(preview.gained));
  record(state, `灵髓化悟，化悟值+${preview.gained}，技能经验倍率×${dec(preview.nextMultiplier).toDecimalPlaces(3)}`);
}
