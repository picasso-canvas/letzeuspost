// `seed:dev`'s logo step (#443, §13 File storage and Jobs): one sample logo added to a brand's library the way an upload
// adds it. Its file goes into the bucket at its original's key first; then its row (`waiting`, the column's default)
// and its `asset` job are written in one transaction, the job through that transaction, so the job exists exactly when
// the row does and never runs before its file is there. Nothing here marks it ready: the worker's `asset` job processes
// it as it processes any upload.
//
// It lives here, beside @lzp/storage, which packages/db can't import (storage depends on db); packages/db's seed calls
// it for each logo its brands are missing (packages/db/src/seed/logos.ts). A run that stops between the file and the
// transaction leaves the file alone in the bucket, with no row: the next run uploads that logo again under a new id.
import { randomUUIDv7 } from 'node:crypto';
import { asset, type Db, type Jobs } from '@lzp/db';
import { assetKey, type Storage } from '@lzp/storage';
import type { AddLogo } from '../../../packages/db/src/seed/logos.ts';

export interface SeedLogoDeps {
  readonly storage: Pick<Storage, 'put'>;
  readonly db: Db;
  readonly jobs: Pick<Jobs, 'send'>;
}

export function addLogoAsUploaded({ storage, db, jobs }: SeedLogoDeps): AddLogo {
  return async (ctx, upload) => {
    const id = randomUUIDv7();
    const storageKey = assetKey(ctx, { brandId: upload.brandId, assetId: id, variant: 'original' });
    await storage.put(ctx, storageKey, upload.bytes, upload.contentType);
    await db.forWorkspace(ctx).transaction(async (tx) => {
      await tx.insert(asset).values({
        id,
        workspaceId: ctx.workspaceId,
        brandId: upload.brandId,
        kind: 'logo',
        source: 'own',
        storageKey,
        description: upload.description,
        uploadedBy: upload.uploadedBy,
      });
      await jobs.send(
        'asset',
        { workspaceId: ctx.workspaceId, brandId: upload.brandId, assetId: id },
        { tx },
      );
    });
    return id;
  };
}
