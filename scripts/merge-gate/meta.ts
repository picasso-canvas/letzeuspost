import { join } from 'node:path';

/**
 * Where Claude Code keeps the transcript of a session started from `root` (`~/.claude/projects/<root with every
 * non-alphanumeric character as "-">/<session>.jsonl`).
 */
export function transcriptPath(home: string, root: string, sessionId: string): string {
  if (!/^[0-9a-f][0-9a-f-]{2,63}$/i.test(sessionId))
    throw new Error(`bad session id: ${sessionId}`);
  return join(
    home,
    '.claude',
    'projects',
    root.replace(/[^a-zA-Z0-9]/g, '-'),
    `${sessionId}.jsonl`,
  );
}

/**
 * A review counts only if Claude Code really ran it: the session's transcript exists, its agent is the reviewer's,
 * and its prompt names this bundle. Returns why not, or null.
 */
export function checkTranscript(text: string | null, agent: string, bundle: string): string | null {
  if (text === null) return 'no Claude Code transcript for that session';
  let setting: string | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const entry = JSON.parse(line) as { type?: unknown; agentSetting?: unknown };
      if (entry.type === 'agent-setting' && typeof entry.agentSetting === 'string') {
        setting = entry.agentSetting;
        break;
      }
    } catch {
      // not JSON: skip
    }
  }
  if (setting !== agent) return `the session's agent is ${String(setting)}, not ${agent}`;
  if (!text.includes(`${bundle}/`)) return 'the session did not review this bundle';
  return null;
}
