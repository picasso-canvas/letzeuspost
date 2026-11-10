import { describe, expect, it } from 'vitest';
import { ACTIONS, PERMISSION_MATRIX, ROLES } from './matrix.ts';

describe('PERMISSION_MATRIX', () => {
  it("has §15's five columns, in its order", () => {
    expect(ROLES).toEqual(['owner', 'admin', 'editor', 'viewer', 'client-reviewer']);
  });

  it("has §15's 22 rows: 8 for the workspace, 5 for brands, 9 for posts", () => {
    expect(ACTIONS).toHaveLength(22);
  });

  it('is one table: every row × the five roles, and nothing more', () => {
    expect(Object.keys(PERMISSION_MATRIX)).toEqual(ACTIONS);
    for (const action of ACTIONS) {
      expect(Object.keys(PERMISSION_MATRIX[action])).toEqual(ROLES);
    }
  });

  it('gives `sent-posts` to the client reviewer only; members are allowed or refused outright', () => {
    for (const action of ACTIONS) {
      for (const role of ROLES) {
        const cell = PERMISSION_MATRIX[action][role];
        expect(role === 'client-reviewer' ? ['yes', 'no', 'sent-posts'] : ['yes', 'no']).toContain(
          cell,
        );
      }
    }
  });

  it("can't be changed while the app runs", () => {
    expect(Object.isFrozen(PERMISSION_MATRIX)).toBe(true);
    for (const action of ACTIONS) {
      expect(Object.isFrozen(PERMISSION_MATRIX[action])).toBe(true);
    }
  });
});
