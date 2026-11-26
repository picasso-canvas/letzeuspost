// pg-boss on the same Postgres (§13 Jobs, #72). Its tables live in their own `pgboss` schema, which the owner role
// installs (`installJobs`, beside the migrations) and the app role only uses (`createJobs`): the app role can't create
// a schema or change pg-boss's tables, nor a queue's policy or the commands pg-boss runs (`appGrants`; on `bam`, from
// before pg-boss starts, `bamGuard`), so a job can't change the queue's structure or policy either. pg-boss stays inside this package, like the database client; the
// worker gets `send`, `work` and, for the email sweep, `failedWorkspaces`.
//
// A handler gets the payload and `db.forWorkspace` for the payload's workspace, the only database handle it has, so
// every row it reads or writes is that workspace's (row-level security, the tenant-isolation skill).
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { fromDrizzle, PgBoss } from 'pg-boss';
import { z } from 'zod';
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

const uuidv7 = z.uuidv7();

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
  /**
   * The workspaces of the queue's jobs that failed for good and that pg-boss still keeps (7 days after, its default),
   * each once: where a job's last run may have left work half done (the email sweep, #210). Only a job as `send`
   * writes it counts: its payload's workspace is its group (`payloadOf`), and a UUIDv7. lzp_app can write any job, so
   * a forged one can name a workspace whose jobs never failed; the caller's work there must be what that workspace
   * needs anyway (the sweep's is: it marks only rows past their job's expiry).
   */
  failedWorkspaces: (queue: WorkspaceQueue) => Promise<string[]>;
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
        // Each job belongs to its workspace's group; the ai queue's worker runs at most 4 of a group at once, the
        // asset queue's 1. An account queue's job belongs to no workspace, so to no group.
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
              db: (workspaceId === null ? null : db.forWorkspace({ workspaceId })) as JobContext<
                typeof queue
              >['db'],
              retryCount: job.retryCount,
              lastAttempt: job.retryCount >= job.retryLimit,
            });
          }
        },
      );
    },
    failedWorkspaces: async (queue) => {
      // The job tables carry every workspace's jobs (`appGrants`): this reads their ids only, never a row of a
      // workspace's own tables, which the caller then reaches through `db.forWorkspace` for each.
      const { rows } = await boss.getDb().executeSql(
        `SELECT DISTINCT group_id AS "workspaceId" FROM ${JOBS_SCHEMA}.job
         WHERE name = $1 AND state = 'failed' AND group_id = data->>'workspaceId'`,
        [queue],
      );
      return (rows as { workspaceId: string }[])
        .map((row) => row.workspaceId)
        .filter((workspaceId) => uuidv7.safeParse(workspaceId).success);
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
 * Every write is taken back first, so an install brings an older database's grants down to these. When lzp_app is
 * narrowed: on `bam`, before pg-boss starts its bam runner, at every install (`bamGuard`, #211), so from the first
 * install that runs it that runner meets no row lzp_app could still write, nor one it wrote while it could; on the
 * other tables, here, once pg-boss has started (a fresh database has no tables to narrow before). Each statement list
 * runs in one transaction, so lzp_app never holds, between two installs, more than this.
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
 * What `installJobs` runs as the owner before pg-boss starts (#211, Cerberus F1 on #209), as one statement list (one
 * transaction), under the grants' lock.
 *
 * pg-boss 12.38 starts its bam runner inside start() (index.js: `if (this.#config.migrate) await this.#bam.start()`);
 * the runner polls at once (bam.js: `setImmediate(() => this.#onPoll())`) and claims a pending, failed or stale row
 * (plans.js, getNextBamCommand: `c.status IN ('pending', 'failed') OR (c.status = 'in_progress' AND …)`) to run its
 * command as SQL. A row lzp_app planted while it could write to `bam` (its grants before #203) is already there, so
 * taking those writes back, before start() or after it (`appGrants`), doesn't keep the runner from it. So, first:
 * - `bam` is locked against writers: SHARE ROW EXCLUSIVE waits out every transaction writing there and holds off the
 *   next until this one commits, so every row lzp_app wrote is in sight;
 * - while lzp_app can still write to `bam`, every row not completed goes. Any of a row's columns could be lzp_app's, so
 *   none tells pg-boss's rows from lzp_app's. pg-boss writes them only in its migrations (migrationStore.js:
 *   `job_table_run_async`, or an INSERT into bam), and 12.38's fresh install writes none (plans.js `create`): this repo
 *   has run no other pg-boss (12.38.1 since #82), so none of those rows is pg-boss's. The backup a deploy takes before
 *   it migrates (§14) keeps them;
 * - lzp_app's writes on `bam` are taken back, so it can't plant another before the runner starts.
 * From then on only the owner writes to `bam`, and no install refuses a row: a later pg-boss's migrations write theirs
 * inside start(), after this, and its runner runs them. A database without `bam` yet (a fresh one) has nothing to refuse.
 */
function bamGuard(): string {
  const bam = `${JOBS_SCHEMA}.bam`;
  return `SELECT pg_advisory_xact_lock(${String(GRANTS_LOCK)});
    DO $$
    BEGIN
      IF to_regclass('${bam}') IS NULL THEN
        RETURN;
      END IF;
      LOCK TABLE ${bam} IN SHARE ROW EXCLUSIVE MODE;
      IF has_table_privilege('lzp_app', '${bam}', 'INSERT')
        OR has_any_column_privilege('lzp_app', '${bam}', 'UPDATE') THEN
        DELETE FROM ${bam} WHERE status <> 'completed';
      END IF;
      REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${bam} FROM lzp_app;
    END
    $$;`;
}

/**
 * Installs or migrates pg-boss in the `pgboss` schema as the owner role (DATABASE_OWNER_URL), declares the queues with
 * their retry bounds, and lets the app role (lzp_app) use them: rows only, never the schema. Safe to run again and
 * at the same time as another run (pg-boss and the grants each take an advisory lock). Run it with the migrations.
 */
export async function installJobs(ownerUrl: string): Promise<void> {
  // Before pg-boss starts its bam runner (`bamGuard`), in a session of its own that ends before pg-boss opens its pool.
  const owner = new pg.Client({ connectionString: ownerUrl, application_name: 'lzp-jobs-install' });
  await owner.connect();
  try {
    await owner.query(bamGuard());
  } finally {
    await owner.end();
  }

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
