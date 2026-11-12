import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { roles } from '../schema/accounts.ts';

export interface SeedPerson {
  readonly email: string;
  readonly name: string;
  readonly role: (typeof roles)[number];
  readonly platformAdmin: boolean;
}

export interface Seed {
  readonly workspace: { readonly name: string; readonly slug: string };
  readonly people: readonly SeedPerson[];
}

export const STUDIO_WORKSPACE = { name: '', slug: '' };

export function studioSeed(input: { email: string; name: string }): Seed {
  void input;
  throw new Error('not yet');
}

export function devSeed(): Seed {
  throw new Error('not yet');
}

export function refuseDevSeedIn(environment: string): void {
  void environment;
}

export function seedWorkspace(orm: NodePgDatabase, seed: Seed): Promise<{ changed: boolean }> {
  void orm;
  void seed;
  return Promise.reject(new Error('not yet'));
}
