// Only the auth handle switches the database role (#176, Cerberus F2's nit on #184). Workspace code runs as lzp_app;
// lzp_app may take lzp_auth, which holds the auth tables, only by switching to it, and only packages/db/src/auth.ts
// does that, on its own pool. This check reads every text file in the repo, comments too: code, SQL, shell, YAML, JSON,
// and Markdown's code blocks (Argus F1 on #189), fenced or indented (Argus F2 on #202), in files holding NUL bytes too
// (Cerberus F3 on #202), and refuses a role switch anywhere else but in the few known lines below. It runs in
// `pnpm check`. The cases below put the SQL words together at run time, because the check reads this file as well.
//
// Its limit (Argus F6 and Cerberus F4 on #189): it reads text, so it sees only a switch written out in a file. A
// switch put together at run time gets past it, as these cases show: SQL built from pieces, a role name read from
// config, or text from a request that reaches a query (an injection). So it is not the only wall. `scoped()` in db.ts
// checks, before and after every unit of work, that the connection runs as the role it logged in as, and refuses the
// work if not (Cerberus F1 on #189); its own comment says what still gets past it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The only file allowed to switch role. */
const AUTH_HANDLE = 'packages/db/src/auth.ts';

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

const MARKDOWN = /\.(?:md|mdx|markdown)$/i;

/** A fence that opens or closes a Markdown code block, inside a list or a quote too: ``` or ~~~, 3 or more. */
const FENCE = /^[\s>]*(`{3,}|~{3,})/;

/** The quote markers at a line's start, each with the one space that may follow it. */
const QUOTE = /^(?:\s{0,3}>\s?)*/;

/** A line of an indented code block, once its quote markers are off: four spaces or a tab (Argus F2 on #202). */
const INDENTED = /^(?: {4}|\t)/;

/**
 * A Markdown text's code blocks, one after another: fenced ones, and indented ones (a line indented four spaces or a
 * tab after a blank line or another such line, in a quote too). A fenced block ends at a fence of the same kind at
 * least as long, or at the file's end. The prose around them is left out: it may name the commands it explains. An
 * indented paragraph inside a list item is read as code too: reading too much is the safe side.
 */
function codeBlocks(markdown: string): string {
  const code: string[] = [];
  let open: string | null = null;
  let afterBlank = true; // a file may start with an indented block
  let inIndented = false;
  for (const line of markdown.split('\n')) {
    const fence = FENCE.exec(line)?.[1];
    if (open === null) {
      const body = line.replace(QUOTE, '');
      const blank = body.trim() === '';
      if (fence !== undefined) {
        open = fence;
        inIndented = false;
      } else if (!blank && INDENTED.test(body) && (afterBlank || inIndented)) {
        code.push(body);
        inIndented = true;
      } else if (!blank) {
        inIndented = false; // a blank line doesn't end an indented block; prose does
      }
      afterBlank = blank;
    } else if (
      fence !== undefined &&
      fence[0] === open[0] &&
      fence.length >= open.length &&
      line.trim().endsWith(fence)
    ) {
      open = null;
    } else {
      code.push(line);
    }
  }
  return code.join('\n');
}

/** The role switches in a file's text: all of it, or a Markdown file's code blocks. */
function roleSwitchesIn(file: string, text: string): string[] {
  return roleSwitches(MARKDOWN.test(file) ? codeBlocks(text) : text);
}

const w = (...parts: string[]) => parts.join(' ');
const glue = (...parts: string[]) => parts.join('');
const q = (text: string) => `'${text}'`;

/**
 * Lines outside the auth handle that name a switch, already in the repo when the check grew past code and SQL (#195),
 * word for word (trimmed). They're in files a builder may not change, so they stay until Zeus decides (#195's
 * needs-zeus). Only these lines are let through: any other switch in those files, or a change to one of these, is
 * caught.
 */
const KNOWN: Readonly<Record<string, readonly string[]>> = {
  // A comment: how lzp_app reaches lzp_auth.
  'docker/postgres/roles.sh': [
    `#   lzp_auth:  no login; the auth tables' rights (#176). lzp_app takes it only by ${w('SET', 'ROLE')}, which the auth handle does on`,
  ],
  // CI's smoke check that lzp_app may switch to lzp_auth (#183), and its comment.
  '.github/workflows/services.yml': [
    `# lzp_auth (#183): no login and no special rights; lzp_app may ${w('SET', 'ROLE')} to it but inherits nothing from it, so`,
    `[ "$(psql "$DATABASE_URL" -qtA -c ${q(w('set', 'role', 'lzp_auth'))} -c 'select current_user')" = lzp_auth ]`,
  ],
};

