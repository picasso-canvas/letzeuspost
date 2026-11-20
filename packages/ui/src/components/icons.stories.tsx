import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  CoffeeIcon,
  InboxIcon,
  LogOutIcon,
  MailIcon,
} from '@lzp/ui/components/icons';

// The icons a screen takes from `@lzp/ui/components/icons` (§13, §21: Lucide is the one icon set), each with its name.
// They are decoration beside a label, so the screen hides them from assistive technology (`aria-hidden`).
const meta = {
  title: 'Components/Icons',
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const icons = [
  { name: 'MailIcon', Icon: MailIcon },
  { name: 'InboxIcon', Icon: InboxIcon },
  { name: 'CoffeeIcon', Icon: CoffeeIcon },
  { name: 'LogOutIcon', Icon: LogOutIcon },
];

/** Every icon a screen uses, at the 16 px of a sidebar link or a menu item. */
export const Gallery: Story = {
  render: () => (
    <ul className="flex list-none gap-6 p-0 text-foreground">
      {icons.map(({ name, Icon }) => (
        <li key={name} className="flex flex-col items-center gap-2 text-meta">
          <Icon className="size-4" aria-hidden="true" />
          <span>{name}</span>
        </li>
      ))}
    </ul>
  ),
};
