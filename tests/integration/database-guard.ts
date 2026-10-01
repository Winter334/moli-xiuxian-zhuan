export function requireTestDatabaseUrl(value: string | undefined): string {
  const message = 'TEST_DATABASE_URL must explicitly select the local moli_test database and moli_test role, without URL options.';
  if (!value) throw new Error(message);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/moli_test' ||
    url.username !== 'moli_test' ||
    url.password === '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(message);
  }
  return value;
}
