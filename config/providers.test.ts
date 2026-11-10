import { describe, expect, it } from 'vitest';
import { providerChoices, providers, providersSchema } from './providers.ts';

describe('config/providers.ts', () => {
  it('uses Anthropic for text (§09)', () => {
    expect(providers.text).toBe('anthropic');
    expect(providerChoices.text).toEqual(['anthropic']);
  });

  it('has no image generation provider until after launch (§10)', () => {
    expect(providers.imageGeneration).toBeNull();
    expect(providerChoices.imageGeneration).toEqual([]);
  });

  it('bills manually in the partner phase, with Paddle and the local gateway named for later (§02)', () => {
    expect(providers.billing).toBe('manual');
    expect(providerChoices.billing).toEqual(['manual', 'paddle', 'local-gateway']);
  });

  it('names exactly the three kinds of work', () => {
    expect(Object.keys(providers).sort()).toEqual(['billing', 'imageGeneration', 'text']);
  });

  it('passes its own schema', () => {
    expect(providersSchema.safeParse(providers).success).toBe(true);
  });

  describe('the schema refuses', () => {
    const cases: Record<string, unknown> = {
      'another text provider': { ...providers, text: 'openai' },
      'an image provider before one is planned': { ...providers, imageGeneration: 'anthropic' },
      'Stripe, which is not set up (§02)': { ...providers, billing: 'stripe' },
      'a missing kind of work': { text: 'anthropic', billing: 'manual' },
      'an unknown kind of work': { ...providers, video: 'anthropic' },
    };
    for (const [name, value] of Object.entries(cases)) {
      it(name, () => {
        expect(providersSchema.safeParse(value).success).toBe(false);
      });
    }
  });
});
