// How packages/auth wires Better Auth to the database (#77, decision (a) of 2026-11-10), checked without one:
// Better Auth's adapter is given its own four tables and nothing else, and cookies are Secure wherever the app is
// HTTPS. server.int.test.ts runs the whole thing on Postgres.
import { schema } from '@lzp/db/auth';
import { describe, expect, it } from 'vitest';
import { BETTER_AUTH_TABLES, secureCookiesIn } from './server.ts';
import { createWorkspace } from './workspaces.ts';

describe("Better Auth's adapter", () => {
  it('is given user, session, account and verification alone: never workspace, member or invitation', () => {
    expect(BETTER_AUTH_TABLES).toStrictEqual({
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    });
  });
});

describe('cookies', () => {
  it('are Secure in staging and production, the HTTPS-only places (§14), and not on the Mac or in CI', () => {
    expect(secureCookiesIn('production')).toBe(true);
    expect(secureCookiesIn('staging')).toBe(true);
    expect(secureCookiesIn('development')).toBe(false);
    expect(secureCookiesIn('ci')).toBe(false);
  });
});

describe('createWorkspace', () => {
  const never = {
    forWorkspace: () => {
      throw new Error('the database was reached');
    },
  };
  const owner = { userId: '01970000-0000-7000-8000-000000000001' };

  it.each([
    ['an empty name', { name: '  ', slug: 'picasso' }],
    ['a name over 200 characters', { name: 'a'.repeat(201), slug: 'picasso' }],
    ['a slug with capitals', { name: 'Picasso', slug: 'Picasso' }],
    ['a slug with spaces', { name: 'Picasso', slug: 'picasso studio' }],
    ['an empty slug', { name: 'Picasso', slug: '' }],
    ['a slug over 63 characters', { name: 'Picasso', slug: 'a'.repeat(64) }],
  ])('refuses %s before reaching the database', async (_, input) => {
    await expect(createWorkspace(never, owner, input)).rejects.toThrow(/workspace/);
  });

  it('makes the id itself, a UUIDv7, and sets the unit of work to it', async () => {
    const seen: string[] = [];
    const recorder = {
      forWorkspace: (ctx: { workspaceId: string }) => {
        seen.push(ctx.workspaceId);
        return { transaction: () => Promise.resolve(undefined as never) };
      },
    };
    const { id } = await createWorkspace(recorder, owner, { name: 'গল্প ক্যাফে', slug: 'golpo' });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seen).toEqual([id]);
  });
});
