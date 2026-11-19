import type { Metadata } from 'next';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@lzp/ui/components/empty';
import { messages } from '../../messages.ts';
import { inWorkspace } from './workspace.ts';

// The Inbox (§04, the v1 mockup's 03-inbox), the signed-in home: its heading and line, and for now its empty state. What
// it lists (posts to review, feedback, fixes) comes with M4. Guarded like every page: the session, its workspace, the
// person's role, `see-workspace`.
const { inbox } = messages;

export const metadata: Metadata = { title: `${inbox.heading} · ${messages.app.name}` };

export default async function InboxPage() {
  await inWorkspace();
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1 font-(weight:--font-weight-h1) tracking-h1 text-balance">
          {inbox.heading}
        </h1>
        <p className="text-pretty text-muted-foreground">{inbox.intro}</p>
      </div>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{inbox.empty.heading}</EmptyTitle>
          <EmptyDescription>{inbox.empty.body}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
