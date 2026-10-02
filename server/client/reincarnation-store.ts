import type { Pool, PoolClient } from 'pg';
import type { ClientSave } from '../../shared/client-save';
import { reincarnationReceiptSchema, type ReincarnationReceipt } from '../../shared/reincarnation';
import { inTransaction } from '../database';
import { ApiError } from '../errors';
import type { CloudSnapshot } from './repository';
import { requireNoPvp } from './pvp-store';

export interface StoredReincarnationReceipt { hash: string; receipt: ReincarnationReceipt }
export interface ReincarnationTransaction {
  snapshot: CloudSnapshot;
  receipt(requestId: string): Promise<StoredReincarnationReceipt | null>;
  replaceLife(save: ClientSave, now: number): Promise<void>;
  record(hash: string, receipt: ReincarnationReceipt): Promise<void>;
}
export interface ReincarnationStore {
  transact<T>(characterId: string, work: (tx: ReincarnationTransaction) => Promise<T>): Promise<T>;
  receipt(characterId: string, requestId: string): Promise<StoredReincarnationReceipt | null>;
}

async function receipt(db: Pick<PoolClient, 'query'>, characterId: string, requestId: string): Promise<StoredReincarnationReceipt | null> {
  const result = await db.query<{ hash: string; receipt: unknown }>(
    `SELECT payload_hash AS hash, result AS receipt FROM moli_client.reincarnation_receipts
     WHERE character_id = $1 AND request_id = $2`, [characterId, requestId],
  );
  const row = result.rows[0];
  return row ? { hash: row.hash, receipt: reincarnationReceiptSchema.parse(row.receipt) } : null;
}

export class ReincarnationRepository implements ReincarnationStore {
  constructor(private readonly pool: Pool) {}
  receipt(characterId: string, requestId: string) { return receipt(this.pool, characterId, requestId); }

  async transact<T>(characterId: string, work: (tx: ReincarnationTransaction) => Promise<T>): Promise<T> {
    return inTransaction(this.pool, async db => {
      await db.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const rows = await db.query<CloudSnapshot>(
        `SELECT save, revision::text, received_at::float8 AS "receivedAt",
         last_request_id AS "lastRequestId", last_payload_hash AS "lastPayloadHash"
         FROM moli_client.characters WHERE id = $1 FOR NO KEY UPDATE`, [characterId],
      );
      const snapshot = rows.rows[0];
      if (!snapshot) throw new ApiError(401, 'UNAUTHENTICATED', '云存档身份已失效，本地进度保留。');
      return work({
        snapshot,
        receipt: id => receipt(db, characterId, id),
        replaceLife: async (save, now) => {
          await requireNoPvp(db, characterId);
          // Wait for in-flight buyers on these rows before reading/clearing seller deliveries.
          // The next READ COMMITTED statement then includes their committed proceeds.
          await db.query(
            `UPDATE moli_client.consignment_listings
             SET remaining = 0, status = 'cancelled', updated_at = GREATEST(updated_at, $2)
             WHERE seller_id = $1 AND status = 'active'`, [characterId, now],
          );
          await db.query(
            'UPDATE moli_client.consignment_deliveries SET quantity = 0 WHERE owner_id = $1 AND quantity > 0',
            [characterId],
          );
          const saved = await db.query(
            `UPDATE moli_client.characters SET save = $1::jsonb, revision = revision + 1, received_at = $2,
             last_request_id = NULL, last_payload_hash = NULL WHERE id = $3 AND revision = $4::bigint`,
            [JSON.stringify(save), now, characterId, snapshot.revision],
          );
          if (saved.rowCount !== 1) throw new Error('Locked reincarnation checkpoint changed');
        },
        record: async (hash, record) => {
          await db.query(
            `INSERT INTO moli_client.reincarnation_receipts (character_id, request_id, payload_hash, result)
             VALUES ($1, $2, $3, $4::jsonb)`, [characterId, record.requestId, hash, JSON.stringify(record)],
          );
        },
      });
    });
  }
}
