import type { BrowserContextOptions, LaunchOptions } from 'playwright-core';
import { SIZES, type SizeName } from '../sizes.ts';

// The render browser's fixed flags, in one place (§08 Chrome in Docker): the same browser, flags and page settings for
// every render, so the same page gives the same pixels on every machine that runs the pinned Chromium.

export const CHROMIUM_ARGS: readonly string[] = [
  // 1× scale, colours forced to sRGB, no font hinting, no scrollbars (§08).
  '--force-device-scale-factor=1',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--hide-scrollbars',
  // The render browser has no internet (§08 Security). The request filter (`requests.ts`) is the wall; behind it, no
  // host name resolves and every connection goes to a proxy that isn't there (the discard port on loopback).
  '--host-resolver-rules=MAP * ~NOTFOUND',
  // Nothing the page doesn't draw: no background work, updates, sync or crash uploads.
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--no-first-run',
  '--no-pings',
];

export const LAUNCH_OPTIONS: LaunchOptions = {
  headless: true,
  args: [...CHROMIUM_ARGS],
  proxy: { server: 'http://127.0.0.1:9' },
};

/** A fresh context's settings for one page: its pixel size at 1×, light, still, in UTC and one locale, no storage. */
export function contextOptions(size: SizeName): BrowserContextOptions {
  const { width, height } = SIZES[size];
  return {
    viewport: { width, height },
    screen: { width, height },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    forcedColors: 'none',
    timezoneId: 'UTC',
    locale: 'en-US',
    javaScriptEnabled: true,
    serviceWorkers: 'block',
    acceptDownloads: false,
    bypassCSP: false,
    offline: false,
  };
}
