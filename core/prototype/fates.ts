import { z } from 'zod';
import { random } from '../numbers';
import type { EffectModifier, StatSource } from './types';

export const FATE_TIERS = {
  ordinary: { name: '凡品', weight: 60 },
  spiritual: { name: '灵品', weight: 30 },
  profound: { name: '玄品', weight: 9 },
  heavenly: { name: '天品', weight: 1 },
} as const;
export type FateTier = keyof typeof FATE_TIERS;
export const FATE_TIER_IDS = Object.keys(FATE_TIERS) as FateTier[];

interface FateDefinition {
  name: string;
  tier: FateTier;
  description: string;
  effectDescription: string;
  modifiers: EffectModifier[];
}

export const FATES = {
  'strong-arms': {
    name: '膂力过人', tier: 'ordinary',
    description: '你生来筋骨蕴劲，力自脊起，贯于拳锋；凡躯之中，亦藏刚猛之势。',
    effectDescription: '普攻伤害+1%，不增加面板攻击。',
    modifiers: [{ target: 'damage.dealt', operation: 'increase', value: '0.01', tags: ['basic-attack'] }],
  },
  'thick-hide': {
    name: '皮实肉厚', tier: 'ordinary',
    description: '你的皮肉天生坚韧，气血伏于肌理，外力加身，自有一分浑厚相抗。',
    effectDescription: '受到直接攻击的伤害-1%，不减免药食扣血或落空反伤。',
    modifiers: [{ target: 'damage.taken', operation: 'increase', value: '-0.01', tags: ['direct'] }],
  },
  'lasting-vitality': {
    name: '气血绵长', tier: 'ordinary',
    description: '你血气充盈，脉动深长，如幽谷藏泉，内蕴悠长余力。',
    effectDescription: '气血上限+3%。',
    modifiers: [{ target: 'stat.maxHp', operation: 'increase', value: '0.03' }],
  },
  'light-step': {
    name: '步履轻灵', tier: 'ordinary',
    description: '你筋骨轻灵，步转如流云过隙，进退之间，身随意走。',
    effectDescription: '敏捷+2%。',
    modifiers: [{ target: 'stat.agility', operation: 'increase', value: '0.02' }],
  },
  'keen-memory': {
    name: '过目不忘', tier: 'ordinary',
    description: '你心中似有一面澄镜，招式经义一经映照，便留痕不散。',
    effectDescription: '各类技能熟练获取+3%。',
    modifiers: [{ target: 'experience.skill', operation: 'increase', value: '0.03' }],
  },
  'crafting-hands': {
    name: '百炼巧手', tier: 'ordinary',
    description: '你指掌通巧，百炼之间渐识物性，炉前所得，皆化作手中分寸。',
    effectDescription: '炼制熟练获取+8%，不直接提高成功率或品质。',
    modifiers: [{ target: 'experience.skill', operation: 'increase', value: '0.08', tags: ['refining'] }],
  },
  'supply-affinity': {
    name: '药食相宜', tier: 'ordinary',
    description: '你体内气机温润，药食精华入腹，犹如春露涵枝，余泽不易散尽。',
    effectDescription: '药食正面持续效果时长+6%，负面时长不变；不改变每秒恢复、即时用品或服用资格。',
    modifiers: [{ target: 'duration', operation: 'increase', value: '0.06', tags: ['supply', 'benefit'] }],
  },
  'wild-intuition': {
    name: '山野灵觉', tier: 'ordinary',
    description: '你灵觉与山野相亲，荒草乱石之间，偶有一缕微妙感应，引你拾得遗珍。',
    effectDescription: '适用随机战利品期望数量+2%，不影响固定首清物品、商店或寄售。',
    modifiers: [{ target: 'loot.quantity', operation: 'increase', value: '0.02', tags: ['loot'] }],
  },
  'renewing-vitality': {
    name: '生息绵长', tier: 'ordinary',
    description: '你一身生机如草木藏春，得一分滋养，便有余力徐徐回转。',
    effectDescription: '正向气血恢复量+5%，包括药食、装备与安全点休整；不影响负面扣血、气血校正或晋升回满。',
    modifiers: [{ target: 'healing.received', operation: 'increase', value: '0.05' }],
  },
  'jade-insight': {
    name: '辨石识玉', tier: 'ordinary',
    description: '你观石能辨纹理，触岩似识脉络，开凿之间，自得顺势取材之妙。',
    effectDescription: '采矿作业速度+10%，保留小数进度；每轮出货概率、数量、熟练与矿脉衰减次数不变。',
    modifiers: [{ target: 'activity.speed', operation: 'increase', value: '0.1', tags: ['mining'] }],
  },
  'woodland-affinity': {
    name: '草木亲和', tier: 'ordinary',
    description: '你与草木生机隐有相亲，枝纹木理入眼，取材之间，自知顺势落斧。',
    effectDescription: '采木作业速度+10%，保留小数进度；每轮产量与熟练不变，不影响采矿。',
    modifiers: [{ target: 'activity.speed', operation: 'increase', value: '0.1', tags: ['logging'] }],
  },
  'vigorous-frame': {
    name: '筋骨健旺', tier: 'spiritual',
    description: '你骨坚筋韧，血气贯通四肢百骸，静若盘根老木，动有沉劲相随。',
    effectDescription: '气血上限+4%，普攻伤害+1%。',
    modifiers: [
      { target: 'stat.maxHp', operation: 'increase', value: '0.04' },
      { target: 'damage.dealt', operation: 'increase', value: '0.01', tags: ['basic-attack'] },
    ],
  },
  'wind-body': {
    name: '风灵体', tier: 'spiritual',
    description: '你生来与清风相契，气行轻捷，衣袂未落，身势已转。',
    effectDescription: '攻速+2%，敏捷+3%。',
    modifiers: [
      { target: 'stat.attackSpeed', operation: 'increase', value: '0.02' },
      { target: 'stat.agility', operation: 'increase', value: '0.03' },
    ],
  },
  'martial-insight': {
    name: '武道通明', tier: 'spiritual',
    description: '你于武道独具灵犀，拳锋剑势之中，自能窥见劲力流转的关窍。',
    effectDescription: '普攻伤害+2%，武器技能熟练获取+6%，包括拳脚。',
    modifiers: [
      { target: 'damage.dealt', operation: 'increase', value: '0.02', tags: ['basic-attack'] },
      { target: 'experience.skill', operation: 'increase', value: '0.06', tags: ['weapon'] },
    ],
  },
  'clear-mind': {
    name: '慧心通明', tier: 'spiritual',
    description: '你慧光内蕴，心境如清潭照月，诸般术理映入心中，自有脉络可循。',
    effectDescription: '各类技能熟练获取+6%。',
    modifiers: [{ target: 'experience.skill', operation: 'increase', value: '0.06' }],
  },
  'manual-insight': {
    name: '法悟清明', tier: 'spiritual',
    description: '你心神于行气经义独有明悟，真元流转之间，诸般法门渐显清晰脉络。',
    effectDescription: '功法熟练获取+10%；只作用于实际修习的功法，功法造诣沿原关联规则增长，不重复加成。',
    modifiers: [{ target: 'experience.skill', operation: 'increase', value: '0.1', tags: ['manual'] }],
  },
  'alchemical-flame': {
    name: '丹火灵体', tier: 'spiritual',
    description: '你体魄暗合炉火之性，火意升沉皆有所感，调火化材，自有灵韵相应。',
    effectDescription: '普通炼制成功率乘1.02，最高100%，不是增加2个百分点；炼制熟练获取+10%，失败耗材不变。',
    modifiers: [
      { target: 'craft.success', operation: 'multiply', value: '1.02', tags: ['refining', 'ordinary'] },
      { target: 'experience.skill', operation: 'increase', value: '0.1', tags: ['refining'] },
    ],
  },
  'herbal-body': {
    name: '百药灵体', tier: 'spiritual',
    description: '你经脉与百草灵性相合，药华易驻，浊滞易散，似有清泉涤荡其间。',
    effectDescription: '药食正面持续效果时长+8%，负面时长-5%；不改变即时用品或服用资格。',
    modifiers: [
      { target: 'duration', operation: 'increase', value: '0.08', tags: ['supply', 'benefit'] },
      { target: 'duration', operation: 'increase', value: '-0.05', tags: ['supply', 'cost'] },
    ],
  },
  'balanced-meridians': {
    name: '药脉平和', tier: 'spiritual',
    description: '你经脉温养而不躁，药力奔行之际，血气自有和缓之势，少受耗损。',
    effectDescription: '药食持续失血幅度减少10%，每秒失血1%变为0.9%；不改变药效时长、正向恢复、其它属性代价或装备耗血。',
    modifiers: [{ target: 'source.upkeep', operation: 'increase', value: '-0.1', tags: ['supply'] }],
  },
  'battle-composure': {
    name: '临阵从容', tier: 'spiritual',
    description: '你心气沉定，众敌环伺亦不自乱，守身进退之间，自留一分从容。',
    effectDescription: '每击前至少两名敌人存活时，直接承伤减少3%；仅剩一名即失效，不减免反震、落空惩罚或药食扣血。',
    modifiers: [
      { target: 'damage.taken', operation: 'increase', value: '-0.03', tags: ['direct'],
        when: { livingEnemiesAtLeast: 2 } },
    ],
  },
  'fortunate-star': {
    name: '福星高照', tier: 'spiritual',
    description: '你命中有吉曜垂光，尘沙掩玉之处，亦藏不期而遇的机缘。',
    effectDescription: '适用随机战利品期望数量+4%，不影响固定首清物品、商店或寄售。',
    modifiers: [{ target: 'loot.quantity', operation: 'increase', value: '0.04', tags: ['loot'] }],
  },
  'spirit-gathering': {
    name: '聚灵之体', tier: 'spiritual',
    description: '你体魄亲近天地灵机，尘途历练所得，更易凝作自身道行。',
    effectDescription: '历练修为获取+4%，包括击杀及首次、重复清区；不增加蕴元灵露等固定用品收益。',
    modifiers: [{ target: 'experience.cultivation', operation: 'increase', value: '0.04', tags: ['activity'] }],
  },
  'lucid-heart': {
    name: '玲珑慧心', tier: 'profound',
    description: '你心窍玲珑，如明珠映彻内外；技艺精微、行功滞涩，皆能照见几分。',
    effectDescription: '各类技能熟练获取+8%；运转功法的持续属性代价幅度减少10%，不直接减免10个百分点。',
    modifiers: [
      { target: 'experience.skill', operation: 'increase', value: '0.08' },
      { target: 'source.cost', operation: 'increase', value: '-0.1', tags: ['manual'] },
    ],
  },
  'adamant-body': {
    name: '金刚之躯', tier: 'profound',
    description: '你的筋骨隐有金石之韵，气血凝实，虽是血肉之躯，亦具百炼之坚。',
    effectDescription: '气血上限+5%，受到直接攻击的伤害-2%。',
    modifiers: [
      { target: 'stat.maxHp', operation: 'increase', value: '0.05' },
      { target: 'damage.taken', operation: 'increase', value: '-0.02', tags: ['direct'] },
    ],
  },
  'battle-spirit': {
    name: '斗战灵体', tier: 'profound',
    description: '你骨血中藏有斗战之意，数合蓄势，一击扬锋，刚烈之意尽在招间。',
    effectDescription: '普攻伤害+1%；每第5次普攻再加15个百分点，该次合计+16%。落空也计次，跨敌群、撤退及读档保留计数。',
    modifiers: [
      { target: 'damage.dealt', operation: 'increase', value: '0.01', tags: ['basic-attack'] },
      { target: 'damage.dealt', operation: 'increase', value: '0.15', tags: ['basic-attack'],
        when: { everyBasicAttacks: 5 } },
    ],
  },
  'artificer-heart': {
    name: '百炼灵心', tier: 'profound',
    description: '你有一颗通玄匠心，能察炉中物性消长；偶有灵机交汇，寻常一炼亦生余珍。',
    effectDescription: '炼制熟练获取+15%；普通配方成功后2%概率额外产出一批，不再耗材或奖励熟练。必成精炼、组装与升炼不适用。',
    modifiers: [
      { target: 'experience.skill', operation: 'increase', value: '0.15', tags: ['refining'] },
      { target: 'craft.extra-batch', operation: 'flat', value: '0.02', tags: ['refining', 'ordinary'] },
    ],
  },
  'natural-dao': {
    name: '道法天成', tier: 'heavenly',
    description: '你体内似藏一缕先天道韵，诸法临身，如水归川；运转之间，自趋圆融。',
    effectDescription: '运转功法、神通的正向属性增益幅度+10%，持续属性代价幅度-20%；只缩放来源增减量，不放大全角色属性、触发概率或次数。',
    modifiers: [
      { target: 'source.benefit', operation: 'increase', value: '0.1', tags: ['manual'] },
      { target: 'source.benefit', operation: 'increase', value: '0.1', tags: ['divine-art'] },
      { target: 'source.cost', operation: 'increase', value: '-0.2', tags: ['manual'] },
      { target: 'source.cost', operation: 'increase', value: '-0.2', tags: ['divine-art'] },
    ],
  },
  'unyielding-destiny': {
    name: '不屈命格', tier: 'heavenly',
    description: '你命中有不折之骨，气血衰微之际，犹如寒灰藏火，一线韧意仍与危厄相持。',
    effectDescription: '气血上限+5%；每击前气血不高于一半时，该次直接攻击伤害-6%。跨过半血线的一击不追溯减免。',
    modifiers: [
      { target: 'stat.maxHp', operation: 'increase', value: '0.05' },
      { target: 'damage.taken', operation: 'increase', value: '-0.06', tags: ['direct'],
        when: { hpAtMost: '0.5' } },
    ],
  },
} satisfies Record<string, FateDefinition>;

export type FateId = keyof typeof FATES;
export const FATE_IDS = Object.keys(FATES) as FateId[];
export const fateIdSchema = z.enum(FATE_IDS);

export function fateSource(id: FateId): StatSource {
  return { id: `fate:${id}`, modifiers: structuredClone(FATES[id].modifiers) };
}

// Draw only during character creation; readers derive effects from the saved identity.
export function drawFate(state: { rng: number }): FateId {
  let roll = random(state) * FATE_TIER_IDS.reduce((total, tier) => total + FATE_TIERS[tier].weight, 0);
  for (const tier of FATE_TIER_IDS) {
    if (roll < FATE_TIERS[tier].weight) {
      const pool = FATE_IDS.filter(id => FATES[id].tier === tier);
      return pool[Math.floor(random(state) * pool.length)];
    }
    roll -= FATE_TIERS[tier].weight;
  }
  throw new Error('Invalid fate draw');
}
