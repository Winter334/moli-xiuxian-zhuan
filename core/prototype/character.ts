import { z } from 'zod';
import { dec, integerAdd, random, text } from '../numbers';
import { worldCalendarAt } from './calendar';
import {
  addStack, awardItem, characterStats, cleared, defeatDestination, equippedWeaponSkill, gainCharacterExperience, gainCharacterSkill, isUnlocked, readCharacter, record, synchronizeCharacter, type CharacterState,
} from './character-state';
import { CharacterCommandError, commandEntry } from './command-error';
import { combatPower, COMBAT_POWER_VERSION } from './combat-power';
import { ARMOR_ASSEMBLIES, ASSEMBLIES, ENEMIES, FOOD_EFFECTS, ITEMS, MANOR_AID, RECIPES, REGIONS, SAFE_LOCATIONS, SHOPS, SHOP_IDS, SLOTS, encounterEnemy, encounterNeedsEntry, encounterPool, enemyRealmName, foodEffectSource, lookup, shopAtLocation, type LootEntry } from './content';
import { DIVINE_ARTS, DIVINE_ART_IDS, divineArtIdSchema } from './divine-arts';
import { absorbMarrow, assemble, assembleArmor, craft, craftingRates, foodDuration, itemUseIssue, marrowAbsorptionPreview, purchasePrice, refreshShop, trade, upgradeFurnace, useItem } from './economy';
import { activeSources, healingValue, positiveValue, scaledSource } from './effects';
import { equipmentSource, itemValue } from './equipment';
import { FATES, FATE_TIERS } from './fates';
import { FURNACES, furnaceTierSchema } from './furnace';
import { FOUNDATION_ROOTS } from './foundation';
import { advanceWork, gatheringSkill, MINING_SITE_IDS, MINING_SITES, miningEfficiency, miningSiteIdSchema, miningSpeed } from './gathering';
import { FOUNDATION_LEVEL, killExperience, killExperienceRealmFactor, LEVEL_CAP, realmAt, realmName } from './growth';
import { incrementRecord, markMilestone } from './history';
import { describeLogGain, describeRealmFactor } from './log';
import { allExperienceMultiplier, ARTIFACT_SKILLS, initialSkills, MANUAL_IDS, MANUALS, manualIdSchema, manualSource, manualTargetCount, masteryBonuses, masteryProgress, MEDITATION_STAGES, SKILL_IDS, SKILLS, skillSources, threshold, TRAINING_IDS, TRAININGS, trainingAt, trainingIdSchema, type ArtifactSkillId, type SkillId } from './skills';
import { advanceSimulation, getPlayerStats, setRecoveryMode, startEncounter, withdraw } from './simulation';
import type { SimulationEvent, SimulationHooks, StatSource } from './types';

const batch = z.number().int().min(1).max(10000);
const id = z.string().min(1).max(100);
const shopId = z.enum(SHOP_IDS);
const selection = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stack'), itemId: id }).strict(),
  z.object({ kind: z.literal('instance'), instanceId: id }).strict(),
]);
export const characterCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('travel'), locationId: id }).strict(),
  z.object({ type: z.literal('arrive'), regionId: id }).strict(),
  z.object({ type: z.literal('explore') }).strict(),
  z.object({ type: z.literal('enter'), regionId: id }).strict(),
  z.object({ type: z.literal('withdraw') }).strict(),
  z.object({ type: z.literal('recover'), mode: z.enum(['rest', 'sleep']) }).strict(),
  z.object({ type: z.literal('craft'), recipeId: id, quantity: batch }).strict(),
  z.object({ type: z.literal('upgrade-furnace'), tier: furnaceTierSchema }).strict(),
  z.object({ type: z.literal('assemble'), bladeId: id, hiltId: id }).strict(),
  z.object({ type: z.literal('assemble-armor'), interiorId: id, exteriorId: id }).strict(),
  z.object({ type: z.literal('equip'), instanceId: id }).strict(),
  z.object({ type: z.literal('unequip'), slot: z.enum(SLOTS) }).strict(),
  z.object({ type: z.literal('use'), itemId: id, quantity: batch }).strict(),
  z.object({ type: z.literal('visit-shop'), shopId }).strict(),
  z.object({ type: z.literal('buy'), shopId, target: selection, quantity: batch }).strict(),
  z.object({ type: z.literal('sell'), shopId, target: selection, quantity: batch }).strict(),
  z.object({ type: z.literal('learn-manual'), manualId: manualIdSchema }).strict(),
  z.object({ type: z.literal('activate-manual'), manualId: manualIdSchema.nullable() }).strict(),
  z.object({ type: z.literal('activate-divine-art'), divineArtId: divineArtIdSchema.nullable() }).strict(),
  z.object({ type: z.literal('train'), skillId: trainingIdSchema.nullable() }).strict(),
  z.object({ type: z.literal('gather'), siteId: miningSiteIdSchema.nullable() }).strict(),
  z.object({ type: z.literal('claim-manor-aid') }).strict(),
  z.object({ type: z.literal('absorb-marrow') }).strict(),
]);
export type CharacterCommand = z.infer<typeof characterCommandSchema>;

// Transient output only. Callers publish it only after accepting the resulting checkpoint.
export interface CharacterEvent {
  life: string;
  regionId: string | null;
  group: string;
  event: SimulationEvent;
}

export { CharacterCommandError } from './command-error';

function meditationExperience(state: CharacterState): string {
  return MEDITATION_STAGES.reduce<string>((xp, stage) =>
    stage.prerequisite === null || cleared(state, stage.prerequisite) ? stage.xp : xp, '1');
}

