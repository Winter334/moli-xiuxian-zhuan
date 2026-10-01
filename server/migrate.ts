import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { Pool } from 'pg';
import { createPool, inTransaction } from './database';
import { readConfig } from './config';

const migrationFiles = ['001_initial.sql'] as const;

export async function migrate(pool: Pool): Promise<void> {
  const migrations = await Promise.all(
    migrationFiles.map(async (name) => {
      const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
  await inTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(17483217, 1)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name',
    );
    for (const row of applied.rows) {
      const source = migrations.find((migration) => migration.name === row.name);
      if (!source || source.checksum !== row.checksum) {
        throw new Error('Database migration history does not match this server version.');
      }
    }
    for (const migration of migrations) {
      if (applied.rows.some((row) => row.name === migration.name)) continue;
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
    }
  });
}

async function run(): Promise<void> {
  loadEnv({ quiet: true });
  const pool = createPool(readConfig().databaseUrl);
  try {
    await migrate(pool);
    console.log('Local PostgreSQL migrations are up to date. Existing saves were preserved.');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(() => {
    console.error('Migration failed. Check the local database and migration history.');
    process.exitCode = 1;
  });
}
