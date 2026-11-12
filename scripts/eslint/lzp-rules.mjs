// @ts-check
// LetZeusPost's own lint rules (§13, §21). They live under scripts/, which builders can't edit, and eslint.config.js
// loads them. Each has a test in tests/lint/ that lints a bad and a good snippet.
import path from 'node:path';

/** @typedef {import('eslint').Rule.RuleModule} RuleModule */
/** @typedef {import('eslint').Rule.RuleContext} RuleContext */
/** @typedef {import('eslint').Rule.Node} EsNode */

/** The file's path from the repo root, with forward slashes. */
function repoPath(/** @type {RuleContext} */ context) {
  return path.relative(context.cwd, context.filename).split(path.sep).join('/');
}

/** A member access's property name, whether written `a.b` or `a['b']` (or any fixed string). @param {any} node */
function memberName(node) {
  return node.computed ? staticString(node.property) : (node.property?.name ?? null);
}

/**
 * The string an expression always evaluates to, or null: a string literal, a template with no `${}`, or `+` of those.
 * Bundlers treat all three as fixed paths, so the import rules read them the same way.
 * @param {any} node
 * @returns {string | null}
 */
function staticString(node) {
  if (!node) return null;
  if (node.type === 'Literal') return typeof node.value === 'string' ? node.value : null;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? null;
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === null || right === null ? null : left + right;
  }
  return null;
}

/**
 * Calls `check(source, node)` for every module a file imports or re-exports by name.
 * @param {(source: string, node: EsNode) => void} check
 */
function onImports(check) {
  /** @param {any} node */
  const visit = (node) => {
    const source = staticString(node.source);
    if (source !== null) check(source, node);
  };
  return {
    ImportDeclaration: visit,
    ExportNamedDeclaration: visit,
    ExportAllDeclaration: visit,
    ImportExpression: visit,
    /** require('x') @param {any} node */
    CallExpression(node) {
      const callee = node.callee;
      const prop = callee.type === 'MemberExpression' ? memberName(callee) : null;
      let source = null;
      if (callee.type === 'Identifier' && callee.name === 'require')
        source = staticString(node.arguments[0]);
      else if (prop === 'require')
        source = staticString(node.arguments[0]); // module.require('x')
      else if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'require'
      ) {
        if (prop === 'call') source = staticString(node.arguments[1]); // require.call(_, 'x')
        if (prop === 'apply') source = staticString(node.arguments[1]?.elements?.[0]); // require.apply(_, ['x'])
      }
      if (source !== null) check(source, node);
    },
    /** import x = require('x') @param {any} node */
    TSImportEqualsDeclaration(node) {
      const ref = node.moduleReference;
      const source =
        ref?.type === 'TSExternalModuleReference' ? staticString(ref.expression) : null;
      if (source !== null) check(source, node);
    },
  };
}

/** Anything that opens a database connection: the pg family (pg-boss and pg-pool included), postgres, and every Drizzle driver subpath. */
const DB_CLIENT =
  /^(?:pg|pg-[\w-]+|postgres|@neondatabase\/serverless|@vercel\/postgres|@electric-sql\/pglite)(?:\/|$)|^drizzle-orm\/./;
const AUTH_DB = '@lzp/db/auth';

