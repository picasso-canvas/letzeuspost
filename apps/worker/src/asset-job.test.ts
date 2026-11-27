// The `asset` job (#402, §06 Reading uploaded files, §10 Processing every image, §13 Jobs), with the bucket and the
// asset rows in memory and the real image and PDF processing. The rows' own rules (one conditional update, duplicates
// by hash within a brand, a client's photo left waiting) are packages/db's, checked on Postgres in ./asset.int.test.ts.
import { createHash, randomUUIDv7 } from 'node:crypto';
import type { AssetProcessing, AssetToProcess, JobContext, ProcessedFile, Scoped } from '@lzp/db';
import { shortestRetryWindowSeconds } from '@lzp/db';
import { assetKey, UploadLimitError, type AssetVariant, type Storage } from '@lzp/storage';
import { UPLOAD_LINK_SECONDS } from '@lzp/storage/signer';
import { describe, expect, it } from 'vitest';
import {
  banglaPdf,
  bombPdf,
  drawingOnlyPdf,
  lockedPdf,
  loopingPdf,
  scriptedPdf,
  textPdf,
} from '../../../packages/storage/src/pdf/fixtures.ts';
import { picture } from './asset-fixtures.ts';
import { assetJob, FAILED, MAX_FILE_BYTES } from './asset-job.ts';
import type { LogFields } from './log.ts';

const workspaceId = randomUUIDv7();
const ctx = { workspaceId };

// What a file may hold that must never reach a log or an error: its text, and the plain reasons shown to its sender.
const SECRET_TEXT = 'Golpo Cafe menu: mango lassi 120 taka, call 01711-000000';

interface Put {
  key: string;
  contentType: string;
  size: number;
}

/**
 * A bucket in memory: `get` caps the size as the real one does, and every write is recorded. Each delete, and each
 * row the rows reject, goes into `order`, so a test sees which came first.
 */
function fakeBucket(files: Record<string, Uint8Array>, order: string[]) {
  const stored = new Map(Object.entries(files));
  const puts: Put[] = [];
  const gets: string[] = [];
  let failure: Error | undefined;
  let deleteFailure: Error | undefined;
  const storage: Pick<Storage, 'get' | 'put' | 'delete'> = {
    get: (_ctx, key, { maxBytes }) => {
      gets.push(key);
      if (failure !== undefined) return Promise.reject(failure);
      const file = stored.get(key);
      if (file === undefined) return Promise.resolve(null);
      if (file.byteLength > maxBytes) {
        return Promise.reject(new UploadLimitError('The file is too large.'));
      }
      return Promise.resolve(file);
    },
    put: (_ctx, key, body, contentType) => {
      puts.push({ key, contentType, size: body.byteLength });
      stored.set(key, body);
      return Promise.resolve();
    },
    delete: (_ctx, key) => {
      if (deleteFailure !== undefined) return Promise.reject(deleteFailure);
      order.push(`delete ${key}`);
      stored.delete(key);
      return Promise.resolve();
    },
  };
  return {
    storage,
    puts,
    gets,
    stored,
    /** Every read fails, as when the store is down. */
    breakWith: (error: Error) => {
      failure = error;
    },
    /** Every delete fails. */
    breakDeletesWith: (error: Error) => {
      deleteFailure = error;
    },
  };
}

/** One asset row in memory, moved only from waiting and unprocessed, as packages/db's conditional updates move it. */
function fakeRows(asset: AssetToProcess, order: string[]) {
  let state: 'waiting' | 'processed' | 'rejected' = 'waiting';
  const finished: ProcessedFile[] = [];
  const rejected: string[] = [];
  let duplicateOf: string | null = null;
  const processing: AssetProcessing = {
    load: ({ brandId, assetId }) => {
      if (assetId !== asset.id || brandId !== asset.brandId) {
        return Promise.resolve({ skip: 'missing' });
      }
      return Promise.resolve(state === 'waiting' ? { asset } : { skip: 'processed' });
    },
    finish: (assetId, file) => {
      if (assetId !== asset.id || state !== 'waiting') {
        return Promise.resolve({ finished: false, duplicateOf: null });
      }
      state = 'processed';
      finished.push(file);
      return Promise.resolve({ finished: true, duplicateOf });
    },
    reject: (assetId, reason) => {
      if (assetId !== asset.id || state !== 'waiting') return Promise.resolve(false);
      state = 'rejected';
      rejected.push(reason);
      order.push('reject');
      return Promise.resolve(true);
    },
  };
  return {
    processing,
    finished,
    rejected,
    state: () => state,
    /** The rows hold an earlier asset that looks the same. */
    duplicateOf: (id: string) => {
      duplicateOf = id;
    },
  };
}

