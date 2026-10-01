import { execFileSync, spawnSync } from 'node:child_process';
import { Pool } from 'pg';

const command = process.argv[2];
if (command !== 'up' && command !== 'down') throw new Error('Expected db:up or db:down.');
if (command === 'down') {
  execFileSync('docker', ['compose', 'stop', 'postgres'], { stdio: 'inherit' });
  process.exit(0);
}
const started = spawnSync('docker', ['compose', 'up', '-d', 'postgres'], { stdio: 'inherit' });
if (started.status !== 0) throw new Error('Docker startup failed. Start the existing Docker engine, then retry.');
const admin = new Pool({
  connectionString: 'postgres://moli_admin:moli_admin_local_only@127.0.0.1:54329/postgres',
  max: 1,
  connectionTimeoutMillis: 2000,
});
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try { await admin.query('select 1'); ready = true; break; }
  catch { await new Promise(resolve => setTimeout(resolve, 1000)); }
}
if (!ready) {
  await admin.end();
  throw new Error('Local PostgreSQL did not become ready.');
}
// Fixed local identities only. Do not accept an external URL or interpolate user input.
for (const [role, password, database] of [
  ['moli_dev', 'moli_local_only', 'moli_dev'],
  ['moli_test', 'moli_test_only', 'moli_test'],
  ['moli_activity', 'moli_activity_local_only', 'moli_activity'],
] as const) {
  if (!(await admin.query('select 1 from pg_roles where rolname = $1', [role])).rowCount) {
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  }
  if (!(await admin.query('select 1 from pg_database where datname = $1', [database])).rowCount) {
    await admin.query(`CREATE DATABASE ${database} OWNER ${role}`);
  }
  await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
}
console.log('Local PostgreSQL ready on 127.0.0.1:54329. Development, test and Discord Activity databases are isolated.');
await admin.end();
