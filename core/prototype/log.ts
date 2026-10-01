import { dec } from '../numbers';

export const RECENT_LOG_LIMIT = 200;

export function describeLogGain(label: string, value: string) {
  const amount = dec(value);
  const shown = amount.toSignificantDigits(6);
  return `${label}${shown.eq(amount) ? '+' : '约+'}${shown.toString()}`;
}

export function describeRealmFactor(value: string) {
  const factor = dec(value);
  if (factor.eq(1)) return '无境界差修正';
  const shown = factor.toSignificantDigits(4);
  return `${factor.gt(1) ? '越级增益' : '低阶减益'}${shown.eq(factor) ? '' : '约'}×${shown.toString()}`;
}
