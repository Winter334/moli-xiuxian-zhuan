import 'dotenv/config';
import { createPool } from '../database';
import { readConfig } from '../config';
import { initializeStorage } from './repository';

const pool = createPool(readConfig().databaseUrl);
try {
  await initializeStorage(pool);
  console.log('Client save storage ready. Existing character data was preserved.');
} finally { await pool.end(); }
