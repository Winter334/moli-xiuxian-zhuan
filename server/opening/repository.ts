import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import type { CharacterState } from '../../core/prototype';
import type { OpeningCommand, OpeningResponse } from '../../shared/opening-contracts';
import { inTransaction } from '../database';
import { ApiError, type ErrorResponse } from '../errors';

export interface Snapshot { state: unknown; revision: string }
export interface StoredResponse { statusCode: number; body: OpeningResponse | ErrorResponse }
export interface Receipt extends StoredResponse {
  requestId: string;
  payloadHash: string;
  command: OpeningCommand;
}
export interface OpeningStore {
  createSession(state: CharacterState): Promise<{ token: string; characterId: string }>;
  load(characterId: string): Promise<Snapshot>;
  findReceipt(characterId: string, requestId: string, payloadHash: string): Promise<StoredResponse | null>;
  commit(characterId: string, revision: string, state: CharacterState, receipt?: Receipt):
    Promise<{ committed: boolean; replay?: StoredResponse }>;
}

export async function initializeStorage(pool: Pool): Promise<void> {
  const sql = await readFile(new URL('./001_initial.sql', import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  await inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(17483217, 3)');
    await client.query('CREATE SCHEMA IF NOT EXISTS moli_opening');
    await client.query(`CREATE TABLE IF NOT EXISTS moli_opening.schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL
    )`);
    const applied = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM moli_opening.schema_migrations',
    );
    if (applied.rows.length) {
      if (applied.rows.length !== 1 || applied.rows[0].name !== '001_initial.sql' || applied.rows[0].checksum !== checksum) {
        throw new Error('Opening storage version mismatch; existing data was not modified.');
      }
      return;
    }
    await client.query(sql);
    await client.query('INSERT INTO moli_opening.schema_migrations VALUES ($1, $2)', ['001_initial.sql', checksum]);
  });
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class OpeningRepository implements OpeningStore {
  constructor(readonly pool: Pool) {}

  async findSession(token: string): Promise<string | null> {
    const result = await this.pool.query<{ character_id: string }>(
      'SELECT character_id FROM moli_opening.dev_sessions WHERE token_hash = $1', [hashToken(token)],
    );
    return result.rows[0]?.character_id ?? null;
  }

  async createSession(state: CharacterState) {
    const token = randomUUID();
    const characterId = randomUUID();
    await inTransaction(this.pool, async (client) => {
      await client.query('INSERT INTO moli_opening.characters (id, state) VALUES ($1, $2::jsonb)',
        [characterId, JSON.stringify(state)]);
      await client.query('INSERT INTO moli_opening.dev_sessions (token_hash, character_id) VALUES ($1, $2)',
        [hashToken(token), characterId]);
    });
    return { token, characterId };
  }

  async load(characterId: string): Promise<Snapshot> {
    const result = await this.pool.query<Snapshot>(
      'SELECT state, revision::text FROM moli_opening.characters WHERE id = $1', [characterId],
    );
    if (!result.rows[0]) throw new ApiError(401, 'UNAUTHENTICATED', '角色身份已失效，请重新连接。');
    return result.rows[0];
  }

  async findReceipt(
    characterId: string, requestId: string, payloadHash: string,
    client: Pick<Pool, 'query'> | Pick<PoolClient, 'query'> = this.pool,
  ): Promise<StoredResponse | null> {
    const result = await client.query<{ payload_hash: string; status_code: number; response: StoredResponse['body'] }>(
      `SELECT payload_hash, status_code, response FROM moli_opening.command_requests
       WHERE character_id = $1 AND request_id = $2`, [characterId, requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.payload_hash !== payloadHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '此请求编号已用于其他操作。');
    return { statusCode: row.status_code, body: row.response };
  }

  async commit(characterId: string, revision: string, state: CharacterState, receipt?: Receipt) {
    return inTransaction(this.pool, async (client) => {
      // Simulation runs before this short lock; state and receipt commit together.
      const locked = await client.query<{ revision: string }>(
        'SELECT revision::text FROM moli_opening.characters WHERE id = $1 FOR UPDATE', [characterId],
      );
      if (receipt) {
        const replay = await this.findReceipt(characterId, receipt.requestId, receipt.payloadHash, client);
        if (replay) return { committed: false, replay };
      }
      if (locked.rows[0]?.revision !== revision) return { committed: false };
      const updated = await client.query(
        `UPDATE moli_opening.characters SET state = $1::jsonb, revision = revision + 1, updated_at = now()
         WHERE id = $2 AND revision = $3::bigint`, [JSON.stringify(state), characterId, revision],
      );
      if (updated.rowCount !== 1) return { committed: false };
      if (receipt) {
        await client.query(
          `INSERT INTO moli_opening.command_requests
           (character_id, request_id, payload_hash, payload, status_code, response) VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)`,
          [characterId, receipt.requestId, receipt.payloadHash, JSON.stringify(receipt.command),
            receipt.statusCode, JSON.stringify(receipt.body)],
        );
      }
      return { committed: true };
    });
  }
}
