import type { Meta, StoryObj } from '@storybook/react-vite';
import { LanguagesIcon } from 'lucide-react';
import { Button } from '@lzp/ui/components/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@lzp/ui/components/tooltip';
import { Stage } from '../gallery/stage';

// A tooltip naming an icon button, open, and opened by focusing its trigger with the keyboard. It renders into a
// Stage inside the canvas, so the tests see it. Empty, loading and error don't apply.
const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

function LanguageTip({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <TooltipProvider>
      <Stage className="flex h-24 w-56 items-end justify-center">
        {(container) => (
          <Tooltip defaultOpen={defaultOpen}>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" aria-label="Switch to Bangla" />}
            >
              <LanguagesIcon aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent container={container}>Switch to Bangla</TooltipContent>
          </Tooltip>
        )}
      </Stage>
    </TooltipProvider>
  );
}

/** Default: open above its trigger. */
export const Open: Story = {
  render: () => <LanguageTip defaultOpen />,
};

/** Focus: the trigger focused by the keyboard, with the tooltip showing. */
export const TriggerFocus: Story = {
  tags: ['focus'],
  render: () => <LanguageTip />,
};
