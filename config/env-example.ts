// Writes env.example from config/env.ts (§13 Environments): one short note per setting, no values. Run it after
// changing a setting:
//   node config/env-example.ts
// env-example.test.ts fails while the committed env.example is out of date.
import { writeFileSync } from 'node:fs';
import { processSettings, settings } from './env.ts';

const HEADER = [
  '# LetZeusPost settings, generated from config/env.ts by `node config/env-example.ts`: do not edit by hand.',
  '# Copy to .env and fill in locally (this template has no leading dot so agents may read it); .env is never',
  '# committed or read by agents. Each process reads only the settings marked with its name (§13, §14) and stops',
  '# at startup when one of them is missing or malformed.',
];

/** The processes that read a setting, in the order `processSettings` lists them. */
function readersOf(name: string): string {
  return Object.entries(processSettings)
    .filter(([, names]) => names.some((setting) => setting === name))
    .map(([processName]) => processName)
    .join(', ');
}

export function renderEnvExample(): string {
  const lines = [...HEADER];
  let group = '';
  for (const [name, setting] of Object.entries(settings)) {
    if (setting.group !== group) {
      group = setting.group;
      lines.push('', `# ${group}`);
    }
    lines.push(`# ${setting.note}: ${setting.expects}. Read by ${readersOf(name)}.`, `${name}=`);
  }
  return `${lines.join('\n')}\n`;
}

if (import.meta.main) {
  writeFileSync(new URL('../env.example', import.meta.url), renderEnvExample());
}