export function rollLoot(
  rng: { rng: number }, entries: readonly LootEntry[], multiplier = '1', luck = '1', sources: readonly StatSource[] = [],
) {
  if (dec(multiplier).lt(0) || dec(luck).lt(0)) throw new Error('Invalid loot multiplier');
  const items: Record<string, string> = {};
  for (const entry of entries) {
    const raw = text(dec(entry.chance).mul(entry.ignoreLuck ? 1 : dec(multiplier).mul(luck)));
    const chance = dec(entry.ignoreLuck ? raw : positiveValue(raw, 'loot.quantity', sources, { tags: ['loot'] }));
    const whole = chance.floor();
    const amount = whole.plus(dec(random(rng)).lt(chance.minus(whole)) ? 1 : 0);
    if (amount.gt(0)) {
      lookup(ITEMS, entry.itemId);
      items[entry.itemId] = integerAdd(items[entry.itemId] ?? '0', text(amount));
    }
  }
  return items;
}

function characterHooks(state: CharacterState, events?: CharacterEvent[]): SimulationHooks {
  return {
    stopOnEncounterEnd: true,
    getMoney: () => state.money,
    getSturdyCap: () => state.equipment.special
      ? ITEMS[state.instances[state.equipment.special].itemId].sturdyCap ?? 1 : 1,
    getPlayerTargetCount: () => manualTargetCount(state.activeManual, state.activeManual ? state.skills[state.activeManual]!.level : 0),
    settle(simulation, event) {
      state.simulation = simulation;
      if (events && event.kind !== 'pulse') events.push({
        life: state.life.number, regionId: simulation.battle?.regionId ?? null,
        group: simulation.clearedGroups[simulation.battle?.regionId ?? ''] ?? '0',
        event: structuredClone(event),
      });
      const sources = activeSources(simulation);
      let changed = false;
      let fullHeal = false;
      if (event.kind === 'strike') {
        if (event.side === 'player') {
          const battle = simulation.battle!;
          const enemy = encounterEnemy(battle.regionId, battle.enemies[event.slot].definition.id);
          changed = gainCharacterSkill(state, 'combat', enemy.xp);
          if (event.hit) {
            changed = gainCharacterSkill(state, equippedWeaponSkill(state), enemy.xp) || changed;
            const artifact = state.equipment.artifact ? state.instances[state.equipment.artifact].itemId : null;
            if (artifact && Object.hasOwn(ARTIFACT_SKILLS, artifact)) {
              changed = gainCharacterSkill(state, artifact as ArtifactSkillId, enemy.xp) || changed;
            }
          }
        } else if (event.hit && !simulation.battle!.enemies[event.slot].definition.abilities.noToughnessXp) {
          changed = gainCharacterSkill(state, 'toughness', text(dec(event.incomingPower).div(10)));
        }
      } else if (event.kind === 'enemy-healed') {
        record(state, `${ENEMIES[simulation.battle!.enemies[event.slot].definition.id].name}回春，气血+${event.amount}`);
      } else if (event.kind === 'reflection') {
        record(state, `反震，损失${event.hpLost}气血`);
      } else if (event.kind === 'tidal-pressure' || event.kind === 'health-burst') {
        if (dec(event.hpLost).gt(0)) record(state, `${event.kind === 'tidal-pressure' ? '潮压' : '囊爆'}，损失${event.hpLost}气血`);
      } else if (event.kind === 'player-action-completed' && state.activeManual) {
        const xp = text(event.targetIds.reduce((sum, id) =>
          sum.plus(encounterEnemy(event.regionId, id).xp), dec(0)).div(event.targetIds.length));
        changed = gainCharacterSkill(state, state.activeManual, xp);
      } else if (event.kind === 'enemy-defeated') {
        incrementRecord(state.history.kills, event.enemyId);
        const enemy = encounterEnemy(event.regionId, event.enemyId);
        const realmFactor = killExperienceRealmFactor(enemy.realm, state.level);
        const xp = killExperience(enemy.xp, enemy.realm, state.level, event.groupSize, allExperienceMultiplier(state.skills));
        const reward = gainCharacterExperience(state, xp, undefined, true, ['activity', 'kill']);
        ({ changed, fullHeal } = reward);
        const loot = rollLoot(simulation, enemy.loot, enemy.lootMultiplier, '1', sources);
        for (const [id, count] of Object.entries(loot)) awardItem(state, id, count);
        const drops = Object.entries(loot).map(([id, count]) => `${ITEMS[id].name}×${count}`).join('、');
        const capped = dec(reward.earned).gt(reward.credited) ? '，封顶溢出未计入' : '';
        record(state, `击败${enemy.name}，${describeLogGain('修为', reward.credited)}（${describeRealmFactor(realmFactor)}${capped}）${drops ? `，${drops}` : ''}`);
      } else if (event.kind === 'group-cleared') {
        const region = lookup(REGIONS, event.regionId);
        if (BigInt(event.total) % BigInt(region.groups) === 0n) {
          const first = BigInt(event.total) === BigInt(region.groups);
          if (first) markMilestone(state, 'firstClears', event.regionId);
          const xp = text(dec(first ? region.firstXp : region.repeatXp).mul(allExperienceMultiplier(state.skills)));
          const reward = gainCharacterExperience(state, xp, undefined, true, ['activity', 'clear']);
          ({ changed, fullHeal } = reward);
          record(state, `${region.name}${first ? '首次清理完成' : '再次清理完成'}，${describeLogGain('修为', reward.credited)}${dec(reward.earned).gt(reward.credited) ? '（封顶溢出未计入）' : ''}`);
          if (first || region.challenge) simulation.mode = 'idle';
          if (!first && region.repeatLoot && state.level <= region.repeatLoot.maxLevel) {
            const loot = rollLoot(simulation, region.repeatLoot.entries, '1', '1', sources);
            for (const [id, count] of Object.entries(loot)) {
              awardItem(state, id, count);
              record(state, `清剿所得：${ITEMS[id].name}×${count}`);
            }
          }
          if (first) {
            if (event.regionId === MANOR_AID.finalRegionId) {
              const seals = Object.entries(state.instances).filter(([, item]) => item.itemId === MANOR_AID.itemId);
              for (const [uid] of seals) {
                if (state.equipment.special === uid) state.equipment.special = null;
                delete state.instances[uid];
              }
              if (seals.length) {
                changed = true;
                record(state, '中枢禁令已解，巡枢残印归入石台');
              }
            }
            const items = Object.entries(region.firstItems ?? {});
            for (const [id, count] of items) awardItem(state, id, count);
            if (items.length) record(state, `清理奖励：${items.map(([id, count]) => `${ITEMS[id].name}×${count}`).join('、')}`);
            const locations = Object.values(SAFE_LOCATIONS).filter((location) => location.prerequisite === event.regionId);
            const regions = Object.values(REGIONS).filter((entry) => entry.prerequisite === event.regionId);
            if (locations.length || regions.length) {
              record(state, `已开放：${[...locations, ...regions].map((location) => location.name).join('、')}`);
            }
            const shops = Object.values(SHOPS).filter((shop) => shop.prerequisite === event.regionId);
            if (shops.length) record(state, `已开放商铺：${shops.map((shop) => shop.name).join('、')}`);
            const manuals = Object.values(MANUALS).filter((manual) => manual.prerequisite === event.regionId);
            if (manuals.length) record(state, `已可领悟：${manuals.map((manual) => manual.name).join('、')}`);
          }
        }
      } else if (event.kind === 'fainted') {
        state.history.defeats = integerAdd(state.history.defeats, 1);
        delete state.training;
        delete state.gathering;
        state.locationId = defeatDestination(state);
        markMilestone(state, 'firstVisits', state.locationId);
        record(state, `战败，返回${SAFE_LOCATIONS[state.locationId].name}歇息`);
      } else if (event.kind === 'pulse' && event.sleeping && simulation.mode === 'sleep') {
        changed = gainCharacterSkill(state, 'rest', meditationExperience(state));
      } else if (event.kind === 'pulse' && state.training) {
        const activity = trainingAt(state.training, state.locationId)!;
        changed = gainCharacterSkill(state, state.training,
          positiveValue(activity.xp, 'activity.speed', sources, { tags: ['training', 'activity'] }));
      } else if (event.kind === 'pulse' && state.gathering) {
        const activity = state.gathering;
        const skillId = gatheringSkill(activity.siteId);
        activity.elapsed = advanceWork(activity.elapsed, '1', miningSpeed(sources, skillId));
        while (dec(activity.elapsed).gte(activity.cycleSeconds)) {
          activity.elapsed = text(dec(activity.elapsed).minus(activity.cycleSeconds));
          const site = MINING_SITES[activity.siteId];
          if (activity.siteId === 'jade-seam') state.jadeSeamCompletions!++;
          const efficiency = miningEfficiency(activity.siteId, state.skills[skillId]!.level,
            activity.siteId === 'jade-seam' ? state.jadeSeamCompletions : 0);
          const success = dec(random(simulation)).lt(efficiency.chance);
          const mining = state.history.mining[activity.siteId] ??= { cycles: '0', successes: '0' };
          mining.cycles = integerAdd(mining.cycles, 1);
          const quantity = efficiency.maxQuantity > 1 ? 1 + Math.floor(random(simulation) * efficiency.maxQuantity) : 1;
          if (success) {
            addStack(state.inventory, site.itemId, quantity);
            mining.successes = integerAdd(mining.successes, 1);
            if (skillId === 'logging') mining.produced = integerAdd(mining.produced ?? '0', quantity);
            incrementRecord(state.history.gathered, site.itemId, quantity);
          }
          // The next period is refreshed before this cycle's proficiency reward.
          activity.cycleSeconds = efficiency.cycleSeconds;
          changed = gainCharacterSkill(state, skillId, site.xp) || changed;
          record(state, `${site.name}：${success ? `${ITEMS[site.itemId].name}×${quantity}` : '未采得矿物'}，${SKILLS[skillId].name}熟练增长`);
        }
      }
      return changed ? { ...characterStats(state), fullHeal } : undefined;
    },
  };
}

