import { z } from 'zod';
import { dec, random, text } from '../numbers';
import { nonnegativeSchema } from './types';

export const JOURNEY_LENGTH = '3200000';
export const FISH = [
  { id: 'blue-scaled-carp', strength: 40 },
  { id: 'green-veined-fish', strength: 100 },
  { id: 'cold-crystal-fish', strength: 180 },
] as const;
export const fishingSchema = z.object({
  phase: z.enum(['waiting', 'tackle']),
  held: z.boolean(),
  elapsedMs: z.number().int().nonnegative(),
  periodMs: z.number().int().min(3000).max(15000),
  remainderMs: z.number().int().min(0).max(29),
  fish: z.object({
    index: z.number().int().min(0).max(2),
    position: z.number().finite(), velocity: z.number().finite(),
    rodPosition: z.number().min(0).max(318), rodVelocity: z.number().finite(),
    rodLength: z.number().int().min(40).max(240),
    progress: z.number().positive().lt(100),
    movingRemaining: z.number().int().positive().max(75),
  }).strict().nullable(),
}).strict().superRefine((activity, ctx) => {
  if ((activity.phase === 'tackle') !== Boolean(activity.fish) ||
      activity.elapsedMs >= activity.periodMs || (activity.phase === 'tackle' && activity.elapsedMs !== 0)) {
    ctx.addIssue({ code: 'custom', message: 'Invalid fishing checkpoint' });
  }
});
export type FishingState = z.infer<typeof fishingSchema>;
export const journeySchema = z.object({
  progress: nonnegativeSchema.refine(value => dec(value).lte(JOURNEY_LENGTH)),
}).strict();

export function journeySpeed(agility: string, footwork: number): string {
  return text(dec(agility).sqrt().div(10).mul(dec('1.1').pow(footwork)).mul(36));
}
export function fishingPeriod(level: number): number {
  return Math.floor(15 * Math.pow(3 / 15, Math.min(level, 20) / 20)) * 1000;
}
export function waitingFishing(level: number): FishingState {
  return { phase: 'waiting', held: false, elapsedMs: 0, periodMs: fishingPeriod(level), remainderMs: 0, fish: null };
}

// Fixed 30 ms source steps. Pausing moves only the simulation clock, never this remainder.
export function advanceFishing(activity: FishingState, elapsedMs: number, rng: { rng: number }, hooks: {
  level: () => number; experience: (amount: number) => void; caught: (itemId: string) => void;
}) {
  let remaining = elapsedMs;
  while (remaining > 0) {
    if (activity.phase === 'waiting') {
      const step = Math.min(remaining, activity.periodMs - activity.elapsedMs);
      activity.elapsedMs += step;
      remaining -= step;
      if (activity.elapsedMs < activity.periodMs) break;
      hooks.experience(1);
      const roll = hooks.level() * .2 * random(rng);
      const index = roll > 1.8 ? 2 : roll > .5 ? 1 : 0;
      activity.phase = 'tackle';
      activity.elapsedMs = 0;
      activity.remainderMs = 0;
      activity.fish = { index, position: 40, velocity: 0, rodPosition: 30, rodVelocity: 0,
        rodLength: 40 + hooks.level() * 4, progress: 25, movingRemaining: 1 };
    } else {
      const step = Math.min(remaining, 30 - activity.remainderMs);
      activity.remainderMs += step;
      remaining -= step;
      if (activity.remainderMs < 30) break;
      activity.remainderMs = 0;
      const fish = activity.fish!;
      const strength = FISH[fish.index].strength;
      fish.progress += fish.position + 12 < fish.rodPosition + fish.rodLength &&
        fish.rodPosition < fish.position + 12 ? .4 : -.3;
      if (--fish.movingRemaining <= 0) {
        fish.movingRemaining = Math.round(3000 / strength);
        fish.velocity += (random(rng) * 2 - .9) * strength;
      }
      fish.position += fish.velocity * .03;
      fish.velocity -= 3 * .03;
      if ((fish.position <= 0 && fish.velocity < 0) || (fish.position >= 290 && fish.velocity > 0)) fish.velocity *= -.7;
      fish.velocity *= .99;
      fish.rodVelocity += (activity.held ? 250 : -120) * .03;
      fish.rodPosition += fish.rodVelocity * .03;
      fish.rodVelocity *= .99;
      if (fish.rodPosition + fish.rodLength >= 318 && fish.rodVelocity > 0) {
        fish.rodVelocity *= -.4;
        fish.rodPosition = 318 - fish.rodLength;
      }
      if (fish.rodPosition <= 0 && fish.rodVelocity < 0) {
        fish.rodVelocity *= -.8;
        fish.rodPosition = 0;
      }
      if (fish.progress >= 100 || fish.progress <= 0) {
        if (fish.progress >= 100) {
          hooks.experience(strength / 20);
          hooks.caught(FISH[fish.index].id);
        }
        const held = activity.held;
        Object.assign(activity, waitingFishing(hooks.level()), { held });
      }
    }
  }
}
