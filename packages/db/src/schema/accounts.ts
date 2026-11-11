// The accounts tables (§13 Data model, #71), shaped for Better Auth 1.7 with workspace = organization. packages/auth
// maps Better Auth's names onto them: the organization model is `workspace`, each `organizationId` field is
// `workspaceId`, and the session's `activeOrganizationId` is `activeWorkspaceId`. Ids come from Postgres's `uuidv7()`
// (Better Auth leaves them to the database), and times are `timestamptz`.
//
// `user`, `session`, `account` and `verification` are Better Auth's own and global: they carry no workspace data, and
// sign-in reads them before anyone is known. Only the auth role (lzp_auth) holds them, and only the auth handle in
// @lzp/db/auth switches to it (#176); the app role (lzp_app) reads `user` alone, and only the people the policy below
// lets it see. Every table that holds workspace data has row-level security with §13's policy, for reads and writes.
// The workspace table's own key is its `id`.
//
// The migrations in ../../migrations are written by hand from this file (§13 A4; why, in the migration). Change both
// together. Three rules live only there: each role's grants; `member_one_owner` (an exclusion constraint, which
// Drizzle can't declare); and that only the owner role sets `user.is_platform_admin` (a column grant and a trigger).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const time = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => time('created_at').notNull().defaultNow();
const updatedAt = () => time('updated_at').notNull().defaultNow();

/**
 * §13's policy, as §13 writes it: a row is seen and written only inside the workspace the transaction set
 * (`db.forWorkspace(ctx)`). With no workspace set, Postgres can't read the setting and refuses the query.
 */
function workspaceScope(key: 'id' | 'workspace_id') {
  const policy = sql.raw(`${key} = current_setting('app.workspace_id')::uuid`);
  return pgPolicy('workspace_scope', { for: 'all', using: policy, withCheck: policy });
}

/**
 * Q5 (Zeus and Athena, 2026-11-07): a second policy, keyed on the signed-in person the transaction set (`forUser` in
 * @lzp/db/auth), so sign-in can list a person's own workspaces. It reads only: writes still need the workspace set.
 */
const userScope = (using: string) =>
  pgPolicy('user_scope', { for: 'select', using: sql.raw(using) });

export const user = pgTable(
  'user',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'), // the avatar
    // Zeus (§15). Only the owner role sets it (the seeds, #79): neither the auth role nor the app role can.
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    // Better Auth finds anyone by email or session before anyone is known, so the auth role sees every person.
    pgPolicy('auth_handle', { for: 'all', to: 'lzp_auth', using: sql`true`, withCheck: sql`true` }),
    // Workspace code reads only the person it acts for (`forUser`) and the members of its workspace
    // (`db.forWorkspace`), and changes nobody: the app role holds only SELECT on this table.
    pgPolicy('member_scope', {
      for: 'select',
      to: 'lzp_app',
      using: sql.raw(
        "id = current_setting('app.user_id')::uuid or id in (select user_id from member where workspace_id = current_setting('app.workspace_id')::uuid)",
      ),
    }),
  ],
);

export const workspace = pgTable(
  'workspace',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(), // Better Auth requires one for an organization
    logo: text('logo'),
    metadata: text('metadata'), // Better Auth's, optional
    plan: text('plan'), // set by billing (§02)
    defaultTimezone: text('default_timezone'), // IANA, like Asia/Dhaka
    reviewPageName: text('review_page_name'), // shown on review pages (§11)
    createdAt: createdAt(),
  },
  () => [
    workspaceScope('id'),
    userScope(
      "id in (select workspace_id from member where user_id = current_setting('app.user_id')::uuid)",
    ),
  ],
);

/** The four roles of §01. */
export const roles = ['owner', 'admin', 'editor', 'viewer'] as const;

export const member = pgTable(
  'member',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: roles }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('member_workspace_id_user_id_unique').on(t.workspaceId, t.userId),
    check('member_role_check', sql.raw("role in ('owner', 'admin', 'editor', 'viewer')")),
    workspaceScope('workspace_id'),
    userScope("user_id = current_setting('app.user_id')::uuid"),
  ],
);

/**
 * Better Auth's organization feature reads and deletes invitations with a workspace, so the table exists now, empty;
 * invitations themselves come with their own task (§23). Its id is a UUIDv7, time-ordered and partly predictable, so
 * it must never be the invite link's token: that is a separate random secret of at least 128 bits, stored hashed (§13).
 */
export const invitation = pgTable(
  'invitation',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    // §15: Owners invite Admins, Admins invite Editors and Viewers; nobody is invited as the Owner.
    role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'rejected', 'canceled'] })
      .notNull()
      .default('pending'),
    expiresAt: time('expires_at').notNull(),
    createdAt: createdAt(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  () => [
    check('invitation_role_check', sql.raw("role in ('admin', 'editor', 'viewer')")),
    // Beside NOT NULL: the migrations added it first, so that NOT NULL needed no scan of the table (#176).
    check('invitation_role_present', sql.raw('"role" IS NOT NULL')),
    check(
      'invitation_status_check',
      sql.raw("status in ('pending', 'accepted', 'rejected', 'canceled')"),
    ),
    workspaceScope('workspace_id'),
  ],
);

export const session = pgTable('session', {
  id: id(),
  expiresAt: time('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  activeWorkspaceId: uuid('active_workspace_id'),
});

export const account = pgTable('account', {
  id: id(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: time('access_token_expires_at'),
  refreshTokenExpiresAt: time('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'), // Better Auth's; stays empty: there are no passwords (§13)
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verification = pgTable('verification', {
  id: id(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: time('expires_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