/** §13: importing the raw database client outside packages/db is an error; the auth-only export is for packages/auth (Q5). */
/** @type {RuleModule} */
const noRawDbClient = {
  meta: {
    type: 'problem',
    messages: {
      raw: "'{{source}}' is the raw database client: go through packages/db's scoped helper (§13).",
      auth: "'{{source}}' is packages/db's auth-only export: only packages/auth may import it (Q5).",
      modules:
        "'{{source}}' reaches into node_modules by path, around the import rules: import the package by name.",
      dynamic: "createRequire loads modules out of the import rules' sight: import them instead.",
    },
    schema: [],
  },
  create(context) {
    const file = repoPath(context);
    const inDb = file.startsWith('packages/db/');
    const inAuth = file.startsWith('packages/auth/');
    const imports = onImports((source, node) => {
      if (/(^|\/)node_modules\//.test(source))
        context.report({ node, messageId: 'modules', data: { source } });
      const raw = DB_CLIENT.test(source);
      if (raw && !inDb) context.report({ node, messageId: 'raw', data: { source } });
      const auth = source === AUTH_DB || source.startsWith(`${AUTH_DB}/`);
      if (auth && !inDb && !inAuth) context.report({ node, messageId: 'auth', data: { source } });
    });
    return {
      ...imports,
      /** @param {any} node */
      CallExpression(node) {
        imports.CallExpression(node);
        if (node.callee.type === 'Identifier' && node.callee.name === 'createRequire')
          context.report({ node, messageId: 'dynamic' });
      },
      /** m.createRequire, (await import('node:module')).createRequire, process.getBuiltinModule @param {any} node */
      MemberExpression(node) {
        const name = memberName(node);
        if (name === 'createRequire' || name === 'getBuiltinModule')
          context.report({ node, messageId: 'dynamic' });
      },
      /** const { createRequire: r } = mod @param {any} node */
      Property(node) {
        const key = node.computed ? staticString(node.key) : (node.key?.name ?? node.key?.value);
        if (
          node.parent?.type === 'ObjectPattern' &&
          (key === 'createRequire' || key === 'getBuiltinModule')
        )
          context.report({ node, messageId: 'dynamic' });
      },
      /** import { createRequire as anything } from 'node:module' @param {any} node */
      ImportSpecifier(node) {
        const name = node.imported?.name ?? node.imported?.value;
        if (name === 'createRequire') context.report({ node, messageId: 'dynamic' });
      },
    };
  },
};

const CACHE_APIS = new Set([
  'cacheLife',
  'cacheTag',
  'unstable_cache',
  'unstable_cacheLife',
  'unstable_cacheTag',
]);

/** next/cache by any name that resolves to it (Next has no exports map). @param {unknown} source */
const isCacheModule = (source) =>
  typeof source === 'string' && /^next\/cache(?:\.js)?$/.test(source);
/** Next's internals (next/dist/…) reach the cache APIs by other paths. @param {unknown} source */
const isDeepNext = (source) => typeof source === 'string' && source.startsWith('next/dist/');

/** Q17 and §13: `use cache` and Next's cache components are banned everywhere (they could cache workspace data). */
/** @type {RuleModule} */
const noUseCache = {
  meta: {
    type: 'problem',
    messages: {
      directive:
        "'{{directive}}' is banned: a cache shared across requests could leak one workspace's data to another (§13).",
      api: "'{{name}}' from next/cache is banned (§13).",
      module:
        "This form of next/cache, and Next's internals (next/dist/…), are banned: import only names you use, none of the cache APIs (§13).",
      config: 'cacheComponents is banned (§13).',
      inline:
        "Write fetch's and Request's options inline, so their cache setting is visible (§13).",
      fetch:
        "fetch's {{option}} puts the response in Next's shared Data Cache: use cache: 'no-store' (§13).",
      segment:
        'export const {{name}} = {{value}} caches the route across requests and workspaces (§13).',
    },
    schema: [],
  },
  create(context) {
    /** @param {any} spec */
    const nameOf = (spec) => spec.imported?.name ?? spec.imported?.value ?? spec.local?.name;
    /** @param {any} node */
    const fromCache = (node) => isCacheModule(node.source?.value);
    // Next's other shared caches matter where Next serves pages: apps/web.
    const inWeb = repoPath(context).startsWith('apps/web/');
    /** fetch(url, { cache: 'force-cache' }) or { next: { revalidate, tags } } @param {any} node */
    const fetchCache = (node) => {
      const options = node.arguments[1];
      if (options === undefined) return;
      if (options.type !== 'ObjectExpression') {
        context.report({ node: options, messageId: 'inline' });
        return;
      }
      for (const prop of options.properties) {
        if (prop.type === 'SpreadElement') context.report({ node: prop, messageId: 'inline' });
        if (prop.type !== 'Property') continue;
        const key = prop.computed ? staticString(prop.key) : (prop.key?.name ?? prop.key?.value);
        if (key === 'cache' && staticString(prop.value) !== 'no-store')
          context.report({
            node: prop,
            messageId: 'fetch',
            data: { option: `cache: ${String(staticString(prop.value))}` },
          });
        if (key === 'next' && prop.value.type === 'ObjectExpression') {
          for (const inner of prop.value.properties) {
            const name = inner.key?.name ?? inner.key?.value;
            // Only 0 turns caching off: false means cache forever in Next.js.
            const off = inner.value?.type === 'Literal' && inner.value.value === 0;
            if ((name === 'revalidate' && !off) || name === 'tags')
              context.report({
                node: inner,
                messageId: 'fetch',
                data: { option: `next.${String(name)}` },
              });
          }
        }
      }
    };
    /** export const revalidate = 60 / dynamic = 'force-static' / fetchCache = 'force-cache' @param {any} node */
    const segmentConfig = (node) => {
      if (node.declaration?.type !== 'VariableDeclaration') return;
      for (const decl of node.declaration.declarations) {
        const name = decl.id?.name;
        const init = decl.init;
        const value = init?.type === 'Literal' ? init.value : staticString(init);
        const caches =
          (name === 'revalidate' && value !== 0) || // false caches forever
          (name === 'dynamic' && (value === 'force-static' || value === 'error')) ||
          (name === 'fetchCache' &&
            typeof value === 'string' &&
            /cache$/.test(value) &&
            value !== 'force-no-store' &&
            value !== 'default-no-store' &&
            value !== 'only-no-store');
        if (caches)
          context.report({
            node: decl,
            messageId: 'segment',
            data: { name, value: JSON.stringify(value) },
          });
      }
    };
    return {
      /** @param {any} node */
      ExpressionStatement(node) {
        if (typeof node.directive === 'string' && /^use cache\b/.test(node.directive)) {
          context.report({ node, messageId: 'directive', data: { directive: node.directive } });
        }
      },
      /** @param {any} node */
      ImportDeclaration(node) {
        if (isDeepNext(node.source?.value)) context.report({ node, messageId: 'module' });
        if (!fromCache(node)) return;
        for (const spec of node.specifiers) {
          if (spec.type !== 'ImportSpecifier') context.report({ node: spec, messageId: 'module' });
          else if (CACHE_APIS.has(nameOf(spec)))
            context.report({ node: spec, messageId: 'api', data: { name: nameOf(spec) } });
        }
      },
      /** export { unstable_cache } from 'next/cache' @param {any} node */
      ExportNamedDeclaration(node) {
        if (isDeepNext(node.source?.value)) context.report({ node, messageId: 'module' });
        if (inWeb) segmentConfig(node);
        if (!fromCache(node)) return;
        for (const spec of node.specifiers) {
          const name = spec.local?.name ?? spec.local?.value;
          if (CACHE_APIS.has(name))
            context.report({ node: spec, messageId: 'api', data: { name } });
        }
      },
      /** @param {any} node */
      ExportAllDeclaration(node) {
        if (fromCache(node) || isDeepNext(node.source?.value))
          context.report({ node, messageId: 'module' });
      },
      /** @param {any} node */
      ImportExpression(node) {
        const source = staticString(node.source);
        if (isCacheModule(source) || isDeepNext(source))
          context.report({ node, messageId: 'module' });
      },
      /** @param {any} node */
      CallExpression(node) {
        const [arg] = node.arguments;
        if (inWeb && node.callee.type === 'Identifier' && node.callee.name === 'fetch')
          fetchCache(node);
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          (isCacheModule(staticString(arg)) || isDeepNext(staticString(arg)))
        )
          context.report({ node, messageId: 'module' });
      },
      /** new Request(url, { cache: … }) is read like fetch @param {any} node */
      NewExpression(node) {
        if (inWeb && node.callee.type === 'Identifier' && node.callee.name === 'Request')
          fetchCache(node);
      },
      /** @param {any} node */
      Property(node) {
        const key = node.key?.name ?? node.key?.value;
        if (
          key === 'cacheComponents' &&
          /(^|\/)next\.config\.[cm]?[jt]s$/.test(repoPath(context))
        ) {
          context.report({ node, messageId: 'config' });
        }
      },
    };
  },
};

