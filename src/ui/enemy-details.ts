import type { ResolvedEnemy } from '../../core/prototype/types';
import { formatAmount, percent } from '../format';

export function enemyAbilities(a: ResolvedEnemy['abilities']) {
  return [
    a.ignoreDefense && '无视防御 · 攻击时不扣除我方防御',
    a.sturdy && '坚固 · 扣防后的普攻中间伤害至多1，随后计算波动、暴击与倍率；特定器物可提高此上限',
    a.restraint && '牵制 · 伤害乘以敌方防御与我方防御之比；我方防御为0时按9999.99倍',
    a.rending && '裂伤 · 伤害×1.5',
    a.weakening !== undefined && `蚀体 · 我方攻防效力-${a.weakening}%`,
    a.reversal && '逆脉 · 我方攻防倒置', a.walletSuppressionUnit && `贪财 · 每${formatAmount(a.walletSuppressionUnit)}灵石减伤1%`,
    a.rampingDamage && `${a.rampingDamageStep === 2 ? '催势' : '蓄势'} · 首轮伤害系数1，每轮增加${a.rampingDamageStep ?? 1}`,
    a.mirrorOpening && '照形 · 前三轮普攻后追加我方攻击的一击', a.arrayStrikes && '列阵 · 第2/4/6轮追加攻击×2/3/4的一击',
    a.currentHpAttackDivisor && `照血 · 攻击加计我方当前气血/${a.currentHpAttackDivisor}`,
    a.entryStatRatio && `窃灵 · 入场加上我方攻防敏各${percent(Number(a.entryStatRatio))}`,
    a.entryHealthRatio && `借命 · 入场气血加我方攻防和的${percent(Number(a.entryHealthRatio))}`,
    a.agilityDeficit && `逐隙 · 我方敏捷每低于${a.agilityDeficit.threshold}一点，追加攻击${a.agilityDeficit.scale}`,
    a.extraStrike && `重袭 · 普攻后追加攻击×${a.extraStrike.coefficient}、伤害×${a.extraStrike.damageMultiplier}`,
    a.periodicStrike && `鼓腹蓄劲 · 每${a.periodicStrike.every}次行动攻击×${a.periodicStrike.coefficient}，落空计数`,
    a.attackCoefficientMultiplier && `凶力 · 攻击效力×${a.attackCoefficientMultiplier}`,
    a.defensiveFlash && '护罡 · 我方攻击不高于敌攻击时，按双方防御之比降低普攻伤害',
    a.softBones && '柔骨 · 我方攻击×0.9，敌方出手减去我方攻击10%',
    a.noToughnessXp && '不增长承伤熟练', a.missPunishment !== undefined && `截隙 · 我方落空损失${a.missPunishment}气血`,
    a.entryStrikes > 0 && `起手${a.entryStrikes}击 · 攻击×${a.entryAttackCoefficient ?? 1} · 伤害×${a.entryDamageMultiplier ?? 1}`,
    Array.isArray(a.strikes) ? `轻重连击 · ${a.strikes.join(' / ')}` : a.strikes > 1 && `${a.strikes}连击`,
  ].filter((line): line is string => typeof line === 'string');
}
