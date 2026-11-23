import type { BrowserContextOptions, LaunchOptions } from 'playwright-core';
import type { SizeName } from '../sizes.ts';

export const CHROMIUM_ARGS: readonly string[] = [];

export const LAUNCH_OPTIONS: LaunchOptions = {};

export function contextOptions(_size: SizeName): BrowserContextOptions {
  return {};
}
