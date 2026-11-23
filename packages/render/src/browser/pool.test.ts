import { describe, expect, it } from 'vitest';
import { RenderFailure } from './limits.ts';
import { BrowserCrashed, createBrowserPool } from './pool.ts';

type FakeBrowser = { id: number; closed: boolean; memory: number };

/** A pool over fake browsers: each launch makes a new numbered browser; `memory` is what the probe reads. */
function setup(
  options: { rendersPerBrowser?: number; browserMemoryBytes?: number; failLaunches?: number } = {},
) {
  const browsers: FakeBrowser[] = [];
  let failLaunches = options.failLaunches ?? 0;
  const pool = createBrowserPool<FakeBrowser>({
    launch: () => {
      if (failLaunches > 0) {
        failLaunches -= 1;
        return Promise.reject(new Error('Chromium didn’t start'));
      }
      const browser = { id: browsers.length + 1, closed: false, memory: 100 };
      browsers.push(browser);
      return Promise.resolve(browser);
    },
    close: (browser) => {
      browser.closed = true;
      return Promise.resolve();
    },
    memoryBytes: (browser) => Promise.resolve(browser.memory),
    rendersPerBrowser: options.rendersPerBrowser ?? 500,
    browserMemoryBytes: options.browserMemoryBytes ?? 1_000,
  });
  const idOf = (browser: FakeBrowser) => Promise.resolve(browser.id);
  return { pool, browsers, idOf };
}

describe('createBrowserPool: one browser per process', () => {
  it('opens the browser once and uses it for every render', async () => {
    const { pool, browsers, idOf } = setup();
    const ids = await Promise.all([pool.use(idOf), pool.use(idOf), pool.use(idOf)]);
    expect(ids).toEqual([1, 1, 1]);
    expect(browsers).toHaveLength(1);
  });

  it('closes its browser when the pool closes', async () => {
    const { pool, browsers, idOf } = setup();
    await pool.use(idOf);
    await pool.close();
    expect(browsers[0]?.closed).toBe(true);
  });
});

describe('createBrowserPool: the browser restarts', () => {
  it('after the configured number of renders (lowered to 3 here)', async () => {
    const { pool, browsers, idOf } = setup({ rendersPerBrowser: 3 });
    const ids: number[] = [];
    for (let i = 0; i < 7; i++) ids.push(await pool.use(idOf));
    expect(ids).toEqual([1, 1, 1, 2, 2, 2, 3]);
    expect(browsers.map((b) => b.closed)).toEqual([true, true, false]);
  });

  it('when its memory passes the configured limit', async () => {
    const { pool, browsers, idOf } = setup({ browserMemoryBytes: 1_000 });
    expect(await pool.use(idOf)).toBe(1);
    const first = browsers[0];
    if (first === undefined) throw new Error('no browser');
    first.memory = 1_000;
    expect(await pool.use(idOf)).toBe(1);
    first.memory = 1_001;
    expect(await pool.use(idOf)).toBe(1);
    expect(first.closed).toBe(true);
    expect(await pool.use(idOf)).toBe(2);
  });

  it('closes a retired browser only once the renders still running on it finish', async () => {
    const { pool, browsers, idOf } = setup({ rendersPerBrowser: 1 });
    let finish: () => void = () => undefined;
    const slow = pool.use(
      (browser) =>
        new Promise<number>((resolve) => {
          finish = () => {
            resolve(browser.id);
          };
        }),
    );
    // Wait for the slow render to start on browser 1.
    await new Promise((resolve) => setImmediate(resolve));
    expect(await pool.use(idOf)).toBe(1);
    // Browser 1 has reached its renders, but the slow one is still on it.
    expect(browsers[0]?.closed).toBe(false);
    expect(await pool.use(idOf)).toBe(2);
    finish();
    expect(await slow).toBe(1);
    expect(browsers[0]?.closed).toBe(true);
  });
});

describe('createBrowserPool: a crash retries once in a new browser', () => {
  it('runs the render again in a new browser and closes the one that crashed', async () => {
    const { pool, browsers } = setup();
    let attempts = 0;
    const id = await pool.use((browser) => {
      attempts += 1;
      if (attempts === 1) throw new BrowserCrashed('the page crashed');
      return Promise.resolve(browser.id);
    });
    expect(id).toBe(2);
    expect(browsers.map((b) => b.closed)).toEqual([true, false]);
  });

  it('fails with a plain reason when the new browser crashes too', async () => {
    const { pool, browsers } = setup();
    const error: unknown = await pool
      .use(() => Promise.reject(new BrowserCrashed('the page crashed')))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RenderFailure);
    expect((error as RenderFailure).reason).toBe(
      'The render browser crashed twice on this slide, so it wasn’t rendered',
    );
    expect(browsers).toHaveLength(2);
    expect(browsers.every((b) => b.closed)).toBe(true);
  });

  it('treats a browser that won’t start like a crash, and says so plainly when it fails twice', async () => {
    const once = setup({ failLaunches: 1 });
    expect(await once.pool.use(once.idOf)).toBe(1);

    const twice = setup({ failLaunches: 2 });
    const error: unknown = await twice.pool.use(twice.idOf).catch((e: unknown) => e);
    expect((error as RenderFailure).reason).toBe(
      'The render browser didn’t start, so the slide wasn’t rendered',
    );
    // The launch's own error is kept, for whoever reads the worker's error.
    expect(((error as RenderFailure).cause as Error).message).toBe('Chromium didn’t start');
  });

  it('doesn’t retry an error that isn’t a crash', async () => {
    const { pool, browsers } = setup();
    let attempts = 0;
    const error: unknown = await pool
      .use(() => {
        attempts += 1;
        return Promise.reject(new RenderFailure('The slide didn’t finish rendering within 20 s'));
      })
      .catch((e: unknown) => e);
    expect((error as RenderFailure).reason).toBe('The slide didn’t finish rendering within 20 s');
    expect(attempts).toBe(1);
    expect(browsers).toHaveLength(1);
  });
});
