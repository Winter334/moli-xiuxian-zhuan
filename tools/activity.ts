import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { readDiscordConfig } from '../server/client/discord-config';

readDiscordConfig();
process.env.CLIENT_AUTH_MODE = 'discord';
process.env.DEV_AUTH = 'false';

const firstPort = Number(process.env.ACTIVITY_PORT ?? '5180');
if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65435) {
  throw new Error('ACTIVITY_PORT must be an integer between 1024 and 65435.');
}
async function available(port: number) {
  return new Promise<boolean>(done => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
  });
}
let port = firstPort;
while (port < firstPort + 100 && !await available(port)) port++;
if (port === firstPort + 100) throw new Error('No free local Activity port.');
process.env.API_PORT = String(port);

// The tunnel exposes only built web assets, not Vite's source or filesystem endpoints.
execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], {
  stdio: 'inherit', windowsHide: true,
});
const { createClientApp } = await import('../server/client/main');
const app = await createClientApp({ serveWeb: true });
try {
  const address = await app.listen({ host: '127.0.0.1', port });
  console.log(`Discord Activity test endpoint: ${address}`);
  console.log(`Tunnel target: http://127.0.0.1:${port}. Launch this application inside Discord to log in.`);
} catch (error) {
  await app.close();
  throw error;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
}
