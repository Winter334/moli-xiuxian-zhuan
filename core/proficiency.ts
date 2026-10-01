import type { Content, Modifier, Proficiency } from './content';
import type { ProficiencyId } from '../shared/contracts';
import { dec, maximum, minimum, text } from './numbers';

export function proficiencyProgress(definition: Proficiency, xp: string) {
  let level = 0;
  let threshold = dec(0);
  let cost = dec(definition.xpBase);
  while (level < definition.maxLevel) {
    threshold = threshold.plus(cost);
    if (dec(xp).lt(threshold)) return { level, nextLevelXp: text(threshold) };
    level++;
    cost = cost.mul(definition.xpGrowth);
  }
  return { level, nextLevelXp: null };
}

export function proficiencyCap(definition: Proficiency) {
  return text(dec(definition.xpBase).mul(dec(definition.xpGrowth).pow(definition.maxLevel).minus(1))
    .div(dec(definition.xpGrowth).minus(1)));
}

export function proficiencyTrainingGain(
  content: Content, id: ProficiencyId, currentXp: string, historicalXp: string, baseXp: string, ordinaryBonus: string,
) {
  const ordinaryRate = dec(ordinaryBonus).plus(1);
  const gap = dec(maximum(0, dec(historicalXp).minus(currentXp)));
  const catchupRate = ordinaryRate.plus(content.reincarnation.retrainingBonus);
  const base = dec(baseXp);
  // Split the base work at the old record; overflow receives only ordinary efficiency.
  const gain = base.mul(catchupRate).lte(gap) ? base.mul(catchupRate)
    : gap.plus(base.minus(gap.div(catchupRate)).mul(ordinaryRate));
  const cap = proficiencyCap(content.proficiencies.find((definition) => definition.id === id)!);
  return minimum(gain, maximum(0, dec(cap).minus(currentXp)));
}

export function proficiencyRewards(definition: Proficiency, xp: string) {
  const progress = proficiencyProgress(definition, xp);
  const milestones = definition.milestones.filter((entry) => entry.level <= progress.level);
  return {
    ...progress,
    modifiers: [
      ...definition.perLevel.map((modifier): Modifier => ({
        ...modifier, value: text(dec(modifier.value).mul(progress.level)),
      })),
      ...milestones.flatMap((entry) => entry.modifiers),
    ],
    successBonus: milestones.reduce((sum, entry) => sum.plus(entry.successBonus), dec(0)).toFixed(),
    extraOutputChance: milestones.reduce((sum, entry) => sum.plus(entry.extraOutputChance ?? '0'), dec(0)).toFixed(),
    qualityWeightBonus: milestones.reduce((sum, entry) => sum.plus(entry.qualityWeightBonus ?? '0'), dec(0)).toFixed(),
    ability: milestones.filter((entry) => entry.ability).at(-1)?.ability,
  };
}

export function combatProficiencyXp(content: Content, enemy: Content['enemies'][number]) {
  return text(dec(content.proficiencyRules.combatXpPerAction)
    .mul(content.proficiencyRules.realmXpMultipliers[enemy.level])
    .mul(enemy.allocation?.rank === 'elite' ? content.proficiencyRules.eliteXpMultiplier : 1));
}

export function forgingQualityWeights(content: Content, xp: string) {
  const reward = proficiencyRewards(content.proficiencies.find((p) => p.id === 'forging')!, xp);
  const bonus = dec(content.proficiencyRules.qualityWeightPerLevel).mul(reward.level).plus(reward.qualityWeightBonus);
  return content.equipmentQualities?.map((quality, index) => dec(quality.weight).mul(bonus.mul(index).plus(1)));
}

export function forgingQualityRolls(content: Content, xp: string) {
  return proficiencyRewards(content.proficiencies.find((p) => p.id === 'forging')!, xp).ability?.kind === 'quality-reroll' ? 2 : 1;
}

export function forgingQualityProbabilities(content: Content, xp: string) {
  const weights = forgingQualityWeights(content, xp);
  if (!weights) return undefined;
  const total = weights.reduce((sum, weight) => sum.plus(weight), dec(0));
  const rolls = forgingQualityRolls(content, xp);
  let cumulative = dec(0);
  return weights.map((weight) => {
    const before = cumulative;
    cumulative = cumulative.plus(weight.div(total));
    return text(cumulative.pow(rolls).minus(before.pow(rolls)));
  });
}

export function productionTerms(content: Content, xp: Record<ProficiencyId, string>, recipe: Content['recipes'][number]) {
  const proficiencyId = recipe.outputKind === 'equipment' ? 'forging' : 'alchemy';
  const definition = content.proficiencies.find((entry) => entry.id === proficiencyId)!;
  const reward = proficiencyRewards(definition, xp[proficiencyId]);
  const rules = content.proficiencyRules;
  const gap = Math.max(0, recipe.training.difficulty - reward.level);
  const successChance = minimum(1, dec(maximum(rules.minimumSuccess, dec(rules.successBase).pow(gap)))
    .plus(reward.successBonus));
  const successXp = recipe.training.xp;
  return {
    proficiencyId, difficulty: recipe.training.difficulty, successChance, successXp,
    failureXp: successXp,
    extraOutputChance: recipe.extraOutputEligible
      ? minimum(1, dec(rules.alchemyExtraChancePerLevel).mul(reward.level).plus(reward.extraOutputChance)) : '0',
    qualityRolls: recipe.outputKind === 'equipment' ? forgingQualityRolls(content, xp.forging) : 1,
  } as const;
}
