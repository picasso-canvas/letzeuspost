import type { Meta, StoryObj } from '@storybook/react-vite';
import { LogoMark } from '@lzp/ui/components/logo-mark';

// The LetZeusPost mark (§03 Logo A), as the app draws it: the bolt in ink on the gold tile, the same in light and dark
// because both colours are tokens that don't change between them. The gallery draws every story in both themes. It has
// no hover, focus, disabled, empty, loading or error state: it isn't interactive.
const meta = {
  title: 'Components/Logo mark',
  component: LogoMark,
} satisfies Meta<typeof LogoMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default: 24 px (`size-6`), beside the app's name as the sign-in card shows it. */
export const Default: Story = {};

/** The sizes it is used at: 24 px beside a name, 32 px, and 64 px as the logo file draws it. */
export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <LogoMark />
      <LogoMark className="size-8" />
      <LogoMark className="size-16" />
    </div>
  ),
};

/** Beside the wordmark, as the invite and sign-in cards show it: the mark is decorative, the name is the text. */
export const WithWordmark: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <LogoMark />
      <span>
        Let<b className="font-bold">Zeus</b>Post
      </span>
    </div>
  ),
};

/** Alone, it is an image with a name for a screen reader. */
export const Named: Story = { args: { title: 'LetZeusPost' } };
