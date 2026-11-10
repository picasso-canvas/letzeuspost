import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadEnv, settings, type ProcessName } from './env.ts';

// Every malformed value below carries this marker, so a test can see whether any of it was printed. Secret-looking
// values are built at run time, never written out next to their names (gitleaks).
const LEAK = 'LEAKED';

const valid: Record<string, string> = {
  LZP_ENV: 'development',
  DATABASE_URL: 'postgres://lzp_app@localhost:5432/letzeuspost',
  DATABASE_OWNER_URL: 'postgres://lzp_owner@localhost:5432/letzeuspost',
  STORAGE_ENDPOINT: 'http://localhost:8333',
  STORAGE_REGION: 'us-east-1',
  STORAGE_BUCKET: 'letzeuspost-dev',
  STORAGE_ACCESS_KEY_ID: 'a'.repeat(20),
  STORAGE_SECRET_ACCESS_KEY: 's'.repeat(40),
  SMTP_URL: 'smtp://localhost:1025',
  EMAIL_FROM: 'posts@letzeuspost.test',
  AUTH_SECRET: 'x'.repeat(32),
  APP_URL: 'http://localhost:3000',
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  NEXT_DEPLOYMENT_ID: 'dev',
};

const FILE_STORE = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
];
const EMAIL = ['SMTP_URL', 'EMAIL_FROM'];

// §13 What runs and §14 Secrets: each process holds only these.
// Every process also knows where it runs (LZP_ENV, Zeus on #105).
const expected: Record<ProcessName, readonly string[]> = {
  // Database, file store (signing), auth, email; §14 Deploys: the Next.js key and deployment id.
  web: [
    'LZP_ENV',
    'DATABASE_URL',
    ...FILE_STORE,
    ...EMAIL,
    'AUTH_SECRET',
    'APP_URL',
    'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
    'NEXT_DEPLOYMENT_ID',
  ],
  // Database, file store, email, and the app's address for the links in its emails.
  worker: ['LZP_ENV', 'DATABASE_URL', ...FILE_STORE, ...EMAIL, 'APP_URL'],
  // Nothing else: its token arrives in M2.
  fetcher: ['LZP_ENV'],
  migrate: ['LZP_ENV', 'DATABASE_OWNER_URL'],
  seed: ['LZP_ENV', 'DATABASE_OWNER_URL'],
};
const processes = Object.keys(expected) as ProcessName[];

/** The first process that reads a setting, to test that setting through. */
function readerOf(setting: string): ProcessName {
  const reader = processes.find((name) => expected[name].includes(setting));
  if (reader === undefined) throw new Error(`No process reads ${setting}`);
  return reader;
}

function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('loadEnv threw something that is not an Error', { cause: error });
  }
  throw new Error('loadEnv did not throw');
}

const without = (setting: string): Record<string, string> =>
  Object.fromEntries(Object.entries(valid).filter(([name]) => name !== setting));

describe('the M0 settings', () => {
  it('are exactly the ones some process reads', () => {
    expect(Object.keys(settings).sort()).toEqual(Object.keys(valid).sort());
    expect(new Set(Object.values(expected).flat())).toEqual(new Set(Object.keys(settings)));
  });

  it('never reach the browser (no NEXT_PUBLIC_ name)', () => {
    expect(Object.keys(settings).filter((name) => name.startsWith('NEXT_PUBLIC_'))).toEqual([]);
  });
});

describe('loadEnv gives each process only its own settings', () => {
  it.each(processes)('%s gets exactly its settings, unchanged', (name) => {
    const source = { ...valid, PATH: '/usr/bin', ANTHROPIC_API_KEY: 'k'.repeat(10) };
    const env = loadEnv(name, source);
    expect(env).toEqual(Object.fromEntries(expected[name].map((key) => [key, valid[key]])));
  });

  it('gives the fetcher only LZP_ENV, even with every setting in its environment', () => {
    expect(loadEnv('fetcher', valid)).toEqual({ LZP_ENV: 'development' });
  });

  it.each([
    ['DATABASE_URL', 'postgresql://lzp_app@db.internal:5432/letzeuspost?sslmode=require'],
    ['STORAGE_ENDPOINT', 'https://account.r2.cloudflarestorage.com'],
    ['STORAGE_REGION', 'auto'],
    ['STORAGE_BUCKET', 'letzeuspost.files-eu'],
    ['SMTP_URL', 'smtps://smtp.example.com:465'],
    ['APP_URL', 'https://app.letzeuspost.com'],
    ['NEXT_DEPLOYMENT_ID', '4e2d495a1f7f91775cf938184066ffac48915a13'],
    ['LZP_ENV', 'ci'], // staging and production need https:// addresses: tested below
  ])('accepts %s = %s', (setting, value) => {
    const env: Record<string, string> = loadEnv(readerOf(setting), { ...valid, [setting]: value });
    expect(env[setting]).toBe(value);
  });
});

