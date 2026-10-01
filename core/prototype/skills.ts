import { z } from 'zod';
import { dec, minimum, text } from '../numbers';
import { realmAt, skillThreshold } from './growth';
import { MINING } from './gathering';
import { positiveValue } from './effects';
import { nonnegativeSchema, type StatSource } from './types';

const BASIC_SKILLS = {
  combat: { name: '战技', cost: '60', scaling: '1.8', max: 300 },
  unarmed: { name: '拳脚', cost: '40', scaling: '1.8', max: 60, tags: ['weapon'] },
  sword: { name: '剑术', cost: '40', scaling: '1.8', max: 60, tags: ['weapon'] },
  toughness: { name: '筋骨', cost: '100', scaling: '2', max: 200 },
  rest: { name: '养息', cost: '1000', scaling: '2', max: 50, tags: ['rest'] },
  refining: { name: '炼制', cost: '40', scaling: '1.5', max: 999, tags: ['refining'] },
  trade: { name: '议价', cost: '100', scaling: '2', max: 999, tags: ['trade'] },
} as const;
export const MEDITATION_STAGES = [
  { prerequisite: null, xp: '1' },
  { prerequisite: 'pine-ravine', xp: '2' },
  { prerequisite: 'hidden-furnace-wall', xp: '4' },
] as const;
export const MANUALS = {
  'cloudstep-art': {
    name: '穿云诀', cost: '60', scaling: '1.8', max: 30, attribute: 'attackSpeed',
    tags: ['manual'],
    prerequisite: 'stony-trail', location: 'hermit-stone-chamber',
    description: '封存于陶匣的行气法门。起首的缓息次序与村中口诀相合，后篇讲的是催气轻身、加快出手。',
  },
  'mountainforce-art': {
    name: '撼山功', cost: '60', scaling: '1.8', max: 30, attribute: 'attack',
    tags: ['manual'],
    prerequisite: 'stony-trail', location: 'hermit-stone-chamber',
    description: '与《穿云诀》同匣收存的旧册，纸页完整。图中所绘皆是聚气运劲的方法，着重将气力贯入一击。',
  },
} as const;
export type ManualId = keyof typeof MANUALS;
export const MANUAL_IDS = Object.keys(MANUALS) as ManualId[];
export const manualIdSchema = z.enum(['cloudstep-art', 'mountainforce-art']);
export const TRAININGS = {
  footwork: {
    name: '身法', actionName: '借风练步', cost: '40', scaling: '1.8', max: 50,
    prerequisite: 'reed-marsh', location: 'stone-training-ground',
  },
  physique: {
    name: '体魄', actionName: '承压锻体', cost: '40', scaling: '1.8', max: 50,
    prerequisite: 'reed-marsh', location: 'stone-training-ground',
  },
} as const;
export type TrainingId = keyof typeof TRAININGS;
export const TRAINING_IDS = Object.keys(TRAININGS) as TrainingId[];
export const trainingIdSchema = z.enum(['footwork', 'physique']);
export const ARTIFACT_SKILLS = {
  'returning-lamp': { name: '归息盏', cost: '600000', scaling: '20', max: 3 },
} as const;
export type ArtifactSkillId = keyof typeof ARTIFACT_SKILLS;
export const SKILLS = {
  ...BASIC_SKILLS, ...MANUALS, ...TRAININGS, mining: MINING, ...ARTIFACT_SKILLS,
  greatsword: { name: '重剑术', cost: '40', scaling: '1.8', max: 60, tags: ['weapon'] as const },
};
export type WeaponSkill = 'unarmed' | 'sword' | 'greatsword';
export type SkillId = keyof typeof SKILLS;
const progress = (max: number) => z.object({
  level: z.number().int().min(0).max(max), xp: nonnegativeSchema,
}).strict();
export const skillsSchema = z.object({
  combat: progress(300), unarmed: progress(60), sword: progress(60), toughness: progress(200),
  rest: progress(50), refining: progress(999), trade: progress(999),
  'cloudstep-art': progress(30).optional(), 'mountainforce-art': progress(30).optional(),
  footwork: progress(50).optional(), physique: progress(50).optional(),
  mining: progress(60).optional(),
  'returning-lamp': progress(3).optional(),
  greatsword: progress(60).optional(),
}).strict();
export type SkillProgress = z.infer<typeof skillsSchema>;
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
const thresholds = new Map<string, string>();

export function threshold(id: SkillId, level: number): string {
  const key = `${id}:${level}`;
  if (!thresholds.has(key)) thresholds.set(key, skillThreshold(SKILLS[id].cost, SKILLS[id].scaling, level));
  return thresholds.get(key)!;
}

export function initialSkills(): SkillProgress {
  return Object.fromEntries(Object.keys(BASIC_SKILLS).map((id) => [id, { level: 0, xp: '0' }])) as SkillProgress;
}

export function manualSource(id: ManualId, level: number): StatSource {
  const manual = MANUALS[id];
  if (!Number.isInteger(level) || level < 0 || level > manual.max) throw new Error('Invalid manual level');
  const progress = dec(level).div(manual.max);
  return {
    id: `manual:${id}`,
    tags: ['manual'],
    statPolarity: { multiplier: { [manual.attribute]: 'benefit', maxHp: 'cost' } },
    multiplier: {
      [manual.attribute]: text(dec('1.1').plus(progress.mul('.1'))),
      maxHp: text(dec('.75').plus(progress.mul('.25'))),
    },
  };
}

