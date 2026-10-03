import { dec, minimum } from '../numbers';
import { addInstance, defeatDestination, readCharacter, record, synchronizeCharacter, type CharacterState } from './character-state';
import { ITEMS, MANOR_AID, SLOTS } from './content';
import { advancePlayerDuel, createSimulation, getPlayerStats, startPlayerDuel, withdraw, type PlayerDuelState } from './simulation';
import { rebaseHealth } from './stats';
import { realmName } from './growth';
import { PVP_RULES, type PvpBattleInfo, type PvpFighter, type PvpOutcome, type PvpReceipt } from '../../shared/pvp';

export function pvpFighter(state: CharacterState, name: string, avatarUrl: string | null = null): PvpFighter {
  return {
    name, avatarUrl, realmName: realmName(state.level), hp: state.simulation.player.hp, base: state.simulation.player.base,
    sources: state.simulation.player.sources, basicAttackOrdinal: state.simulation.actionCounts.basicAttack,
    effects: state.simulation.effects.map(effect => ({
      id: effect.id, source: effect.source, remainingMs: effect.expiresAt - state.simulation.clockMs,
    })),
  };
}
function fighterSimulation(fighter: PvpFighter, seed: number) {
  const state = createSimulation({ clockMs: 0, seed, base: fighter.base, hp: '0', sources: fighter.sources });
  state.effects = fighter.effects.map(effect => ({ id: effect.id, source: effect.source, expiresAt: effect.remainingMs }));
  state.player.hp = fighter.hp;
  state.actionCounts.basicAttack = fighter.basicAttackOrdinal;
  return state;
}

export function startPvpBattle(battle: PvpBattleInfo): PlayerDuelState {
  return startPlayerDuel(fighterSimulation(battle.attacker, battle.seed), fighterSimulation(battle.defender, battle.seed));
}

export function pvpOutcome(battle: PvpBattleInfo, state: PlayerDuelState, withdrawn = false): PvpOutcome | null {
  const elapsedMs = state.attacker.clockMs;
  const timedOut = elapsedMs >= PVP_RULES.combatLimitMs && Boolean(state.attacker.battle);
  if (!withdrawn && !timedOut && state.attacker.battle) return null;
  const winner = !withdrawn && !timedOut && dec(state.defender.player.hp).lte(0) ? 'attacker' : 'defender';
  const hp = (side: 'attacker' | 'defender') => side !== winner ? '0' : rebaseHealth(
    state[side].player.hp, getPlayerStats(state[side]).maxHp,
    getPlayerStats(fighterSimulation(battle[side], battle.seed)).maxHp);
  return { winner, attackerHp: hp('attacker'), defenderHp: hp('defender'), elapsedMs, timedOut };
}

export function advancePvpBattle(state: PlayerDuelState, targetMs: number) {
  return advancePlayerDuel(state, Math.min(targetMs, PVP_RULES.combatLimitMs));
}

export function pvpDropCandidates(state: CharacterState) {
  return SLOTS.flatMap(slot => {
    const uid = state.equipment[slot];
    return uid && state.instances[uid].itemId !== MANOR_AID.itemId
      ? [{ slot, uid, instance: state.instances[uid] }] : [];
  });
}

export function applyPvpReceipt(input: CharacterState, receipt: PvpReceipt): CharacterState {
  const state = readCharacter(input);
  if (receipt.status === 'cancelled') return state;
  if (receipt.lost) {
    const { uid, slot, instance } = receipt.lost;
    if (state.equipment[slot] !== uid || state.instances[uid]?.itemId !== instance.itemId ||
        state.instances[uid].quality !== instance.quality) throw new Error('PVP掉落装备与检查点不一致');
    state.equipment[slot] = null;
    delete state.instances[uid];
  }
  if (receipt.gained) addInstance(state, state.instances, receipt.gained.itemId, receipt.gained.quality);
  if (!receipt.won) {
    state.simulation = withdraw(state.simulation);
    state.locationId = defeatDestination(state);
    delete state.training;
    delete state.gathering;
  }
  synchronizeCharacter(state);
  state.simulation.player.hp = receipt.won ? minimum(receipt.hp, getPlayerStats(state.simulation).maxHp) : '0';
  record(state, receipt.message);
  if (receipt.lost) record(state, `红名败退，失去${ITEMS[receipt.lost.instance.itemId].name}`);
  if (receipt.gained) record(state, `获得${receipt.opponent}掉落的${ITEMS[receipt.gained.itemId].name}`);
  return readCharacter(state);
}
