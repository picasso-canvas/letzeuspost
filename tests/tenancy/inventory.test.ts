// The tenancy suite's list of what a request or a job can reach (§17: "the list of routes comes from the app itself, so
// a new route without a tenancy test fails the suite"). The list is read from the code: apps/web's route handlers, its
// pages, layouts, templates, defaults and metadata routes with ids in their path, its server actions, packages/auth's
// Better Auth endpoints, packages/db's job queues and the handlers apps/worker registers. Every entry needs a `tenancy('<entry>', …)` block in this folder
// with at least one test in it; this file fails on one that has none, and on a block that names nothing on the list.
// It reads files only, so it needs no service, but it runs with the rest of the suite in CI's `services` job.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appEntries,
  coveredEntries,
  inventory,
  jobEntries,
  REPO_ROOT,
  uncovered,
  unknown,
} from './inventory.ts';

const SUITE = path.join(REPO_ROOT, 'tests/tenancy');

/** Every M0 route, action, endpoint and job (#77, #79, #72): the list must hold at least these. */
const M0 = [
  'route GET /api/auth/[...all]',
  'route POST /api/auth/[...all]',
  'route GET /api/health',
  'action apps/web/src/app/app/actions.ts#switchWorkspace',
  'auth POST /sign-in/magic-link',
  'auth GET /magic-link/verify',
  'auth GET /get-session',
  'auth POST /sign-out',
  'queue ai',
  'queue render',
  'queue fetch',
  'queue export',
  'queue email',
  'queue account-email',
  'job email',
  'job account-email',
];

describe('the list comes from the code', () => {
  it('holds every M0 route, action, Better Auth endpoint, queue and job handler', () => {
    expect(inventory()).toEqual(expect.arrayContaining(M0));
  });

  it('names each entry once', () => {
    const entries = inventory();
    expect(new Set(entries).size).toBe(entries.length);
  });
});

describe('every entry has a tenancy test', () => {
  it('leaves no route, page, action, endpoint, queue or job without one', () => {
    expect(uncovered(inventory(), coveredEntries(SUITE))).toEqual([]);
  });

  it('has no tenancy block naming something the app doesn’t have (a typo would cover nothing)', () => {
    expect(unknown(inventory(), coveredEntries(SUITE))).toEqual([]);
  });
});

