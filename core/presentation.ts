import { z } from 'zod';
import { content, type Action, type Effect, type Modifier } from './content';
import rawPresentation from './content/presentation.json';
import { dec } from './numbers';
import type { ActionView, GameView, Rarity } from '../shared/contracts';

const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const lore = z.string().trim().min(1);
const rarity = z.enum(['common', 'uncommon', 'rare', 'epic']);
const graded = z.strictObject({ lore, rarity });
const ungraded = z.strictObject({ lore });
const schema = z.strictObject({
  version: z.string().regex(/^presentation-\d+\.\d+\.\d+$/),
  schemaVersion: z.literal(1),
  items: z.record(id, graded),
  equipment: z.record(id, graded),
  techniques: z.record(id, graded),
  regions: z.record(id, ungraded),
  enemies: z.record(id, ungraded),
  recipes: z.record(id, graded),
  fates: z.record(id, ungraded),
  challenges: z.record(id, ungraded),
});

export type Presentation = z.infer<typeof schema>;
type GradedGroup = 'items' | 'equipment' | 'techniques' | 'recipes';
type UngradedGroup = 'regions' | 'enemies' | 'fates' | 'challenges';
type Group = GradedGroup | UngradedGroup;
type NamedEntry = { id: string; name: string; kind?: string; outputKind?: string };
type Lore = { lore: string };
type GradedLore = Lore & { rarity: Rarity };

export function loadPresentation(raw: unknown): Presentation {
  const result = schema.parse(raw);
  // Coverage is pinned to shipped content, not the optional createRules extension.
  for (const group of ['items', 'equipment', 'techniques', 'regions', 'enemies', 'recipes', 'fates', 'challenges'] as const) {
    const known = new Set([
      ...content[group].map((entry) => entry.id),
      ...(group === 'enemies' ? content.challenges.map((challenge) => challenge.enemy.id) : []),
    ]);
    for (const key of known) {
      if (!Object.hasOwn(result[group], key)) throw new Error(`展示元数据缺失：${group}.${key}`);
    }
    for (const key of Object.keys(result[group])) {
      if (!known.has(key)) throw new Error(`展示元数据引用不存在：${group}.${key}`);
      Object.freeze(result[group][key]);
    }
    Object.freeze(result[group]);
  }
  return Object.freeze(result);
}

export const presentation = loadPresentation(rawPresentation);

export function getPresentation(group: GradedGroup, entry: NamedEntry): GradedLore;
export function getPresentation(group: UngradedGroup, entry: NamedEntry): Lore;
export function getPresentation(group: Group, entry: NamedEntry): Lore | GradedLore {
  if (Object.hasOwn(presentation[group], entry.id)) return { ...presentation[group][entry.id] };
  const fallback: Record<Group, string> = {
    items: entry.kind === 'manual' ? `${entry.name}记有功法的行气路线、运转方式与修习要领。`
      : entry.kind === 'material' ? `${entry.name}是当地出产的材料，常用于修士的炼制与器物制作。`
      : `${entry.name}由药材炼成，供修士修行或远行时服用。`,
    equipment: `${entry.name}的来历已随旧主远去，风霜却替它留下了无言的见证。`,
    techniques: `${entry.name}藏着前人求道的心迹，未尽之意尚待后来者体悟。`,
    regions: `${entry.name}隐在山川深处，来往的风替此地守着久远的故事。`,
    enemies: `${entry.name}徘徊于人迹罕至之处，身世早已散入山间传闻。`,
    recipes: entry.outputKind === 'equipment' ? `${entry.name}记载选材、成形与加工工序，供匠人照方制器。`
      : `${entry.name}记载药材配伍、投料次序与炼制火候。`,
    fates: `${entry.name}是一种与生俱来的禀赋。`,
    challenges: `${entry.name}留有昔日修士的布置，须做好准备再去探查。`,
  };
  return group === 'regions' || group === 'enemies' || group === 'fates' || group === 'challenges'
    ? { lore: fallback[group] }
    : { lore: fallback[group], rarity: 'common' };
}

export function toActionView(action: Action): ActionView {
  return {
    name: action.name, damageType: action.damageType, hits: action.hits,
    coefficient: action.coefficient, mpCost: action.mpCost,
  };
}

export function describeAction(action: ActionView, baseActionName: string): string {
  const kind = action.damageType === 'physical' ? '物理' : '法术';
  const attack = action.damageType === 'physical' ? '物攻' : '法攻';
  const defense = action.damageType === 'physical' ? '物防逐段减免' : '法防逐段减免';
  const fallback = dec(action.mpCost).gt(0) ? `；灵力不足时改用${baseActionName}` : '';
  return `${action.name}：${action.hits} 段${kind}，每段${attack} ×${action.coefficient}，耗灵 ${action.mpCost}；每段均须命中，${defense}${fallback}`;
}

const statNames: Record<Modifier['stat'], string> = {
  maxHp: '气血上限', maxMp: '灵力上限', attack: '物攻', magicAttack: '法攻',
  defense: '物防', magicDefense: '法防',
  agility: '身法', hpRegen: '每秒气血回复', mpRegen: '每秒灵力回复',
};

export function toStatView(modifier: Modifier): GameView['equipment'][number]['stats'][number] {
  return {
    label: statNames[modifier.stat],
    value: `${dec(modifier.value).gte(0) ? '+' : ''}${modifier.mode === 'percent' ? `${dec(modifier.value).mul(100).toFixed()}%` : modifier.value}`,
  };
}

export function describeModifier(modifier: Modifier): string {
  const stat = toStatView(modifier);
  return `${stat.label} ${stat.value}`;
}

export function describeEffect(effect: Effect): string {
  const when = {
    hit: '每段招式命中后', hurt: '受到招式伤害、损失气血且仍存活时',
    action: '每次行动结束后', kill: '击败敌人后',
  }[effect.trigger];
  if (effect.kind === 'restore') {
    return `${when}恢复 ${effect.amount} ${effect.resource === 'hp' ? '气血' : '灵力'}（不超过上限，不受暴击影响）`;
  }
  if (effect.kind === 'restore-percent') {
    return `${when}恢复最大${effect.resource === 'hp' ? '气血' : '灵力'}的 ${dec(effect.amount).mul(100)}%（不超过上限）`;
  }
  if (effect.kind === 'shield') return `${when}获得 ${effect.amount} 护盾（总量不超过气血上限）`;
  const kind = effect.damageType === 'physical' ? '物理' : '法术';
  const defense = effect.damageType === 'physical' ? '受物防减免，可被护盾抵挡' : '受法防减免，可被护盾抵挡';
  return `${when}对敌人造成 ${effect.amount} 点${kind}伤害（${defense}；不能暴击，也不会引发命中附效或反击）`;
}

export function displayMessage(message: string): string {
  return message === '筑基成功，已吸收储备原量接续；请选择后续活动'
    ? '筑基成功，积蓄的修为已悉数融入道基；可继续修行'
    : message;
}
