import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { advanceCharacter, executeCharacterCommand, getCharacterView, type CharacterEvent } from '../../core/prototype/character';
import { createCharacter, type CharacterState } from '../../core/prototype/character-state';
import { ITEMS } from '../../core/prototype/content';
import { executeDebugCommand } from '../../core/prototype/debug';
import { reincarnateCharacter } from '../../core/prototype/reincarnation';
import { pauseSimulationUntil } from '../../core/prototype/simulation';
import { MAX_FRAME_GAP_MS } from '../../shared/client-save';
import type { ConnectionIssue } from '../game-client';
import { combatFrame, EMPTY_COMBAT_FRAME } from '../combat-presentation';
import { IconButton } from './common';
import { GameShell } from './GameShell';
import type { GameSession } from './types';

const PRESETS = [
  { id: 'village', name: '初入槐溪', location: 'qingshi-village', level: 0, budget: 100, cleared: 'village-outskirts' },
  { id: 'town', name: '石桥散修', location: 'hillside-market', level: 4, budget: 1000, cleared: 'market-gardens' },
  { id: 'city', name: '望川行客', location: 'stoneforge-hamlet', level: 7, budget: 50000, cleared: 'pine-ravine' },
  { id: 'inner', name: '涵岳探幽', location: 'manor-inner-threshold', level: 11, budget: 5000000, cleared: 'edict-corridor' },
];
function prepare(id: string) {
  const preset = PRESETS.find(entry => entry.id === id)!;
  let state = createCharacter(Date.now(), 29713);
  if (preset.level) state = executeDebugCommand(state, { type: 'realm', level: preset.level });
  state = executeDebugCommand(state, { type: 'region', regionId: preset.cleared, operation: 'complete' });
  state = executeDebugCommand(state, { type: 'travel', locationId: preset.location });
  state = executeDebugCommand(state, { type: 'money', amount: preset.budget * 12 });
  const catalog = Object.entries(ITEMS).filter(([, item]) => Number(item.value) <= preset.budget && Number(item.value) > 0);
  const selections = [
    ...catalog.filter(([, item]) => item.kind === 'material').slice(0, 14),
    ...catalog.filter(([, item]) => item.kind === 'food').slice(-3),
    ...catalog.filter(([, item]) => item.kind === 'part').slice(0, 4),
    ...['weapon', 'head', 'body', 'legs', 'feet'].flatMap(slot =>
      catalog.filter(([, item]) => item.slot === slot).slice(-2)),
  ];
  for (const [itemId, item] of selections) {
    state = executeDebugCommand(state, { type: 'item', itemId,
      quantity: item.kind === 'equipment' || item.kind === 'part' ? 1 : 25, quality: 100 });
  }
  for (const slot of ['weapon', 'head', 'body', 'legs', 'feet']) {
    const entry = Object.entries(state.instances).find(([, item]) => ITEMS[item.itemId].slot === slot);
    if (entry) state = executeCharacterCommand(state, { type: 'equip', instanceId: entry[0] });
  }
  const view = getCharacterView(state);
  if (view.shop.available) state = executeCharacterCommand(state, { type: 'visit-shop', shopId: view.shop.id });
  return state;
}
const unavailable = async (): Promise<never> => { throw new Error('界面预览未连接云端服务'); };

// This entry owns only in-memory characters; it never starts GameClient or opens a save store.
export default function DesignPreview() {
  const [preset, setPreset] = useState('town');
  const [character, setCharacter] = useState(() => prepare('town'));
  const current = useRef(character);
  const [issue, setIssue] = useState<ConnectionIssue | null>(null);
  const [paused, setPaused] = useState(false);
  const [frame, setFrame] = useState(EMPTY_COMBAT_FRAME);
  const publish = useCallback((next: CharacterState, events: CharacterEvent[] = [], frozen = false) => {
    current.current = next; setCharacter(next);
    setFrame(old => combatFrame(old, next.simulation.clockMs, performance.now(), events, frozen));
  }, []);
  const run = useCallback(async (operation: (state: CharacterState, events: CharacterEvent[]) => CharacterState) => {
    try { const events: CharacterEvent[] = []; publish(operation(current.current, events), events); return true; }
    catch (error) { setIssue({ source: 'action', message: error instanceof Error ? error.message : '预览操作失败', retryable: false }); return false; }
  }, [publish]);
  useEffect(() => {
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const elapsed = Math.max(0, Math.floor(now - previous));
      previous = now;
      const state = current.current;
      const target = state.simulation.clockMs + elapsed;
      // Visibility is not suspension; use the same frame-gap limit as the live client.
      if (paused || elapsed > MAX_FRAME_GAP_MS) {
        publish({ ...state, simulation: pauseSimulationUntil(state.simulation, target) }, [], true);
      } else void run((state, events) => advanceCharacter(state, target, 1000, events));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [paused, publish, run]);
  const offlineNotice = useCallback(async () => {
    setIssue({ source: 'cloud', message: '界面预览未连接云端服务', retryable: false });
    return false;
  }, []);
  const session: GameSession = {
    combatFrame: frame, combatPaused: paused,
    response: { characterId: `ui-preview:${preset}`, game: getCharacterView(character) },
    busy: false, refreshing: false, blocked: false, issue, lastUpdated: null, lastCloudSave: null,
    tradePending: false, tradeBusy: false, tradeStopped: false, tradeMessage: null,
    reincarnationPending: false, reincarnationBusy: false, reincarnationMessage: null,
    command: useCallback(command => run((state, events) => executeCharacterCommand(state, command, Date.now(), events)), [run]),
    debugCommand: useCallback(command => run(state => executeDebugCommand(state, command)), [run]),
    loadRanking: unavailable, loadConsignment: unavailable, submitTrade: offlineNotice, reconcileTrade: offlineNotice,
    submitReincarnation: useCallback(() => run(state => reincarnateCharacter(state, state.simulation.clockMs,
      crypto.getRandomValues(new Uint32Array(1))[0] || 1)), [run]),
    reconcileReincarnation: offlineNotice, refresh: async () => { await offlineNotice(); },
    retry: async () => { setIssue(null); }, dismissIssue: () => setIssue(null),
  };
  const reset = (id: string) => { setPreset(id); publish(prepare(id)); setIssue(null); };
  return <GameShell session={session} previewControls={<>
    <label>预览角色<select aria-label="预览角色" value={preset} onChange={event => reset(event.target.value)}>
      {PRESETS.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
    <IconButton label="重置预览" onClick={() => reset(preset)}><RotateCcw size={14} /></IconButton>
    <IconButton label={paused ? '继续预览计时' : '暂停预览计时'} onClick={() => {
      setFrame(old => combatFrame(old, current.current.simulation.clockMs, performance.now(), [], !paused));
      setPaused(!paused);
    }}>
      {paused ? <Play size={14} /> : <Pause size={14} />}</IconButton>
  </>} />;
}
