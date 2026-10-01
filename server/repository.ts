import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { createGame } from '../core/index';
import type { GameCommand, GameResponse } from '../shared/contracts';
import { inTransaction } from './database';
import { ApiError, type ErrorResponse } from './errors';

export type GameState = ReturnType<typeof createGame>;

export interface Snapshot {
  state: GameState;
  revision: string;
}

export interface StoredResponse {
  statusCode: number;
  body: GameResponse | ErrorResponse;
}

export interface CommandReceipt extends StoredResponse {
  requestId: string;
  payloadHash: string;
  command: GameCommand;
}

type QueryClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function assertAmount(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length > 10_000 || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('Invalid integer asset in game state.');
  }
}

function splitState(state: GameState) {
  const { stones, inventory, equipment, ...character } = state;
  assertAmount(stones);
  for (const quantity of Object.values(inventory)) assertAmount(quantity);
  return { stones, inventory, equipment, character };
}

async function writeAssets(client: PoolClient, characterId: string, state: GameState): Promise<void> {
  const { inventory, equipment } = splitState(state);
  await client.query('DELETE FROM inventory WHERE character_id = $1 AND NOT (item_id = ANY($2::text[]))', [
    characterId,
    Object.keys(inventory),
  ]);
  await client.query(
    `INSERT INTO inventory (character_id, item_id, quantity)
     SELECT $1, item_id, quantity::numeric
     FROM jsonb_to_recordset($2::jsonb) AS items(item_id text, quantity text)
     ON CONFLICT (character_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity
     WHERE inventory.quantity IS DISTINCT FROM EXCLUDED.quantity`,
    [characterId, JSON.stringify(Object.entries(inventory).map(([item_id, quantity]) => ({ item_id, quantity })))],
  );
  await client.query(
    'DELETE FROM equipment_instances WHERE character_id = $1 AND NOT (instance_id = ANY($2::text[]))',
    [characterId, equipment.map((item) => item.instanceId)],
  );
  await client.query(
    `INSERT INTO equipment_instances (character_id, instance_id, definition_id, position, instance)
     SELECT $1, instance_id, definition_id, position, instance
     FROM jsonb_to_recordset($2::jsonb)
       AS items(instance_id text, definition_id text, position integer, instance jsonb)
     ON CONFLICT (character_id, instance_id) DO UPDATE
       SET definition_id = EXCLUDED.definition_id, position = EXCLUDED.position, instance = EXCLUDED.instance
     WHERE (equipment_instances.definition_id, equipment_instances.position, equipment_instances.instance)
       IS DISTINCT FROM (EXCLUDED.definition_id, EXCLUDED.position, EXCLUDED.instance)`,
    [
      characterId,
      JSON.stringify(equipment.map(({ instanceId, definitionId, ...instance }, position) => ({
        instance_id: instanceId,
        definition_id: definitionId,
        position,
        instance,
      }))),
    ],
  );
}

export class GameRepository {
  constructor(readonly pool: Pool) {}

  async findSession(token: string): Promise<string | null> {
    const result = await this.pool.query<{ character_id: string }>(
      'SELECT character_id FROM dev_sessions WHERE token_hash = $1',
      [sessionHash(token)],
    );
    return result.rows[0]?.character_id ?? null;
  }

  async createSession(state: GameState): Promise<{ token: string; characterId: string }> {
    const token = randomUUID();
    const characterId = randomUUID();
    const { stones, character } = splitState(state);
    await inTransaction(this.pool, async (client) => {
      await client.query('INSERT INTO characters (id, state, stones) VALUES ($1, $2::jsonb, $3::numeric)', [
        characterId, JSON.stringify(character), stones,
      ]);
      await writeAssets(client, characterId, state);
      await client.query('INSERT INTO dev_sessions (token_hash, character_id) VALUES ($1, $2)', [
        sessionHash(token), characterId,
      ]);
    });
    return { token, characterId };
  }

  async load(characterId: string): Promise<Snapshot> {
    // One statement uses one MVCC snapshot for the character and every asset row.
    const result = await this.pool.query<{
      state: Record<string, unknown>;
      stones: string;
      revision: string;
      inventory: GameState['inventory'];
      equipment: GameState['equipment'];
    }>(
      `SELECT c.state, c.stones::text, c.revision::text,
         COALESCE((SELECT jsonb_object_agg(item_id, quantity::text)
           FROM inventory WHERE character_id = c.id), '{}'::jsonb) AS inventory,
         COALESCE((SELECT jsonb_agg(instance || jsonb_build_object(
           'instanceId', instance_id, 'definitionId', definition_id) ORDER BY position)
           FROM equipment_instances WHERE character_id = c.id), '[]'::jsonb) AS equipment
       FROM characters c WHERE c.id = $1`,
      [characterId],
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid local development session is required.');
    return {
      state: { ...row.state, stones: row.stones, inventory: row.inventory, equipment: row.equipment } as GameState,
      revision: row.revision,
    };
  }

  async findReceipt(
    characterId: string,
    requestId: string,
    payloadHash: string,
    client: QueryClient = this.pool,
  ): Promise<StoredResponse | null> {
    const result = await client.query<{
      payload_hash: string;
      status_code: number;
      response: StoredResponse['body'];
    }>(
      'SELECT payload_hash, status_code, response FROM command_requests WHERE character_id = $1 AND request_id = $2',
      [characterId, requestId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.payload_hash !== payloadHash) {
      throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This requestId was already used for a different command.');
    }
    return { statusCode: row.status_code, body: row.response };
  }

  async commit(
    characterId: string,
    expectedRevision: string,
    state: GameState | null,
    receipt?: CommandReceipt,
  ): Promise<{ committed: boolean; replay?: StoredResponse }> {
    return inTransaction(this.pool, async (client) => {
      // The only lock covers this short commit, never simulation or view construction.
      const locked = await client.query<{ revision: string }>(
        'SELECT revision::text FROM characters WHERE id = $1 FOR UPDATE',
        [characterId],
      );
      if (receipt) {
        const replay = await this.findReceipt(characterId, receipt.requestId, receipt.payloadHash, client);
        if (replay) return { committed: false, replay };
      }
      if (locked.rows[0]?.revision !== expectedRevision) return { committed: false };
      if (state) {
        const { character, stones } = splitState(state);
        const updated = await client.query(
          `UPDATE characters SET state = $1::jsonb, stones = $2::numeric,
             revision = revision + 1, updated_at = now()
           WHERE id = $3 AND revision = $4::bigint`,
          [JSON.stringify(character), stones, characterId, expectedRevision],
        );
        if (updated.rowCount !== 1) return { committed: false };
        await writeAssets(client, characterId, state);
      }
      if (receipt) {
        await client.query(
          `INSERT INTO command_requests (character_id, request_id, payload_hash, payload, status_code, response)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb)`,
          [characterId, receipt.requestId, receipt.payloadHash, JSON.stringify(receipt.command),
            receipt.statusCode, JSON.stringify(receipt.body)],
        );
      }
      return { committed: true };
    });
  }
}
