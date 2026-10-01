import { dec, integerAdd, maximum, minimum, text } from '../numbers';
import { enemyStrike, playerStrike } from './combat';
import { activeSources, damageValue, effectDuration, healingValue, regeneration } from './effects';
import { attackIntervalMs, BASE_STATS, rebaseHealth, rescaleDeadline, resolveStats } from './stats';
import {
  enemySchema, simulationSchema, sourceSchema, statsSchema,
  type EnemyDefinition, type SimulationEvent, type SimulationHooks, type SimulationResult,
  type SimulationState, type Stats, type StatSource, type ResolvedEnemy, type EncounterEntry,
} from './types';

const needsRoundCounter = (abilities: ResolvedEnemy['abilities']) =>
  Boolean(abilities.rampingDamage || abilities.mirrorOpening || abilities.arrayStrikes || abilities.periodicStrike);

export function getPlayerStats(state: SimulationState): Stats {
  return resolveStats(state.player.base, activeSources(state));
}

// Parsing is also the copy boundary: callers retain their snapshot on rejection.
export function readSimulation(raw: unknown): SimulationState {
  const state = simulationSchema.parse(raw);
  if (state.nextPulseAt <= state.clockMs || state.nextPulseAt - state.clockMs > 1000) {
    throw new Error('Invalid simulation pulse checkpoint');
  }
  if ((state.mode === 'combat') !== (state.battle !== null) ||
      (state.battle !== null) !== (state.player.nextActionAt !== null)) {
    throw new Error('Inconsistent encounter state');
  }
  if (new Set(state.effects.map((entry) => entry.id)).size !== state.effects.length ||
      state.effects.some((entry) => entry.expiresAt <= state.clockMs)) throw new Error('Invalid effect checkpoint');
  const stats = getPlayerStats(state);
  attackIntervalMs(stats.attackSpeed);
  if (dec(state.player.hp).gt(stats.maxHp) || (state.battle && dec(state.player.hp).lte(0))) {
    throw new Error('Invalid player health');
  }
  if (state.battle) {
    if (state.player.nextActionAt! <= state.clockMs ||
        state.battle.enemies.every((enemy) => dec(enemy.hp).eq(0))) throw new Error('Invalid combat checkpoint');
    for (const enemy of state.battle.enemies) {
      const abilities = enemy.definition.abilities;
      if (needsRoundCounter(abilities) !== (enemy.nextRound !== undefined)) {
        throw new Error('Invalid enemy round checkpoint');
      }
      if (abilities.periodicStrike && (abilities.strikes !== 1 || abilities.extraStrike ||
          abilities.rampingDamage || abilities.mirrorOpening || abilities.arrayStrikes)) {
        throw new Error('Periodic strikes cannot combine with multiple or escalating actions');
      }
      const resolved = resolveStats(enemy.definition.stats);
      if ((Object.keys(resolved) as (keyof Stats)[]).some((key) => !dec(resolved[key]).eq(enemy.definition.stats[key]))) {
        throw new Error('Enemy stats must already be resolved');
      }
      attackIntervalMs(resolved.attackSpeed);
      if (dec(enemy.hp).gt(resolved.maxHp) ||
          (dec(enemy.hp).gt(0) && enemy.nextActionAt <= state.clockMs)) throw new Error('Invalid enemy checkpoint');
    }
  }
  return state;
}

export function createSimulation(options: {
  clockMs: number;
  seed: number;
  base?: Stats;
  hp?: string;
  sources?: StatSource[];
}): SimulationState {
  const state: SimulationState = {
    kernelVersion: 'neko-kernel-5',
    clockMs: options.clockMs,
    nextPulseAt: options.clockMs + 1000,
    rng: options.seed,
    actionCounts: { basicAttack: '0' },
    mode: 'rest',
    player: {
      base: { ...(options.base ?? BASE_STATS) },
      sources: options.sources ?? [],
      hp: '0',
      nextActionAt: null,
    },
    effects: [],
    battle: null,
    clearedGroups: {},
  };
  state.player.hp = options.hp ?? getPlayerStats(state).maxHp;
  return readSimulation(state);
}

