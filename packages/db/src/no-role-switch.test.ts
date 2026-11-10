// Only the auth handle switches the database role (#176, Cerberus F2's nit on #184). Workspace code runs as lzp_app;
// lzp_app may take lzp_auth, which holds the auth tables, only by switching to it, and only packages/db/src/auth.ts
// does that, on its own pool. This check reads every code and SQL file in the repo (comments too) and refuses a role
// switch anywhere else. It runs in `pnpm check`. The cases below put the SQL words together at run time, because the
// check reads this file as well.
//
// Its limit (Argus F6 and Cerberus F4 on #189): it reads text, so it sees only a switch written out in a file. A
// switch put together at run time gets past it, as these cases show: SQL built from pieces, a role name read from
// config, or text from a request that reaches a query (an injection). So it is not the only wall. `scoped()` in db.ts
// checks, in every unit of work, that the connection still runs as the role it logged in as, and refuses it if not.
// Even so, SQL injected into workspace code could switch to lzp_auth inside its own transaction; parameterised
// queries (Drizzle) are what keep that out.
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
  // The role given in a connection's startup options (pg's `options`, PGOPTIONS), as written or percent-encoded in a
  // connection URL (a space as %20 or +, `=` as %3D).
  /(?:-c(?:\s|%20|\+)*|--)role(?:\s|%20|\+)*(?:=|%3d)/i,
];

/** The role switches in a text: one entry per pattern that matches. */
function roleSwitches(text: string): string[] {
  return SWITCHES.flatMap((pattern) => pattern.exec(text)?.[0] ?? []);
}

/** The role switches in a file's text. */
function roleSwitchesIn(_file: string, text: string): string[] {
  return roleSwitches(text);
}

/** Every code file in the repo, tracked or new (not ignored), from the repo root. */
function textFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => CODE.test(file));
}

const w = (...parts: string[]) => parts.join(' ');
const glue = (...parts: string[]) => parts.join('');
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
    [`sql\`select ${glue('set_config(', "'role'")}, 'lzp_auth', true)\``],
    [`"select pg_catalog.${glue('set_config ( ', "'role'")}, 'lzp_auth', false)"`],
    [`{ options: '${glue('-c role', '=lzp_auth')}' }`],
    [`PGOPTIONS='${glue('--role', '=lzp_auth')}'`],
    // The same option inside a connection URL, percent-encoded or with `+` for the space (Cerberus F4 on #189).
    [`postgres://lzp_app:pw@db/letzeuspost?options=${glue('-c%20', 'role%3D', 'lzp_auth')}`],
    [`postgres://lzp_app:pw@db/letzeuspost?options=${glue('-c+', 'role%3d', 'lzp_auth')}`],
    [`DATABASE_URL=postgres://db/x?options=${glue('--', 'role%3D', 'lzp_auth')}`],
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

  // Outside the code too: a script, a workflow, a config file or a Markdown code block can open a connection with
  // the role set, or run the command through psql (Argus F1 on #189).
  it.each([
    ['ops/restore.sh', `PGOPTIONS='${glue('-c ', 'role=lzp_auth')}' psql "$DATABASE_URL"`],
    ['ops/restore.sh', `psql "$DATABASE_URL" -c "${w('SET', 'ROLE', 'lzp_auth')}"`],
    ['.github/workflows/ci.yml', `env:\n  PGOPTIONS: ${glue('-c ', 'role=lzp_auth')}\n`],
    ['.github/workflows/ci.yml', `run: psql -c '${w('set', 'role', 'lzp_auth')}'\n`],
    ['config/db.json', `{ "options": "${glue('-c ', 'role=lzp_auth')}" }`],
    [
      'docs/ops/restore.md',
      `Run:\n\n\`\`\`sh\npsql -c "${w('SET', 'ROLE', 'lzp_auth')}"\n\`\`\`\n`,
    ],
    ['docs/ops/restore.md', `~~~sql\n${w('RESET', 'ROLE')};\n~~~\n`],
  ])('finds a role switch in %s: %s', (file, text) => {
    expect(roleSwitchesIn(file, text)).not.toEqual([]);
  });

  it('reads Markdown only in its code blocks, where a command can be copied and run', () => {
    const prose = `lzp_app takes lzp_auth only by ${w('SET', 'ROLE')}, which the auth handle does.\n`;
    expect(roleSwitchesIn('docs/plan/13-architecture.md', prose)).toEqual([]);
    expect(roleSwitchesIn('docker/postgres/roles.sh', `# ${prose}`)).not.toEqual([]);
  });

  it('reads every text file: code, SQL, shell, YAML, JSON and Markdown, the auth handle among them', () => {
    const files = textFiles();
    expect(files).toEqual(
      expect.arrayContaining([
        AUTH_HANDLE,
        'packages/db/src/db.ts',
        'packages/db/migrations/0000_accounts.sql',
        'packages/db/src/no-role-switch.test.ts',
        'docker/postgres/roles.sh',
        'docker/compose.yml',
        '.github/workflows/services.yml',
        'packages/db/package.json',
        'docs/plan/13-architecture.md',
        'CLAUDE.md',
      ]),
    );
    expect(files.filter((file) => file.includes('node_modules/'))).toEqual([]);
    // Images and other binaries are no text, and skipped.
    expect(files).not.toContain('docs/design/logos/letzeuspost/mark.png');
  });
});

describe('the repo', () => {
  it('switches the database role nowhere but in the auth handle', () => {
    const found = textFiles()
      .filter((file) => file !== AUTH_HANDLE)
      .flatMap((file) =>
        roleSwitchesIn(file, readFileSync(`${ROOT}${file}`, 'utf8')).map(
          (hit) => `${file}: ${hit}`,
        ),
      );
    expect(found).toEqual([]);
  });

  it('switches role in the auth handle, which the check above leaves out on purpose', () => {
    expect(roleSwitches(readFileSync(`${ROOT}${AUTH_HANDLE}`, 'utf8'))).not.toEqual([]);
  });
});
