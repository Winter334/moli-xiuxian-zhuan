import 'dotenv/config';
import { isIP } from 'node:net';
import { createClientApp } from './main';

async function start() {
  process.env.NODE_ENV ??= 'production';
  process.env.CLIENT_AUTH_MODE ??= 'discord';
  process.env.DEV_AUTH ??= 'false';
  const host = process.env.ACTIVITY_HOST ?? '127.0.0.1';
  const port = Number(process.env.ACTIVITY_PORT ?? '5180');
  if (!isIP(host) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('ACTIVITY_HOST must be an IP address and ACTIVITY_PORT must be between 1024 and 65535.');
  }
  const app = await createClientApp({ serveWeb: true, deployment: true });
  try {
    console.log(`Discord Activity listening at ${await app.listen({ host, port })}`);
  } catch (error) {
    await app.close();
    throw error;
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
  }
}

start().catch((error: unknown) => {
  console.error('Activity startup failed:', error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]')
    : 'Unknown error');
  process.exitCode = 1;
});
