import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from '@lzp/ui/components/skeleton';

// Loading (§04: "Loading: skeletons"): the shapes of what is coming, pulsing, and standing still under reduced
// motion. A skeleton is the loading state itself; the other states don't apply.
const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A post card on its way: the image, the title and a line of meta. */
export const PostCard: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-3" aria-busy="true">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  ),
};

/** A list row: an avatar and two lines. */
export const ListRow: Story = {
  render: () => (
    <div className="flex w-72 items-center gap-3" aria-busy="true">
      <Skeleton className="size-8 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  ),
};
