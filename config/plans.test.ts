import { describe, expect, it } from 'vitest';
import { extraPack, globalDailyAiCap, plans, plansConfigSchema, type PlansConfig } from './plans.ts';

// Money units (§13 and Q16): dollars and every AI amount in integer micro-dollars, taka in integer poisha.
const USD = 1_000_000;
const BDT = 100;

// §02 Plans: [price a month, posts a month] per currency, then brands, seats and storage.
const section02 = {
  starter: { name: 'Starter', usd: [49, 80], bdt: [2_900, 60], brands: 3, seats: 2, storageGb: 10 },
  agency: {
    name: 'Agency',
    usd: [129, 300],
    bdt: [7_900, 200],
    brands: 10,
    seats: 5,
    storageGb: 50,
  },
  scale: {
    name: 'Scale',
    usd: [299, 1_000],
    bdt: [17_900, 500],
    brands: 30,
    seats: 15,
    storageGb: 200,
  },
} as const;

// §02 Running out, and limits: the AI cost ceilings, in dollars, for the dollar and the taka plans.
const ceilings = { starter: [20, 15], agency: [75, 50], scale: [250, 125] } as const;

const names = ['starter', 'agency', 'scale'] as const;

const valid = (): PlansConfig => structuredClone({ plans, extraPack, globalDailyAiCap });

/** §02's rule: posts at a pessimistic $0.20 each, plus 25%, in micro-dollars (whole numbers, no float error). */
const ceilingFor = (posts: number) => (posts * 200_000 * 125) / 100;

describe('config/plans.ts', () => {
  it('has the three tiers, Starter, Agency and Scale', () => {
    expect(Object.keys(plans)).toEqual(names);
    for (const name of names) expect(plans[name].name).toBe(section02[name].name);
  });

  it.each(names)('%s: dollar price and posts a month', (name) => {
    const [price, posts] = section02[name].usd;
    expect(plans[name].prices.usd.monthly).toBe(price * USD);
    expect(plans[name].prices.usd.postsPerMonth).toBe(posts);
  });

  it.each(names)('%s: taka price, in poisha, and posts a month', (name) => {
    const [price, posts] = section02[name].bdt;
    expect(plans[name].prices.bdt.monthly).toBe(price * BDT);
    expect(plans[name].prices.bdt.postsPerMonth).toBe(posts);
  });

  it.each(names)('%s: brands, seats and storage', (name) => {
    const { brands, seats, storageGb } = section02[name];
    expect({
      brands: plans[name].brands,
      seats: plans[name].seats,
      storageGb: plans[name].storageGb,
    }).toEqual({
      brands,
      seats,
      storageGb,
    });
  });

  it.each(names)(
    '%s: annual is 10 × the monthly price (2 months free), in both currencies',
    (name) => {
      for (const currency of ['usd', 'bdt'] as const) {
        const price = plans[name].prices[currency];
        expect(price.annual).toBe(10 * price.monthly);
      }
    },
  );

  it.each(names)('%s: AI cost ceilings, in micro-dollars for both currencies', (name) => {
    const [usdPlan, bdtPlan] = ceilings[name];
    expect(plans[name].prices.usd.aiCeiling).toBe(usdPlan * USD);
    expect(plans[name].prices.bdt.aiCeiling).toBe(bdtPlan * USD);
  });

  it("follows §02's ceiling rule: each plan's posts at a pessimistic $0.20, plus 25%", () => {
    for (const name of names) {
      for (const { postsPerMonth, aiCeiling } of Object.values(plans[name].prices)) {
        expect(aiCeiling).toBe(ceilingFor(postsPerMonth));
      }
    }
  });

  it('sells extra packs of 100 posts for $25 or ৳2,500, raising the AI ceiling by the same rule', () => {
    expect(extraPack.posts).toBe(100);
    expect(extraPack.price.usd).toBe(25 * USD);
    expect(extraPack.price.bdt).toBe(2_500 * BDT);
    expect(extraPack.aiCeilingRaise).toBe(ceilingFor(extraPack.posts));
  });

  it('caps AI spend at $100 a day across every workspace', () => {
    expect(globalDailyAiCap).toBe(100 * USD);
  });

  it('stores every amount as a whole number of the smallest unit', () => {
    const amounts = [
      ...names.flatMap((name) =>
        Object.values(plans[name].prices).flatMap(({ monthly, annual, aiCeiling }) => [
          monthly,
          annual,
          aiCeiling,
        ]),
      ),
      extraPack.price.usd,
      extraPack.price.bdt,
      extraPack.aiCeilingRaise,
      globalDailyAiCap,
    ];
    for (const amount of amounts) expect(Number.isSafeInteger(amount), String(amount)).toBe(true);
  });

  it('passes its own schema', () => {
    expect(plansConfigSchema.safeParse({ plans, extraPack, globalDailyAiCap }).success).toBe(true);
  });

  describe('the schema refuses', () => {
    it('a price in taka rather than poisha, or any fraction of the unit', () => {
      const config = valid();
      config.plans.starter.prices.bdt.monthly = 2_900.5;
      expect(plansConfigSchema.safeParse(config).success).toBe(false);
    });

    it('an annual price that is not 10 × the monthly one', () => {
      const config = valid();
      config.plans.agency.prices.usd.annual = 12 * config.plans.agency.prices.usd.monthly;
      expect(plansConfigSchema.safeParse(config).success).toBe(false);
    });

    it('a negative or zero limit', () => {
      for (const field of ['brands', 'seats', 'storageGb'] as const) {
        const config = valid();
        config.plans.scale[field] = 0;
        expect(plansConfigSchema.safeParse(config).success, field).toBe(false);
      }
      const config = valid();
      config.plans.scale.prices.bdt.postsPerMonth = -1;
      expect(plansConfigSchema.safeParse(config).success).toBe(false);
    });

    it('a plan without a currency, or with another currency', () => {
      const missing = valid();
      const { bdt: _bdt, ...usdOnly } = missing.plans.starter.prices;
      const withoutBdt = {
        ...missing,
        plans: { ...missing.plans, starter: { ...missing.plans.starter, prices: usdOnly } },
      };
      expect(plansConfigSchema.safeParse(withoutBdt).success).toBe(false);
      const extra = valid();
      Object.assign(extra.plans.starter.prices, { eur: extra.plans.starter.prices.usd });
      expect(plansConfigSchema.safeParse(extra).success).toBe(false);
    });

    it('a missing global daily cap', () => {
      const { globalDailyAiCap: _cap, ...rest } = valid();
      expect(plansConfigSchema.safeParse(rest).success).toBe(false);
    });
  });
});
