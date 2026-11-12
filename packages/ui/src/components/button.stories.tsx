import type { Meta, StoryObj } from '@storybook/react-vite';
import { LoaderCircleIcon } from 'lucide-react';
import { Button } from '@lzp/ui/components/button';
import { MailIcon } from '@lzp/ui/components/icons';

// Every state of §05's four buttons: primary (gold), secondary, ghost and destructive. The gallery tests (tests/gallery)
// act on a story's tag: `hover` moves the pointer onto the button, `focus` tabs to it, so the real :hover and
// :focus-visible styles are drawn. Empty and error don't apply to a button.
const meta = {
  title: 'Components/Button',
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

const variants = [
  { variant: 'default', label: 'Approve post', busy: 'Approving…' },
  { variant: 'secondary', label: 'Save draft', busy: 'Saving…' },
  { variant: 'ghost', label: 'Cancel', busy: 'Cancelling…' },
  { variant: 'destructive', label: 'Delete post', busy: 'Deleting…' },
] as const;

const row = 'flex flex-wrap items-center gap-4';

/** Default: primary gold with near-black text, secondary, ghost and destructive. */
export const Variants: Story = {
  render: () => (
    <div className={row}>
      {variants.map(({ variant, label }) => (
        <Button key={variant} variant={variant}>
          {label}
        </Button>
      ))}
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div className={row}>
      {variants.map(({ variant, label }) => (
        <Button key={variant} variant={variant} disabled>
          {label}
        </Button>
      ))}
    </div>
  ),
};

/** An icon at the start, as the approved invite card's "Email me a sign-in link" has its mail icon (Lucide, decorative). */
export const WithIcon: Story = {
  render: () => (
    <div className={row}>
      <Button>
        <MailIcon data-icon="inline-start" aria-hidden="true" />
        Email me a sign-in link
      </Button>
    </div>
  ),
};

/** Loading: a spinner that stands still under reduced motion, and the button can't be pressed again. */
export const Loading: Story = {
  render: () => (
    <div className={row}>
      {variants.map(({ variant, busy }) => (
        <Button key={variant} variant={variant} disabled aria-busy>
          <LoaderCircleIcon
            data-icon="inline-start"
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
          {busy}
        </Button>
      ))}
    </div>
  ),
};

export const PrimaryHover: Story = {
  tags: ['hover'],
  args: { variant: 'default', children: 'Approve post' },
};

export const SecondaryHover: Story = {
  tags: ['hover'],
  args: { variant: 'secondary', children: 'Save draft' },
};

export const GhostHover: Story = {
  tags: ['hover'],
  args: { variant: 'ghost', children: 'Cancel' },
};

export const DestructiveHover: Story = {
  tags: ['hover'],
  args: { variant: 'destructive', children: 'Delete post' },
};

/** Focus: a solid 2 px outline with a 2 px gap; ink in light mode, gold in dark (§21), never gold on light. */
export const PrimaryFocus: Story = {
  tags: ['focus'],
  args: { variant: 'default', children: 'Approve post' },
};

export const SecondaryFocus: Story = {
  tags: ['focus'],
  args: { variant: 'secondary', children: 'Save draft' },
};

export const GhostFocus: Story = {
  tags: ['focus'],
  args: { variant: 'ghost', children: 'Cancel' },
};

export const DestructiveFocus: Story = {
  tags: ['focus'],
  args: { variant: 'destructive', children: 'Delete post' },
};
