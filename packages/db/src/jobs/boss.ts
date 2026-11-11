// pg-boss on the same Postgres (§13 Jobs, #72). Its tables live in their own `pgboss` schema, which the owner role
// installs (`installJobs`, beside the migrations) and the app role only uses (`createJobs`): the app role can't create
// a schema or change pg-boss's tables, nor a queue's policy or the commands pg-boss runs (`appGrants`), so a job can't
// change the queue's structure or policy either. pg-boss stays inside this package, like the database client; the
// worker gets `send` and `work`.
//
// A handler gets the payload and `db.forWorkspace` for the payload's workspace, the only database handle it has, so
// every row it reads or writes is that workspace's (row-level security, the tenant-isolation skill).
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import type { Db, Scoped, Tx } from '../db.ts';
import {
  checkPayload,
  JobPayloadError,
  queueNames,
  queues,
  workspaceOf,
  type Payload,
  type QueueName,
  type WorkspaceQueue,
} from './queues.ts';

/** §13: the job queue keeps its own tables in a separate schema. */
export const JOBS_SCHEMA = 'pgboss';

/** What a handler is given for one job. */
export interface JobContext<Q extends QueueName> {
  readonly jobId: string;
  readonly payload: Payload<Q>;
  /**
   * `db.forWorkspace` for the payload's workspace. An account queue's job (`account-email`) runs in no workspace and
   * gets none: its handler reaches its row through packages/auth.
   */
  readonly db: Q extends WorkspaceQueue ? Scoped : null;
  /** How many times this job has been retried before this run (0 on the first run). */
  readonly retryCount: number;
  /** True on the last run the retry limit allows: a failure now is final. */
  readonly lastAttempt: boolean;
}

export type JobHandler<Q extends QueueName> = (job: JobContext<Q>) => Promise<void>;

export interface Jobs {
  /** Connects and checks that the owner role has installed pg-boss at this version. */
  start: () => Promise<void>;
  /** Lets running jobs finish (up to 30 s), then closes the pool. */
  stop: () => Promise<void>;
  /**
   * Queues a job after checking its payload holds ids only. Given `tx`, the job is written in that transaction, so it
   * exists exactly when the rows it works on do.
   */
  send: <Q extends QueueName>(
    queue: Q,
    payload: Payload<Q>,
    options?: { tx?: Tx },
  ) => Promise<string>;
  /** Runs `handler` for each job of the queue, with the queue's concurrency (§13: `ai` 4 per workspace). */
  work: <Q extends QueueName>(queue: Q, handler: JobHandler<Q>) => Promise<void>;
}

export interface JobsOptions {
  /** The app role's DATABASE_URL. */
  readonly url: string;
  readonly db: Db;
  /**
   * pg-boss's own errors (a lost connection, a failed maintenance pass). Required, so no caller falls back to printing
   * pg-boss's messages, which can quote SQL: log the error's name and code, as the worker does.
   */
  readonly onError: (error: Error) => void;
  /** How often an idle worker looks for jobs; pg-boss's default is 2 s. */
  readonly pollingIntervalSeconds?: number;
}

export function createJobs({ url, db, onError, pollingIntervalSeconds }: JobsOptions): Jobs {
  const boss = new PgBoss({
    connectionString: url,
    schema: JOBS_SCHEMA,
    application_name: 'lzp-jobs',
    // The owner role installs and migrates (installJobs); here pg-boss only checks the version it finds.
    migrate: false,
    // Rebuilding indexes needs their owner; the scheduled jobs come with their features.
    reindex: false,
    schedule: false,
  });
  boss.on('error', onError);

  return {
    start: async () => {
      await boss.start();
    },
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
    send: async (queue, payload, options = {}) => {
      const data = checkPayload(queue, payload);
      const workspaceId = workspaceOf(data);
      const id = await boss.send(queue, data, {
        // Each job belongs to its workspace's group; the ai queue's worker runs at most 4 of a group at once. An
        // account queue's job belongs to no workspace, so to no group.
        ...(workspaceId === null ? {} : { group: { id: workspaceId } }),
        ...(options.tx === undefined ? {} : { db: fromDrizzle(options.tx, sql) }),
      });
      if (id === null) throw new Error(`${queue} job was not queued`);
      return id;
    },
    work: async (queue, handler) => {
      await boss.work(
        queue,
        {
          ...queues[queue].work,
          batchSize: 1,
          includeMetadata: true,
          ...(pollingIntervalSeconds === undefined ? {} : { pollingIntervalSeconds }),
        },
        async (batch) => {
          for (const job of batch) {
            const payload = payloadOf(queue, job);
            const workspaceId = workspaceOf(payload);
            await handler({
              jobId: job.id,
              payload,
              db: (workspaceId === null
                ? null
                : db.forWorkspace({ workspaceId })) as JobContext<typeof queue>['db'],
              retryCount: job.retryCount,
              lastAttempt: job.retryCount >= job.retryLimit,
            });
          }
        },
      );
    },
  };
}

/**
 * The payload of a job pg-boss handed over, checked before the handler sees it (Cerberus F1 on #202). The job's row
 * sits in tables that hold every workspace's jobs, so its workspace isn't taken on trust:
 * - the payload must hold exactly the queue's ids (`checkPayload`), the workspace's among them;
 * - the job's group must be that workspace, as `send` writes it (none for an account queue's, which has no workspace). A job whose group differs wasn't queued by `send`
 *   (or was changed since), and would count against another workspace's concurrency limit (`ai`: 4 per workspace).
 * Neither proves who wrote the row: lzp_app can write any job (the grants below). What keeps another workspace's data
 * out is the handler's database handle, `db.forWorkspace` for this workspace under row-level security: a forged job
 * that names B's workspace reaches only B's rows, through steps that are safe to run again (the jobs skill).
 */