function startNextGroup(state: CharacterState, events?: CharacterEvent[]) {
  if (state.simulation.battle || !Object.hasOwn(REGIONS, state.locationId)) return;
  const region = REGIONS[state.locationId];
  if (dec(state.simulation.player.hp).lte(0)) {
    state.locationId = defeatDestination(state);
    state.simulation.mode = 'rest';
    return;
  }
  const pool = encounterPool(state.locationId, state.simulation.clearedGroups[state.locationId] ?? '0');
  const groupSize = region.randomGroupSize ? 1 + Math.floor(random(state.simulation) * 2) : region.groupSize;
  const enemyIds = Array.from({ length: groupSize }, () =>
    pool[Math.floor(random(state.simulation) * pool.length)]);
  const stats = getPlayerStats(state.simulation);
  const entry = encounterNeedsEntry(state.locationId, enemyIds) ? {
    attack: stats.attack, defense: stats.defense, agility: stats.agility,
    manorSeal: Boolean(state.equipment.special && state.instances[state.equipment.special].itemId === MANOR_AID.itemId),
  } : undefined;
  const enemies = enemyIds.map(id => encounterEnemy(state.locationId, id, entry).definition);
  for (const id of enemyIds) markMilestone(state, 'firstEncounters', id);
  if (state.locationId === MANOR_AID.finalRegionId && entry?.manorSeal) {
    record(state, '巡枢残印引动旧阵，涵岳枢灵的攻防敏血压至百分之一');
  }
  state.simulation = startEncounter(state.simulation, { regionId: state.locationId, enemies, entry }, characterHooks(state, events)).state;
}

