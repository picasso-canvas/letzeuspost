'use client';

import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar, AvatarFallback } from '@lzp/ui/components/avatar';
import {
  TopBar,
  TopBarEnd,
  WorkspaceSwitcher,
  WorkspaceSwitcherSkeleton,
  type Workspace,
  type WorkspaceSwitcherProps,
} from '@lzp/ui/components/top-bar';
import kiteLogo from '../gallery/logo-kite.svg';
import { Stage } from '../gallery/stage';

// §04's top bar with §15's workspace switcher (the v1 mockup's `.top` and `openWs`): the workspace's name and a button
// that lists every workspace the person belongs to with their role in each, the current one marked. Closed, hovered,
// focused, open, opened by the keyboard (the `keyboard-open` tag presses ArrowDown on the focused button), disabled,
// loading, with a name too long for the button, and with the list failed to load. There is no empty switcher: the frame
// only exists inside a workspace (Athena, #75, 2026-11-11; #79's guard handles someone with none). Open menus render
// into a Stage inside the canvas, so the tests see them. Search, + Create and the bell are not here: they arrive with
// their features.
const meta = {
  title: 'Components/Top bar',
  component: TopBar,
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// A workspace has no colour of its own (Zeus, #75, 2026-11-11): one has a logo (a small local SVG, no network), the
// others show their initials on the muted tokens.
const workspaces: Workspace[] = [
  { id: 'northwind', name: 'Northwind Social', role: 'Admin' },
  { id: 'kite', name: 'Kite & Co', role: 'Editor', logo: kiteLogo },
  { id: 'tidewater', name: 'Tidewater Creative', role: 'Viewer' },
];

/** The words the app takes from apps/web/messages/en.json; the components write none. */
const words = {
  menuLabel: 'Workspaces', // en.json: frame.switcher.menuLabel
  currentLabel: 'current', // en.json: frame.switcher.current
  note: 'Each workspace is separate: brands, posts and notifications never mix.', // en.json: frame.switcher.note
};

/** en.json: frame.switcher.loadError */
const loadError = 'Couldn’t load your workspaces. Check your connection and try again.';
/** en.json: frame.switcher.retry */
const retryLabel = 'Try again';
/** en.json: frame.switcher.loading */
const loadingLabel = 'Loading workspaces…';
/** en.json: frame.account.label (the avatar's name: the person and their role) */
const accountLabel = 'Nadia Karim (Admin)';

function Bar({
  height = 'h-64',
  switcher,
}: {
  /** Room under the bar for an open menu. */
  height?: string;
  switcher: (container: HTMLElement) => ReactNode;
}) {
  return (
    <Stage className={`${height} w-200`}>
      {(container) => (
        <TopBar>
          {switcher(container)}
          <TopBarEnd>
            <Avatar role="img" aria-label={accountLabel}>
              <AvatarFallback>NK</AvatarFallback>
            </Avatar>
          </TopBarEnd>
        </TopBar>
      )}
    </Stage>
  );
}

/** The switcher as an app holds it: what is chosen becomes the current workspace, so the story shows the choice. */
function Switcher({
  container,
  ...props
}: Partial<Omit<WorkspaceSwitcherProps, 'container'>> & { container: HTMLElement }) {
  const [currentId, setCurrentId] = useState('northwind');
  return (
    <WorkspaceSwitcher
      {...words}
      workspaces={workspaces}
      currentId={currentId}
      onSelect={setCurrentId}
      container={container}
      {...props}
    />
  );
}

const northwind = (
  container: HTMLElement,
  props: Partial<Omit<WorkspaceSwitcherProps, 'container'>> = {},
) => <Switcher container={container} {...props} />;

/** Default: the current workspace on the button, the person's avatar at the end. */
export const Default: Story = {
  render: () => <Bar switcher={(container) => northwind(container)} />,
};

/** A workspace with a logo shows it where the others show their initials. */
export const Logo: Story = {
  render: () => <Bar switcher={(container) => northwind(container, { currentId: 'kite' })} />,
};

export const TriggerHover: Story = {
  tags: ['hover'],
  render: () => <Bar switcher={(container) => northwind(container)} />,
};

export const TriggerFocus: Story = {
  tags: ['focus'],
  render: () => <Bar switcher={(container) => northwind(container)} />,
};

/** Open: every workspace with the person's role in it; the current one has a check and says so. */
export const Open: Story = {
  render: () => <Bar switcher={(container) => northwind(container, { defaultOpen: true })} />,
};

/** Opened by the keyboard: the first workspace is focused, with the approved 2 px outline. */
export const KeyboardOpen: Story = {
  tags: ['focus', 'keyboard-open'],
  render: () => <Bar switcher={(container) => northwind(container)} />,
};

/** Disabled: for as long as a switch is under way, nothing opens. */
export const Disabled: Story = {
  render: () => <Bar switcher={(container) => northwind(container, { disabled: true })} />,
};

/** Loading: the shape of the switcher, shimmering, while the list is on its way. */
export const Loading: Story = {
  render: () => <Bar switcher={() => <WorkspaceSwitcherSkeleton label={loadingLabel} />} />,
};

/** Error: the list couldn't be loaded. The current workspace stays on the button, with a warning beside it. */
export const ErrorState: Story = {
  render: () => (
    <Bar
      switcher={(container) => northwind(container, { error: { message: loadError, retryLabel } })}
    />
  ),
};

/** The error opened: the reason and the way out. */
export const ErrorOpen: Story = {
  render: () => (
    <Bar
      height="h-56"
      switcher={(container) =>
        northwind(container, { defaultOpen: true, error: { message: loadError, retryLabel } })
      }
    />
  ),
};

// Names too long for the button, in two scripts. Two start alike (Iris F1 on #221): they can only be told apart by their
// ends, so the menu has to show them whole. The Bangla name is written natively ("Dhaka and Chattogram Digital Marketing
// Agency Limited"), not translated from the English one.
const longNames: Workspace[] = [
  {
    id: 'northwind',
    name: 'Northwind Social Media Agency of Greater Dhaka and Chattogram',
    role: 'Admin',
  },
  {
    id: 'northwind-sylhet',
    name: 'Northwind Social Media Agency of Greater Dhaka and Sylhet',
    role: 'Viewer',
  },
  {
    id: 'dhaka-digital',
    name: 'ঢাকা ও চট্টগ্রাম ডিজিটাল মার্কেটিং এজেন্সি লিমিটেড',
    role: 'Editor',
  },
  { id: 'kite', name: 'Kite & Co', role: 'Editor', logo: kiteLogo },
];

/**
 * A name that doesn't fit is cut with an ellipsis on the button, where one line is all there is room for, and wraps
 * in the menu, so it is whole there; the layout stays. The Bangla name is in the list too.
 */
export const LongName: Story = {
  render: () => (
    <Bar
      height="h-128"
      switcher={(container) => northwind(container, { defaultOpen: true, workspaces: longNames })}
    />
  ),
};

/** The same list with the Bangla name as the current workspace: it is on the button (cut with an ellipsis) and whole in the menu. */
export const LongNameBangla: Story = {
  render: () => (
    <Bar
      height="h-128"
      switcher={(container) =>
        northwind(container, {
          defaultOpen: true,
          workspaces: longNames,
          currentId: 'dhaka-digital',
        })
      }
    />
  ),
};
