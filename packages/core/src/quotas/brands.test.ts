// The brand-count limit (§02 Running out, and limits: "Brand, seat and storage limits block adding more"), against
// the real plans in config/plans.ts: 3, 10 and 30 brands.
import { describe, expect, it } from 'vitest';
import { plans } from '../../../../config/plans.ts';
import { canAddBrand } from './brands.ts';

describe('canAddBrand(plan, brandsNow)', () => {
  it.each([
    ['starter', 3],
    ['agency', 10],
    ['scale', 30],
  ] as const)('%s: allows brands up to its %i, and refuses the one past it', (name, limit) => {
    const plan = plans[name];
    expect(plan.brands).toBe(limit);
    expect(canAddBrand(plan, 0)).toBe(true);
    expect(canAddBrand(plan, limit - 1)).toBe(true); // the last one that fits
    expect(canAddBrand(plan, limit)).toBe(false); // full: one more would be limit + 1
    expect(canAddBrand(plan, limit + 1)).toBe(false); // already over, after a downgrade (§02)
  });

  it('takes a limit the admin panel set for one workspace (§15), not only a plan’s', () => {
    expect(canAddBrand({ brands: 1 }, 0)).toBe(true);
    expect(canAddBrand({ brands: 1 }, 1)).toBe(false);
  });

  it('refuses a count that is no count of brands', () => {
    for (const brandsNow of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => canAddBrand(plans.starter, brandsNow), String(brandsNow)).toThrow(
        'a count of brands',
      );
    }
  });
});
