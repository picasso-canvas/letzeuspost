// Dependency licence check (§20 "Dependency licences"). Run by `pnpm licence-check` and the CI job `ci`.
// Anything that isn't on the allowlist or a named exception fails until Zeus adds it.
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/** SPDX ids allowed outright (§20; BlueOak-1.0.0 added by Zeus, 2026-11-07). */
export const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'ISC',
  'PostgreSQL',
  'OFL-1.1',
  'BlueOak-1.0.0',
]);

/** SPDX exception ids accepted after `WITH`: each only adds permissions to its base licence. Others fail. */
export const WITH_EXCEPTIONS = new Set([
  'LLVM-exception',
  'Classpath-exception-2.0',
  'GCC-exception-3.1',
  'Autoconf-exception-3.0',
]);

/**
 * Named exceptions: exact package names with the exact licence they carry. Nothing broader.
 * `devOnly` exceptions fail if the package ever becomes a production dependency.
 * @type {ReadonlyArray<{ names: readonly string[], license: string, devOnly: boolean, why: string }>}
 */
export const EXCEPTIONS = [
  {
    // Zeus, 2026-11-06 (§13 A14): LGPL libraries used unchanged as separate shared libraries.
    names: [
      '@img/sharp-libvips-darwin-arm64',
      '@img/sharp-libvips-darwin-x64',
      '@img/sharp-libvips-linux-arm',
      '@img/sharp-libvips-linux-arm64',
      '@img/sharp-libvips-linux-ppc64',
      '@img/sharp-libvips-linux-riscv64',
      '@img/sharp-libvips-linux-s390x',
      '@img/sharp-libvips-linux-x64',
      '@img/sharp-libvips-linuxmusl-arm64',
      '@img/sharp-libvips-linuxmusl-x64',
    ],
    license: 'LGPL-3.0-or-later',
    devOnly: false,
    why: 'libvips inside sharp, unchanged (§13 A14)',
  },
  {
    // Zeus, 2026-11-07: MPL-2.0 only for dev-only tools used unchanged. Vite's CSS tool, pulled in by Vitest.
    names: [
      'lightningcss',
      'lightningcss-darwin-arm64',
      'lightningcss-darwin-x64',
      'lightningcss-linux-arm64-gnu',
      'lightningcss-linux-arm64-musl',
      'lightningcss-linux-x64-gnu',
      'lightningcss-linux-x64-musl',
    ],
    license: 'MPL-2.0',
    devOnly: true,
    why: 'test tooling (vite via vitest), used unchanged',
  },
  {
    // Zeus, 2026-11-07 (#18 comment 6710134630): browser support data that Next.js ships in production.
    names: ['caniuse-lite'],
    license: 'CC-BY-4.0',
    devOnly: false,
    why: 'browser support data inside Next.js, unchanged',
  },
  {
    // Zeus, 2026-11-07 (#18 comment 6710134630): accessibility checks in the Playwright tests only.
    names: ['axe-core', '@axe-core/playwright'],
    license: 'MPL-2.0',
    devOnly: true,
    why: 'accessibility test tooling, used unchanged',
  },
  {
    // Zeus, 2026-11-07 (#18 comment 6710134630): sends the sign-in emails (to Mailpit in dev).
    names: ['nodemailer'],
    license: 'MIT-0',
    devOnly: false,
    why: 'mail transport for the worker, unchanged',
  },
  {
    // Zeus, 2026-11-08: public-domain CSS data under React Email's preview CLI. His answer, recorded:
    // https://github.com/picasso-canvas/letzeuspost/issues/64#issuecomment-6711074547
    names: ['mdn-data'],
    license: 'CC0-1.0',
    devOnly: true,
    why: "CSS data inside React Email's dev-only preview CLI (via css-tree), unchanged",
  },
  {
    // Zeus, 2026-11-07 (Q2, #18 comment 6710134630): Apache-2.0 by the LICENSE file in its repo and its npm package;
    // its package.json has no `license`, so pnpm reports it as Unknown.
    names: ['@google/design.md'],
    license: 'Unknown',
    devOnly: true,
    why: 'lints and exports DESIGN.md (§21); Apache-2.0 per its LICENSE file, used unchanged',
  },
];

/**
 * @typedef {{ type: 'id', id: string } | { type: 'and' | 'or', args: SpdxNode[] }} SpdxNode
 */

/**
 * Parses an SPDX licence expression. `WITH <exception>` is kept as its base licence when the exception is one of
 * `WITH_EXCEPTIONS`. Returns null for anything that isn't a valid expression, including a value that isn't text.
 * @param {unknown} text
 * @returns {SpdxNode | null}
 */
