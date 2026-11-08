// Every setting LetZeusPost reads from its environment, each with a zod schema (§13 Environments). A process gets only
// its own settings (§13 What runs, §14 Secrets) by calling `loadEnv` at startup: a missing or malformed setting stops
// it with an error that names the setting and never shows its value. `env.example` is generated from this file:
//   node config/env-example.ts
// Settings that arrive with later features (the Anthropic key, R2, Resend, Sentry, Google sign-in, the fetcher's
// token) are added here when they do.
import { z } from 'zod';

interface Setting {
  /** The heading it sits under in env.example. */
  readonly group: string;
  /** What it is, in a few words. */
  readonly note: string;
  /** What a valid value looks like. Shown in env.example and in the startup error, so it never holds a value. */
  readonly expects: string;
  readonly schema: z.ZodType<string, string>;
}

const noSpaces = /^\S+$/;

/** A URL with one of `protocols` (each ending in `:`) that also passes `ok`. Never throws. */
function url(protocols: readonly string[], ok: (parsed: URL, value: string) => boolean) {
  return z
    .string()
    .regex(noSpaces)
    .refine((value) => {
      const parsed = URL.parse(value);
      return parsed !== null && protocols.includes(parsed.protocol) && ok(parsed, value);
    });
}

const postgresUrl = url(
  ['postgres:', 'postgresql:'],
  (parsed) => parsed.username !== '' && parsed.hostname !== '' && parsed.pathname.length > 1,
);
const POSTGRES_URL = 'postgres://user:password@host:port/database';

export const settings = {
  DATABASE_URL: {
    group: 'Database',
    note: 'Postgres as the app role, under row-level security',
    expects: POSTGRES_URL,
    schema: postgresUrl,
  },
  DATABASE_OWNER_URL: {
    group: 'Database',
    note: 'Postgres as the owner role, which the app never holds',
    expects: POSTGRES_URL,
    schema: postgresUrl,
  },
  STORAGE_ENDPOINT: {
    group: 'File store',
    note: "The file store's S3 API (SeaweedFS in development)",
    expects: 'an http:// or https:// URL',
    schema: url(['http:', 'https:'], () => true),
  },
  STORAGE_REGION: {
    group: 'File store',
    note: "The file store's region",
    expects: 'lowercase letters, digits and hyphens, like us-east-1',
    schema: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  },
  STORAGE_BUCKET: {
    group: 'File store',
    note: 'The private bucket for every file',
    expects: '3 to 63 lowercase letters, digits, dots or hyphens',
    schema: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  },
  STORAGE_ACCESS_KEY_ID: {
    group: 'File store',
    note: "The file store's access key id",
    expects: 'no spaces',
    schema: z.string().regex(noSpaces),
  },
  STORAGE_SECRET_ACCESS_KEY: {
    group: 'File store',
    note: "The file store's secret key",
    expects: 'no spaces',
    schema: z.string().regex(noSpaces),
  },
  SMTP_URL: {
    group: 'Email',
    note: 'Where emails are sent over SMTP (Mailpit in development)',
    expects: 'an smtp:// or smtps:// URL with a host',
    schema: url(['smtp:', 'smtps:'], (parsed) => parsed.hostname !== ''),
  },
  EMAIL_FROM: {
    group: 'Email',
    note: 'The address emails are sent from',
    expects: 'an email address',
    schema: z.email(),
  },
  AUTH_SECRET: {
    group: 'Sign-in',
    note: "Better Auth's secret for sessions and sign-in tokens",
    expects: 'at least 32 characters, no spaces (openssl rand -base64 32)',
    schema: z.string().min(32).regex(noSpaces),
  },
  APP_URL: {
    group: 'Sign-in',
    note: "The app's base URL, for sign-in and email links",
    expects: 'an http(s) origin, no path or trailing slash',
    schema: url(['http:', 'https:'], (parsed, value) => parsed.origin === value),
  },
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: {
    group: 'Next.js (§14 Deploys)',
    note: 'Encrypts server-action data; fixed across deploys',
    expects: 'a 32-byte key in base64 (openssl rand -base64 32)',
    // Next.js decodes it with atob into an AES-GCM key; 32 bytes are 43 base64 characters and one `=`.
    schema: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  },
  NEXT_DEPLOYMENT_ID: {
    group: 'Next.js (§14 Deploys)',
    note: "The build's id, so open pages survive a deploy",
    expects: 'up to 64 letters, digits, dots, underscores or hyphens',
    schema: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  },
} satisfies Record<string, Setting>;

export type SettingName = keyof typeof settings;

const FILE_STORE = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
] as const;

/** The settings each process holds (§13 What runs, §14 Secrets). A process never sees another's. */
export const processSettings = {
  // Database, file store (signing), auth, email; the Next.js key and deployment id (§14 Deploys).
  web: [
    'DATABASE_URL',
    ...FILE_STORE,
    'SMTP_URL',
    'EMAIL_FROM',
    'AUTH_SECRET',
    'APP_URL',
    'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
    'NEXT_DEPLOYMENT_ID',
  ],
  // Database, file store, email, and the app's base URL for the links in its emails. The Anthropic key arrives in M3.
  worker: ['DATABASE_URL', ...FILE_STORE, 'SMTP_URL', 'EMAIL_FROM', 'APP_URL'],
  // None: the fetcher holds nothing but its token, which arrives in M2.
  fetcher: [],
  // The owner role, which the app never holds.
  migrate: ['DATABASE_OWNER_URL'],
  seed: ['DATABASE_OWNER_URL'],
} as const satisfies Record<string, readonly SettingName[]>;

export type ProcessName = keyof typeof processSettings;

/** A process's settings: only its own, all checked. */
export type Env<P extends ProcessName> = Readonly<
  Record<(typeof processSettings)[P][number], string>
>;

/**
 * Reads and checks a process's settings, once, at startup. Throws one error that names every missing or malformed
 * setting and says what it expects; the error never holds a value, so it's safe to print and log.
 */
export function loadEnv<P extends ProcessName>(
  processName: P,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Env<P> {
  const env: Record<string, string> = {};
  const problems: string[] = [];
  for (const name of processSettings[processName]) {
    const { schema, expects } = settings[name];
    const value = source[name];
    const result = value === undefined || value === '' ? undefined : schema.safeParse(value);
    if (result?.success === true) {
      env[name] = result.data;
    } else {
      problems.push(`  ${name} is ${result ? 'malformed' : 'missing'}: expected ${expects}.`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      [`The ${processName} process can't start. Fix these settings (env.example lists them):`]
        .concat(problems)
        .join('\n'),
    );
  }
  return Object.freeze(env);
}
