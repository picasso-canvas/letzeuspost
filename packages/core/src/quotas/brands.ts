// The brand-count limit (§02 plans: 3, 10 and 30 brands; #399). The plan's number lives in config/plans.ts; this says
// whether a workspace that has `brandsNow` brands may add one more. The database counts them, with the workspace
// locked (`createBrand` in @lzp/db).

/** Whether a workspace on `plan`, with `brandsNow` brands, may add another. */
export function canAddBrand(plan: { readonly brands: number }, brandsNow: number): boolean {
  if (!Number.isInteger(brandsNow) || brandsNow < 0) {
    throw new Error(`canAddBrand: expected a count of brands, got ${String(brandsNow)}`);
  }
  return brandsNow < plan.brands;
}
