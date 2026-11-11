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

  it('takes whole Bangla letters, vowel signs included, not half of one', () => {
    expect(initialsOf('বাংলা পোস্ট')).toBe('বাপো');
    expect(initialsOf('কাজ')).toBe('কা');
  });

  it('keeps digits, and gives nothing for a name with no letters at all', () => {
    expect(initialsOf('42 Studio')).toBe('4S');
    expect(initialsOf('')).toBe('');
    expect(initialsOf(' & … ')).toBe('');
  });
});