export function advanceCharacter(input: CharacterState, targetMs: number, maxSteps = 1000, events?: CharacterEvent[]): CharacterState {
  const state = readCharacter(input);
  if (!Number.isSafeInteger(targetMs) || targetMs < state.simulation.clockMs ||
      targetMs > Number.MAX_SAFE_INTEGER - 3_600_000 || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 10000) {
    throw new Error('Invalid character catch-up target or budget');
  }
  let remaining = maxSteps;
  if (targetMs > state.simulation.clockMs && state.level === FOUNDATION_LEVEL &&
      dec(state.cultivation).gte(realmAt(state.level + 1).entryCost)) {
    const result = gainCharacterExperience(state, '0');
    synchronizeCharacter(state);
    if (result.fullHeal && dec(state.simulation.player.hp).gt(0)) state.simulation.player.hp = getPlayerStats(state.simulation).maxHp;
  }
  while (state.simulation.clockMs < targetMs && remaining > 0) {
    const result = advanceSimulation(state.simulation, targetMs, remaining, characterHooks(state, events));
    state.simulation = result.state;
    remaining -= result.processedSteps;
    // A cleared group continues at the same checkpoint; idle is an explicit stop.
    if (state.simulation.mode !== 'idle') startNextGroup(state, events);
  }
  return readCharacter(state);
}

function arriveAtRegion(state: CharacterState, regionId: string) {
  commandEntry(REGIONS, regionId, '没有这个历练地点');
  if (state.simulation.battle) throw new CharacterCommandError('请先撤退再前往其它地点');
  if (!isUnlocked(state, regionId)) throw new CharacterCommandError('此区域尚不可到达');
  if (state.locationId === regionId) return;
  state.locationId = regionId;
  markMilestone(state, 'firstVisits', regionId);
  delete state.training;
  delete state.gathering;
  state.simulation.mode = 'idle';
}

function beginExploration(state: CharacterState, events?: CharacterEvent[]) {
  const region = commandEntry(REGIONS, state.locationId, '此处没有可探索的战区');
  if (state.simulation.mode !== 'idle' || (region.challenge && cleared(state, state.locationId))) {
    throw new CharacterCommandError('当前不能开始探索或挑战已完成');
  }
  if (dec(state.simulation.player.hp).lte(0)) throw new CharacterCommandError('请先恢复气血');
  startNextGroup(state, events);
}

