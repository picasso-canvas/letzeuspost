import { describe, expect, it } from 'vitest';
import { can, type PermissionCheck } from './can.ts';
import { ACTIONS, ROLES, type Action, type Role } from './matrix.ts';

const WORKSPACE = '0190f5c2-6c4b-7d1e-8a3f-2b9c4d5e6f70';
const OTHER_WORKSPACE = '0190f5c2-6c4b-7d1e-8a3f-2b9c4d5e6f71';
const BRAND = '0190f5c2-7a10-7b2c-9d3e-4f5a6b7c8d90';
const OTHER_BRAND = '0190f5c2-7a10-7b2c-9d3e-4f5a6b7c8d91';

/**
 * §15's "Who can do what", written out again here by hand, so the table in matrix.ts is checked against the plan and
 * not against itself. A role left out of a row is refused. `sent-posts`: the client reviewer, only on the posts sent
 * to their review link (§15 "only the posts sent to them", "on sent posts"; §11 and §13: the link's page shows only
 * the posts sent, and approving or requesting changes happens there).
 */
const SECTION_15: Record<Action, Partial<Record<Role, 'yes' | 'sent-posts'>>> = {
  // Workspace
  'see-workspace': {
    owner: 'yes',
    admin: 'yes',
    editor: 'yes',
    viewer: 'yes',
    'client-reviewer': 'sent-posts',
  },
  'edit-workspace-settings': { owner: 'yes', admin: 'yes' },
  'manage-editors-and-viewers': { owner: 'yes', admin: 'yes' },
  'manage-admins': { owner: 'yes' },
  'manage-billing': { owner: 'yes' },
  'hand-over-or-delete-workspace': { owner: 'yes' },
  'see-usage': { owner: 'yes', admin: 'yes', editor: 'yes', viewer: 'yes' },
  'see-support-log': { owner: 'yes', admin: 'yes' },
  // Brands
  'edit-brands': { owner: 'yes', admin: 'yes', editor: 'yes' },
  'approve-client-photos': { owner: 'yes', admin: 'yes', editor: 'yes' },
  'set-approval-mode': { owner: 'yes', admin: 'yes' },
  'edit-brand-reviewers': { owner: 'yes', admin: 'yes', editor: 'yes' },
  'delete-brand': { owner: 'yes', admin: 'yes' },
  // Posts
  'make-posts': { owner: 'yes', admin: 'yes', editor: 'yes' },
  'confirm-claims-and-consent': { owner: 'yes', admin: 'yes', editor: 'yes' },
  'approve-for-agency': { owner: 'yes', admin: 'yes', editor: 'yes' },
  'send-to-client': { owner: 'yes', admin: 'yes', editor: 'yes' },
  'approve-on-clients-behalf': { owner: 'yes', admin: 'yes' },
  comment: {
    owner: 'yes',
    admin: 'yes',
    editor: 'yes',
    viewer: 'yes',
    'client-reviewer': 'sent-posts',
  },
  'review-as-client': { 'client-reviewer': 'sent-posts' },
  'send-photos': { 'client-reviewer': 'yes' },
  export: { owner: 'yes', admin: 'yes', editor: 'yes' },
};

const CELLS = ACTIONS.flatMap((action) =>
  ROLES.map((role) => ({ action, role, expected: SECTION_15[action][role] ?? 'no' })),
);

function check(role: Role, action: Action, more: Partial<PermissionCheck> = {}): boolean {
  return can({ role, action, workspaceId: WORKSPACE, brandId: BRAND, ...more });
}

describe('can: every cell of §15, allowed', () => {
  it.each(CELLS.filter((cell) => cell.expected === 'yes'))(
    'lets the $role $action',
    ({ role, action }) => {
      expect(check(role, action)).toBe(true);
      expect(check(role, action, { sentToReviewer: false })).toBe(true);
    },
  );
});

describe('can: every cell of §15, refused', () => {
  it.each(CELLS.filter((cell) => cell.expected === 'no'))(
    'refuses the $role $action, even on a post sent to a reviewer',
    ({ role, action }) => {
      expect(check(role, action)).toBe(false);
      expect(check(role, action, { sentToReviewer: true })).toBe(false);
    },
  );
});

describe('can: every cell of §15, only on the posts sent to the client reviewer', () => {
  it.each(CELLS.filter((cell) => cell.expected === 'sent-posts'))(
    'lets the $role $action on a sent post and refuses it otherwise',
    ({ role, action }) => {
      expect(check(role, action, { sentToReviewer: true })).toBe(true);
      expect(check(role, action, { sentToReviewer: false })).toBe(false);
      expect(check(role, action)).toBe(false);
    },
  );
});

describe('can: the client reviewer (by link)', () => {
  const reviewer = (action: Action, sentToReviewer?: boolean): boolean =>
    check('client-reviewer', action, sentToReviewer === undefined ? {} : { sentToReviewer });

  it('sees only the posts sent to them', () => {
    expect(reviewer('see-workspace', true)).toBe(true);
    expect(reviewer('see-workspace', false)).toBe(false);
  });

  it('comments on sent posts only', () => {
    expect(reviewer('comment', true)).toBe(true);
    expect(reviewer('comment', false)).toBe(false);
  });

  it('approves or requests changes as the client, on sent posts only', () => {
    expect(reviewer('review-as-client', true)).toBe(true);
    expect(reviewer('review-as-client', false)).toBe(false);
  });

  it('sends photos', () => {
    expect(reviewer('send-photos')).toBe(true);
  });

  it('does nothing else, even on a post sent to them', () => {
    expect(ACTIONS.filter((action) => reviewer(action, true))).toEqual([
      'see-workspace',
      'comment',
      'review-as-client',
      'send-photos',
    ]);
  });

  it('only sends photos when the post was not sent to them', () => {
    expect(ACTIONS.filter((action) => reviewer(action, false))).toEqual(['send-photos']);
    expect(ACTIONS.filter((action) => reviewer(action))).toEqual(['send-photos']);
  });
});

describe('can: brands and workspaces (all brands at launch, §15)', () => {
  it.each(CELLS)(
    'gives the $role the same answer on $action for every brand, no brand and any workspace',
    ({ role, action, expected }) => {
      for (const sentToReviewer of [true, false]) {
        const answer = expected === 'yes' || (expected === 'sent-posts' && sentToReviewer);
        const answers = [BRAND, OTHER_BRAND, null].flatMap((brandId) =>
          [WORKSPACE, OTHER_WORKSPACE].map((workspaceId) =>
            can({ role, action, workspaceId, brandId, sentToReviewer }),
          ),
        );
        expect(answers).toEqual([answer, answer, answer, answer, answer, answer]);
      }
    },
  );
});

describe('can: anything not in the table is refused', () => {
  it.each<string>(['superuser', 'member', 'Owner', '', 'toString', '__proto__', 'constructor'])(
    'refuses the unknown role %j every action',
    (role) => {
      for (const action of ACTIONS) {
        expect(check(role as Role, action, { sentToReviewer: true })).toBe(false);
      }
    },
  );

  it.each<string>(['delete-everything', 'Export', '', 'toString', '__proto__', 'constructor'])(
    'refuses every role the unknown action %j',
    (action) => {
      for (const role of ROLES) {
        expect(check(role, action as Action, { sentToReviewer: true })).toBe(false);
      }
    },
  );
});