/** §13: dangerouslySetInnerHTML is banned. */
/** @type {RuleModule} */
const noDangerousHtml = {
  meta: {
    type: 'problem',
    messages: {
      banned: 'dangerouslySetInnerHTML is banned (§13): render text, or sanitise into elements.',
    },
    schema: [],
  },
  create(context) {
    /** @param {any} node @param {unknown} name */
    const check = (node, name) => {
      if (name === 'dangerouslySetInnerHTML') context.report({ node, messageId: 'banned' });
    };
    return {
      /** @param {any} node */
      JSXAttribute(node) {
        check(node, node.name?.name);
      },
      /** @param {any} node */
      Property(node) {
        // { dangerouslySetInnerHTML }, { ['dangerously' + 'SetInnerHTML'] } and { [`dangerouslySetInnerHTML`] }
        check(node, node.computed ? staticString(node.key) : (node.key?.name ?? node.key?.value));
      },
      /** p.dangerouslySetInnerHTML = …, p['dangerously' + 'SetInnerHTML'] = … @param {any} node */
      MemberExpression(node) {
        check(node, memberName(node));
      },
      /** The name as a fixed string anywhere: Reflect.set(p, '…'), a key held in a variable. @param {any} node */
      'Literal, TemplateLiteral, BinaryExpression'(node) {
        if (node.parent?.type === 'BinaryExpression' || node.parent?.type === 'MemberExpression')
          return;
        if (node.parent?.type === 'Property' && node.parent.key === node) return; // reported as a Property
        check(node, staticString(node));
      },
    };
  },
};

