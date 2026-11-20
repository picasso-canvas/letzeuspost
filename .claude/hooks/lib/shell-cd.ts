// Does a Bash command change the directory of the shell it runs in (#284)? A builder's `Edit(./**)` is judged against
// the Bash tool's current directory, and a top-level `cd` stays for the next call, so every write outside the folder it
// moved to is refused ("don't ask mode") while the run goes on. A `cd` inside `( … )`, `$( … )` or backticks dies with
// its subshell and is fine, and so is one inside quotes, a heredoc body or a comment.
//
// A best-effort reading of the common forms, not a shell parser: a function that cds when it is called, `source`, or an
// `eval` of a variable get through. That is acceptable here: the guard stops the usual accident, and what slips past
// still ends the run as `failed` (dispatch reads the refused writes from the session's result).

const CD = new Set(['cd', 'pushd', 'popd']);
// Words after which a command starts again.
const PASSES = new Set([
  'then',
  'do',
  'else',
  'elif',
  'if',
  'while',
  'until',
  '!',
  '{',
  'time',
  'builtin',
  'command',
  'eval',
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const BLANK = /[ \t\r\f\v]/;
const WORD_END = /[\s;&|()<>'"`\\$]/;
const BOUNDARY = /[\s;&|()<>]/;

type Heredoc = { delimiter: string; stripTabs: boolean };

/** The index after the bodies of the pending heredocs, which start at `from`: each runs to a line that is its delimiter. */
function skipHeredocs(command: string, from: number, pending: Heredoc[]): number {
  let at = from;
  for (const { delimiter, stripTabs } of pending) {
    for (;;) {
      if (at >= command.length) return command.length;
      const end = command.indexOf('\n', at);
      const line = command.slice(at, end === -1 ? undefined : end).replace(/\r$/, '');
      at = end === -1 ? command.length : end + 1;
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) break;
    }
  }
  pending.length = 0;
  return at;
}

/** The delimiter after `<<` (or `<<-`) at `from`, quotes and backslashes removed, and the index after it. */
function readDelimiter(command: string, from: number): { delimiter: string; next: number } {
  let at = from;
  let delimiter = '';
  while (at < command.length && !/[\s;&|<>()]/.test(command[at] ?? '')) {
    const c = command[at] ?? '';
    if (c === "'" || c === '"') {
      const end = command.indexOf(c, at + 1);
      if (end === -1) return { delimiter, next: command.length };
      delimiter += command.slice(at + 1, end);
      at = end + 1;
    } else if (c === '\\') {
      delimiter += command[at + 1] ?? '';
      at += 2;
    } else {
      delimiter += c;
      at += 1;
    }
  }
  return { delimiter, next: at };
}

/** The index after the closing `quote` of a quoted string that starts at `from`, or -1 if it never closes. */
function closeQuote(command: string, from: number): number {
  const quote = command[from] ?? '';
  if (quote === "'") {
    const end = command.indexOf("'", from + 1);
    return end === -1 ? -1 : end + 1;
  }
  let at = from + 1;
  while (at < command.length && command[at] !== quote) at += command[at] === '\\' ? 2 : 1;
  return at >= command.length ? -1 : at + 1;
}

export function changesDirectory(command: string): boolean {
  const n = command.length;
  const pending: Heredoc[] = [];
  let depth = 0; // how many `(` and `$(` are open: a cd inside is in a subshell
  let atStart = true; // the next word starts a command
  let assigning = false; // inside the value of a `VAR=…` that precedes the command
  let i = 0;
  while (i < n) {
    const c = command[i] ?? '';
    const startsWord = i === 0 || /[\s;&|()]/.test(command[i - 1] ?? '');
    if (BLANK.test(c)) {
      assigning = false;
      i += 1;
    } else if (c === '\n') {
      assigning = false;
      atStart = true;
      i = skipHeredocs(command, i + 1, pending);
    } else if (c === '#' && startsWord) {
      const end = command.indexOf('\n', i);
      i = end === -1 ? n : end;
    } else if (c === "'" || c === '"' || c === '`') {
      const next = closeQuote(command, i);
      if (next === -1) return false;
      i = next;
      if (!assigning) atStart = false;
    } else if (c === '\\') {
      if (command[i + 1] === '\n') i += 2;
      else {
        i += 2;
        if (!assigning) atStart = false;
      }
    } else if (c === '$') {
      if (command[i + 1] === '(') {
        depth += 1;
        atStart = true;
        i += 2;
      } else if (command[i + 1] === '{') {
        const end = command.indexOf('}', i);
        if (end === -1) return false;
        i = end + 1;
        if (!assigning) atStart = false;
      } else {
        i += 2; // `$#`, `$$`, `$?`: the character after is part of the name
        if (!assigning) atStart = false;
      }
    } else if (c === '(') {
      depth += 1;
      atStart = true;
      i += 1;
    } else if (c === ')') {
      // Closing a subshell ends a word; a stray `)` (a `case` pattern) starts a command.
      atStart = depth === 0;
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (c === ';' || c === '|' || c === '&') {
      // `>&2`, `<&3` and `&>file` are redirections, not separators.
      const redirection =
        c === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>');
      if (!redirection) {
        atStart = true;
        assigning = false;
      }
      i += 1;
    } else if (c === '<' || c === '>') {
      if (command.startsWith('<<<', i)) i += 3;
      else if (c === '<' && command.startsWith('<<', i) && depth === 0) {
        const stripTabs = command[i + 2] === '-';
        let from = i + (stripTabs ? 3 : 2);
        while (BLANK.test(command[from] ?? '')) from += 1;
        const { delimiter, next } = readDelimiter(command, from);
        if (delimiter !== '') pending.push({ delimiter, stripTabs });
        i = next;
      } else i += 1;
    } else {
      let end = i;
      while (end < n && !WORD_END.test(command[end] ?? '')) end += 1;
      const word = command.slice(i, end);
      i = end;
      const wholeWord = end >= n || BOUNDARY.test(command[end] ?? '');
      if (atStart && depth === 0) {
        if (wholeWord && CD.has(word)) return true;
        if (wholeWord && word === 'eval') {
          let from = i;
          while (BLANK.test(command[from] ?? '')) from += 1;
          const close = '\'"'.includes(command[from] ?? '#') ? closeQuote(command, from) : -1;
          if (close !== -1 && changesDirectory(command.slice(from + 1, close - 1))) return true;
        }
        if (wholeWord && PASSES.has(word)) continue;
        if (ASSIGNMENT.test(word)) {
          assigning = !wholeWord;
          continue;
        }
      }
      atStart = false;
    }
  }
  return false;
}
