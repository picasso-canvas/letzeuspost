import { describe, expect, it } from 'vitest';
import { assertNever } from './assert-never.ts';

type Status = 'draft' | 'approved';

function label(status: Status): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'approved':
      return 'Approved';
    default:
      return assertNever(status);
  }
}

describe('assertNever', () => {
  it('is never reached when every case is handled', () => {
    expect(label('draft')).toBe('Draft');
    expect(label('approved')).toBe('Approved');
  });

  it('throws with the unexpected value when reached at runtime', () => {
    expect(() => assertNever('archived' as never)).toThrow('Unexpected value: "archived"');
  });
});