export function pauseSimulationUntil(input: SimulationState, targetMs: number): SimulationState {
  const state = readSimulation(input);
  if (!Number.isSafeInteger(targetMs) || targetMs < state.clockMs || targetMs > Number.MAX_SAFE_INTEGER - 3_600_000) {
    throw new Error('Invalid simulation pause target');
  }
  // Move the wall-clock checkpoint without consuming any remaining game time.
  const gap = targetMs - state.clockMs;
  state.clockMs = targetMs;
  state.nextPulseAt += gap;
  if (state.player.nextActionAt !== null) state.player.nextActionAt += gap;
  for (const enemy of state.battle?.enemies ?? []) enemy.nextActionAt += gap;
  for (const effect of state.effects) effect.expiresAt += gap;
  return readSimulation(state);
}

function leaveBattle(state: SimulationState) {
  state.battle = null;
  state.player.nextActionAt = null;
  state.mode = 'rest';
}

function faint(state: SimulationState, events: SimulationEvent[], hooks?: SimulationHooks) {
  state.player.hp = '0';
  leaveBattle(state);
  emit(state, events, { kind: 'fainted', at: state.clockMs }, hooks);
}

function reconcileStats(state: SimulationState, before: Stats, events: SimulationEvent[]) {
  const after = getPlayerStats(state);
  attackIntervalMs(after.attackSpeed);
  const wasAlive = dec(state.player.hp).gt(0);
  state.player.hp = rebaseHealth(state.player.hp, before.maxHp, after.maxHp);
  if (state.player.nextActionAt !== null) {
    state.player.nextActionAt = rescaleDeadline(
      state.clockMs, state.player.nextActionAt, before.attackSpeed, after.attackSpeed,
    );
  }
  if (wasAlive && dec(state.player.hp).eq(0)) faint(state, events);
}

function settle(
  state: SimulationState, event: Parameters<NonNullable<SimulationHooks['settle']>>[1],
  events: SimulationEvent[], hooks?: SimulationHooks,
) {
  const update = hooks?.settle?.(state, event);
  if (!update) return;
  const before = getPlayerStats(state);
  if (update.base) state.player.base = statsSchema.parse(update.base);
  if (update.sources) state.player.sources = update.sources.map((source) => sourceSchema.parse(source));
  reconcileStats(state, before, events);
  if (update.fullHeal && dec(state.player.hp).gt(0)) state.player.hp = getPlayerStats(state).maxHp;
}

function emit(state: SimulationState, events: SimulationEvent[], event: SimulationEvent, hooks?: SimulationHooks) {
  events.push(event);
  settle(state, event, events, hooks);
}

export function updatePlayerStats(
  input: SimulationState, change: { base?: Stats; sources?: StatSource[] },
): SimulationResult {
  const state = readSimulation(input);
  const before = getPlayerStats(state);
  const events: SimulationEvent[] = [];
  if (change.base) state.player.base = structuredClone(change.base);
  if (change.sources) state.player.sources = structuredClone(change.sources);
  reconcileStats(state, before, events);
  return { state: readSimulation(state), events };
}

export function setRecoveryMode(input: SimulationState, mode: 'rest' | 'sleep'): SimulationState {
  const state = readSimulation(input);
  if (state.battle) throw new Error('Leave combat before recovering');
  state.mode = mode;
  return readSimulation(state);
}

export function withdraw(input: SimulationState): SimulationState {
  const state = readSimulation(input);
  leaveBattle(state);
  return readSimulation(state);
}

