// The plans, extra packs and AI cost caps (§02 Plans, Running out and limits). Sensitive file (§13). Plans differ only
// in amounts: every plan has all 7 networks, all 4 jobs, both languages, every look and export (§02). The admin panel
// can override any amount for one workspace (§15, M6); quotas enforce them (packages/core/src/quotas).
//
// Money is whole numbers of the smallest unit: dollar prices and every AI amount in micro-dollars (§13), taka prices
// in poisha, 1 taka = 100 poisha (Q16, decided 2026-11-07). AI ceilings are in dollars for the taka plans too, because
// AI is paid in dollars. Taka prices are before VAT, which is added on top (§02).
import { z } from 'zod';

/** Whole dollars in micro-dollars. */
const dollars = (amount: number): number => amount * 1_000_000;
/** Whole taka in poisha. */
const taka = (amount: number): number => amount * 100;

/** Annual billing is 10 × the monthly price, 2 months free; posts still reset monthly (§02). */
const ANNUAL_MONTHS = 10;

const microDollars = z.int().positive();
const poisha = z.int().positive();
const count = z.int().positive();

/** A plan's price list in one currency. The AI ceiling is §02's: its posts at a pessimistic $0.20 each, plus 25%. */
const priceList = (money: z.ZodInt) =>
  z
    .strictObject({ monthly: money, annual: money, postsPerMonth: count, aiCeiling: microDollars })
    .refine(({ monthly, annual }) => annual === ANNUAL_MONTHS * monthly, {
      message: `The annual price is ${String(ANNUAL_MONTHS)} × the monthly one (§02)`,
    });

const planSchema = z.strictObject({
  name: z.string().min(1),
  brands: count,
  /** Owner, Admins and Editors; Viewers are free (§15). */
  seats: count,
  /** Storage for uploads. */
  storageGb: count,
  prices: z.strictObject({ usd: priceList(microDollars), bdt: priceList(poisha) }),
});

export const plansConfigSchema = z.strictObject({
  plans: z.record(z.enum(['starter', 'agency', 'scale']), planSchema),
  extraPack: z.strictObject({
    posts: count,
    price: z.strictObject({ usd: microDollars, bdt: poisha }),
    /** A pack raises the AI ceiling by the same rule as the plans (§02). */
    aiCeilingRaise: microDollars,
  }),
  /** Across every workspace, during the partner phase (§02, §22). */
  globalDailyAiCap: microDollars,
});

export type PlansConfig = z.input<typeof plansConfigSchema>;

export const plans = {
  starter: {
    name: 'Starter',
    brands: 3,
    seats: 2,
    storageGb: 10,
    prices: {
      usd: {
        monthly: dollars(49),
        annual: dollars(490),
        postsPerMonth: 80,
        aiCeiling: dollars(20),
      },
      bdt: {
        monthly: taka(2_900),
        annual: taka(29_000),
        postsPerMonth: 60,
        aiCeiling: dollars(15),
      },
    },
  },
  agency: {
    name: 'Agency',
    brands: 10,
    seats: 5,
    storageGb: 50,
    prices: {
      usd: {
        monthly: dollars(129),
        annual: dollars(1_290),
        postsPerMonth: 300,
        aiCeiling: dollars(75),
      },
      bdt: {
        monthly: taka(7_900),
        annual: taka(79_000),
        postsPerMonth: 200,
        aiCeiling: dollars(50),
      },
    },
  },
  scale: {
    name: 'Scale',
    brands: 30,
    seats: 15,
    storageGb: 200,
    prices: {
      usd: {
        monthly: dollars(299),
        annual: dollars(2_990),
        postsPerMonth: 1_000,
        aiCeiling: dollars(250),
      },
      bdt: {
        monthly: taka(17_900),
        annual: taka(179_000),
        postsPerMonth: 500,
        aiCeiling: dollars(125),
      },
    },
  },
} as const satisfies PlansConfig['plans'];

export type PlanName = keyof typeof plans;

/** Extra posts, bought by the Owner, available at once, used before the next monthly reset (§02). */
export const extraPack = {
  posts: 100,
  price: { usd: dollars(25), bdt: taka(2_500) },
  aiCeilingRaise: dollars(25),
} as const satisfies PlansConfig['extraPack'];

export const globalDailyAiCap = dollars(100);

plansConfigSchema.parse({ plans, extraPack, globalDailyAiCap });
