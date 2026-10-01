import {
  content as defaultContent, equipmentQualitySnapshotSchema, indexById, loadContent,
  type Content, type Effect, type Modifier, type Unlock, type GrowthStat, type Action, type ProficiencyAbility,
} from './content';
import { applyDamage, directDamage, hitChance, restore, triggerEffects } from './combat';
import { RuleError } from './errors';
import { add, dec, floorTime, integerAdd, maximum, minimum, quantity, random, sub, text } from './numbers';
import {
  describeAction as describeActionView, describeEffect, describeModifier, displayMessage,
  getPresentation, presentation, toActionView, toStatView,
} from './presentation';
import type { Combatant, EquipmentInstance, GameCommand, GameState, GameView, Stats } from './types';
import { EQUIPMENT_SLOTS, PROFICIENCY_IDS, WEAPON_TYPE_LABELS, type ProficiencyId } from '../shared/contracts';
import {
  combatProficiencyXp, forgingQualityProbabilities, forgingQualityRolls, forgingQualityWeights,
  proficiencyCap, proficiencyProgress, proficiencyRewards, proficiencyTrainingGain, productionTerms,
} from './proficiency';
import {
  assertFateState, confirmFates, drawFates, effectiveBuyPrice, effectiveDrop, effectiveManaCost,
  experienceBonus, fateEffects, fateModifiers, lifeView, needOpening, productionSuccessBonus, selectFate,
} from './fate';
import { assertFoundationState, attemptFoundation, foundationModifiers, foundationView } from './foundation';
import { assertReincarnationState, recordLifeHistory, reincarnationView, settleReincarnation } from './reincarnation';