describe('a missing or malformed setting stops the process at startup', () => {
  it.each(processes.flatMap((name) => expected[name].map((setting) => [name, setting] as const)))(
    '%s without %s throws, naming it',
    (name, setting) => {
      expect(() => loadEnv(name, without(setting))).toThrow(`${setting} is missing`);
    },
  );

  it('counts an empty value as missing', () => {
    expect(() => loadEnv('migrate', { LZP_ENV: 'ci', DATABASE_OWNER_URL: '' })).toThrow(
      'DATABASE_OWNER_URL is missing',
    );
    expect(() => loadEnv('fetcher', { LZP_ENV: '' })).toThrow('LZP_ENV is missing');
  });

  it.each([
    ['LZP_ENV', LEAK],
    ['LZP_ENV', `production ${LEAK}`],
    ['LZP_ENV', `${LEAK}-staging`],
    ['LZP_ENV', 'PRODUCTION'], // the names are lowercase
    ['DATABASE_URL', `mysql://app:${LEAK}@localhost:5432/letzeuspost`], // not Postgres
    ['DATABASE_URL', `postgres://localhost:5432/${LEAK}`], // no user
    ['DATABASE_URL', `postgres://app:${LEAK}@localhost:5432`], // no database
    ['DATABASE_URL', `${LEAK} is not a URL`],
    ['DATABASE_OWNER_URL', `postgresql://owner:${LEAK}@/letzeuspost`], // no host
    ['STORAGE_ENDPOINT', `ftp://${LEAK}.example`],
    ['STORAGE_ENDPOINT', `localhost:8333/${LEAK}`],
    ['STORAGE_REGION', `US East ${LEAK}`],
    ['STORAGE_BUCKET', `${LEAK}_bucket`],
    ['STORAGE_BUCKET', LEAK.toLowerCase().repeat(11)], // over 63 characters
    ['STORAGE_ACCESS_KEY_ID', `${LEAK} key`],
    ['STORAGE_SECRET_ACCESS_KEY', `${LEAK} secret`],
    ['SMTP_URL', `http://${LEAK}:1025`],
    ['SMTP_URL', `smtp://user:${LEAK}@`], // no host
    ['EMAIL_FROM', `${LEAK}-at-example.com`],
    ['AUTH_SECRET', `${LEAK}-short`], // under 32 characters
    ['AUTH_SECRET', `${LEAK} ${'x'.repeat(32)}`], // a space
    ['APP_URL', `https://${LEAK}.example/app`], // a path
    ['APP_URL', `https://${LEAK}.example/`], // a trailing slash
    ['APP_URL', `ftp://${LEAK}.example`],
    ['NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', Buffer.from(`${LEAK}-16-bytes!`).toString('base64')],
    ['NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', `${LEAK}!not base64`],
    ['NEXT_DEPLOYMENT_ID', `${LEAK} with spaces`],
    ['NEXT_DEPLOYMENT_ID', LEAK.repeat(11)], // over 64 characters
  ])('refuses a malformed %s without printing its value (%#)', (setting, value) => {
    const error = thrownBy(() => loadEnv(readerOf(setting), { ...valid, [setting]: value }));
    expect(error.message).toContain(`${setting} is malformed`);
    const printed = inspect(error, { depth: Infinity });
    expect(printed).not.toContain(value);
    expect(printed).not.toContain(LEAK);
  });

  it('names every problem at once', () => {
    const source: Record<string, string> = {
      ...without('DATABASE_URL'),
      APP_URL: `https://${LEAK}.example/`,
    };
    delete source.AUTH_SECRET;
    const { message } = thrownBy(() => loadEnv('web', source));
    expect(message).toContain('DATABASE_URL is missing');
    expect(message).toContain('AUTH_SECRET is missing');
    expect(message).toContain('APP_URL is malformed');
    expect(message).not.toContain('STORAGE_BUCKET');
  });

  it('stops a process that loads its settings at startup, naming the setting but not its value', () => {
    const envModule = JSON.stringify(new URL('./env.ts', import.meta.url).href);
    const script = `import { loadEnv } from ${envModule}; loadEnv('worker'); console.log('started');`;
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      env: { STORAGE_SECRET_ACCESS_KEY: `${LEAK} secret` },
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    expect(run.stdout).not.toContain('started');
    expect(run.stderr).toContain('LZP_ENV is missing');
    expect(run.stderr).toContain('DATABASE_URL is missing');
    expect(run.stderr).toContain('STORAGE_SECRET_ACCESS_KEY is malformed');
    expect(run.stderr).not.toContain(LEAK);
  });
});

