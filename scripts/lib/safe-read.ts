import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * Reads a file a builder wrote, from Athena's unsandboxed session, without following anything the builder could have
 * pointed elsewhere: the folder must be a real folder at its own path, the file a regular file with one link (a hard
 * link could reach a secret the builder can't read itself), opened with O_NOFOLLOW and checked again once open.
 */
export function readRegularFile(dir: string, name: string, maxBytes: number): Buffer {
  if (name !== basename(name) || name === '' || name === '.' || name === '..') {
    throw new Error(`bad file name: ${name}`);
  }
  const folder = lstatSync(dir);
  // The folder itself must not be a link (its parents may be: macOS's /var is), and must resolve to itself.
  const expected = join(realpathSync(dirname(resolve(dir))), basename(resolve(dir)));
  if (!folder.isDirectory() || folder.isSymbolicLink() || realpathSync(dir) !== expected) {
    throw new Error(`${dir} isn't a real folder at its own path`);
  }
  const path = join(dir, name);
  const before = lstatSync(path);
  if (!before.isFile()) throw new Error(`${path} isn't a regular file`);
  if (before.nlink !== 1) throw new Error(`${path} has another hard link`);
  if (before.size > maxBytes)
    throw new Error(`${path} is too large (${String(before.size)} bytes)`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const open = fstatSync(fd);
    if (open.ino !== before.ino || open.dev !== before.dev || !open.isFile() || open.nlink !== 1) {
      throw new Error(`${path} changed while it was being read`);
    }
    const buffer = Buffer.alloc(open.size);
    let read = 0;
    while (read < open.size) {
      const n = readSync(fd, buffer, read, open.size - read, read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}
