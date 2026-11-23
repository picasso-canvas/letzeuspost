import { z } from 'zod';

export const LAYOUT_NAMES = [] as const;
export type LayoutName = never;
export const slideSchemas: Record<string, z.ZodType> = {};
export const SlideSchema = z.never();
export type Slide = never;
