// `seed:dev`'s logos (#443, §13 File storage, §17 Test data): each sample brand's logo files go into its library the way
// an upload adds them, and its kit gets a second version that names them. The upload itself (the file into the bucket,
// then its `waiting` row and its `asset` job in one transaction) is apps/worker's seed step (`AddLogo`): it needs
// @lzp/storage, which depends on this package. The worker's `asset` job then processes them like any upload; nothing
// here marks one ready.
//
// Run from `seedBrands`, under the seeds' advisory lock, for one brand at a time. Only a brand whose current kit is
// version 1, the one the seed saved, gets its logos: one at a later version already has them, or was edited in the app,
// and is left as it is, so a second run changes nothing. A run that stopped after uploading some logos and before
// saving the version finds those uploads by brand, kind and description (`sampleLogos` makes each brand's differ) and
// uploads only the rest, so no logo is added twice.
import { readFile } from 'node:fs/promises';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BrandKit } from '../../../core/src/index.ts';
import type { BrandKits } from '../brand-kits.ts';
import type { Db, WorkspaceCtx } from '../db.ts';
import { asset } from '../schema/assets.ts';
import { sampleLogos, withLogos, type LogoRole, type SampleBrand } from './sample-brands.ts';

/** One logo file, as an upload gives it to the brand's library. */
export interface LogoUpload {
  readonly brandId: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly description: string;
  /** The member who uploads it: the workspace's Owner. */
  readonly uploadedBy: string;
}

/** Adds one logo to a brand's library as an upload does, and gives its asset's id (apps/worker's seed step). */
export type AddLogo = (ctx: WorkspaceCtx, upload: LogoUpload) => Promise<string>;

/** What the logo step needs: how a logo is added, and who uploads it. */
export interface SeedLogos {
  readonly add: AddLogo;
  readonly uploadedBy: string;
}

/**
 * Gives the brand its logos and its kit's second version when its current kit is the seed's version 1; says whether it
 * changed anything.
 */
export async function seedBrandLogos(
  db: Db,
  kits: BrandKits<BrandKit>,
  ctx: WorkspaceCtx,
  target: { readonly id: string; readonly kitVersion: number; readonly sample: SampleBrand },
  logos: SeedLogos,
): Promise<boolean> {
  if (target.kitVersion !== 1) return false;
  const files = sampleLogos(target.sample);
  // The owner role isn't bound by row-level security, so the lookup names the workspace and the brand itself.
  const uploaded = await db.forWorkspace(ctx).transaction((tx) =>
    tx
      .select({ id: asset.id, description: asset.description })
      .from(asset)
      .where(
        and(
          eq(asset.workspaceId, ctx.workspaceId),
          eq(asset.brandId, target.id),
          eq(asset.kind, 'logo'),
          inArray(
            asset.description,
            files.map((file) => file.description),
          ),
        ),
      )
      .orderBy(asc(asset.createdAt), asc(asset.id)),
  );
  const ids: Partial<Record<LogoRole, string>> = {};
  for (const file of files) {
    ids[file.role] =
      uploaded.find((row) => row.description === file.description)?.id ??
      (await logos.add(ctx, {
        brandId: target.id,
        bytes: new Uint8Array(await readFile(file.file)),
        contentType: file.contentType,
        description: file.description,
        uploadedBy: logos.uploadedBy,
      }));
  }
  const { light, dark, mark } = ids;
  if (light === undefined || dark === undefined || mark === undefined) {
    throw new Error('seed: a logo was neither found nor added');
  }
  const [first] = await kits.kitVersions(ctx, target.id);
  if (first?.version !== 1) throw new Error('seed: the brand has no kit version 1');
  await kits.saveKit(ctx, target.id, withLogos(first.kit, { light, dark, mark }));
  return true;
}
