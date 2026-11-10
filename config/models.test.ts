import { describe, expect, it } from 'vitest';
import { modelConfigSchema, models, prices } from './models.ts';

// §09 Model and provider config, line for line.
const section09Models = {
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
};

// USD per million tokens, checked 2026-11-06 (§09).
const section09Prices = { 'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 } };

const valid = () => ({
  models: structuredClone(section09Models),
  prices: structuredClone(section09Prices),
});

describe('config/models.ts', () => {
  it('holds the 11 AI tasks of §09, in its order', () => {
    expect(Object.keys(models)).toEqual(Object.keys(section09Models));
    expect(Object.keys(models)).toHaveLength(11);
  });

  it('matches §09 line for line: provider, model id, effort and web search per task', () => {
    expect(models).toEqual(section09Models);
  });

  it('sets the effort on every task, since Opus 5.5 thinking cannot be turned off', () => {
    for (const choice of Object.values(models))
      expect(choice.effort).toMatch(/^(low|medium|high)$/);
  });

  it('turns web search on for writePost only, for the fact layouts', () => {
    const searching = Object.entries(models).filter(([, choice]) => 'webSearch' in choice);
    expect(searching).toEqual([['writePost', section09Models.writePost]]);
  });

  it('prices claude-opus-5-5 at $4 in, $20 out and $0.20 cache read per million tokens', () => {
    expect(prices).toEqual(section09Prices);
  });

  it('passes its own schema', () => {
    expect(modelConfigSchema.safeParse({ models, prices }).success).toBe(true);
  });

  describe('the schema refuses', () => {
    it('a task without an effort', () => {
      const config = valid();
      Reflect.deleteProperty(config.models.qc, 'effort');
      expect(modelConfigSchema.safeParse(config).success).toBe(false);
    });

    it('an effort Opus 5.5 does not have', () => {
      const config = valid();
      Object.assign(config.models.qc, { effort: 'none' });
      expect(modelConfigSchema.safeParse(config).success).toBe(false);
    });

    it('a provider that providers.ts does not name for text', () => {
      const config = valid();
      Object.assign(config.models.qc, { provider: 'openai' });
      expect(modelConfigSchema.safeParse(config).success).toBe(false);
    });

    it('a date-suffixed or guessed model id', () => {
      for (const model of ['claude-opus-5-5-20261101', 'Claude Opus 5.5', 'claude-opus-5.5', '']) {
        const config = valid();
        Object.assign(config.models.qc, { model });
        expect(modelConfigSchema.safeParse(config).success, model).toBe(false);
      }
    });

    it('a model with no price', () => {
      const config = valid();
      Object.assign(config.models.qc, { model: 'claude-sonnet-5' });
      expect(modelConfigSchema.safeParse(config).success).toBe(false);
    });

    it('an unknown web search mode or an unknown key', () => {
      const search = valid();
      Object.assign(search.models.writePost, { webSearch: 'always' });
      expect(modelConfigSchema.safeParse(search).success).toBe(false);
      const extra = valid();
      Object.assign(extra.models.qc, { temperature: 1 });
      expect(modelConfigSchema.safeParse(extra).success).toBe(false);
    });

    it('a negative or missing price', () => {
      const negative = valid();
      negative.prices['claude-opus-5-5'].output = -1;
      expect(modelConfigSchema.safeParse(negative).success).toBe(false);
      const missing = valid();
      Reflect.deleteProperty(missing.prices['claude-opus-5-5'], 'cacheRead');
      expect(modelConfigSchema.safeParse(missing).success).toBe(false);
    });
  });
});
