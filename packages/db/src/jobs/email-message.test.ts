// The email outbox's table (§13 Data model, #72), checked without a database: its shape in the Drizzle schema and its
// row-level security in the hand-written migration (§13 A4). email-outbox.int.test.ts checks both against Postgres.
import { readdirSync, readFileSync } from 'node:fs';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { emailMessage, emailStatuses } from '../schema/email-message.ts';

const folder = new URL('../../migrations/', import.meta.url);
const migration = readdirSync(folder)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(new URL(file, folder), 'utf8'))
  .find((text) => text.includes('CREATE TABLE IF NOT EXISTS "email_message"'));

const POLICY = "workspace_id = current_setting('app.workspace_id')::uuid";

describe('the email_message table', () => {
  const columns = getTableColumns(emailMessage);

  it('holds an outbox row: template, to, reply-to, status and provider id (§13)', () => {
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['template', 'toAddress', 'replyTo', 'status', 'providerId']),
    );
    expect(emailStatuses).toEqual(['queued', 'sending', 'sent', 'failed']);
    expect(columns.status.default).toBe('queued');
  });

  it('carries its workspace, a UUIDv7 id and times in timestamptz', () => {
    expect(columns.workspaceId.notNull).toBe(true);
    expect(JSON.stringify(columns.id.default)).toContain('uuidv7()');
    for (const column of [columns.createdAt, columns.updatedAt, columns.sentAt]) {
      expect(column.getSQLType()).toBe('timestamp with time zone');
    }
  });

  it("declares §13's policy for reads and writes", () => {
    const [policy, ...others] = getTableConfig(emailMessage).policies;
    expect(others).toEqual([]);
    expect(policy?.for).toBe('all');
    expect(JSON.stringify(policy?.using)).toContain(POLICY);
    expect(JSON.stringify(policy?.withCheck)).toContain(POLICY);
  });

  it('switches row-level security on in the migration that creates it, with the same policy', () => {
    expect(migration).toBeDefined();
    expect(migration).toContain('ALTER TABLE "email_message" ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain(
      `CREATE POLICY "workspace_scope" ON "email_message" AS PERMISSIVE FOR ALL TO public USING (${POLICY}) WITH CHECK (${POLICY});`,
    );
  });

  it('lets the app role read, add and update rows, never delete them', () => {
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE ON "email_message" TO lzp_app;');
    expect(migration).not.toMatch(/GRANT[^;]*DELETE[^;]*"email_message"/);
  });
});
