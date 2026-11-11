import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@lzp/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@lzp/ui/components/sheet';
import { Stage } from '../gallery/stage';

// The side sheet, closed and open, rendered into a Stage inside the canvas so the open sheet, its overlay and its close
// button are in the screenshot. The close button's name comes from the caller. Hover, focus and disabled belong to
// the sheet's buttons, which are the gallery's buttons.
const meta = {
  title: 'Components/Sheet',
  component: Sheet,
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

function PostSheet({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Stage className="h-120 w-160">
      {(container) => (
        <Sheet defaultOpen={defaultOpen}>
          <SheetTrigger render={<Button variant="secondary" />}>Post details</SheetTrigger>
          <SheetContent container={container} closeLabel="Close">
            <SheetHeader>
              <SheetTitle>Eid offer carousel</SheetTitle>
              <SheetDescription>Golpo Café · 5 slides · English and Bangla</SheetDescription>
            </SheetHeader>
            <p className="px-4 text-muted-foreground">
              Waiting for Rumana’s approval since Tuesday.
            </p>
            <SheetFooter>
              <Button>Approve post</Button>
              <Button variant="secondary">Ask for changes</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}
    </Stage>
  );
}

/** Default: the closed trigger. */
export const Closed: Story = {
  render: () => <PostSheet />,
};

/** Open on the right, over a dimmed page. */
export const Open: Story = {
  render: () => <PostSheet defaultOpen />,
};
