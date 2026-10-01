import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { assertLocalDatabaseUrl } from '../server/config';

async function portAvailable(port: number) {
  return new Promise<boolean>(done => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}
async function choosePort(first: number) {
  for (let port = first; port < first + 100; port++) if (await portAvailable(port)) return port;
  throw new Error(`No free local port near ${first}.`);
}
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://moli_dev:moli_local_only@127.0.0.1:54329/moli_dev';
assertLocalDatabaseUrl(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
try { await pool.query('select 1'); }
catch { throw new Error('Database unavailable. Run pnpm db:up, or configure DATABASE_URL for your isolated local database.'); }
finally { await pool.end(); }
const apiPort = await choosePort(Number(process.env.API_PORT ?? 3001));
const webPort = await choosePort(Number(process.env.WEB_PORT ?? 5173));
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  DEV_AUTH: 'true',
  API_PORT: String(apiPort),
  WEB_PORT: String(webPort),
  NODE_ENV: 'development',
};
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'server/client/main.ts'], { stdio: 'inherit', env, windowsHide: true }),
  spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js')], { stdio: 'inherit', env, windowsHide: true }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => stop(code ?? 0));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
console.log(`Local development: http://127.0.0.1:${webPort} (API ${apiPort}). Ctrl+C stops both services.`);
