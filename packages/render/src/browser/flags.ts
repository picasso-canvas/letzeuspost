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
  // WebRTC passes neither the filter nor the resolver: it may send no UDP except through the proxy, so no STUN to an IP
  // address. The switch under both of the names Chromium's builds read.
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  // Nothing the page doesn't draw: no background work, updates, sync or crash uploads.
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--disable-sync',
  '--no-first-run',
  '--no-pings',
];

/** The switches that turn a part of Chromium's sandbox off: none may be on the render browser's command line (#383). */
export const SANDBOX_OFF_FLAGS: readonly string[] = [
  '--no-sandbox',
  '--disable-seccomp-filter-sandbox',
  '--disable-namespace-sandbox',
  '--disable-setuid-sandbox',
  '--no-zygote',
];

/** The first sandbox-off switch on a command line, or undefined. */
export function sandboxOffFlag(argv: readonly string[]): string | undefined {
  return argv
    .map((arg) => arg.split('=')[0] ?? '')
    .find((name) => SANDBOX_OFF_FLAGS.includes(name));
}

export const LAUNCH_OPTIONS: LaunchOptions = {
  headless: true,
  // Chromium's OS sandbox (§08 Security, #350): a renderer exploit through a hostile font or image stays inside it, not
  // with the worker's rights. Playwright turns it off unless asked; it needs unprivileged user namespaces on the host.
  chromiumSandbox: true,
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
