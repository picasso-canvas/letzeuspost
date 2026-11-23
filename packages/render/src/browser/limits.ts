// The render limits (§08 Chrome in Docker): 20 s per slide, 2 minutes per post, a new browser every 500 renders and
// whenever its memory passes its limit. The memory limit is a starting value; §14 sizes the server from the memory per
// page measured in M1, and this is the one place to change it.
export const RENDER_LIMITS = {
  slideMs: 20_000,
  postMs: 120_000,
  rendersPerBrowser: 500,
  browserMemoryBytes: 2 * 1024 ** 3,
} as const;

/** A render that failed for a reason a person can read: the reason is shown as it is (§11 `Failed`). */
export class RenderFailure extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'RenderFailure';
    this.reason = reason;
  }
}

/** `20 s`, `1.5 s`, `1 minute`, `2 minutes`. */
export function formatLimit(ms: number): string {
  if (ms < 60_000) return `${String(ms / 1000)} s`;
  const minutes = ms / 60_000;
  return `${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
}

/** When a post started at `start` (epoch ms) must be done. */
export const postDeadline = (start: number): number => start + RENDER_LIMITS.postMs;

/** The time a slide may take: its own limit, or what is left of the post's when that is less. */
export function slideBudget(input: { now: number; deadline?: number; slideMs: number }): {
  ms: number;
  reason: string;
} {
  const { now, deadline, slideMs } = input;
  if (deadline !== undefined && deadline - now < slideMs)
    return {
      ms: Math.max(0, deadline - now),
      reason: `The post didn’t finish rendering within ${formatLimit(RENDER_LIMITS.postMs)}`,
    };
  return { ms: slideMs, reason: `The slide didn’t finish rendering within ${formatLimit(slideMs)}` };
}

/** `work`, or a `RenderFailure` with `reason` once `ms` have passed (at once when there are none). */
export function withTimeout<T>(work: Promise<T>, ms: number, reason: string): Promise<T> {
  if (ms <= 0) {
    work.catch(() => undefined);
    return Promise.reject(new RenderFailure(reason));
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RenderFailure(reason));
    }, ms);
  });
  return Promise.race([work, late]).finally(() => {
    clearTimeout(timer);
  });
}
