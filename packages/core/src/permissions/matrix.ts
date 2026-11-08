/** §15's five columns, in its order. The first four are a member's role in a workspace (§13's `member.role`). */
export const ROLES = ['owner', 'admin', 'editor', 'viewer', 'client-reviewer'] as const;
export type Role = (typeof ROLES)[number];

/** §15's rows, in its order: one action per row. */
export const ACTIONS = [
  // Workspace
  'see-workspace',
  'edit-workspace-settings',
  'manage-editors-and-viewers',
  'manage-admins',
  'manage-billing',
  'hand-over-or-delete-workspace',
  'see-usage',
  'see-support-log',
  // Brands
  'edit-brands',
  'approve-client-photos',
  'set-approval-mode',
  'edit-brand-reviewers',
  'delete-brand',
  // Posts
  'make-posts',
  'confirm-claims-and-consent',
  'approve-for-agency',
  'send-to-client',
  'approve-on-clients-behalf',
  'comment',
  'review-as-client',
  'send-photos',
  'export',
] as const;
export type Action = (typeof ACTIONS)[number];

export type Cell = 'yes' | 'no' | 'sent-posts';
type Row = Readonly<Record<Role, Cell>>;

const NO = 'no';

function row(owner: Cell, admin: Cell, editor: Cell, viewer: Cell, clientReviewer: Cell): Row {
  return { owner, admin, editor, viewer, 'client-reviewer': clientReviewer };
}

// Not filled in yet: every cell is refused.
export const PERMISSION_MATRIX: Readonly<Record<Action, Row>> = {
  'see-workspace': row(NO, NO, NO, NO, NO),
  'edit-workspace-settings': row(NO, NO, NO, NO, NO),
  'manage-editors-and-viewers': row(NO, NO, NO, NO, NO),
  'manage-admins': row(NO, NO, NO, NO, NO),
  'manage-billing': row(NO, NO, NO, NO, NO),
  'hand-over-or-delete-workspace': row(NO, NO, NO, NO, NO),
  'see-usage': row(NO, NO, NO, NO, NO),
  'see-support-log': row(NO, NO, NO, NO, NO),
  'edit-brands': row(NO, NO, NO, NO, NO),
  'approve-client-photos': row(NO, NO, NO, NO, NO),
  'set-approval-mode': row(NO, NO, NO, NO, NO),
  'edit-brand-reviewers': row(NO, NO, NO, NO, NO),
  'delete-brand': row(NO, NO, NO, NO, NO),
  'make-posts': row(NO, NO, NO, NO, NO),
  'confirm-claims-and-consent': row(NO, NO, NO, NO, NO),
  'approve-for-agency': row(NO, NO, NO, NO, NO),
  'send-to-client': row(NO, NO, NO, NO, NO),
  'approve-on-clients-behalf': row(NO, NO, NO, NO, NO),
  comment: row(NO, NO, NO, NO, NO),
  'review-as-client': row(NO, NO, NO, NO, NO),
  'send-photos': row(NO, NO, NO, NO, NO),
  export: row(NO, NO, NO, NO, NO),
};
