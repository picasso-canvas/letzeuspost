// The upload route (#403, §13 The app's API: `/api/uploads`, signed upload links; §13 File storage; §06 Reading
// uploaded files; §02 Running out, and limits; §15's matrix, `edit-brands`). The browser asks for a round of up to 30
// files of one brand; each becomes a `waiting` asset with its `asset` job queued, and the browser gets a link per file
// to put it straight into the bucket, signed for its type and its size and no other. The job then checks and processes
// the file, or rejects the asset with a plain reason if it never arrives.
//
// Steps, in order; each refusal stops the request before the next step:
//   1. the guard (session, active workspace, `edit-brands`), before anything of the request is read;
//   2. the origin: the app's own, as a session cookie alone doesn't show the member meant it (CSRF);
//   3. the body: JSON of the round's shape, small, every id checked; the workspace and the uploader come from the
//      session, never from the body;
//   4. the member's rate limit, in Postgres, as the app role (`hitWorkspaceRateLimit`);
//   5. the round's limits (@lzp/core's `checkUploadRound`): types, 20 MB each, 30 files;
//   6. the rows and their jobs, with the plan's storage limit checked under the workspace's lock (`startUploads`);
//   7. a signed link per file (@lzp/storage's `signUpload`, 15 minutes).
// Every dependency is passed in (route.ts wires the real ones), so the steps are tested on fakes and on the real
// services (tests/tenancy/uploads.test.ts). Answers never carry an error's own text; the log names a step and a code.
import type { Guarded } from '@lzp/auth';
import type { Action } from '@lzp/core';
import { assetKinds, type StartedUploads, type UploadRound, type WorkspaceCtx } from '@lzp/db';
import { z } from 'zod';

/**
 * A member's upload rounds allowed per window: generous for a person, a wall for a loop. 20 rounds per member per
 * 60 seconds, confirmed by Zeus (2026-11-26, on #403).
 */
export const UPLOAD_ROUNDS_PER_WINDOW = 20;
export const UPLOAD_WINDOW_SECONDS = 60;
/** The largest body read: 30 files of the round's shape fit many times over. */
export const MAX_BODY_BYTES = 16 * 1024;
/** More than a round may hold, so `checkRound` gives the plain "30 files" message; past this, the body is refused. */
const MAX_FILES_PARSED = 100;

/** What a link to put one file says: @lzp/storage's `SignedUpload`. */
export interface SignedUploadLink {
  readonly method: 'PUT';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface FileToSign {
  readonly contentType: string;
  readonly size: number;
}

export interface UploadsDeps {
  /** The app's own origin (APP_URL's): a request from any other is refused. */
  readonly appOrigin: string;
  /** `guard().check`: the session, its active workspace, and the action for the member's role. */
  readonly guard: (headers: Headers, action: Action) => Promise<Guarded>;
  /** Counts a round in the member's bucket; false: past the limit (`hitWorkspaceRateLimit`). */
  readonly rateLimit: (ctx: WorkspaceCtx, userId: string) => Promise<boolean>;
  /** The round's own limits (@lzp/core's `checkUploadRound`). */
  readonly checkRound: (
    files: readonly FileToSign[],
  ) => { readonly ok: true } | { readonly ok: false; readonly message: string };
  /** The rows and their jobs, under the plan's storage limit (`startUploads` with `checkStorage`). */
  readonly start: (ctx: WorkspaceCtx, round: UploadRound) => Promise<StartedUploads>;
  /** A link to put one file to its key (@lzp/storage's `signUpload`). */
  readonly sign: (ctx: WorkspaceCtx, key: string, file: FileToSign) => Promise<SignedUploadLink>;
  /** Where a failure is logged: a step and a code, never a message. */
  readonly log?: (event: string, fields: Record<string, string>) => void;
}

const uploadBody = z.strictObject({
  brandId: z.uuid(),
  files: z
    .array(
      z.strictObject({
        kind: z.enum(assetKinds),
        contentType: z.string().max(100),
        size: z.number(),
      }),
    )
    .max(MAX_FILES_PARSED),
});

const NO_STORE = { 'cache-control': 'no-store' };

function answer(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}
const refuse = (status: number, error: string, headers?: Record<string, string>) =>
  answer(status, { error }, headers);

const GUARD_ANSWERS: Record<Exclude<Guarded, { ok: true }>['refused'], [number, string]> = {
  'no-session': [401, 'Sign in to upload files.'],
  'no-workspace': [403, 'Choose a workspace first.'],
  'not-a-member': [403, 'You aren’t a member of this workspace.'],
  'not-allowed': [403, 'Your role can’t add files to a brand.'],
};

/** The body as text, read no further than `MAX_BODY_BYTES`; null when it is longer. */
async function readCapped(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The JSON body, or why it isn't one of the round's shape. */
async function readRound(
  request: Request,
): Promise<z.infer<typeof uploadBody> | { status: number; error: string }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return { status: 400, error: 'Send the files to upload as JSON.' };
  }
  const text = await readCapped(request);
  if (text === null) return { status: 413, error: 'Too many files in one request.' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: 400, error: 'Send the files to upload as JSON.' };
  }
  const parsed = uploadBody.safeParse(json);
  if (!parsed.success) return { status: 400, error: 'That isn’t a list of files to upload.' };
  return parsed.data;
}

