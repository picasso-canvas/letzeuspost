'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { WorkspaceSwitcher, type Workspace } from '@lzp/ui/components/top-bar';
import { switchWorkspace, type SwitchResult } from '../app/app/actions.ts';
import { messages } from '../messages.ts';

const { switcher } = messages.frame;

/**
 * The workspace's mark as the v1 mockup's 03-inbox draws it (Iris F2 on #79, #254): a filled navy disc with white
 * initials, not the person's pale avatar. DESIGN.md's `workspace-mark` pair fills it and writes the initials; the pair
 * is the same in both themes, so these classes serve light and dark.
 */
const WORKSPACE_MARK =
  '[&_[data-slot=avatar-fallback]]:bg-workspace-mark [&_[data-slot=avatar-fallback]]:text-workspace-mark-foreground';

/**
 * §15's switcher, as the app holds it: the person's workspaces with their role in each. Choosing one asks the server
 * action to make it the session's workspace (the guard checks the membership), then draws the page again in it. The
 * button is disabled while that runs; a refusal or a lost connection says so beside it and leaves the page as it was.
 */
export function SwitchWorkspace({
  workspaces,
  currentId,
}: {
  workspaces: readonly Workspace[];
  currentId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  const select = (id: string) => {
    setFailed(false);
    startTransition(async () => {
      const result: SwitchResult = await switchWorkspace(id).catch(() => ({ ok: false }) as const);
      if (result.ok) router.refresh();
      else setFailed(true);
    });
  };

  return (
    <>
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={currentId}
        onSelect={select}
        menuLabel={switcher.menuLabel}
        currentLabel={switcher.current}
        note={switcher.note}
        disabled={pending}
        className={WORKSPACE_MARK}
      />
      {/* Always in the page, so a screen reader hears the message when it appears. */}
      <p role="status" className="text-meta text-destructive">
        {failed ? switcher.switchError : ''}
      </p>
    </>
  );
}