export function applyTimedEffect(
  input: SimulationState, definition: { id: string; durationMs: number; source: StatSource },
): SimulationResult {
  const state = readSimulation(input);
  if (!Number.isSafeInteger(definition.durationMs) || definition.durationMs <= 0) {
    throw new Error('Effect duration must be a positive integer');
  }
  const source = sourceSchema.parse(definition.source);
  const durationMs = effectDuration(definition.durationMs, activeSources(state), source.tags ?? []);
  const before = getPlayerStats(state);
  const events: SimulationEvent[] = [];
  const current = state.effects.find((entry) => entry.id === definition.id);
  if (current) {
    if (JSON.stringify(current.source.modifiers) !== JSON.stringify(source.modifiers) ||
        JSON.stringify(current.source.tags) !== JSON.stringify(source.tags) ||
        JSON.stringify(current.source.statPolarity) !== JSON.stringify(source.statPolarity)) {
      throw new Error('The same effect ID cannot change rules');
    }
    for (const kind of ['flat', 'multiplier'] as const) {
      for (const key of Object.keys(BASE_STATS) as (keyof Stats)[]) {
        const fallback = kind === 'flat' ? 0 : 1;
        if (!dec(current.source[kind]?.[key] ?? fallback).eq(source[kind]?.[key] ?? fallback)) {
          throw new Error('The same effect ID cannot change intensity');
        }
      }
    }
    current.expiresAt += durationMs;
  } else {
    state.effects.push({ id: definition.id, expiresAt: state.clockMs + durationMs, source });
  }
  reconcileStats(state, before, events);
  return { state: readSimulation(state), events };
}

function performEnemyAction(
  state: SimulationState, slot: number, strikes: number | readonly string[], events: SimulationEvent[], hooks?: SimulationHooks,
  damageMultiplier = '1',
) {
  const battle = state.battle!;
  const enemy = battle.enemies[slot];
  const coefficients = typeof strikes === 'number' ? Array<string>(strikes).fill('1') : strikes;
  for (const coefficient of coefficients) {
    if (state.battle !== battle) break;
    const alive = battle.enemies.filter((entry) => dec(entry.hp).gt(0)).length;
    const strike = enemyStrike(state, enemy.definition, getPlayerStats(state), alive, coefficient, {
      damageMultiplier,
      hp: state.player.hp,
      money: enemy.definition.abilities.walletSuppressionUnit !== undefined ? hooks?.getMoney?.() : undefined,
    });
    strike.damage = damageValue(strike.damage, 'damage.taken', activeSources(state), {
      tags: ['direct'], hp: state.player.hp, maxHp: getPlayerStats(state).maxHp,
    });
    const hpLost = minimum(state.player.hp, strike.damage);
    state.player.hp = text(dec(state.player.hp).minus(hpLost));
    emit(state, events, { ...strike, kind: 'strike', at: state.clockMs, side: 'enemy', slot, hpLost }, hooks);
    if (dec(state.player.hp).lte(0)) faint(state, events, hooks);
  }
}

export function startEncounter(input: SimulationState, encounter: {
  regionId: string; enemies: EnemyDefinition[]; entry?: EncounterEntry;
}, hooks?: SimulationHooks): SimulationResult {
  const state = readSimulation(input);
  if (state.battle || dec(state.player.hp).lte(0)) throw new Error('Cannot enter this encounter now');
  if (!encounter.regionId || encounter.enemies.length < 1 || encounter.enemies.length > 2) {
    throw new Error('The first segment supports one or two enemies');
  }
  const events: SimulationEvent[] = [];
  state.mode = 'combat';
  state.battle = {
    regionId: encounter.regionId,
    ...(encounter.entry ? { entry: { ...encounter.entry } } : {}),
    enemies: encounter.enemies.map((raw) => {
      const definition = enemySchema.parse(raw);
      definition.stats = resolveStats(definition.stats);
      return {
        definition, hp: definition.stats.maxHp,
        nextActionAt: state.clockMs + attackIntervalMs(definition.stats.attackSpeed),
        ...(needsRoundCounter(definition.abilities) ? { nextRound: 1 } : {}),
      };
    }),
  };
  state.player.nextActionAt = state.clockMs + attackIntervalMs(getPlayerStats(state).attackSpeed);
  const battle = state.battle;
  for (let slot = 0; slot < battle.enemies.length && state.battle === battle; slot++) {
    const abilities = battle.enemies[slot].definition.abilities;
    performEnemyAction(state, slot, Array<string>(abilities.entryStrikes).fill(abilities.entryAttackCoefficient ?? '1'),
      events, hooks, abilities.entryDamageMultiplier);
  }
  return { state: readSimulation(state), events };
}

