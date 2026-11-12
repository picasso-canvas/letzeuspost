import type { ReactNode } from 'react';
import { AppFrame } from '../../components/app-frame.tsx';
import { messages } from '../../messages.ts';
import { inWorkspace } from './workspace.ts';

// The frame of every signed-in page (Q13: they live under /app). The guard runs first: no session goes to /sign-in, no
// workspace to `/`. Each page under it runs the guard again for itself (a layout isn't drawn again when the person moves
// between its pages), and React's `cache` makes that the same answer within one request.
const { roles } = messages.frame;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { person, workspace, workspaces } = await inWorkspace();
  return (
    <AppFrame
      person={{ name: person.name }}
      current={{ id: workspace.id, role: roles[workspace.role] }}
      workspaces={workspaces.map(({ id, name, role }) => ({ id, name, role: roles[role] }))}
    >
      {children}
    </AppFrame>
  );
}
