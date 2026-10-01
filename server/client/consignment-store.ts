import type { Pool, PoolClient } from 'pg';
import type { ClientSave } from '../../shared/client-save';
import {
  CONSIGNMENT_PAGE_SIZE, consignmentDeliverySchema, consignmentListingSchema, consignmentReceiptSchema,
  consignmentTotalsSchema, type ConsignmentDelivery, type ConsignmentFill, type ConsignmentFilter,
  type ConsignmentListing, type ConsignmentReceipt, type ConsignmentTotals,
} from '../../shared/consignment';
import { inTransaction } from '../database';
import { ApiError } from '../errors';
import { ClientRepository, type CloudSnapshot } from './repository';

export interface StoredConsignmentReceipt {
  hash: string;
  receipt: ConsignmentReceipt;
}
export interface ConsignmentPlan {
  save: ClientSave;
  listing: { state: ConsignmentListing; create: boolean } | null;
  deliveries: ConsignmentDelivery[];
  claimed: ConsignmentDelivery | null;
  fill: ConsignmentFill | null;
}
export interface ConsignmentTransaction {
  snapshot: CloudSnapshot;
  receipt(requestId: string): Promise<StoredConsignmentReceipt | null>;
  activeCount(): Promise<number>;
  listing(id: string): Promise<ConsignmentListing | null>;
  delivery(id: string): Promise<ConsignmentDelivery | null>;
  apply(plan: ConsignmentPlan, now: number): Promise<void>;
  record(hash: string, receipt: ConsignmentReceipt): Promise<void>;
}
export interface ListingQuery extends ConsignmentFilter {
  sellerId?: string;
  itemIds: string[];
  page: number;
}
export interface ConsignmentStore {
  load(characterId: string): Promise<CloudSnapshot>;
  transact<T>(characterId: string, work: (tx: ConsignmentTransaction) => Promise<T>): Promise<T>;
  receipt(characterId: string, requestId: string): Promise<StoredConsignmentReceipt | null>;
  listings(query: ListingQuery): Promise<ConsignmentListing[]>;
  deliveries(characterId: string, page: number): Promise<ConsignmentDelivery[]>;
  activeCount(characterId: string): Promise<number>;
  totals(characterId: string): Promise<ConsignmentTotals>;
}

const listingColumns = `id, seller_id AS "sellerId", asset, unit_price::text AS "unitPrice", quantity, remaining,
  gross::text, fee::text, status, created_at::float8 AS "createdAt", updated_at::float8 AS "updatedAt"`;
const deliveryColumns = `id, owner_id AS "ownerId", asset, quantity::text, created_at::float8 AS "createdAt"`;
type Queryable = Pick<PoolClient, 'query'>;

async function receipt(db: Queryable, characterId: string, requestId: string): Promise<StoredConsignmentReceipt | null> {
  const result = await db.query<{ hash: string; receipt: unknown }>(
    `SELECT payload_hash AS hash, result AS receipt FROM moli_client.consignment_receipts
     WHERE character_id = $1 AND request_id = $2`, [characterId, requestId],
  );
  const row = result.rows[0];
  return row ? { hash: row.hash, receipt: consignmentReceiptSchema.parse(row.receipt) } : null;
}

