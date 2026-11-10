// Which provider does each kind of work (§09, §02, §10). The code talks to a provider interface, so another provider
// is added here and behind that interface, never in the pipeline. Sensitive file (§13).
import { z } from 'zod';

/** Every provider each kind of work may use; `providers` picks the one in use. */
export const providerChoices = {
  // §09: text is written by Anthropic's models; config/models.ts picks the model for each task.
  text: ['anthropic'],
  // §10: AI image generation comes after launch; its provider is chosen when it is planned.
  imageGeneration: [],
  // §02 In the product: `manual` in the partner phase (nothing is charged, Zeus sets plans by hand), later `paddle`
  // abroad and a local gateway for taka (picked at build time, §02 How money comes in). Stripe can be added later.
  billing: ['manual', 'paddle', 'local-gateway'],
} as const;

export const providersSchema = z.strictObject({
  text: z.enum(providerChoices.text),
  imageGeneration: z.null(),
  billing: z.enum(providerChoices.billing),
});

export type Providers = z.infer<typeof providersSchema>;

export const providers = {
  text: 'anthropic',
  imageGeneration: null,
  billing: 'manual',
} as const satisfies Providers;

providersSchema.parse(providers);
