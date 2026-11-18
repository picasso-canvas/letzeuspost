// Workspaces for a journey test: a run's own workspaces and people, made with the seeds' code (the owner role, as
// `seed:dev` runs) and removed again. Nothing else writes to the database in the Workspaces journey: everything after
// this is the app's own flow (the sign-in link, the switcher, the avatar menu).
import { randomUUIDv7 } from 'node:crypto';
import { loadEnv } from '../../config/env.ts';
import { createDb } from '../../packages/db/src/index.ts';
import { runSeed } from '../../packages/db/src/seed/run.ts';
import type { Seed } from '../../packages/db/src/seed/seed.ts';

/** A list of values as quoted SQL literals; every value is one the test made (as tests/lib/sign-in.ts's `text`). */
const literals = (values: readonly string[]) =>
  values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');

/**
 * Makes each seed's workspace and people (a person in two seeds is one account with two memberships: a seed adds what
 * is missing). Returns a function that removes them again: the workspaces by slug, the people by address; their
 * memberships and sessions go with them (cascades).
 */
export async function createWorkspaces(seeds: readonly Seed[]) {
  const ownerUrl = loadEnv('migrate').DATABASE_OWNER_URL;
  for (const seed of seeds) await runSeed(ownerUrl, seed);
  const slugs = seeds.map((seed) => seed.workspace.slug);
  const emails = [...new Set(seeds.flatMap((seed) => seed.people.map((person) => person.email)))];
  return async () => {
    const owner = createDb(ownerUrl);
    try {
      // The owner role isn't bound by row-level security; `forWorkspace` is the one door in, and any id will do.
      const through = owner.forWorkspace({ workspaceId: randomUUIDv7() });
      await through.transaction(async (tx) => {
        await tx.execute(`delete from workspace where slug in (${literals(slugs)})`);
        await tx.execute(`delete from "user" where email in (${literals(emails)})`);
      });
    } finally {
      await owner.close();
    }
  };
}
