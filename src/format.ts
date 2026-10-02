import Decimal from 'decimal.js';

const D = Decimal.clone({ precision: 120, rounding: Decimal.ROUND_DOWN });

export function decimal(value: string | number): Decimal {
  try {
    const result = new D(value);
    return result.isFinite() ? result : new D(0);
  } catch {
    return new D(0);
  }
}

export function formatDecimal(value: string | number): string {
  const amount = decimal(value);
  if (!amount.isZero() && amount.abs().lt('0.01')) {
    return amount.toExponential(2).replace(/\.?0+(?=e)/, '');
  }
  const [whole, fraction] = amount.toFixed(amount.isInteger() ? 0 : 2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = fraction?.replace(/0+$/, '');
  return tail ? `${grouped}.${tail}` : grouped;
}

export function formatAmount(value: string): string {
  const amount = decimal(value);
  const units = [
    ['1e20', '垓'], ['1e16', '京'], ['1e12', '兆'], ['1e8', '亿'], ['1e4', '万'],
  ] as const;
  if (amount.abs().gte('1e24')) return amount.toExponential(2);
  for (const [threshold, unit] of units) {
    if (amount.abs().gte(threshold)) {
      return `${amount.div(threshold).toFixed(2).replace(/\.?0+$/, '')}${unit}`;
    }
  }
  return formatDecimal(value);
}

export function formatNumericText(value: string): string {
  return value.replace(/(?<![\w.])\d+\.\d{3,}(?![\w.])/g, amount => formatDecimal(amount));
}

export function percent(value: number): string {
  return `${(Math.max(0, Number.isFinite(value) ? value : 0) * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export function progress(current: string, maximum: string): number {
  const max = decimal(maximum);
  if (max.lte(0)) return 0;
  return Math.max(0, Math.min(100, decimal(current).div(max).mul(100).toNumber()));
}

export function multiply(value: string, quantity: number): string {
  return decimal(value).mul(quantity).toFixed();
}

export function hasEnough(owned: string, cost: string, quantity = 1): boolean {
  return decimal(owned).gte(decimal(cost).mul(quantity));
}

export function batchLimit(owned: string, unitCost = '1', cap = 100): number {
  if (decimal(unitCost).lte(0)) return cap;
  const available = decimal(owned).div(unitCost).floor();
  return Math.max(0, Math.min(cap, available.toNumber()));
}

export function duration(seconds: string): string {
  const total = decimal(seconds).floor();
  if (total.gte(86400)) return `${formatAmount(total.div(86400).floor().toFixed())}天 ${total.mod(86400).div(3600).floor().toFixed()}时`;
  if (total.gte(3600)) return `${total.div(3600).floor().toFixed()}时 ${total.mod(3600).div(60).floor().toFixed()}分`;
  if (total.gte(60)) return `${total.div(60).floor().toFixed()}分 ${total.mod(60).toFixed()}秒`;
  return `${total.toFixed()}秒`;
}

export function timeLabel(at: number): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toLocaleTimeString('zh-CN', { hour12: false });
}
