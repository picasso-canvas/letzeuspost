// The worker's log: one JSON line per event on stdout. No post text or emails in logs (§13 Security summary): callers
// pass ids and codes only, and anything shaped like an email address is masked anyway, as a second wall.
export type LogFields = Readonly<Record<string, string | number | boolean | undefined>>;
export type Log = (event: string, fields?: LogFields) => void;

const ADDRESS = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;

function mask(value: string | number | boolean | undefined): string | number | boolean | undefined {
  return typeof value === 'string' ? value.replace(ADDRESS, '[address]') : value;
}

export const log: Log = (event, fields = {}) => {
  const line: Record<string, unknown> = { at: new Date().toISOString(), event: mask(event) };
  for (const [key, value] of Object.entries(fields)) line[key] = mask(value);
  process.stdout.write(`${JSON.stringify(line)}\n`);
};
