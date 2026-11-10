// The accounts tables are shaped for Better Auth 1.7's organization feature, with workspace = organization (§13 Sign-in
// and sessions, #71). Better Auth's drizzle adapter finds each of its fields by name in the Drizzle schema, so every
// field it declares must be a column here. The lists below are Better Auth 1.7.18's (`getAuthTables` in
// @better-auth/core and the organization plugin's schema), with the organization renamed to `workspace` and its
// `organizationId` fields to `workspaceId`. packages/db can't depend on better-auth (only packages/auth does), so the
// lists are written out; packages/auth's own setup proves the wiring when it lands.
import { readdirSync, readFileSync } from 'node:fs';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.ts';

/** Better Auth's model → its fields: `true` where Better Auth requires a value, `false` where it's optional. */
const betterAuth: Record<string, Record<string, boolean>> = {
  user: {
    name: true,
    email: true,
    emailVerified: true,
    image: false,
    createdAt: true,
    updatedAt: true,
  },
  session: {
    expiresAt: true,
    token: true,
    createdAt: true,
    updatedAt: true,
    ipAddress: false,
    userAgent: false,
    userId: true,
    activeWorkspaceId: false, // the organization plugin's activeOrganizationId
  },
  account: {
    accountId: true,
    providerId: true,
    userId: true,
    accessToken: false,
    refreshToken: false,
    idToken: false,
    accessTokenExpiresAt: false,
    refreshTokenExpiresAt: false,
    scope: false,
    password: false,
    createdAt: true,
    updatedAt: true,
  },
  verification: {
    identifier: true,
    value: true,
    expiresAt: true,
    createdAt: true,
    updatedAt: true,
  },
  workspace: { name: true, slug: true, logo: false, createdAt: true, metadata: false },
  member: { workspaceId: true, userId: true, role: true, createdAt: true },
  invitation: {
    workspaceId: true,
    email: true,
    // Optional in the plugin's table schema, but every invitation it creates has one: the create-invitation route
    // requires `role` and refuses an empty list, and its invitation zod schema requires it. NOT NULL here (Cerberus F4).
    role: true,
    status: true,
    expiresAt: true,
    createdAt: true,
    inviterId: true,
  },
};

const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable =>
  is(value, PgTable),
);

/** Every migration file, as one text. */
const migrationsFolder = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(migrationsFolder)
  .filter((file) => file.endsWith('.sql'))
  .map((file) => readFileSync(new URL(file, migrationsFolder), 'utf8'))
  .join('\n');

function table(name: string): PgTable {
  const found = tables.find((t) => getTableName(t) === name);
  if (found === undefined) throw new Error(`no table ${name}`);
  return found;
}

