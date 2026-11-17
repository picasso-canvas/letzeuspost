// The seeds (#79, Q14 of 2026-11-07): `seed:studio` makes the studio's workspace, "Picasso Studio", with Zeus as its
// only Owner and the platform-admin flag (§13 Data model, §18 Picasso first); `seed:dev` makes Northwind Social, the
// fictional agency of §17's test data, with an owner and an editor (its 3 brands wait for M2).
//
// They run as the owner role (config/env.ts's `seed` process: DATABASE_OWNER_URL), the only role that may set
// `user.is_platform_admin` (0000_accounts.sql's grant and trigger). Zeus's address is typed in when the seed runs and
// never stored in the repository (Q14). A seed only adds what is missing: a second run changes nothing.
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { member, user, workspace, type roles } from '../schema/accounts.ts';

export interface SeedPerson {
  readonly email: string;
  readonly name: string;
  readonly role: (typeof roles)[number];
  readonly platformAdmin: boolean;
}

/** A workspace and its people, the first of whom is its Owner. */
export interface Seed {
  readonly workspace: { readonly name: string; readonly slug: string };
  readonly people: readonly SeedPerson[];
}

/** The studio's workspace (Q14). */
export const STUDIO_WORKSPACE = Object.freeze({ name: 'Picasso Studio', slug: 'picasso-studio' });

/** What `seed:studio` is given at run time: Better Auth keeps addresses trimmed and lowercase, so they are here too. */
const studioInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  name: z.string().trim().min(1).max(200),
});

/** `seed:studio`'s plan, from the address and name typed in when it runs. */
export function studioSeed(input: { email: string; name: string }): Seed {
  const parsed = studioInput.safeParse(input);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`seed:studio: refused: a valid ${fields.join(' and ')} is needed`);
  }
  return {
    workspace: { ...STUDIO_WORKSPACE },
    people: [{ ...parsed.data, role: 'owner', platformAdmin: true }],
  };
}

/**
 * `seed:dev`'s plan: Northwind Social (§17), its owner and an editor. Fictional people on `.invalid` addresses, which
 * no mail server delivers to; in development and CI, Mailpit catches what is sent to them.
 */
export function devSeed(): Seed {
  return {
    workspace: { name: 'Northwind Social', slug: 'northwind-social' },
    people: [
      {
        email: 'nadia@northwind.invalid',
        name: 'Nadia Karim',
        role: 'owner',
        platformAdmin: false,
      },
      {
        email: 'tanvir@northwind.invalid',
        name: 'Tanvir Rahman',
        role: 'editor',
        platformAdmin: false,
      },
    ],
  };
}

/** Northwind Social is for development and tests (Q14): it never goes into production. */
export function refuseDevSeedIn(environment: string): void {
  if (environment === 'production') {
    throw new Error(
      'seed:dev: refused: the sample agency is for development and tests, not production',
    );
  }
}

/** One key for both seeds' advisory lock, so two runs at once take turns. */
const SEED_LOCK = 79;

/**
 * Adds what `seed` describes and is missing, in one transaction, and says whether it changed anything. A workspace
 * that already has another Owner is refused, and the transaction leaves everything as it was.
 */
export function seedWorkspace(orm: NodePgDatabase, seed: Seed): Promise<{ changed: boolean }> {
  const [owner] = seed.people;
  if (owner?.role !== 'owner') throw new Error('seed: refused: the first person must be the Owner');
  return orm.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK})`);
    let changed = false;

    const people: { id: string; role: SeedPerson['role'] }[] = [];
    for (const person of seed.people) {
      const added = await tx
        .insert(user)
        .values({ email: person.email, name: person.name, isPlatformAdmin: person.platformAdmin })
        .onConflictDoNothing({ target: user.email })
        .returning({ id: user.id });
      changed ||= added.length > 0;
      if (person.platformAdmin) {
        // Someone who has an account already gets the flag; one who has it is left alone.
        const flagged = await tx
          .update(user)
          .set({ isPlatformAdmin: true })
          .where(and(eq(user.email, person.email), eq(user.isPlatformAdmin, false)))
          .returning({ id: user.id });
        changed ||= flagged.length > 0;
      }
      const [found] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, person.email));
      if (found === undefined) throw new Error('seed: a person was neither found nor added');
      people.push({ id: found.id, role: person.role });
    }

    const addedWorkspace = await tx
      .insert(workspace)
      .values(seed.workspace)
      .onConflictDoNothing({ target: workspace.slug })
      .returning({ id: workspace.id });
    changed ||= addedWorkspace.length > 0;
    const [place] = await tx
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.slug, seed.workspace.slug));
    if (place === undefined) throw new Error('seed: the workspace was neither found nor added');

    // Its Owner first: a workspace with another Owner is refused before anyone is added to it (§15: exactly one).
    const owners = await tx
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.workspaceId, place.id), eq(member.role, 'owner')));
    const ownerId = people[0]?.id;
    if (ownerId === undefined) throw new Error('seed: refused: no Owner');
    if (owners.some((each) => each.userId !== ownerId)) {
      throw new Error(`seed: refused: ${seed.workspace.name} already has another Owner`);
    }

    const memberships = await tx
      .insert(member)
      .values(
        people.map((person) => ({ workspaceId: place.id, userId: person.id, role: person.role })),
      )
      .onConflictDoNothing({ target: [member.workspaceId, member.userId] })
      .returning({ id: member.id });
    changed ||= memberships.length > 0;

    // The Owner may have been a member already with another role; then the seed can't make them its Owner.
    const [isOwner] = await tx
      .select({ id: member.id })
      .from(member)
      .where(
        and(eq(member.workspaceId, place.id), eq(member.userId, ownerId), eq(member.role, 'owner')),
      );
    if (isOwner === undefined) {
      throw new Error(
        `seed: refused: ${owner.name} is a member of ${seed.workspace.name} but not its Owner`,
      );
    }
    return { changed };
  });
}
