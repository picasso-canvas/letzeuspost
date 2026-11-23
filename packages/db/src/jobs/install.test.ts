// installJobs's order, checked without a database (#211, Cerberus F1 on #209): pg-boss 12.38 starts its bam runner
// inside start() when `migrate` is on, and the runner runs each `bam` row's command as SQL, as the owner role. So the
// rows the app role could have planted are refused, and its writes on `bam` taken back, before pg-boss starts.
// jobs.int.test.ts plants a row under the old grants and checks against Postgres that the next install doesn't run it.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_URL = 'postgres://lzp_owner@127.0.0.1:5432/lzp';
const steps: string[] = [];

vi.mock('pg', () => ({
  default: {
    Client: class {
      connect() {
        steps.push('owner connects');
        return Promise.resolve();
      }
      query(text: string) {
        steps.push(`owner runs: ${text}`);
        return Promise.resolve({ rows: [] });
      }
      end() {
        steps.push('owner disconnects');
        return Promise.resolve();
      }
    },
  },
}));

vi.mock('pg-boss', () => ({
  fromDrizzle: () => undefined,
  PgBoss: class {
    on() {
      return this;
    }
    start() {
      steps.push('pg-boss starts');
      return Promise.resolve();
    }
    createQueue() {
      return Promise.resolve();
    }
    updateQueue() {
      return Promise.resolve();
    }
    getDb() {
      return {
        executeSql: () => {
          steps.push('pg-boss runs the grants');
          return Promise.resolve({ rows: [] });
        },
      };
    }
    stop() {
      steps.push('pg-boss stops');
      return Promise.resolve();
    }
  },
}));

const { installJobs, JOBS_SCHEMA } = await import('./boss.ts');

beforeEach(() => {
  steps.length = 0;
});

describe('installJobs (#211)', () => {
  it("refuses the app role's bam rows and takes back its writes on bam before pg-boss can start the bam runner", async () => {
    await installJobs(OWNER_URL);
    const guard = steps.findIndex(
      (step) =>
        step.startsWith('owner runs:') &&
        step.includes(`DELETE FROM ${JOBS_SCHEMA}.bam`) &&
        step.includes(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${JOBS_SCHEMA}.bam FROM lzp_app`),
    );
    const start = steps.indexOf('pg-boss starts');
    expect(guard, steps.join('\n')).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(start);
    // The guard's session is closed before pg-boss opens its own.
    expect(steps.indexOf('owner disconnects')).toBeLessThan(start);
  });
});
