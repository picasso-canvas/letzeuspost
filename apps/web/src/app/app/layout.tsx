import { Suspense, type ReactNode } from 'react';
import { AppFrame } from '../../components/app-frame.tsx';
import { AppFrameSkeleton } from '../../components/app-frame-skeleton.tsx';
import { messages } from '../../messages.ts';
import { inWorkspace } from './workspace.ts';

// The frame of every signed-in page (Q13: they live under /app). The guard runs first: no session goes to /sign-in, no
// workspace to `/`. Each page under it runs the guard again for itself (a layout isn't drawn again when the person moves
// between its pages), and React's `cache` makes that the same answer within one request.
//
// While the guard opens the workspace, the frame and the Inbox are drawn as skeletons (Iris F4 on #79). The skeleton
// holds nothing of the person or the workspace, so it can go out before the guard has answered. A visitor with no
// session never sees it: the proxy sends them to /sign-in first.
const { roles } = messages.frame;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AppFrameSkeleton />}>
      <GuardedFrame>{children}</GuardedFrame>
    </Suspense>
  );
}

async function GuardedFrame({ children }: { children: ReactNode }) {
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
