import { describe, expect, it } from 'vitest';
import { SIZE_NAMES } from '../src/sizes.ts';
import { sampleBatch, takeRenders } from './batch.ts';
import { optionsFromEnv, SOAK_RENDERS } from './config.ts';

describe('the sample batch (§08: 12 posts, about 120 slide renders)', () => {
  const batch = sampleBatch();

  it('is 12 posts of 2 slides at all 5 sizes: 120 renders', () => {
    expect(new Set(batch.map((job) => job.postId)).size).toBe(12);
    expect(batch).toHaveLength(120);
    for (const size of SIZE_NAMES)
      expect(batch.filter((job) => job.size === size)).toHaveLength(24);
  });

  it('covers English and Bangla in both looks, 3 posts of each', () => {
    const posts = new Map(batch.map((job) => [job.postId, job.post]));
    const counts = new Map<string, number>();
    for (const post of posts.values()) {
      const key = `${post.lang}/${post.look.name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.entries()].sort()).toEqual([
      ['bn/clean', 3],
      ['bn/playful', 3],
      ['en/clean', 3],
      ['en/playful', 3],
    ]);
  });

  it('draws each look in its own font pair', () => {
    for (const job of batch) {
      expect(job.post.slides).toContain(job.slide);
      expect(job.kit.fonts.en.heading).toBe(
        job.post.look.name === 'clean' ? 'Nunito' : 'Bagel Fat One',
      );
    }
  });

  it('uses several layouts, so no one of them sets the numbers', () => {
    expect(new Set(batch.map((job) => job.slide.layout)).size).toBeGreaterThanOrEqual(8);
  });

  it('puts the first renders across the sizes and both languages and looks, so a short run is a fair sample', () => {
    const first = batch.slice(0, 50);
    expect(new Set(first.map((job) => job.size))).toEqual(new Set(SIZE_NAMES));
    expect(new Set(first.map((job) => job.post.lang))).toEqual(new Set(['en', 'bn']));
    expect(new Set(first.map((job) => job.post.look.name))).toEqual(new Set(['clean', 'playful']));
  });
});

describe('takeRenders', () => {
  const batch = sampleBatch();

  it('is the start of the batch for a shorter run', () => {
    expect(takeRenders(batch, 50)).toEqual(batch.slice(0, 50));
  });

  it('starts the batch again for a longer one', () => {
    const jobs = takeRenders(batch, 130);
    expect(jobs).toHaveLength(130);
    expect(jobs[120]).toBe(batch[0]);
    expect(jobs[129]).toBe(batch[9]);
  });
});

describe('optionsFromEnv', () => {
  it('is the 120-render batch by default', () => {
    expect(optionsFromEnv({}, 120)).toEqual({ renders: 120, soak: false });
    expect(optionsFromEnv({ LZP_RENDER_SOAK: '0' }, 120)).toEqual({ renders: 120, soak: false });
  });

  it('is 1,000 renders with the memory check when LZP_RENDER_SOAK=1', () => {
    expect(optionsFromEnv({ LZP_RENDER_SOAK: '1' }, 120)).toEqual({
      renders: SOAK_RENDERS,
      soak: true,
    });
    expect(SOAK_RENDERS).toBe(1000);
  });
});
