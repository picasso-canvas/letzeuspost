import { describe, expect, it } from 'vitest';
import { features, featuresSchema } from './features.ts';

// §18 What's in the January launch, "Right after launch": the features that can go to one partner first (§15).
const afterLaunch = [
  'clientPhotoUploads',
  'productCutouts',
  'lookBold',
  'lookEditorial',
  'layoutTestimonial',
  'layoutPhotocard',
  'layoutMeme',
  'layoutBeforeafter',
  'stockImages',
  'aiImages',
];

const valid = () => structuredClone(features) as Record<string, Record<string, unknown>>;

describe('config/features.ts', () => {
  it('names the after-launch features of §18', () => {
    expect(Object.keys(features)).toEqual(afterLaunch);
  });

  it('starts every feature off (§15: new features start off)', () => {
    for (const [name, feature] of Object.entries(features))
      expect(feature.defaultOn, name).toBe(false);
  });

  it('gives every feature a label for the admin panel and the section it comes from', () => {
    for (const [name, feature] of Object.entries(features)) {
      expect(feature.label.trim(), name).not.toBe('');
      expect(feature.section, name).toMatch(/^§\d{2}$/);
    }
  });

  it('passes its own schema', () => {
    expect(featuresSchema.safeParse(features).success).toBe(true);
  });

  describe('the schema refuses', () => {
    it('a feature that starts on', () => {
      const config = valid();
      Object.assign(config['aiImages'] ?? {}, { defaultOn: true });
      expect(featuresSchema.safeParse(config).success).toBe(false);
    });

    it('a feature without a label or a section', () => {
      for (const field of ['label', 'section']) {
        const config = valid();
        Reflect.deleteProperty(config['stockImages'] ?? {}, field);
        expect(featuresSchema.safeParse(config).success, field).toBe(false);
      }
    });

    it('a name that is not camelCase, or an unknown key', () => {
      const config = valid();
      expect(
        featuresSchema.safeParse({
          ...config,
          'AI images': { label: 'AI', section: '§10', defaultOn: false },
        }).success,
      ).toBe(false);
      Object.assign(config['lookBold'] ?? {}, { plans: ['scale'] });
      expect(featuresSchema.safeParse(config).success).toBe(false);
    });
  });
});
