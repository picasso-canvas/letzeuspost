import { describe, expect, it } from 'vitest';
import { getLook, registerLook } from './looks.ts';
import { TEST_LOOK } from './test-fixtures.ts';

describe('the look registry', () => {
  it('has no look before one registers itself', () => {
    expect(getLook('bold')).toBeUndefined();
  });

  it('keeps a look that registers itself', () => {
    registerLook({ ...TEST_LOOK, name: 'editorial' });
    expect(getLook('editorial')).toEqual({ ...TEST_LOOK, name: 'editorial' });
  });

  it('refuses a second look of the same name: two files would fight over one look', () => {
    registerLook({ ...TEST_LOOK, name: 'playful' });
    expect(() => {
      registerLook({ ...TEST_LOOK, name: 'playful', version: 9 });
    }).toThrow(/playful/);
    expect(getLook('playful')?.version).toBe(TEST_LOOK.version);
  });

  it('refuses a look that is not print-safe, before it can reach a page', () => {
    expect(() => {
      registerLook({ ...TEST_LOOK, name: 'bold', css: '.a { filter: blur(1px) }' });
    }).toThrow();
    expect(getLook('bold')).toBeUndefined();
  });
});
