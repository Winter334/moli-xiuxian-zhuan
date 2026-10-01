import { describe, expect, it } from 'vitest';
import { requireTestDatabaseUrl } from './database-guard';

describe('isolated database safety guard', () => {
  it.each([
    undefined,
    '',
    'not-a-url',
    'postgres://moli_test:local@remote.invalid:54329/moli_test',
    'postgres://moli_dev:local@127.0.0.1:54329/moli_dev',
    'postgres://postgres:local@127.0.0.1:54329/moli_test',
    'postgres://moli_test:local@127.0.0.1:54329/production',
    'postgres://moli_test:local@127.0.0.1:54329/moli_test?host=remote.invalid',
    'postgres://moli_test:local@127.0.0.1:54329/moli_test?options=-csearch_path=public',
    'postgres://moli_test:local@127.0.0.1:54329/moli_test#fragment',
    'postgres://moli_test@127.0.0.1:54329/moli_test',
    'https://moli_test:local@127.0.0.1:54329/moli_test',
  ])('rejects a missing or unsafe target without echoing credentials', (value) => {
    expect(() => requireTestDatabaseUrl(value)).toThrow('TEST_DATABASE_URL must explicitly select');
    try {
      requireTestDatabaseUrl(value);
    } catch (error) {
      expect((error as Error).message).not.toContain('postgres://');
    }
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])('accepts an explicit loopback moli_test target: %s', (host) => {
    const url = `postgres://moli_test:moli_test_only@${host}:54329/moli_test`;
    expect(requireTestDatabaseUrl(url)).toBe(url);
  });
});
