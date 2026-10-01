export const DEFAULT_DATABASE_URL =
  'postgres://moli_dev:moli_local_only@127.0.0.1:54329/moli_dev';
export const DEFAULT_ACTIVITY_DATABASE_URL =
  'postgres://moli_activity:moli_activity_local_only@127.0.0.1:54329/moli_activity';

export interface ServerConfig {
  databaseUrl: string;
  devAuth: boolean;
  nodeEnv: string;
  port: number;
}

export function readConfig(): ServerConfig {
  const port = Number(process.env.API_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }
  return {
    databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    devAuth: process.env.DEV_AUTH === 'true',
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port,
  };
}

export function assertLocalDatabaseUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a local PostgreSQL URL.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.search !== '' ||
    url.hash !== '' ||
    !['/moli_dev', '/moli_test', '/moli_activity'].includes(url.pathname) ||
    !['moli_dev', 'moli_test', 'moli_activity'].includes(url.username)
  ) {
    throw new Error('This prototype only connects to local moli_dev, moli_test or moli_activity databases.');
  }
  if (url.pathname.slice(1) !== url.username) {
    throw new Error('The local database and role names must match.');
  }
}

export function assertActivityDeploymentDatabaseUrl(value: string): void {
  const message = 'Activity deployment requires the isolated moli_activity_vps database and role, a password of at least 32 characters, and no URL parameters.';
  let url: URL;
  let password: string;
  try {
    url = new URL(value);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error(message);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.username !== 'moli_activity_vps' ||
    url.pathname !== '/moli_activity_vps' ||
    password.length < 32 ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(message);
  }
}
