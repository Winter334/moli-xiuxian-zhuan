import type { Pool } from 'pg';
import { CHAT_PAGE_SIZE, CHAT_RETENTION_MS, type ChatMessage } from '../../shared/social';
import { inTransaction } from '../database';
import { ApiError } from '../errors';

export interface SocialStore {
  history(before?: string, after?: string): Promise<{ messages: ChatMessage[]; hasMore: boolean }>;
  post(player: Pick<ChatMessage, 'playerId' | 'name' | 'avatarUrl'>, requestId: string, text: string):
    Promise<{ id: string; deleted: boolean; message: ChatMessage | null; fresh: boolean }>;
  deleteMessage(id: string): Promise<void>;
  mute(playerId: string, until: number): Promise<void>;
  prune(): Promise<void>;
}
interface MessageRow {
  id: string; playerId: string; name: string; avatarUrl: string | null; text: string | null;
  createdAt: number; deleted: boolean;
}
const columns = `id::text, sender_key AS "playerId", display_name AS name, avatar_url AS "avatarUrl",
  body AS text, created_at::float8 AS "createdAt", (deleted_at IS NOT NULL) AS deleted`;
const publicMessage = (row: MessageRow): ChatMessage => ({
  id: row.id, playerId: row.playerId, name: row.name, avatarUrl: row.avatarUrl,
  text: row.text!, createdAt: row.createdAt,
});
export class SocialRepository implements SocialStore {
  constructor(private readonly pool: Pool, private readonly applicationId: string, private readonly now = Date.now) {}

  async history(before?: string, after?: string) {
    const values: unknown[] = [this.applicationId, this.now() - CHAT_RETENTION_MS, CHAT_PAGE_SIZE + 1];
    const cursor = before ?? after;
    if (cursor) values.push(cursor);
    const result = await this.pool.query<MessageRow>(
      `SELECT ${columns} FROM moli_client.world_messages
       WHERE application_id = $1 AND created_at >= $2 AND deleted_at IS NULL
       ${cursor ? `AND id ${before ? '<' : '>'} $4::bigint` : ''}
       ORDER BY id ${after ? 'ASC' : 'DESC'} LIMIT $3`, values,
    );
    const rows = result.rows.slice(0, CHAT_PAGE_SIZE);
    return { messages: (after ? rows : rows.reverse()).map(publicMessage), hasMore: result.rows.length > CHAT_PAGE_SIZE };
  }
  async post(player: Pick<ChatMessage, 'playerId' | 'name' | 'avatarUrl'>, requestId: string, text: string) {
    return inTransaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`chat:${this.applicationId}:${player.playerId}`]);
      const existing = await client.query<MessageRow>(
        `SELECT ${columns} FROM moli_client.world_messages
         WHERE application_id = $1 AND sender_key = $2 AND request_id = $3`, [this.applicationId, player.playerId, requestId]);
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (!row.deleted && row.text !== text) throw new ApiError(409, 'REQUEST_REUSED', '消息编号已用于另一条内容。');
        return { id: row.id, deleted: row.deleted, message: row.deleted ? null : publicMessage(row), fresh: false };
      }
      const now = this.now();
      const muted = await client.query('SELECT 1 FROM moli_client.world_mutes WHERE application_id = $1 AND player_key = $2 AND until_at > $3',
        [this.applicationId, player.playerId, now]);
      if (muted.rowCount) throw new ApiError(403, 'CHAT_MUTED', '当前处于禁言期间。');
      const recent = await client.query(
        `SELECT 1 FROM moli_client.world_messages WHERE application_id = $1 AND sender_key = $2
         AND created_at > $3`, [this.applicationId, player.playerId, now - 2000]);
      if (recent.rowCount) throw new ApiError(429, 'CHAT_RATE_LIMIT', '发送过于频繁，请稍后再试。');
      const burst = await client.query<{ count: string }>(
        'SELECT count(*)::text FROM moli_client.world_messages WHERE application_id = $1 AND sender_key = $2 AND created_at > $3',
        [this.applicationId, player.playerId, now - 60_000]);
      if (Number(burst.rows[0].count) >= 15) throw new ApiError(429, 'CHAT_RATE_LIMIT', '本分钟发送较多，请稍后再试。');
      const result = await client.query<MessageRow>(
        `INSERT INTO moli_client.world_messages (application_id, sender_key, request_id, display_name, avatar_url, body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${columns}`,
        [this.applicationId, player.playerId, requestId, player.name, player.avatarUrl, text, now]);
      const message = publicMessage(result.rows[0]);
      return { id: message.id, deleted: false, message, fresh: true };
    });
  }
  async deleteMessage(id: string) {
    await this.pool.query(`UPDATE moli_client.world_messages SET body = NULL, deleted_at = $3
      WHERE application_id = $1 AND id = $2::bigint AND deleted_at IS NULL`, [this.applicationId, id, this.now()]);
  }
  async mute(playerId: string, until: number) {
    await this.pool.query(`INSERT INTO moli_client.world_mutes VALUES ($1, $2, $3)
      ON CONFLICT (application_id, player_key) DO UPDATE SET until_at = EXCLUDED.until_at`,
    [this.applicationId, playerId, until]);
  }
  async prune() {
    await this.pool.query('DELETE FROM moli_client.world_messages WHERE application_id = $1 AND created_at < $2',
      [this.applicationId, this.now() - CHAT_RETENTION_MS]);
    await this.pool.query('DELETE FROM moli_client.world_mutes WHERE application_id = $1 AND until_at <= $2',
      [this.applicationId, this.now()]);
  }
}
