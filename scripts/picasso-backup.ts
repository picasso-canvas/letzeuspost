#!/usr/bin/env node
// Picasso's nightly backup and the restore test (§18, #81). Self-contained on purpose (node built-ins only): `picasso.ts
// install-backup` copies this one file into the instance's folder, outside the repo, and launchd runs the copy, so a
// checkout on any branch can't change what runs at night.
//   node picasso-backup.ts backup         dump the database to <folder>/backups, keep 14 days
//   node picasso-backup.ts restore-test   dump, restore into a scratch database, compare every table's rows, drop it
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const KEEP_DAYS = 14;
const NAME = /^letzeuspost-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.dump$/;
const PROJECT = 'letzeuspost-picasso';
const DATABASE = 'letzeuspost';
const SCRATCH = 'lzp_restore_test';

/** `letzeuspost-2026-11-25T03-00-00Z.dump`: sorts by time, and carries it. */
export function backupName(now: Date): string {
  return `letzeuspost-${now.toISOString().slice(0, 19).replaceAll(':', '-')}Z.dump`;
}

function takenAt(name: string): number | undefined {
  const m = NAME.exec(name);
  if (m === null) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * The backups to delete: ones older than `keepDays`. Files that aren't ours are never listed, and the newest backup is
 * kept however old it is (a Mac that was off for weeks still has its last dump).
 */
export function backupsToDelete(
  names: readonly string[],
  now: Date,
  keepDays = KEEP_DAYS,
): string[] {
  const dumps = names.filter((name) => takenAt(name) !== undefined).sort();
  const newest = dumps.at(-1);
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  return dumps.filter((name) => name !== newest && (takenAt(name) ?? Infinity) < cutoff);
}

function docker(
  args: string[],
  input?: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function postgresContainer(): string {
  const { stdout } = docker([
    'ps',
    '--quiet',
    '--filter',
    `label=com.docker.compose.project=${PROJECT}`,
    '--filter',
    'label=com.docker.compose.service=postgres',
  ]);
  const id = stdout.trim().split('\n')[0] ?? '';
  if (id === '') throw new Error(`The ${PROJECT} database isn't running: nothing to back up.`);
  return id;
}

const instance = () =>
  resolve(process.env.LZP_PICASSO_DIR ?? join(homedir(), 'letzeuspost-picasso'));

/** Dumps the database (custom format) next to the older ones, then deletes what is past 14 days. Returns the path. */
export function backup(now = new Date()): string {
  const dir = join(instance(), 'backups');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, backupName(now));
  const partial = `${target}.partial`;
  const dump = spawnSync(
    'docker',
    [
      'exec',
      postgresContainer(),
      'pg_dump',
      '--username',
      'lzp_superuser',
      '--format',
      'custom',
      '--dbname',
      DATABASE,
    ],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (dump.status !== 0 || dump.stdout.length === 0) {
    throw new Error(`pg_dump failed: ${dump.stderr.toString().trim().slice(0, 300)}`);
  }
  // Written under another name and renamed, so a half-written dump is never taken for a backup.
  writeFileSync(partial, dump.stdout, { mode: 0o600 });
  chmodSync(partial, 0o600);
  renameSync(partial, target);
  for (const old of backupsToDelete(readdirSync(dir), now)) unlinkSync(join(dir, old));
  return target;
}

const COUNTS = `select table_schema || '.' || table_name || ' ' ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
  order by 1`;

/** Restores a fresh dump into a scratch database, compares the rows of every table with the live one, drops it. */
export function restoreTest(): string {
  const dumpPath = backup(); // a real backup, so it also prunes the old ones, as the nightly run does
  const id = postgresContainer();
  const psql = (db: string, sql: string) =>
    docker([
      'exec',
      id,
      'psql',
      '--username',
      'lzp_superuser',
      '--dbname',
      db,
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set',
      'ON_ERROR_STOP=1',
      '--command',
      sql,
    ]);
  psql('postgres', `drop database if exists ${SCRATCH}`);
  const created = psql('postgres', `create database ${SCRATCH}`);
  if (created.status !== 0)
    throw new Error(`Couldn't create the scratch database: ${created.stderr.trim()}`);
  try {
    const dump = spawnSync('cat', [dumpPath], { maxBuffer: 1024 * 1024 * 1024 });
    const restored = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        id,
        'pg_restore',
        '--username',
        'lzp_superuser',
        '--dbname',
        SCRATCH,
        '--no-owner',
        '--exit-on-error',
      ],
      { input: dump.stdout, maxBuffer: 64 * 1024 * 1024 },
    );
    if (restored.status !== 0)
      throw new Error(`pg_restore failed: ${restored.stderr.toString().trim().slice(0, 300)}`);
    const live = psql(DATABASE, COUNTS).stdout.trim();
    const copy = psql(SCRATCH, COUNTS).stdout.trim();
    if (live === '' || live !== copy) {
      throw new Error(
        `The restored copy differs from the live database.\nlive:\n${live}\nrestored:\n${copy}`,
      );
    }
    return `Restored ${dumpPath} into ${SCRATCH}: ${String(live.split('\n').length)} tables, every row count equal.`;
  } finally {
    psql('postgres', `drop database if exists ${SCRATCH}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const command = process.argv[2];
    if (command === 'backup') console.log(`Backed up to ${backup()}`);
    else if (command === 'restore-test') console.log(restoreTest());
    else throw new Error('Usage: picasso-backup.ts backup | restore-test');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