function newAsset(kind: AssetToProcess['kind'] = 'photo'): AssetToProcess {
  return { id: randomUUIDv7(), brandId: randomUUIDv7(), kind, source: 'own' };
}

const keyOf = (asset: AssetToProcess, variant: AssetVariant) =>
  assetKey(ctx, { brandId: asset.brandId, assetId: asset.id, variant });
const originalOf = (asset: AssetToProcess) => keyOf(asset, 'original');

/** What a rejected asset's run must do, in this order: its three files deleted, then its row rejected. */
const deletedThenRejected = (asset: AssetToProcess) => [
  ...(['1600', '360', 'original'] as const).map((variant) => `delete ${keyOf(asset, variant)}`),
  'reject',
];

/** The handler on `asset`, with `upload` at its original's key, and every log line recorded. */
function setUp(asset: AssetToProcess, upload?: Uint8Array) {
  const order: string[] = [];
  const bucket = fakeBucket(upload === undefined ? {} : { [originalOf(asset)]: upload }, order);
  const rows = fakeRows(asset, order);
  const lines: { event: string; fields: LogFields }[] = [];
  const handler = assetJob({
    storage: bucket.storage,
    log: (event, fields = {}) => {
      lines.push({ event, fields });
    },
    processing: () => rows.processing,
  });
  const unused: Scoped = {
    transaction: () => Promise.reject(new Error('the rows are in memory here')),
  };
  const run = (change: Partial<JobContext<'asset'>> = {}) =>
    handler({
      jobId: randomUUIDv7(),
      payload: { workspaceId, brandId: asset.brandId, assetId: asset.id },
      db: unused,
      retryCount: 0,
      lastAttempt: false,
      ...change,
    });
  return { bucket, rows, lines, run, order };
}

/** The error a run was refused with. */
async function failureOf(run: Promise<void>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected the run to fail, and it did not');
}

describe('the asset job on a picture', () => {
  it('writes its three sizes under the asset’s keys, then marks it processed with the stored file’s hashes and size', async () => {
    const asset = newAsset();
    const { bucket, rows, run } = setUp(asset, picture(1));
    await run();

    const key = (variant: '1600' | '360' | 'original') =>
      assetKey(ctx, { brandId: asset.brandId, assetId: asset.id, variant });
    expect(bucket.puts.map(({ key: written, contentType }) => [written, contentType])).toEqual([
      [key('1600'), 'image/webp'],
      [key('360'), 'image/webp'],
      [key('original'), 'image/png'],
    ]);
    const original = bucket.stored.get(key('original')) ?? new Uint8Array();
    expect(rows.finished).toEqual([
      {
        sha256: createHash('sha256').update(original).digest('hex'),
        perceptualHash: expect.stringMatching(/^[0-9a-f]{16}$/) as unknown,
        sizeBytes: bucket.puts.reduce((total, put) => total + put.size, 0),
        extractedText: null,
      },
    ]);
    expect(rows.state()).toBe('processed');
  });

  it('changes nothing when it runs again: no file read or written, no row moved', async () => {
    const asset = newAsset();
    const { bucket, rows, run } = setUp(asset, picture(2));
    await run();
    const after = { puts: bucket.puts.length, gets: bucket.gets.length, files: [...bucket.stored] };

    await run();
    await run({ retryCount: 1 });
    expect(bucket.puts).toHaveLength(after.puts);
    expect(bucket.gets).toHaveLength(after.gets);
    expect([...bucket.stored]).toEqual(after.files);
    expect(rows.finished).toHaveLength(1);
    expect(rows.rejected).toEqual([]);
  });

  it('leaves a row that another run finished first as that run left it', async () => {
    const asset = newAsset();
    const { rows, run } = setUp(asset, picture(3));
    await Promise.all([run(), run()]);
    expect(rows.finished).toHaveLength(1);
    expect(rows.state()).toBe('processed');
  });

  it('does nothing for an asset it can’t find in the job’s workspace and brand', async () => {
    const asset = newAsset();
    const { bucket, rows, run, lines } = setUp(asset, picture(4));
    await run({ payload: { workspaceId, brandId: randomUUIDv7(), assetId: asset.id } });
    expect(bucket.gets).toEqual([]);
    expect(rows.state()).toBe('waiting');
    expect(lines.map((line) => [line.event, line.fields.reason])).toEqual([
      ['asset.skipped', 'missing'],
    ]);
  });

  it('rejects a file that is no picture, with a plain reason, and writes nothing', async () => {
    const asset = newAsset();
    const { bucket, rows, run } = setUp(asset, Buffer.from(SECRET_TEXT));
    await run();
    expect(rows.rejected).toEqual(["That file isn't a JPG, PNG, WebP or SVG image."]);
    expect(bucket.puts).toEqual([]);
  });

  it('rejects a file over 20 MB unread', async () => {
    const asset = newAsset();
    const { bucket, rows, run } = setUp(asset, new Uint8Array(MAX_FILE_BYTES + 1));
    await run();
    expect(rows.rejected).toEqual(['This file is too large: at most 20 MB.']);
    expect(bucket.puts).toEqual([]);
  });
});

