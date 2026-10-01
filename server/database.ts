import pg, { type Pool, type PoolClient } from 'pg';
import { assertLocalDatabaseUrl } from './config';

export function createPool(databaseUrl: string, playtest = false): Pool {
  assertLocalDatabaseUrl(databaseUrl);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    application_name: 'moli-local',
    ...(playtest ? { options: '-c search_path=moli_playtest' } : {}),
  });
  // pg emits idle connection errors outside query promises. Never log connection details.
  pool.on('error', () => {
    console.error('A local PostgreSQL connection was lost; later requests will reconnect.');
  });
  return pool;
}

export async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
