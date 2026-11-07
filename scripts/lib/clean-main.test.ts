import { describe, expect, it } from 'vitest';
import { assertCleanMain } from './clean-main.ts';

function fake(answers: Record<string, string>) {
  return (_cmd: string, args: string[]) => answers[args.join(' ')] ?? '';
}
const ok = {
  'symbolic-ref --short HEAD': 'main\n',
  'rev-parse HEAD': 'a'.repeat(40),
  'rev-parse origin/main': 'a'.repeat(40),
  'status --porcelain --untracked-files=no': '',
};

describe('assertCleanMain', () => {
  it('returns HEAD on a clean main that matches origin/main', () => {
    expect(assertCleanMain(fake(ok))).toBe('a'.repeat(40));
  });

  it('refuses another branch, a stale main or a dirty tree', () => {
    expect(() => assertCleanMain(fake({ ...ok, 'symbolic-ref --short HEAD': 'x\n' }))).toThrow(
      /clean main/,
    );
    expect(() => assertCleanMain(fake({ ...ok, 'rev-parse origin/main': 'b'.repeat(40) }))).toThrow(
      /clean main/,
    );
    expect(() =>
      assertCleanMain(fake({ ...ok, 'status --porcelain --untracked-files=no': ' M a.ts' })),
    ).toThrow(/dirty/);
  });
});