// A fixture app, written to a folder of its own: what a later feature would add. None of it has a tenancy test yet.
describe('a new route without a tenancy test fails the suite (a fixture app)', () => {
  let root = '';
  const write = async (file: string, text: string) => {
    const at = path.join(root, file);
    await mkdir(path.dirname(at), { recursive: true });
    await writeFile(at, text);
  };

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'lzp-tenancy-'));
    await write(
      'apps/web/src/app/api/brands/[brandId]/route.ts',
      `export async function GET(request: Request) { return new Response(request.url); }
       export const PATCH = GET;
       const remove = GET;
       export { remove as DELETE };
       export const notAMethod = 1;`,
    );
    await write(
      'apps/web/src/app/(app)/brands/[brandId]/page.tsx',
      'export default function Brand() { return <main />; }',
    );
    await write(
      'apps/web/src/app/(app)/brands/[brandId]/posts/[postId]/layout.tsx',
      'export default function Post({ children }) { return children; }',
    );
    // A template, and a parallel route's default, render for their URL like a page does.
    await write(
      'apps/web/src/app/(app)/brands/[brandId]/template.tsx',
      'export default function Frame({ children }) { return children; }',
    );
    await write(
      'apps/web/src/app/(app)/brands/@panel/[brandId]/default.tsx',
      'export default function Panel() { return null; }',
    );
    // Metadata files are GET routes of their own: a brand's share image or sitemap reads the brand by its id.
    for (const image of ['opengraph-image', 'twitter-image', 'icon', 'icon1', 'apple-icon']) {
      await write(
        `apps/web/src/app/(app)/brands/[brandId]/${image}.tsx`,
        'export default function Image() { return null; }',
      );
    }
    await write(
      'apps/web/src/app/(app)/brands/[brandId]/sitemap.ts',
      'export default function sitemap() { return []; }',
    );
    // A folder named like build output, or starting with a dot, is still a route inside the app.
    await write(
      'apps/web/src/app/dist/[fileId]/route.ts',
      'export function GET() { return new Response(); }',
    );
    await write(
      'apps/web/src/app/.well-known/[name]/route.ts',
      'export function GET() { return new Response(); }',
    );
    // A page, template or metadata file with no id in its path is not on the list: it can't be given another
    // workspace's.
    await write('apps/web/src/app/(app)/brands/page.tsx', 'export default () => null;');
    await write('apps/web/src/app/(app)/brands/template.tsx', 'export default () => null;');
    await write('apps/web/src/app/opengraph-image.tsx', 'export default () => null;');
    await write('apps/web/src/app/sitemap.ts', 'export default () => [];');
    await write(
      'apps/web/src/app/(app)/brands/actions.ts',
      `'use server';
       export async function renameBrand(id: unknown) { return id; }
       export const archiveBrand = async (id: unknown) => id;
       async function hidden() {}
       export { hidden as restoreBrand };
       export type NotAnAction = string;`,
    );
    await write(
      'apps/web/src/components/brand-form.tsx',
      `export function BrandForm() {
         async function deleteBrand() { 'use server'; }
         return <form action={deleteBrand} />;
       }
       // 'use server' in a comment is not an action
       export function plain() { return 'use server'; }`,
    );
    await write(
      'apps/worker/src/worker.ts',
      `export async function startWorker(jobs) {
         await jobs.work('render', renderJob);
         await jobs.work('email', emailJob);
       }`,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lists the fixture’s route handlers, pages, layouts, templates, defaults and metadata files with ids, actions and job handlers', () => {
    expect(appEntries(root).sort()).toEqual(
      [
        'route GET /api/brands/[brandId]',
        'route PATCH /api/brands/[brandId]',
        'route DELETE /api/brands/[brandId]',
        'route GET /brands/[brandId]/opengraph-image',
        'route GET /brands/[brandId]/twitter-image',
        'route GET /brands/[brandId]/icon',
        'route GET /brands/[brandId]/icon1',
        'route GET /brands/[brandId]/apple-icon',
        'route GET /brands/[brandId]/sitemap.xml',
        'route GET /dist/[fileId]',
        'route GET /.well-known/[name]',
        'page /brands/[brandId]',
        'layout /brands/[brandId]/posts/[postId]',
        'template /brands/[brandId]',
        'default /brands/[brandId]',
        'action apps/web/src/app/(app)/brands/actions.ts#renameBrand',
        'action apps/web/src/app/(app)/brands/actions.ts#archiveBrand',
        'action apps/web/src/app/(app)/brands/actions.ts#restoreBrand',
        'action apps/web/src/components/brand-form.tsx#deleteBrand',
      ].sort(),
    );
    expect(jobEntries(root).sort()).toEqual(['job email', 'job render']);
  });

  it('fails on each of them, since the suite has no tenancy test for them', () => {
    const missing = uncovered(inventory(root), coveredEntries(SUITE));
    expect(missing.sort()).toEqual([...appEntries(root), 'job render'].sort());
  });

  it('counts a tenancy block only when it names the entry and holds a test', async () => {
    await write(
      'tests/brands.test.ts',
      `tenancy('route GET /api/brands/[brandId]', () => {
         it('refuses B’s brand', () => {});
       });
       tenancy('route PATCH /api/brands/[brandId]', () => {});
       // tenancy('page /brands/[brandId]', () => { it('in a comment', () => {}); });
       describe('route DELETE /api/brands/[brandId]', () => { it('not a tenancy block', () => {}); });
       tenancy(\`layout /brands/[brandId]/posts/[postId]\`, () => {
         describe('nested', () => { test('counts', () => {}); });
       });`,
    );
    // Vitest doesn't run a test under dist, node_modules or a dot folder, so one there covers nothing.
    for (const hidden of ['dist', 'node_modules', '.cache']) {
      await write(
        `tests/${hidden}/brands.test.ts`,
        `tenancy('page /brands/[brandId]', () => { it('never runs', () => {}); });`,
      );
    }
    expect(coveredEntries(path.join(root, 'tests')).sort()).toEqual([
      'layout /brands/[brandId]/posts/[postId]',
      'route GET /api/brands/[brandId]',
    ]);
  });
});

// The list reads only apps/web/src/app. Next would also serve a Pages Router (src/pages, including pages/api), and an
// app or pages folder at apps/web's root (it then ignores src/), so the suite refuses to list an app that has one.
describe('a router folder the list doesn’t read fails the suite', () => {
  it.each([
    'apps/web/src/pages/api/brands/[brandId].ts',
    'apps/web/src/pages/brands/[brandId].tsx',
    'apps/web/pages/index.tsx',
    'apps/web/app/page.tsx',
  ])('%s', async (file) => {
    const root = await mkdtemp(path.join(tmpdir(), 'lzp-tenancy-'));
    try {
      await mkdir(path.join(root, path.dirname(file)), { recursive: true });
      await writeFile(path.join(root, file), 'export default () => null;');
      expect(() => appEntries(root)).toThrow(/only apps\/web\/src\/app/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
