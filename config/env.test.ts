import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadEnv, settings, type ProcessName } from './env.ts';

// Every malformed value below carries this marker, so a test can see whether any of it was printed. Secret-looking
// values are built at run time, never written out next to their names (gitleaks).
const LEAK = 'LEAKED';

const valid: Record<string, string> = {
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
const expected: Record<ProcessName, readonly string[]> = {
  // Database, file store (signing), auth, email; §14 Deploys: the Next.js key and deployment id.
  web: [
    'DATABASE_URL',
    ...FILE_STORE,
    ...EMAIL,
    'AUTH_SECRET',
    'APP_URL',
    'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
    'NEXT_DEPLOYMENT_ID',
  ],
  // Database, file store, email, and the app's address for the links in its emails.
  worker: ['DATABASE_URL', ...FILE_STORE, ...EMAIL, 'APP_URL'],
  // None: its token arrives in M2.
  fetcher: [],
  migrate: ['DATABASE_OWNER_URL'],
  seed: ['DATABASE_OWNER_URL'],
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

  it('gives the fetcher nothing, even with every setting in its environment', () => {
    expect(loadEnv('fetcher', valid)).toEqual({});
    expect(loadEnv('fetcher', {})).toEqual({});
  });

  it.each([
    ['DATABASE_URL', 'postgresql://lzp_app@db.internal:5432/letzeuspost?sslmode=require'],
    ['STORAGE_ENDPOINT', 'https://account.r2.cloudflarestorage.com'],
    ['STORAGE_REGION', 'auto'],
    ['STORAGE_BUCKET', 'letzeuspost.files-eu'],
    ['SMTP_URL', 'smtps://smtp.example.com:465'],
    ['APP_URL', 'https://app.letzeuspost.com'],
    ['NEXT_DEPLOYMENT_ID', '4e2d495a1f7f91775cf938184066ffac48915a13'],
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
    expect(() => loadEnv('migrate', { DATABASE_OWNER_URL: '' })).toThrow(
      'DATABASE_OWNER_URL is missing',
    );
  });

  it.each([
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
    const source = { ...without('DATABASE_URL'), APP_URL: `https://${LEAK}.example/` };
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
    expect(run.stderr).toContain('DATABASE_URL is missing');
    expect(run.stderr).toContain('STORAGE_SECRET_ACCESS_KEY is malformed');
    expect(run.stderr).not.toContain(LEAK);
  });
});
