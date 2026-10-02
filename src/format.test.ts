import { describe, expect, it } from 'vitest';
import { batchLimit, duration, formatAmount, formatDecimal, formatNumericText, hasEnough, multiply, percent, progress } from './format';

describe('amount presentation', () => {
  it('formats common amounts without discarding fractional growth', () => {
    expect(formatAmount('1234')).toBe('1,234');
    expect(formatAmount('13.975')).toBe('13.97');
    expect(formatAmount('10000')).toBe('1万');
    expect(formatAmount('12345678')).toBe('1234.56万');
    expect(formatAmount('100000000')).toBe('1亿');
    expect(formatAmount('100000000000000000000000000000000000000')).toBe('1.00e+38');
  });

  it('bounds fractional display without abbreviating expanded integers or hiding tiny gains', () => {
    expect(formatDecimal('1.103333333333333333333333333333333333')).toBe('1.1');
    expect(formatDecimal('9007199254740993.129999999999999999999')).toBe('9,007,199,254,740,993.12');
    expect(formatDecimal('-12.34567890123456789')).toBe('-12.34');
    expect(formatAmount('0.00000000000012')).toBe('1.2e-13');
    expect(formatDecimal('-0.00000012')).toBe('-1.2e-7');
  });

  it('shortens decimal values in generated text without rewriting identifiers or integer counts', () => {
    expect(formatNumericText('气血回复+1.666666666666666666/秒，伤害×1.10333333333333，持续9.000000秒'))
      .toBe('气血回复+1.66/秒，伤害×1.1，持续9秒');
    expect(formatNumericText('修为+0.00000000000012，损失-12.3456789，获得9007199254740993份'))
      .toBe('修为+1.2e-13，损失-12.34，获得9007199254740993份');
    const identifiers = '地址127.0.0.1，版本neko-character-9，编号item1.234567';
    expect(formatNumericText(identifiers)).toBe(identifiers);
  });

  it('compares balances above Number.MAX_SAFE_INTEGER exactly', () => {
    const price = '9007199254740993';
    expect(hasEnough('9007199254740992', price)).toBe(false);
    expect(hasEnough(price, price)).toBe(true);
    expect(multiply(price, 3)).toBe('27021597764222979');
    expect(hasEnough('27021597764222978', price, 3)).toBe(false);
  });

  it('only approximates clamped progress and bounded batch counts', () => {
    expect(progress('0', '0')).toBe(0);
    expect(progress('999999999999999999999999', '999999999999999999999999')).toBe(100);
    expect(progress('12', '10')).toBe(100);
    expect(progress('-2', '10')).toBe(0);
    expect(progress('25', '100')).toBe(25);
    expect(batchLimit('999999999999999999999', '3', 1000)).toBe(1000);
    expect(batchLimit('11', '3')).toBe(3);
    expect(batchLimit('0', '3')).toBe(0);
    expect(batchLimit('30', '0', 1000)).toBe(1000);
  });

  it('keeps long durations readable and malformed values nonfatal', () => {
    expect(duration('3661')).toBe('1时 1分');
    expect(duration('90061')).toBe('1天 1时');
    expect(duration('9')).toBe('9秒');
    expect(formatAmount('not a number')).toBe('0');
    expect(progress('NaN', '0')).toBe(0);
    expect(percent(0.755)).toBe('75.5%');
  });
});
