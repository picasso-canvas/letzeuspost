import { PERMISSION_MATRIX, type Action, type Role } from './matrix.ts';

export interface PermissionCheck {
  readonly role: Role;
  readonly action: Action;
  readonly workspaceId: string;
  readonly brandId: string | null;
  readonly sentToReviewer?: boolean;
}

// Not built yet: only reads the `yes` cells.
export function can(check: PermissionCheck): boolean {
  return PERMISSION_MATRIX[check.action][check.role] === 'yes';
}