/**
 * What a failure is logged as: its name only, when it is a plain word. A driver's or a store's message may hold a key, a
 * host or a password.
 */
export function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : 'unknown';
  return /^[A-Za-z]{1,64}$/.test(name) ? name : 'unknown';
}

export function createUploadsHandler(deps: UploadsDeps): (request: Request) => Promise<Response> {
  const log =
    deps.log ??
    ((event: string, fields: Record<string, string>) => {
      console.error(JSON.stringify({ event, ...fields }));
    });
  const appOrigin = new URL(deps.appOrigin).origin;

  return async (request) => {
    let step = 'guard';
    try {
      // 1. The guard, first.
      const guarded = await deps.guard(request.headers, 'edit-brands');
      if (!guarded.ok) {
        const [status, error] = GUARD_ANSWERS[guarded.refused];
        return refuse(status, error);
      }
      // 2. Only the app's own pages may ask (CSRF): an exact match, never a prefix.
      if (request.headers.get('origin') !== appOrigin) {
        return refuse(403, 'This request didn’t come from LetZeusPost.');
      }
      // 3. The body.
      step = 'body';
      const round = await readRound(request);
      if ('status' in round) return refuse(round.status, round.error);
      const ctx: WorkspaceCtx = { workspaceId: guarded.workspace.id };
      // 4. The rate limit.
      step = 'rate-limit';
      if (!(await deps.rateLimit(ctx, guarded.person.userId))) {
        return refuse(429, 'Too many uploads at once. Please wait a minute and try again.', {
          'retry-after': String(UPLOAD_WINDOW_SECONDS),
        });
      }
      // 5. The round's limits.
      const files = round.files.map(({ contentType, size }) => ({ contentType, size }));
      const limits = deps.checkRound(files);
      if (!limits.ok) return refuse(400, limits.message);
      // 6. The rows and their jobs, under the storage limit.
      step = 'start';
      const started = await deps.start(ctx, {
        brandId: round.brandId,
        uploadedBy: guarded.person.userId,
        files: round.files.map(({ kind, size }) => ({ kind, sizeBytes: size })),
      });
      if ('refused' in started) {
        return started.refused === 'no-brand'
          ? refuse(404, 'There is no such brand in this workspace.')
          : refuse(403, started.message);
      }
      // 7. A link per file, in the round's order.
      step = 'sign';
      const uploads = await Promise.all(
        started.started.map(async ({ assetId, storageKey }, at) => {
          const file = files[at];
          if (file === undefined) throw new Error('a started upload without its file');
          return { assetId, upload: await deps.sign(ctx, storageKey, file) };
        }),
      );
      return answer(200, { uploads });
    } catch (error) {
      log('uploads.failed', { step, error: errorName(error) });
      return refuse(500, 'The upload couldn’t be started. Please try again.');
    }
  };
}
