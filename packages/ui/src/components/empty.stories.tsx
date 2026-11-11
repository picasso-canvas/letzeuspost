import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarIcon, CloudAlertIcon } from 'lucide-react';
import { Button } from '@lzp/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@lzp/ui/components/empty';

// An empty screen (§04 States and messages): what's missing, one witty line (§05 allows them only while waiting or
// when a screen is empty), and the way forward; its button hovered and focused; and the error state, where the
// content couldn't load. Loading is the skeleton's job.
const meta = {
  title: 'Components/Empty',
  component: Empty,
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

function NoPosts() {
  return (
    <Empty className="w-120 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No posts this week</EmptyTitle>
        <EmptyDescription>
          A quiet calendar. Plan a few posts and they’ll show up here.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>Plan posts</Button>
      </EmptyContent>
    </Empty>
  );
}

/** Default: nothing here yet, and what to do about it. */
export const NoPostsYet: Story = {
  render: () => <NoPosts />,
};

export const ActionHover: Story = {
  tags: ['hover'],
  render: () => <NoPosts />,
};

export const ActionFocus: Story = {
  tags: ['focus'],
  render: () => <NoPosts />,
};

/** Error: the content couldn't load; nothing is lost, and the way out is to try again. */
export const ErrorState: Story = {
  render: () => (
    <Empty className="w-120 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CloudAlertIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Couldn’t load the calendar</EmptyTitle>
        <EmptyDescription>The connection dropped. Your posts are safe.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="secondary">Try again</Button>
      </EmptyContent>
    </Empty>
  ),
};
