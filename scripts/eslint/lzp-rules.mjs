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

/**
 * Calls `check(source, node)` for every module a file imports or re-exports by name.
 * @param {(source: string, node: EsNode) => void} check
 */
function onImports(check) {
  /** @param {any} node */
  const visit = (node) => {
    if (node.source?.type === 'Literal' && typeof node.source.value === 'string') {
      check(node.source.value, node);
    }
  };
  return {
    ImportDeclaration: visit,
    ExportNamedDeclaration: visit,
    ExportAllDeclaration: visit,
    ImportExpression: visit,
    /** require('x') @param {any} node */
    CallExpression(node) {
      const [arg] = node.arguments;
      if (
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        arg?.type === 'Literal'
      )
        if (typeof arg.value === 'string') check(arg.value, node);
    },
    /** import x = require('x') @param {any} node */
    TSImportEqualsDeclaration(node) {
      const ref = node.moduleReference;
      if (ref?.type === 'TSExternalModuleReference' && typeof ref.expression?.value === 'string')
        check(ref.expression.value, node);
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
    },
    schema: [],
  },
  create(context) {
    const file = repoPath(context);
    const inDb = file.startsWith('packages/db/');
    const inAuth = file.startsWith('packages/auth/');
    return onImports((source, node) => {
      const raw = DB_CLIENT.test(source);
      if (raw && !inDb) context.report({ node, messageId: 'raw', data: { source } });
      const auth = source === AUTH_DB || source.startsWith(`${AUTH_DB}/`);
      if (auth && !inDb && !inAuth) context.report({ node, messageId: 'auth', data: { source } });
    });
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
    },
    schema: [],
  },
  create(context) {
    /** @param {any} spec */
    const nameOf = (spec) => spec.imported?.name ?? spec.imported?.value ?? spec.local?.name;
    /** @param {any} node */
    const fromCache = (node) => isCacheModule(node.source?.value);
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
        if (isCacheModule(node.source?.value) || isDeepNext(node.source?.value))
          context.report({ node, messageId: 'module' });
      },
      /** @param {any} node */
      CallExpression(node) {
        const [arg] = node.arguments;
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          (isCacheModule(arg?.value) || isDeepNext(arg?.value))
        )
          context.report({ node, messageId: 'module' });
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
        check(node, node.key?.name ?? node.key?.value);
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

/** §21: Inter is the only interface font (render-engine fonts live in packages/render, outside this rule). */
/** @type {RuleModule} */
const interOnly = {
  meta: {
    type: 'problem',
    messages: {
      font: "'{{font}}' isn't Inter: Inter is the only interface font (§21).",
      local: 'next/font/local loads a font file: Inter is the only interface font (§21).',
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
        const match = /^@fontsource(?:-variable)?\/([^/]+)/.exec(source);
        if (match && match[1] !== 'inter')
          context.report({ node, messageId: 'font', data: { font: match[1] } });
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
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    // Generated token files (#70) hold the raw values the tokens are made from.
    ignores: ['packages/ui/src/tokens/**', '**/*.generated.ts'],
    plugins,
    rules: { 'lzp/tokens-only': 'error', 'lzp/lucide-only': 'error', 'lzp/inter-only': 'error' },
  },
];
