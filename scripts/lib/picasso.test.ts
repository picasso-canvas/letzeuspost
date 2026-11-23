import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { parseEnvFile } from './dev-env.ts';
import {
  APP_URL,
  checksProblem,
  dirProblem,
  imageTag,
  instanceDir,
  mergedHead,
  parseDeployArgs,
  picassoEnvText,
} from './picasso.ts';

let n = 0;
const randomBytes = (size: number) =>
  Uint8Array.from({ length: size }, (_, i) => (++n + i * 7) % 256);

describe('picassoEnvText', () => {
  it('holds every setting the four processes read, each passing its own check', () => {
    const env = { ...parseEnvFile(picassoEnvText(randomBytes)), NEXT_DEPLOYMENT_ID: 'abc123' };
    for (const name of ['web', 'worker', 'migrate', 'seed'] as const) {
      expect(() => loadEnv(name, env)).not.toThrow();
    }
  });

  it("points at the project's own services and the OrbStack address, with no host port", () => {
    const env = parseEnvFile(picassoEnvText(randomBytes));
    expect(env.APP_URL).toBe(APP_URL);
    expect(APP_URL).toBe('https://web.letzeuspost-picasso.orb.local');
    expect(env.DATABASE_URL).toContain('@postgres:5432/');
    expect(env.SMTP_URL).toBe('smtp://mail:1025');
    expect(env.STORAGE_ENDPOINT).toBe('http://storage:8333');
    expect(env.LZP_ENV).toBe('development');
  });

  it('uses the three database passwords in the two urls, and never the same secret twice', () => {
    const env = parseEnvFile(picassoEnvText(randomBytes));
    expect(env.DATABASE_URL).toContain(`lzp_app:${env.LZP_PG_APP_PASSWORD ?? '?'}@`);
    expect(env.DATABASE_OWNER_URL).toContain(`lzp_owner:${env.LZP_PG_OWNER_PASSWORD ?? '?'}@`);
    const secrets = [
      'LZP_PG_SUPERUSER_PASSWORD',
      'LZP_PG_OWNER_PASSWORD',
      'LZP_PG_APP_PASSWORD',
      'AUTH_SECRET',
    ].map((name) => env[name]);
    expect(new Set(secrets).size).toBe(secrets.length);
  });
});

describe('instanceDir and dirProblem', () => {
  it('defaults to ~/letzeuspost-picasso and takes LZP_PICASSO_DIR', () => {
    expect(instanceDir({}, '/Users/z')).toBe('/Users/z/letzeuspost-picasso');
    expect(instanceDir({ LZP_PICASSO_DIR: '/data/pic' }, '/Users/z')).toBe('/data/pic');
    expect(instanceDir({ LZP_PICASSO_DIR: '' }, '/Users/z')).toBe('/Users/z/letzeuspost-picasso');
  });

  it('refuses a folder inside the checkout or a builder clone, and accepts one beside them', () => {
    const repo = '/Users/z/Developer/letzeuspost';
    const builders = '/Users/z/letzeuspost-builders';
    expect(dirProblem('/Users/z/letzeuspost-picasso', repo, builders)).toBeUndefined();
    expect(dirProblem(`${repo}/secrets`, repo, builders)).toContain('this checkout');
    expect(dirProblem(repo, repo, builders)).toContain('this checkout');
    expect(dirProblem(`${builders}/123-x/.picasso`, repo, builders)).toContain("builders' clones");
    expect(dirProblem('/Users/z/letzeuspost-picasso-two', repo, builders)).toBeUndefined();
  });
});

describe('parseDeployArgs', () => {
  it('reads a commit, and where Zeus said yes', () => {
    expect(parseDeployArgs(['48a3c91'])).toEqual({ commit: '48a3c91', zeusOk: undefined });
    expect(parseDeployArgs(['48a3c91', '--zeus-ok', ' in chat, 2026-11-25 '])).toEqual({
      commit: '48a3c91',
      zeusOk: 'in chat, 2026-11-25',
    });
  });

  it('refuses a missing or malformed commit, a branch name, a bare --zeus-ok and anything unexpected', () => {
    for (const bad of [
      [],
      ['main'],
      ['xyz'],
      ['--zeus-ok'],
      ['a1b2c3d', '--zeus-ok', 'yes'],
      ['a1b2c3d', 'e4f5a6b'],
      ['a1b2c3d', '--force'],
    ]) {
      expect(typeof parseDeployArgs(bad)).toBe('string');
    }
  });
});

describe('checksProblem', () => {
  const run = (name: string, status: string, conclusion: string | null) => ({
    name,
    status,
    conclusion,
  });

  it('passes when every check finished green, skipped ones included', () => {
    expect(
      checksProblem([run('a', 'completed', 'success'), run('b', 'completed', 'skipped')]),
    ).toBeUndefined();
  });

  it('names each check that failed or is still running, and refuses a commit with no checks', () => {
    expect(
      checksProblem([
        run('a', 'completed', 'success'),
        run('services', 'completed', 'failure'),
        run('c', 'in_progress', null),
      ]),
    ).toBe('these checks are not green: services (failure), c (in_progress)');
    expect(checksProblem([])).toContain('no checks');
  });
});

describe('imageTag', () => {
  it('is the first 12 characters, lowercase', () => {
    expect(imageTag('48A3C911F06D9a1b2c3d4e5f60718293a4b5c6d7')).toBe('48a3c911f06d');
  });
});

describe('mergedHead', () => {
  const pull = (over: object) => ({
    number: 391,
    merge_commit_sha: '48a3c911f06d',
    merged_at: '2026-11-25T03:00:00Z',
    head: { sha: 'headsha' },
    base: { ref: 'main' },
    ...over,
  });

  it('is the pull request that merged this very commit into main', () => {
    expect(
      mergedHead([pull({ number: 1, merge_commit_sha: 'other' }), pull({})], '48a3c911f06d')
        ?.number,
    ).toBe(391);
  });

  it('is nothing for a PR that is not merged, merged elsewhere, or merged as a different commit', () => {
    expect(mergedHead([pull({ merged_at: null })], '48a3c911f06d')).toBeUndefined();
    expect(mergedHead([pull({ base: { ref: 'staging' } })], '48a3c911f06d')).toBeUndefined();
    expect(mergedHead([pull({})], 'deadbeef')).toBeUndefined();
    expect(mergedHead([], '48a3c911f06d')).toBeUndefined();
  });
});
