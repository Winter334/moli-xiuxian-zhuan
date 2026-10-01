import { describe, expect, it } from 'vitest';
import { RARITY_LABELS, type ActionView } from '../shared/contracts';
import { content, type Modifier } from './content';
import { triggerEffects } from './combat';
import { createRules } from './game';
import {
  describeEffect, describeModifier, getPresentation, loadPresentation, presentation,
  toActionView, toStatView, type Presentation,
} from './presentation';
import type { EquipmentInstance, GameState } from './types';

const groups = ['items', 'equipment', 'techniques', 'regions', 'enemies', 'recipes'] as const;
const copy = () => structuredClone(content);
const copyPresentation = () => structuredClone(presentation);
function instance(definitionId: string, affixes: EquipmentInstance['affixes'] = []): EquipmentInstance {
  return { instanceId: `owned-${definitionId}`, definitionId, contentVersion: content.version, affixes };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

describe('independently versioned presentation metadata', () => {
  it('covers every shipped identifier with distinct literary lore, without rule data', () => {
    expect(presentation.version).toMatch(/^presentation-\d+\.\d+\.\d+$/);
    expect(content.version).toMatch(/^stage-\d+\.\d+\.\d+$/);
    const stories: string[] = [];
    for (const group of groups) {
      expect(Object.keys(presentation[group]).sort()).toEqual(content[group].map((entry) => entry.id).sort());
      expect(Object.isFrozen(presentation[group])).toBe(true);
      for (const entry of Object.values(presentation[group])) {
        expect(Object.isFrozen(entry)).toBe(true);
        expect(entry.lore.length).toBeGreaterThan(20);
        expect(entry.lore).not.toMatch(/原型|占位|测试|公式|系数|逐颗|派生|不触发|stage-|[0-9=×/]/);
        stories.push(entry.lore);
      }
    }
    expect(new Set(stories).size).toBe(stories.length);
    expect(Object.isFrozen(presentation)).toBe(true);
  });

  it('uses display grades without adding random quality or combat values', () => {
    expect(RARITY_LABELS).toEqual({ common: '凡品', uncommon: '灵品', rare: '玄品', epic: '地品' });
    expect(Object.fromEntries(Object.entries(presentation.equipment).map(([id, entry]) => [id, entry.rarity])))
      .toEqual({ 'wood-sword': 'common', 'iron-sword': 'uncommon', 'stone-gauntlet': 'rare', 'jade-staff': 'epic' });
    const rules = createRules();
    const state = rules.createGame(0);
    const before = JSON.stringify(state);
    state.equipment.forEach((entry) => expect(entry).not.toHaveProperty('rarity'));
    expect(rules.getGameView(state).equipment[0].rarity).toBe('common');
    expect(rules.getPlayerStats(state).attack).toBe('13');
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each(groups)('requires complete shipped %s coverage and rejects unknown metadata IDs', (group) => {
    const missing = copyPresentation();
    delete missing[group][content[group][0].id];
    expect(() => loadPresentation(missing)).toThrow(/展示元数据缺失/);
    const unknown = copyPresentation();
    Object.assign(unknown[group], { 'unknown-entry': structuredClone(presentation[group][content[group][0].id]) });
    expect(() => loadPresentation(unknown)).toThrow(/引用不存在/);
  });

  it.each(['legendary', '凡品', '', null, 3])('rejects invalid rarity %s instead of silently defaulting', (rarity) => {
    for (const group of ['items', 'equipment', 'techniques', 'recipes'] as const) {
      const raw = copyPresentation();
      Object.assign(raw[group][content[group][0].id], { rarity });
      expect(() => loadPresentation(raw)).toThrow();
    }
  });

  it('strictly rejects extra fields, malformed versions, missing fields and empty lore', () => {
    const mutations: ((raw: Presentation) => void)[] = [
      (raw) => { Object.assign(raw, { balance: true }); },
      (raw) => { Object.assign(raw.equipment['wood-sword'], { attack: '999' }); },
      (raw) => { Object.assign(raw.regions.bamboo, { rarity: 'common' }); },
      (raw) => { raw.items.herb.lore = '   '; },
      (raw) => { Reflect.deleteProperty(raw.items.herb, 'rarity'); },
      (raw) => { raw.version = 'stage-1.1.0'; },
      (raw) => { Object.assign(raw, { schemaVersion: 2 }); },
      (raw) => { Reflect.deleteProperty(raw, 'enemies'); },
    ];
    for (const mutate of mutations) {
      const raw = copyPresentation();
      mutate(raw);
      expect(() => loadPresentation(raw)).toThrow();
    }
  });

  it('can version and validate copy changes independently of content and saved games', () => {
    const rules = createRules();
    const state = rules.createGame(0, 17);
    const versions = { contentVersion: content.version, rulesVersion: content.rulesVersion, schemaVersion: content.schemaVersion };
    const before = JSON.stringify(state);
    const raw = copyPresentation();
    raw.version = 'presentation-1.1.0';
    raw.equipment['wood-sword'].rarity = 'epic';
    raw.equipment['wood-sword'].lore = '风雨洗过木纹，初心仍在。';
    const changed = loadPresentation(raw);
    expect(changed.version).not.toBe(presentation.version);
    expect(presentation.equipment['wood-sword'].rarity).toBe('common');
    expect({ contentVersion: content.version, rulesVersion: content.rulesVersion, schemaVersion: content.schemaVersion }).toEqual(versions);
    expect(state).toMatchObject(versions);
    expect(state).not.toHaveProperty('presentationVersion');
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('views share actual rule definitions', () => {
  it('projects action fields identically for the active technique, player, region enemy and battle', () => {
    const c = copy();
    const configured = c.actions.find((entry) => entry.id === 'spark')!;
    Object.assign(configured, { name: '试炼灵焰', coefficient: '2.25', hits: 3, mpCost: '9' });
    c.techniques[0].actionId = 'spark';
    c.enemies[0].actionId = 'spark';
    c.regions[0].enemies = [c.enemies[0].id];
    const rules = createRules(c);
    const state = rules.applyCommand(rules.createGame(0), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    state.player.mp = '0';
    state.battle!.mp = '0';
    const view = rules.getGameView(state);
    const action: ActionView = { name: '试炼灵焰', damageType: 'magical', hits: 3, coefficient: '2.25', mpCost: '9' };
    expect(toActionView(configured)).toEqual(action);
    expect(view.player.action).toEqual(action);
    expect(view.techniques[0].action).toEqual(action);
    expect(view.regions[0].enemies[0].action).toEqual(action);
    expect(view.battle!.action).toEqual(action);
    expect(view.battle!.lore).toBe(view.regions[0].enemies[0].lore);
    expect(view.battle!.abilities).toEqual(view.regions[0].enemies[0].abilities);
    expect(view.battle!.abilities[0]).toContain('每段法攻 ×2.25');
    expect(view.battle!.abilities[0]).toContain('灵力不足时改用基础攻击');
    expect(view.battle!.abilities[0]).toContain('每段均须命中，法防逐段减免');
    expect(view.equipment[0]).not.toHaveProperty('action');
    view.player.action.hits = 8;
    expect(view.techniques[0].action).toEqual(action);
    expect(rules.content.actions.find((entry) => entry.id === 'spark')!.hits).toBe(3);
  });

  it('formats every modifier stat and mode consistently without losing decimal precision', () => {
    const labels: Record<Modifier['stat'], string> = {
      maxHp: '气血上限', maxMp: '灵力上限', attack: '物攻', magicAttack: '法攻',
      defense: '物防', magicDefense: '法防',
      agility: '身法', hpRegen: '每秒气血回复', mpRegen: '每秒灵力回复',
    };
    for (const stat of Object.keys(labels) as Modifier['stat'][]) {
      for (const mode of ['flat', 'percent'] as const) {
        const modifier: Modifier = { stat, mode, value: '0.125' };
        const value = mode === 'flat' ? '+0.125' : '+12.5%';
        expect(toStatView(modifier)).toEqual({ label: labels[stat], value });
        expect(describeModifier(modifier)).toBe(`${labels[stat]} ${value}`);
      }
    }
    expect(toStatView({ stat: 'attack', mode: 'flat', value: '9007199254740993.0001' }).value)
      .toBe('+9007199254740993.0001');
    expect(toStatView({ stat: 'attack', mode: 'percent', value: '0.0000000000000001' }).value)
      .toBe('+0.00000000000001%');
  });

  it('uses saved affix payloads, separates weapon stats from technique bonuses and never rerolls', () => {
    const c = copy();
    c.affixes.forEach((affix) => { affix.min = '99'; affix.max = '99'; });
    c.equipment[0].modifiers.push({ stat: 'maxMp', mode: 'flat', value: '7' });
    c.techniques[0].modifiers = [{ stat: 'attack', mode: 'percent', value: '0.25' }];
    c.techniques[0].actionId = 'spark';
    const rules = createRules(c);
    const state = rules.createGame(0, 23);
    state.equipment[0].affixes = [
      { definitionId: 'keen', value: '2', modifier: { stat: 'attack', mode: 'flat', value: '2' } },
      { definitionId: 'spirit', value: '1.5', effect: { id: 'hit-mana', name: '引灵', kind: 'restore', resource: 'mp', trigger: 'hit', amount: '1.5' } },
    ];
    state.techniqueXp.breathing = '900';
    const before = JSON.stringify(state);
    const view = rules.getGameView(state);
    expect(view.equipment[0].stats).toEqual([{ label: '物攻', value: '+3' }, { label: '灵力上限', value: '+7' }, { label: '物攻', value: '+2' }]);
    expect(view.equipment[0].effects).toEqual([]);
    expect(view.equipment[0].affixes).toEqual(['锋锐：物攻 +2', '聚灵：每段招式命中后恢复 1.5 灵力（不超过上限，不受暴击影响）']);
    expect(view.equipment[0].category).toBe('sword');
    expect(view.equipment[0].description).toBe('物攻 +3；灵力上限 +7');
    expect(JSON.stringify(view.equipment[0])).not.toMatch(/灵焰|25%|20%|99/);
    expect(view.techniques[0].effects).toContain('物攻 +25%');
    expect(view.techniques[0].masteryEffects).toEqual(['物攻 +4']);
    expect(view.player.stats.attack).toBe('21.25');
    expect(view.player.stats.maxMp).toBe('27');
    expect(view.player.stats).toEqual({ ...rules.getPlayerStats(state), critChance: 0.05, critMultiplier: 1.5 });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('shares effect amounts between equipment, techniques, enemies and actual combat restoration', () => {
    const c = copy();
    const effect = c.effects.find((entry) => entry.id === 'hit-mend')!;
    effect.amount = '7.25';
    c.equipment[0].effects = [effect.id];
    c.techniques[0].effects = [effect.id];
    c.enemies[0].effects = [effect.id];
    c.regions[0].enemies = [c.enemies[0].id];
    const rules = createRules(c);
    const state = rules.applyCommand(rules.createGame(0), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const view = rules.getGameView(state);
    const description = '每段招式命中后恢复 7.25 气血（不超过上限，不受暴击影响）';
    expect(view.equipment[0].effects).toEqual([description]);
    expect(view.techniques[0].effects).toEqual([description]);
    expect(view.regions[0].enemies[0].abilities).toContain(description);
    expect(view.battle!.abilities).toContain(description);
    state.player.hp = '10';
    triggerEffects('hit', [effect], state.player, rules.getPlayerStats(state), state.battle!, c.enemies[0]);
    expect(state.player.hp).toBe('17.25');
  });

  it('describes shields and retaliation restrictions in player-facing language', () => {
    const ward = describeEffect(content.effects.find((entry) => entry.id === 'action-ward')!);
    expect(ward).toBe('每次行动结束后获得 3 护盾（总量不超过气血上限）');
    const thorn = describeEffect(content.effects.find((entry) => entry.id === 'thorn')!);
    expect(thorn).toContain('受到招式伤害、损失气血且仍存活时');
    expect(thorn).toContain('3 点物理伤害');
    expect(thorn).toContain('受物防减免，可被护盾抵挡');
    expect(thorn).toContain('不能暴击，也不会引发命中附效或反击');
    expect(thorn).not.toMatch(/派生|不触发/);
    expect(describeEffect({ id: 'magic-response', name: '灵息', kind: 'damage', trigger: 'hurt', amount: '5', damageType: 'magical' }))
      .toContain('受法防减免，可被护盾抵挡');
    expect(describeEffect(content.effects.find((entry) => entry.id === 'kill-mend')!)).toContain('击败敌人后恢复 5 气血');
  });

  it('projects technique unlocks, caps, modifiers and mastery from the current configuration', () => {
    const c = copy();
    c.techniques[0].xpCap = '75';
    c.techniques[0].practiceBonuses = [{ stat: 'magicAttack', value: '7.5' }];
    c.techniques[0].unlock = { regionId: 'bamboo', kills: '8' };
    c.techniques[0].modifiers = [{ stat: 'hpRegen', mode: 'flat', value: '0.75' }];
    const rules = createRules(c);
    const state = rules.createGame(0);
    const technique = rules.getGameView(state).techniques[0];
    expect(technique.xpCap).toBe('75');
    expect(technique.masteryEffects).toEqual(['法攻 +7.5']);
    expect(technique.description).toContain('圆满收益：法攻 +7.5（随修习进度提升，圆满后不再增加，仅运转时生效）');
    expect(technique.requirement).toBe('青竹林累计击败 8 次');
    expect(technique.effects).toContain('每秒气血回复 +0.75');
    expect(technique.unlocked).toBe(false);
    state.regionKills.bamboo = '8';
    expect(rules.getGameView(state).techniques[0].unlocked).toBe(true);
    expect(rules.getGameView(state).techniques.find((entry) => entry.id === 'flame')!.requirement).toBe('炼气三层');
  });

  it('derives recipe output and item effects from the same definitions, including restoration and supply limits', () => {
    const c = copy();
    c.items.find((entry) => entry.id === 'healing-pill')!.use = { kind: 'restore', resource: 'hp', amount: '47.5' };
    c.settings.supplyCooldownMs = 27000;
    c.recipes[0].outputQuantity = '3';
    const rules = createRules(c);
    const state = rules.createGame(0);
    state.player.hp = '10';
    const view = rules.getGameView(state);
    for (const recipe of view.recipes) {
      const item = view.inventory.find((entry) => entry.id === recipe.outputId)!;
      expect(recipe.outputName).toBe(item.name);
      expect(recipe.effects).toEqual(item.effects);
      expect(recipe.description).toContain(`${item.name} ×${recipe.outputQuantity}`);
      expect(recipe.effects).not.toBe(item.effects);
    }
    const healing = view.inventory.find((entry) => entry.id === 'healing-pill')!;
    expect(healing.effects[0]).toContain('恢复 47.5 气血');
    expect(healing.effects[0]).toContain('该项已满时不消耗');
    expect(healing.effects).toContain('仅可脱战后手动服用');
    expect(healing.effects.at(-1)).toContain('27 秒间隔限制');
    expect(view.recipes[0]).toMatchObject({ outputId: 'healing-pill', outputName: '回春丹', outputQuantity: '3' });
    expect(rules.applyCommand(state, { type: 'consume', itemId: 'healing-pill', quantity: 1 }).player.hp).toBe('57.5');
  });

  it('describes the inclusive growth threshold and diminishing returns without implementation notation', () => {
    const c = copy();
    c.items.find((entry) => entry.id === 'attack-pill')!.use = { kind: 'growth', stat: 'attack', amount: '2', scale: '10' };
    c.settings.breakthroughQuantity = '2';
    const rules = createRules(c);
    const state = rules.createGame(0);
    state.player.pillAttack = '10';
    state.inventory['attack-pill'] = '2';
    const view = rules.getGameView(state);
    const growth = view.inventory.find((entry) => entry.id === 'attack-pill')!;
    expect(growth.effects[0]).toContain('不超过 10 时，每颗增加 2');
    expect(growth.effects[0]).toContain('超过后，每颗收益随累计加成提高而递减');
    const first = rules.applyCommand(state, { type: 'consume', itemId: 'attack-pill', quantity: 1 });
    expect(first.player.pillAttack).toBe('12');
    expect(Number(rules.applyCommand(first, { type: 'consume', itemId: 'attack-pill', quantity: 1 }).player.pillAttack))
      .toBeCloseTo(13 + 2 / 3);
    expect(view.inventory.find((entry) => entry.id === 'foundation-pill')!.effects.join('；'))
      .toMatch(/消耗 2 颗保证筑基成功.*脱战.*无需储满/);
    const visible = [
      ...view.inventory.map((entry) => entry.description),
      ...view.equipment.flatMap((entry) => [entry.description, ...entry.effects, ...entry.affixes]),
      ...view.techniques.map((entry) => entry.description),
      ...view.regions.flatMap((entry) => entry.enemies.flatMap((enemy) => enemy.abilities)),
      ...view.recipes.map((entry) => entry.description),
    ].join('\n');
    expect(visible).not.toMatch(/\bS\b|逐颗计算|派生|不触发|原量接续/);
  });
});

describe('presentation-only projection and content extensions', () => {
  it('exposes authored lore and grades for all existing inventory, weapons, techniques, recipes and regions', () => {
    const rules = createRules();
    const state = rules.createGame(0);
    state.equipment = content.equipment.map((entry) => instance(entry.id));
    const view = rules.getGameView(state);
    expect(view.presentationVersion).toBe(presentation.version);
    for (const item of view.inventory) expect(item).toMatchObject(presentation.items[item.id]);
    for (const equipment of view.equipment) expect(equipment).toMatchObject(presentation.equipment[equipment.definitionId]);
    for (const technique of view.techniques) expect(technique).toMatchObject(presentation.techniques[technique.id]);
    for (const recipe of view.recipes) expect(recipe).toMatchObject(presentation.recipes[recipe.id]);
    for (const region of view.regions) {
      expect(region).toMatchObject(presentation.regions[region.id]);
      expect(region.description).toBe(content.regions.find((entry) => entry.id === region.id)!.description);
      for (const enemy of region.enemies) expect(enemy).toMatchObject(presentation.enemies[enemy.id]);
    }
  });

  it('allows createRules extensions without requiring future IDs in the shipped metadata', () => {
    const c = copy();
    c.items.push({ ...c.items[0], id: 'new-herb', name: '星露草' });
    c.equipment.push({
      id: 'test-gauntlet', name: '试炼拳套', slot: 'weapon', category: 'gauntlet',
      modifiers: [{ stat: 'attack', mode: 'flat', value: '500' }],
      effects: ['hit-mend'], affixPool: ['spirit'], affixCount: 1,
    });
    c.techniques.push({ ...c.techniques[0], id: 'new-technique', name: '望星诀' });
    c.enemies.push({ ...c.enemies[0], id: 'new-enemy', name: '守灯灵' });
    c.regions.push({ ...c.regions[0], id: 'new-region', name: '听星谷', enemies: ['new-enemy'] });
    c.recipes.push({ ...c.recipes[0], id: 'new-recipe', name: '星露草方', outputId: 'new-herb' });
    c.settings.starterEquipmentId = 'test-gauntlet';
    const rules = createRules(c);
    const state = rules.applyCommand(rules.createGame(0, 1), { type: 'activity', kind: 'dungeon', targetId: 'new-region' });
    const before = JSON.stringify(state);
    const view = rules.getGameView(JSON.parse(before) as GameState);
    const item = view.inventory.find((entry) => entry.id === 'new-herb')!;
    const equipment = view.equipment[0];
    const technique = view.techniques.find((entry) => entry.id === 'new-technique')!;
    const recipe = view.recipes.find((entry) => entry.id === 'new-recipe')!;
    const region = view.regions.find((entry) => entry.id === 'new-region')!;
    for (const entry of [item, equipment, technique, recipe]) {
      expect(entry.rarity).toBe('common');
      expect(entry.lore).toContain(entry.name);
    }
    expect(region.lore).toContain(region.name);
    expect(region.enemies[0].lore).toContain('守灯灵');
    expect(view.battle!.lore).toBe(region.enemies[0].lore);
    expect(equipment.category).toBe('gauntlet');
    expect(equipment.stats).toEqual([{ label: '物攻', value: '+500' }]);
    expect(equipment.effects).toEqual(['每段招式命中后恢复 2 气血（不超过上限，不受暴击影响）']);
    expect(equipment.affixes[0]).toContain(`${state.equipment[0].affixes[0].effect!.amount} 灵力`);
    expect(view.player.stats.attack).toBe('510');
    expect(JSON.stringify(state)).toBe(before);
    expect(getPresentation('equipment', { id: 'constructor', name: '古剑' }).lore).toContain('古剑');
  });

  it('does not mutate even a frozen save or alias any newly exposed nested view data', () => {
    const rules = createRules();
    const state = rules.applyCommand(rules.createGame(0, 31), { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    state.equipment[0].affixes.push({
      definitionId: 'mending', value: '3',
      effect: { id: 'hit-mend', name: '回春', trigger: 'hit', kind: 'restore', resource: 'hp', amount: '3' },
    });
    const before = JSON.stringify(state);
    const definitions = JSON.stringify(rules.content);
    const metadata = JSON.stringify(presentation);
    const view = rules.getGameView(freeze(state));
    view.equipment[0].stats[0].value = '+999';
    view.equipment[0].effects.push('changed');
    view.equipment[0].lore = 'changed';
    view.equipment[0].rarity = 'epic';
    view.player.action.coefficient = '999';
    view.techniques[0].effects.push('changed');
    view.techniques[0].action.name = 'changed';
    view.battle!.action.hits = 8;
    view.regions[0].enemies[0].action.mpCost = '999';
    view.inventory[0].effects.push('changed');
    view.recipes[0].effects.push('changed');
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(rules.content)).toBe(definitions);
    expect(JSON.stringify(presentation)).toBe(metadata);
    expect(rules.getGameView(state).equipment[0].stats[0].value).toBe('+3');
  });

  it('keeps RNG, saved equipment and subsequent simulation identical after repeated views and JSON round trips', () => {
    const rules = createRules();
    let state = rules.createGame(0, 1);
    state.level = 4;
    state = rules.applyCommand(state, { type: 'activity', kind: 'dungeon', targetId: 'bamboo' });
    const expected = rules.advanceGame(state, 60_000);
    let displayed = state;
    for (let at = 1000; at <= 60_000; at += 1000) {
      const before = JSON.stringify(displayed);
      rules.getGameView(displayed);
      expect(JSON.stringify(displayed)).toBe(before);
      displayed = rules.advanceGame(JSON.parse(before) as GameState, at);
    }
    expect(displayed).toEqual(expected);
    expect(rules.getGameView(displayed)).toEqual(rules.getGameView(expected));
    expect(displayed).not.toHaveProperty('presentationVersion');
    expect(JSON.stringify(displayed)).not.toMatch(/"lore"|"rarity"|"masteryEffects"/);
  });

  it('maps the breakthrough stop reason and journal only in the view, preserving the real save and reserve', () => {
    const rules = createRules();
    const state = rules.createGame(0);
    state.level = 12;
    state.cultivation = '17000';
    state.reserve = '1234.5';
    state.inventory['foundation-pill'] = '1';
    const after = rules.applyCommand(state, { type: 'breakthrough', lifeId: state.lifeId, methodId: 'human' });
    const before = JSON.stringify(after);
    const view = rules.getGameView(after);
    expect(after.activity.stopReason).toBe('筑基成功，已吸收储备原量接续；请选择后续活动');
    expect(after.journal[0].text).toBe(after.activity.stopReason);
    expect(view.activity.stopReason).toBe('筑基成功，积蓄的修为已悉数融入道基；可继续修行');
    expect(view.journal[0].text).toBe(view.activity.stopReason);
    expect(view.journal.at(-1)!.text).toBe('筑基成功');
    expect(after.cultivation).toBe('1234.5');
    expect(after.reserve).toBe('0');
    expect(JSON.stringify(after)).toBe(before);
  });
});
