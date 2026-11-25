import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.ts';
import { parseEnvFile } from './dev-env.ts';
import {
  APP_URL,
  approvalProblem,
  checksProblem,
  commentId,
  xmlText,
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

const COMMENT = 'https://github.com/picasso-canvas/letzeuspost/issues/81#issuecomment-4242';

describe('parseDeployArgs', () => {
  it('reads a commit, and where Zeus said yes', () => {
    expect(parseDeployArgs(['48a3c91'])).toEqual({ commit: '48a3c91', zeusOk: undefined });
    expect(parseDeployArgs(['48a3c91', '--zeus-ok', ` ${COMMENT} `])).toEqual({
      commit: '48a3c91',
      zeusOk: COMMENT,
    });
  });

  it('refuses a missing or malformed commit, a branch name, a bare --zeus-ok and anything unexpected', () => {
    for (const bad of [
      [],
      ['main'],
      ['xyz'],
      ['--zeus-ok'],
      ['a1b2c3d', '--zeus-ok', 'in chat, today'],
      ['a1b2c3d', '--zeus-ok', 'https://example.com/issues/1#issuecomment-5'],
      ['a1b2c3d', '--zeus-ok', 'https://github.com/o/r/issues/1'],
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

  const required = ['a', 'b'];

  it('passes when every check finished green, skipped ones included', () => {
    expect(
      checksProblem([run('a', 'completed', 'success'), run('b', 'completed', 'skipped')], required),
    ).toBeUndefined();
  });

  it('refuses when a check the gate requires never ran, however green the others are', () => {
    expect(
      checksProblem(
        [run('a', 'completed', 'success'), run('other', 'completed', 'success')],
        required,
      ),
    ).toBe('these required checks never ran: b');
    expect(checksProblem([run('a', 'completed', 'success')], [])).toContain('empty');
  });

  it('names each check that failed or is still running, and refuses a commit with no checks', () => {
    expect(
      checksProblem(
        [
          run('a', 'completed', 'success'),
          run('services', 'completed', 'failure'),
          run('c', 'in_progress', null),
        ],
        ['a'],
      ),
    ).toBe('these checks are not green: services (failure), c (in_progress)');
    expect(checksProblem([], required)).toContain('no checks');
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

describe('commentId', () => {
  it('reads an issue or pull request comment URL, and nothing else', () => {
    expect(commentId(COMMENT)).toBe('4242');
    expect(commentId('https://github.com/o/r/pull/9#issuecomment-7')).toBe('7');
    for (const bad of [
      '',
      'in chat',
      'https://github.com/o/r/issues/1',
      'http://github.com/o/r/issues/1#issuecomment-1',
      'https://github.com.evil.test/o/r/issues/1#issuecomment-1',
    ]) {
      expect(commentId(bad)).toBeUndefined();
    }
  });
});

describe('approvalProblem', () => {
  const commit = '48a3c911f06d9a1b2c3d4e5f60718293a4b5c6d7';
  const repo = 'picasso-canvas/letzeuspost';
  const comment = (over: object = {}) => ({
    body: 'Zeus decided (2026-11-25, in chat): deploy 48a3c91 to the instance.',
    created_at: '2026-11-25T09:00:00Z',
    updated_at: '2026-11-25T09:00:00Z',
    html_url: `https://github.com/${repo}/issues/81#issuecomment-4242`,
    user: { login: 'picasso-canvas' },
    ...over,
  });
  const check = (over: object = {}) =>
    approvalProblem(comment(over), commit, '2026-11-25T03:00:00Z', 'picasso-canvas', repo);

  it('accepts the record of his yes to this commit, posted after it', () => {
    expect(check()).toBeUndefined();
  });

  it('refuses a comment in another repository or by someone else', () => {
    expect(
      check({ html_url: 'https://github.com/evil/letzeuspost/issues/1#issuecomment-1' }),
    ).toContain('not in');
    expect(check({ user: { login: 'someone' } })).toContain('not by picasso-canvas');
  });

  it('refuses text that is not the record of his yes to deploy, or names another commit', () => {
    const format = 'is not a record of the form';
    expect(check({ body: 'deploy 48a3c91, looks fine' })).toContain(format);
    expect(check({ body: 'Zeus decided: merge 48a3c91' })).toContain(format);
    expect(
      check({ body: 'Zeus decided (2026-11-25, in chat): do not deploy 48a3c91 until #383 lands' }),
    ).toContain(format);
    expect(
      check({ body: '> Zeus decided (2026-11-25, in chat): deploy 48a3c91\n\nQuoted by a review' }),
    ).toContain(format);
    expect(
      check({ body: 'Review note, then: Zeus decided (2026-11-25, in chat): deploy 48a3c91' }),
    ).toContain(format);
    expect(check({ body: 'Zeus decided (2026-11-25, in chat): deploy abcdef0' })).toContain(
      'not to the commit 48a3c91',
    );
    expect(check({ body: 'Zeus decided (2026-11-25, in chat): deploy 48a3c9' })).toContain(format); // under 7 characters
  });

  it('accepts the commit named by more than 7 characters, and text after the record', () => {
    expect(
      check({
        body: 'Zeus decided (2026-11-25, in chat): deploy 48a3c911f06d, after #392 merged.',
      }),
    ).toBeUndefined();
  });

  it('refuses a comment edited after it was posted', () => {
    expect(check({ updated_at: '2026-11-25T09:30:00Z' })).toContain('edited');
  });

  it('refuses a yes older than the commit', () => {
    expect(
      check({ created_at: '2026-11-25T02:00:00Z', updated_at: '2026-11-25T02:00:00Z' }),
    ).toContain('older than the commit');
  });
});

describe('xmlText', () => {
  it('escapes what could break out of a plist string', () => {
    expect(xmlText(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
    expect(xmlText('/Users/picasso/letzeuspost-picasso')).toBe(
      '/Users/picasso/letzeuspost-picasso',
    );
  });
});
