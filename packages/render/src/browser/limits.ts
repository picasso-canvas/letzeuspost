export const RENDER_LIMITS = {
  slideMs: 0,
  postMs: 0,
  rendersPerBrowser: 0,
  browserMemoryBytes: 0,
} as const;

export class RenderFailure extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'RenderFailure';
    this.reason = reason;
  }
}

export function formatLimit(_ms: number): string {
  throw new Error('not built yet');
}

export function postDeadline(_start: number): number {
  throw new Error('not built yet');
}

export function slideBudget(_input: { now: number; deadline?: number; slideMs: number }): {
  ms: number;
  reason: string;
} {
  throw new Error('not built yet');
}

export function withTimeout<T>(_work: Promise<T>, _ms: number, _reason: string): Promise<T> {
  throw new Error('not built yet');
}
