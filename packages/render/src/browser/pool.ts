export class BrowserCrashed extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserCrashed';
  }
}

export type PoolOptions<B> = {
  launch: () => Promise<B>;
  close: (browser: B) => Promise<void>;
  memoryBytes: (browser: B) => Promise<number | undefined>;
  rendersPerBrowser: number;
  browserMemoryBytes: number;
};

export type BrowserPool<B> = {
  use: <T>(job: (browser: B) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

export function createBrowserPool<B>(_options: PoolOptions<B>): BrowserPool<B> {
  return {
    use: () => Promise.reject(new Error('not built yet')),
    close: () => Promise.reject(new Error('not built yet')),
  };
}
