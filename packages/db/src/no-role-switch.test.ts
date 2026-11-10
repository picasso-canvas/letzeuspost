// Only the auth handle switches the database role (#176, Cerberus F2's nit on #184). Workspace code runs as lzp_app;
// lzp_app may take lzp_auth, which holds the auth tables, only by switching to it, and only packages/db/src/auth.ts
// does that, on its own pool. This check reads every code and SQL file in the repo (comments too) and refuses a role
// switch anywhere else. It runs in `pnpm check`. The cases below put the SQL words together at run time, because the
// check reads this file as well.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The only file allowed to switch role. */
const AUTH_HANDLE = 'packages/db/src/auth.ts';

/** Code Postgres or a connection could run: every script and SQL file. */
const CODE = /\.(?:[cm]?[jt]s|[jt]sx|sql)$/;

/** Each way Postgres lets a connection change the role its statements run as. */
const SWITCHES: readonly RegExp[] = [
  // The SET command for the role, with SESSION or LOCAL, `=` or TO; but not an UPDATE of a column called role.
  /(?<!\bupdate\s+(?:only\s+)?[\w."]+(?:\s+(?:as\s+)?[\w"]+)?\s+|\bdo\s+update\s+)\bset\s+(?:(?:session|local)\s+)?role\b/i,
  /\breset\s+role\b/i,
  /\bset_config\s*\(\s*'role'/i,
  /\bset\s+(?:(?:session|local)\s+)?session\s+authorization\b/i,
  // The role given in a connection's startup options (pg's `options`, PGOPTIONS).
  /(?:-c\s*|--)role\s*=/i,
];

/** The role switches in a text: one entry per pattern that matches. */
function roleSwitches(text: string): string[] {
  return SWITCHES.flatMap((pattern) => pattern.exec(text)?.[0] ?? []);
}

/** Every code file in the repo, tracked or new (not ignored), from the repo root. */
function codeFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => CODE.test(file));
}

const w = (...parts: string[]) => parts.join(' ');
const q = (text: string) => `'${text}'`;

describe('the role-switch check', () => {
  it.each([
    [`client.query(${q(w('SET', 'ROLE', 'lzp_auth'))})`],
    [`client.query("${w('set', 'role', 'lzp_auth')}")`],
    [`sql\`${w('set', 'local', 'role', 'lzp_auth')}\``],
    [`sql\`${w('SET', 'SESSION', 'ROLE')} \${name}\``],
    [`sql\`select 1;\n  ${w('set', 'role')} = 'lzp_auth'\``],
    [`sql\`${w('set', 'role', 'to')} lzp_auth\``],
    [`sql.raw(${q(w('RESET', 'ROLE'))})`],
    [`sql\`select ${'set_config('}'role', 'lzp_auth', true)\``],
    [`"select pg_catalog.${'set_config'} ( 'role', 'lzp_auth', false)"`],
    [`{ options: '${'-c'} role=lzp_auth' }`],
    [`PGOPTIONS='${'--'}role=lzp_auth'`],
    [`${w('SET', 'SESSION', 'AUTHORIZATION')} lzp_owner;`],
    [`${w('ALTER', 'ROLE', 'lzp_app', 'SET', 'role')} = 'lzp_auth';`],
  ])('finds a role switch in %s', (text) => {
    expect(roleSwitches(text)).not.toEqual([]);
  });

  it.each([
    ['sql`update member set role = ${role} where id = ${id}`'],
    ['sql`UPDATE "member" AS m SET role = \'viewer\' WHERE m.id = ${id}`'],
    ['update public.member set role = $1'],
    ['insert into member (role) values ($1) on conflict (id) do update set role = excluded.role'],
    ["select role from member where role = 'owner'"],
    ["select current_user, set_config('app.workspace_id', $1, true)"],
    ['GRANT lzp_auth TO lzp_app WITH INHERIT FALSE, SET TRUE'],
  ])('lets %s through', (text) => {
    expect(roleSwitches(text)).toEqual([]);
  });

  it('reads the files that matter: code and SQL, the auth handle among them', () => {
    const files = codeFiles();
    expect(files).toEqual(
      expect.arrayContaining([
        AUTH_HANDLE,
        'packages/db/src/db.ts',
        'packages/db/migrations/0000_accounts.sql',
        'packages/db/src/no-role-switch.test.ts',
      ]),
    );
    expect(files.filter((file) => file.includes('node_modules/'))).toEqual([]);
  });
});

describe('the repo', () => {
  it('switches the database role nowhere but in the auth handle', () => {
    const found = codeFiles()
      .filter((file) => file !== AUTH_HANDLE)
      .flatMap((file) =>
        roleSwitches(readFileSync(`${ROOT}${file}`, 'utf8')).map((hit) => `${file}: ${hit}`),
      );
    expect(found).toEqual([]);
  });

  it('switches role in the auth handle, which the check above leaves out on purpose', () => {
    expect(roleSwitches(readFileSync(`${ROOT}${AUTH_HANDLE}`, 'utf8'))).not.toEqual([]);
  });
});
