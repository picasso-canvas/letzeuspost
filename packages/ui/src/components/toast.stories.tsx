'use client';

import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ToastManagerAddOptions } from '@base-ui/react/toast';
import { Toaster, useToastManager } from '@lzp/ui/components/toast';
import { Stage } from '../gallery/stage';

// Toasts as the app shows them: done, information, failed with a way to try again, and working (a spinner that stands
// still under reduced motion). Each story's toast stays until closed (no timeout), in a Stage inside the canvas, so
// the tests see it. Hover, focus and disabled belong to the toast's buttons, which are the gallery's buttons.
const meta = {
  title: 'Components/Toast',
  component: Toaster,
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Shows one toast from inside the Toaster, once it is mounted, and takes it away when the story goes. */
function Show({ toast }: { toast: ToastManagerAddOptions<object> }) {
  const { add, close } = useToastManager();
  useEffect(() => {
    const id = add({ timeout: 0, ...toast });
    return () => {
      close(id);
    };
  }, [add, close, toast]);
  return null;
}

function Toasts({ toast }: { toast: ToastManagerAddOptions<object> }) {
  return (
    <Stage className="h-40 w-104">
      {(container) => (
        <Toaster container={container} closeLabel="Close notification">
          <Show toast={toast} />
        </Toaster>
      )}
    </Stage>
  );
}

const approved = {
  type: 'success',
  title: 'Post approved',
  description: 'Golpo Café · Eid offer carousel',
};
const info = {
  type: 'info',
  title: 'Rumana is editing this post',
  description: 'Your changes will wait until she’s done.',
};
const failed = {
  type: 'error',
  title: 'Couldn’t export 12 posts',
  description: 'The connection dropped. Nothing was lost.',
  actionProps: { children: 'Try again' },
};
const exporting = {
  type: 'loading',
  title: 'Exporting 12 posts…',
  description: 'Usually under a minute.',
};

/** Default: something finished. */
export const Success: Story = {
  args: { closeLabel: 'Close notification' },
  render: () => <Toasts toast={approved} />,
};

export const Info: Story = {
  args: { closeLabel: 'Close notification' },
  render: () => <Toasts toast={info} />,
};

/** Error: what failed, in plain words, with the way out as the action. */
export const ErrorState: Story = {
  args: { closeLabel: 'Close notification' },
  render: () => <Toasts toast={failed} />,
};

/** Loading: work under way. */
export const Loading: Story = {
  args: { closeLabel: 'Close notification' },
  render: () => <Toasts toast={exporting} />,
};