export function payloadOf<Q extends QueueName>(
  queue: Q,
  job: { readonly data: unknown; readonly groupId?: string | null },
): Payload<Q> {
  const payload = checkPayload(queue, job.data);
  // An account queue's payload has no workspace, and its job no group (`send`).
  if ((job.groupId ?? null) !== workspaceOf(payload)) {
    throw new JobPayloadError(`${queue} job refused: its group is not its payload's workspace`);
  }
  return payload;
}

/** An advisory lock held while granting; any fixed number, this one the task's (the migrations hold 71). */
const GRANTS_LOCK = 72;

/**
 * The columns of pg-boss 12.38's `queue` table that a running instance writes: each queue's counts, kept by its
 * monitor pass, and the stamps by which instances take turns at the monitor and maintenance passes (`plans.js`:
 * trySetQueueMonitorTime, trySetQueueDeletionTime, cacheQueueStats, setRetainedCount). The rest of the row is the
 * queue's policy (its retry bounds, expiry, retention, dead letter), which only `installJobs` sets.
 */
const QUEUE_BOOKKEEPING = [
  'deferred_count',
  'blocked_count',
  'queued_count',
  'ready_count',
  'active_count',
  'failed_count',
  'total_count',
  'retained_count',
  'retained_on',
  'created_delta',
  'completed_delta',
  'failed_delta',
  'delta_on',
  'delta_seconds',
  'wait_bins',
  'run_bins',
  'ready_oldest_seconds',
  'ready_history',
  'singletons_active',
  'monitor_claim_on',
  'monitor_on',
  'maintain_on',
] as const;

/** The columns of `version` a running instance stamps (trySetTimestamp, setMonitorBackoff); never `version` itself. */
const VERSION_BOOKKEEPING = [
  'cron_on',
  'bam_on',
  'flow_on',
  'reindex_on',
  'monitor_backoff_on',
] as const;

/**
 * What the app role (lzp_app) may do in pg-boss's schema, as one statement list (one transaction), under the lock
 * that makes two installs at once take turns (Postgres refuses two GRANTs racing on one object).
 *
 * Rows of the job tables, never the schema or a table's structure, which stay the owner's. On `queue` and `version`
 * only what a running pg-boss writes (Cerberus F1 on #197): a queue's policy (its retry bounds, expiry and dead
 * letter), the list of queues and pg-boss's version are the owner's, so the app role can't change the bounds the
 * queue gives each job it takes. A queued job carries its own copy of them (`retry_limit`, `expire_seconds` on its
 * row), and those stay writable by the role that sends jobs, like the rest of the job's row (Cerberus F2 on #203).
 *
 * Nothing at all on `bam`, `schedule` and `subscription` (Cerberus F1 on #203). pg-boss 12.38 runs `bam`'s commands
 * as SQL in an instance started with `migrate` on (index.js: `if (this.#config.migrate) await this.#bam.start()`),
 * which only `installJobs`, as the owner, is; so a row the app role planted there would run as the owner. The app
 * role's instance (`createJobs`: `migrate`, `schedule` off) never writes the three (plans.js): `bam` is written by
 * pg-boss's migrations (`job_table_run_async`), the `bam` runner and `deleteQueue()`; `schedule` by `schedule()`,
 * `unschedule()` and the cron pass (timekeeper.js, started only `if (this.#config.schedule)`); `subscription` by
 * `subscribe()` and `unsubscribe()`. createJobs calls none of them. It still reads them (its start-up check reads
 * `bam`: `getIncompleteBamCommands`).
 *
 * Every write is taken back first, so an install brings an older database's grants down to these.
 *
 * The job tables are cross-workspace by design: one queue serves every workspace, so they carry no row-level security,
 * and lzp_app can read and change any workspace's jobs. That is acceptable because a payload holds ids only (never
 * content: queues.ts), the queue is reached only through this package (pg-boss stays inside it, like the database
 * client), and a handler reads and writes only through `db.forWorkspace` for the job's workspace, under row-level
 * security (`payloadOf`).
 */
export function appGrants(): string {
  const s = JOBS_SCHEMA;
  return `SELECT pg_advisory_xact_lock(${String(GRANTS_LOCK)});
    GRANT USAGE ON SCHEMA ${s} TO lzp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO lzp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO lzp_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${s}.queue, ${s}.version FROM lzp_app;
    GRANT UPDATE (${QUEUE_BOOKKEEPING.join(', ')}) ON ${s}.queue TO lzp_app;
    GRANT UPDATE (${VERSION_BOOKKEEPING.join(', ')}) ON ${s}.version TO lzp_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${s}.bam, ${s}.schedule, ${s}.subscription FROM lzp_app;`;
}

/**
 * Installs or migrates pg-boss in the `pgboss` schema as the owner role (DATABASE_OWNER_URL), declares the queues with
 * their retry bounds, and lets the app role (lzp_app) use them: rows only, never the schema. Safe to run again and
 * at the same time as another run (pg-boss and the grants each take an advisory lock). Run it with the migrations.
 */
export async function installJobs(ownerUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: ownerUrl,
    schema: JOBS_SCHEMA,
    application_name: 'lzp-jobs-install',
    max: 2,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  let failure: Error | undefined;
  boss.on('error', (error: Error) => {
    failure ??= error;
  });
  await boss.start();
  try {
    for (const name of queueNames) {
      // createQueue leaves an existing queue as it is; updateQueue brings its retry bounds up to date.
      await boss.createQueue(name, queues[name].queue);
      await boss.updateQueue(name, queues[name].queue);
    }
    await boss.getDb().executeSql(appGrants());
  } finally {
    await boss.stop({ graceful: false });
  }
  if (failure !== undefined) throw failure;
}
