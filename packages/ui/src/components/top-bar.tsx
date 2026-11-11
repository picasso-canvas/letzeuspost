import type { ReactNode } from 'react';

// Stub: the tests come first (#75).
export interface Workspace {
  id: string;
  name: string;
  role: string;
  logo?: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  detail: string;
  current: boolean;
  logo?: string;
}

export function workspaceRows(
  workspaces: Workspace[],
  currentId: string | undefined,
  currentLabel: string,
): WorkspaceRow[] {
  void workspaces;
  void currentId;
  void currentLabel;
  return [];
}

export function TopBar(_: { children?: ReactNode }) {
  return null;
}

export function TopBarEnd(_: { children?: ReactNode }) {
  return null;
}

export function WorkspaceSwitcher(_: {
  workspaces: Workspace[];
  currentId?: string;
  label: string;
  menuLabel: string;
  currentLabel: string;
  emptyLabel: string;
  disabled?: boolean;
  error?: { message: string; retryLabel: string; onRetry?: () => void };
  onSelect?: (id: string) => void;
  container?: HTMLElement | null;
}) {
  return null;
}

export function WorkspaceSwitcherSkeleton(_: { label: string }) {
  return null;
}
