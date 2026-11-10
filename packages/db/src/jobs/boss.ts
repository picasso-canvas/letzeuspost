// pg-boss on the same Postgres (§13 Jobs, #72). Its tables live in their own `pgboss` schema, which the owner role
// installs (`installJobs`, beside the migrations) and the app role only uses (`createJobs`): the app role can't create
// a schema or change pg-boss's tables, so a job can't change the queue's structure either. pg-boss stays inside this
// package, like the database client; the worker gets `send` and `work`.
//
// A handler gets the payload and `db.forWorkspace` for the payload's workspace, the only database handle it has, so
// every row it reads or writes is that workspace's (row-level security, the tenant-isolation skill).
import { sql } from 'drizzle-orm';
import { fromDrizzle, PgBoss } from 'pg-boss';
import type { Db, Scoped, Tx } from '../db.ts';
import { checkPayload, queueNames, queues, type Payload, type QueueName } from './queues.ts';

/** §13: the job queue keeps its own tables in a separate schema. */
export const JOBS_SCHEMA = 'pgboss';

/** What a handler is given for one job. */
export interface JobContext<Q extends QueueName> {
  readonly jobId: string;
  readonly payload: Payload<Q>;
  /** `db.forWorkspace` for the payload's workspace. */
  readonly db: Scoped;
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
  /** pg-boss's own errors (a lost connection, a failed maintenance pass). Payloads hold ids only. */
  readonly onError?: (error: Error) => void;
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
  boss.on('error', (error: Error) => {
    if (onError === undefined) console.error(`jobs: ${error.name}: ${error.message}`);
    else onError(error);
  });

  return {
    start: async () => {
      await boss.start();
    },
    stop: () => boss.stop({ graceful: true, timeout: 30_000 }),
    send: async (queue, payload, options = {}) => {
      const data = checkPayload(queue, payload);
      const id = await boss.send(queue, data, {
        // Each job belongs to its workspace's group; the ai queue's worker runs at most 4 of a group at once.
        group: { id: data.workspaceId },
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
            const payload = checkPayload(queue, job.data);
            await handler({
              jobId: job.id,
              payload,
              db: db.forWorkspace({ workspaceId: payload.workspaceId }),
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
 * Installs or migrates pg-boss in the `pgboss` schema as the owner role (DATABASE_OWNER_URL), declares the queues with
 * their retry bounds, and lets the app role (lzp_app) use them: rows only, never the schema. Safe to run again and
 * at the same time as another run (pg-boss takes an advisory lock). Run it with the migrations.
 */
/** An advisory lock held while granting; any fixed number, this one the task's (the migrations hold 71). */
const GRANTS_LOCK = 72;

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
    // Rows of every table, the version row included: a running pg-boss stamps its cron, monitor and reindex passes
    // there. Never the schema or a table's structure, which stay the owner's. One statement list is one transaction,
    // and the lock makes two installs at once take turns: Postgres refuses two GRANTs racing on one object.
    await boss.getDb().executeSql(
      `SELECT pg_advisory_xact_lock(${String(GRANTS_LOCK)});
       GRANT USAGE ON SCHEMA ${JOBS_SCHEMA} TO lzp_app;
       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${JOBS_SCHEMA} TO lzp_app;
       GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${JOBS_SCHEMA} TO lzp_app;`,
    );
  } finally {
    await boss.stop({ graceful: false });
  }
  if (failure !== undefined) throw failure;
}
