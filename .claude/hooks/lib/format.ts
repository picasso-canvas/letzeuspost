// PostToolUse formatting that a builder can't redirect (Cerberus on #86). The hook runs unsandboxed, so it never hands
// prettier a path to write: from inside the file's folder, once that folder is known to be in the clone (inFolder),
// the file is read once without following a link, prettier formats that text from stdin, and the result goes back
// through a descriptor opened without following a link, only while it is still the same regular file (device and
// inode) with a single link. A file swapped for a link, another file or a second link in the meantime is left alone,
// and a folder above swapped for a link can't move the read or the write out of the clone. (If the builder deletes
// the file, Linux may give its inode number to the next new file; that file can only be one the builder itself
// created where its sandbox lets it write, so the write still lands there.)
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  openSync,
  readSync,
  writeSync,
  type Stats,
} from 'node:fs';
import { inFolder } from './hook-io.ts';

const LIMIT = 2_000_000;

interface Snapshot {
  text: string;
  dev: number;
  ino: number;
}

function plainFile(stat: Stats): boolean {
  return stat.isFile() && stat.nlink === 1;
}

function readOnce(path: string): Snapshot | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!plainFile(stat) || stat.size > LIMIT) return null;
    const buffer = Buffer.alloc(stat.size);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return { text: buffer.subarray(0, read).toString('utf8'), dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

function writeIfSame(path: string, before: Snapshot, text: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return false;
  }
  try {
    const stat = fstatSync(fd);
    if (!plainFile(stat) || stat.dev !== before.dev || stat.ino !== before.ino) return false;
    ftruncateSync(fd, 0);
    writeSync(fd, text, 0, 'utf8');
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}

/** Formats `path`, in a folder inside `root`, with `format` (text in, text out; null to skip). True when it wrote. */
export function formatFile(
  path: string,
  root: string,
  format: (text: string) => string | null,
): boolean {
  const wrote = inFolder(path, root, (name) => {
    const before = readOnce(name);
    if (before === null) return false;
    const after = format(before.text);
    if (after === null || after === before.text) return false;
    return writeIfSame(name, before, after);
  });
  return wrote === true;
}
