import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import type { ClientSave } from '../../shared/client-save';
import { discordUserSchema, type DiscordUser } from '../../shared/discord';
import type { PublicPlayerProfile } from '../../shared/player-profile';
import { createCharacter } from '../../core/prototype';
import { inTransaction } from '../database';
import { ApiError } from '../errors';
import { developmentProfile, discordProfile, playerScopeSql, type PlayerScope } from './player-profile';
import { requireNoPvp } from './pvp-store';

export interface CloudSnapshot {
  save: unknown;
  revision: string;
  receivedAt: number;
  lastRequestId: string | null;
  lastPayloadHash: string | null;
}
export interface RankingSnapshot {
  characterId: string;
  save: unknown;
  receivedAt: number;
  profile: PublicPlayerProfile;
}
export interface RankingStore {
  readonly scope: PlayerScope;
  rankingSnapshots(): AsyncIterable<RankingSnapshot>;
}
export interface CloudStore {
  createSession(save: ClientSave, now: number): Promise<{ token: string; characterId: string }>;
  load(characterId: string): Promise<CloudSnapshot>;
  commit(characterId: string, expected: string, save: ClientSave, now: number, requestId: string, hash: string): Promise<boolean>;
}

export async function initializeStorage(pool: Pool) {
  const migrations = await Promise.all(['001_initial.sql', '002_discord.sql', '003_discord_profiles.sql', '004_social.sql', '005_pvp.sql', '006_huashen_cultivation.sql'].map(async name => {
    const sql = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  await inTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(17483217, 4)');
    await client.query('CREATE SCHEMA IF NOT EXISTS moli_client');
    await client.query('CREATE TABLE IF NOT EXISTS moli_client.schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
    const applied = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM moli_client.schema_migrations ORDER BY name');
    if (applied.rows.length > migrations.length || applied.rows.some((row, index) =>
      row.name !== migrations[index].name || row.checksum !== migrations[index].checksum)) {
      throw new Error('Client storage version mismatch; existing data was not modified.');
    }
    for (const migration of migrations.slice(applied.rows.length)) {
      await client.query(migration.sql);
      await client.query('INSERT INTO moli_client.schema_migrations VALUES ($1, $2)', [migration.name, migration.checksum]);
    }
  });
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export class ClientRepository implements CloudStore, RankingStore {
  constructor(readonly pool: Pool, readonly scope: PlayerScope = { kind: 'development' }) {}

  async findSession(token: string): Promise<string | null> {
    const result = await this.pool.query<{ character_id: string }>(
      'SELECT character_id FROM moli_client.dev_sessions WHERE token_hash = $1', [hashToken(token)],
    );
    return result.rows[0]?.character_id ?? null;
  }

  async createSession(save: ClientSave, now: number) {
    const token = randomUUID();
    const characterId = randomUUID();
    await inTransaction(this.pool, async client => {
      await client.query('INSERT INTO moli_client.characters (id, save, received_at) VALUES ($1, $2::jsonb, $3)',
        [characterId, JSON.stringify(save), now]);
      await client.query('INSERT INTO moli_client.dev_sessions VALUES ($1, $2)', [hashToken(token), characterId]);
    });
    return { token, characterId };
  }

  async connectDiscordAccount(clientId: string, verifiedUser: DiscordUser, expiresAt: number, now: number) {
    const user = discordUserSchema.parse(verifiedUser);
    const userId = user.id;
    const sessionToken = randomBytes(32).toString('base64url');
    const characterId = await inTransaction(this.pool, async client => {
      // Serialize first login for this account, without locking unrelated accounts.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`discord:${clientId}:${userId}`]);
      const existing = await client.query<{ character_id: string }>(
        'SELECT character_id FROM moli_client.discord_accounts WHERE application_id = $1 AND user_id = $2',
        [clientId, userId],
      );
      const id = existing.rows[0]?.character_id ?? randomUUID();
      if (!existing.rowCount) {
        const save: ClientSave = {
          format: 'opening-client-2', tradeRevision: '0',
          character: createCharacter(now, randomInt(1, 0x1_0000_0000)), playedMs: 0,
        };
        await client.query('INSERT INTO moli_client.characters (id, save, received_at) VALUES ($1, $2::jsonb, $3)',
          [id, JSON.stringify(save), now]);
        await client.query('INSERT INTO moli_client.discord_accounts VALUES ($1, $2, $3, $4)', [clientId, userId, id, now]);
      }
      await client.query(
        `INSERT INTO moli_client.discord_profiles (application_id, user_id, display_name, avatar_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (application_id, user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name, avatar_hash = EXCLUDED.avatar_hash, updated_at = EXCLUDED.updated_at`,
        [clientId, userId, user.displayName, user.avatar, now],
      );
      await client.query('INSERT INTO moli_client.discord_sessions VALUES ($1, $2, $3, $4)',
        [hashToken(sessionToken), clientId, userId, expiresAt]);
      return id;
    });
    return { characterId, sessionToken };
  }

  async findDiscordSession(token: string, clientId: string, now: number): Promise<string | null> {
    const result = await this.pool.query<{ character_id: string }>(
      `SELECT a.character_id FROM moli_client.discord_sessions s
       JOIN moli_client.discord_accounts a ON a.application_id = s.application_id AND a.user_id = s.user_id
       WHERE s.token_hash = $1 AND s.application_id = $2 AND s.expires_at > $3`,
      [hashToken(token), clientId, now],
    );
    return result.rows[0]?.character_id ?? null;
  }

  async socialIdentity(token: string, clientId: string, now: number) {
    const result = await this.pool.query<{
      characterId: string; userId: string; expiresAt: number; displayName: string; avatar: string | null;
    }>(`SELECT a.character_id AS "characterId", a.user_id AS "userId",
      s.expires_at::float8 AS "expiresAt", p.display_name AS "displayName", p.avatar_hash AS avatar
      FROM moli_client.discord_sessions s
      JOIN moli_client.discord_accounts a USING (application_id, user_id)
      JOIN moli_client.discord_profiles p USING (application_id, user_id)
      WHERE s.token_hash = $1 AND s.application_id = $2 AND s.expires_at > $3`,
    [hashToken(token), clientId, now]);
    const row = result.rows[0];
    return row ? { characterId: row.characterId, userId: row.userId, expiresAt: row.expiresAt,
      profile: discordProfile({ id: row.userId, displayName: row.displayName, avatar: row.avatar }) } : null;
  }

  async load(characterId: string): Promise<CloudSnapshot> {
    const result = await this.pool.query<CloudSnapshot>(
      `SELECT save, revision::text, received_at::float8 AS "receivedAt",
       last_request_id AS "lastRequestId", last_payload_hash AS "lastPayloadHash"
       FROM moli_client.characters WHERE id = $1`, [characterId],
    );
    if (!result.rows[0]) throw new ApiError(401, 'UNAUTHENTICATED', '云存档身份已失效，本地进度保留。');
    return result.rows[0];
  }

  async *rankingSnapshots(): AsyncIterable<RankingSnapshot> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      // One consistent, read-only cloud snapshot, fetched in bounded batches.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const values: unknown[] = [];
      const membership = playerScopeSql(this.scope, 'c.id', values);
      await client.query(`DECLARE ranking_snapshots NO SCROLL CURSOR FOR
        SELECT c.id AS "characterId", c.save, c.received_at::float8 AS "receivedAt"
        FROM moli_client.characters c
        WHERE ${membership}`, values);
      while (true) {
        const result = await client.query<Omit<RankingSnapshot, 'profile'>>('FETCH FORWARD 100 FROM ranking_snapshots');
        const profiles = await this.publicProfiles(result.rows.map(row => row.characterId), client);
        for (const row of result.rows) {
          const profile = profiles.get(row.characterId);
          if (profile) yield { ...row, profile };
        }
        if (result.rows.length < 100) break;
      }
    } finally {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      client.release(discard);
    }
  }

  async publicProfiles(characterIds: string[], db: Pick<Pool, 'query'> = this.pool): Promise<Map<string, PublicPlayerProfile>> {
    if (this.scope.kind === 'development') return new Map(characterIds.map(id => [id, developmentProfile(id)]));
    if (!characterIds.length) return new Map();
    const result = await db.query<{ characterId: string; id: string; displayName: string; avatar: string | null }>(
      `SELECT a.character_id AS "characterId", a.user_id AS id, p.display_name AS "displayName", p.avatar_hash AS avatar
       FROM moli_client.discord_accounts a JOIN moli_client.discord_profiles p USING (application_id, user_id)
       WHERE a.application_id = $1 AND a.character_id = ANY($2::uuid[])`,
      [this.scope.applicationId, characterIds],
    );
    return new Map(result.rows.map(row => [row.characterId, discordProfile(row)]));
  }

  async commit(characterId: string, expected: string, save: ClientSave, now: number, requestId: string, hash: string) {
    return inTransaction(this.pool, async db => {
      await db.query('SELECT id FROM moli_client.characters WHERE id=$1 FOR NO KEY UPDATE', [characterId]);
      await requireNoPvp(db, characterId);
      const result = await db.query(
        `UPDATE moli_client.characters SET save = $1::jsonb, revision = revision + 1,
         received_at = $2, last_request_id = $3, last_payload_hash = $4
         WHERE id = $5 AND revision = $6::bigint`,
        [JSON.stringify(save), now, requestId, hash, characterId, expected],
      );
      return result.rowCount === 1;
    });
  }
}
