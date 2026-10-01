import { z } from 'zod';
import { COMBAT_POWER_VERSION } from '../core/prototype/combat-power';
import { nonnegativeSchema } from '../core/prototype/types';

export const RANKING_LIMIT = 50;
export const rankingIdSchema = z.enum(['cultivation', 'power', 'refining', 'money']);
export type RankingId = z.infer<typeof rankingIdSchema>;
export const RANKING_NAMES: Record<RankingId, string> = {
  cultivation: '修为榜', power: '战力榜', refining: '炼制榜', money: '灵石榜',
};
const levelSchema = z.number().int().nonnegative();
const metricSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cultivation'), level: levelSchema, xp: nonnegativeSchema }).strict(),
  z.object({ kind: z.literal('power'), score: nonnegativeSchema }).strict(),
  z.object({ kind: z.literal('refining'), level: levelSchema, xp: nonnegativeSchema }).strict(),
  z.object({ kind: z.literal('money'), amount: nonnegativeSchema }).strict(),
]);
export type RankingMetric = z.infer<typeof metricSchema>;
const entrySchema = z.object({
  rank: z.number().int().positive(),
  name: z.string().min(1).max(80),
  realmName: z.string().min(1).max(40),
  metric: metricSchema,
  updatedAt: z.number().int().nonnegative(),
  isSelf: z.boolean(),
}).strict();
export type RankingEntry = z.infer<typeof entrySchema>;
export const rankingBoardSchema = z.object({
  board: rankingIdSchema,
  scope: z.literal('development'),
  powerVersion: z.literal(COMBAT_POWER_VERSION),
  entries: z.array(entrySchema).max(RANKING_LIMIT),
  self: entrySchema.nullable(),
}).strict().refine(board => [...board.entries, ...(board.self ? [board.self] : [])]
  .every(entry => entry.metric.kind === board.board), 'Ranking metric does not match board');
export type RankingBoard = z.infer<typeof rankingBoardSchema>;
