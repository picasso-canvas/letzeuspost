// `seed:dev`'s logo step (#443) without services: each logo is added as an upload adds it. Its file goes into the
// bucket at its original's key first, then its `waiting` row and its `asset` job are written in one transaction, the job
// through that transaction (`jobs.send(…, { tx })`), so the job exists exactly when the row does and never runs before
// its file is there. Nothing marks it ready: the worker's `asset` job processes it. seed-dev.int.test.ts runs it
// against Postgres and the file store.
import { randomUUIDv7 } from 'node:crypto';
import type { Db, Jobs, WorkspaceCtx } from '@lzp/db';
import { assetKey, type Storage } from '@lzp/storage';
import { describe, expect, it } from 'vitest';
import { addLogoAsUploaded } from './seed-logos.ts';

const ctx: WorkspaceCtx = { workspaceId: randomUUIDv7() };
const upload = {
  brandId: randomUUIDv7(),
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  contentType: 'image/png',
  description: 'Golpo Café logo, for light backgrounds',
  uploadedBy: randomUUIDv7(),
};

/** The fakes, and what happened to them in order. */
function fakes({ sendFails = false } = {}) {
  const steps: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const sent: { queue: string; payload: unknown; tx: unknown }[] = [];
  const tx = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        steps.push('insert');
        rows.push(row);
        return Promise.resolve();
      },
    }),
  };
  const db = {
    forWorkspace: (scope: WorkspaceCtx) => ({
      transaction: async <T>(work: (t: typeof tx) => Promise<T>) => {
        expect(scope).toEqual(ctx);
        steps.push('begin');
        const result = await work(tx);
        steps.push('commit');
        return result;
      },
    }),
  } as unknown as Db;
  const puts: { key: string; bytes: Uint8Array; contentType: string }[] = [];
  const storage: Pick<Storage, 'put'> = {
    put: (scope, key, bytes, contentType) => {
      expect(scope).toEqual(ctx);
      steps.push('put');
      puts.push({ key, bytes, contentType });
      return Promise.resolve();
    },
  };
  const jobs: Pick<Jobs, 'send'> = {
    send: (queue, payload, options) => {
      steps.push('send');
      sent.push({ queue, payload, tx: options?.tx });
      return sendFails ? Promise.reject(new Error('no queue')) : Promise.resolve(randomUUIDv7());
    },
  };
  return { steps, rows, sent, puts, tx, add: addLogoAsUploaded({ storage, db, jobs }) };
}

describe('addLogoAsUploaded (#443)', () => {
  it("puts the file at the asset's original key, then adds its waiting row and queues its job in one transaction", async () => {
    const { steps, rows, sent, puts, tx, add } = fakes();
    const id = await add(ctx, upload);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const key = assetKey(ctx, { brandId: upload.brandId, assetId: id, variant: 'original' });
    expect(key).toBe(`ws/${ctx.workspaceId}/brands/${upload.brandId}/assets/${id}/original`);
    expect(steps).toEqual(['put', 'begin', 'insert', 'send', 'commit']);
    expect(puts).toEqual([{ key, bytes: upload.bytes, contentType: 'image/png' }]);
    // No status: the row starts `waiting` (the column's default), and only the asset job moves it on.
    expect(rows).toEqual([
      {
        id,
        workspaceId: ctx.workspaceId,
        brandId: upload.brandId,
        kind: 'logo',
        source: 'own',
        storageKey: key,
        description: upload.description,
        uploadedBy: upload.uploadedBy,
      },
    ]);
    expect(sent).toEqual([
      {
        queue: 'asset',
        payload: { workspaceId: ctx.workspaceId, brandId: upload.brandId, assetId: id },
        tx,
      },
    ]);
  });

  it('fails, and commits nothing, when its job can’t be queued', async () => {
    const { steps, add } = fakes({ sendFails: true });
    await expect(add(ctx, upload)).rejects.toThrow('no queue');
    expect(steps).not.toContain('commit');
  });
});
