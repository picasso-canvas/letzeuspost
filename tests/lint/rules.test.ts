import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { lzpRuleConfigs } from '../../scripts/eslint/lzp-rules.mjs';

// The six M0 lint rules (§13, §21), linted through ESLint's API on snippets, without type information.
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
      languageOptions: {
        parser: tseslint.parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
    ...lzpRuleConfigs,
  ],
});

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

describe('lzp/no-raw-db-client (§13: the raw client stays in packages/db)', () => {
  it('refuses the Postgres driver or Drizzle client outside packages/db', async () => {
    expect(await ruleIds("import pg from 'pg';", 'apps/web/src/a.ts')).toContain(
      'lzp/no-raw-db-client',
    );
    expect(
      await ruleIds(
        "import { drizzle } from 'drizzle-orm/node-postgres';",
        'packages/core/src/a.ts',
      ),
    ).toContain('lzp/no-raw-db-client');
    expect(await ruleIds("import pg from 'pg';", 'packages/db/src/client.ts')).toEqual([]);
  });

  it('lets only packages/auth import the auth-only export (Q5)', async () => {
    expect(await ruleIds("import { authDb } from '@lzp/db/auth';", 'apps/web/src/a.ts')).toContain(
      'lzp/no-raw-db-client',
    );
    expect(
      await ruleIds("import { authDb } from '@lzp/db/auth';", 'packages/auth/src/a.ts'),
    ).toEqual([]);
    expect(await ruleIds("import pg from 'pg';", 'packages/auth/src/a.ts')).toContain(
      'lzp/no-raw-db-client',
    );
  });
});

describe('lzp/no-use-cache (Q17: banned in apps/web for now)', () => {
  it("refuses a 'use cache' directive and Next's cache APIs in apps/web", async () => {
    expect(await ruleIds("'use cache';\nexport const a = 1;", 'apps/web/src/a.ts')).toContain(
      'lzp/no-use-cache',
    );
    expect(
      await ruleIds(
        "export async function f() {\n  'use cache: remote';\n  return 1;\n}",
        'apps/web/src/a.ts',
      ),
    ).toContain('lzp/no-use-cache');
    expect(await ruleIds("import { cacheLife } from 'next/cache';", 'apps/web/src/a.ts')).toContain(
      'lzp/no-use-cache',
    );
    expect(
      await ruleIds("import { revalidatePath } from 'next/cache';", 'apps/web/src/a.ts'),
    ).toEqual([]);
    expect(await ruleIds("'use client';\nexport const a = 1;", 'apps/web/src/a.tsx')).toEqual([]);
  });
});

describe('lzp/no-dangerous-html (§13)', () => {
  it('refuses dangerouslySetInnerHTML anywhere', async () => {
    const code = "export const A = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />;";
    expect(await ruleIds(code, 'packages/ui/src/a.tsx')).toContain('lzp/no-dangerous-html');
    expect(await ruleIds('export const A = () => <div>x</div>;', 'packages/ui/src/a.tsx')).toEqual(
      [],
    );
  });
});

describe('lzp/tokens-only (§21: no raw colours or arbitrary values outside the tokens)', () => {
  it('refuses arbitrary values, palette colours and raw colour values in the interface', async () => {
    for (const cls of ['w-[13px]', 'bg-red-500', 'text-white', 'border-[#ff0000]']) {
      expect(
        await ruleIds(
          `export const A = () => <div className="p-4 ${cls}" />;`,
          'apps/web/src/a.tsx',
        ),
        cls,
      ).toContain('lzp/tokens-only');
    }
    expect(
      await ruleIds(
        "export const A = () => <div style={{ color: '#fff' }} />;",
        'packages/ui/src/a.tsx',
      ),
    ).toContain('lzp/tokens-only');
    expect(
      await ruleIds("export const s = cn('rounded-[3px]');", 'packages/ui/src/a.ts'),
    ).toContain('lzp/tokens-only');
  });

  it('lets token classes through', async () => {
    const ok =
      'export const A = () => <div className="bg-surface text-fg-muted p-4 rounded-md" />;';
    expect(await ruleIds(ok, 'apps/web/src/a.tsx')).toEqual([]);
  });
});

describe('lzp/lucide-only (§21)', () => {
  it('refuses any icon set other than lucide-react', async () => {
    for (const source of [
      'react-icons/fa',
      '@heroicons/react/24/solid',
      '@tabler/icons-react',
      '@radix-ui/react-icons',
    ]) {
      expect(
        await ruleIds(`import { X } from '${source}';`, 'apps/web/src/a.tsx'),
        source,
      ).toContain('lzp/lucide-only');
    }
    expect(await ruleIds("import { Check } from 'lucide-react';", 'apps/web/src/a.tsx')).toEqual(
      [],
    );
  });
});

describe('lzp/inter-only (§21: the interface font is Inter)', () => {
  it('refuses any other interface font', async () => {
    expect(
      await ruleIds("import { Roboto } from 'next/font/google';", 'apps/web/src/a.tsx'),
    ).toContain('lzp/inter-only');
    expect(await ruleIds("import '@fontsource/roboto';", 'packages/ui/src/a.ts')).toContain(
      'lzp/inter-only',
    );
    expect(
      await ruleIds("import localFont from 'next/font/local';", 'apps/web/src/a.tsx'),
    ).toContain('lzp/inter-only');
    expect(
      await ruleIds("import { Inter } from 'next/font/google';", 'apps/web/src/a.tsx'),
    ).toEqual([]);
    expect(await ruleIds("import '@fontsource-variable/inter';", 'packages/ui/src/a.ts')).toEqual(
      [],
    );
  });
});