async function activeCount(db: Queryable, characterId: string) {
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM moli_client.consignment_listings WHERE seller_id = $1 AND status = 'active'`,
    [characterId],
  );
  return result.rows[0].count;
}

export class ConsignmentRepository implements ConsignmentStore {
  private readonly cloud: ClientRepository;
  constructor(private readonly pool: Pool) { this.cloud = new ClientRepository(pool); }

  load(characterId: string) { return this.cloud.load(characterId); }
  receipt(characterId: string, requestId: string) { return receipt(this.pool, characterId, requestId); }
  activeCount(characterId: string) { return activeCount(this.pool, characterId); }

  async transact<T>(characterId: string, work: (tx: ConsignmentTransaction) => Promise<T>): Promise<T> {
    return inTransaction(this.pool, async db => {
      // Non-key locks serialize actor saves without blocking foreign-key checks for offline sellers.
      const result = await db.query<CloudSnapshot>(
        `SELECT save, revision::text, received_at::float8 AS "receivedAt",
         last_request_id AS "lastRequestId", last_payload_hash AS "lastPayloadHash"
         FROM moli_client.characters WHERE id = $1 FOR NO KEY UPDATE`, [characterId],
      );
      const snapshot = result.rows[0];
      if (!snapshot) throw new ApiError(401, 'UNAUTHENTICATED', '云存档身份已失效，本地进度保留。');
      return work({
        snapshot,
        receipt: id => receipt(db, characterId, id),
        activeCount: () => activeCount(db, characterId),
        listing: async id => {
          const rows = await db.query(
            `SELECT ${listingColumns} FROM moli_client.consignment_listings WHERE id = $1 FOR UPDATE`, [id],
          );
          return rows.rows[0] ? consignmentListingSchema.parse(rows.rows[0]) : null;
        },
        delivery: async id => {
          const rows = await db.query(
            `SELECT ${deliveryColumns} FROM moli_client.consignment_deliveries
             WHERE id = $1 AND owner_id = $2 FOR UPDATE`, [id, characterId],
          );
          return rows.rows[0] ? consignmentDeliverySchema.parse(rows.rows[0]) : null;
        },
        apply: async (plan, now) => {
          if (plan.listing) {
            const row = plan.listing.state;
            if (plan.listing.create) {
              await db.query(
                `INSERT INTO moli_client.consignment_listings
                 (id, seller_id, asset, unit_price, quantity, remaining, gross, fee, status, created_at, updated_at)
                 VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [row.id, row.sellerId, JSON.stringify(row.asset), row.unitPrice, row.quantity, row.remaining,
                  row.gross, row.fee, row.status, row.createdAt, row.updatedAt],
              );
            } else {
              await db.query(
                `UPDATE moli_client.consignment_listings SET remaining = $2, gross = $3, fee = $4, status = $5, updated_at = $6
                 WHERE id = $1`, [row.id, row.remaining, row.gross, row.fee, row.status, row.updatedAt],
              );
            }
          }
          for (const row of plan.deliveries) {
            await db.query(
              `INSERT INTO moli_client.consignment_deliveries (id, owner_id, asset, quantity, created_at)
               VALUES ($1, $2, $3::jsonb, $4, $5)`,
              [row.id, row.ownerId, JSON.stringify(row.asset), row.quantity, row.createdAt],
            );
          }
          if (plan.claimed) {
            await db.query('UPDATE moli_client.consignment_deliveries SET quantity = $2 WHERE id = $1',
              [plan.claimed.id, plan.claimed.quantity]);
          }
          if (plan.fill) {
            const row = plan.fill;
            await db.query(
              `INSERT INTO moli_client.consignment_fills
               (id, listing_id, buyer_id, seller_id, quantity, gross, fee, net, settled_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [row.id, row.listingId, row.buyerId, row.sellerId, row.quantity, row.gross, row.fee, row.net, row.at],
            );
          }
          const saved = await db.query(
            `UPDATE moli_client.characters SET save = $1::jsonb, revision = revision + 1, received_at = $2,
             last_request_id = NULL, last_payload_hash = NULL WHERE id = $3 AND revision = $4::bigint`,
            [JSON.stringify(plan.save), now, characterId, snapshot.revision],
          );
          if (saved.rowCount !== 1) throw new Error('Locked consignment checkpoint changed');
        },
        record: async (hash, record) => {
          await db.query(
            `INSERT INTO moli_client.consignment_receipts (character_id, request_id, payload_hash, result)
             VALUES ($1, $2, $3, $4::jsonb)`, [characterId, record.requestId, hash, JSON.stringify(record)],
          );
        },
      });
    });
  }

  async listings(query: ListingQuery): Promise<ConsignmentListing[]> {
    const values: unknown[] = [query.itemIds];
    const where = ["asset->>'itemId' = ANY($1::text[])"];
    const add = (expression: string, value: unknown) => { values.push(value); where.push(`${expression} $${values.length}`); };
    if (query.sellerId) add('seller_id =', query.sellerId);
    else where.push("status = 'active'");
    if (query.minQuality !== undefined) add("(asset->>'quality')::int >=", query.minQuality);
    if (query.maxQuality !== undefined) add("(asset->>'quality')::int <=", query.maxQuality);
    if (query.minPrice !== undefined) add('unit_price >=', query.minPrice);
    if (query.maxPrice !== undefined) add('unit_price <=', query.maxPrice);
    values.push(CONSIGNMENT_PAGE_SIZE + 1, query.page * CONSIGNMENT_PAGE_SIZE);
    const result = await this.pool.query(
      `SELECT ${listingColumns} FROM moli_client.consignment_listings WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values,
    );
    return result.rows.map(row => consignmentListingSchema.parse(row));
  }

  async deliveries(characterId: string, page: number): Promise<ConsignmentDelivery[]> {
    const result = await this.pool.query(
      `SELECT ${deliveryColumns} FROM moli_client.consignment_deliveries WHERE owner_id = $1 AND quantity > 0
       ORDER BY created_at, id LIMIT $2 OFFSET $3`, [characterId, CONSIGNMENT_PAGE_SIZE + 1, page * CONSIGNMENT_PAGE_SIZE],
    );
    return result.rows.map(row => consignmentDeliverySchema.parse(row));
  }

  async totals(characterId: string): Promise<ConsignmentTotals> {
    const result = await this.pool.query(
      `SELECT
       COALESCE(SUM(CASE WHEN buyer_id = $1 THEN gross ELSE 0 END), 0)::text AS "purchaseSpent",
       COALESCE(SUM(CASE WHEN seller_id = $1 THEN gross ELSE 0 END), 0)::text AS "saleGross",
       COALESCE(SUM(CASE WHEN seller_id = $1 THEN fee ELSE 0 END), 0)::text AS "saleFees",
       COALESCE(SUM(CASE WHEN seller_id = $1 THEN net ELSE 0 END), 0)::text AS "saleNet"
       FROM moli_client.consignment_fills WHERE buyer_id = $1 OR seller_id = $1`, [characterId],
    );
    return consignmentTotalsSchema.parse(result.rows[0]);
  }
}
