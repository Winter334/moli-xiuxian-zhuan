import Decimal from 'decimal.js';
import { RuleError } from './errors';

// A private constructor prevents callers changing the rule core's arithmetic.
export const D = Decimal.clone({ precision: 120, rounding: Decimal.ROUND_HALF_UP });
export const dec = (value: Decimal.Value) => new D(value);
export const text = (value: Decimal.Value) => dec(value).toFixed();
export const add = (left: string, right: Decimal.Value) => text(dec(left).plus(right));
export const sub = (left: string, right: Decimal.Value) => text(dec(left).minus(right));
export const integerAdd = (left: string, right: string | number | bigint) =>
  (BigInt(left) + BigInt(right)).toString();
// Fixed-point totals may exceed Decimal's calculation precision while adding small awards.
export function exactAdd(left: string, right: string): string {
  const parse = (value: string) => {
    const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
    if (!match) throw new Error('Expected a fixed decimal');
    return { sign: match[1] ? -1n : 1n, whole: match[2], fraction: match[3] ?? '' };
  };
  const a = parse(left), b = parse(right);
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const scaled = (value: ReturnType<typeof parse>) =>
    value.sign * BigInt(value.whole + value.fraction.padEnd(scale, '0'));
  const sum = scaled(a) + scaled(b);
  const digits = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  return `${sum < 0n ? '-' : ''}${scale ? digits.slice(0, -scale) : digits}${fraction ? `.${fraction}` : ''}`;
}
export const minimum = (left: Decimal.Value, right: Decimal.Value) => D.min(left, right).toFixed();
export const maximum = (left: Decimal.Value, right: Decimal.Value) => D.max(left, right).toFixed();

export function floorTime(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 3_600_000) {
    throw new Error('时间必须在非负安全毫秒范围内，并为行动期限保留一小时安全空间');
  }
  return Math.floor(value / 1000) * 1000;
}

export function quantity(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new RuleError('单次批量数量须为 1 至 10000 的整数');
  }
  return value;
}

export function random(state: { rng: number }): number {
  let value = state.rng | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rng = value >>> 0;
  return state.rng / 4294967296;
}
