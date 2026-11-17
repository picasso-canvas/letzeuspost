// What a request or a job can reach, read from the code (§17: "the list of routes comes from the app itself"), and
// which of it the tenancy suite tests. TypeScript's own parser reads the files, so a word in a comment or a string is
// never taken for an export, an action or a test.
//
// The list:
// - `route <METHOD> <path>`: each HTTP method a route handler under apps/web/src/app exports, and `route GET <path>`
//   for each metadata image (`opengraph-image`, `twitter-image`, `icon`, `apple-icon`) and `sitemap` file whose path
//   holds an id (a `[segment]`);
// - `page <path>`, `layout <path>`, `template <path>` and `default <path>`: each of these whose path holds an id: what
//   a link with another workspace's id would open. A path without one takes no id, so it is left to its route or
//   action;
// - `action <file>#<name>`: each server action in apps/web/src, from a `'use server'` file or function;
// - `auth <METHOD> <path>`: each Better Auth endpoint packages/auth serves (SERVED_ENDPOINTS);
// - `queue <name>`: each job queue (packages/db's queueNames);
// - `job <name>`: each queue apps/worker runs a handler for (`jobs.work('<name>', …)`).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SERVED_ENDPOINTS } from '../../packages/auth/src/sign-in.ts';
import { queueNames } from '../../packages/db/src/jobs/queues.ts';

export const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const NOT_APP_CODE = /\.(?:test|spec)\.[^.]+$|\.d\.ts$/;
/** Files under an id segment that Next renders for a URL, like a page. */
const PAGE_KINDS = new Set(['page', 'layout', 'template', 'default']);
/** Metadata files Next serves as GET routes of their own (an icon may carry a number: `icon1`). */
const METADATA_IMAGE = /^(?:opengraph-image|twitter-image|icon|apple-icon)\d*$/;
/** Folders Next would serve routes from that the list doesn't read (a root `app` or `pages` makes Next ignore src/). */
const OTHER_ROUTERS = ['apps/web/src/pages', 'apps/web/pages', 'apps/web/app'];
/** Folders a test in the suite may sit in without Vitest running it. */
const NOT_RUN_DIRS = new Set(['node_modules', 'dist']);

/**
 * Every source file under `dir` (none if it doesn't exist). The app and worker scans start at `src`, which holds no
 * build output, so they skip nothing: inside `src/app`, a `dist` or `.well-known` folder is a route. Only the scan for
 * tenancy tests passes `skipNotRun`, so a test Vitest wouldn't run never counts as cover.
 */
function sourceFiles(dir: string, skipNotRun = false): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const skipped = skipNotRun && (NOT_RUN_DIRS.has(entry.name) || entry.name.startsWith('.'));
      return skipped ? [] : sourceFiles(at, skipNotRun);
    }
    return SOURCE.test(entry.name) ? [at] : [];
  });
}

function parse(file: string): ts.SourceFile {
  const kind = /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
}

const posix = (file: string) => file.split(path.sep).join('/');

/** `'use server'` among the directives a file or a function body starts with. */
function saysUseServer(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      return false;
    }
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((each) => each.kind === kind);

/** The names a module exports as values (never a type), `default` included. */
function exportedValues(source: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const statement of source.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    const asDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    if (
      exported &&
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      !hasModifier(statement, ts.SyntaxKind.DeclareKeyword)
    ) {
      names.push(asDefault ? 'default' : (statement.name?.text ?? 'default'));
    } else if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error(
            `${source.fileName}: an export the suite can't read (a destructured one)`,
          );
        }
        names.push(declaration.name.text);
      }
    } else if (ts.isExportAssignment(statement) && statement.isExportEquals !== true) {
      names.push('default');
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      const clause = statement.exportClause;
      if (clause === undefined || ts.isNamespaceExport(clause)) {
        throw new Error(`${source.fileName}: \`export *\` hides what the file exports; name them`);
      }
      for (const element of clause.elements) {
        if (!element.isTypeOnly) names.push(element.name.text);
      }
    }
  }
  return names;
}

