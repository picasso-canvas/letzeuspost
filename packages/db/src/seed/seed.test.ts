// The seeds' plans, checked without a database (#79, Q14): the studio's workspace with Zeus as its only Owner and the
// platform-admin flag, from the values typed when it runs; Northwind Social with an owner and an editor, for
// development and tests. seed.int.test.ts runs them on Postgres, twice.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { devSeed, refuseDevSeedIn, studioSeed, STUDIO_WORKSPACE } from './seed.ts';

describe('studioSeed', () => {
  it('is Picasso Studio, with the person typed in as its only Owner and the platform-admin flag', () => {
    expect(studioSeed({ email: 'zeus@example.invalid', name: 'Zeus' })).toEqual({
      workspace: { name: 'Picasso Studio', slug: 'picasso-studio' },
      people: [{ email: 'zeus@example.invalid', name: 'Zeus', role: 'owner', platformAdmin: true }],
    });
    expect(STUDIO_WORKSPACE).toEqual({ name: 'Picasso Studio', slug: 'picasso-studio' });
  });

  it('keeps the address as Better Auth stores it: trimmed and lowercase', () => {
    const { people } = studioSeed({ email: '  Zeus@Example.INVALID ', name: '  Zeus ' });
    expect(people[0]).toMatchObject({ email: 'zeus@example.invalid', name: 'Zeus' });
  });

  it.each([
    ['no address', { email: '', name: 'Zeus' }],
    ['something that isn’t an address', { email: 'zeus', name: 'Zeus' }],
    ['no name', { email: 'zeus@example.invalid', name: '  ' }],
    ['a name over 200 characters', { email: 'zeus@example.invalid', name: 'z'.repeat(201) }],
  ])('refuses %s', (_, input) => {
    expect(() => studioSeed(input)).toThrow(/seed:studio/);
  });

  it('stores no address in the repository: the seed files hold none but the dev samples’', () => {
    const dir = new URL('.', import.meta.url);
    const addresses = readdirSync(dir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap(
        (file) =>
          readFileSync(new URL(file, dir), 'utf8').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [],
      );
    // Northwind's people, and the client reviewers in its sample brands' kits (#411): all on `.invalid`.
    const samples = ['@northwind.invalid', '@golpo.invalid', '@brightwell.invalid'];
    expect(addresses.filter((address) => !samples.some((end) => address.endsWith(end)))).toEqual(
      [],
    );
  });
});

describe('devSeed', () => {
  it('is Northwind Social with an owner and an editor, on addresses that can’t reach anyone', () => {
    const seed = devSeed();
    expect(seed.workspace).toEqual({ name: 'Northwind Social', slug: 'northwind-social' });
    expect(seed.people.map(({ role }) => role)).toEqual(['owner', 'editor']);
    for (const person of seed.people) {
      expect(person.email).toMatch(/@northwind\.invalid$/);
      expect(person.platformAdmin).toBe(false);
    }
  });

  it('is for development and tests only: refused in production', () => {
    expect(() => {
      refuseDevSeedIn('production');
    }).toThrow(/seed:dev/);
    for (const where of ['development', 'ci', 'staging']) {
      expect(() => {
        refuseDevSeedIn(where);
      }).not.toThrow();
    }
  });
});