describe('the accounts tables', () => {
  it('are exactly the seven this milestone needs', () => {
    expect(tables.map((t) => getTableName(t)).sort()).toEqual(
      ['account', 'invitation', 'member', 'session', 'user', 'verification', 'workspace'].sort(),
    );
  });

  it.each(Object.entries(betterAuth))(
    "%s has a column for each of Better Auth's fields, required where Better Auth requires it",
    (name, fields) => {
      const columns = getTableColumns(table(name));
      for (const [field, required] of Object.entries(fields)) {
        expect(columns, `${name}.${field}`).toHaveProperty(field);
        // A column Better Auth may leave out must be nullable or have a default; one it requires may be NOT NULL.
        const column = columns[field];
        if (!required) expect(column?.notNull === false || column?.hasDefault, field).toBe(true);
      }
    },
  );

  it('has the columns §13 adds: the platform-admin flag, and the workspace plan, timezone and review-page name', () => {
    expect(getTableColumns(table('user'))).toHaveProperty('isPlatformAdmin');
    expect(getTableColumns(table('workspace'))).toEqual(
      expect.objectContaining({
        plan: expect.anything() as unknown,
        defaultTimezone: expect.anything() as unknown,
        reviewPageName: expect.anything() as unknown,
      }),
    );
  });

  it.each(tables.map((t) => [getTableName(t), t] as const))(
    '%s: the id comes from uuidv7() and every time is a timestamptz',
    (_name, t) => {
      for (const column of Object.values(getTableColumns(t))) {
        if (column.name === 'id') {
          expect(column.getSQLType()).toBe('uuid');
          expect(column.primary).toBe(true);
          expect(JSON.stringify(column.default)).toContain('uuidv7()');
        }
        if (column.columnType === 'PgTimestamp') {
          expect(column.getSQLType(), column.name).toBe('timestamp with time zone');
        }
        expect(column.getSQLType(), column.name).not.toMatch(/^(varchar|char|integer|serial)/);
      }
    },
  );

  it('keeps row-level security on every workspace table, with §13 policy for reads and writes', () => {
    for (const name of ['workspace', 'member', 'invitation']) {
      // The migrations are written by hand (§13 A4), so it's there that row-level security is switched on.
      expect(migrations, name).toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`);
      const config = getTableConfig(table(name));
      const scope = config.policies.find((p) => p.name === 'workspace_scope');
      const key = name === 'workspace' ? 'id' : 'workspace_id';
      const policy = `${key} = current_setting('app.workspace_id')::uuid`;
      expect(scope?.for, name).toBe('all');
      expect(JSON.stringify(scope?.using), name).toContain(policy);
      expect(JSON.stringify(scope?.withCheck), name).toContain(policy);
    }
  });

  it('lets a signed-in person read only their own memberships and those workspaces (Q5), and write nothing that way', () => {
    for (const name of ['workspace', 'member']) {
      const userScope = getTableConfig(table(name)).policies.find((p) => p.name === 'user_scope');
      expect(userScope?.for, name).toBe('select');
      expect(JSON.stringify(userScope?.using), name).toContain(
        "current_setting('app.user_id')::uuid",
      );
    }
    expect(getTableConfig(table('invitation')).policies.map((p) => p.name)).toEqual([
      'workspace_scope',
    ]);
  });

  it('makes every invitation carry its role (Cerberus F4 on #173)', () => {
    expect(getTableColumns(table('invitation'))['role']?.notNull).toBe(true);
    expect(migrations).toContain('ALTER TABLE "invitation" ALTER COLUMN "role" SET NOT NULL;');
    // The check that let NOT NULL skip the table scan stays beside it, in the schema as in the database: squawk
    // refuses dropping a constraint (ban-drop-constraint), and Athena's round-1 note on #189 asks to keep it.
    expect(
      getTableConfig(table('invitation')).checks.map((c) => [c.name, JSON.stringify(c.value)]),
    ).toContainEqual(['invitation_role_present', expect.stringContaining('"role" IS NOT NULL')]);
    expect(migrations).toContain(
      'ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_present" CHECK ("role" IS NOT NULL) NOT VALID;',
    );
    expect(migrations).toContain(
      'ALTER TABLE "invitation" VALIDATE CONSTRAINT "invitation_role_present";',
    );
  });

  it('drops no constraint in any migration (squawk: ban-drop-constraint)', () => {
    expect(migrations).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
  });

  it('keeps the auth tables out of the app role’s reach: only lzp_auth holds them (#176)', () => {
    // Everything lzp_app held on them goes; lzp_auth, which only the auth handle switches to, gets it instead.
    expect(migrations).toContain(
      'REVOKE ALL ON "user", "session", "account", "verification" FROM lzp_app;',
    );
    expect(migrations).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "session", "account", "verification" TO lzp_auth;',
    );
    // On "user", lzp_app reads only, under row-level security: the person set, or members of the workspace set.
    expect(migrations).toContain('GRANT SELECT ON "user" TO lzp_app;');
    expect(migrations).toContain('ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;');
    const policies = getTableConfig(table('user')).policies;
    expect(policies.map((p) => [p.name, p.for, p.to])).toEqual([
      ['auth_handle', 'all', 'lzp_auth'],
      ['member_scope', 'select', 'lzp_app'],
    ]);
    const memberScope = JSON.stringify(policies.find((p) => p.name === 'member_scope')?.using);
    expect(memberScope).toContain("id = current_setting('app.user_id')::uuid");
    expect(memberScope).toContain(
      "id in (select user_id from member where workspace_id = current_setting('app.workspace_id')::uuid)",
    );
  });

  it('carries no workspace data in the global tables', () => {
    for (const name of ['user', 'session', 'account', 'verification']) {
      expect(getTableColumns(table(name)), name).not.toHaveProperty('workspaceId');
    }
  });
});
