import { z } from 'zod';

// Stub: the tests come first (the real shape follows in the next commit).
export const SOURCE_KINDS: string[] = [];
export const CONFIDENCES: string[] = [];
export const BrandKitSchema = z.strictObject({});
export type BrandKit = z.infer<typeof BrandKitSchema> & Record<string, Record<string, unknown>>;