function performPlayerAction(state: SimulationState, events: SimulationEvent[], hooks?: SimulationHooks) {
  const battle = state.battle!;
  const slot = battle.enemies.findIndex((entry) => dec(entry.hp).gt(0));
  const enemy = battle.enemies[slot];
  const stats = getPlayerStats(state);
  const alive = battle.enemies.filter((entry) => dec(entry.hp).gt(0)).length;
  state.player.nextActionAt = state.clockMs + attackIntervalMs(stats.attackSpeed);
  const strike = playerStrike(state, stats, enemy.definition, alive, hooks?.getSturdyCap?.());
  state.actionCounts.basicAttack = integerAdd(state.actionCounts.basicAttack, 1);
  strike.damage = damageValue(strike.damage, 'damage.dealt', activeSources(state), {
    tags: ['direct', 'basic-attack'], hp: state.player.hp, maxHp: stats.maxHp,
    basicAttackOrdinal: state.actionCounts.basicAttack,
  });
  const hpLost = minimum(enemy.hp, strike.damage);
  emit(state, events, { ...strike, kind: 'strike', at: state.clockMs, side: 'player', slot, hpLost }, hooks);
  if (!strike.hit && state.battle === battle && enemy.definition.abilities.missPunishment !== undefined) {
    const damage = enemy.definition.abilities.missPunishment;
    const hpLost = minimum(state.player.hp, damage);
    state.player.hp = text(dec(state.player.hp).minus(hpLost));
    emit(state, events, { kind: 'miss-punishment', at: state.clockMs, slot, damage, hpLost }, hooks);
    if (dec(state.player.hp).lte(0)) faint(state, events, hooks);
  }
  enemy.hp = text(dec(enemy.hp).minus(hpLost));
  if (dec(enemy.hp).eq(0)) {
    emit(state, events, {
      kind: 'enemy-defeated', at: state.clockMs, regionId: battle.regionId,
      enemyId: enemy.definition.id, slot, groupSize: battle.enemies.length,
    }, hooks);
    if (battle.enemies.every((entry) => dec(entry.hp).eq(0))) {
      const total = integerAdd(state.clearedGroups[battle.regionId] ?? '0', 1);
      state.clearedGroups[battle.regionId] = total;
      leaveBattle(state);
      emit(state, events, { kind: 'group-cleared', at: state.clockMs, regionId: battle.regionId, total }, hooks);
    }
  }
  emit(state, events, {
    kind: 'player-action-completed', at: state.clockMs, regionId: battle.regionId, targetIds: [enemy.definition.id],
  }, hooks);
}

function expireEffects(state: SimulationState, events: SimulationEvent[]) {
  const expired = state.effects.filter((entry) => entry.expiresAt <= state.clockMs);
  if (!expired.length) return;
  const before = getPlayerStats(state);
  state.effects = state.effects.filter((entry) => entry.expiresAt > state.clockMs);
  for (const effect of expired) events.push({ kind: 'effect-expired', at: state.clockMs, effectId: effect.id });
  reconcileStats(state, before, events);
}

