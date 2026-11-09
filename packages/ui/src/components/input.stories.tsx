import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field, FieldDescription, FieldError, FieldLabel } from '@lzp/ui/components/field';
import { Input } from '@lzp/ui/components/input';

// An input with its label, help text and error text, in every state (§21). The gallery tests (tests/gallery) act on a
// story's tag: `hover` moves the pointer onto the input, `focus` tabs to it.
const meta = {
  title: 'Components/Input',
  component: Input,
  // One field in a fixed-width column, so every state is drawn at the same size.
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

const help = 'As your clients know it.';

/** A labelled field; `error` adds the error text, linked to the input and announced. */
function BrandNameField({
  error,
  ...props
}: React.ComponentProps<typeof Input> & { error?: string }) {
  const described = error ? 'brand-name-help brand-name-error' : 'brand-name-help';
  return (
    <Field
      data-invalid={error ? true : undefined}
      data-disabled={props.disabled ? true : undefined}
    >
      <FieldLabel htmlFor="brand-name">Brand name</FieldLabel>
      <Input
        id="brand-name"
        name="brand-name"
        autoComplete="off"
        aria-describedby={described}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      <FieldDescription id="brand-name-help">
        {props.readOnly ? 'Reading your site…' : help}
      </FieldDescription>
      {error ? <FieldError id="brand-name-error">{error}</FieldError> : null}
    </Field>
  );
}

/** Default and empty: the placeholder shows an example. */
export const Empty: Story = {
  render: () => <BrandNameField placeholder="Golpo Café" />,
};

export const Filled: Story = {
  render: () => <BrandNameField defaultValue="Golpo Café" />,
};

export const Hover: Story = {
  tags: ['hover'],
  render: () => <BrandNameField defaultValue="Golpo Café" />,
};

/** Focus: a solid 2 px outline with a 2 px gap; ink in light mode, gold in dark (§21). */
export const Focus: Story = {
  tags: ['focus'],
  render: () => <BrandNameField defaultValue="Golpo Café" />,
};

export const Disabled: Story = {
  render: () => <BrandNameField defaultValue="Golpo Café" disabled />,
};

/** Loading: the value is being read, so it can't be edited yet. */
export const Loading: Story = {
  render: () => <BrandNameField placeholder="Golpo Café" readOnly aria-busy />,
};

/** Error: a red border and the text that says what to do, never colour alone. */
export const ErrorState: Story = {
  name: 'Error',
  render: () => <BrandNameField error="Add a brand name." />,
};

export const ErrorFocus: Story = {
  tags: ['focus'],
  render: () => <BrandNameField error="Add a brand name." />,
};
