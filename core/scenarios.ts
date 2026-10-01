import { advanceGame, applyCommand, content, createGame, getGameView } from './index';
import type { GameCommand, GameState } from './types';
import { dec } from './numbers';

export function catchUp(state: GameState, targetMs: number, maxTicks = 100_000): GameState {
  const target = Math.floor(targetMs / 1000) * 1000;
  while (state.clockMs < target) state = advanceGame(state, target, maxTicks);
  return state;
}

// An explicit scripted player, not an in-game automation or an offline shortcut.
export function firstFoundation(seed = 1) {
  let state = createGame(0, seed);
  const milestones: { atSeconds: number; event: string }[] = [];
  const act = (command: GameCommand) => { state = applyCommand(state, command); };
  act({ type: 'activity', kind: 'meditate' });
  while (state.level < 12 || dec(state.cultivation).lt(content.realms[12].required)) {
    state = advanceGame(state, state.clockMs + 1000);
    if (state.clockMs > 86_400_000) throw new Error('样本在一日内未修满十二层');
  }
  milestones.push({ atSeconds: state.clockMs / 1000, event: '十二层修满' });
  act({ type: 'activity', kind: 'idle' });

  function farm(region: string, finished: () => boolean) {
    act({ type: 'activity', kind: 'dungeon', targetId: region });
    let seconds = 0;
    while (!finished()) {
      state = advanceGame(state, state.clockMs + 1000);
      if (state.activity.kind !== 'dungeon') throw new Error(`样本 ${region} 提前停止：${state.activity.stopReason}`);
      if (++seconds > 36_000) throw new Error(`样本 ${region} 超过十小时`);
    }
    act({ type: 'activity', kind: 'idle' });
    milestones.push({ atSeconds: state.clockMs / 1000, event: `${region}备料结束` });
  }
  farm('bamboo', () => BigInt(state.regionKills.bamboo ?? '0') >= 12n && BigInt(state.inventory.herb ?? '0') >= 30n);
  const sword = state.equipment.find((item) => item.definitionId === 'iron-sword')!;
  act({ type: 'equip', slot: 'weapon', instanceId: sword.instanceId });
  farm('quarry', () => BigInt(state.inventory.ore ?? '0') >= 15n);
  act({ type: 'technique', techniqueId: 'flame' });
  act({ type: 'supply', enabled: true, hpThreshold: 0.5 });
  farm('ruins', () => BigInt(state.inventory.essence ?? '0') >= 10n);
  act({ type: 'craft', recipeId: 'foundation', quantity: 1 });
  act({ type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
  milestones.push({ atSeconds: state.clockMs / 1000, event: '材料炼丹后首次筑基' });
  return { state, milestones };
}

export function snapshotSample(name: string, days: number, state: GameState) {
  const view = getGameView(state);
  return {
    sample: name, days, clockSeconds: state.clockMs / 1000, realm: view.realm.name,
    cultivation: state.cultivation, reserve: state.reserve,
    hp: state.player.hp, stones: state.stones,
    kills: state.totals.kills, pillsUsed: state.totals.pillsUsed,
    activeSeconds: state.totals.activeSeconds,
    inventory: { ...state.inventory }, equipmentCount: state.equipment.length,
    activity: state.activity.kind, stoppedAt: state.activity.stoppedAt,
    stopReason: state.activity.stopReason,
  };
}

export function runLongSamples(seed = 1) {
  const samples: ReturnType<typeof snapshotSample>[] = [];
  let meditator = applyCommand(createGame(0, seed), { type: 'activity', kind: 'meditate' });
  let unattended = applyCommand(createGame(0, seed), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
  const foundation = firstFoundation(seed);
  let farmer = applyCommand(foundation.state, { type: 'technique', techniqueId: 'breathing' });
  farmer = applyCommand(farmer, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
  for (const days of [1, 7, 30]) {
    const target = days * 86_400_000;
    meditator = catchUp(meditator, target);
    unattended = catchUp(unattended, target);
    farmer = catchUp(farmer, target);
    samples.push(snapshotSample('纯打坐未筑基', days, meditator));
    samples.push(snapshotSample('凡人无补给青竹林', days, unattended));
    samples.push(snapshotSample('自给筑基后青竹林', days, farmer));
  }
  return { seed, foundation: foundation.milestones, samples };
}
