// The PDF reader works from the worker's real entry (Argus F2 on #402). @lzp/storage starts its reader as a child
// process, `node read-pdf-text.ts`, with the Node that runs the worker (`process.execPath`): that works only while the
// worker itself runs as TypeScript on plain Node, with no build step and no loader. So this checks that the worker's
// entry is still run that way (its `start` script and its image's command), and then does the same: a plain `node`,
// with no flags and none of Vitest's hooks, in apps/worker, loads the asset job as the worker does and reads a PDF
// document's text through it. If the worker is ever bundled or built to JavaScript, this fails first.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { banglaPdf } from '../../../packages/storage/src/pdf/fixtures.ts';

const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts?: Record<string, string>;
};
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

// Runs in the child: the asset job from ./asset-job.ts, its bucket and rows stand-ins, the PDF from stdin. It prints
// the text the job would save.
const CHILD = `
import { randomUUIDv7 } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { assetJob } = await import(pathToFileURL(process.argv[1]).href);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const pdf = new Uint8Array(Buffer.concat(chunks));
const saved = [];
const handler = assetJob({
  storage: {
    get: async () => pdf,
    put: async () => { throw new Error('a PDF is never drawn'); },
  },
  log: () => {},
  processing: () => ({
    load: async ({ brandId, assetId }) => ({ asset: { id: assetId, brandId, kind: 'document', source: 'own' } }),
    finish: async (_id, file) => { saved.push(file.extractedText); return { finished: true, duplicateOf: null }; },
    reject: async () => { throw new Error('rejected'); },
  }),
});
await handler({
  jobId: randomUUIDv7(),
  payload: { workspaceId: randomUUIDv7(), brandId: randomUUIDv7(), assetId: randomUUIDv7() },
  db: null,
  retryCount: 0,
  lastAttempt: false,
});
process.stdout.write(JSON.stringify(saved));
`;

/** Runs CHILD with plain `node` in apps/worker; resolves with its stdout, or rejects with its exit code. */
function runChild(input: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', CHILD, fileURLToPath(new URL('asset-job.ts', import.meta.url))],
      // Only PATH and HOME: no NODE_OPTIONS, so no loader of Vitest's reaches it.
      { cwd: WORKER_DIR, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } },
    );
    const out: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else {
        const said = Buffer.concat(errors).toString('utf8').slice(-2_000);
        reject(new Error(`the child exited with ${String(code)}: ${said}`));
      }
    });
    child.stdin.end(input);
  });
}

describe('the PDF reader from the worker’s real entry (Argus F2 on #402)', () => {
  it('the worker runs its TypeScript on plain Node: its start script and its image’s command', () => {
    expect(manifest.scripts?.start).toBe('node src/index.ts');
    expect(dockerfile).toMatch(/^CMD \["node", "apps\/worker\/src\/index\.ts"\]$/m);
  });

  it('reads a PDF document’s text through the asset job, in a plain node started as the worker is', async () => {
    expect(JSON.parse(await runChild(banglaPdf()))).toEqual(['বাংলা']);
  }, 30_000);
});
