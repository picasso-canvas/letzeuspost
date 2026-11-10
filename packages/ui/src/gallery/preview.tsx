import type { Decorator, Preview } from '@storybook/react-vite';
import { parseThemeChoice, resolveTheme, THEME_CHOICES } from '@lzp/ui/lib/theme';
import '../styles/globals.css';

/** Puts `.dark` on <html> for the toolbar's choice; "system" follows the device, like the app does. */
const withTheme: Decorator = (Story, context) => {
  const choice = parseThemeChoice(context.globals.theme);
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle(
    'dark',
    resolveTheme(choice, systemPrefersDark) === 'dark',
  );
  return (
    // The tests screenshot this box: it holds the component and room for its 2 px focus outline and gap.
    <div data-gallery-canvas className="w-fit p-6">
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Light or dark (system follows the device)',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        dynamicTitle: true,
        items: THEME_CHOICES.map((value) => ({ value, title: value })),
      },
    },
  },
  initialGlobals: { theme: 'system' },
  parameters: {
    layout: 'fullscreen',
    // The app's own light and dark surfaces come from the tokens, not Storybook's background swatches.
    backgrounds: { disabled: true },
  },
};

export default preview;
