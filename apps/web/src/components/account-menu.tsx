'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@lzp/ui';
import { Avatar, AvatarFallback } from '@lzp/ui/components/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@lzp/ui/components/dropdown-menu';
import { langOf } from '@lzp/ui/components/top-bar';
import { initialsOf } from '@lzp/ui/lib/initials';
import { messages } from '../messages.ts';

const { account } = messages.frame;

/** Better Auth's sign-out (packages/auth's SERVED_ENDPOINTS): it deletes the session's row and clears the cookie. */
const SIGN_OUT = '/api/auth/sign-out';
/** Where a signed-out person goes: a fixed path. */
const SIGN_IN = '/sign-in';

/** Asks the API to end the session. Resolves to whether it did. */
async function endSession(): Promise<boolean> {
  try {
    const response = await fetch(SIGN_OUT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * The avatar at the end of the top bar (§04): the person's initials on a button that opens their menu, which names them
 * with their role in this workspace and holds Sign out. The button's name is `{name} ({role})` (en.json
 * `frame.account.label`), read from hidden text inside it, so it has no `aria-label` to disagree with what it shows.
 * Signing out goes to /sign-in in place of this page; if it fails, the page says so.
 */
export function AccountMenu({ name, role }: { name: string; role: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'signing-out' | 'failed'>('idle');
  const label = account.label.replace('{name}', name).replace('{role}', role);

  const signOut = async () => {
    setState('signing-out');
    // `replace`, so Back doesn't return to a page of the workspace; the session is gone, so the guard would refuse it.
    if (await endSession()) router.replace(SIGN_IN);
    else setState('failed');
  };

  return (
    <>
      {/* Always in the page, so a screen reader hears the message when it appears. */}
      <p role="status" className="text-meta text-destructive">
        {state === 'failed' ? account.signOutError : ''}
      </p>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-slot="account-menu"
          disabled={state === 'signing-out'}
          render={<Button variant="ghost" size="icon" className="rounded-full" />}
        >
          <Avatar aria-hidden="true">
            <AvatarFallback>{initialsOf(name)}</AvatarFallback>
          </Avatar>
          <span className="sr-only" lang={langOf(name)}>
            {label}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" aria-label={account.menuLabel} className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-foreground wrap-break-word" lang={langOf(name)}>
              {label}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void signOut()}>{account.signOut}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
