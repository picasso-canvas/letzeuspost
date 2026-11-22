import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { devEnvText, parseEnvFile, WEB_PORT } from './dev-env.ts';

// Different bytes on every call, so two secrets are never equal.
let n = 0;
const randomBytes = (size: number) =>
  Uint8Array.from({ length: size }, (_, i) => (++n + i * 7) % 256);

describe('devEnvText', () => {
  it('holds every setting the four local processes read, and each one passes its own check', () => {
    const env = parseEnvFile(devEnvText(randomBytes));
    for (const name of ['web', 'worker', 'migrate', 'seed'] as const) {
      expect(() => loadEnv(name, env)).not.toThrow();
    }
  });

  it('runs in development, over plain http on the local web port and the compose ports', () => {
    const env = parseEnvFile(devEnvText(randomBytes));
    expect(env.LZP_ENV).toBe('development');
    expect(env.APP_URL).toBe(`http://localhost:${String(WEB_PORT)}`);
    expect(env.DATABASE_URL).toContain('@127.0.0.1:5432/');
    expect(env.SMTP_URL).toBe('smtp://127.0.0.1:1025');
  });

  it('gives the compose file its three database passwords and uses them in the two urls', () => {
    const env = parseEnvFile(devEnvText(randomBytes));
    expect(env.DATABASE_URL).toContain(`lzp_app:${env.LZP_PG_APP_PASSWORD ?? '?'}@`);
    expect(env.DATABASE_OWNER_URL).toContain(`lzp_owner:${env.LZP_PG_OWNER_PASSWORD ?? '?'}@`);
    expect(env.LZP_PG_SUPERUSER_PASSWORD).toBeTruthy();
  });

  it('draws a fresh secret for each one, never a shared value', () => {
    const env = parseEnvFile(devEnvText(randomBytes));
    const secrets = [
      env.LZP_PG_SUPERUSER_PASSWORD,
      env.LZP_PG_OWNER_PASSWORD,
      env.LZP_PG_APP_PASSWORD,
      env.STORAGE_SECRET_ACCESS_KEY,
      env.AUTH_SECRET,
      env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,
    ];
    expect(new Set(secrets).size).toBe(secrets.length);
  });
});

describe('parseEnvFile', () => {
  it('reads KEY=value lines, skips comments and blanks, and keeps an = inside a value', () => {
    expect(parseEnvFile('# note\n\nA=1\nB=x=y\n  C = 3 \n')).toEqual({ A: '1', B: 'x=y', C: '3' });
  });
});