describe('the asset job on a PDF', () => {
  it('keeps a document’s text, Bangla included, and draws nothing', async () => {
    const asset = newAsset('document');
    const pdf = banglaPdf();
    const { bucket, rows, run } = setUp(asset, pdf);
    await run();
    expect(rows.finished).toEqual([
      {
        sha256: createHash('sha256').update(pdf).digest('hex'),
        perceptualHash: null,
        sizeBytes: pdf.byteLength,
        extractedText: 'বাংলা',
      },
    ]);
    expect(bucket.puts).toEqual([]);
  });

  it('reads only the text of a PDF that carries a script and an attached file', async () => {
    const asset = newAsset('document');
    const { rows, run } = setUp(asset, scriptedPdf(SECRET_TEXT));
    await run();
    expect(rows.finished.map((file) => file.extractedText)).toEqual([SECRET_TEXT]);
  });

  it('rejects a PDF given as a picture: only a document may be one', async () => {
    const asset = newAsset('photo');
    const { bucket, rows, run } = setUp(asset, textPdf([SECRET_TEXT]));
    await run();
    expect(rows.rejected).toEqual([
      'A PDF can be added only as a document. Please upload pictures as JPG, PNG, WebP or SVG.',
    ]);
    expect(bucket.puts).toEqual([]);
  });

  it('rejects a document that is neither a PDF nor a picture', async () => {
    const asset = newAsset('document');
    const { rows, run } = setUp(asset, Buffer.from(SECRET_TEXT));
    await run();
    expect(rows.rejected).toEqual(["That file isn't a PDF or a JPG, PNG, WebP or SVG image."]);
  });

  it('keeps a document that is a picture, as a picture', async () => {
    const asset = newAsset('document');
    const { bucket, rows, run } = setUp(asset, picture(5));
    await run();
    expect(rows.finished.map((file) => file.extractedText)).toEqual([null]);
    expect(bucket.puts).toHaveLength(3);
  });

  it.each([
    [
      'locked',
      lockedPdf(),
      'This PDF is protected by a password. Please upload a copy without one.',
    ],
    [
      'with no text',
      drawingOnlyPdf(),
      'This PDF has no text we can read. If it is scanned, please upload its pages as images.',
    ],
    [
      'over 100 pages',
      textPdf(Array.from({ length: 101 }, (_, page) => `Page ${String(page + 1)}`)),
      'This PDF is too long: at most 100 pages.',
    ],
    [
      'whose page tree loops',
      loopingPdf(),
      "This PDF couldn't be read. Please save it again as a PDF and upload it.",
    ],
  ])('rejects a hostile PDF (%s) with a plain reason', async (_name, pdf, reason) => {
    const asset = newAsset('document');
    const { rows, run } = setUp(asset, pdf);
    await run();
    expect(rows.rejected).toEqual([reason]);
  });

  it('rejects a decompression bomb: too slow or too much memory, never the worker’s', async () => {
    const asset = newAsset('document');
    // A few hundred kilobytes that inflate to 1.2 GB: past the reader's memory cap.
    const { rows, run } = setUp(asset, bombPdf(1200));
    await run();
    expect(rows.rejected).toHaveLength(1);
    expect([
      'This PDF took too long to read. Please save it again as a simpler PDF.',
      'This PDF needs too much memory to read. Please save it again as a simpler PDF.',
      "This PDF couldn't be read. Please save it again as a PDF and upload it.",
    ]).toContain(rows.rejected[0]);
  }, 30_000);
});

