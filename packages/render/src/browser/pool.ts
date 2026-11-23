import { RenderFailure } from './limits.ts';

// One render browser per process (§08 Chrome in Docker), shared by every render. It restarts after a number of renders
// and whenever its memory passes a limit; a render that crashes it runs once more in a new browser. A retired browser
// is closed once the renders still running on it finish. The pool knows nothing of Playwright: `runner.ts` gives it
// the launch, close and memory probe, and the tests give it fake browsers.

/** Thrown by a render when the browser or its page crashed: the pool retries it once in a new browser. */
export class BrowserCrashed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserCrashed';
  }
}

export type PoolOptions<B> = {
  launch: () => Promise<B>;
  close: (browser: B) => Promise<void>;
  /** The browser's memory in bytes, or undefined when it can't be read. */
  memoryBytes: (browser: B) => Promise<number | undefined>;
  rendersPerBrowser: number;
  browserMemoryBytes: number;
};

export type BrowserPool<B> = {
  /** Runs `job` on the browser; a crash runs it once more in a new one, then fails with a plain reason. */
  use: <T>(job: (browser: B) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

type Slot<B> = { browser: B; inFlight: number; renders: number; retired: boolean; closed: boolean };

class LaunchFailed extends Error {}

export function createBrowserPool<B>(options: PoolOptions<B>): BrowserPool<B> {
  let current: Promise<Slot<B>> | undefined;

  function launch(): Promise<Slot<B>> {
    const launching = options.launch().then(
      (browser): Slot<B> => ({ browser, inFlight: 0, renders: 0, retired: false, closed: false }),
      (error: unknown) => {
        throw new LaunchFailed('The render browser didn’t start', { cause: error });
      },
    );
    launching.catch(() => {
      if (current === launching) current = undefined;
    });
    return launching;
  }

  /** The browser in service, launched if there is none; the caller's render is counted on it before it returns. */
  async function acquire(): Promise<Slot<B>> {
    for (;;) {
      current ??= launch();
      const pending = current;
      const slot = await pending;
      if (!slot.retired) {
        slot.inFlight += 1;
        return slot;
      }
      if (current === pending) current = undefined;
    }
  }

  async function closeIfDone(slot: Slot<B>): Promise<void> {
    if (!slot.retired || slot.inFlight > 0 || slot.closed) return;
    slot.closed = true;
    await options.close(slot.browser).catch(() => undefined);
  }

  async function finish(slot: Slot<B>, crashed: boolean): Promise<void> {
    slot.inFlight -= 1;
    if (crashed) slot.retired = true;
    else {
      slot.renders += 1;
      if (slot.renders >= options.rendersPerBrowser) slot.retired = true;
      else if (!slot.retired) {
        const bytes = await options.memoryBytes(slot.browser).catch(() => undefined);
        if (bytes !== undefined && bytes > options.browserMemoryBytes) slot.retired = true;
      }
    }
    await closeIfDone(slot);
  }

  return {
    async use(job) {
      let last: 'crash' | 'launch' = 'crash';
      for (let attempt = 0; attempt < 2; attempt++) {
        let slot: Slot<B>;
        try {
          slot = await acquire();
        } catch (error) {
          if (!(error instanceof LaunchFailed)) throw error;
          last = 'launch';
          continue;
        }
        let crashed = false;
        try {
          return await job(slot.browser);
        } catch (error) {
          if (!(error instanceof BrowserCrashed)) throw error;
          crashed = true;
          last = 'crash';
        } finally {
          await finish(slot, crashed);
        }
      }
      throw new RenderFailure(
        last === 'launch'
          ? 'The render browser didn’t start, so the slide wasn’t rendered'
          : 'The render browser crashed twice on this slide, so it wasn’t rendered',
      );
    },

    async close() {
      const pending = current;
      current = undefined;
      const slot = await pending?.catch(() => undefined);
      if (slot === undefined) return;
      slot.retired = true;
      await closeIfDone(slot);
    },
  };
}
