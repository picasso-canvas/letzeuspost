import { describe, expect, it } from 'vitest';
import { backupName, backupsToDelete, KEEP_DAYS } from './picasso-backup.ts';

const at = (iso: string) => new Date(iso);

describe('backupName', () => {
  it('carries the time and sorts by it', () => {
    expect(backupName(at('2026-11-25T03:00:07Z'))).toBe(
      'letzeuspost-2026-11-25T03-00-00Z.dump'.replace('00-00Z', '00-07Z'),
    );
    expect(backupName(at('2026-11-09T03:00:00Z')) < backupName(at('2026-11-25T03:00:00Z'))).toBe(
      true,
    );
  });
});

describe('backupsToDelete', () => {
  const now = at('2026-11-25T03:00:00Z');
  const day = (d: number) => backupName(at(`2026-11-${String(d).padStart(2, '0')}T03:00:00Z`));

  it('keeps 14 days', () => {
    expect(KEEP_DAYS).toBe(14);
    // Nov 11 03:00 is exactly 14 days old: kept. Nov 10 is older: deleted.
    expect(backupsToDelete([day(9), day(10), day(11), day(12), day(25)], now)).toEqual([
      day(9),
      day(10),
    ]);
  });

  it('never lists a file that is not a backup', () => {
    expect(backupsToDelete(['notes.txt', `${day(1)}.partial`, day(2), day(25)], now)).toEqual([
      day(2),
    ]);
  });

  it('keeps the newest backup however old it is', () => {
    expect(backupsToDelete([day(1), day(2)], now)).toEqual([day(1)]);
  });
});
