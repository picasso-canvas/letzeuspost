import { describe, expect, it } from 'vitest';
import {
  formatLimit,
  postDeadline,
  RENDER_LIMITS,
  RenderFailure,
  slideBudget,
  withTimeout,
} from './limits.ts';

describe('RENDER_LIMITS: §08’s limits', () => {
  it('gives a slide 20 s, a post 2 minutes and a browser 500 renders', () => {
    expect(RENDER_LIMITS.slideMs).toBe(20_000);
    expect(RENDER_LIMITS.postMs).toBe(120_000);
    expect(RENDER_LIMITS.rendersPerBrowser).toBe(500);
    expect(RENDER_LIMITS.browserMemoryBytes).toBeGreaterThan(0);
  });
});

describe('formatLimit: a limit as a person reads it', () => {
  it('says seconds under a minute and minutes from one minute', () => {
    expect(formatLimit(20_000)).toBe('20 s');
    expect(formatLimit(1_500)).toBe('1.5 s');
    expect(formatLimit(60_000)).toBe('1 minute');
    expect(formatLimit(120_000)).toBe('2 minutes');
  });
});

describe('slideBudget: a slide gets its own limit, or what is left of the post’s', () => {
  const slideMs = 20_000;

  it('gives the slide limit when the post has more time left than that, or no deadline', () => {
    expect(slideBudget({ now: 0, slideMs })).toEqual({
      ms: 20_000,
      reason: 'The slide didn’t finish rendering within 20 s',
    });
    expect(slideBudget({ now: 0, deadline: postDeadline(0), slideMs }).ms).toBe(20_000);
  });

  it('gives only what is left of the post’s 2 minutes near its end, and nothing once it has passed', () => {
    const deadline = postDeadline(1_000);
    expect(deadline).toBe(121_000);
    expect(slideBudget({ now: 115_000, deadline, slideMs })).toEqual({
      ms: 6_000,
      reason: 'The post didn’t finish rendering within 2 minutes',
    });
    expect(slideBudget({ now: 121_000, deadline, slideMs }).ms).toBe(0);
    expect(slideBudget({ now: 130_000, deadline, slideMs }).ms).toBe(0);
  });
});

describe('withTimeout: work that never finishes stops at its limit', () => {
  it('fails with the plain reason once the limit passes', async () => {
    const never = new Promise<string>(() => undefined);
    const started = Date.now();
    const error: unknown = await withTimeout(never, 30, 'The slide didn’t finish').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RenderFailure);
    expect((error as RenderFailure).reason).toBe('The slide didn’t finish');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('fails at once with no time left, and passes on what finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(1), 0, 'none left')).rejects.toThrow('none left');
    await expect(withTimeout(Promise.resolve('done'), 1_000, 'late')).resolves.toBe('done');
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'late')).rejects.toThrow(
      'boom',
    );
  });
});
