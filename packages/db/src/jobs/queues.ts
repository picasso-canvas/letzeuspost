// Stub: the queues come in the next commit.
export class JobPayloadError extends Error {}

export const queues = {} as Record<
  string,
  {
    queue: { retryLimit: number; retryDelay: number; retryBackoff: boolean; retryDelayMax: number };
    work: { groupConcurrency?: number; localConcurrency?: number };
  }
> & { ai: { work: { groupConcurrency?: number; localConcurrency?: number } } };

export const queueNames: readonly string[] = [];

export function checkPayload(_name: string, payload: unknown): unknown {
  return payload;
}
