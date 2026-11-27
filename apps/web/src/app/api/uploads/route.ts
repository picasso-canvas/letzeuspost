// POST /api/uploads (#403, §13 The app's API): the upload route's handler (handler.ts) on the real services (deps.ts):
// the app's database handle, the `asset` queue as the app role, and the file store's signer. They are made on the
// first request, not at import, so a build needs no settings, and kept for the process.
import { loadEnv } from '@lzp/config';
import { createJobs } from '@lzp/db';
import { createStorage } from '@lzp/storage/signer';
import { appDb } from '../../../server/db.ts';
import { assetJobSender, uploadsDeps } from './deps.ts';
import { createUploadsHandler, errorName } from './handler.ts';

// §13: nothing here is cached or prerendered.
export const dynamic = 'force-dynamic';

type Handler = (request: Request) => Promise<Response>;

// Kept on globalThis so `next dev`'s module reloads don't open new pools on every edit.
const holder = globalThis as typeof globalThis & { lzpUploads?: Handler };

function uploads(): Handler {
  if (holder.lzpUploads === undefined) {
    const env = loadEnv('web');
    const db = appDb();
    const jobs = createJobs({
      url: env.DATABASE_URL,
      db,
      // pg-boss's message can quote SQL: the error's name only, as the handler logs its own.
      onError: (error) => {
        console.error(JSON.stringify({ event: 'uploads.jobs', error: errorName(error) }));
      },
    });
    holder.lzpUploads = createUploadsHandler(
      uploadsDeps({
        appOrigin: env.APP_URL,
        db,
        send: assetJobSender(jobs),
        storage: createStorage(env),
      }),
    );
  }
  return holder.lzpUploads;
}

export const POST = (request: Request): Promise<Response> => uploads()(request);
