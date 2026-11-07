import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** True when the module at `url` is the script node was started with (symlinked and encoded paths included). */
export function isEntryPoint(url: string): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}