describe('round 2 of the #82 review', () => {
  it('lets arbitrary variants through: only arbitrary values are banned (§21)', async () => {
    const ok =
      'export const A = () => <div className="data-[state=open]:bg-accent has-[>svg]:px-3 [&_svg]:size-4" />;';
    expect(await ruleIds(ok, 'packages/ui/src/a.tsx')).toEqual([]);
    expect(
      await ruleIds(
        'export const A = () => <div className="data-[state=open]:w-[13px]" />;',
        'packages/ui/src/a.tsx',
      ),
    ).toContain('lzp/tokens-only');
  });

  it("bans next/cache's cache APIs in every import form, and 'use cache' in every package", async () => {
    for (const code of [
      "import * as c from 'next/cache';",
      "export const f = () => import('next/cache');",
      "export { unstable_cache } from 'next/cache';",
      "export * from 'next/cache';",
      "const c = require('next/cache');",
    ]) {
      expect(await ruleIds(code, 'apps/web/src/a.ts'), code).toContain('lzp/no-use-cache');
    }
    expect(await ruleIds("'use cache';\nexport const a = 1;", 'packages/core/src/a.ts')).toContain(
      'lzp/no-use-cache',
    );
    expect(
      await ruleIds('export default { cacheComponents: true };', 'apps/web/next.config.ts'),
    ).toContain('lzp/no-use-cache');
    expect(
      await ruleIds("export default { output: 'standalone' };", 'apps/web/next.config.ts'),
    ).toEqual([]);
  });

  it('catches the raw client through require, import-equals and other file types', async () => {
    expect(await ruleIds("const pg = require('pg');", 'apps/web/src/a.cjs')).toContain(
      'lzp/no-raw-db-client',
    );
    expect(await ruleIds("import pg = require('pg');", 'apps/web/src/a.cts')).toContain(
      'lzp/no-raw-db-client',
    );
    expect(await ruleIds("import pg from 'pg';", 'apps/web/src/a.mts')).toContain(
      'lzp/no-raw-db-client',
    );
  });

  it('names icon sets the heuristic would miss', async () => {
    for (const source of ['@fortawesome/react-fontawesome', 'react-feather']) {
      expect(
        await ruleIds(`import { X } from '${source}';`, 'apps/web/src/a.tsx'),
        source,
      ).toContain('lzp/lucide-only');
    }
  });
});

describe('round 3 of the #82 review', () => {
  it('reads variants only up to a colon outside brackets', async () => {
    for (const cls of [
      'bg-[color:#ff0000]',
      '[color:red]',
      '[background:#f00]',
      'bg-[url(https://x)]',
    ]) {
      expect(
        await ruleIds(`export const A = () => <div className="${cls}" />;`, 'apps/web/src/a.tsx'),
        cls,
      ).toContain('lzp/tokens-only');
    }
    const ok =
      'export const A = () => <div className="[&:hover]:bg-accent data-[state=open]:bg-accent" />;';
    expect(await ruleIds(ok, 'apps/web/src/a.tsx')).toEqual([]);
  });

  it('bans next/cache by any path that reaches it, and deep next/dist imports', async () => {
    for (const source of ['next/cache.js', 'next/dist/server/web/spec-extension/unstable-cache']) {
      expect(
        await ruleIds(`import { unstable_cache } from '${source}';`, 'apps/web/src/a.ts'),
        source,
      ).toContain('lzp/no-use-cache');
    }
  });

  it('counts pg-boss, pg-pool and every Drizzle driver as a raw client', async () => {
    for (const source of ['pg-boss', 'pg-pool', 'drizzle-orm/pg-proxy', 'drizzle-orm/neon-http']) {
      expect(await ruleIds(`import x from '${source}';`, 'apps/web/src/a.ts'), source).toContain(
        'lzp/no-raw-db-client',
      );
    }
    expect(await ruleIds("import PgBoss from 'pg-boss';", 'packages/db/src/jobs/queue.ts')).toEqual(
      [],
    );
  });

  it('bans the geist font', async () => {
    expect(
      await ruleIds("import { GeistSans } from 'geist/font/sans';", 'apps/web/src/a.tsx'),
    ).toContain('lzp/inter-only');
  });
});

describe('round 4 of the #82 review', () => {
  it('refuses deep next/dist paths in re-exports too', async () => {
    for (const code of [
      "export { unstable_cache } from 'next/dist/server/web/spec-extension/unstable-cache';",
      "export * from 'next/dist/server/web/spec-extension/unstable-cache';",
    ]) {
      expect(await ruleIds(code, 'apps/web/src/a.ts'), code).toContain('lzp/no-use-cache');
    }
  });

  it('ignores inline eslint-disable comments in the repo config (noInlineConfig)', async () => {
    const repo = new ESLint({ cwd: process.cwd() });
    const config = (await repo.calculateConfigForFile('apps/web/src/page.tsx')) as {
      linterOptions?: { noInlineConfig?: boolean };
    };
    expect(config.linterOptions?.noInlineConfig).toBe(true);
  });
});
