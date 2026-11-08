import { describe, expect, it } from 'vitest';
import { signRefusal } from './zeus-sign.ts';

const ok = { number: '111', text: 'I approve X.', tty: true, env: {} };

describe('signRefusal (#113)', () => {
  it('lets Zeus sign from his own terminal', () => {
    expect(signRefusal(ok)).toBeNull();
  });

  it('refuses without a terminal, where ssh-keygen could not ask for the passphrase', () => {
    expect(signRefusal({ ...ok, tty: false })).toMatch(/own terminal/);
  });

  it('refuses inside Claude Code', () => {
    expect(signRefusal({ ...ok, env: { CLAUDECODE: '1' } })).toMatch(/Claude Code/);
  });

  it('refuses a bad number, an empty text, and a text that would break the comment', () => {
    expect(signRefusal({ ...ok, number: '0' })).toMatch(/number/);
    expect(signRefusal({ ...ok, number: '11a' })).toMatch(/number/);
    expect(signRefusal({ ...ok, text: '  ' })).toMatch(/text/);
    expect(signRefusal({ ...ok, text: 'a ``` b' })).toMatch(/```/);
    expect(signRefusal({ ...ok, text: 'a\rb' })).toMatch(/carriage/);
  });
});
