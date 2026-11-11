import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@lzp/ui/components/avatar';
import portrait from '../gallery/portrait.svg';

// A member's avatar: a photo in the three sizes, initials when there's no photo or it fails to load (the error
// state), and a group with a count. The photo is a local drawing, so nothing loads from the web. An avatar isn't
// interactive: hover, focus and disabled belong to whatever wraps it.
const meta = {
  title: 'Components/Avatar',
  component: Avatar,
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

const sizes = ['sm', 'default', 'lg'] as const;
const row = 'flex items-center gap-4';

/** Default: a photo, small, default and large. */
export const Photo: Story = {
  render: () => (
    <div className={row}>
      {sizes.map((size) => (
        <Avatar key={size} size={size}>
          <AvatarImage src={portrait} alt="Rumana Akter" />
          <AvatarFallback>RA</AvatarFallback>
        </Avatar>
      ))}
    </div>
  ),
};

/** No photo, or it failed to load: the member's initials. */
export const Initials: Story = {
  render: () => (
    <div className={row}>
      {sizes.map((size) => (
        <Avatar key={size} size={size}>
          <AvatarFallback>RA</AvatarFallback>
        </Avatar>
      ))}
    </div>
  ),
};

/** Who's on a brand: three faces and how many more. */
export const Group: Story = {
  render: () => (
    <AvatarGroup>
      <Avatar>
        <AvatarImage src={portrait} alt="Rumana Akter" />
        <AvatarFallback>RA</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>TH</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>SK</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  ),
};
