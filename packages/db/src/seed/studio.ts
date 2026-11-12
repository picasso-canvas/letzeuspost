// `pnpm --filter @lzp/db seed:studio`: the studio's workspace, "Picasso Studio", with Zeus as its only Owner and the
// platform-admin flag (#79, Q14). His address and name are typed in when it runs (or given as `--email` and `--name`),
// never stored in the repository. Runs as the owner role (DATABASE_OWNER_URL, config/env.ts's `seed` process). A
// second run changes nothing.
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { loadEnv } from '@lzp/config';
import { runSeed } from './run.ts';
import { studioSeed } from './seed.ts';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
});

/** A value given on the command line, or typed in at the prompt. */
async function ask(given: string | undefined, question: string): Promise<string> {
  if (given !== undefined) return given;
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return await prompt.question(question);
  } finally {
    prompt.close();
  }
}

const { DATABASE_OWNER_URL } = loadEnv('seed');
const seed = studioSeed({
  email: await ask(values.email, 'Zeus’s email: '),
  name: await ask(values.name, 'Zeus’s name: '),
});
const { changed } = await runSeed(DATABASE_OWNER_URL, seed);
// The address isn't printed: §13 keeps emails out of logs.
console.log(
  changed
    ? `${seed.workspace.name} is ready, with its Owner.`
    : `${seed.workspace.name} was already there: nothing changed.`,
);
