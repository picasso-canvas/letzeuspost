// The asset library's table (§13 Data model, Files; §06 Asset library; §10 Licences, consent and credits; #400): one
// row per file a brand's library holds. A file is uploaded straight to the bucket and then checked, re-encoded and
// copied by the `asset` job (§13 File storage), so a row starts `waiting`, with no hashes or size, until that job fills
// them in; until then it can't be used (@lzp/core's `isUsableInPost`).
//
// Written by hand in ../../migrations/0008_assets.sql and 0009_asset_processing.sql (§13 A4), like ./brands.ts. Change
// them together. Three rules
// live only there: the app role's grants (it never moves an asset to another workspace, brand, file, source or
// uploader); that the storage key is the asset's own original, `ws/<workspace>/brands/<brand>/assets/<id>/original`
// (§13 File storage, @lzp/storage's `assetKey`), so a row can't name another workspace's file; and that a member leaving
// sets only `uploaded_by` to null (Postgres's `ON DELETE SET NULL (column)`, which Drizzle can't declare).
//
// Not here yet: the parent of a cutout and an upload by a client's review link (§13) come with cutouts and client
// photos (§10, §18 M8), each as a nullable column with its key, when their tables and features exist.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { member } from './accounts.ts';
import { brand } from './brands.ts';

/** §06's kinds, and `example`: a post screenshot that teaches the voice, never offered for a post (#400). */
export const assetKinds = ['logo', 'photo', 'product', 'people', 'document', 'example'] as const;
export type AssetKind = (typeof assetKinds)[number];

/** §13: the agency's own, from the client (the review link, §10), or a cutout of another asset. */
export const assetSources = ['own', 'client', 'cutout'] as const;
export type AssetSource = (typeof assetSources)[number];

/** §13: `waiting` until processed (and, for a client's photo, approved, §10); `rejected` never used. */
export const assetStatuses = ['ready', 'waiting', 'rejected'] as const;
export type AssetStatus = (typeof assetStatuses)[number];

const time = (name: string) => timestamp(name, { withTimezone: true });
const scope = sql.raw("workspace_id = current_setting('app.workspace_id')::uuid");
const listed = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');

export const asset = pgTable(
  'asset',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    workspaceId: uuid('workspace_id').notNull(),
    brandId: uuid('brand_id').notNull(),
    kind: text('kind', { enum: assetKinds }).notNull(),
    /** The original's key, `ws/<workspace>/brands/<brand>/assets/<id>/original`; its copies sit beside it (§13). */
    storageKey: text('storage_key').notNull(),
    /** Of the uploaded file, in lowercase hex; empty until processed. */
    sha256: text('sha256'),
    /** For finding duplicates (§10), in lowercase hex; empty until processed. */
    perceptualHash: text('perceptual_hash'),
    /** What the file takes in storage, which counts against the plan (§02); empty until processed. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    /** The AI's description (`tagAsset`, §09), which the editor can change. */
    description: text('description'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Recognisable people in it: empty until the tagging or an editor says, and counted as yes till then. */
    peoplePresent: boolean('people_present'),
    /** The consent tick for recognisable people (§10, §22). */
    consent: boolean('consent').notNull().default(false),
    licence: text('licence'),
    /** The credit line photo cards and exports show (§10). */
    credit: text('credit'),
    source: text('source', { enum: assetSources }).notNull(),
    status: text('status', { enum: assetStatuses }).notNull().default('waiting'),
    /** The focus point (§10), each from 0 to 1 across and down the image; both empty until set. */
    focusX: real('focus_x'),
    focusY: real('focus_y'),
    /** The member who uploaded it; empty once they leave the workspace. */
    uploadedBy: uuid('uploaded_by'),
    createdAt: time('created_at').notNull().defaultNow(),
    updatedAt: time('updated_at').notNull().defaultNow(),
    // Added by ../../migrations/0009_asset_processing.sql (#402); the `asset` job fills them in.
    /**
     * A possible duplicate (§06, §10): the earliest earlier asset of the same workspace and brand with the same sha256
     * or a perceptual hash within 8 bits. Both are kept (Zeus, 2026-11-25). No key (Zeus, 2026-11-26): the job writes
     * it only through an update that finds that asset in the same workspace and brand, and an id that no longer exists
     * means no duplicate.
     */
    duplicateOf: uuid('duplicate_of'),
    /** Why the job rejected the file, in plain words for the person who sent it: never the file's content or name. */
    rejectReason: text('reject_reason'),
    /** A PDF's text (§06: "PDFs are read as text"); empty for an image. */
    extractedText: text('extracted_text'),
  },
  (t) => [
    // The asset's brand is in the asset's own workspace: a key to the brand alone would let a row of one workspace
    // name another's brand, since Postgres checks keys past row-level security (as brand_kit_version's, 0007).
    foreignKey({
      name: 'asset_brand_fk',
      columns: [t.brandId, t.workspaceId],
      foreignColumns: [brand.id, brand.workspaceId],
    }).onDelete('cascade'),
    // The uploader is a member of the asset's workspace. The migration sets only `uploaded_by` to null (see above).
    foreignKey({
      name: 'asset_uploaded_by_fk',
      columns: [t.workspaceId, t.uploadedBy],
      foreignColumns: [member.workspaceId, member.userId],
    }).onDelete('set null'),
    unique('asset_storage_key_unique').on(t.storageKey),
    index('asset_brand_id_workspace_id_idx').on(t.brandId, t.workspaceId),
    index('asset_workspace_id_uploaded_by_idx').on(t.workspaceId, t.uploadedBy),
    check('asset_kind_check', sql.raw(`kind in (${listed(assetKinds)})`)),
    check('asset_source_check', sql.raw(`source in (${listed(assetSources)})`)),
    check('asset_status_check', sql.raw(`status in (${listed(assetStatuses)})`)),
    check(
      'asset_storage_key_check',
      sql.raw(
        "storage_key = 'ws/' || workspace_id::text || '/brands/' || brand_id::text || '/assets/' || id::text || '/original'",
      ),
    ),
    check('asset_sha256_check', sql.raw("sha256 ~ '^[0-9a-f]{64}$'")),
    check('asset_perceptual_hash_check', sql.raw("perceptual_hash ~ '^[0-9a-f]{16,64}$'")),
    check('asset_size_bytes_check', sql.raw('size_bytes >= 0')),
    check(
      'asset_focus_check',
      sql.raw(
        '(focus_x is null) = (focus_y is null) and focus_x between 0 and 1 and focus_y between 0 and 1',
      ),
    ),
    pgPolicy('workspace_scope', { for: 'all', using: scope, withCheck: scope }),
  ],
);
