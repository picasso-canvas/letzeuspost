import { PERMISSION_MATRIX, type Action, type Role } from './matrix.ts';

/** What `can` is asked: who, what, and where. */
export interface PermissionCheck {
  readonly role: Role;
  readonly action: Action;
  /** The workspace it happens in, from the session, never from the request (§13). */
  readonly workspaceId: string;
  /**
   * The brand it's on, or null when it isn't on one brand (workspace settings, creating a brand). Members work on all
   * brands at launch, so today every brand gets the same answer; limiting members to brands later changes the answer
   * here, not the calls (§15).
   */
  readonly brandId: string | null;
  /** For the client reviewer: whether the post is one sent to their review link. Left out, it counts as not sent. */
  readonly sentToReviewer?: boolean;
}

/** Whether §15's matrix allows it. A role or action that isn't in the table is refused. */
export function can(check: PermissionCheck): boolean {
  const { role, action } = check;
  if (!Object.hasOwn(PERMISSION_MATRIX, action)) return false;
  const row = PERMISSION_MATRIX[action];
  if (!Object.hasOwn(row, role)) return false;
  const cell = row[role];
  if (cell === 'yes') return true;
  if (cell === 'sent-posts') return check.sentToReviewer === true;
  return false;
}