const CLASS_FNS = new Set(['cn', 'clsx', 'cva', 'twMerge', 'tv']);
const COLOUR_UTILS =
  '(?:bg|text|border|border-[trblxyse]|ring|ring-offset|fill|stroke|from|via|to|outline|shadow|inset-shadow|drop-shadow|decoration|accent|caret|divide|placeholder)';
const PALETTE = new RegExp(
  `^${COLOUR_UTILS}-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe)-(?:50|[1-9]00|950)|black|white)(?:/\\d+)?$`,
);
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i;

/** The class tokens in a string that use a raw palette colour or an arbitrary value. */
/** The index of the last colon outside brackets (the end of the variants), or -1. */
function lastVariantColon(/** @type {string} */ token) {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) last = i;
  }
  return last;
}

function badClasses(/** @type {string} */ text) {
  return text
    .split(/\s+/)
    .filter((token) => token !== '')
    .filter((token) => {
      const utility = token.slice(lastVariantColon(token) + 1).replace(/^!|!$/g, '');
      return /\[.+\]/.test(utility) || PALETTE.test(utility);
    });
}

/** §21: no raw colours or arbitrary values outside the tokens, in class names and inline styles. */
/** @type {RuleModule} */
const tokensOnly = {
  meta: {
    type: 'problem',
    messages: {
      classes: "'{{classes}}' isn't a design token: use the token classes (§21).",
      style: "'{{value}}' is a raw colour: use a token (§21).",
    },
    schema: [],
  },
  create(context) {
    /** Reports every string in an expression that a class list could come from. @param {any} node */
    const walk = (node) => {
      if (!node) return;
      switch (node.type) {
        case 'Literal':
          if (typeof node.value === 'string') {
            const bad = badClasses(node.value);
            if (bad.length > 0)
              context.report({ node, messageId: 'classes', data: { classes: bad.join(' ') } });
          }
          return;
        case 'TemplateLiteral':
          for (const quasi of node.quasis) {
            const bad = badClasses(quasi.value.cooked ?? quasi.value.raw);
            if (bad.length > 0)
              context.report({
                node: quasi,
                messageId: 'classes',
                data: { classes: bad.join(' ') },
              });
          }
          node.expressions.forEach(walk);
          return;
        case 'JSXExpressionContainer':
          walk(node.expression);
          return;
        case 'ConditionalExpression':
          walk(node.consequent);
          walk(node.alternate);
          return;
        case 'LogicalExpression':
          walk(node.left);
          walk(node.right);
          return;
        case 'ArrayExpression':
          node.elements.forEach(walk);
          return;
        case 'ObjectExpression':
          for (const prop of node.properties) {
            if (prop.type !== 'Property') continue;
            walk(prop.key); // clsx({ 'bg-red-500': on })
            walk(prop.value); // cva({ variants: { … } })
          }
          return;
        case 'CallExpression':
          node.arguments.forEach(walk);
          return;
        default:
      }
    };
    return {
      /** @param {any} node */
      JSXAttribute(node) {
        const name = node.name?.name;
        if (name === 'className' || name === 'class') walk(node.value);
        if (name === 'style' && node.value?.expression?.type === 'ObjectExpression') {
          for (const prop of node.value.expression.properties) {
            if (
              prop.type === 'Property' &&
              prop.value.type === 'Literal' &&
              typeof prop.value.value === 'string'
            ) {
              if (RAW_COLOUR.test(prop.value.value))
                context.report({
                  node: prop.value,
                  messageId: 'style',
                  data: { value: prop.value.value },
                });
            }
          }
        }
      },
      /** @param {any} node */
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && CLASS_FNS.has(node.callee.name))
          node.arguments.forEach(walk);
      },
    };
  },
};

