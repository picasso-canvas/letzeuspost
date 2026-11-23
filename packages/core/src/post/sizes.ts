// The five sizes of §07 with their pixels. A post has one design, rendered in each size its networks need.
export const SIZE_NAMES = ['portrait', 'square', 'story', 'landscape', 'pin'] as const;

export type SizeName = (typeof SIZE_NAMES)[number];

export const SIZES: Record<SizeName, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1200, height: 675 },
  pin: { width: 1000, height: 1500 },
};
