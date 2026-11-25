import { describe, expect, it } from 'vitest';
import { essentialsMissing } from './essentials.ts';
import { emptyKit, fullKit, item } from './test-fixtures.ts';

describe('essentialsMissing', () => {
  it('says all five are missing from an empty kit, in §06 order', () => {
    expect(essentialsMissing(emptyKit() as never)).toEqual([
      'name',
      'color',
      'tone',
      'language',
      'country',
    ]);
  });

  it('says none are missing from a full kit', () => {
    expect(essentialsMissing(fullKit())).toEqual([]);
  });

  it('returns only the missing ones', () => {
    const kit = fullKit();
    kit.identity = { ...kit.identity, name: undefined, nameBn: undefined };
    kit.holidays = {};
    expect(essentialsMissing(kit)).toEqual(['name', 'country']);
  });

  it('takes a Bangla-only name as a name', () => {
    const kit = {
      ...fullKit(),
      identity: { nameBn: item('গল্প ক্যাফে') },
    } as never;
    expect(essentialsMissing(kit)).not.toContain('name');
  });

  it.each([
    ['primary', { primary: item('#8b2e16') }],
    ['accent', { accent: item('#8b2e16') }],
    ['background', { background: item('#fff8ee') }],
    ['ink', { ink: item('#1b1b1b') }],
    ['an extra', { extras: [item('#2f6f4f')] }],
  ])('takes %s as a colour', (_which, colors) => {
    const kit = { ...emptyKit(), identity: { colors } } as never;
    expect(essentialsMissing(kit)).not.toContain('color');
  });

  it('takes one tone word as tone, and one network’s main language as language', () => {
    const kit = {
      ...emptyKit(),
      voice: { toneWords: [item('warm')], mainLanguage: { facebook: item('bn') } },
    } as never;
    expect(essentialsMissing(kit)).toEqual(['name', 'color', 'country']);
  });

  it('counts an empty tone list and an empty language map as missing', () => {
    const kit = { ...emptyKit(), voice: { toneWords: [], mainLanguage: {} } } as never;
    expect(essentialsMissing(kit)).toContain('tone');
    expect(essentialsMissing(kit)).toContain('language');
  });

  it('counts an item marked needs-you as still missing: it is a question, not an answer', () => {
    const kit = fullKit();
    kit.holidays = { country: item('BD', { source: 'answer', confidence: 'needs-you' }) };
    expect(essentialsMissing(kit)).toEqual(['country']);
  });

  it('counts a guessed item as filled: the agency still sees it marked', () => {
    const kit = fullKit();
    kit.holidays = { country: item('BD', { source: 'answer', confidence: 'guessed' }) };
    expect(essentialsMissing(kit)).toEqual([]);
  });
});
