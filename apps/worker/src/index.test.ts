// The worker has no port, so Playwright (playwright.config.ts) counts it as started once its stdout matches a ready
// line. Without one the app's end-to-end run waited 60 s and failed (#172). Read as text: neither file runs here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const entry = readFileSync(new URL('index.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../../../playwright.config.ts', import.meta.url), 'utf8');

describe('the worker says when it is ready', () => {
  it('logs "worker ready" once startWorker has returned', () => {
    const started = entry.indexOf('await startWorker(');
    const ready = entry.indexOf("log('worker ready')");
    expect(started).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(started);
  });

  it("matches what playwright.config.ts waits for on the worker's stdout", () => {
    const wait = /wait:\s*\{\s*stdout:\s*\/([^/]+)\//.exec(config)?.[1];
    expect(wait).toBeDefined();
    const line = JSON.stringify({ at: new Date().toISOString(), event: 'worker ready' });
    expect(new RegExp(wait ?? '(?!)').test(line)).toBe(true);
  });
});