describe('the asset job when the file or the store fails', () => {
  it('retries a file that hasn’t arrived, and rejects it on the last try', async () => {
    const asset = newAsset();
    const { rows, run } = setUp(asset);
    expect((await failureOf(run())).message).toBe('asset job failed (missing)');
    expect(rows.state()).toBe('waiting');

    expect((await failureOf(run({ lastAttempt: true }))).message).toBe(
      'asset job failed (missing)',
    );
    expect(rows.rejected).toEqual(['The file never arrived. Please upload it again.']);
  });

  it('retries when the store fails, and rejects with a plain reason on the last try', async () => {
    const asset = newAsset();
    const { bucket, rows, run } = setUp(asset, picture(6));
    const broken = new Error(`connect ECONNREFUSED for ${originalOf(asset)}: ${SECRET_TEXT}`);
    broken.name = 'TimeoutError';
    bucket.breakWith(broken);

    const first = await failureOf(run());
    expect(first.message).toBe('asset job failed (TimeoutError)');
    expect(rows.state()).toBe('waiting');

    await failureOf(run({ lastAttempt: true }));
    expect(rows.rejected).toEqual([FAILED]);
  });
});

describe('a rejected asset’s files (Cerberus F1 on #439, Zeus’s decision 1(a), 2026-11-28)', () => {
  // A rejected row no longer counts against the plan's storage (packages/db's startUploads), so its bytes go first.
  it('deletes a refused file’s original and copies before it rejects the row, and keeps nothing of it', async () => {
    const asset = newAsset();
    const { bucket, rows, run, order } = setUp(asset, Buffer.from(SECRET_TEXT));
    await run();
    expect(rows.rejected).toEqual(["That file isn't a JPG, PNG, WebP or SVG image."]);
    expect(order).toEqual(deletedThenRejected(asset));
    expect([...bucket.stored.keys()]).toEqual([]);
  });

  it.each([
    ['too large', () => new Uint8Array(MAX_FILE_BYTES + 1), 'photo'],
    ['a PDF given as a picture', () => textPdf([SECRET_TEXT]), 'photo'],
    ['a locked PDF', () => lockedPdf(), 'document'],
  ] as const)('deletes a file refused as %s before rejecting it', async (_name, file, kind) => {
    const asset = newAsset(kind);
    const { bucket, rows, run, order } = setUp(asset, file());
    await run();
    expect(rows.rejected).toHaveLength(1);
    expect(order).toEqual(deletedThenRejected(asset));
    expect(bucket.stored.size).toBe(0);
  });

  it('deletes the file’s keys on the last try of a file that never arrived, in case it lands late', async () => {
    const asset = newAsset();
    const { rows, run, order } = setUp(asset);
    await failureOf(run({ lastAttempt: true }));
    expect(rows.rejected).toEqual(['The file never arrived. Please upload it again.']);
    expect(order).toEqual(deletedThenRejected(asset));
  });

  it('deletes what the store holds on the last try of a run the store kept failing', async () => {
    const asset = newAsset();
    const { bucket, rows, run, order } = setUp(asset, picture(10));
    bucket.breakWith(new Error('read ECONNRESET'));
    await failureOf(run({ lastAttempt: true }));
    expect(rows.rejected).toEqual([FAILED]);
    expect(order).toEqual(deletedThenRejected(asset));
    expect(bucket.stored.size).toBe(0);
  });

  it('keeps a refused file waiting, and counting, while its files can’t be deleted: the run fails and is retried', async () => {
    const asset = newAsset();
    const { bucket, rows, run, lines } = setUp(asset, Buffer.from(SECRET_TEXT));
    const broken = new Error(`AccessDenied for ${originalOf(asset)}`);
    broken.name = 'AccessDenied';
    bucket.breakDeletesWith(broken);

    expect((await failureOf(run())).message).toBe('asset job failed (AccessDenied)');
    expect(rows.state()).toBe('waiting');
    expect(bucket.stored.has(originalOf(asset))).toBe(true);

    // Even on the last try: a row that still holds its bytes never stops counting.
    await failureOf(run({ lastAttempt: true }));
    expect(rows.state()).toBe('waiting');
    expect(rows.rejected).toEqual([]);
    expect(lines.at(-1)).toEqual({
      event: 'asset.failed',
      fields: expect.objectContaining({ error: 'AccessDenied' }) as unknown,
    });
  });

  it('deletes nothing of a file it processed', async () => {
    const asset = newAsset();
    const { bucket, rows, run, order } = setUp(asset, picture(15));
    await run();
    expect(rows.state()).toBe('processed');
    expect(order).toEqual([]);
    expect(bucket.stored.size).toBe(3);
  });

  it('gives up on a missing file only after its upload link has stopped working (Cerberus F2 on #439)', () => {
    // The shortest wait from the job's first run to its last: a file PUT after that can no longer reach the bucket.
    expect(shortestRetryWindowSeconds('asset')).toBeGreaterThan(UPLOAD_LINK_SECONDS);
  });
});

