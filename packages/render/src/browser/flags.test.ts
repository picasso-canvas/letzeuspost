import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIZE_NAMES, SIZES } from '../sizes.ts';
import { CHROMIUM_ARGS, contextOptions, LAUNCH_OPTIONS } from './flags.ts';

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

  it.each(SIZE_NAMES)('opens a %s page at its pixel size, at 1x, the same way every time', (size) => {
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
  });
});