/** A file's text without its known lines. */
function withoutKnown(file: string, text: string): string {
  const known = KNOWN[file] ?? [];
  return text
    .split('\n')
    .filter((line) => !known.includes(line.trim()))
    .join('\n');
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * The text in a file's bytes, or null for a binary. A NUL byte alone doesn't make a binary (Cerberus F3 on #202): it
 * would let a switch hide in a file beside one. A file is text when its bytes, NULs left out, are valid UTF-8, as text
 * in UTF-8 or ASCII-range UTF-16 is; an image's bytes aren't.
 */
function textOf(bytes: Uint8Array): string | null {
  try {
    return UTF8.decode(bytes.filter((byte) => byte !== 0));
  } catch {
    return null;
  }
}

/** A file's text, or null for a binary or what isn't a file. */
function readText(file: string): string | null {
  const path = `${ROOT}${file}`;
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return textOf(readFileSync(path));
}

/** Every text file in the repo, tracked or new (not ignored), from the repo root. */
function textFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => file !== '' && readText(file) !== null);
}

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

  // Indented code blocks too (Argus F2 on #202): four spaces or a tab, after a blank line, in a list or a quote too.
  it.each([
    ['four spaces', `Run:\n\n    psql -c "${w('SET', 'ROLE', 'lzp_auth')}"\n`],
    ['a tab', `Run:\n\n\tpsql -c "${w('SET', 'ROLE', 'lzp_auth')}"\n`],
    ['in a quote', `> Run:\n>\n>     ${w('RESET', 'ROLE')};\n`],
    ['after another code line', `Run:\n\n    psql "$URL"\n    ${w('SET', 'ROLE', 'lzp_auth')};\n`],
  ])('finds a role switch in an indented Markdown code block: %s', (_, text) => {
    expect(roleSwitchesIn('docs/ops/restore.md', text)).not.toEqual([]);
  });

  it('reads Markdown only in its code blocks, where a command can be copied and run', () => {
    const prose = `lzp_app takes lzp_auth only by ${w('SET', 'ROLE')}, which the auth handle does.\n`;
    expect(roleSwitchesIn('docs/plan/13-architecture.md', prose)).toEqual([]);
    expect(roleSwitchesIn('docker/postgres/roles.sh', `# ${prose}`)).not.toEqual([]);
  });

  // A NUL byte doesn't make a file binary (Cerberus F3 on #202): Postgres and psql never read one, but a file of text
  // with one in it would otherwise be skipped whole, and the switch beside it with it.
  it.each([
    ['a NUL byte in SQL', Buffer.from(`select 1;\0\n${w('SET', 'ROLE', 'lzp_auth')};\n`)],
    ['UTF-16 text', Buffer.from(`${w('SET', 'ROLE', 'lzp_auth')};\n`, 'utf16le')],
  ])('reads a file of text holding NUL bytes: %s', (_, bytes) => {
    const text = textOf(bytes);
    expect(text).not.toBeNull();
    expect(roleSwitches(text ?? '')).not.toEqual([]);
  });

  // Nor does a byte that isn't UTF-8 (Argus F1 on #203): psql runs a Latin-1 or CP1252 file as it is.
  it.each([
    ['Latin-1 SQL', Buffer.from(`-- caf\xe9\n${w('SET', 'ROLE', 'lzp_auth')};\n`, 'latin1')],
    ['CP1252 shell', Buffer.from(`# \x93quoted\x94\npsql -c "${w('RESET', 'ROLE')}"\n`, 'latin1')],
  ])('reads a file of text that is not UTF-8: %s', (_, bytes) => {
    const text = textOf(bytes);
    expect(text).not.toBeNull();
    expect(roleSwitches(text ?? '')).not.toEqual([]);
  });

  it('skips a binary, which is no valid UTF-8 even without its NUL bytes', () => {
    const png = readFileSync(`${ROOT}docs/design/logos/letzeuspost/mark.png`);
    expect(textOf(png)).toBeNull();
    expect(textOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBeNull();
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

describe('the known lines', () => {
  const [file, lines] = ['.github/workflows/services.yml', KNOWN['.github/workflows/services.yml']];

  it('let through only themselves: another switch in the same file is caught', () => {
    const text = [...(lines ?? []), `PGOPTIONS='${glue('-c ', 'role=lzp_auth')}' psql`].join('\n');
    expect(roleSwitchesIn(file, withoutKnown(file, text))).not.toEqual([]);
    expect(roleSwitchesIn(file, withoutKnown(file, (lines ?? []).join('\n')))).toEqual([]);
  });

  it('let through no changed copy of themselves', () => {
    const changed = (lines ?? []).map((line) => line.replace('lzp_auth ]', 'lzp_owner ]'));
    expect(roleSwitchesIn(file, withoutKnown(file, changed.join('\n')))).not.toEqual([]);
  });

  it('are each still in their file, so none outlives the line it lets through', () => {
    for (const [path, known] of Object.entries(KNOWN)) {
      const present = (readText(path) ?? '').split('\n').map((line) => line.trim());
      for (const line of known) expect(present, path).toContain(line);
    }
  });
});

describe('the repo', () => {
  it('switches the database role nowhere but in the auth handle and the known lines', () => {
    const found = textFiles()
      .filter((file) => file !== AUTH_HANDLE)
      .flatMap((file) =>
        roleSwitchesIn(file, withoutKnown(file, readText(file) ?? '')).map(
          (hit) => `${file}: ${hit}`,
        ),
      );
    expect(found).toEqual([]);
  });

  it('switches role in the auth handle, which the check above leaves out on purpose', () => {
    expect(roleSwitches(readFileSync(`${ROOT}${AUTH_HANDLE}`, 'utf8'))).not.toEqual([]);
  });
});
