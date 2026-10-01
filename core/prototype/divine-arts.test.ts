import { describe, expect, it } from 'vitest';
import { readClientSave } from '../../shared/client-save';
import { executeCharacterCommand, getCharacterView } from './character';
import { createCharacter, readCharacter } from './character-state';
import { executeDebugCommand } from './debug';
import { DIVINE_ARTS, FOUNDATION_DIVINE_ART } from './divine-arts';
import { FOUNDATION_LEVEL } from './growth';
import { MANUALS, MANUAL_IDS } from './skills';
import { resolveStats } from './stats';

const promoted = () => executeDebugCommand(createCharacter(0, 19), { type: 'realm', level: FOUNDATION_LEVEL });
const activate = { type: 'activate-divine-art', divineArtId: FOUNDATION_DIVINE_ART } as const;
const stop = { type: 'activate-divine-art', divineArtId: null } as const;

describe('divine arts', () => {
  it('requires learning and toggles one independent source without spending, healing or stacking', () => {
    const initial = createCharacter(0, 19);
    const untouched = structuredClone(initial);
    expect(() => executeCharacterCommand(initial, activate)).toThrow('尚未掌握');
    expect(initial).toEqual(untouched);
    expect(getCharacterView(initial).divineArts.every(art => !art.learned && !art.active)).toBe(true);

    const manualId = MANUAL_IDS[0];
    let state = executeDebugCommand(promoted(), { type: 'travel', locationId: MANUALS[manualId].location });
    state = executeCharacterCommand(state, { type: 'learn-manual', manualId });
    state = executeCharacterCommand(state, { type: 'activate-manual', manualId });
    state = executeDebugCommand(state, { type: 'travel', locationId: initial.locationId });
    const regionId = getCharacterView(state).regions.find(region => region.enterable)!.id;
    state = executeCharacterCommand(state, { type: 'enter', regionId });
    state.simulation.player.hp = '1';
    const before = readCharacter(state);
    const after = executeCharacterCommand(before, activate);
    const source = DIVINE_ARTS[FOUNDATION_DIVINE_ART].source;
    expect(after.simulation.player.sources).toEqual([...before.simulation.player.sources, source]);
    expect(getCharacterView(after).stats).toEqual(resolveStats(before.simulation.player.base, [...before.simulation.player.sources, source]));
    expect(after.simulation.player.base).toEqual(before.simulation.player.base);
    expect(after.activeManual).toBe(manualId);
    expect(after.foundationRoot).toBe(before.foundationRoot);
    expect(after.skills).toEqual(before.skills);
    expect(after.money).toBe(before.money);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.instances).toEqual(before.instances);
    expect(after.simulation.player.hp).toBe(before.simulation.player.hp);
    expect(after.simulation.player.nextActionAt).toBe(before.simulation.player.nextActionAt);
    expect(after.simulation.battle).toEqual(before.simulation.battle);
    expect(after.simulation.rng).toBe(before.simulation.rng);
    expect(executeCharacterCommand(after, activate)).toEqual(after);

    const stopped = executeCharacterCommand(after, stop);
    expect(stopped.activeDivineArt).toBeNull();
    expect(stopped.learnedDivineArts).toEqual(before.learnedDivineArts);
    expect(stopped.simulation).toEqual(before.simulation);
    expect(stopped.activeManual).toBe(manualId);
    expect(executeCharacterCommand(stopped, stop)).toEqual(stopped);
    expect(executeCharacterCommand(stopped, activate).simulation).toEqual(after.simulation);
  });

  it('round-trips learned and active state and rejects missing, duplicate or inconsistent snapshots', () => {
    const active = executeCharacterCommand(promoted(), activate);
    const raw = JSON.parse(JSON.stringify({ format: 'opening-client-2', tradeRevision: '0', character: active, playedMs: 0 }));
    expect(readClientSave(raw).character).toEqual(active);
    expect(getCharacterView(active).divineArts.find(art => art.id === FOUNDATION_DIVINE_ART))
      .toMatchObject({ learned: true, active: true });
    const initial = createCharacter(0, 19);
    const invalid = [
      { ...active, learnedDivineArts: undefined },
      { ...active, activeDivineArt: undefined },
      { ...active, learnedDivineArts: [] },
      { ...active, learnedDivineArts: [FOUNDATION_DIVINE_ART, FOUNDATION_DIVINE_ART] },
      { ...active, learnedDivineArts: ['unknown-art'] },
      { ...active, activeDivineArt: 'unknown-art' },
      { ...active, activeDivineArt: null },
      { ...initial, activeDivineArt: FOUNDATION_DIVINE_ART },
      { ...initial, learnedDivineArts: [FOUNDATION_DIVINE_ART] },
      { ...active, schemaVersion: 'neko-character-3' },
    ];
    for (const snapshot of invalid) expect(() => readCharacter(snapshot)).toThrow();
    expect(active.activeDivineArt).toBe(FOUNDATION_DIVINE_ART);
  });
});
