// Runs once when the server starts. A missing or malformed setting stops the app here, with an error that names the
// setting and never shows its value (§13 Environments, config/env.ts).
import { loadEnv } from '@lzp/config';

export function register(): void {
  if (process.env.NEXT_RUNTIME === 'nodejs') loadEnv('web');
}
