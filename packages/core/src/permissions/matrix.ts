/**
 * §15's "Who can do what" as one table. It lives only here (§13, §15); `can` reads it. A sensitive path: a change to a
 * cell is a change to who can do what.
 */

/** §15's five columns, in its order. The first four are a member's role in a workspace (§13's `member.role`). */
export const ROLES = ['owner', 'admin', 'editor', 'viewer', 'client-reviewer'] as const;
export type Role = (typeof ROLES)[number];

/** §15's rows, in its order: one action per row (the table below gives each row's wording). */
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

/** A cell: allowed, refused, or allowed only on the posts sent to the client reviewer's review link. */
export type Cell = 'yes' | 'no' | 'sent-posts';
type Row = Readonly<Record<Role, Cell>>;

/** §15's ✓. */
const YES = 'yes';
/** §15's blank cell. */
const NO = 'no';
/**
 * The client reviewer, only on the posts sent to their link: §15's "only the posts sent to them" and "on sent posts".
 * Approving or requesting changes as the client is the same: §11's review page shows only the posts sent, and §13's
 * link cookie reaches nothing else.
 */
const SENT = 'sent-posts';

/** One row, its cells in §15's column order. */
function row(owner: Cell, admin: Cell, editor: Cell, viewer: Cell, clientReviewer: Cell): Row {
  return Object.freeze({ owner, admin, editor, viewer, 'client-reviewer': clientReviewer });
}

// Columns: Owner, Admin, Editor, Viewer, Client reviewer (link).
export const PERMISSION_MATRIX: Readonly<Record<Action, Row>> = Object.freeze({
  // Workspace
  // See everything in the workspace (all brands); the client reviewer only the posts sent to them
  'see-workspace': row(YES, YES, YES, YES, SENT),
  // Workspace settings (name, logo, review-page name, timezone)
  'edit-workspace-settings': row(YES, YES, NO, NO, NO),
  // Invite and manage Editors and Viewers
  'manage-editors-and-viewers': row(YES, YES, NO, NO, NO),
  // Invite and manage Admins
  'manage-admins': row(YES, NO, NO, NO, NO),
  // Plan, billing and invoices
  'manage-billing': row(YES, NO, NO, NO, NO),
  // Hand over ownership, delete the workspace
  'hand-over-or-delete-workspace': row(YES, NO, NO, NO, NO),
  // See the usage meters
  'see-usage': row(YES, YES, YES, YES, NO),
  // See Zeus's support-access log
  'see-support-log': row(YES, YES, NO, NO, NO),

  // Brands
  // Create a brand, edit its kit, manage its asset library
  'edit-brands': row(YES, YES, YES, NO, NO),
  // Approve photos the client sent (§10)
  'approve-client-photos': row(YES, YES, YES, NO, NO),
  // Set the approval mode
  'set-approval-mode': row(YES, YES, NO, NO, NO),
  // Edit the brand's client reviewers
  'edit-brand-reviewers': row(YES, YES, YES, NO, NO),
  // Delete a brand
  'delete-brand': row(YES, YES, NO, NO, NO),

  // Posts
  // Make batches, generate, edit, AI rewrite, regenerate
  'make-posts': row(YES, YES, YES, NO, NO),
  // Confirm claims and tick consent (§22, §07, §10)
  'confirm-claims-and-consent': row(YES, YES, YES, NO, NO),
  // Approve for the agency
  'approve-for-agency': row(YES, YES, YES, NO, NO),
  // Send to the client; revoke or replace a review link
  'send-to-client': row(YES, YES, YES, NO, NO),
  // Approve on the client's behalf (with a reason)
  'approve-on-clients-behalf': row(YES, YES, NO, NO, NO),
  // Comment; the client reviewer on sent posts
  comment: row(YES, YES, YES, YES, SENT),
  // Approve or request changes as the client
  'review-as-client': row(NO, NO, NO, NO, SENT),
  // Send photos (§10)
  'send-photos': row(NO, NO, NO, NO, YES),
  // Export
  export: row(YES, YES, YES, NO, NO),
} satisfies Record<Action, Row>);
