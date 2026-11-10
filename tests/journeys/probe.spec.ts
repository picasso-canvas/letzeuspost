import { expect, test } from '@playwright/test';

// A throwaway probe for #172: never merged.
test('probe passes', () => {
  expect(1).toBe(1);
});

test('probe is expected to fail', () => {
  test.fail();
  expect(1).toBe(2);
});