// Commands run on a detached snapshot. A rejection never spends resources or RNG.
// The service must settle online time or skip paused time before calling this entry.
export function executeCharacterCommand(input: CharacterState, raw: CharacterCommand, worldTimeMs = Date.now(), events?: CharacterEvent[]): CharacterState {
  const parsed = characterCommandSchema.safeParse(raw);
  if (!parsed.success) throw new CharacterCommandError('操作参数无效');
  const command = parsed.data;
  const state = readCharacter(input);
  const interruptsMeditation = ['craft', 'upgrade-furnace', 'assemble', 'assemble-armor'].includes(command.type) ||
    (command.type === 'train' && command.skillId !== null) || (command.type === 'gather' && command.siteId !== null);
  if (state.simulation.mode === 'sleep' && interruptsMeditation) {
    state.simulation = setRecoveryMode(state.simulation, 'rest');
  }
  switch (command.type) {
    case 'travel': {
      if (state.simulation.battle) throw new CharacterCommandError('请先撤退再前往其它地点');
      if (!Object.hasOwn(SAFE_LOCATIONS, command.locationId) || !isUnlocked(state, command.locationId)) {
        throw new CharacterCommandError('此地点尚不可达');
      }
      if (state.locationId === command.locationId) break;
      state.locationId = command.locationId;
      markMilestone(state, 'firstVisits', command.locationId);
      delete state.training;
      delete state.gathering;
      state.simulation = setRecoveryMode(state.simulation, 'rest');
      break;
    }
    case 'arrive':
      arriveAtRegion(state, command.regionId);
      break;
    case 'explore':
      beginExploration(state, events);
      break;
    case 'enter': {
      arriveAtRegion(state, command.regionId);
      beginExploration(state, events);
      break;
    }
    case 'withdraw':
      if (!state.simulation.battle) throw new CharacterCommandError('当前没有战斗');
      state.locationId = lookup(REGIONS, state.locationId).parent;
      state.simulation = withdraw(state.simulation);
      state.history.withdrawals = integerAdd(state.history.withdrawals, 1);
      markMilestone(state, 'firstVisits', state.locationId);
      break;
    case 'recover':
      if (state.simulation.battle) throw new CharacterCommandError('请先撤退');
      if (Object.hasOwn(REGIONS, state.locationId)) {
        throw new CharacterCommandError('战区不能歇息或调息，请前往安全地点');
      }
      if (command.mode === 'sleep' && !SAFE_LOCATIONS[state.locationId]?.meditation) {
        throw new CharacterCommandError('此处不宜调息，请前往可调息的安全地点');
      }
      delete state.training;
      delete state.gathering;
      state.simulation = setRecoveryMode(state.simulation, command.mode);
      break;
    case 'train': {
      if (command.skillId === null) {
        delete state.training;
        break;
      }
      const training = trainingAt(command.skillId, state.locationId);
      if (!training || !cleared(state, training.prerequisite) || state.simulation.mode !== 'rest') {
        throw new CharacterCommandError('请先前往已开放的训练地点并结束其它活动');
      }
      if (!state.skills[command.skillId]) state.skills[command.skillId] = { level: 0, xp: '0' };
      delete state.gathering;
      state.training = command.skillId;
      synchronizeCharacter(state);
      record(state, `开始${training.actionName}`);
      break;
    }
    case 'gather': {
      if (command.siteId === null) {
        delete state.gathering;
        break;
      }
      const site = MINING_SITES[command.siteId];
      if (state.locationId !== site.location || !cleared(state, site.prerequisite) || state.simulation.mode !== 'rest') {
        throw new CharacterCommandError('请先前往已开放的采集点所在地点并退出战斗');
      }
      if (state.gathering?.siteId === command.siteId) break;
      const skillId = gatheringSkill(command.siteId);
      if (!state.skills[skillId]) state.skills[skillId] = { level: 0, xp: '0' };
      if (command.siteId === 'jade-seam' && state.jadeSeamCompletions === undefined) state.jadeSeamCompletions = 0;
      delete state.training;
      state.gathering = {
        siteId: command.siteId, elapsed: '0',
        cycleSeconds: miningEfficiency(command.siteId, state.skills[skillId]!.level,
          command.siteId === 'jade-seam' ? state.jadeSeamCompletions : 0).cycleSeconds,
      };
      record(state, `开始${SKILLS[skillId].name}：${site.name}`);
      break;
    }
    case 'claim-manor-aid':
      if (state.locationId !== MANOR_AID.locationId || !cleared(state, MANOR_AID.prerequisite) ||
          state.manorAidClaimed || cleared(state, MANOR_AID.finalRegionId)) {
        throw new CharacterCommandError('需在涵岳总枢挑战完成前抵达内院阵台；巡枢残印仅能领取一次');
      }
      awardItem(state, MANOR_AID.itemId, 1);
      state.manorAidClaimed = true;
      record(state, `取得${ITEMS[MANOR_AID.itemId].name}`);
      break;
    case 'craft':
      craft(state, command.recipeId, command.quantity);
      break;
    case 'upgrade-furnace':
      upgradeFurnace(state, command.tier);
      break;
    case 'absorb-marrow':
      absorbMarrow(state);
      break;
    case 'assemble':
      assemble(state, command.bladeId, command.hiltId);
      break;
    case 'assemble-armor':
      assembleArmor(state, command.interiorId, command.exteriorId);
      break;
    case 'equip': {
      const instance = commandEntry(state.instances, command.instanceId, '此器物已不在行囊中');
      const item = lookup(ITEMS, instance.itemId);
      if (!item.slot) throw new CharacterCommandError('炼材不能直接装备');
      state.equipment[item.slot] = command.instanceId;
      if (item.weaponSkill === 'greatsword' && !state.skills.greatsword) {
        state.skills.greatsword = { level: 0, xp: '0' };
      }
      if (Object.hasOwn(ARTIFACT_SKILLS, instance.itemId)) {
        const skill = instance.itemId as ArtifactSkillId;
        if (!state.skills[skill]) state.skills[skill] = { level: 0, xp: '0' };
      }
      synchronizeCharacter(state);
      break;
    }
    case 'unequip':
      if (state.equipment[command.slot] == null) throw new CharacterCommandError('此部位没有装备');
      state.equipment[command.slot] = null;
      synchronizeCharacter(state);
      break;
    case 'use':
      useItem(state, command.itemId, command.quantity);
      break;
    case 'learn-manual': {
      const manual = MANUALS[command.manualId];
      if (state.locationId !== manual.location || !cleared(state, manual.prerequisite)) {
        throw new CharacterCommandError(`需完成${REGIONS[manual.prerequisite].name}，并前往${SAFE_LOCATIONS[manual.location].name}领悟`);
      }
      if (state.skills[command.manualId]) throw new CharacterCommandError('已经领悟此功法');
      state.skills[command.manualId] = { level: 0, xp: '0' };
      record(state, `领悟${manual.name}`);
      break;
    }
    case 'activate-manual':
      if (command.manualId === null) {
        delete state.activeManual;
        record(state, '停止运转功法');
      } else {
        if (!state.skills[command.manualId]) throw new CharacterCommandError('尚未领悟此功法');
        state.activeManual = command.manualId;
        record(state, `运转${MANUALS[command.manualId].name}`);
      }
      synchronizeCharacter(state);
      break;
    case 'activate-divine-art':
      if (command.divineArtId !== null && !state.learnedDivineArts.includes(command.divineArtId)) {
        throw new CharacterCommandError('尚未掌握此神通');
      }
      if (state.activeDivineArt === command.divineArtId) break;
      state.activeDivineArt = command.divineArtId;
      record(state, command.divineArtId === null ? '停止运转神通' : `运转${DIVINE_ARTS[command.divineArtId].name}`);
      synchronizeCharacter(state);
      break;
    case 'visit-shop':
      refreshShop(state, command.shopId, worldTimeMs);
      break;
    case 'buy':
    case 'sell':
      trade(state, command.shopId, command.type, command.target, command.quantity, worldTimeMs);
      break;
  }
  return readCharacter(state);
}

