// How the `asset` job moves its row (#402, §06 Reading uploaded files and Asset library, §10 Processing every image,
// §13 Jobs: safe to run twice). Every step runs through `db.forWorkspace`, so a job sees only its workspace's rows, and
// it finds an asset only by its id and its brand's together.
//
//   waiting, unprocessed ──finish──▶ ready (a client's photo: still waiting, now for the agency's approval, §10)
//            │
//            └──────────reject──────▶ rejected, with a plain reason
//
// An asset is unprocessed while it is `waiting` with no sha256 and no reject reason. `finish` and `reject` each move it
// with one conditional update from there, so two runs of one job can't both move it, and a rerun moves nothing.
//
// Duplicates (§06, §10; Zeus, 2026-11-25: both are kept): two assets of one brand look the same when their sha256 is
// equal or their 64-bit perceptual hashes differ in at most DUPLICATE_MAX_BITS bits. A processed asset that looks the
// same as an earlier processed one (by `created_at`, then id) is marked `duplicate_of` the earliest of them; a rejected
// asset is never one. `duplicate_of` has no key (Zeus, 2026-11-26, option (c) on #402): it is written only here, by an
// update whose WHERE finds the earlier asset in the same workspace and brand, and a reader takes an id that no longer
// exists as no duplicate. Files of one brand finish one at a time (an advisory lock per brand, held to the end of the
// transaction), so two copies processed at once still find each other; and when an older copy finishes after a newer
// one, the newer one is marked then.
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Scoped } from '../db.ts';
import { asset, type AssetKind, type AssetSource } from '../schema/assets.ts';

/** Two perceptual hashes this close (of 64 bits) are the same picture. */
export const DUPLICATE_MAX_BITS = 8;

/** The advisory lock's first key (the second is the brand's): one brand's files finish one at a time. */
export const ASSET_FINISH_LOCK = 402;

/** What the job reads of an asset it is to process. */
export interface AssetToProcess {
  readonly id: string;
  readonly brandId: string;
  readonly kind: AssetKind;
  readonly source: AssetSource;
}

/** Why a job leaves the asset alone: no such asset in this workspace and brand, or a run has processed it already. */
export type AssetSkip = 'missing' | 'processed';

/** What processing found of a file. */
export interface ProcessedFile {
  /** Of the stored original, in lowercase hex. */
  readonly sha256: string;
  /** A picture's 64-bit perceptual hash in 16 lowercase hex digits; null for a PDF. */
  readonly perceptualHash: string | null;
  /** What the original and its copies take in storage. */
  readonly sizeBytes: number;
  /** A PDF's text; null for a picture. */
  readonly extractedText: string | null;
}

export interface AssetProcessing {
  /** The asset if it waits to be processed; otherwise why not. */
  load: (target: {
    brandId: string;
    assetId: string;
  }) => Promise<{ asset: AssetToProcess } | { skip: AssetSkip }>;
  /**
   * Unprocessed → processed, with what processing found: `ready`, or, for a client's photo, still `waiting` for the
   * agency (§10). Marks it, and any newer copy, as a possible duplicate. `finished` is false when another run moved it
   * first; `duplicateOf` is the earlier asset it looks like, if any.
   */
  finish: (
    assetId: string,
    file: ProcessedFile,
  ) => Promise<{ finished: boolean; duplicateOf: string | null }>;
  /** Unprocessed → rejected, with a plain reason that never holds the file's content or name. False when it wasn't. */
  reject: (assetId: string, reason: string) => Promise<boolean>;
}

const unprocessed = and(
  eq(asset.status, 'waiting'),
  isNull(asset.sha256),
  isNull(asset.rejectReason),
);

/** Whether assets `a` and `b` (table aliases) look the same: one sha256, or perceptual hashes within the bound. */
function sameLook(a: string, b: string): SQL {
  const hash = (alias: string) => sql.raw(`('x' || ${alias}.perceptual_hash)::bit(64)`);
  const sized = (alias: string) => sql.raw(`length(${alias}.perceptual_hash) = 16`);
  return sql`(${sql.raw(`${a}.sha256 = ${b}.sha256`)} or (${sized(a)} and ${sized(b)} and bit_count(${hash(a)} # ${hash(b)}) <= ${DUPLICATE_MAX_BITS}))`;
}

