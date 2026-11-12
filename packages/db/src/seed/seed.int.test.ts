// The seeds on Postgres (#79, Q14), in `pnpm check:services` and CI's `services` job, as the owner role, which is the
// only role that may set the platform-admin flag. Each run's workspace has a slug of its own, so the test never meets a
// real "Picasso Studio" in the database it runs on, and every row it makes is removed at the end.
import { randomUUID } from 'node:crypto';
import { loadEnv } from '@lzp/config';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPool } from '../db.ts';
import { migrate } from '../migrate.ts';
import { devSeed, seedWorkspace, studioSeed, type Seed } from './seed.ts';

const { DATABASE_OWNER_URL: ownerUrl } = loadEnv('seed');
const run = randomUUID().slice(0, 8);
const pool = openPool(ownerUrl);
const orm = drizzle({ client: pool });

const studio: Seed = {
  ...studioSeed({ email: `zeus-${run}@seed.invalid`, name: 'Zeus' }),
  workspace: { name: 'Picasso Studio', slug: `picasso-studio-${run}` },
};
const dev: Seed = {
  workspace: { name: 'Northwind Social', slug: `northwind-social-${run}` },
  people: devSeed().people.map((person) => ({
    ...person,
    email: person.email.replace('@', `-${run}@`),
  })),
};

/** Everything the seed touches for one workspace: its row, its members, and its people's rows. */
async function snapshot(seed: Seed) {
  const emails = seed.people.map((person) => person.email);
  const { rows: workspaces } = await orm.execute(
    sql`select * from workspace where slug = ${seed.workspace.slug}`,
  );
  const { rows: members } = await orm.execute(
    sql`select m.*, u.email from member m join workspace w on w.id = m.workspace_id join "user" u on u.id = m.user_id
        where w.slug = ${seed.workspace.slug} order by u.email`,
  );
  const { rows: people } = await orm.execute(
    sql`select * from "user" where email in ${emails} order by email`,
  );
  return { workspaces, members, people };
}

beforeAll(async () => {
  await migrate(ownerUrl);
});

afterAll(async () => {
  for (const seed of [studio, dev]) {
    await orm.execute(sql`delete from workspace where slug = ${seed.workspace.slug}`);
    await orm.execute(sql`delete from "user" where email in ${seed.people.map((p) => p.email)}`);
  }
  await pool.end();
});

describe('seed:studio', () => {
  it('creates the workspace and Zeus’s account as its only Owner, with the platform-admin flag', async () => {
    expect(await seedWorkspace(orm, studio)).toEqual({ changed: true });
    const { workspaces, members, people } = await snapshot(studio);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ name: 'Picasso Studio', slug: studio.workspace.slug });
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({
      email: studio.people[0]?.email,
      name: 'Zeus',
      is_platform_admin: true,
    });
    expect(members.map((m) => [m['email'], m['role']])).toEqual([
      [studio.people[0]?.email, 'owner'],
    ]);
  });

  it('changes nothing on a second run', async () => {
    const before = await snapshot(studio);
    expect(await seedWorkspace(orm, studio)).toEqual({ changed: false });
    expect(await snapshot(studio)).toEqual(before);
  });

  it('refuses a workspace that already has another Owner, and changes nothing', async () => {
    const intruder: Seed = {
      ...studio,
      people: [
        { ...studio.people[0], email: `other-${run}@seed.invalid` } as Seed['people'][number],
      ],
    };
    const before = await snapshot(studio);
    await expect(seedWorkspace(orm, intruder)).rejects.toThrow(/Owner/);
    expect(await snapshot(studio)).toEqual(before);
    const { rows } = await orm.execute(
      sql`select 1 from "user" where email = ${`other-${run}@seed.invalid`}`,
    );
    expect(rows).toEqual([]);
  });
});

describe('seed:dev', () => {
  it('creates Northwind Social with an owner and an editor, and a second run changes nothing', async () => {
    expect(await seedWorkspace(orm, dev)).toEqual({ changed: true });
    const first = await snapshot(dev);
    expect(first.workspaces[0]).toMatchObject({ name: 'Northwind Social' });
    expect(first.members.map((m) => m['role']).sort()).toEqual(['editor', 'owner']);
    expect(first.people.every((p) => p['is_platform_admin'] === false)).toBe(true);
    expect(await seedWorkspace(orm, dev)).toEqual({ changed: false });
    expect(await snapshot(dev)).toEqual(first);
  });
});
