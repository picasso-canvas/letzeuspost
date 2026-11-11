import type { ReactNode } from 'react';
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
import { Stage } from '../gallery/stage';

// §04's top bar with §15's workspace switcher (the v1 mockup's `.top`): the workspace's name and a button that lists
// every workspace the person belongs to with their role in each, the current one marked. Closed, hovered, focused, open,
// opened by the keyboard (the `keyboard-open` tag presses ArrowDown on the focused button), disabled, with no workspace,
// loading, with a name too long for the button, and with the list failed to load. Open menus render into a Stage inside
// the canvas, so the tests see them. Search, + Create and the bell are not here: they arrive with their features.
const meta = {
  title: 'Components/Top bar',
  component: TopBar,
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

const workspaces: Workspace[] = [
  { id: 'northwind', name: 'Northwind Social', role: 'Admin' },
  { id: 'kite', name: 'Kite & Co', role: 'Editor' },
  { id: 'tidewater', name: 'Tidewater Creative', role: 'Viewer' },
];

/** The words the app takes from apps/web/messages/en.json; the components write none. */
const words = {
  menuLabel: 'Workspaces',
  currentLabel: 'current',
  emptyLabel: 'No workspace yet',
};

const switcherLabel = (name: string): string => `Workspace: ${name}. Switch workspace`;

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
            <Avatar role="img" aria-label="Nadia Karim (Admin)">
              <AvatarFallback>NK</AvatarFallback>
            </Avatar>
          </TopBarEnd>
        </TopBar>
      )}
    </Stage>
  );
}

const northwind = (container: HTMLElement, props: Partial<WorkspaceSwitcherProps> = {}) => (
  <WorkspaceSwitcher
    {...words}
    label={switcherLabel('Northwind Social')}
    workspaces={workspaces}
    currentId="northwind"
    container={container}
    {...props}
  />
);

/** Default: the current workspace on the button, the person's avatar at the end. */
export const Default: Story = {
  render: () => <Bar switcher={(container) => northwind(container)} />,
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

/** Empty: the person has left their last workspace; the button says so and can't be opened. */
export const Empty: Story = {
  render: () => (
    <Bar
      switcher={(container) =>
        northwind(container, {
          workspaces: [],
          currentId: undefined,
          label: words.emptyLabel,
        })
      }
    />
  ),
};

/** Loading: the shape of the switcher, shimmering, while the list is on its way. */
export const Loading: Story = {
  render: () => <Bar switcher={() => <WorkspaceSwitcherSkeleton label="Loading workspaces…" />} />,
};

/** Error: the list couldn't be loaded. The current workspace stays on the button, with a warning beside it. */
export const ErrorState: Story = {
  render: () => (
    <Bar
      switcher={(container) =>
        northwind(container, {
          label: `${switcherLabel('Northwind Social')} The list of workspaces didn’t load.`,
          error: {
            message: 'Couldn’t load your workspaces. Check your connection and try again.',
            retryLabel: 'Try again',
          },
        })
      }
    />
  ),
};

/** The error opened: the reason and the way out. */
export const ErrorOpen: Story = {
  render: () => (
    <Bar
      height="h-56"
      switcher={(container) =>
        northwind(container, {
          defaultOpen: true,
          error: {
            message: 'Couldn’t load your workspaces. Check your connection and try again.',
            retryLabel: 'Try again',
          },
        })
      }
    />
  ),
};

/** A name that doesn't fit is cut with an ellipsis, in the button and in the menu; the layout stays. */
export const LongName: Story = {
  render: () => {
    const long = 'Northwind Social Media Agency of Greater Dhaka and Chattogram';
    return (
      <Bar
        switcher={(container) =>
          northwind(container, {
            defaultOpen: true,
            label: switcherLabel(long),
            workspaces: [{ id: 'northwind', name: long, role: 'Admin' }, ...workspaces.slice(1)],
          })
        }
      />
    );
  },
};
