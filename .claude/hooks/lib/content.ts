// PreToolUse Edit/Write, for everyone: content that looks like a secret, and checks being silenced without a reason.

export interface ContentHit {
  id: string;
  reason: string;
}

// High-precision shapes only: a false alarm here blocks honest work. gitleaks in CI is the wider net.
const SECRET_PATTERNS: readonly { id: string; pattern: RegExp }[] = [
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY( BLOCK)?-----/,
  },
  { id: 'anthropic-key', pattern: /\bsk-ant-[a-z0-9]{2,8}-[A-Za-z0-9_-]{30,}/ },
  {
    id: 'openai-key',
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/,
  },
  { id: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/ },
  { id: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'slack-token', pattern: /\bxox[abposr]-[0-9A-Za-z-]{10,}/ },
  { id: 'stripe-live-key', pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/ },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'paddle-key', pattern: /\bpdl_live_apikey_[0-9A-Za-z_]{20,}/ },
];

export function findSecret(text: string): ContentHit | null {
  for (const { id, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      return {
        id: `secret:${id}`,
        reason: `this looks like a secret (${id}); secrets live only in local .env files, never in the repo`,
      };
    }
  }
  return null;
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/i;

/** A comment with at least `min` characters of text, on the line or (for tests) the line above. */
function commentText(line: string): string {
  const m = /(?:\/\/|\/\*)(.*?)(?:\*\/)?\s*$/.exec(line);
  return (m?.[1] ?? '').trim();
}

const DIRECTIVES: readonly {
  id: string;
  find: RegExp;
  explained: (line: string, prev: string) => boolean;
}[] = [
  {
    // ESLint's own reason syntax: `// eslint-disable-next-line rule -- why`
    id: 'eslint-disable',
    find: /eslint-disable(?:-next-line|-line)?\b/,
    explained: (line) => /eslint-disable\S*[^\n]*?\s--\s+\S.{8,}/.test(line),
  },
  {
    // TypeScript allows text after the directive: `// @ts-expect-error: the lib's types miss this overload`
    id: 'ts-directive',
    find: /@ts-(?:ignore|nocheck|expect-error)\b/,
    explained: (line) => /@ts-(?:ignore|nocheck|expect-error)\b[\s:—-]*\S.{9,}/.test(line),
  },
  {
    id: 'test-skip-only',
    find: /\b(?:describe|it|test|suite|bench)(?:\.\w+)*\.(?:skip|only|skipIf|runIf)\b|\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/,
    explained: (line, prev) => {
      const same = commentText(line);
      const above = /^\s*(?:\/\/|\/\*|\*)/.test(prev)
        ? commentText(prev) || prev.replace(/^\s*\*\s?/, '').trim()
        : '';
      return same.length >= 10 || above.length >= 10;
    },
  },
];

function unexplainedDirectives(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const d of DIRECTIVES) {
      if (d.find.test(line) && !d.explained(line, lines[i - 1] ?? ''))
        counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
    }
  });
  return counts;
}

const THRESHOLD =
  /\b(lines|functions|branches|statements|perFile)\s*:\s*(-?\d+(?:\.\d+)?|true|false)/;

function thresholds(text: string): Map<string, string> {
  const found = new Map<string, string>();
  if (!/thresholds|coverage/.test(text)) return found;
  for (const m of text.matchAll(new RegExp(THRESHOLD, 'g')))
    if (m[1] && m[2]) found.set(m[1], m[2]);
  return found;
}

/** Every threshold line in `after` carries a comment of at least 10 characters. */
function thresholdsExplained(after: string): boolean {
  const lines = after.split('\n').filter((line) => THRESHOLD.test(line));
  return lines.length > 0 && lines.every((line) => commentText(line).length >= 10);
}

function loweredThreshold(before: string, after: string): string | null {
  const old = thresholds(before);
  const now = thresholds(after);
  if (/thresholds/.test(before) && !/thresholds/.test(after)) return 'coverage thresholds removed';
  for (const [key, value] of old) {
    const next = now.get(key);
    if (next === undefined) continue;
    const a = Number(value);
    const b = Number(next);
    if (!Number.isNaN(a) && !Number.isNaN(b) && b < a)
      return `coverage threshold ${key} lowered from ${value} to ${next}`;
  }
  return null;
}

/**
 * Silencing introduced by this change: more unexplained directives after than before, or a lowered coverage
 * threshold. `before` is the text being replaced (Edit's old_string, or the file's current content for Write).
 */
export function findSilencing(file: string, before: string, after: string): ContentHit | null {
  if (/vitest\.config\.|vite\.config\.|coverage/i.test(file) || /thresholds/.test(before)) {
    const lowered = loweredThreshold(before, after);
    if (lowered && !thresholdsExplained(after)) {
      return {
        id: 'silence:coverage',
        reason: `${lowered}; explain why in a comment on that line, or don't`,
      };
    }
  }
  if (!CODE_FILE.test(file)) return null;
  const old = unexplainedDirectives(before);
  for (const [id, count] of unexplainedDirectives(after)) {
    if (count > (old.get(id) ?? 0)) {
      return {
        id: `silence:${id}`,
        reason:
          `adds ${id} without a reason; write why on the same line ` +
          '(`// eslint-disable-next-line rule -- why`, `// @ts-expect-error: why`, or a comment above a .skip), ' +
          'or fix the code instead',
      };
    }
  }
  return null;
}