export function createRules(raw: unknown = defaultContent) {
  const content = loadContent(raw);
  const settings = content.settings;
  const items = indexById(content.items);
  const equipment = indexById(content.equipment);
  const affixes = indexById(content.affixes);
  const effects = indexById(content.effects);
  const enemyEffectCatalog = content.enemyEffects ? indexById(content.enemyEffects) : effects;
  const techniques = indexById(content.techniques);
  const challenges = indexById(content.challenges);
  const enemies = indexById([...content.enemies, ...content.challenges.map((challenge) => challenge.enemy)]);
  const actions = indexById(content.actions);
  const regions = indexById(content.regions);
  const recipes = indexById(content.recipes);
  const proficiencies = indexById(content.proficiencies);
  const growthFields = {
    attack: 'pillAttack', magicAttack: 'pillMagicAttack',
    defense: 'pillDefense', magicDefense: 'pillMagicDefense', maxHp: 'pillMaxHp',
  } as const;
  const growthNames = { attack: '物攻', magicAttack: '法攻', defense: '物防', magicDefense: '法防', maxHp: '气血上限' };

  function assertState(state: GameState) {
    if (state.schemaVersion !== content.schemaVersion || state.contentVersion !== content.version ||
        state.rulesVersion !== content.rulesVersion) throw new Error('存档版本不兼容，本规则不转换旧存档');
    if (floorTime(state.clockMs) !== state.clockMs) throw new Error('存档时钟未对齐整秒');
    if (!Number.isInteger(state.level) || state.level < 0 || state.level >= content.realms.length) throw new Error('境界状态非法');
    if (!Number.isInteger(state.rng) || state.rng < 1 || state.rng > 0xffffffff) throw new Error('随机状态非法');
    assertFateState(content, state);
    assertFoundationState(content, state);
    assertReincarnationState(content, state);
    if (!state.proficiencyXp || Object.keys(state.proficiencyXp).length !== PROFICIENCY_IDS.length ||
        PROFICIENCY_IDS.some((id) => {
          const xp = state.proficiencyXp[id];
          return typeof xp !== 'string' || xp.length > 1000 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(xp) ||
            dec(xp).gt(proficiencyCap(proficiencies[id]));
        })) throw new Error('熟练度状态缺失或非法，本规则不补全旧存档');
    if (!state.history?.proficiencyXp || Object.keys(state.history.proficiencyXp).length !== PROFICIENCY_IDS.length ||
        PROFICIENCY_IDS.some((id) => {
          const xp = state.history.proficiencyXp[id];
          return typeof xp !== 'string' || xp.length > 1000 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(xp) ||
            dec(xp).gt(proficiencyCap(proficiencies[id])) || dec(xp).lt(state.proficiencyXp[id]);
        }) || !Array.isArray(state.history.learnedRecipes) ||
        new Set(state.history.learnedRecipes).size !== state.history.learnedRecipes.length ||
        state.history.learnedRecipes.some((id) => recipes[id]?.alchemyLevel === undefined)) {
      throw new Error('跨世熟练记录或丹方知识缺失或非法');
    }
    const charges = state.proficiencyCombat;
    if (!charges || typeof charges.bodyWardUsed !== 'boolean' ||
        [charges.swordActions, charges.spellCasts].some((value) =>
          !Number.isInteger(value) || value < 0 || value > 100)) throw new Error('熟练度战斗状态缺失或非法');
    if (!state.crafting || Array.isArray(state.crafting) || typeof state.crafting !== 'object' ||
        Object.entries(state.crafting).some(([id, entry]) =>
          !recipes[id] || !entry || typeof entry.attempts !== 'string' || typeof entry.successes !== 'string' ||
          entry.attempts.length > 1000 || entry.successes.length > 1000 ||
          !/^(0|[1-9]\d*)$/.test(entry.attempts) || !/^(0|[1-9]\d*)$/.test(entry.successes) ||
          BigInt(entry.successes) > BigInt(entry.attempts))) {
      throw new Error('制作统计状态缺失或非法');
    }
    if (settings.manaSupply) {
      const supply = state.manaSupply;
      if (!supply || typeof supply.enabled !== 'boolean' || !Number.isFinite(supply.mpThreshold) ||
          supply.mpThreshold < 0 || supply.mpThreshold > 1 ||
          !Number.isSafeInteger(supply.readyAt) || supply.readyAt < 0) throw new Error('回灵补给状态缺失或非法');
    } else if (state.manaSupply !== undefined) throw new Error('本配置未开放回灵补给');
    for (const field of Object.values(growthFields)) {
      const value = state.player[field];
      if (typeof value !== 'string' || value.length > 1000 || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
        throw new Error('属性丹累计状态缺失或非法');
      }
    }
    for (const region of content.regions) {
      const completed = state.regionKills[region.id] ?? '0';
      if (region.clear && (typeof completed !== 'string' || !/^(0|[1-9]\d*)$/.test(completed))) throw new Error('区域累计波次非法');
    }
    if (!state.challengeWins || typeof state.challengeWins !== 'object' || Array.isArray(state.challengeWins) ||
        Object.entries(state.challengeWins).some(([id, wins]) => !challenges[id] ||
          typeof wins !== 'string' || wins.length > 1000 || !/^(0|[1-9]\d*)$/.test(wins))) throw new Error('挑战记录缺失或非法');
    if (state.activity.challengeId !== undefined) {
      const challenge = challenges[state.activity.challengeId];
      if (!challenge || (state.activity.kind === 'dungeon' &&
          (state.activity.targetId !== undefined || state.battle?.enemyId !== challenge.enemy.id ||
           state.level > challenge.maxLevel || !unlocked(state, challenge.unlock)))) throw new Error('挑战活动状态非法');
    } else if (state.activity.kind === 'dungeon' &&
        !regions[state.activity.targetId!]?.enemies.includes(state.battle?.enemyId ?? '')) {
      throw new Error('秘境遭遇状态非法');
    }
    if (content.enemyEffects) {
      const pending = state.pendingEncounters;
      if (!pending || typeof pending !== 'object' || Array.isArray(pending) ||
          Object.entries(pending).some(([regionId, enemyId]) => !regions[regionId]?.enemies.includes(enemyId)) ||
          (state.battle && !state.activity.challengeId && pending[state.activity.targetId!] !== state.battle.enemyId)) {
        throw new Error('未完成遭遇状态缺失或非法，须显式迁移');
      }
    } else if (state.pendingEncounters !== undefined) throw new Error('旧版存档不能隐式携带保留遭遇');
    if (!state.loadout || 'equippedId' in state || Object.keys(state.loadout).length !== EQUIPMENT_SLOTS.length ||
        EQUIPMENT_SLOTS.some((slot) => {
          const id = state.loadout[slot];
          const instance = state.equipment.find((entry) => entry.instanceId === id);
          return id !== null && (!instance || equipment[instance.definitionId]?.slot !== slot);
        })) throw new Error('装配部位缺失或非法，本规则不转换旧存档');
    const equipped = Object.values(state.loadout).filter((id) => id !== null);
    if (new Set(equipped).size !== equipped.length ||
        new Set(state.equipment.map((entry) => entry.instanceId)).size !== state.equipment.length) {
      throw new Error('装备实例不可重复');
    }
    for (const instance of state.equipment) {
      if (!equipment[instance.definitionId]) throw new Error('装备定义不存在');
      if (content.equipmentQualities) {
        if (!equipment[instance.definitionId] || !equipmentQualitySnapshotSchema.safeParse(instance.quality).success ||
            !content.equipmentQualities.some((entry) => entry.id === instance.quality?.id)) {
          throw new Error('装备品质快照缺失或非法，须显式迁移');
        }
      } else if (instance.quality !== undefined) throw new Error('旧版存档不能隐式携带品质快照');
    }
    if (content.techniqueAcquisition) {
      const learned = state.learnedTechniques;
      if (!Array.isArray(learned) || new Set(learned).size !== learned.length ||
          learned.some((id) => !techniques[id]) || !learned.includes(settings.starterTechniqueId) ||
          !learned.includes(state.techniqueId) ||
          (state.activity.kind === 'practice' && !learned.includes(state.activity.targetId!))) {
        throw new Error('已学功法状态缺失或非法，须显式迁移');
      }
    } else if (state.learnedTechniques !== undefined) throw new Error('旧版存档不能隐式携带功法学习状态');
    if (content.dwelling) {
      const home = state.dwelling;
      if (!home || !Number.isInteger(home.tier) || home.tier < 0 || home.tier >= content.dwelling.tiers.length) {
        throw new Error('洞府存档缺失或品阶非法，须显式迁移');
      }
      for (const track of ['gathering', 'study'] as const) {
        const level = home[track];
        if (!Number.isInteger(level) || level < 0 || level > content.dwelling[track].length ||
            (level > 0 && content.dwelling[track][level - 1].requiredTier > home.tier)) throw new Error('洞府设施状态非法');
      }
      if (home.gathering < content.dwelling.tiers[home.tier].requiredGathering) throw new Error('洞府前置状态非法');
    } else if (state.dwelling !== undefined) throw new Error('旧版存档不能隐式携带洞府状态');
  }
  function log(state: GameState, kind: GameView['journal'][number]['kind'], message: string, category?: GameView['journal'][number]['category']) {
    state.journal.push({ at: state.clockMs, kind, text: message, ...(category ? { category } : {}) });
    if (state.journal.length > 40) state.journal.splice(0, state.journal.length - 40);
  }
  function unlocked(state: GameState, unlock: Unlock) {
    return 'level' in unlock ? state.level >= unlock.level
      : BigInt(state.regionKills[unlock.regionId] ?? '0') >= BigInt(unlock.kills);
  }
  function requirement(unlock: Unlock) {
    return 'level' in unlock ? content.realms[unlock.level].name
      : `${regions[unlock.regionId].name}累计击败 ${unlock.kills} 次`;
  }
  function needUnlocked(state: GameState, unlock: Unlock) {
    if (!unlocked(state, unlock)) throw new RuleError(`尚未开放：${requirement(unlock)}`);
  }
  function learned(state: GameState, techniqueId: string) {
    return !content.techniqueAcquisition || state.learnedTechniques!.includes(techniqueId);
  }
  function needTechnique(state: GameState, technique: Content['techniques'][number]) {
    needUnlocked(state, technique.unlock);
    if (!learned(state, technique.id)) throw new RuleError('尚未学会该功法，须先取得书册并学习');
  }
  function stop(state: GameState, reason: string) {
    state.activity = {
      ...state.activity, kind: 'idle', stoppedAt: state.clockMs, stopReason: reason,
    };
    state.battle = null;
    state.player.shield = '0';
    resetProficiencyCombat(state);
    log(state, 'stop', reason);
  }
  function outOfCombat(state: GameState) {
    if (state.activity.kind === 'dungeon') throw new RuleError('请先结束历练或挑战，脱战后操作');
  }
  function adjustItem(state: GameState, id: string, count: string | number | bigint) {
    const result = integerAdd(state.inventory[id] ?? '0', count);
    if (BigInt(result) < 0n) throw new RuleError(`${items[id]?.name ?? id}数量不足`);
    state.inventory[id] = result;
  }
  function pay(state: GameState, cost: bigint) {
    if (BigInt(state.stones) < cost) throw new RuleError('灵石不足');
    state.stones = integerAdd(state.stones, -cost);
  }
  function gainProficiency(state: GameState, id: ProficiencyId, amount: string) {
    const definition = proficiencies[id];
    const before = proficiencyProgress(definition, state.proficiencyXp[id]).level;
    state.proficiencyXp[id] = add(state.proficiencyXp[id], proficiencyTrainingGain(content, id,
      state.proficiencyXp[id], state.history.proficiencyXp[id], amount, experienceBonus(content, state, id)));
    state.history.proficiencyXp[id] = maximum(state.history.proficiencyXp[id], state.proficiencyXp[id]);
    const after = proficiencyProgress(definition, state.proficiencyXp[id]).level;
    if (after > before) log(state, 'progress', `${definition.name}提升至 ${after} 级`);
    if (id === 'alchemy') {
      for (const recipe of content.recipes) {
        if (recipe.alchemyLevel === undefined || recipe.alchemyLevel > after || state.history.learnedRecipes.includes(recipe.id)) continue;
        state.history.learnedRecipes.push(recipe.id);
        log(state, 'progress', `领悟${recipe.name}`);
      }
    }
  }
  function resetProficiencyCombat(state: GameState) {
    state.proficiencyCombat = { swordActions: 0, spellCasts: 0, bodyWardUsed: false };
  }
  function proficiencyAbility(state: GameState, id: ProficiencyId) {
    return proficiencyRewards(proficiencies[id], state.proficiencyXp[id]).ability;
  }
  function recipeMastered(state: GameState, recipe: Content['recipes'][number]) {
    return recipe.alchemyLevel === undefined || (state.history.learnedRecipes.includes(recipe.id) &&
      proficiencyProgress(proficiencies.alchemy, state.proficiencyXp.alchemy).level >= recipe.alchemyLevel);
  }
  function craftingTerms(state: GameState, recipe: Content['recipes'][number]) {
    const terms = productionTerms(content, state.proficiencyXp, recipe);
    const xp = proficiencyTrainingGain(content, terms.proficiencyId, state.proficiencyXp[terms.proficiencyId],
      state.history.proficiencyXp[terms.proficiencyId], terms.successXp, experienceBonus(content, state, terms.proficiencyId));
    return {
      ...terms, successXp: xp, failureXp: xp,
      successChance: minimum(1, dec(terms.successChance).plus(productionSuccessBonus(content, state, terms.proficiencyId))),
    };
  }
  function combatProficiencies(state: GameState, actionId: string): ProficiencyId[] {
    const weapon = state.equipment.find((entry) => entry.instanceId === state.loadout.weapon);
    const category = weapon ? equipment[weapon.definitionId].category : undefined;
    const ids: ProficiencyId[] = category === 'sword' ? ['sword']
      : category === 'gauntlet' || !weapon ? ['body'] : [];
    if (actions[actionId].damageType === 'magical') ids.push('spell');
    return ids;
  }
  function generateEquipment(state: GameState, definitionId: string, crafted = false): EquipmentInstance {
    const definition = equipment[definitionId];
    if (!definition) throw new Error('装备定义不存在');
    const instance: EquipmentInstance = {
      instanceId: `equipment-${state.nextInstance}`, definitionId,
      contentVersion: content.version, affixes: [],
    };
    const qualities = content.equipmentQualities;
    let quality: NonNullable<Content['equipmentQualities']>[number] | undefined;
    if (qualities) {
      const xp = crafted ? state.proficiencyXp.forging : '0';
      const weights = forgingQualityWeights(content, xp)!;
      const rolls = crafted ? forgingQualityRolls(content, xp) : 1;
      const total = weights.reduce((sum, weight) => sum.plus(weight), dec(0));
      let best = 0;
      for (let attempt = 0; attempt < rolls; attempt++) {
        let roll = dec(random(state)).mul(total);
        const index = weights.findIndex((weight) => {
          roll = roll.minus(weight);
          return roll.lt(0);
        });
        best = Math.max(best, index);
      }
      quality = qualities[best];
      // Persist the resulting base values, not a live multiplier into future content.
      instance.quality = {
        id: quality.id, name: quality.name, rarity: quality.rarity,
        modifiers: definition.modifiers.map((modifier) => ({
          ...modifier, value: text(dec(modifier.value).mul(
            modifier.stat === 'hpRegen' || modifier.stat === 'mpRegen' ? quality!.effectMultiplier : quality!.statMultiplier)),
        })),
        effects: definition.effects.map((id) => ({
          ...effects[id], amount: text(dec(effects[id].amount).mul(quality!.effectMultiplier)),
        })),
      };
    }
    state.nextInstance = integerAdd(state.nextInstance, 1);
    const pool = [...definition.affixPool];
    for (let i = 0; i < definition.affixCount; i++) {
      const [key] = pool.splice(Math.floor(random(state) * pool.length), 1);
      const affix = affixes[key];
      const low = Number(affix.min);
      const high = Number(affix.max);
      const multiplier = affix.kind === 'effect' || affix.stat === 'hpRegen' || affix.stat === 'mpRegen'
        ? quality?.effectMultiplier : quality?.statMultiplier;
      const value = text(dec(low + Math.floor(random(state) * (high - low + 1))).mul(multiplier ?? '1'));
      instance.affixes.push(affix.kind === 'stat'
        ? { definitionId: key, value, modifier: { stat: affix.stat, mode: affix.mode, value } }
        : { definitionId: key, value, effect: { ...effects[affix.effectId], amount: value } });
    }
    state.equipment.push(instance);
    return instance;
  }
  function playerEquipment(state: GameState) {
    return EQUIPMENT_SLOTS.flatMap((slot) => {
      const instance = state.equipment.find((entry) => entry.instanceId === state.loadout[slot]);
      return instance ? [instance] : [];
    });
  }
  function matchesTechniqueWeapon(state: GameState, technique: Content['techniques'][number]) {
    const instance = state.equipment.find((entry) => entry.instanceId === state.loadout.weapon);
    return Boolean(instance && technique.weaponType && equipment[instance.definitionId].category === technique.weaponType);
  }
  function activeWeaponMatch(state: GameState) {
    const technique = techniques[state.techniqueId];
    return matchesTechniqueWeapon(state, technique) ? technique.weaponMatch : undefined;
  }
  function baseEquipmentModifiers(instance: EquipmentInstance) {
    return instance.quality?.modifiers ?? equipment[instance.definitionId].modifiers;
  }
  function baseEquipmentEffects(instance: EquipmentInstance) {
    return instance.quality?.effects ?? equipment[instance.definitionId].effects.map((id) => effects[id]);
  }
  function playerEffects(state: GameState): Effect[] {
    const equipped = playerEquipment(state);
    return [
      ...fateEffects(content, state).flatMap((effect) => effect.kind === 'combat' ? [effect.effect] : []),
      ...techniques[state.techniqueId].effects.map((id) => effects[id]),
      ...(activeWeaponMatch(state)?.effects.map((id) => effects[id]) ?? []),
      ...equipped.flatMap((instance) => [
        ...baseEquipmentEffects(instance),
        ...instance.affixes.flatMap((affix) => affix.effect ? [affix.effect] : []),
      ]),
    ];
  }
  function getPlayerStats(state: GameState): Stats {
    const realm = content.realms[state.level];
    const result: Stats = {
      maxHp: add(realm.maxHp, state.player.pillMaxHp), maxMp: realm.maxMp,
      attack: add(realm.attack, state.player.pillAttack),
      magicAttack: add(realm.magicAttack, state.player.pillMagicAttack),
      defense: add(realm.defense, state.player.pillDefense),
      magicDefense: add(realm.magicDefense, state.player.pillMagicDefense),
      agility: realm.agility, ...content.baseStats,
    };
    const technique = techniques[state.techniqueId];
    const equipped = playerEquipment(state);
    const weapon = equipped.find((instance) => equipment[instance.definitionId].slot === 'weapon');
    const modifiers: Modifier[] = [
      ...foundationModifiers(content, state),
      ...fateModifiers(content, state, weapon ? equipment[weapon.definitionId].category : undefined),
      ...combatProficiencies(state, technique.actionId).flatMap((id) =>
        proficiencyRewards(proficiencies[id], state.proficiencyXp[id]).modifiers),
      ...technique.modifiers,
      ...(activeWeaponMatch(state)?.modifiers ?? []),
      ...technique.practiceBonuses.map((bonus): Modifier => ({
        stat: bonus.stat, mode: 'flat',
        value: text(dec(bonus.value).mul(minimum(dec(state.techniqueXp[technique.id] ?? '0').div(technique.xpCap), 1))),
      })),
      ...equipped.flatMap((instance) => [
        ...baseEquipmentModifiers(instance),
        ...instance.affixes.flatMap((affix) => affix.modifier ? [affix.modifier] : []),
      ]),
    ];
    for (const stat of ['maxHp', 'maxMp', 'attack', 'magicAttack', 'defense', 'magicDefense', 'agility', 'hpRegen', 'mpRegen'] as const) {
      // maxMp is already final here; base mpRegen is the minimum, not an extra flat bonus.
      let flat = dec(stat === 'mpRegen'
        ? maximum(content.baseStats.mpRegen, dec(result.maxMp).mul(settings.baseMpRegenFraction))
        : result[stat]);
      let percent = dec(0);
      for (const modifier of modifiers) {
        if (modifier.stat !== stat) continue;
        if (modifier.mode === 'flat') flat = flat.plus(modifier.value);
        else percent = percent.plus(modifier.value);
      }
      result[stat] = maximum(stat === 'maxHp' || stat === 'agility' ? 1 : 0, flat.mul(percent.plus(1)));
    }
    return result;
  }
  function practice(state: GameState, id: string, amount: string) {
    state.techniqueXp[id] = minimum(add(state.techniqueXp[id] ?? '0', amount), techniques[id].xpCap);
  }
  function getActivityRates(state: GameState) {
    const home = state.dwelling;
    const definition = content.dwelling;
    const tier = home && definition ? definition.tiers[home.tier] : undefined;
    const meditationBonus = add(add(tier?.meditationBonus ?? '0',
      home && definition && home.gathering ? definition.gathering[home.gathering - 1].bonus : '0'),
    experienceBonus(content, state, 'meditation'));
    const practiceBonus = add(add(tier?.practiceBonus ?? '0',
      home && definition && home.study ? definition.study[home.study - 1].bonus : '0'),
    experienceBonus(content, state, 'technique'));
    return {
      meditationBonus, practiceBonus,
      meditationPerSecond: text(dec(content.realms[state.level].meditation).mul(dec(meditationBonus).plus(1))),
      practicePerSecond: text(dec(settings.practicePerSecond).mul(dec(practiceBonus).plus(1))),
    };
  }
  function reserveEfficiency(state: GameState): number {
    if (state.level === 13 && dec(state.cultivation).gte(content.realms[13].required)) return 0;
    if (state.level !== 12 || dec(state.cultivation).lt(content.realms[12].required)) return 1;
    return Number(settings.reserveBands.find((band) => dec(state.reserve).lt(band.until))?.efficiency ?? 0);
  }
  function gainCultivation(state: GameState, amount: string) {
    let remaining = dec(amount);
    let accepted = dec(0);
    while (remaining.gt(0)) {
      const realm = content.realms[state.level];
      const room = dec(realm.required).minus(state.cultivation);
      const received = dec(minimum(remaining, room));
      state.cultivation = add(state.cultivation, received);
      remaining = remaining.minus(received);
      accepted = accepted.plus(received);
      if (dec(state.cultivation).lt(realm.required)) break;
      if (state.level < 12) {
        state.cultivation = '0';
        state.level++;
        log(state, 'progress', `修至${content.realms[state.level].name}`);
        continue;
      }
      if (state.level === 13) break;
      for (const band of settings.reserveBands) {
        const space = dec(band.until).minus(state.reserve);
        if (space.lte(0) || remaining.lte(0)) continue;
        const absorbed = dec(minimum(remaining.mul(band.efficiency), space));
        state.reserve = add(state.reserve, absorbed);
        remaining = remaining.minus(absorbed.div(band.efficiency));
        accepted = accepted.plus(absorbed);
      }
      break;
    }
    state.totals.cultivationGained = add(state.totals.cultivationGained, accepted);
  }
  function saturated(state: GameState) {
    return state.level === 12
      ? dec(state.cultivation).eq(content.realms[12].required) && dec(state.reserve).gte(settings.reserveCapacity)
      : state.level === 13 && dec(state.cultivation).gte(content.realms[13].required);
  }
  function spawn(state: GameState) {
    if (state.activity.challengeId) {
      startEncounter(state, challenges[state.activity.challengeId].enemy.id);
      return;
    }
    const region = regions[state.activity.targetId!];
    let enemyId = state.pendingEncounters?.[region.id];
    if (!enemyId && region.enemyWeights) {
      let roll = random(state) * region.enemies.reduce((sum, id) => sum + region.enemyWeights![id], 0);
      enemyId = region.enemies.find((id) => {
        roll -= region.enemyWeights![id];
        return roll < 0;
      })!;
    } else if (!enemyId) enemyId = region.enemies[Math.floor(random(state) * region.enemies.length)];
    if (state.pendingEncounters) state.pendingEncounters[region.id] = enemyId;
    startEncounter(state, enemyId);
  }
  function startEncounter(state: GameState, enemyId: string) {
    const enemy = enemies[enemyId];
    state.battle = {
      enemyId, hp: enemy.maxHp, mp: enemy.maxMp, shield: '0',
      nextActionMs: state.clockMs + enemy.attackIntervalMs,
      startedAt: state.clockMs, lastProgressMs: state.clockMs,
    };
    state.proficiencyCombat.bodyWardUsed = false;
    for (const id of enemy.effects) {
      const effect = enemyEffectCatalog[id];
      if (effect.trigger === 'encounter') {
        state.battle.shield = minimum(add(state.battle.shield, effect.amount), enemy.maxHp);
      }
    }
    maybeBodyWard(state, getPlayerStats(state));
  }
  function enemyCombatEffects(enemy: Content['enemies'][number]): Effect[] {
    return enemy.effects.map((id) => enemyEffectCatalog[id]).filter((effect) => effect.trigger !== 'encounter');
  }
  function defeatedEnemy(state: GameState, ownEffects: Effect[]) {
    const battle = state.battle!;
    const enemy = enemies[battle.enemyId];
    const challengeId = state.activity.challengeId;
    const regionId = state.activity.targetId!;
    if (state.pendingEncounters && !challengeId) delete state.pendingEncounters[regionId];
    triggerEffects('kill', ownEffects, state.player, getPlayerStats(state), battle, enemy);
    state.totals.kills = integerAdd(state.totals.kills, 1);
    if (challengeId) state.challengeWins[challengeId] = integerAdd(state.challengeWins[challengeId] ?? '0', 1);
    else state.regionKills[regionId] = integerAdd(state.regionKills[regionId] ?? '0', 1);
    state.stones = integerAdd(state.stones, enemy.stones);
    for (const drop of enemy.drops) {
      if (dec(random(state)).lt(effectiveDrop(content, state, drop).effectiveChance)) {
        adjustItem(state, drop.itemId, drop.quantity);
        log(state, 'gain', `获得${items[drop.itemId].name} ×${drop.quantity}`, 'loot');
      }
    }
    for (const drop of enemy.equipmentDrops) {
      if (dec(random(state)).lt(effectiveDrop(content, state, drop).effectiveChance)) generateEquipment(state, drop.equipmentId);
    }
    const region = challengeId ? undefined : regions[regionId];
    if (state.regionKills[regionId] === '1' && region?.firstClearEquipmentId) {
      const found = generateEquipment(state, region.firstClearEquipmentId);
      log(state, 'gain', `首胜获得${equipment[found.definitionId].name}`);
    }
    const cultivationMultiplier = dec(challengeId ? '0' : experienceBonus(content, state, 'combat-cultivation')).plus(1);
    const enemyCultivation = text(dec(enemy.cultivation).mul(cultivationMultiplier));
    gainCultivation(state, enemyCultivation);
    log(state, 'combat', `击败${enemy.name}，修为 +${enemyCultivation}（受瓶颈吸收影响），灵石 +${enemy.stones}`);
    if (challengeId) {
      stop(state, `挑战${challenges[challengeId].name}获胜；再次挑战须主动发起`);
      return;
    }
    if (region?.clear) {
      // Existing exact kill counters are cumulative waves; only a new kill can settle a clear.
      const completed = BigInt(state.regionKills[regionId]);
      const waves = BigInt(region.clear.waves);
      if (completed % waves === 0n) {
        const firstBonus = completed === waves ? region.clear.firstBonus : undefined;
        const stones = integerAdd(region.clear.reward.stones, firstBonus?.stones ?? '0');
        const cultivation = add(text(dec(region.clear.reward.cultivation).mul(cultivationMultiplier)), firstBonus?.cultivation ?? '0');
        state.stones = integerAdd(state.stones, stones);
        gainCultivation(state, cultivation);
        log(state, 'gain', `${completed === waves ? '首次通关' : '通关'}${region.name}，修为 +${cultivation}（受瓶颈吸收影响），灵石 +${stones}`);
      }
    }
    spawn(state);
  }
  function maybeBodyWard(state: GameState, stats: Stats) {
    if (!state.battle || state.proficiencyCombat.bodyWardUsed || dec(state.player.hp).lte(0) ||
        !combatProficiencies(state, techniques[state.techniqueId].actionId).includes('body')) return;
    const ability = proficiencyAbility(state, 'body');
    if (ability?.kind !== 'body-ward' || dec(state.player.hp).gt(dec(stats.maxHp).mul(ability.hpThreshold))) return;
    state.proficiencyCombat.bodyWardUsed = true;
    state.player.shield = minimum(stats.maxHp, dec(state.player.shield).plus(dec(stats.maxHp).mul(ability.maxHpFraction)));
    log(state, 'combat', '护体生效');
  }
  function actionHits(
    state: GameState, owner: Combatant, ownerStats: Stats, ownEffects: Effect[],
    target: Combatant, targetStats: Stats, targetEffects: Effect[], action: Action, damageMultiplier: string,
  ) {
    const playerStats = owner === state.player ? ownerStats : targetStats;
    const actor = owner === state.player ? '我方' : enemies[state.battle!.enemyId].name;
    for (let hit = 0; hit < action.hits; hit++) {
      if (dec(owner.hp).lte(0) || dec(target.hp).lte(0)) break;
      if (random(state) >= hitChance(ownerStats.agility, targetStats.agility)) {
        log(state, 'combat', `${actor}施展${action.name}，未命中`, 'damage');
        continue;
      }
      const critical = random(state) < Number(ownerStats.critChance);
      const damage = directDamage(ownerStats, targetStats, action, critical);
      // Only the configured action's direct hits, after defense/crit and before shields.
      const result = applyDamage(target, text(dec(damage).mul(damageMultiplier)));
      log(state, 'combat', `${actor}施展${action.name}${critical ? '（暴击）' : ''}，造成 ${result.hpLost} 伤害${dec(result.absorbed).gt(0) ? `，护盾吸收 ${result.absorbed}` : ''}`, 'damage');
      maybeBodyWard(state, playerStats);
      const afterHit = triggerEffects('hit', ownEffects, owner, ownerStats, target, targetStats);
      maybeBodyWard(state, playerStats);
      let reactionLoss = '0';
      if (dec(result.hpLost).gt(0) && dec(target.hp).gt(0)) {
        reactionLoss = triggerEffects('hurt', targetEffects, target, targetStats, owner, ownerStats).hpLost;
        maybeBodyWard(state, playerStats);
      }
      if (dec(result.hpLost).plus(afterHit.hpLost).plus(reactionLoss).gt(0)) state.battle!.lastProgressMs = state.clockMs;
    }
  }
  function takeAction(
    state: GameState, owner: Combatant, ownerStats: Stats, ownEffects: Effect[],
    target: Combatant, targetStats: Stats, targetEffects: Effect[], preferredActionId: string,
    actionDamagePercent = '0',
  ) {
    const isPlayer = owner === state.player;
    const preferred = isPlayer ? {
      ...actions[preferredActionId], mpCost: effectiveManaCost(content, state, actions[preferredActionId].mpCost),
    } : actions[preferredActionId];
    const surge = isPlayer ? proficiencyAbility(state, 'spell') : undefined;
    const empowered = surge?.kind === 'spell-surge' && preferred.damageType === 'magical' &&
      state.proficiencyCombat.spellCasts >= surge.casts;
    // Free casting changes affordability as well as payment.
    let action = empowered || dec(owner.mp).gte(preferred.mpCost) ? preferred : actions[settings.baseActionId];
    owner.mp = sub(owner.mp, empowered ? '0' : action.mpCost);
    owner.nextActionMs = state.clockMs + ownerStats.attackIntervalMs;
    if (empowered) {
      action = { ...action, coefficient: text(dec(action.coefficient).mul(dec(surge.powerBonus).plus(1))) };
      state.proficiencyCombat.spellCasts = 0;
      log(state, 'combat', '灵潮强化施法，免耗灵力');
    } else if (isPlayer && surge?.kind === 'spell-surge' && action.damageType === 'magical') {
      state.proficiencyCombat.spellCasts = Math.min(surge.casts, state.proficiencyCombat.spellCasts + 1);
    }
    const multiplier = text(dec(action.id === preferredActionId ? actionDamagePercent : '0').plus(1));
    actionHits(state, owner, ownerStats, ownEffects, target, targetStats, targetEffects, action, multiplier);
    const afterAction = triggerEffects('action', ownEffects, owner, ownerStats, target, targetStats);
    maybeBodyWard(state, isPlayer ? ownerStats : targetStats);
    if (dec(afterAction.hpLost).gt(0)) state.battle!.lastProgressMs = state.clockMs;
    if (isPlayer && combatProficiencies(state, action.id).includes('sword')) {
      const followup = proficiencyAbility(state, 'sword');
      if (followup?.kind === 'sword-followup') {
        state.proficiencyCombat.swordActions = Math.min(followup.everyActions, state.proficiencyCombat.swordActions + 1);
        if (state.proficiencyCombat.swordActions >= followup.everyActions && dec(owner.hp).gt(0) && dec(target.hp).gt(0)) {
          state.proficiencyCombat.swordActions = 0;
          log(state, 'combat', '连势追击');
          actionHits(state, owner, ownerStats, ownEffects, target, targetStats, targetEffects,
            { ...actions[settings.baseActionId], damageType: 'physical', hits: 1, coefficient: followup.coefficient }, '1');
        }
      }
    }
    return action.id;
  }
  function growthGain(state: GameState, use: Extract<NonNullable<Content['items'][number]['use']>, { kind: 'growth' }>) {
    const attribute: GrowthStat = use.stat;
    const current = dec(state.player[growthFields[attribute]]!);
    return current.lte(use.scale) ? use.amount : text(dec(use.amount).mul(use.scale).div(current));
  }
  function usePill(state: GameState, itemId: string, count: number) {
    const item = items[itemId];
    if (!item?.use) throw new RuleError('该物品不可主动服用');
    if (BigInt(state.inventory[itemId] ?? '0') < BigInt(count)) throw new RuleError(`${item.name}数量不足`);
    const stats = getPlayerStats(state);
    for (let i = 0; i < count; i++) {
      if (item.use.kind === 'restore') {
        const cap = item.use.resource === 'hp' ? stats.maxHp : stats.maxMp;
        if (dec(state.player[item.use.resource]).gte(cap)) break;
        const restored = restore(state.player, stats, item.use.resource, item.use.amount);
        log(state, 'gain', `服用${item.name}，恢复 ${restored} ${item.use.resource === 'hp' ? '气血' : '灵力'}`, 'recovery');
      } else {
        // Full potency to scale H, then reciprocal falloff; sequential in all batches.
        const field = growthFields[item.use.stat];
        state.player[field] = add(state.player[field]!, growthGain(state, item.use));
      }
      adjustItem(state, itemId, -1);
      state.totals.pillsUsed = integerAdd(state.totals.pillsUsed, 1);
    }
  }
  function tick(state: GameState, stats: Stats, ownEffects: Effect[], actionDamagePercent: string) {
    const fighting = state.activity.kind === 'dungeon';
    const hpRate = dec(stats.hpRegen).plus(fighting ? 0 : dec(stats.maxHp).mul(settings.restHpFraction));
    restore(state.player, stats, 'hp', text(hpRate));
    restore(state.player, stats, 'mp', stats.mpRegen);
    if (state.activity.kind !== 'idle') state.totals.activeSeconds = integerAdd(state.totals.activeSeconds, 1);
    if (state.activity.kind === 'meditate') {
      gainCultivation(state, getActivityRates(state).meditationPerSecond);
      if (saturated(state)) stop(state, state.level === 12 ? '修为储备已饱和，等待主动筑基' : '筑基初期修为已满；后续境界尚未在本版本开放');
    } else if (state.activity.kind === 'practice') {
      const id = state.activity.targetId!;
      practice(state, id, getActivityRates(state).practicePerSecond);
      if (dec(state.techniqueXp[id]).gte(techniques[id].xpCap)) stop(state, `${techniques[id].name}本阶段专修已完成`);
    } else if (fighting) {
      const battle = state.battle!;
      const enemy = enemies[battle.enemyId];
      const enemyEffects = enemyCombatEffects(enemy);
      restore(battle, enemy, 'hp', enemy.hpRegen);
      restore(battle, enemy, 'mp', enemy.mpRegen);
      if (state.supply.enabled && state.clockMs >= state.supply.readyAt &&
          dec(state.player.hp).lt(stats.maxHp) &&
          dec(state.player.hp).lte(dec(stats.maxHp).mul(state.supply.hpThreshold)) &&
          BigInt(state.inventory[settings.supplyItemId] ?? '0') > 0n) {
        usePill(state, settings.supplyItemId, 1);
        state.supply.readyAt = state.clockMs + settings.supplyCooldownMs;
      }
      const mana = state.manaSupply;
      if (mana?.enabled && settings.manaSupply && state.clockMs >= mana.readyAt &&
          dec(state.player.mp).lt(stats.maxMp) &&
          dec(state.player.mp).lte(dec(stats.maxMp).mul(mana.mpThreshold)) &&
          BigInt(state.inventory[settings.manaSupply.itemId] ?? '0') > 0n) {
        usePill(state, settings.manaSupply.itemId, 1);
        mana.readyAt = state.clockMs + settings.manaSupply.cooldownMs;
      }
      if (state.clockMs >= state.player.nextActionMs && dec(state.player.hp).gt(0)) {
        const actionId = takeAction(state, state.player, stats, ownEffects, battle, enemy, enemyEffects,
          techniques[state.techniqueId].actionId, actionDamagePercent);
        const xp = combatProficiencyXp(content, enemy);
        for (const id of combatProficiencies(state, actionId)) gainProficiency(state, id, xp);
        practice(state, state.techniqueId, text(dec(settings.combatPracticePerAction)
          .mul(dec(experienceBonus(content, state, 'technique')).plus(1))));
      }
      if (dec(battle.hp).lte(0) && dec(state.player.hp).gt(0)) {
        defeatedEnemy(state, ownEffects);
        return;
      }
      if (state.clockMs >= battle.nextActionMs && dec(battle.hp).gt(0) && dec(state.player.hp).gt(0)) {
        takeAction(state, battle, enemy, enemyEffects, state.player, stats, ownEffects, enemy.actionId);
      }
      if (dec(state.player.hp).lte(0)) {
        stop(state, `战败，已停止${state.activity.challengeId ? '挑战' : '秘境'}；休整后须主动再出发`);
        return;
      }
      if (dec(battle.hp).lte(0)) {
        defeatedEnemy(state, ownEffects);
        return;
      }
      if (state.clockMs - battle.lastProgressMs >= settings.stalemateMs ||
          state.clockMs - battle.startedAt >= settings.battleLimitMs) {
        stop(state, `战斗僵持，已停止${state.activity.challengeId ? '挑战' : '秘境'}`);
      }
    }
  }

  function createGame(nowMs: number, seed = 0x4d4f4c49): GameState {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('随机种子须为 uint32');
    const clockMs = floorTime(nowMs);
    return createLife(clockMs, seed || 0x4d4f4c49, '1', '1', {
      proficiencyXp: { sword: '0', body: '0', spell: '0', alchemy: '0', forging: '0' },
      learnedRecipes: [], enteredFates: [], openingTier: 0,
      foundationMethods: [], achievements: {},
      highestLevel: 0, visitedRegions: [], explorationNodes: [], highestDwellingTier: 0,
      reincarnation: { points: '0', count: '0', lastSettlement: null },
    });
  }
  function createLife(clockMs: number, rng: number, lifeId: string, nextInstance: string, history: GameState['history']): GameState {
    const state: GameState = {
      schemaVersion: content.schemaVersion, contentVersion: content.version, rulesVersion: content.rulesVersion,
      clockMs, rng, nextInstance,
      lifeId, phase: 'preparing', innateFates: [],
      opening: {
        candidates: [], selected: Array(content.openingTiers[history.openingTier].slots).fill(null),
        drawsUsed: 0, designationsUsed: 0,
      },
      stones: '0', inventory: {},
      equipment: [], loadout: { weapon: null, armor: null, footwear: null, accessory: null },
      level: 0, cultivation: '0', reserve: '0',
      foundation: { methodId: null, attempts: '0', lastAttempt: null },
      player: {
        hp: content.realms[0].maxHp, mp: content.realms[0].maxMp, shield: '0', nextActionMs: clockMs,
        pillAttack: '0', pillMagicAttack: '0', pillDefense: '0', pillMagicDefense: '0', pillMaxHp: '0',
      },
      techniqueId: settings.starterTechniqueId,
      techniqueXp: Object.fromEntries(content.techniques.map((entry) => [entry.id, '0'])),
      proficiencyXp: { sword: '0', body: '0', spell: '0', alchemy: '0', forging: '0' },
      history,
      proficiencyCombat: { swordActions: 0, spellCasts: 0, bodyWardUsed: false },
      crafting: {},
      ...(content.techniqueAcquisition ? { learnedTechniques: [settings.starterTechniqueId] } : {}),
      regionKills: {}, challengeWins: {}, activity: { kind: 'idle', startedAt: clockMs }, battle: null,
      ...(content.enemyEffects ? { pendingEncounters: {} } : {}),
      supply: { enabled: false, hpThreshold: 0.5, readyAt: clockMs },
      ...(settings.manaSupply ? { manaSupply: { enabled: false, mpThreshold: 0.3, readyAt: clockMs } } : {}),
      totals: { kills: '0', pillsUsed: '0', cultivationGained: '0', activeSeconds: '0' },
      journal: [],
      ...(content.dwelling ? { dwelling: { tier: 0, gathering: 0, study: 0 } } : {}),
    };
    drawFates(content, state);
    return state;
  }
  function advanceGame(original: GameState, targetMs: number, maxTicks = 3600): GameState {
    assertState(original);
    const target = floorTime(targetMs);
    if (!Number.isSafeInteger(maxTicks) || maxTicks < 1 || maxTicks > 1_000_000) throw new Error('推进预算须为 1 至 1000000 整数 tick');
    if (target <= original.clockMs) return structuredClone(original);
    const state = structuredClone(original);
    if (state.phase === 'preparing') {
      state.clockMs = target;
      return state;
    }
    let statsKey = '';
    let stats: Stats = getPlayerStats(state);
    const ownEffects = playerEffects(state);
    const actionDamagePercent = activeWeaponMatch(state)?.actionDamagePercent ?? '0';
    for (let ticks = 0; state.clockMs < target && ticks < maxTicks; ticks++) {
      const key = `${state.level}:${state.techniqueXp[state.techniqueId]}:${PROFICIENCY_IDS.map((id) => state.proficiencyXp[id]).join(':')}`;
      if (key !== statsKey) { stats = getPlayerStats(state); statsKey = key; }
      // Only skip when every per-second operation is an identity.
      if (state.activity.kind === 'idle' && dec(state.player.hp).eq(stats.maxHp) && dec(state.player.mp).eq(stats.maxMp)) {
        state.clockMs = target;
        break;
      }
      state.clockMs += 1000;
      tick(state, stats, ownEffects, actionDamagePercent);
    }
    recordLifeHistory(content, state);
    return state;
  }
  function applyCommand(original: GameState, command: GameCommand): GameState {
    assertState(original);
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw new RuleError('操作格式无效');
    const state = structuredClone(original);
    const openingCommand = ['fate-draw', 'fate-select', 'fate-designate', 'enter-life'].includes(command.type);
    if (state.phase === 'preparing' && !openingCommand) throw new RuleError('请先选择先天气运并正式入世');
    switch (command.type) {
      case 'fate-draw':
        needOpening(state, command.lifeId);
        drawFates(content, state);
        break;
      case 'fate-select':
      case 'fate-designate':
        needOpening(state, command.lifeId);
        selectFate(content, state, command.slot, command.fateId, command.type === 'fate-designate');
        break;
      case 'enter-life': {
        needOpening(state, command.lifeId);
        confirmFates(state);
        state.stones = settings.starterStones;
        state.inventory = { ...settings.starterItems };
        if (settings.starterEquipmentId !== null) {
          state.loadout[equipment[settings.starterEquipmentId].slot] = generateEquipment(state, settings.starterEquipmentId).instanceId;
        }
        for (const effect of fateEffects(content, state)) {
          if (effect.kind === 'gift-stones') state.stones = integerAdd(state.stones, effect.amount);
        }
        const stats = getPlayerStats(state);
        state.player.hp = stats.maxHp;
        state.player.mp = stats.maxMp;
        state.player.nextActionMs = state.clockMs;
        state.supply.readyAt = state.clockMs;
        if (state.manaSupply) state.manaSupply.readyAt = state.clockMs;
        state.activity = { kind: 'idle', startedAt: state.clockMs };
        log(state, 'progress', `正式入世，先天气运：${state.innateFates.map((id) => content.fates.find((fate) => fate.id === id)!.name).join('、')}`);
        break;
      }
      case 'reincarnate': {
        const record = settleReincarnation(content, state, command.lifeId);
        const next = createLife(state.clockMs, state.rng, integerAdd(state.lifeId, 1), state.nextInstance, state.history);
        if (state.learnedTechniques) next.learnedTechniques = [...state.learnedTechniques];
        next.supply = { ...state.supply, readyAt: state.clockMs };
        if (state.manaSupply) next.manaSupply = { ...state.manaSupply, readyAt: state.clockMs };
        log(next, 'progress', `第 ${record.lifeId} 世轮回结算，积累 +${record.points}；进入第 ${next.lifeId} 世准备`);
        return next;
      }
      case 'activity': {
        if (!['idle', 'meditate', 'dungeon', 'practice'].includes(command.kind)) throw new RuleError('未知活动');
        if (command.kind === 'dungeon') {
          const region = regions[command.targetId ?? ''];
          if (!region) throw new RuleError('请选择有效秘境');
          needUnlocked(state, region.unlock);
          if (dec(state.player.hp).lte(0)) throw new RuleError('气血须恢复至大于零才能出发');
        }
        if (command.kind === 'practice') {
          const technique = techniques[command.targetId ?? ''];
          if (!technique) throw new RuleError('请选择有效专修功法');
          needTechnique(state, technique);
        }
        if (state.activity.kind === command.kind && state.activity.targetId === command.targetId) break;
        state.battle = null;
        state.player.shield = '0';
        resetProficiencyCombat(state);
        state.activity = {
          kind: command.kind, startedAt: state.clockMs,
          ...(command.targetId && (command.kind === 'dungeon' || command.kind === 'practice') ? { targetId: command.targetId } : {}),
        };
        if (command.kind === 'dungeon') {
          state.player.nextActionMs = Math.max(state.player.nextActionMs, state.clockMs + getPlayerStats(state).attackIntervalMs);
          spawn(state);
        } else if (command.kind === 'idle') stop(state, '主动停止');
        break;
      }
      case 'challenge': {
        if (command.lifeId !== state.lifeId) throw new RuleError('本世标识已失效，请刷新后重试');
        const challenge = challenges[command.challengeId];
        if (!challenge) throw new RuleError('挑战不存在');
        if (state.level > challenge.maxLevel) throw new RuleError(`挑战者不得超过${content.realms[challenge.maxLevel].name}`);
        needUnlocked(state, challenge.unlock);
        outOfCombat(state);
        if (dec(state.player.hp).lte(0)) throw new RuleError('气血须恢复至大于零才能挑战');
        state.player.shield = '0';
        resetProficiencyCombat(state);
        state.activity = { kind: 'dungeon', challengeId: challenge.id, startedAt: state.clockMs };
        state.player.nextActionMs = Math.max(state.player.nextActionMs, state.clockMs + getPlayerStats(state).attackIntervalMs);
        spawn(state);
        break;
      }
      case 'equip': {
        outOfCombat(state);
        if (!EQUIPMENT_SLOTS.includes(command.slot)) throw new RuleError('未知装配部位');
        if (command.instanceId !== null) {
          const instance = state.equipment.find((entry) => entry.instanceId === command.instanceId);
          if (!instance) throw new RuleError('未持有该装备');
          if (equipment[instance.definitionId].slot !== command.slot) throw new RuleError('装备与部位不匹配');
        }
        state.loadout[command.slot] = command.instanceId;
        const stats = getPlayerStats(state);
        state.player.hp = minimum(state.player.hp, stats.maxHp);
        state.player.mp = minimum(state.player.mp, stats.maxMp);
        break;
      }
      case 'technique': {
        outOfCombat(state);
        const technique = techniques[command.techniqueId];
        if (!technique) throw new RuleError('功法不存在');
        needTechnique(state, technique);
        state.techniqueId = technique.id;
        const stats = getPlayerStats(state);
        state.player.hp = minimum(state.player.hp, stats.maxHp);
        state.player.mp = minimum(state.player.mp, stats.maxMp);
        break;
      }
      case 'learn-technique': {
        outOfCombat(state);
        if (!content.techniqueAcquisition) throw new RuleError('本内容版本未开放功法书册学习');
        const technique = techniques[command.techniqueId];
        if (!technique) throw new RuleError('功法不存在');
        needUnlocked(state, technique.unlock);
        if (learned(state, technique.id)) throw new RuleError('已经学会该功法，不重复消耗书册');
        adjustItem(state, technique.manualItemId!, -1);
        state.learnedTechniques!.push(technique.id);
        log(state, 'progress', `学会${technique.name}`);
        break;
      }
      case 'supply':
        if (typeof command.enabled !== 'boolean' || !Number.isFinite(command.hpThreshold) || command.hpThreshold < 0 || command.hpThreshold > 1) throw new RuleError('补给阈值须为 0 至 1');
        state.supply = { ...state.supply, enabled: command.enabled, hpThreshold: command.hpThreshold };
        break;
      case 'mana-supply':
        if (!settings.manaSupply || !state.manaSupply) throw new RuleError('本内容版本未开放回灵补给');
        if (typeof command.enabled !== 'boolean' || !Number.isFinite(command.mpThreshold) ||
            command.mpThreshold < 0 || command.mpThreshold > 1) throw new RuleError('补给阈值须为 0 至 1');
        state.manaSupply = { ...state.manaSupply, enabled: command.enabled, mpThreshold: command.mpThreshold };
        break;
      case 'buy': {
        const count = quantity(command.quantity);
        const item = items[command.itemId];
        if (!item?.buyPrice) throw new RuleError('商店不出售该物品');
        needUnlocked(state, item.unlock);
        pay(state, BigInt(effectiveBuyPrice(content, state, item)!) * BigInt(count));
        adjustItem(state, item.id, count);
        break;
      }
      case 'sell': {
        const count = quantity(command.quantity);
        const item = items[command.itemId];
        if (!item || item.sellPrice === undefined) throw new RuleError('商店不回收该物品');
        adjustItem(state, item.id, -count);
        state.stones = integerAdd(state.stones, BigInt(item.sellPrice) * BigInt(count));
        break;
      }
      case 'craft': {
        outOfCombat(state);
        const count = quantity(command.quantity);
        const recipe = recipes[command.recipeId];
        if (!recipe) throw new RuleError('配方不存在');
        needUnlocked(state, recipe.unlock);
        if (!recipeMastered(state, recipe)) throw new RuleError(`须领悟该丹方且本世丹道达到 ${recipe.alchemyLevel} 级`);
        pay(state, BigInt(recipe.stones) * BigInt(count));
        for (const cost of recipe.costs) adjustItem(state, cost.itemId, -BigInt(cost.quantity) * BigInt(count));
        // Settle sequentially: a level gained within a batch affects its next attempt.
        const tally = state.crafting[recipe.id] ??= { attempts: '0', successes: '0' };
        for (let i = 0; i < count; i++) {
          const terms = craftingTerms(state, recipe);
          const success = dec(terms.successChance).eq(1) || dec(random(state)).lt(terms.successChance);
          tally.attempts = integerAdd(tally.attempts, 1);
          if (success) {
            tally.successes = integerAdd(tally.successes, 1);
            if (recipe.outputKind === 'equipment') generateEquipment(state, recipe.outputId, true);
            else {
              const extra = dec(terms.extraOutputChance).gt(0) &&
                (dec(terms.extraOutputChance).eq(1) || dec(random(state)).lt(terms.extraOutputChance));
              adjustItem(state, recipe.outputId, BigInt(recipe.outputQuantity) * (extra ? 2n : 1n));
              if (extra) log(state, 'gain', `${recipe.name}额外成丹一份`);
            }
          }
          log(state, 'gain', `${recipe.name}${success ? '炼制成功' : '炼制失败，材料与灵石已消耗'}`);
          gainProficiency(state, terms.proficiencyId, recipe.training.xp);
        }
        break;
      }
      case 'consume':
        outOfCombat(state);
        usePill(state, command.itemId, quantity(command.quantity));
        break;
      case 'upgrade-dwelling': {
        outOfCombat(state);
        const home = state.dwelling;
        const definition = content.dwelling;
        if (!definition || !home) throw new RuleError('本内容版本未开放洞府改造');
        if (!['tier', 'gathering', 'study'].includes(command.track)) throw new RuleError('未知洞府改造');
        const track = command.track;
        if (track === 'tier') {
          const next = definition.tiers[home.tier + 1];
          if (!next) throw new RuleError('本阶段居所已达最高品阶');
          if (home.gathering < next.requiredGathering) throw new RuleError('须先完成聚灵阵初设');
          pay(state, BigInt(next.stones));
          for (const cost of next.costs) adjustItem(state, cost.itemId, -BigInt(cost.quantity));
          home.tier++;
        } else {
          const next = definition[track][home[track]];
          if (!next) throw new RuleError('本阶段设施已完成全部改造');
          if (home.tier < next.requiredTier) throw new RuleError('当前居所品阶不足');
          pay(state, BigInt(next.stones));
          for (const cost of next.costs) adjustItem(state, cost.itemId, -BigInt(cost.quantity));
          home[track]++;
        }
        log(state, 'progress', `完成${track === 'tier' ? definition.tiers[home.tier].name : track === 'gathering' ? '聚灵阵' : '修炼静室'}改造`);
        break;
      }
      case 'breakthrough': {
        const result = attemptFoundation(content, state, command.methodId, command.lifeId);
        stop(state, result.success ? `${result.method.name}成功，储备已接续；请选择后续活动`
          : `${result.method.name}失败，已消耗丹药与配置损耗的附材；修为和储备保留，须主动重试`);
        for (const id of result.achievements) {
          log(state, 'progress', `达成成就：${content.achievements.find((achievement) => achievement.id === id)!.name}`);
        }
        break;
      }
      default:
        throw new RuleError('未知操作');
    }
    recordLifeHistory(content, state);
    return state;
  }

  function actionView(id: string) {
    return toActionView(actions[id]);
  }
  function playerActionView(state: GameState, id: string, current = false) {
    const action = actions[id];
    const surge = current ? proficiencyAbility(state, 'spell') : undefined;
    const empowered = surge?.kind === 'spell-surge' && action.damageType === 'magical' &&
      state.proficiencyCombat.spellCasts >= surge.casts;
    return {
      ...toActionView(action), baseMpCost: action.mpCost,
      mpCost: empowered ? '0' : effectiveManaCost(content, state, action.mpCost),
      coefficient: empowered ? text(dec(action.coefficient).mul(dec(surge.powerBonus).plus(1))) : action.coefficient,
    };
  }
  function enemyDrops(state: GameState, id: string): GameView['regions'][number]['enemies'][number]['drops'] {
    const enemy = enemies[id];
    return [
      ...enemy.drops.map((drop) => ({
        id: drop.itemId, name: items[drop.itemId].name, kind: 'item' as const, quantity: drop.quantity,
        ...effectiveDrop(content, state, drop),
      })),
      ...enemy.equipmentDrops.map((drop) => ({
        id: drop.equipmentId, name: equipment[drop.equipmentId].name, kind: 'equipment' as const, quantity: '1',
        ...effectiveDrop(content, state, drop),
      })),
    ];
  }
  function describeAction(id: string) {
    return describeActionView(actionView(id), actions[settings.baseActionId].name);
  }
  function enemyPresentation(id: string) {
    const enemy = enemies[id];
    return {
      name: enemy.name, ...getPresentation('enemies', enemy), action: actionView(enemy.actionId),
      realm: { level: enemy.level, name: content.realms[enemy.level].name },
      rank: enemy.allocation?.rank ?? 'normal',
      abilities: [describeAction(enemy.actionId), ...enemy.effects.map((key) => {
        const effect = enemyEffectCatalog[key];
        return effect.trigger === 'encounter'
          ? `每次遭遇开始时获得 ${effect.amount} 护盾（不超过气血上限），战斗中不重复生成`
          : describeEffect(effect);
      })],
    };
  }
  function equipmentStats(instance: EquipmentInstance) {
    return [
      ...baseEquipmentModifiers(instance),
      ...instance.affixes.flatMap((affix) => affix.modifier ? [affix.modifier] : []),
    ].map(toStatView);
  }
  function equipmentEffects(instance: EquipmentInstance) {
    return baseEquipmentEffects(instance).map(describeEffect);
  }
  function describeEquipment(instance: EquipmentInstance) {
    return [
      ...baseEquipmentModifiers(instance).map(describeModifier),
      ...baseEquipmentEffects(instance).map(describeEffect),
    ].join('；');
  }
  function itemEffects(item: Content['items'][number]): string[] {
    if (item.kind === 'manual') {
      const technique = content.techniques.find((entry) => entry.manualItemId === item.id)!;
      return [`学习${technique.name}时消耗一册；已经学会后不能重复学习`, '学习不增加专修进度，也不自动运转'];
    }
    if (item.use?.kind === 'restore') {
      return [
        `恢复 ${item.use.amount} ${item.use.resource === 'hp' ? '气血' : '灵力'}，不超过上限；该项已满时不消耗`,
        '仅可脱战后手动服用',
        ...(item.id === settings.supplyItemId
          ? [`开启自动补给后可在战斗中服用，受所设气血阈值及 ${settings.supplyCooldownMs / 1000} 秒间隔限制`] : []),
        ...(item.id === settings.manaSupply?.itemId
          ? [`开启回灵补给后可在战斗中服用，受所设灵力阈值及 ${settings.manaSupply.cooldownMs / 1000} 秒独立间隔限制`] : []),
      ];
    }
    if (item.use?.kind === 'growth') {
      const use = item.use;
      const name = growthNames[use.stat];
      return [
        `增加本世${name}：丹药累计${name}加成不超过 ${item.use.scale} 时，每颗增加 ${item.use.amount}；超过后，每颗收益随累计加成提高而递减`,
        '仅可脱战后服用；一次服用多颗同样适用递减效果',
        ...(content.growthPillTiers ? [
          `${content.growthPillTiers.find((tier) => tier.id === use.tierId)!.name}；同属性各档共用累计与递减，突破不清零`,
          ...(item.use.stat === 'maxHp' ? ['不立即回复当前气血'] : []),
        ] : []),
      ];
    }
    if (item.id === settings.breakthroughItemId) {
      return [
        `${content.realms[12].name}修满 ${content.realms[12].required} 修为后，选择筑基方式，每次尝试消耗 ${settings.breakthroughQuantity} 颗，失败同样消耗`,
        '仅可脱战后主动突破；无需储满修为，已有储备全数用于筑基后的修行',
      ];
    }
    if (!content.recipes.some((recipe) => recipe.outputKind === 'equipment')) {
      return ['炼丹材料', ...(item.sellPrice !== undefined ? ['可向商店回收'] : [])];
    }
    const uses: string[] = [
      ...new Set(content.recipes.filter((recipe) => recipe.costs.some((cost) => cost.itemId === item.id))
        .map((recipe) => recipe.outputKind === 'equipment' ? '炼器材料' : '炼丹材料')),
    ];
    if (content.foundationMethods.some((method) => method.extraCosts.some((cost) => cost.itemId === item.id))) uses.push('筑基附材');
    if (content.dwelling && [...content.dwelling.tiers, ...content.dwelling.gathering, ...content.dwelling.study]
      .some((upgrade) => upgrade.costs.some((cost) => cost.itemId === item.id))) uses.push('洞府改造材料');
    return [...(uses.length ? uses : ['材料']), ...(item.sellPrice !== undefined ? ['可向商店回收'] : [])];
  }
  function itemDescription(item: Content['items'][number]) {
    return itemEffects(item).join('；');
  }
  function techniqueEffects(technique: Content['techniques'][number]) {
    return [
      ...technique.modifiers.map(describeModifier),
      ...technique.effects.map((id) => describeEffect(effects[id])),
      ...weaponMatchEffects(technique).map((effect) => `持${WEAPON_TYPE_LABELS[technique.weaponType!]}时：${effect}`),
    ];
  }
  function weaponMatchEffects(technique: Content['techniques'][number]) {
    const match = technique.weaponMatch;
    if (!match) return [];
    return [
      ...match.modifiers.map(describeModifier),
      ...match.effects.map((id) => describeEffect(effects[id])),
      ...(dec(match.actionDamagePercent).gt(0) ? [
        `${actions[technique.actionId].name}直接伤害 +${dec(match.actionDamagePercent).mul(100).toFixed()}%（不含触发伤害与缺灵时替代的普通攻击）`,
      ] : []),
    ];
  }
  function masteryEffects(technique: Content['techniques'][number]) {
    return technique.practiceBonuses.map((bonus) => describeModifier({ ...bonus, mode: 'flat' }));
  }
  function itemSources(itemId: string) {
    const sources: string[] = [];
    for (const region of content.regions) {
      if (region.enemies.some((id) => enemies[id].drops.some((drop) => drop.itemId === itemId && drop.chance > 0))) sources.push(region.name);
    }
    sources.push(...content.challenges.filter((challenge) =>
      challenge.enemy.drops.some((drop) => drop.itemId === itemId && drop.chance > 0)).map((challenge) => challenge.name));
    sources.push(...content.recipes.filter((recipe) => !recipe.outputKind && recipe.outputId === itemId).map((recipe) => recipe.name));
    if (items[itemId].buyPrice) sources.push('基础商店');
    return sources.join('、');
  }
  function describeProficiencyAbility(ability: ProficiencyAbility | undefined): string[] {
    if (!ability) return [];
    switch (ability.kind) {
      case 'sword-followup':
        return [`连势：持剑每 ${ability.everyActions} 次动作追加一次物攻 ×${ability.coefficient} 的单段追击；独立命中与暴击，不额外计经验或触发行动附效`];
      case 'body-ward':
        return [`护体：空手或持拳套时，每场首次气血不高于 ${dec(ability.hpThreshold).mul(100)}% 且存活，获得气血上限 ${dec(ability.maxHpFraction).mul(100)}% 的护盾`];
      case 'spell-surge':
        return [`灵潮：${ability.casts} 次普通施法后，下次法术威力 +${dec(ability.powerBonus).mul(100)}% 且免耗灵；强化施法不蓄势，退出秘境清空`];
      case 'quality-reroll':
        return ['精工：成功打造时独立判定两次品质，取较高者；只产一件装备，词条只生成一次'];
    }
  }
  function getGameView(state: GameState): GameView {
    assertState(state);
    const stats = getPlayerStats(state);
    const activeProficiencies = combatProficiencies(state, techniques[state.techniqueId].actionId);
    const qualityProbabilities = forgingQualityProbabilities(content, state.proficiencyXp.forging);
    const realm = content.realms[state.level];
    return {
      contentVersion: content.version, presentationVersion: presentation.version,
      clockMs: state.clockMs, name: '无名散修',
      life: lifeView(content, state),
      reincarnation: reincarnationView(content, state),
      realm: { level: state.level, name: realm.name },
      cultivation: {
        current: state.cultivation, required: realm.required, reserve: state.reserve,
        capacity: state.level === 12 ? settings.reserveCapacity : '0', efficiency: reserveEfficiency(state),
      },
      player: {
        hp: state.player.hp, mp: state.player.mp, pillAttack: state.player.pillAttack,
        pillMagicAttack: state.player.pillMagicAttack, pillDefense: state.player.pillDefense,
        pillMagicDefense: state.player.pillMagicDefense, pillMaxHp: state.player.pillMaxHp,
        stats: { ...stats, critChance: Number(stats.critChance), critMultiplier: Number(stats.critMultiplier) },
        action: playerActionView(state, techniques[state.techniqueId].actionId, true),
      },
      stones: state.stones,
      proficiencies: content.proficiencies.map((definition) => {
        const xp = state.proficiencyXp[definition.id];
        const rewards = proficiencyRewards(definition, xp);
        const production = definition.id === 'alchemy' || definition.id === 'forging';
        return {
          id: definition.id, name: definition.name, xp, level: rewards.level,
          maxLevel: definition.maxLevel, nextLevelXp: rewards.nextLevelXp,
          active: production || activeProficiencies.includes(definition.id),
          historicalXp: state.history.proficiencyXp[definition.id],
          retraining: {
            bonus: dec(xp).lt(state.history.proficiencyXp[definition.id]) ? content.reincarnation.retrainingBonus : '0',
            untilXp: state.history.proficiencyXp[definition.id],
          },
          perLevelEffects: [
            ...definition.perLevel.map(describeModifier),
            ...(definition.id === 'alchemy' ? [`适用丹方额外成丹概率 +${dec(content.proficiencyRules.alchemyExtraChancePerLevel).mul(100)} 个百分点`] : []),
            ...(definition.id === 'forging' ? ['提高新制装备的较高品质概率'] : []),
            ...(production ? ['提高低于配方难度时的制作成功率，最高 100%'] : []),
          ],
          ...(rewards.ability?.kind === 'sword-followup' ? {
            combatProgress: { current: state.proficiencyCombat.swordActions, required: rewards.ability.everyActions },
          } : rewards.ability?.kind === 'spell-surge' ? {
            combatProgress: { current: state.proficiencyCombat.spellCasts, required: rewards.ability.casts },
          } : rewards.ability?.kind === 'body-ward' ? {
            combatProgress: { used: state.proficiencyCombat.bodyWardUsed },
          } : {}),
          effects: [
            ...rewards.modifiers.filter((m) => dec(m.value).gt(0)).map(describeModifier),
            ...(production ? [`生产成功率按 ${rewards.level} 级熟练度结算，阶段额外 +${dec(rewards.successBonus).mul(100)} 个百分点`] : []),
            ...(definition.id === 'forging' ? [`较高品质权重随炼器等级提升`] : []),
            ...(definition.id === 'alchemy' ? [
              `适用丹方成功后额外成丹概率 ${dec(minimum(1, dec(content.proficiencyRules.alchemyExtraChancePerLevel)
                .mul(rewards.level).plus(rewards.extraOutputChance))).mul(100)}%，额外获得一份配方产量，不多给经验`,
            ] : []),
            ...describeProficiencyAbility(rewards.ability),
          ],
          milestones: definition.milestones.map((milestone) => ({
            level: milestone.level, name: milestone.name, reached: rewards.level >= milestone.level,
            effects: [...milestone.modifiers.map(describeModifier),
              ...(dec(milestone.successBonus).gt(0) ? [`生产成功率 +${dec(milestone.successBonus).mul(100)} 个百分点`] : []),
              ...describeProficiencyAbility(milestone.ability),
              ...(milestone.extraOutputChance ? [`额外成丹概率 +${dec(milestone.extraOutputChance).mul(100)} 个百分点`] : []),
              ...(milestone.qualityWeightBonus ? ['额外提高新制装备的较高品质概率'] : []),
              ...(definition.id === 'alchemy' ? content.recipes.filter((recipe) => recipe.alchemyLevel === milestone.level)
                .map((recipe) => `领悟${recipe.name}，制作仍需本世丹道 ${milestone.level} 级`) : [])],
          })),
        };
      }),
      ...(content.dwelling && state.dwelling ? {
        dwelling: {
          name: content.dwelling.tiers[state.dwelling.tier].name,
          ...state.dwelling, ...getActivityRates(state),
          upgrades: (['tier', 'gathering', 'study'] as const).map((track) => {
            const home = state.dwelling!;
            const definition = content.dwelling!;
            const next = track === 'tier' ? definition.tiers[home.tier + 1] : definition[track][home[track]];
            const name = track === 'tier' ? (definition.tiers[home.tier + 1]?.name ?? '居所升阶')
              : track === 'gathering' ? '聚灵阵改造' : '静室改造';
            if (!next) return { track, name, completed: true, ready: false, requirement: '本阶段已全部完成', effects: [], costs: [] };
            const required = 'requiredGathering' in next ? home.gathering >= next.requiredGathering : home.tier >= next.requiredTier;
            const requirement = 'requiredGathering' in next ? `聚灵阵达到 ${next.requiredGathering} 级`
              : `居所达到${definition.tiers[next.requiredTier].name}`;
            const costs = [
              ...next.costs.map((cost) => ({ ...cost, name: items[cost.itemId].name, owned: state.inventory[cost.itemId] ?? '0' })),
              { itemId: 'stones', name: '灵石', quantity: next.stones, owned: state.stones },
            ];
            const effects = 'meditationBonus' in next ? [
              `居所打坐加成 ${dec(next.meditationBonus).mul(100)}%（替换当前居所加成）`,
              `居所专修加成 ${dec(next.practiceBonus).mul(100)}%（替换当前居所加成）`,
            ] : [`${track === 'gathering' ? '打坐' : '专修'}设施加成 ${dec(next.bonus).mul(100)}%（替换当前设施加成）`];
            return { track, name, completed: false, requirement, effects, costs,
              ready: state.phase === 'active' && state.activity.kind !== 'dungeon' && required &&
                costs.every((cost) => dec(cost.owned).gte(cost.quantity)) };
          }),
        },
      } : {}),
      activity: {
        ...state.activity,
        ...(state.activity.stopReason ? { stopReason: displayMessage(state.activity.stopReason) } : {}),
      },
      battle: state.battle ? {
        enemyId: state.battle.enemyId, ...enemyPresentation(state.battle.enemyId),
        hp: state.battle.hp, mp: state.battle.mp,
        maxHp: enemies[state.battle.enemyId].maxHp, maxMp: enemies[state.battle.enemyId].maxMp,
        ...(content.enemyEffects ? { shield: state.battle.shield } : {}),
        hitChance: hitChance(stats.agility, enemies[state.battle.enemyId].agility),
      } : null,
      supply: { enabled: state.supply.enabled, hpThreshold: state.supply.hpThreshold },
      ...(state.manaSupply && settings.manaSupply ? {
        manaSupply: {
          enabled: state.manaSupply.enabled, mpThreshold: state.manaSupply.mpThreshold,
          itemId: settings.manaSupply.itemId, cooldownMs: settings.manaSupply.cooldownMs,
        },
      } : {}),
      inventory: content.items.map((item) => ({
        id: item.id, name: item.name, kind: item.kind, quantity: state.inventory[item.id] ?? '0',
        ...getPresentation('items', item), effects: itemEffects(item),
        description: itemDescription(item), source: itemSources(item.id),
        ...(item.buyPrice ? { buyPrice: effectiveBuyPrice(content, state, item) } : {}),
        ...(item.sellPrice !== undefined ? { sellPrice: item.sellPrice } : {}),
        canConsume: state.phase === 'active' && Boolean(item.use), unlocked: state.phase === 'active' && unlocked(state, item.unlock),
        ...(content.growthPillTiers && item.use?.kind === 'growth' ? {
          growth: {
            stat: item.use.stat!,
            tier: { ...content.growthPillTiers.find((tier) => item.use?.kind === 'growth' && tier.id === item.use.tierId)! },
            baseGain: item.use.amount, nextGain: growthGain(state, item.use),
            cumulative: state.player[growthFields[item.use.stat!]]!, scale: item.use.scale,
          },
        } : {}),
      })),
      equipment: state.equipment.map((instance) => ({
        instanceId: instance.instanceId, definitionId: instance.definitionId,
        name: equipment[instance.definitionId].name, description: describeEquipment(instance),
        ...getPresentation('equipment', equipment[instance.definitionId]),
        ...(instance.quality ? {
          rarity: instance.quality.rarity, quality: { id: instance.quality.id, name: instance.quality.name },
        } : {}),
        slot: equipment[instance.definitionId].slot,
        ...(equipment[instance.definitionId].category ? { category: equipment[instance.definitionId].category } : {}),
        stats: equipmentStats(instance), effects: equipmentEffects(instance),
        equipped: state.loadout[equipment[instance.definitionId].slot] === instance.instanceId,
        affixes: instance.affixes.map((affix) => `${affixes[affix.definitionId].name}：${affix.effect ? describeEffect(affix.effect) : describeModifier(affix.modifier!)}`),
      })),
      techniques: content.techniques.map((technique) => ({
        id: technique.id, name: technique.name,
        ...getPresentation('techniques', technique),
        ...(technique.weaponType !== undefined ? { weaponType: technique.weaponType } : {}),
        ...(technique.weaponMatch ? {
          weaponMatch: {
            conditionMet: matchesTechniqueWeapon(state, technique),
            active: state.techniqueId === technique.id && matchesTechniqueWeapon(state, technique),
            effects: weaponMatchEffects(technique),
            actionDamagePercent: technique.weaponMatch.actionDamagePercent,
          },
        } : {}),
        effects: techniqueEffects(technique), action: playerActionView(state, technique.actionId),
        xpCap: technique.xpCap, masteryEffects: masteryEffects(technique), requirement: requirement(technique.unlock),
        description: [
          describeActionView(playerActionView(state, technique.actionId), actions[settings.baseActionId].name), ...techniqueEffects(technique),
          `修习 ${state.techniqueXp[technique.id] ?? '0'}/${technique.xpCap}，圆满收益：${masteryEffects(technique).join('、') || '无额外属性'}（随修习进度提升，圆满后不再增加，仅运转时生效）`,
        ].join('；'),
        xp: state.techniqueXp[technique.id] ?? '0', active: state.techniqueId === technique.id,
        unlocked: state.phase === 'active' && unlocked(state, technique.unlock) && learned(state, technique.id),
        ...(content.techniqueAcquisition ? {
          learning: {
            discovered: unlocked(state, technique.unlock), learned: learned(state, technique.id),
            ...(technique.manualItemId ? { manualItemId: technique.manualItemId } : {}),
            owned: technique.manualItemId ? state.inventory[technique.manualItemId] ?? '0' : '0',
          },
        } : {}),
      })),
      regions: content.regions.map((region) => ({
        id: region.id, name: region.name, description: region.description,
        ...getPresentation('regions', region),
        lore: region.description,
        ...('regionId' in region.unlock ? { parentId: region.unlock.regionId } : {}),
        enemies: region.enemies.map((id) => ({
          id, ...enemyPresentation(id),
          drops: enemyDrops(state, id),
          ...(region.enemyWeights ? {
            encounterChance: dec(region.enemyWeights[id]).div(region.enemies.reduce((sum, key) => sum + region.enemyWeights![key], 0)).toFixed(),
          } : {}),
        })),
        drops: [...new Set(region.enemies.flatMap((id) => enemyDrops(state, id).map((drop) =>
          `${drop.name} ×${drop.quantity}（基础 ${dec(drop.baseChance).mul(100)}%，当前 ${dec(drop.effectiveChance).mul(100)}%${drop.luckExcludedReason ? `；${drop.luckExcludedReason}` : ''}）`)))],
        ...(region.clear ? {
          clear: {
            wavesPerClear: region.clear.waves,
            completedWaves: Number(BigInt(state.regionKills[region.id] ?? '0') % BigInt(region.clear.waves)),
            clears: (BigInt(state.regionKills[region.id] ?? '0') / BigInt(region.clear.waves)).toString(),
            reward: {
              ...region.clear.reward, cultivation: text(dec(region.clear.reward.cultivation)
                .mul(dec(experienceBonus(content, state, 'combat-cultivation')).plus(1))),
            },
            ...(region.clear.firstBonus ? { firstBonus: { ...region.clear.firstBonus } } : {}),
          },
        } : {}),
        unlocked: state.phase === 'active' && unlocked(state, region.unlock), requirement: requirement(region.unlock),
      })),
      recipes: content.recipes.map((recipe) => {
        const forged = recipe.outputKind === 'equipment' ? equipment[recipe.outputId] : undefined;
        const name = forged?.name ?? items[recipe.outputId].name;
        const outputEffects = forged
          ? [...forged.modifiers.map(describeModifier), ...forged.effects.map((id) => describeEffect(effects[id])),
            ...(forged.affixCount ? [`打造时生成 ${forged.affixCount} 条词条`] : [])]
          : itemEffects(items[recipe.outputId]);
        return {
          id: recipe.id, name: recipe.name,
          ...getPresentation('recipes', recipe), effects: outputEffects,
          ...(recipe.outputKind ? { outputKind: recipe.outputKind } : {}),
          ...(forged ? { equipmentSlot: forged.slot } : {}),
          ...(forged && content.equipmentQualities ? {
            qualities: content.equipmentQualities.map(({ id, name, rarity, statMultiplier, effectMultiplier }, index) => ({
              id, name, rarity, statMultiplier, effectMultiplier,
              probability: qualityProbabilities![index],
            })),
          } : {}),
          production: {
            ...craftingTerms(state, recipe),
            ...(state.crafting[recipe.id] ?? { attempts: '0', successes: '0' }),
          },
          ...(recipe.alchemyLevel !== undefined ? {
            learning: { learned: state.history.learnedRecipes.includes(recipe.id), requiredAlchemyLevel: recipe.alchemyLevel },
          } : {}),
          outputId: recipe.outputId, outputName: name, outputQuantity: recipe.outputQuantity,
          description: `${name} ×${recipe.outputQuantity}；${outputEffects.join('；')}`,
          costs: [
            ...recipe.costs.map((cost) => ({ name: items[cost.itemId].name, itemId: cost.itemId, quantity: cost.quantity, owned: state.inventory[cost.itemId] ?? '0' })),
            { name: '灵石', itemId: 'stones', quantity: recipe.stones, owned: state.stones },
          ],
          unlocked: state.phase === 'active' && unlocked(state, recipe.unlock) && recipeMastered(state, recipe),
          requirement: [requirement(recipe.unlock), ...(recipe.alchemyLevel !== undefined
            ? [`领悟丹方且本世丹道 ${recipe.alchemyLevel} 级`] : [])].join('；'),
        };
      }),
      challenges: content.challenges.map((challenge) => {
        const enemy = challenge.enemy;
        const available = state.phase === 'active' && state.level <= challenge.maxLevel && unlocked(state, challenge.unlock);
        return {
          id: challenge.id, name: challenge.name, ...getPresentation('challenges', challenge),
          requirement: `${requirement(challenge.unlock)}；挑战者不超过${content.realms[challenge.maxLevel].name}`,
          maxLevel: challenge.maxLevel, unlocked: available,
          canStart: available && state.activity.kind !== 'dungeon' && dec(state.player.hp).gt(0),
          wins: state.challengeWins[challenge.id] ?? '0',
          enemy: {
            id: enemy.id, ...enemyPresentation(enemy.id), drops: enemyDrops(state, enemy.id),
            stats: {
              maxHp: enemy.maxHp, maxMp: enemy.maxMp, attack: enemy.attack, magicAttack: enemy.magicAttack,
              defense: enemy.defense, magicDefense: enemy.magicDefense, agility: enemy.agility,
              hpRegen: enemy.hpRegen, mpRegen: enemy.mpRegen, attackIntervalMs: enemy.attackIntervalMs,
              critChance: Number(enemy.critChance), critMultiplier: Number(enemy.critMultiplier),
            },
          },
        };
      }),
      achievements: content.achievements.map((achievement) => {
        const record = state.history.achievements[achievement.id];
        return {
          id: achievement.id, name: achievement.name, description: achievement.description, completed: Boolean(record),
          ...(record ? { completedAt: record.at, lifeId: record.lifeId } : {}),
        };
      }),
      breakthrough: foundationView(content, state),
      totals: { ...state.totals }, journal: state.journal.map((entry) => ({ ...entry, text: displayMessage(entry.text) })),
    };
  }
  return { createGame, advanceGame, applyCommand, getGameView, getPlayerStats, getActivityRates, content };
}