/** §21: Lucide is the only icon set. */
/** @type {RuleModule} */
const lucideOnly = {
  meta: {
    type: 'problem',
    messages: {
      banned: "'{{source}}' looks like another icon set: icons come from lucide-react (§21).",
    },
    schema: [],
  },
  create(context) {
    return onImports((source, node) => {
      const external =
        !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('@lzp/');
      const lucide = source === 'lucide-react' || source.startsWith('lucide-react/');
      const named = /^(?:@fortawesome\/|react-feather$|feather-icons$|@mui\/icons-material)/.test(
        source,
      );
      if (external && !lucide && (named || /icon/i.test(source)))
        context.report({ node, messageId: 'banned', data: { source } });
    });
  },
};

/**
 * §21: Inter is the interface font, and Hind Siliguri carries Bangla text (Zeus, 2026-11-11, #231); every other font is
 * refused. Render-engine fonts live in packages/render, outside this rule. ESLint sees imports only. A font a
 * stylesheet loads itself (`@font-face` `src`) is checked by `packages/ui/src/styles/globals.test.ts`, and only for
 * `packages/ui/src/styles/globals.css`: every face there is Inter from a local file (Hind Siliguri too once #230
 * reaches `main`). `components.css`, `tokens/*.css` and the stylesheets in `apps/web` have no such check until #241
 * (#239).
 */
/** @type {RuleModule} */
const interOnly = {
  meta: {
    type: 'problem',
    messages: {
      font: "'{{font}}' isn't an interface font: Inter, and Hind Siliguri for Bangla text, are the only ones (§21).",
      local:
        'next/font/local loads a font file: Inter, and Hind Siliguri for Bangla text, are the only interface fonts (§21).',
      variable:
        "Hind Siliguri has no variable build: import '@fontsource/hind-siliguri', not '@fontsource-variable/…' (§21).",
    },
    schema: [],
  },
  create(context) {
    return onImports((source, node) => {
      const any = /** @type {any} */ (node);
      if (source === 'next/font/google') {
        for (const spec of any.specifiers ?? []) {
          const name =
            spec.type === 'ImportSpecifier' ? (spec.imported.name ?? spec.imported.value) : '*';
          if (name !== 'Inter')
            context.report({ node: spec, messageId: 'font', data: { font: name } });
        }
      } else if (source === 'next/font/local') {
        context.report({ node, messageId: 'local' });
      } else if (source === 'geist' || source.startsWith('geist/')) {
        context.report({ node, messageId: 'font', data: { font: 'geist' } });
      } else {
        // Hind Siliguri has no variable build: only `@fontsource/hind-siliguri` is it (#239).
        const match = /^@fontsource(-variable)?\/([^/]+)/.exec(source);
        if (match) {
          const [, variable, font] = match;
          if (font === 'hind-siliguri' && variable !== undefined)
            context.report({ node, messageId: 'variable' });
          else if (font !== 'inter' && font !== 'hind-siliguri')
            context.report({ node, messageId: 'font', data: { font } });
        }
      }
    });
  },
};

export const lzpPlugin = {
  meta: { name: 'lzp' },
  rules: {
    'no-raw-db-client': noRawDbClient,
    'no-use-cache': noUseCache,
    'no-dangerous-html': noDangerousHtml,
    'tokens-only': tokensOnly,
    'lucide-only': lucideOnly,
    'inter-only': interOnly,
  },
};

const plugins = { lzp: lzpPlugin };

/**
 * The flat-config blocks eslint.config.js spreads in.
 * @type {import('eslint').Linter.Config[]}
 */
export const lzpRuleConfigs = [
  {
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    plugins,
    // no-use-cache everywhere: Next compiles the workspace packages apps/web imports.
    rules: {
      'lzp/no-raw-db-client': 'error',
      'lzp/no-dangerous-html': 'error',
      'lzp/no-use-cache': 'error',
    },
  },
  {
    files: [
      'apps/web/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
      'packages/ui/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}',
    ],
    // Generated token files (#70) hold the raw values the tokens are made from.
    ignores: ['packages/ui/src/tokens/**', '**/*.generated.ts'],
    plugins,
    rules: { 'lzp/tokens-only': 'error', 'lzp/lucide-only': 'error', 'lzp/inter-only': 'error' },
  },
];