/** The name an inline server action goes by: its function's, its variable's or its property's, else its line. */
function actionName(node: ts.FunctionLikeDeclaration, source: ts.SourceFile): string {
  if (node.name !== undefined && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (
    (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return `line ${String(source.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;
}

/** The server actions in one file: every exported value of a `'use server'` file, and every `'use server'` function. */
function actionsIn(file: string, root: string): string[] {
  const source = parse(file);
  const at = posix(path.relative(root, file));
  const names = new Set(saysUseServer(source.statements) ? exportedValues(source) : []);
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionLike(node) &&
      'body' in node &&
      node.body !== undefined &&
      ts.isBlock(node.body) &&
      saysUseServer(node.body.statements)
    ) {
      names.add(actionName(node, source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...names].map((name) => `action ${at}#${name}`);
}

/** A segment Next leaves out of the URL: a route group `(name)` or a parallel route's slot `@name`. */
const notInUrl = (segment: string) => /^\(.*\)$/.test(segment) || segment.startsWith('@');

/**
 * apps/web's route handlers, its pages, layouts, templates, defaults and metadata routes with ids, and its server
 * actions, under `root`. Throws when apps/web has a router folder besides src/app, which the list doesn't read.
 */
export function appEntries(root: string = REPO_ROOT): string[] {
  for (const other of OTHER_ROUTERS) {
    if (existsSync(path.join(root, other))) {
      throw new Error(
        `${other}: Next serves routes from it, but the suite lists only apps/web/src/app`,
      );
    }
  }
  const web = path.join(root, 'apps/web/src');
  const app = path.join(web, 'app');
  const entries: string[] = [];
  for (const file of sourceFiles(web)) {
    if (NOT_APP_CODE.test(file)) continue;
    const relative = path.relative(app, file);
    const inApp = !relative.startsWith('..') && !path.isAbsolute(relative);
    if (inApp) {
      const segments = path
        .dirname(relative)
        .split(path.sep)
        .filter((each) => each !== '.');
      const inUrl = segments.filter((each) => !notInUrl(each));
      const url = `/${inUrl.join('/')}`;
      const kind = path.basename(file).replace(/\..*$/, '');
      const takesId = segments.some((each) => each.startsWith('['));
      if (kind === 'route') {
        const exported = new Set(exportedValues(parse(file)));
        for (const method of HTTP_METHODS) {
          if (exported.has(method)) entries.push(`route ${method} ${url}`);
        }
      } else if (PAGE_KINDS.has(kind) && takesId) {
        entries.push(`${kind} ${url}`);
      } else if ((METADATA_IMAGE.test(kind) || kind === 'sitemap') && takesId) {
        const leaf = kind === 'sitemap' ? 'sitemap.xml' : kind;
        entries.push(`route GET /${[...inUrl, leaf].join('/')}`);
      }
    }
    entries.push(...actionsIn(file, root));
  }
  return entries;
}

/** The Better Auth endpoints packages/auth serves below /api/auth. */
export function authEntries(): string[] {
  return SERVED_ENDPOINTS.map((endpoint) => `auth ${endpoint}`);
}

/** Every job queue. */
export function queueEntries(): string[] {
  return queueNames.map((name) => `queue ${name}`);
}

/** The queues apps/worker, under `root`, runs a handler for: each `.work('<queue>', …)` call. */
export function jobEntries(root: string = REPO_ROOT): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(path.join(root, 'apps/worker/src'))) {
    if (NOT_APP_CODE.test(file)) continue;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'work'
      ) {
        const [queue] = node.arguments;
        if (queue === undefined || !ts.isStringLiteralLike(queue)) {
          throw new Error(`${file}: a job handler for a queue the suite can't read; name it`);
        }
        names.add(queue.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return [...names].map((name) => `job ${name}`);
}

/** Everything a request or a job can reach, under `root` (the repo, or a fixture app's folder). */
export function inventory(root: string = REPO_ROOT): string[] {
  return [...appEntries(root), ...authEntries(), ...queueEntries(), ...jobEntries(root)];
}

/** The test files the services project runs (vitest.config.ts): a test with another extension never runs. */
const RUN_TEST = /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|mjs)$/;

/**
 * Vitest's ways of not running what a call holds: `.skip`, `.todo`, `.skipIf(…)` and `.runIf(…)` on the call, or a
 * `skip` or `todo` option. A condition is never read: a block under `skipIf` or `runIf` covers nothing either way.
 */
const NOT_RUN = new Set(['skip', 'todo', 'skipIf', 'runIf']);

function skips(call: ts.CallExpression): boolean {
  let callee: ts.Expression = call.expression;
  while (ts.isCallExpression(callee) || ts.isPropertyAccessExpression(callee)) {
    if (ts.isPropertyAccessExpression(callee) && NOT_RUN.has(callee.name.text)) return true;
    callee = callee.expression;
  }
  return call.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some(
        (property) =>
          property.name !== undefined &&
          (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
          NOT_RUN.has(property.name.text),
      ),
  );
}

/** Whether a node holds a test Vitest runs: an `it(…)` or `test(…)` call with a function, under no skipping call. */
function holdsTest(node: ts.Node): boolean {
  if (ts.isCallExpression(node)) {
    if (skips(node)) return false;
    const [, body] = node.arguments;
    if (
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'it' || node.expression.text === 'test') &&
      body !== undefined &&
      (ts.isArrowFunction(body) || ts.isFunctionExpression(body))
    ) {
      return true;
    }
  }
  return ts.forEachChild(node, holdsTest) ?? false;
}

/** Whether a call sits inside a skipping one (a `describe.skip(…)` around a tenancy block). */
function underSkip(node: ts.Node): boolean {
  for (let at = node.parent as ts.Node | undefined; at !== undefined; at = at.parent) {
    if (ts.isCallExpression(at) && skips(at)) return true;
  }
  return false;
}

/** The entries the test files under `dir` cover: each `tenancy('<entry>', …)` block that holds a test Vitest runs. */
export function coveredEntries(dir: string): string[] {
  const covered = new Set<string>();
  for (const file of sourceFiles(dir, true)) {
    if (!RUN_TEST.test(file)) continue;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'tenancy'
      ) {
        const [entry, body] = node.arguments;
        if (
          entry !== undefined &&
          ts.isStringLiteralLike(entry) &&
          body !== undefined &&
          holdsTest(body) &&
          !underSkip(node)
        ) {
          covered.add(entry.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return [...covered];
}

/** The entries no tenancy block covers. */
export const uncovered = (entries: readonly string[], covered: readonly string[]) =>
  entries.filter((entry) => !covered.includes(entry));

/** The tenancy blocks that name nothing on the list. */
export const unknown = (entries: readonly string[], covered: readonly string[]) =>
  covered.filter((entry) => !entries.includes(entry));
