// How a tenancy test says what it covers: `tenancy('<entry>', () => { it(…) })`, where `<entry>` is one line of the
// list in ./inventory.ts. inventory.test.ts reads these blocks from the files (it doesn't run them), and fails while
// any entry on the list has none that holds a test.
import { describe } from 'vitest';

export function tenancy(entry: string, body: () => void): void {
  describe(`tenancy: ${entry}`, body);
}
