// What the app role may do in pg-boss's schema, and how a handler's payload is taken from a job row (Cerberus F1 on
// #197 and on #202), checked without a database. jobs.int.test.ts checks both against Postgres, as lzp_app.
import { randomUUIDv7 } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appGrants, JOBS_SCHEMA, payloadOf } from './boss.ts';
import { JobPayloadError } from './queues.ts';

/** The statements, one per entry, without the line breaks inside them. */
const statements = appGrants()
  .split(';')
  .map((statement) => statement.replace(/\s+/g, ' ').trim())
  .filter((statement) => statement !== '');

/** The columns of a column-level grant of UPDATE on `table`. */
function updatableColumns(table: string): string[] {
  const grant = statements.find(
    (statement) =>
      statement.startsWith(`GRANT UPDATE (`) && statement.includes(` ON ${JOBS_SCHEMA}.${table} `),
  );
  const list = /\(([^)]*)\)/.exec(grant ?? '')?.[1] ?? '';
  return list.split(',').map((column) => column.trim());
}

describe("the app role's rights in pg-boss's schema", () => {
  it('reads and writes the job rows, and uses the schema, never changes it', () => {
    expect(statements).toContain(`GRANT USAGE ON SCHEMA ${JOBS_SCHEMA} TO lzp_app`);
    expect(statements).toContain(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${JOBS_SCHEMA} TO lzp_app`,
    );
    expect(statements.join(';')).not.toMatch(/\bGRANT\b[^;]*\b(CREATE|ALL PRIVILEGES|TRUNCATE)\b/);
  });

  it('takes back every write on queue and version, then gives back only the bookkeeping columns', () => {
    const revoke = statements.findIndex(
      (statement) =>
        statement ===
        `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${JOBS_SCHEMA}.queue, ${JOBS_SCHEMA}.version FROM lzp_app`,
    );
    const allTables = statements.findIndex((statement) => statement.includes('ON ALL TABLES'));
    expect(revoke).toBeGreaterThan(allTables);
    for (const table of ['queue', 'version']) {
      const grant = statements.findIndex(
        (statement) => statement.startsWith('GRANT UPDATE (') && statement.includes(`.${table} `),
      );
      expect(grant, table).toBeGreaterThan(revoke);
    }
  });

  it("leaves a queue's policy and retry bounds to the owner role", () => {
    const columns = updatableColumns('queue');
    expect(columns).toEqual(
      expect.arrayContaining(['monitor_claim_on', 'maintain_on', 'queued_count']),
    );
    for (const policy of [
      'name',
      'policy',
      'retry_limit',
      'retry_delay',
      'retry_backoff',
      'retry_delay_max',
      'expire_seconds',
      'retention_seconds',
      'deletion_seconds',
      'dead_letter',
      'partition',
      'table_name',
      'warning_queued',
      'heartbeat_seconds',
      'notify',
    ]) {
      expect(columns, policy).not.toContain(policy);
    }
  });

  it("leaves pg-boss's version to the owner role, and lets a running instance stamp its passes", () => {
    expect(updatableColumns('version').sort()).toEqual(
      ['bam_on', 'cron_on', 'flow_on', 'monitor_backoff_on', 'reindex_on'].sort(),
    );
  });
});

describe('the payload a handler is given', () => {
  const workspaceId = randomUUIDv7();
  const data = { workspaceId, emailMessageId: randomUUIDv7() };

  it('is the checked payload of a job queued by send(), whose group is its workspace', () => {
    expect(payloadOf('email', { data, groupId: workspaceId })).toEqual(data);
  });

  it("refuses a job whose group isn't its payload's workspace: send() didn't write it", () => {
    for (const groupId of [randomUUIDv7(), null, undefined]) {
      expect(() => payloadOf('email', { data, groupId })).toThrow(JobPayloadError);
    }
  });

  it('refuses a payload with more than ids, before looking at its group', () => {
    expect(() =>
      payloadOf('email', {
        data: { ...data, to: 'nadia@golpo-cafe.example' },
        groupId: workspaceId,
      }),
    ).toThrow(JobPayloadError);
  });
});