const restMilestones = [
  [2, '1.05'], [4, '1.05'], [6, '1.05'], [8, '1.05'], [10, '1.1'], [15, '1.05'],
  [20, '1.05'], [25, '1.1'], [30, '1.05'], [40, '1.05'], [50, '1.1'],
] as const;
function restMultiplier(level: number) {
  return restMilestones.reduce((value, [at, factor]) => level >= at ? value.mul(factor) : value, dec(1));
}

function trainingSource(id: TrainingId, level: number): StatSource {
  const milestones = [3, 7, 12, 15].filter(at => level >= at).length;
  const coefficient = text(dec('1.2833').pow(dec(level).div(TRAININGS[id].max)).toDecimalPlaces(3));
  if (id === 'footwork') {
    return {
      id: 'skill:footwork',
      flat: { agility: String((level >= 1 ? 10 : 0) + (level >= 5 ? 20 : 0) + (level >= 10 ? 30 : 0)) },
      multiplier: { attackSpeed: coefficient, agility: text(dec('1.01').pow(milestones)) },
    };
  }
  return {
    id: 'skill:physique',
    flat: { hpRegen: String((level >= 1 ? 20 : 0) + (level >= 5 ? 30 : 0) + (level >= 10 ? 50 : 0)) },
    multiplier: { maxHp: text(dec(coefficient).mul(dec('1.05').pow(milestones))) },
  };
}

export function allExperienceMultiplier(skills: SkillProgress): string {
  let factor = restMultiplier(skills.rest.level);
  for (const [at, value] of [[5, '1.05'], [10, '1.05'], [60, '1.1']] as const) {
    if (skills.sword.level >= at) factor = factor.mul(value);
  }
  for (const [at, value] of [[1, '2'], [2, '1.5'], [3, '1.3333']] as const) {
    if ((skills['returning-lamp']?.level ?? 0) >= at) factor = factor.mul(value);
  }
  if ((skills.greatsword?.level ?? 0) >= 60) factor = factor.mul('1.1');
  return text(factor);
}

export function insightExperienceMultiplier(points = '0'): string {
  nonnegativeSchema.parse(points);
  return text(dec(points).plus(1).pow('0.07'));
}

export function gainSkill(
  skills: SkillProgress, id: SkillId, amount: string, realm: number, insight?: string, sources: readonly StatSource[] = [],
): boolean {
  nonnegativeSchema.parse(amount);
  const skill = skills[id];
  if (!skill) throw new Error('Cannot train an unlearned skill');
  if (skill.level === SKILLS[id].max) return false;
  const definition = SKILLS[id];
  const base = text(dec(amount).mul(allExperienceMultiplier(skills)).mul(realmAt(realm).skillXpMultiplier)
    .mul(insightExperienceMultiplier(insight)));
  const earned = dec(positiveValue(base, 'experience.skill', sources, {
    tags: ['skill', ...('tags' in definition ? definition.tags : [])],
  })).toDecimalPlaces(2);
  skill.xp = minimum(dec(skill.xp).plus(earned), threshold(id, SKILLS[id].max));
  const before = skill.level;
  while (skill.level < SKILLS[id].max && dec(skill.xp).gte(threshold(id, skill.level + 1))) skill.level++;
  return skill.level !== before;
}

export function skillSources(skills: SkillProgress, weapon: WeaponSkill): StatSource[] {
  const sword = skills.sword.level;
  const flat = { attackSpeed: dec(0), critChance: dec(0), critMultiplier: dec(0) };
  for (const [at, speed, chance, critical] of [
    [1, 0, 0, .01], [3, .01, 0, 0], [5, 0, .01, 0], [7, .01, 0, 0],
    [10, 0, .01, .01], [40, .01, 0, .02], [60, .02, 0, .04],
  ]) {
    if (sword >= at) {
      flat.attackSpeed = flat.attackSpeed.plus(speed);
      flat.critChance = flat.critChance.plus(chance);
      flat.critMultiplier = flat.critMultiplier.plus(critical);
    }
  }
  const greatsword = skills.greatsword?.level ?? 0;
  const heavyCritical = [
    [20, '0.05'], [25, '0.05'], [30, '0.10'], [40, '0.04'], [60, '0.08'],
  ] as const;
  return [
    { id: 'skill:combat', multiplier: { agility: text(dec(16).pow(dec(skills.combat.level).div(300)).toDecimalPlaces(3)) } },
    { id: 'skill:weapon', multiplier: {
      critChance: text(dec(weapon === 'unarmed' ? 64 : 2)
        .pow(dec(skills[weapon]?.level ?? 0).div(60)).toDecimalPlaces(3)),
    } },
    { id: 'skill:toughness', multiplier: { defense: text(dec(1).plus(dec(skills.toughness.level).div(100))) } },
    { id: 'skill:sword-milestones', flat: {
      attackSpeed: text(flat.attackSpeed), critChance: text(flat.critChance), critMultiplier: text(flat.critMultiplier),
    } },
    { id: 'skill:rest-milestones', multiplier: { maxHp: text(restMultiplier(skills.rest.level)) } },
    ...(skills.greatsword ? [{ id: 'skill:greatsword-milestones', flat: {
      critChance: text(dec(greatsword >= 40 ? '0.01' : 0).plus(greatsword >= 60 ? '0.02' : 0)),
      critMultiplier: text(heavyCritical.reduce((value, [at, gain]) => greatsword >= at ? value.plus(gain) : value, dec(0))),
    } }] : []),
    ...TRAINING_IDS.flatMap(id => skills[id] ? [trainingSource(id, skills[id].level)] : []),
  ];
}
