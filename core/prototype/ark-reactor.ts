import { z } from 'zod';
import type { StatSource } from './types';

export const REACTOR_MATERIALS = {
  'chengzhao-core': 'ordinaryFuel',
  'high-ark-core': 'highFuel',
  'thunder-spirit-symbol': 'symbols',
  'charged-gel': 'gel',
} as const;
export const reactorMaterialSchema = z.enum(['chengzhao-core', 'high-ark-core', 'thunder-spirit-symbol', 'charged-gel']);
export const reactorSchema = z.object({
  active: z.boolean(),
  remainderMs: z.number().int().min(0).max(29),
  ordinaryFuel: z.number().finite().nonnegative(),
  highFuel: z.number().finite().nonnegative(),
  symbols: z.number().finite().nonnegative(),
  gel: z.number().finite().min(1),
  temperature: z.number().finite().min(20).max(10000),
  power: z.number().finite().nonnegative(),
  radiation: z.number().finite().nonnegative(),
}).strict();
export type ArkReactor = z.infer<typeof reactorSchema>;
export const initialReactor = (): ArkReactor => ({
  active: false, remainderMs: 0, ordinaryFuel: 0, highFuel: 0, symbols: 0,
  gel: 1, temperature: 20, power: 0, radiation: 0,
});
export const reactorQuality = (reactor: ArkReactor) => Math.round(100 + 15 * Math.log1p(reactor.radiation));

// Source order and its .333 cooling exponent are intentional; every step is exactly 30 ms.
export function reactorStep(reactor: ArkReactor): number | null {
  const oldPower = reactor.power;
  reactor.radiation += oldPower * .03;
  reactor.power = 0;
  if (reactor.highFuel > .0001) {
    const contribution = Math.log10(reactor.highFuel + 1) * .4 * oldPower;
    reactor.power += contribution;
    reactor.highFuel = Math.max(0, reactor.highFuel - contribution * .03 / 8000);
  }
  if (reactor.ordinaryFuel > .0001) {
    const contribution = Math.sqrt(reactor.ordinaryFuel * oldPower) * .4;
    reactor.power += contribution;
    reactor.ordinaryFuel = Math.max(0, reactor.ordinaryFuel - contribution * .03 / 20);
  }
  if (reactor.symbols > .0001) {
    reactor.power += .001 * reactor.symbols;
    reactor.symbols *= 1 - .001 * .03;
  }
  reactor.temperature += reactor.power * 100 * .03 / reactor.gel;
  reactor.temperature = (reactor.temperature - 20) * (1 - .03 / (100 * reactor.gel) ** .333) + 20;
  if (reactor.temperature <= 10000) return null;
  const durationMs = Math.round(100 * reactor.gel ** .333) * 1000;
  Object.assign(reactor, initialReactor());
  return durationMs;
}

export const REACTOR_SCORCH_SOURCE: StatSource = {
  id: 'reactor-scorch', tags: ['supply', 'cost'],
  flat: { hpRegenPercent: '-0.08' }, multiplier: { maxHp: '0.5' },
};
