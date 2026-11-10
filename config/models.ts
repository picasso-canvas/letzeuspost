// The model behind each AI task (§09 Model and provider config). One line per task: switching a task's model is a
// one-line change. Sensitive file (§13). Model ids are exactly as Anthropic publishes them, never guessed or
// date-suffixed. Opus 5.5's thinking can't be turned off, so every task sets its effort.
import { z } from 'zod';
import { providerChoices } from './providers.ts';

export const models = {
  extractSource: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' },
  brandProfile: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' },
  planBatch: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' },
  writePost: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'high',
    webSearch: 'fact-layouts',
  },
  pickImages: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' },
  fitFix: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' },
  rewrite: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' },
  qc: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' },
  banglaJudge: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'medium' },
  tagAsset: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' },
  learnLessons: { provider: 'anthropic', model: 'claude-opus-5-5', effort: 'low' },
} as const;

// USD per million tokens, checked 2026-11-06 (Anthropic pricing). Dollars per million tokens are micro-dollars per
// token, the unit §13 stores money in.
export const prices = { 'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 } } as const;

export type AiTask = keyof typeof models;

/** An Anthropic model id: lowercase words and numbers joined by hyphens, with no date suffix. */
const modelId = z
  .string()
  .regex(/^claude(-[a-z0-9]+)+$/)
  .refine((id) => !/-\d{8}$/.test(id), 'Model ids are never date-suffixed (§09)');

const usdPerMillionTokens = z.number().nonnegative();

export const modelConfigSchema = z
  .strictObject({
    models: z.record(
      z.string(),
      z.strictObject({
        provider: z.enum(providerChoices.text),
        model: modelId,
        effort: z.enum(['low', 'medium', 'high']),
        // §09 Web search: fact, stat and photo-card posts only.
        webSearch: z.literal('fact-layouts').optional(),
      }),
    ),
    prices: z.record(
      modelId,
      z.strictObject({
        input: usdPerMillionTokens,
        output: usdPerMillionTokens,
        cacheRead: usdPerMillionTokens,
      }),
    ),
  })
  .refine(
    ({ models, prices }) =>
      Object.values(models).every(({ model }) => Object.hasOwn(prices, model)),
    'Every model a task uses needs a price',
  );

modelConfigSchema.parse({ models, prices });