/** Assets that count for duplicates: processed, and not rejected. */
const counted = (alias: string) =>
  sql.raw(`${alias}.sha256 is not null and ${alias}.status <> 'rejected'`);

export function assetProcessing(db: Scoped): AssetProcessing {
  return {
    load: async ({ brandId, assetId }) => {
      const [row] = await db.transaction((tx) =>
        tx
          .select({
            id: asset.id,
            brandId: asset.brandId,
            kind: asset.kind,
            source: asset.source,
            status: asset.status,
            sha256: asset.sha256,
            rejectReason: asset.rejectReason,
          })
          .from(asset)
          .where(and(eq(asset.id, assetId), eq(asset.brandId, brandId))),
      );
      if (row === undefined) return { skip: 'missing' };
      if (row.status !== 'waiting' || row.sha256 !== null || row.rejectReason !== null) {
        return { skip: 'processed' };
      }
      return { asset: { id: row.id, brandId: row.brandId, kind: row.kind, source: row.source } };
    },

    finish: (assetId, file) =>
      db.transaction(async (tx) => {
        const [found] = await tx
          .select({ brandId: asset.brandId })
          .from(asset)
          .where(eq(asset.id, assetId));
        if (found === undefined) return { finished: false, duplicateOf: null };
        await tx.execute(
          sql`select pg_advisory_xact_lock(${ASSET_FINISH_LOCK}, hashtext(${found.brandId}::text))`,
        );
        const moved = await tx
          .update(asset)
          .set({
            sha256: file.sha256,
            perceptualHash: file.perceptualHash,
            sizeBytes: file.sizeBytes,
            extractedText: file.extractedText,
            status: sql`case when ${asset.source} = 'client' then 'waiting' else 'ready' end`,
            updatedAt: sql`now()`,
          })
          .where(and(eq(asset.id, assetId), unprocessed))
          .returning({ id: asset.id });
        if (moved.length !== 1) return { finished: false, duplicateOf: null };

        // The asset itself, and every newer processed asset of its brand that looks like it, each pointed at the
        // earliest earlier asset that looks like it. The WHERE finds that asset in the same workspace and brand.
        const { rows } = await tx.execute<{ id: string; duplicate_of: string }>(sql`
          with x as (
            select id, workspace_id, brand_id, created_at, sha256, perceptual_hash
            from ${asset} where id = ${assetId}
          ), targets as (
            select t.id, t.workspace_id, t.brand_id, t.created_at, t.sha256, t.perceptual_hash
            from ${asset} t, x
            where t.workspace_id = x.workspace_id and t.brand_id = x.brand_id and ${counted('t')}
              and (t.id = x.id or ((t.created_at, t.id) > (x.created_at, x.id) and ${sameLook('t', 'x')}))
          ), earliest as (
            select targets.id, (
              select e.id from ${asset} e
              where e.workspace_id = targets.workspace_id and e.brand_id = targets.brand_id and ${counted('e')}
                and (e.created_at, e.id) < (targets.created_at, targets.id) and ${sameLook('e', 'targets')}
              order by e.created_at, e.id
              limit 1
            ) as earlier
            from targets
          )
          update ${asset} as marked set duplicate_of = earliest.earlier, updated_at = now()
          from earliest
          where marked.id = earliest.id and marked.duplicate_of is distinct from earliest.earlier
            and exists (
              select 1 from ${asset} e
              where e.id = earliest.earlier and e.workspace_id = marked.workspace_id
                and e.brand_id = marked.brand_id and (e.created_at, e.id) < (marked.created_at, marked.id)
            )
          returning marked.id, marked.duplicate_of`);
        const own = rows.find((row) => row.id === assetId);
        return { finished: true, duplicateOf: own?.duplicate_of ?? null };
      }),

    reject: async (assetId, reason) => {
      const moved = await db.transaction((tx) =>
        tx
          .update(asset)
          .set({ status: 'rejected', rejectReason: reason, updatedAt: sql`now()` })
          .where(and(eq(asset.id, assetId), unprocessed))
          .returning({ id: asset.id }),
      );
      return moved.length === 1;
    },
  };
}
