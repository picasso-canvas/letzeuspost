import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDownIcon, CopyIcon, DownloadIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@lzp/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@lzp/ui/components/dropdown-menu';
import { Stage } from '../gallery/stage';

// A post's actions menu: the trigger at rest, hovered and focused. The open menu (its items, the keyboard focus, checkbox
// and radio items) waits for a gallery decision: axe flags the invisible focus guards Base UI puts around every open
// menu (`aria-hidden-focus`), so its stories would fail CI. Empty, loading and error don't apply to a menu.
const meta = {
  title: 'Components/Dropdown menu',
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The menu opens into the Stage when clicked in the gallery; the stories show the trigger. */
function PostMenu() {
  return (
    <Stage className="h-80 w-64">
      {(container) => (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="secondary" />}>
            Post actions
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent container={container} className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Eid offer carousel</DropdownMenuLabel>
              <DropdownMenuItem>
                <PencilIcon aria-hidden="true" />
                Edit post
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CopyIcon aria-hidden="true" />
                Duplicate
                <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <DownloadIcon aria-hidden="true" />
                Export (approve it first)
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <Trash2Icon aria-hidden="true" />
              Delete post
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </Stage>
  );
}

/** Default: the closed trigger. */
export const Closed: Story = {
  render: () => <PostMenu />,
};

export const TriggerHover: Story = {
  tags: ['hover'],
  render: () => <PostMenu />,
};

export const TriggerFocus: Story = {
  tags: ['focus'],
  render: () => <PostMenu />,
};
