import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIZE_NAMES, SIZES } from '../sizes.ts';
import {
  CHROMIUM_ARGS,
  contextOptions,
  LAUNCH_OPTIONS,
  SANDBOX_OFF_FLAGS,
  sandboxOffFlag,
} from './flags.ts';

const manifest = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

describe('the render browser’s version', () => {
  it('is playwright-core at the exact version of the root’s @playwright/test', () => {
    const own = manifest('../../package.json').dependencies?.['playwright-core'];
    const root = manifest('../../../../package.json').devDependencies?.['@playwright/test'];
    expect(own).toMatch(/^\d+\.\d+\.\d+$/);
    expect(own).toBe(root);
  });
});

describe('the fixed flags (§08 Chrome in Docker)', () => {
  it('draws at 1x, in sRGB, with no font hinting and no scrollbars', () => {
    expect(CHROMIUM_ARGS).toEqual(
      expect.arrayContaining([
        '--force-device-scale-factor=1',
        '--force-color-profile=srgb',
        '--font-render-hinting=none',
        '--hide-scrollbars',
      ]),
    );
    expect(LAUNCH_OPTIONS.args).toEqual(CHROMIUM_ARGS);
  });

  it('resolves no host name and sends anything that slips past the request filter to a proxy that isn’t there', () => {
    expect(CHROMIUM_ARGS).toContain('--host-resolver-rules=MAP * ~NOTFOUND');
    expect(LAUNCH_OPTIONS.proxy?.server).toBe('http://127.0.0.1:9');
    expect(LAUNCH_OPTIONS.headless).toBe(true);
  });

  it('starts Chromium with its OS sandbox on, so Playwright adds no --no-sandbox (§08 Security, #350)', () => {
    expect(LAUNCH_OPTIONS.chromiumSandbox).toBe(true);
    expect(CHROMIUM_ARGS).not.toContain('--no-sandbox');
  });

  it('lets WebRTC send no UDP outside the proxy, so a STUN server at an IP address can’t be reached', () => {
    expect(CHROMIUM_ARGS).toEqual(
      expect.arrayContaining([
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      ]),
    );
  });

  it.each(SIZE_NAMES)(
    'opens a %s page at its pixel size, at 1x, the same way every time',
    (size) => {
      const options = contextOptions(size);
      expect(options.viewport).toEqual({ width: SIZES[size].width, height: SIZES[size].height });
      expect(options.deviceScaleFactor).toBe(1);
      expect(options).toMatchObject({
        colorScheme: 'light',
        reducedMotion: 'reduce',
        timezoneId: 'UTC',
        locale: 'en-US',
        serviceWorkers: 'block',
        acceptDownloads: false,
        bypassCSP: false,
        isMobile: false,
      });
      expect(options.storageState).toBeUndefined();
    },
  );
});

describe('the sandbox-off switches (#383)', () => {
  it('finds each of them on a command line, with or without a value, and nothing else', () => {
    for (const flag of SANDBOX_OFF_FLAGS) {
      expect(sandboxOffFlag(['chrome', flag])).toBe(flag);
      expect(sandboxOffFlag(['chrome', `${flag}=1`])).toBe(flag);
    }
    expect(sandboxOffFlag(['chrome', '--hide-scrollbars', '--type=renderer'])).toBeUndefined();
  });

  it('are not among the render browser’s own arguments', () => {
    expect(sandboxOffFlag(LAUNCH_OPTIONS.args ?? [])).toBeUndefined();
    expect(LAUNCH_OPTIONS.chromiumSandbox).toBe(true);
  });
});