describe('what the asset job logs', () => {
  it('ids, outcomes and reason codes only: never a file’s text, content, key or the reason shown to its sender', async () => {
    const runs: { lines: { event: string; fields: LogFields }[]; errors: string[] }[] = [];
    const record = async (asset: AssetToProcess, upload?: Uint8Array, lastAttempt = false) => {
      const setup = setUp(asset, upload);
      const errors: string[] = [];
      await setup.run({ lastAttempt }).catch((error: unknown) => {
        errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      });
      runs.push({ lines: setup.lines, errors });
      return setup;
    };
    await record(newAsset('document'), scriptedPdf(SECRET_TEXT));
    await record(newAsset('document'), banglaPdf());
    await record(newAsset('photo'), Buffer.from(SECRET_TEXT));
    await record(newAsset('document'), lockedPdf());
    await record(newAsset('photo'), textPdf([SECRET_TEXT]));
    await record(newAsset('photo'), picture(7));
    await record(newAsset('photo'), undefined, true);
    const broken = newAsset();
    const failing = setUp(broken, picture(8));
    failing.bucket.breakWith(new Error(`${originalOf(broken)} ${SECRET_TEXT}`));
    await failing.run({ lastAttempt: true }).catch(() => undefined);
    runs.push({ lines: failing.lines, errors: [] });

    const allowed = new Set(['jobId', 'assetId', 'reason', 'duplicate', 'file', 'error']);
    const written = JSON.stringify(runs);
    for (const { lines } of runs) {
      for (const { event, fields } of lines) {
        expect(event).toMatch(/^asset\.[a-z]+$/);
        for (const name of Object.keys(fields)) expect(allowed).toContain(name);
      }
    }
    for (const secret of [
      SECRET_TEXT,
      'Golpo',
      'বাংলা',
      'protected by a password',
      "isn't a JPG",
      'can be added only',
      'never arrived',
      `ws/${workspaceId}`,
    ]) {
      expect(written).not.toContain(secret);
    }
    // Every run said what happened.
    expect(runs.every((each) => each.lines.length > 0)).toBe(true);
  }, 30_000);

  it('says when the file looks like one the brand has already', async () => {
    const asset = newAsset();
    const { rows, run, lines } = setUp(asset, picture(9));
    rows.duplicateOf(randomUUIDv7());
    await run();
    expect(lines.map((line) => [line.event, line.fields.duplicate])).toEqual([
      ['asset.processed', true],
    ]);
  });
});
