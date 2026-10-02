import type { ResolvedEnemy } from '../../core/prototype/types';
import { formatAmount, percent } from '../format';

type EnemyAbility = { name: string; description?: string };

export function enemyAbilityDetails(a: ResolvedEnemy['abilities']): EnemyAbility[] {
  return [
    a.ignoreDefense && { name: '无视防御', description: '攻击时不扣除我方防御' },
    a.sturdy && { name: '坚固', description: '扣防后的普攻中间伤害至多1，随后计算波动、暴击与倍率；特定器物可提高此上限' },
    a.restraint && { name: '牵制', description: '伤害乘以敌方防御与我方防御之比；我方防御为0时按9999.99倍' },
    a.rending && { name: '裂伤', description: '伤害×1.5' },
    a.weakening !== undefined && { name: '蚀体', description: `我方攻防效力-${a.weakening}%` },
    a.reversal && { name: '逆脉', description: '我方攻防倒置' },
    a.walletSuppressionUnit && { name: '贪财', description: `每${formatAmount(a.walletSuppressionUnit)}灵石减伤1%` },
    a.rampingDamage && { name: a.rampingDamageStep === 2 ? '催势' : '蓄势', description: `首轮伤害系数1，每轮增加${a.rampingDamageStep ?? 1}` },
    a.mirrorOpening && { name: '照形', description: '前三轮普攻后追加我方攻击的一击' },
    a.arrayStrikes && { name: '列阵', description: '第2/4/6轮追加攻击×2/3/4的一击' },
    a.currentHpAttackDivisor && { name: '照血', description: `攻击加计我方当前气血/${a.currentHpAttackDivisor}` },
    a.entryStatRatio && { name: '窃灵', description: `入场加上我方攻防敏各${percent(Number(a.entryStatRatio))}` },
    a.entryHealthRatio && { name: '借命', description: `入场气血加我方攻防和的${percent(Number(a.entryHealthRatio))}` },
    a.entryAgilityAttackRatio && { name: '借势', description: `入场一次加上我方敏捷的${percent(Number(a.entryAgilityAttackRatio))}作为攻击，战中不重新计算` },
    a.hitHealingRatio && { name: '回春', description: `每段命中后回复气血上限的${percent(Number(a.hitHealingRatio))}，可超过上限；落空不恢复` },
    a.reflectionRatio && { name: '反震', description: `我方命中后承受最终伤害${percent(Number(a.reflectionRatio))}的反震，包含溢出伤害；不扣防、不再次反弹` },
    a.bullying && { name: '凌弱', description: '我方防御低于敌方防御时，再扣除双方防御差；扣防项可为负' },
    a.agilityDeficit && { name: '逐隙', description: `我方敏捷每低于${a.agilityDeficit.threshold}一点，追加攻击${a.agilityDeficit.scale}` },
    a.extraStrike && { name: '重袭', description: `普攻后追加攻击×${a.extraStrike.coefficient}、伤害×${a.extraStrike.damageMultiplier}` },
    a.periodicStrike && { name: '鼓腹蓄劲', description: `每${a.periodicStrike.every}次行动攻击×${a.periodicStrike.coefficient}，落空计数` },
    a.attackCoefficientMultiplier && { name: '凶力', description: `攻击效力×${a.attackCoefficientMultiplier}` },
    a.defensiveFlash && { name: '护罡', description: '我方攻击不高于敌攻击时，按双方防御之比降低普攻伤害' },
    a.softBones && { name: '柔骨', description: '我方攻击×0.9，敌方出手减去我方攻击10%' },
    a.noToughnessXp && { name: '不增长承伤熟练' },
    a.missPunishment !== undefined && { name: '截隙', description: `我方落空损失${a.missPunishment}气血` },
    a.attackAfterDamageThreshold !== undefined && { name: '潮压', description: `我方每段对其攻击后，承受max(${a.attackAfterDamageThreshold}－自身敏捷,0)直伤；落空及末击也触发` },
    a.healthBurst && { name: '囊爆', description: `第${a.healthBurst.round}轮普攻后，以当时剩余气血×${a.healthBurst.multiplier}造成直伤，自身降至1血；每次遭遇一次` },
    a.entryStrikes > 0 && { name: `起手${a.entryStrikes}击`, description: `攻击×${a.entryAttackCoefficient ?? 1} · 伤害×${a.entryDamageMultiplier ?? 1}` },
    a.entrySequence && { name: '折风先袭', description: a.entrySequence.map(batch =>
      `${batch.count}击：攻击×${batch.coefficient}、伤害×${batch.damageMultiplier}`).join('，随后') },
    Array.isArray(a.strikes) ? { name: '轻重连击', description: a.strikes.join(' / ') } : a.strikes > 1 && { name: `${a.strikes}连击` },
  ].filter((entry): entry is EnemyAbility => Boolean(entry));
}

export function enemyAbilities(a: ResolvedEnemy['abilities']) {
  return enemyAbilityDetails(a).map(entry => entry.description ? `${entry.name} · ${entry.description}` : entry.name);
}
