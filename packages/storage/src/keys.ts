// File keys (§13 File storage, the tenant-isolation skill): every key starts with `ws/<workspace id>/`, and the
// workspace comes from the caller's context, the same `WorkspaceCtx` as `db.forWorkspace`, never from a request. The
// builders check every part they put in a key, so no id, hash or name can add a folder or climb out of its own;
// `checkKey` is the other direction: it decides whether a key a caller already has belongs to the context's workspace.
import type { WorkspaceCtx } from '@lzp/db';

/** A key that isn't one of this workspace's, or a part that can't safely go in a key. The message never holds a key. */
export class StorageKeyError extends Error {
  override readonly name = 'StorageKeyError';
}

// Every id in the system is a UUIDv7 (§13 Data model), written in lowercase.
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{16,128}$/;
// A file name inside an export: letters, digits, dot, dash, underscore; never starts with a dot (so never `.` or `..`).
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

export const ASSET_VARIANTS = ['original', '1600', '360'] as const;
export type AssetVariant = (typeof ASSET_VARIANTS)[number];
export const RENDER_FORMATS = ['png', 'jpg', 'pdf', 'webp'] as const;
export type RenderFormat = (typeof RENDER_FORMATS)[number];

function part(kind: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new StorageKeyError(`not a valid ${kind} in a file key`);
  return value;
}

function workspacePrefix(ctx: WorkspaceCtx): string {
  return `ws/${part('workspace id', ctx.workspaceId, UUID_V7)}/`;
}

/** `ws/<workspace>/brands/<brand>/assets/<asset>/{original,1600,360}` */
export function assetKey(
  ctx: WorkspaceCtx,
  asset: { brandId: string; assetId: string; variant: AssetVariant },
): string {
  const variant = ASSET_VARIANTS.find((known) => known === asset.variant);
  if (variant === undefined) throw new StorageKeyError('not a valid asset size in a file key');
  const brand = part('brand id', asset.brandId, UUID_V7);
  const id = part('asset id', asset.assetId, UUID_V7);
  return `${workspacePrefix(ctx)}brands/${brand}/assets/${id}/${variant}`;
}

/** `ws/<workspace>/renders/<hash>.{png,jpg,pdf,webp}` */
export function renderKey(
  ctx: WorkspaceCtx,
  render: { hash: string; format: RenderFormat },
): string {
  const format = RENDER_FORMATS.find((known) => known === render.format);
  if (format === undefined) throw new StorageKeyError('not a valid render format in a file key');
  return `${workspacePrefix(ctx)}renders/${part('render hash', render.hash, HASH)}.${format}`;
}

/** `ws/<workspace>/exports/<export>/<file name>` */
export function exportKey(ctx: WorkspaceCtx, file: { exportId: string; name: string }): string {
  const id = part('export id', file.exportId, UUID_V7);
  return `${workspacePrefix(ctx)}exports/${id}/${part('file name', file.name, FILE_NAME)}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
// The shapes §13 names, below `ws/<workspace id>/`. A key is one of these or it is not a key.
const KEY_SHAPES = {
  original: new RegExp(`^brands/${UUID}/assets/${UUID}/original$`),
  resized: new RegExp(`^brands/${UUID}/assets/${UUID}/(1600|360)$`),
  render: new RegExp(`^renders/[0-9a-f]{16,128}\\.(${RENDER_FORMATS.join('|')})$`),
  export: new RegExp(`^exports/${UUID}/[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$`),
} as const;

/** Which kind of file a key names. Only a browser upload makes an `original`; the worker makes the rest. */
export type KeyKind = keyof typeof KEY_SHAPES;

/**
 * Returns the kind of `key` when it is inside the context's workspace and is exactly one of §13's key shapes (an
 * asset size, a render, an export file); throws otherwise. Signing calls this first, so a link is never made for
 * another workspace's file, for a path that only looks like this workspace's (`ws/<mine>/../<theirs>/…`), or for a
 * place no builder would write to.
 */
export function keyKind(ctx: WorkspaceCtx, key: string): KeyKind {
  const prefix = workspacePrefix(ctx);
  if (!key.startsWith(prefix)) throw new StorageKeyError('the file is outside the workspace');
  const rest = key.slice(prefix.length);
  for (const kind of Object.keys(KEY_SHAPES) as KeyKind[]) {
    if (KEY_SHAPES[kind].test(rest)) return kind;
  }
  throw new StorageKeyError('the file key is not one of the keys a workspace has');
}

/** `key` itself when it is one of this workspace's keys (see `keyKind`); throws otherwise. */
export function checkKey(ctx: WorkspaceCtx, key: string): string {
  keyKind(ctx, key);
  return key;
}