// §14: production is HTTPS only. Plain http:// is for Zeus's Mac and CI, which run without TLS (Zeus on #105).
describe('the app and file-store addresses are https:// outside development and ci', () => {
  const ADDRESSES = ['APP_URL', 'STORAGE_ENDPOINT'] as const;
  // A URL's host is lowercase, so these carry the marker in lowercase.
  const leak = LEAK.toLowerCase();
  const plain = {
    APP_URL: `http://${leak}.example`,
    STORAGE_ENDPOINT: `http://${leak}.example:8333`,
  };
  const secure = { APP_URL: 'https://app.letzeuspost.com', STORAGE_ENDPOINT: 'https://r2.example' };
  const readers = ['web', 'worker'] as const;

  it.each(['development', 'ci'])('accepts http:// addresses in %s', (environment) => {
    for (const name of readers) {
      const env: Record<string, string> = loadEnv(name, {
        ...valid,
        ...plain,
        LZP_ENV: environment,
      });
      expect(env.APP_URL).toBe(plain.APP_URL);
      expect(env.STORAGE_ENDPOINT).toBe(plain.STORAGE_ENDPOINT);
    }
  });

  it.each(['staging', 'production'])('accepts https:// addresses in %s', (environment) => {
    for (const name of readers) {
      const env: Record<string, string> = loadEnv(name, {
        ...valid,
        ...secure,
        LZP_ENV: environment,
      });
      expect(env.LZP_ENV).toBe(environment);
      expect(env.APP_URL).toBe(secure.APP_URL);
      expect(env.STORAGE_ENDPOINT).toBe(secure.STORAGE_ENDPOINT);
    }
  });

  it.each(
    ['staging', 'production'].flatMap((environment) =>
      readers.flatMap((name) => ADDRESSES.map((setting) => [environment, name, setting] as const)),
    ),
  )(
    'in %s, %s refuses an http:// %s, naming it but not its value',
    (environment, name, setting) => {
      const source = { ...valid, ...secure, LZP_ENV: environment, [setting]: plain[setting] };
      const error = thrownBy(() => loadEnv(name, source));
      expect(error.message).toContain(`${setting} is malformed: expected an https:// URL`);
      const other = ADDRESSES.find((address) => address !== setting) ?? '';
      expect(error.message).not.toContain(other);
      const printed = inspect(error, { depth: Infinity });
      expect(printed).not.toContain(plain[setting]);
      expect(printed).not.toContain(leak);
      expect(printed).not.toContain(environment);
    },
  );

  it('leaves the processes without these addresses alone in production', () => {
    const source = { ...valid, LZP_ENV: 'production' };
    expect(loadEnv('fetcher', source)).toEqual({ LZP_ENV: 'production' });
    for (const name of ['migrate', 'seed'] as const) {
      expect(loadEnv(name, source)).toEqual({
        LZP_ENV: 'production',
        DATABASE_OWNER_URL: valid.DATABASE_OWNER_URL,
      });
    }
  });

  it('refuses http:// however its scheme is written', () => {
    const source = { ...valid, LZP_ENV: 'production', STORAGE_ENDPOINT: `HTTP://${LEAK}.example` };
    const { message } = thrownBy(() => loadEnv('worker', source));
    expect(message).toContain('STORAGE_ENDPOINT is malformed: expected an https:// URL');
    expect(message).toContain('APP_URL is malformed: expected an https:// URL');
    expect(message).not.toContain(LEAK);
  });

  it('names each http:// address once, with the other problems', () => {
    const source = { ...without('DATABASE_URL'), LZP_ENV: 'staging' };
    const { message } = thrownBy(() => loadEnv('web', source));
    expect(message).toContain('DATABASE_URL is missing');
    for (const setting of ADDRESSES) {
      expect(message.split(`${setting} is malformed`)).toHaveLength(2);
    }
  });

  it('reports only LZP_ENV when it is missing or unknown, not the addresses it decides', () => {
    for (const source of [without('LZP_ENV'), { ...valid, LZP_ENV: 'prod' }]) {
      const { message } = thrownBy(() => loadEnv('web', source));
      expect(message).toMatch(/LZP_ENV is (missing|malformed)/);
      expect(message).not.toContain('APP_URL');
      expect(message).not.toContain('STORAGE_ENDPOINT');
    }
  });
});
