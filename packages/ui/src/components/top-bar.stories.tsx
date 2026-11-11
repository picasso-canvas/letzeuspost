import type { Meta, StoryObj } from '@storybook/react-vite';
import { TopBar } from '@lzp/ui/components/top-bar';

// Stub: the tests come first (#75).
const meta = {
  title: 'Components/Top bar',
  component: TopBar,
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