export function parseSpdx(text) {
  if (typeof text !== 'string') return null;
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (/** @type {string | undefined} */ t, /** @type {string} */ op) =>
    t?.toUpperCase() === op;

  /** @returns {SpdxNode | null} */
  const atom = () => {
    const t = tokens[i++];
    if (t === undefined || t === ')') return null;
    if (t === '(') {
      const inner = orExpr();
      if (tokens[i++] !== ')') return null;
      return inner;
    }
    if (isOp(t, 'AND') || isOp(t, 'OR') || isOp(t, 'WITH')) return null;
    if (!/^[A-Za-z0-9.+-]+$/.test(t)) return null;
    if (isOp(peek(), 'WITH')) {
      i++;
      const exception = tokens[i++];
      if (exception === undefined || !WITH_EXCEPTIONS.has(exception)) return null;
    }
    return { type: 'id', id: t };
  };

  /** @param {'and' | 'or'} type @param {() => SpdxNode | null} next @returns {SpdxNode | null} */
  const chain = (type, next) => {
    const first = next();
    if (!first) return null;
    const args = [first];
    while (isOp(peek(), type.toUpperCase())) {
      i++;
      const n = next();
      if (!n) return null;
      args.push(n);
    }
    return args.length === 1 ? first : { type, args };
  };

  const andExpr = () => chain('and', atom);
  const orExpr = () => chain('or', andExpr);

  const tree = orExpr();
  return tree && i === tokens.length ? tree : null;
}

/** @param {SpdxNode} node @returns {boolean} */
function allowed(node) {
  if (node.type === 'id') return ALLOWED.has(node.id);
  return node.type === 'or' ? node.args.some(allowed) : node.args.every(allowed);
}

/** @param {unknown} expression */
export function isAllowedExpression(expression) {
  const tree = parseSpdx(expression);
  return tree !== null && allowed(tree);
}

/**
 * @typedef {{ name: string, versions: string[], license: unknown }} LicencedPackage   `license` as pnpm reports it
 * @typedef {Record<string, LicencedPackage[]>} LicenceList   the shape `pnpm licenses list --json` prints
 * @typedef {{ name: string, versions: string[], license: string, reason: string }} Violation
 */

/**
 * @param {LicenceList} all   every dependency, dev included
 * @param {LicenceList} prod  production dependencies only (`--prod`)
 * @returns {Violation[]}
 */
export function checkLicences(all, prod) {
  const prodNames = new Set(Object.values(prod).flatMap((pkgs) => pkgs.map((p) => p.name)));
  /** @type {Violation[]} */
  const violations = [];
  for (const pkgs of Object.values(all)) {
    for (const { name, versions, license } of pkgs) {
      if (typeof license !== 'string') {
        violations.push({
          name,
          versions,
          license: String(JSON.stringify(license)),
          reason: 'licence field is not text',
        });
        continue;
      }
      if (isAllowedExpression(license)) continue;
      const exception = EXCEPTIONS.find((e) => e.license === license && e.names.includes(name));
      if (!exception) {
        violations.push({ name, versions, license, reason: 'licence not on the allowlist' });
      } else if (exception.devOnly && prodNames.has(name)) {
        violations.push({
          name,
          versions,
          license,
          reason: 'exception is for dev tooling only, but this is a production dependency',
        });
      }
    }
  }
  return violations.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `-r`: every workspace package (root included), not only the root's own dependencies.
 * @param {{ prod: boolean }} options
 */
export function licenceListArgs({ prod }) {
  return ['-r', 'licenses', 'list', '--json', ...(prod ? ['--prod'] : [])];
}

/** @param {{ prod: boolean }} options @returns {LicenceList} */
function pnpmLicences(options) {
  const out = execFileSync('pnpm', licenceListArgs(options), { encoding: 'utf8' }).trim();
  return out === '' ? {} : /** @type {LicenceList} */ (JSON.parse(out));
}

function main() {
  const all = pnpmLicences({ prod: false });
  const violations = checkLicences(all, pnpmLicences({ prod: true }));
  const count = Object.values(all).reduce((n, pkgs) => n + pkgs.length, 0);
  if (violations.length === 0) {
    console.log(`licence-check: ${String(count)} packages, all allowed`);
    return;
  }
  console.error(
    `licence-check: ${String(violations.length)} package(s) not allowed (§20 Dependency licences):`,
  );
  for (const v of violations) {
    console.error(`  ${v.name}@${v.versions.join(',')}  ${v.license}  ${v.reason}`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