export function getCharacterView(input: CharacterState, worldTimeMs = Date.now()) {
  const state = readCharacter(input);
  const simulation = state.simulation;
  const sources = activeSources(simulation);
  const weapon = equippedWeaponSkill(state);
  const passiveSkillSources = skillSources(state.skills, weapon);
  const skillBonusGroups = (id: SkillId) => {
    const groups = passiveSkillSources.filter(source => source.id === `skill:${id}` || source.id === `skill:${id}-milestones`)
      .map(source => ({ label: '常驻加成', active: true, source }));
    if (id === 'unarmed' || id === 'sword' || id === 'greatsword') {
      const source = skillSources(state.skills, id).find(entry => entry.id === 'skill:weapon')!;
      groups.push({
        label: { unarmed: '空手时', sword: '持剑时', greatsword: '持重剑时' }[id],
        active: weapon === id, source,
      });
    }
    const manualId = MANUAL_IDS.find(entry => entry === id);
    if (manualId) groups.push({
      label: '运转时', active: state.activeManual === manualId,
      source: manualSource(manualId, state.skills[manualId]!.level),
    });
    return groups.flatMap(group => {
      const source = scaledSource(group.source, sources);
      const flat = Object.fromEntries(Object.entries(source.flat ?? {}).filter(([, value]) => !dec(value).eq(0)));
      const multiplier = Object.fromEntries(Object.entries(source.multiplier ?? {}).filter(([, value]) => !dec(value).eq(1)));
      return Object.keys(flat).length || Object.keys(multiplier).length
        ? [{ label: group.label, active: group.active, bonuses: { ...source, flat, multiplier } }] : [];
    });
  };
  const currentShopId = shopAtLocation(REGIONS[state.locationId]?.parent ?? state.locationId) ?? 'village-stall';
  const shopDefinition = SHOPS[currentShopId];
  const shop = state[shopDefinition.stateKey];
  const shopUnlocked = shopDefinition.prerequisite === null || cleared(state, shopDefinition.prerequisite);
  const workshop = FURNACES[state.furnaceTier];
  const resting = simulation.mode === 'rest' || simulation.mode === 'sleep';
  const workshopAvailable = resting || simulation.mode === 'idle';
  const upgradeCosts = Object.entries(workshop.upgrade?.materials ?? {}).map(([itemId, required]) => ({
    itemId, name: ITEMS[itemId].name, required, owned: state.inventory[itemId] ?? '0',
  }));
  const itemUse = (itemId: string) => {
    const item = ITEMS[itemId];
    if (item.kind !== 'food' && item.kind !== 'marrow' && item.kind !== 'insight' && item.kind !== 'foundation-pill') return null;
    const food = item.kind === 'food' ? item.foodEffects!.map(id => ({
      ...lookup(FOOD_EFFECTS, id), durationMs: foodDuration(state, id),
      source: scaledSource(foodEffectSource(id), sources),
    })) : null;
    const effectText = food?.map(effect => {
      const flat = effect.source.flat ?? {};
      const healing = (amount: string) => healingValue(amount, sources, ['regeneration', 'supply', effect.polarity]);
      const bonuses = [
        ...(effect.description ? [effect.description] : []),
        ...(flat.hpRegen ? [`气血回复${dec(flat.hpRegen).gte(0) ? '+' : ''}${healing(flat.hpRegen)}/秒`] : []),
        ...(flat.attack ? [`攻击/防御/敏捷各+${flat.attack}`] : []),
        ...(flat.hpRegenPercent ? [`气血${dec(flat.hpRegenPercent).gte(0) ? '+' : ''}${text(dec(healing(flat.hpRegenPercent)).mul(100))}%/秒`] : []),
      ];
      return `${effect.name}：${bonuses.join('，')}，${effect.durationMs / 1000}秒`;
    }).join('；同时施加');
    let foodRealmName = '';
    if (food) {
      let maxLevel = LEVEL_CAP;
      while (maxLevel > 0 && dec(realmAt(maxLevel).effectiveRealm).gt(food[0].maxRealm)) maxLevel--;
      foodRealmName = realmName(maxLevel);
    }
    return {
      issue: itemUseIssue(state, itemId),
      maxBatch: item.kind === 'foundation-pill' ? 1 : 10000,
      description: item.kind === 'foundation-pill'
        ? `${FOUNDATION_ROOTS[item.foundationRoot!].name}；仅炼气十二层修满可用，消耗1颗与6000万修为，必成；境界基础四维加成${text(dec(FOUNDATION_ROOTS[item.foundationRoot!].bonusRate).mul(100))}%，不加成装备、灵髓或熟练`
        : food
        ? `${effectText}；同效续时；${foodRealmName}及以下`
        : item.experience
          ? `修为+${item.experience.amount}，不乘经验加成，不提供突破许可；炼气十二层最高6000万，超出不保存`
          : `随机永久增长：攻/防/敏 +${item.marrowValue} 或气血 +${item.marrowValue! * 50}，随累计增长递减`,
    };
  };
  const inventory = (items: Record<string, string>) => Object.entries(items).map(([itemId, quantity]) => {
    const item = ITEMS[itemId];
    return {
      itemId, name: item.name, kind: item.kind, quantity, description: item.description ?? null,
      sellPrice: itemValue(itemId), buyPrice: purchasePrice(state, currentShopId, itemId),
      use: itemUse(itemId),
    };
  });
  const instances = (items: CharacterState['instances']) => Object.entries(items).map(([instanceId, item]) => ({
    instanceId, ...item, name: ITEMS[item.itemId].name, slot: ITEMS[item.itemId].slot ?? null,
    description: ITEMS[item.itemId].description ?? null,
    effectDescription: ITEMS[item.itemId].effectDescription ?? null,
    equipped: Object.values(state.equipment).includes(instanceId),
    tier: ITEMS[item.itemId].tier ?? null,
    bonuses: ITEMS[item.itemId].kind === 'equipment' ? scaledSource(equipmentSource(instanceId, item), sources) : null,
    sellPrice: itemValue(item.itemId, item.quality), buyPrice: purchasePrice(state, currentShopId, item.itemId, item.quality),
  }));
  const calendar = worldCalendarAt(worldTimeMs);
  const fate = FATES[state.fateId];
  return {
    schemaVersion: state.schemaVersion, contentVersion: state.contentVersion, clockMs: simulation.clockMs,
    life: { ...state.life },
    history: structuredClone(state.history),
    fate: { id: state.fateId, name: fate.name, tier: fate.tier,
      tierName: FATE_TIERS[fate.tier].name, description: fate.description, effectDescription: fate.effectDescription },
    level: state.level, realmName: realmName(state.level), cultivation: state.cultivation,
    nextLevelCost: state.level < LEVEL_CAP ? realmAt(state.level + 1).entryCost : null,
    foundationRequired: state.level === FOUNDATION_LEVEL - 1,
    foundationName: state.foundationRoot === null ? null : FOUNDATION_ROOTS[state.foundationRoot].name,
    marrowAbsorption: marrowAbsorptionPreview(state),
    stats: getPlayerStats(simulation), hp: simulation.player.hp, mode: simulation.mode,
    combatPower: { score: combatPower(state), version: COMBAT_POWER_VERSION },
    locationId: state.locationId,
    locationName: (REGIONS[state.locationId] ?? SAFE_LOCATIONS[state.locationId]).name,
    locationDescription: (REGIONS[state.locationId] ?? SAFE_LOCATIONS[state.locationId]).description ?? null,
    isSafeLocation: Object.hasOwn(SAFE_LOCATIONS, state.locationId),
    rankingsAvailable: Boolean(SAFE_LOCATIONS[state.locationId]?.rankings),
    manorAid: state.locationId === MANOR_AID.locationId ? {
      claimed: Boolean(state.manorAidClaimed), finished: cleared(state, MANOR_AID.finalRegionId), name: ITEMS[MANOR_AID.itemId].name,
    } : null,
    calendar, money: state.money, currencyUnit: '灵石',
    skills: SKILL_IDS.flatMap((id) => {
      const progress = id === 'manual-mastery' || id === 'weapon-mastery' ? masteryProgress(state.skills, id) : state.skills[id];
      return progress ? [{
        id, name: SKILLS[id].name, ...progress,
        nextThreshold: progress.level < SKILLS[id].max ? threshold(id, progress.level + 1) : null,
        bonusGroups: skillBonusGroups(id),
        experienceMultiplier: allExperienceMultiplier({ ...initialSkills(), [id]: progress }),
        masteryBonuses: id === 'manual-mastery' || id === 'weapon-mastery' ? masteryBonuses(state.skills, id) : [],
      }] : [];
    }),
    activeManual: state.activeManual ?? null,
    activeDivineArt: state.activeDivineArt,
    divineArts: DIVINE_ART_IDS.map(id => ({
      id, name: DIVINE_ARTS[id].name, description: DIVINE_ARTS[id].description,
      learned: state.learnedDivineArts.includes(id), active: state.activeDivineArt === id,
      requirement: `${realmName(DIVINE_ARTS[id].minLevel)}时掌握`,
      bonuses: scaledSource(DIVINE_ARTS[id].source, sources),
    })),
    canMeditate: Boolean(SAFE_LOCATIONS[state.locationId]?.meditation),
    meditationBaseXp: meditationExperience(state),
    gathering: state.gathering ? {
      ...state.gathering, name: MINING_SITES[state.gathering.siteId].name,
      skillId: gatheringSkill(state.gathering.siteId),
      speed: miningSpeed(sources, gatheringSkill(state.gathering.siteId)),
      chance: miningEfficiency(state.gathering.siteId, state.skills[gatheringSkill(state.gathering.siteId)]!.level).chance,
    } : null,
    miningSites: MINING_SITE_IDS.filter(id => MINING_SITES[id].location === state.locationId).map(id => ({
      id, name: MINING_SITES[id].name, itemName: ITEMS[MINING_SITES[id].itemId].name,
      skillId: gatheringSkill(id),
      ...miningEfficiency(id, state.skills[gatheringSkill(id)]?.level ?? 0, id === 'jade-seam' ? state.jadeSeamCompletions ?? 0 : 0),
      cycleSeconds: dec(miningEfficiency(id, state.skills[gatheringSkill(id)]?.level ?? 0,
        id === 'jade-seam' ? state.jadeSeamCompletions ?? 0 : 0).cycleSeconds).div(miningSpeed(sources, gatheringSkill(id))).toNumber(),
      completed: id === 'jade-seam' ? state.jadeSeamCompletions ?? 0 : null,
      available: resting && cleared(state, MINING_SITES[id].prerequisite), active: state.gathering?.siteId === id,
    })),
    training: state.training ? { id: state.training, name: trainingAt(state.training, state.locationId)!.actionName } : null,
    trainings: TRAINING_IDS.flatMap(id => {
      const action = trainingAt(id, state.locationId);
      return action ? [{
        id, name: action.actionName, skillName: TRAININGS[id].name, active: state.training === id,
        available: resting && cleared(state, action.prerequisite),
      }] : [];
    }),
    manuals: MANUAL_IDS.map((id) => {
      const manual = MANUALS[id];
      const progress = state.skills[id];
      return {
        id, name: manual.name, description: manual.description, learned: Boolean(progress), active: state.activeManual === id,
        unlocked: cleared(state, manual.prerequisite),
        learnable: !progress && cleared(state, manual.prerequisite) && state.locationId === manual.location,
        locationName: isUnlocked(state, manual.location) ? SAFE_LOCATIONS[manual.location].name : null,
        prerequisiteName: isUnlocked(state, manual.prerequisite) ? REGIONS[manual.prerequisite].name : null,
        level: progress?.level ?? 0, xp: progress?.xp ?? '0', maxLevel: manual.max,
        nextThreshold: (progress?.level ?? 0) < manual.max ? threshold(id, (progress?.level ?? 0) + 1) : null,
        bonuses: scaledSource(manualSource(id, progress?.level ?? 0), sources),
        targetCount: manualTargetCount(id, progress?.level ?? 0),
      };
    }),
    marrow: { ...state.marrow }, inventory: inventory(state.inventory), instances: instances(state.instances),
    equipment: { ...state.equipment },
    regions: Object.entries(REGIONS).filter(([id]) => isUnlocked(state, id)).map(([id, region]) => ({
      id, name: region.name, description: region.description ?? null, parent: region.parent,
      challenge: region.challenge, completed: cleared(state, id),
      enemyMultiplier: region.enemyMultiplier ?? '1',
      arrivable: state.locationId !== id && !simulation.battle,
      explorable: state.locationId === id && simulation.mode === 'idle' &&
        !(region.challenge && cleared(state, id)) && dec(simulation.player.hp).gt(0),
      enterable: !simulation.battle &&
        !(region.challenge && cleared(state, id)) && dec(simulation.player.hp).gt(0),
      clearedGroups: simulation.clearedGroups[id] ?? '0', groupsPerClear: region.groups,
      rewardText: Object.values(MANUALS).filter((manual) => manual.prerequisite === id)
        .map((manual) => manual.name).join('、'),
    })),
    destinations: Object.entries(SAFE_LOCATIONS).filter(([id]) => isUnlocked(state, id)).map(([id, location]) => ({
      id, name: location.name, description: location.description ?? null,
      canMeditate: Boolean(location.meditation),
      travelable: state.locationId !== id && !simulation.battle,
    })),
    battle: simulation.battle === null ? null : {
      regionId: simulation.battle.regionId, nextPlayerActionAt: simulation.player.nextActionAt,
      manorSealActive: simulation.battle.regionId === MANOR_AID.finalRegionId && Boolean(simulation.battle.entry?.manorSeal),
      enemies: simulation.battle.enemies.map((enemy) => ({
        id: enemy.definition.id, name: ENEMIES[enemy.definition.id].name, hp: enemy.hp,
        description: ENEMIES[enemy.definition.id].description ?? null,
        stats: enemy.definition.stats, abilities: enemy.definition.abilities, nextActionAt: enemy.nextActionAt,
        nextRound: enemy.nextRound ?? null,
      })),
    },
    workshop: {
      available: workshopAvailable, name: workshop.name, description: workshop.description, tier: state.furnaceTier,
      upgrade: workshop.upgrade ? {
        tier: workshop.upgrade.tier, name: FURNACES[workshop.upgrade.tier].name,
        materialCosts: upgradeCosts,
        available: workshopAvailable && upgradeCosts.every(material => BigInt(material.owned) >= BigInt(material.required)),
      } : null,
    },
    recipes: Object.entries(RECIPES).map(([id, recipe]) => {
      const materialCosts = Object.entries(recipe.materials).map(([itemId, required]) => ({
        itemId, name: ITEMS[itemId].name, required, owned: state.inventory[itemId] ?? '0',
      }));
      return {
        id, ...recipe, outputName: ITEMS[recipe.output].name, outputUse: itemUse(recipe.output),
        available: workshopAvailable,
        materialCosts,
        maxBatch: materialCosts.reduce((limit, material) =>
          Number(BigInt(limit) < BigInt(material.owned) / BigInt(material.required)
            ? BigInt(limit) : BigInt(material.owned) / BigInt(material.required)), 10000),
        ...craftingRates(state, recipe),
      };
    }),
    assemblies: ASSEMBLIES.map((recipe) => ({ ...recipe, outputName: ITEMS[recipe.output].name })),
    armorAssemblies: ARMOR_ASSEMBLIES.map(recipe => ({ ...recipe, outputName: ITEMS[recipe.output].name })),
    shop: {
      id: currentShopId, name: shopDefinition.name, locationName: SAFE_LOCATIONS[shopDefinition.locationId].name,
      unlocked: shopUnlocked,
      prerequisiteName: shopDefinition.prerequisite && isUnlocked(state, shopDefinition.prerequisite)
        ? REGIONS[shopDefinition.prerequisite].name : null,
      available: state.locationId === shopDefinition.locationId && shopUnlocked,
      refreshDue: shop?.dayIndex == null || shop.dayIndex < calendar.dayIndex,
      dayIndex: shop?.dayIndex ?? null,
      inventory: inventory(shop?.inventory ?? {}), instances: instances(shop?.instances ?? {}),
    },
    effects: simulation.effects.map((effect) => ({
      id: effect.id, name: FOOD_EFFECTS[effect.id].name, description: FOOD_EFFECTS[effect.id].description ?? null,
      expiresAt: effect.expiresAt, source: scaledSource(effect.source, sources),
    })),
    log: state.log.map((entry) => ({ ...entry })),
  };
}
