// `pnpm --filter @lzp/worker start`: the worker process. Reads only the worker's settings (config/env.ts) and stops
// with a clear error if one is missing or malformed. On SIGTERM or SIGINT it lets running jobs finish, then exits.
import { loadEnv } from '@lzp/config';
import { log } from './log.ts';
import { startWorker } from './worker.ts';

const worker = await startWorker(loadEnv('worker'));
// Its jobs are registered: Playwright waits for this line before the end-to-end tests start (#172).
log('worker ready');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void worker.stop().then(() => process.exit(0));
  });
}
