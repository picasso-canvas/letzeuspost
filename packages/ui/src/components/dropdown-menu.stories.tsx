import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDownIcon, CopyIcon, DownloadIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@lzp/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@lzp/ui/components/dropdown-menu';
import { Stage } from '../gallery/stage';

// A post's actions menu, closed and open, in every state that applies: the trigger hovered and focused, the menu open
// with a disabled and a destructive item, opened by the keyboard with the first item focused (the `keyboard-open` tag
// presses ArrowDown on the focused trigger), and with checkbox and radio items. Open menus render into a Stage inside
// the canvas, so the tests see them. Empty, loading and error don't apply to a menu.
const meta = {
  title: 'Components/Dropdown menu',
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

function PostMenu({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Stage className="h-80 w-64">
      {(container) => (
        <DropdownMenu defaultOpen={defaultOpen}>
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

/** Open: a label, a shortcut, a disabled item (dimmed, can't be chosen) and a destructive one. */
export const Open: Story = {
  render: () => <PostMenu defaultOpen />,
};

/** Opened by the keyboard: the first item is focused, with the approved 2 px outline (Iris F4 on #206). */
export const KeyboardOpen: Story = {
  tags: ['focus', 'keyboard-open'],
  render: () => <PostMenu />,
};

/** Checkbox and radio items: a view menu on the calendar. */
export const CheckboxAndRadio: Story = {
  render: () => (
    <Stage className="h-72 w-64">
      {(container) => (
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger render={<Button variant="secondary" />}>
            View
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent container={container} className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Show</DropdownMenuLabel>
              <DropdownMenuCheckboxItem defaultChecked>Drafts</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem>Exported posts</DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>Language</DropdownMenuLabel>
              <DropdownMenuRadioGroup defaultValue="both">
                <DropdownMenuRadioItem value="both">English and Bangla</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="bn">Bangla</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </Stage>
  ),
};
