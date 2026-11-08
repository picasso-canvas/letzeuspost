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

/** Text for the guardrail log: secret shapes and credential-looking values replaced. */
export function redact(text: string): string {
  let out = text;
  for (const { pattern } of SECRET_PATTERNS)
    out = out.replace(new RegExp(pattern, 'g'), '[redacted]');
  // `Authorization: Bearer <token>`: the scheme word is kept and the value after it redacted, not the scheme itself.
  return out.replace(
    /\b(authorization|bearer|token|password|passwd|secret|api[_-]?key)(\s*[:=]\s*|\s+)(["']?)((?:bearer|basic|token)\s+)?[^\s"']{6,}/gi,
    '$1$2$3$4[redacted]',
  );
}

const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/i;

/** A line split into its code (string contents blanked) and its comment text, so quotes never count as either. */
function splitLine(line: string): { code: string; comment: string } {
  let quote: string | null = null;
  let code = '';
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quote !== null) {
      if (c === '\\') {
        code += '  ';
        i++;
      } else if (c === quote) {
        quote = null;
        code += c;
      } else code += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      code += c;
      continue;
    }
    const next = line.charAt(i + 1);
    if (c === '/' && (next === '/' || next === '*')) {
      return {
        code,
        comment: line
          .slice(i + 2)
          .replace(/\*\/\s*$/, '')
          .trim(),
      };
    }
    code += c;
  }
  return { code, comment: '' };
}

/** A comment line just above: `// why`, or a line inside a block comment (`* why`). */
function commentAbove(prev: string): string {
  const { code, comment } = splitLine(prev);
  if (code.trim() === '') return comment;
  return /^\s*\*\s?/.test(prev) ? prev.replace(/^\s*\*\s?/, '').trim() : '';
}

interface Directive {
  id: string;
  /** null: never acceptable, whatever the comment says. */
  explained: ((comment: string, above: string) => boolean) | null;
  find: (code: string, comment: string) => boolean;
}

const DIRECTIVES: readonly Directive[] = [
  {
    // ESLint's own reason syntax: `// eslint-disable-next-line rule -- why`
    id: 'eslint-disable',
    find: (_code, comment) => /\beslint-disable(?:-next-line|-line)?\b/.test(comment),
    explained: (comment) => /\beslint-disable\S*.*?\s--\s+\S.{8,}/.test(comment),
  },
  {
    // TypeScript allows text after the directive: `// @ts-expect-error: the lib's types miss this overload`
    id: 'ts-directive',
    find: (_code, comment) => /@ts-(?:ignore|nocheck|expect-error)\b/.test(comment),
    explained: (comment) => /@ts-(?:ignore|nocheck|expect-error)\b[\s:—-]*\S.{9,}/.test(comment),
  },
  {
    id: 'test-skip',
    find: (code) =>
      /\b(?:describe|it|test|suite|bench)(?:\.\w+)*\.(?:skip|skipIf|runIf)\b|\b(?:xit|xdescribe|xtest)\s*\(/.test(
        code,
      ),
    explained: (comment, above) => comment.length >= 10 || above.length >= 10,
  },
  {
    // A focused test silently skips every other test: never committed (§20 red team).
    id: 'test-only',
    find: (code) =>
      /\b(?:describe|it|test|suite|bench)(?:\.\w+)*\.only\b|\b(?:fit|fdescribe|ftest)\s*\(/.test(
        code,
      ),
    explained: null,
  },
];

function unexplainedDirectives(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const { code, comment } = splitLine(line);
    const above = commentAbove(lines[i - 1] ?? '');
    for (const d of DIRECTIVES) {
      if (d.find(code, comment) && !(d.explained?.(comment, above) ?? false)) {
        counts.set(d.id, (counts.get(d.id) ?? 0) + 1);
      }
    }
  });
  return counts;
}

const THRESHOLD =
  /\b(lines|functions|branches|statements|perFile)\s*:\s*(-?\d+(?:\.\d+)?|true|false)/;

function thresholds(text: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(THRESHOLD, 'g')))
    if (m[1] && m[2]) found.set(m[1], m[2]);
  return found;
}

/** Every threshold line in `after` carries a comment of at least 10 characters. */
function thresholdsExplained(after: string): boolean {
  const lines = after.split('\n').filter((line) => THRESHOLD.test(line));
  return lines.length > 0 && lines.every((line) => splitLine(line).comment.length >= 10);
}

function loweredThreshold(before: string, after: string): string | null {
  if (/thresholds/.test(before) && !/thresholds/.test(after)) return 'coverage thresholds removed';
  const old = thresholds(before);
  const now = thresholds(after);
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
 * Silencing introduced by this change: more unexplained directives after than before, a focused test, or a lowered
 * coverage threshold. `before` is the text being replaced (Edit's old_string, or the whole file for Write);
 * `fileText` is the file as it is now, which says whether it holds coverage settings at all.
 */
export function findSilencing(
  file: string,
  before: string,
  after: string,
  fileText = '',
): ContentHit | null {
  const coverageFile =
    /(?:^|\/)(?:vitest|vite|jest)\.config\.|(?:^|\/)coverage/i.test(file) ||
    /thresholds/.test(fileText + before);
  if (coverageFile) {
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
          id === 'test-only'
            ? 'adds a focused test (.only / fit), which silently skips every other test; remove it'
            : `adds ${id} without a reason; write why on the same line ` +
              '(`// eslint-disable-next-line rule -- why`, `// @ts-expect-error: why`, or a comment above a .skip), ' +
              'or fix the code instead',
      };
    }
  }
  return null;
}
