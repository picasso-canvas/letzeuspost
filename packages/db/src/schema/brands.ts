// The brands tables (§13 Data model, Brands; §06 What a kit holds; #399): a brand, and its kit as immutable versions,
// one per Save (Zeus, 2026-11-25), so a post can later pin the version it was made with (§06).
//
// Written by hand in ../../migrations/0007_brands.sql (§13 A4), like the tables in ./accounts.ts. Change both together.
// Four rules live only there: the app role's grants (it may read and add a kit version, never change or remove one);
// the composite key that keeps a version in its brand's workspace; and the trigger that lets
// `brand.current_kit_version` move only to the brand's newest saved version (`brandKits(…).saveKit` moves it).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspace } from './accounts.ts';

/** §11: a brand's posts are approved by nobody, by the agency, or by the agency and then the client. */
export const approvalModes = ['none', 'agency', 'agency-then-client'] as const;
export type ApprovalMode = (typeof approvalModes)[number];

const time = (name: string) => timestamp(name, { withTimezone: true });
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const scope = sql.raw("workspace_id = current_setting('app.workspace_id')::uuid");
/** §13's policy, as §13 writes it. */
const workspaceScope = () =>
  pgPolicy('workspace_scope', { for: 'all', using: scope, withCheck: scope });

export const brand = pgTable(
  'brand',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    nameEn: text('name_en').notNull(),
    nameBn: text('name_bn'),
    /** IANA, like Asia/Dhaka (§13); empty until set, when the workspace's default applies. */
    timezone: text('timezone'),
    /** Empty until chosen in the kit's Publishing tab (§06). */
    approvalMode: text('approval_mode', { enum: approvalModes }),
    /** The newest kit version's number; empty until the first Save. Moved only by `saveKit` (the trigger, 0007). */
    currentKitVersion: bigint('current_kit_version', { mode: 'number' }),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // What brand_kit_version's key points at: a brand together with its workspace.
    unique('brand_id_workspace_id_unique').on(t.id, t.workspaceId),
    check(
      'brand_approval_mode_check',
      sql.raw("approval_mode in ('none', 'agency', 'agency-then-client')"),
    ),
    workspaceScope(),
  ],
);

export const brandKitVersion = pgTable(
  'brand_kit_version',
  {
    id: id(),
    workspaceId: uuid('workspace_id').notNull(),
    brandId: uuid('brand_id').notNull(),
    /** 1 for the first Save, then one more for each. */
    version: bigint('version', { mode: 'number' }).notNull(),
    /** The kit as saved, each item with its source (§06), checked by the kit's schema before it is written. */
    kit: jsonb('kit').notNull(),
    createdAt: time('created_at').notNull().defaultNow(),
  },
  (t) => [
    // The version's brand is in the version's own workspace: a key to the brand alone would let a row of one
    // workspace name another's brand, since Postgres checks keys past row-level security.
    foreignKey({
      name: 'brand_kit_version_brand_fk',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brand.id, brand.workspaceId],
    }).onDelete('cascade'),
    unique('brand_kit_version_brand_id_version_unique').on(t.brandId, t.version),
    check('brand_kit_version_version_check', sql.raw('version >= 1')),
    workspaceScope(),
  ],
);
