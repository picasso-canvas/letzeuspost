import { describe, expect, it } from 'vitest';
import { initialsOf } from '@lzp/ui/lib/initials';

// The letters on a workspace's or a person's avatar when there is no picture: the first letter of the first two words.
describe('initialsOf', () => {
  it('takes the first letter of the first two words, in capitals', () => {
    expect(initialsOf('Northwind Social')).toBe('NS');
    expect(initialsOf('nadia karim')).toBe('NK');
    expect(initialsOf('Kite and Co Studio')).toBe('KA');
  });

  it('gives one letter for one word, and skips signs that are not part of a name', () => {
    expect(initialsOf('Golpo')).toBe('G');
    expect(initialsOf('  Kite & Co ')).toBe('KC');
    expect(initialsOf('(Golpo) Café')).toBe('GC');
  });

  // Zeus, 2026-11-11 (#223): a Bangla name's initials are the first letter of its first word, and only that.
  it('gives a Bangla name just the first letter of its first word, joining words and all', () => {
    expect(initialsOf('ঢাকা ও সিলেট')).toBe('ঢা');
    expect(initialsOf('কাজ')).toBe('কা');
    expect(initialsOf('  & ঢাকা ও সিলেট ')).toBe('ঢা');
  });

  it('never cuts a combined Bangla letter: the vowel sign and the anusvara stay with the consonant', () => {
    // "বাংলা" opens with one cluster: ব, the sign আ and the anusvara.
    expect(initialsOf('বাংলা পোস্ট')).toBe('বাং');
    // "ক্ষ" is two consonants joined by a hasanta: one letter.
    expect(initialsOf('ক্ষেত্র পোস্ট')).toBe('ক্ষে');
  });

  it('gives a name that mixes Bangla and English the Bangla rule', () => {
    expect(initialsOf('ঢাকা Studio')).toBe('ঢা');
    expect(initialsOf('Dhaka ঢাকা')).toBe('D');
  });

  it('keeps digits, and gives nothing for a name with no letters at all', () => {
    expect(initialsOf('42 Studio')).toBe('4S');
    expect(initialsOf('')).toBe('');
    expect(initialsOf(' & … ')).toBe('');
  });
});
