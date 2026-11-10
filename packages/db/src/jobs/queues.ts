// The job queues (§13 Jobs, the jobs skill, #72). Every payload holds ids only, never content: the workspace's, which
// the job runs in (`db.forWorkspace`), and the ids of what it works on. The handler loads everything else from the
// database, so a retried job reads the current rows, and no post text or address ever sits in the queue's tables.
// The handlers live in apps/worker (Q7); the ai, render, fetch and export handlers come with their features, which
// may add ids to their payloads here, never content.
import { z } from 'zod';

const id = z.uuidv7();

/**
 * Bounded retries with backoff (§13), the same for every queue until a feature's section gives its own numbers. With
 * pg-boss's backoff the waits are about 30-60 s, 1-2 min and 2-4 min: a job that keeps failing stops after 4 tries,
 * within the 15 minutes after which §14's monitoring calls a job stuck.
 */
const retry = { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 600 } as const;

export const queues = {
  /** Each §09 task, one post (or a batch's plan) at a time. */
  ai: {
    payload: z.strictObject({ workspaceId: id, batchId: id, postId: id.optional() }),
    queue: retry,
    // §13: at most 4 posts at a time per workspace, by pg-boss's group concurrency (one group per workspace), with
    // room on the worker for another workspace's jobs while one workspace has its 4 running. The in-process limit is
    // exact in the one worker §13 runs; pg-boss's database-tracked one (groupConcurrency) takes no lock, so fetches at
    // the same moment can start a fifth. With more than one worker (not in the MVP), each would allow 4.
    work: { localGroupConcurrency: 4, localConcurrency: 8 },
  },
  render: {
    payload: z.strictObject({ workspaceId: id, postId: id, postVersionId: id }),
    queue: retry,
    work: {},
  },
  /** The worker asks the fetcher to read a brand's site or a batch's links (§06, §13). */
  fetch: {
    payload: z.strictObject({ workspaceId: id, brandId: id, batchId: id.optional() }),
    queue: retry,
    work: {},
  },
  export: {
    payload: z.strictObject({ workspaceId: id, exportId: id }),
    queue: retry,
    work: {},
  },
  /** One `email_message` row of the outbox. */
  email: {
    payload: z.strictObject({ workspaceId: id, emailMessageId: id }),
    queue: retry,
    work: {},
  },
} as const satisfies Record<
  string,
  {
    payload: z.ZodType<{ workspaceId: string }>;
    queue: typeof retry;
    work: { localGroupConcurrency?: number; localConcurrency?: number };
  }
>;

export type QueueName = keyof typeof queues;
export type Payload<Q extends QueueName> = z.infer<(typeof queues)[Q]['payload']>;

export const queueNames = Object.keys(queues) as readonly QueueName[];

/** A payload a queue refuses. Its message names the fields at fault, never their values. */
export class JobPayloadError extends Error {
  override name = 'JobPayloadError';
}

/** The payload, if it holds exactly the queue's ids; otherwise a JobPayloadError. */
export function checkPayload<Q extends QueueName>(name: Q, payload: unknown): Payload<Q> {
  const result = queues[name].payload.safeParse(payload);
  if (result.success) return result.data as Payload<Q>;
  const fields = result.error.issues.flatMap((issue) =>
    issue.code === 'unrecognized_keys' ? issue.keys : [issue.path.join('.') || 'payload'],
  );
  throw new JobPayloadError(
    `${name} job refused: a payload holds ids only (check ${[...new Set(fields)].join(', ')})`,
  );
}
