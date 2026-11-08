import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderEnvExample } from './env-example.ts';
import { settings } from './env.ts';

const committed = readFileSync(new URL('../env.example', import.meta.url), 'utf8');
const lines = renderEnvExample().split('\n');
const names = Object.keys(settings);

/** The comment line right above a setting's `NAME=` line. */
function noteFor(name: string): string | undefined {
  return lines[lines.indexOf(`${name}=`) - 1];
}

describe('env.example', () => {
  it('is up to date with config/env.ts', () => {
    expect(committed, 'env.example is out of date: run `node config/env-example.ts`').toBe(
      renderEnvExample(),
    );
  });

  it('lists every setting once, with no value', () => {
    const assignments = lines.filter((line) => line !== '' && !line.startsWith('#'));
    expect(assignments).toEqual(names.map((name) => `${name}=`));
  });

  it.each(names)('has a short note right above %s', (name) => {
    expect(noteFor(name)).toMatch(/^# \S.{9,}$/);
    expect(noteFor(name)?.length).toBeLessThanOrEqual(130);
  });

  it('says which processes read each setting', () => {
    expect(noteFor('DATABASE_OWNER_URL')).toMatch(/Read by migrate, seed\.$/);
    expect(noteFor('AUTH_SECRET')).toMatch(/Read by web\.$/);
    expect(noteFor('DATABASE_URL')).toMatch(/Read by web, worker\.$/);
  });
});