function pulse(state: SimulationState, events: SimulationEvent[], hooks?: SimulationHooks) {
  const sleeping = state.mode === 'sleep';
  const stats = getPlayerStats(state);
  if (state.mode === 'rest' || sleeping) {
    const recovery = sleeping
      ? dec(maximum(dec(stats.maxHp).mul('0.1'), 5)).round()
      : dec(maximum(dec(stats.maxHp).mul('0.02'), 2));
    state.player.hp = minimum(dec(state.player.hp).plus(healingValue(text(recovery), activeSources(state),
      sleeping ? ['rest', 'meditation'] : ['rest'])), stats.maxHp);
  }
  const wasAlive = dec(state.player.hp).gt(0);
  const recovered = dec(state.player.hp).plus(regeneration(state.player.base, activeSources(state), stats));
  state.player.hp = maximum(minimum(recovered, stats.maxHp), 0);
  if (wasAlive && dec(state.player.hp).eq(0)) faint(state, events, hooks);
  state.nextPulseAt += 1000;
  settle(state, { kind: 'pulse', at: state.clockMs, sleeping }, events, hooks);
}

export function advanceSimulation(
  input: SimulationState, targetMs: number, maxEvents = 10000, hooks?: SimulationHooks,
): SimulationResult & { processedSteps: number } {
  const state = readSimulation(input);
  if (!Number.isSafeInteger(targetMs) || targetMs < state.clockMs || targetMs > Number.MAX_SAFE_INTEGER - 3_600_000 ||
      !Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 10000) {
    throw new Error('Invalid simulation target or event budget');
  }
  const events: SimulationEvent[] = [];
  let processedSteps = 0;
  for (let processed = 0; processed < maxEvents; processed++) {
    const hadBattle = state.battle !== null;
    processedSteps++;
    const deadlines = [state.nextPulseAt, ...state.effects.map((entry) => entry.expiresAt)];
    if (state.battle) {
      deadlines.push(state.player.nextActionAt!);
      for (const enemy of state.battle.enemies) if (dec(enemy.hp).gt(0)) deadlines.push(enemy.nextActionAt);
    }
    const next = Math.min(...deadlines);
    if (next > targetMs) {
      state.clockMs = targetMs;
      break;
    }
    state.clockMs = next;
    expireEffects(state, events);
    if (state.nextPulseAt === next) pulse(state, events, hooks);
    if (state.battle && state.player.nextActionAt! <= next) performPlayerAction(state, events, hooks);
    const battle = state.battle;
    if (battle) {
      for (let slot = 0; slot < battle.enemies.length && state.battle === battle; slot++) {
        const enemy = battle.enemies[slot];
        if (dec(enemy.hp).lte(0) || enemy.nextActionAt > next) continue;
        enemy.nextActionAt = next + attackIntervalMs(enemy.definition.stats.attackSpeed);
        const abilities = enemy.definition.abilities;
        const round = enemy.nextRound ?? 1;
        const damageMultiplier = abilities.rampingDamage
          ? text(dec(round - 1).mul(abilities.rampingDamageStep ?? 1).plus(1)) : '1';
        if (enemy.nextRound !== undefined) enemy.nextRound++;
        const strikes = abilities.periodicStrike && round % abilities.periodicStrike.every === 0
          ? [abilities.periodicStrike.coefficient] : abilities.strikes;
        performEnemyAction(state, slot, strikes, events, hooks, damageMultiplier);
        if (state.battle === battle && abilities.extraStrike) {
          performEnemyAction(state, slot, [abilities.extraStrike.coefficient], events, hooks,
            text(dec(damageMultiplier).mul(abilities.extraStrike.damageMultiplier)));
        }
        if (state.battle === battle && abilities.mirrorOpening && round <= 3) {
          const coefficient = text(dec(getPlayerStats(state).attack).div(enemy.definition.stats.attack));
          performEnemyAction(state, slot, [coefficient], events, hooks);
        }
        if (state.battle === battle && abilities.arrayStrikes && [2, 4, 6].includes(round)) {
          performEnemyAction(state, slot, [String(round / 2 + 1)], events, hooks);
        }
      }
    }
    if (state.clockMs === targetMs || (hooks?.stopOnEncounterEnd && hadBattle && !state.battle)) break;
  }
  return { state: readSimulation(state), events, processedSteps };
}
