// Brands and their kit versions (#399, §13 Data model, §06): how a brand is added under its plan's limit, how a kit is
// saved as a new immutable version on every Save (Zeus, 2026-11-25), and how a brand's versions are read. Every step
// runs through `db.forWorkspace`, so row-level security keeps each workspace's brands to itself.
//
// The kit's shape is #398's `BrandKitSchema` in @lzp/core, which this package doesn't depend on: the app passes it in
// (`brandKits(db, BrandKitSchema)`), and every Save and every read goes through it. The brand-count rule is
// @lzp/core's `canAddBrand`, passed in the same way (`allowed`), with the plan's limit from config/plans.ts.
import { asc, eq, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkedId, type Db, type WorkspaceCtx } from './db.ts';
import { workspace } from './schema/accounts.ts';
import { brand, brandKitVersion } from './schema/brands.ts';

/** What checks a kit: a zod schema (`BrandKitSchema`) is one. */
export interface KitSchema<Kit> {
  parse: (value: unknown) => Kit;
}

/** A new brand: its names (§13). The rest of it comes with its kit. */
export interface NewBrand {
  readonly nameEn: string;
  readonly nameBn?: string | undefined;
}

export interface KitVersion<Kit> {
  readonly id: string;
  readonly version: number;
  readonly kit: Kit;
  readonly savedAt: Date;
}

export interface BrandKits<Kit> {
  /**
   * Adds a brand if `allowed(brandsNow)` says the workspace may have one more (`canAddBrand` with its plan). The count
   * is taken with the workspace's row locked, so two adds at once can't both pass the limit. Refused: throws.
   */
  createBrand: (
    ctx: WorkspaceCtx,
    input: NewBrand,
    allowed: (brandsNow: number) => boolean,
  ) => Promise<{ id: string }>;
  /**
   * Checks `kit` with the kit schema, then writes it as the brand's next version (1 for the first Save) and makes that
   * the brand's current one, in one transaction with the brand's row locked. The only code that moves
   * `brand.current_kit_version`; the database lets it move only to the newest version (0007's trigger). A brand this
   * workspace doesn't have (another's, or none) is refused.
   */
  saveKit: (
    ctx: WorkspaceCtx,
    brandId: string,
    kit: unknown,
  ) => Promise<{ id: string; version: number }>;
  /** The brand's kit versions, oldest first; none for a brand this workspace doesn't have. */
  kitVersions: (ctx: WorkspaceCtx, brandId: string) => Promise<KitVersion<Kit>[]>;
}

const name = z.string().trim().min(1).max(200);
const newBrand = z.strictObject({ nameEn: name, nameBn: name.optional() });

export function brandKits<Kit>(db: Db, kitSchema: KitSchema<Kit>): BrandKits<Kit> {
  return {
    createBrand: async (ctx, input, allowed) => {
      const workspaceId = checkedId('workspace', ctx.workspaceId);
      const { nameEn, nameBn } = newBrand.parse(input);
      return db.forWorkspace(ctx).transaction(async (tx) => {
        // NO KEY UPDATE: it waits for another add in this workspace, not for rows that only point at the workspace.
        await tx
          .select({ id: workspace.id })
          .from(workspace)
          .where(eq(workspace.id, workspaceId))
          .for('no key update');
        // Filtered as well as RLS-bound, so the owner role (the seeds') counts this workspace's brands too.
        const [counted] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(brand)
          .where(eq(brand.workspaceId, workspaceId));
        const brandsNow = counted?.n ?? 0;
        if (!allowed(brandsNow)) {
          throw new Error(`brand limit reached: this workspace has ${String(brandsNow)} brands`);
        }
        const [made] = await tx
          .insert(brand)
          .values({ workspaceId, nameEn, nameBn: nameBn ?? null })
          .returning({ id: brand.id });
        if (made === undefined) throw new Error('database: the brand was not added');
        return made;
      });
    },

    saveKit: async (ctx, brandId, kit) => {
      const workspaceId = checkedId('workspace', ctx.workspaceId);
      const id = checkedId('brand', brandId);
      const checked = kitSchema.parse(kit);
      return db.forWorkspace(ctx).transaction(async (tx) => {
        const [found] = await tx
          .select({ id: brand.id })
          .from(brand)
          .where(eq(brand.id, id))
          .for('update');
        if (found === undefined) throw new Error('no such brand in this workspace');
        const [newest] = await tx
          .select({ version: max(brandKitVersion.version) })
          .from(brandKitVersion)
          .where(eq(brandKitVersion.brandId, id));
        const version = (newest?.version ?? 0) + 1;
        const [saved] = await tx
          .insert(brandKitVersion)
          .values({ workspaceId, brandId: id, version, kit: checked })
          .returning({ id: brandKitVersion.id, version: brandKitVersion.version });
        if (saved === undefined) throw new Error('database: the kit version was not written');
        await tx
          .update(brand)
          .set({ currentKitVersion: version, updatedAt: sql`now()` })
          .where(eq(brand.id, id));
        return saved;
      });
    },

    kitVersions: async (ctx, brandId) => {
      const id = checkedId('brand', brandId);
      const rows = await db.forWorkspace(ctx).transaction((tx) =>
        tx
          .select({
            id: brandKitVersion.id,
            version: brandKitVersion.version,
            kit: brandKitVersion.kit,
            savedAt: brandKitVersion.createdAt,
          })
          .from(brandKitVersion)
          .where(eq(brandKitVersion.brandId, id))
          .orderBy(asc(brandKitVersion.version)),
      );
      return rows.map((row) => ({ ...row, kit: kitSchema.parse(row.kit) }));
    },
  };
}
