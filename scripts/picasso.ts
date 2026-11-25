#!/usr/bin/env node
// Picasso's instance on Zeus's Mac (§18, #81), for a person at the Mac, not for builders (they have no Docker).
//   node scripts/picasso.ts init                      create the instance's folder and .env (secrets are generated, never printed)
//   node scripts/picasso.ts deploy <main commit>      build that commit's images and update the instance (needs Zeus's yes)
//   node scripts/picasso.ts seed [--email e --name n] create "Picasso Studio" with Zeus as Owner (typed in when run)
//   node scripts/picasso.ts status                    what is running
//   node scripts/picasso.ts backup | restore-test     the nightly dump, and the restore into a scratch database
//   node scripts/picasso.ts install-backup            run the backup every night at 03:00 (launchd)
// The folder (~/letzeuspost-picasso, or LZP_PICASSO_DIR) holds .env, deployed.env, deploys.log, backups/ and the compose
// files of the deployed commit; it lies outside every checkout and builder clone.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env.ts';
import { isEntryPoint } from './lib/entry.ts';
import { parseEnvFile } from './lib/dev-env.ts';
import {
  APP_URL,
  approvalProblem,
  checksProblem,
  type Comment,
  sandboxCheckArgs,
  xmlText,
  commentId,
  dirProblem,
  imageTag,
  instanceDir,
  type CheckRun,
  type MergedPull,
  mergedHead,
  parseDeployArgs,
  PROJECT,
  picassoEnvText,
} from './lib/picasso.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const BUILDERS_DIR = join(homedir(), 'letzeuspost-builders');
const PLIST = join(homedir(), 'Library', 'LaunchAgents', 'com.letzeuspost.picasso-backup.plist');

function dir(): string {
  const path = instanceDir(process.env);
  const problem = dirProblem(path, root, BUILDERS_DIR);
  if (problem !== undefined) throw new Error(problem);
  return path;
}

function out(command: string, args: string[], cwd = root): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.slice(0, 3).join(' ')} failed: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  return result.stdout.trim();
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = root,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 4).join(' ')} failed`);
}

/** Asks at the terminal itself (not stdin), so a pipe can't answer for Zeus. */
function askAtTerminal(question: string): string | undefined {
  let tty: number;
  try {
    tty = openSync('/dev/tty', 'r+');
  } catch {
    return undefined;
  }
  writeFileSync(tty, question);
  const buffer = Buffer.alloc(256);
  try {
    const read = readSync(tty, buffer, 0, buffer.length, null);
    return buffer.subarray(0, read).toString('utf8').trim();
  } catch {
    return undefined; // the terminal gave nothing to read: the same as no terminal
  }
}

const composeArgs = (folder: string, extra: string[] = []) => [
  'compose',
  '--file',
  join(folder, 'current', 'docker', 'compose.picasso.yml'),
  '--env-file',
  join(folder, '.env'),
  '--env-file',
  join(folder, 'deployed.env'),
  ...extra,
];

function init(): void {
  const folder = dir();
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const envFile = join(folder, '.env');
  if (existsSync(envFile)) {
    console.log(`${envFile} is already there: left as it is.`);
  } else {
    writeFileSync(envFile, picassoEnvText(randomBytes), { mode: 0o600 });
    console.log(`Wrote ${envFile} with fresh secrets (mode 600; it stays on this machine).`);
  }
  console.log(`The app will be at ${APP_URL}. Next: node scripts/picasso.ts deploy <main commit>`);
}

/** The `.env` with the deployment id the compose file adds from the image tag, checked as each process reads it. */
function checkedEnv(folder: string, tag: string): Record<string, string> {
  const env = {
    ...parseEnvFile(readFileSync(join(folder, '.env'), 'utf8')),
    NEXT_DEPLOYMENT_ID: tag,
  };
  for (const name of ['web', 'worker', 'migrate', 'seed'] as const) loadEnv(name, env);
  return env;
}

function deploy(argv: string[]): void {
  const args = parseDeployArgs(argv);
  if (typeof args === 'string') throw new Error(args);
  const folder = dir();
  if (!existsSync(join(folder, '.env')))
    throw new Error('No .env yet: run `node scripts/picasso.ts init` first.');

  out('git', ['fetch', '--quiet', 'origin', 'main']);
  const commit = out('git', ['rev-parse', '--verify', `${args.commit}^{commit}`]);
  if (
    spawnSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], { cwd: root })
      .status !== 0
  ) {
    throw new Error(`${commit.slice(0, 12)} is not on main: only a main commit is deployed.`);
  }
  // The checks live on the pull request that merged the commit (the workflows run on pull requests only).
  const pulls = out('gh', [
    'api',
    '--paginate',
    `repos/{owner}/{repo}/commits/${commit}/pulls`,
    '--jq',
    '.[] | {number, merge_commit_sha, merged_at, head: {sha: .head.sha}, base: {ref: .base.ref}}',
  ])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as MergedPull);
  const pull = mergedHead(pulls, commit);
  if (pull === undefined) {
    throw new Error(
      `Refusing ${commit.slice(0, 12)}: no merged pull request into main produced it, so no checks show it is green.`,
    );
  }
  const runs = out('gh', [
    'api',
    '--paginate',
    `repos/{owner}/{repo}/commits/${pull.head.sha}/check-runs`,
    '--jq',
    '.check_runs[] | {name, status, conclusion}',
  ])
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as CheckRun);
  const gate = JSON.parse(out('git', ['show', 'origin/main:.github/merge-gate.json'])) as {
    requiredChecks: string[];
  };
  const problem = checksProblem(runs, gate.requiredChecks);
  if (problem !== undefined)
    throw new Error(`Refusing ${commit.slice(0, 12)} (PR #${String(pull.number)}): ${problem}.`);

  const subject = out('git', ['log', '-1', '--format=%s', commit]);
  let approvedBy: string;
  if (args.zeusOk !== undefined) {
    // Zeus's yes counts only as a posted record (§19 #116), checked here: a string typed on the command line isn't one.
    const repo = out('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
    const comment = JSON.parse(
      out('gh', ['api', `repos/${repo}/issues/comments/${commentId(args.zeusOk) ?? ''}`]),
    ) as Comment;
    const login = out('gh', ['api', 'user', '--jq', '.login']);
    const committedAt = out('git', ['log', '-1', '--format=%cI', commit]);
    const refused = approvalProblem(comment, commit, committedAt, login, repo);
    if (refused !== undefined) throw new Error(`Not deployed: ${refused}.`);
    approvedBy = comment.html_url;
  } else {
    const answer = askAtTerminal(
      `Deploy ${commit.slice(0, 12)} (${subject}) to Picasso's instance? Type yes: `,
    );
    if (answer === undefined) {
      throw new Error(
        'No terminal to ask Zeus at: run this in Terminal, or pass --zeus-ok <the URL of the comment that records his yes>.',
      );
    }
    if (answer.toLowerCase() !== 'yes') throw new Error('Not deployed: Zeus did not say yes.');
    approvedBy = 'yes, typed at the terminal';
  }

  const tag = imageTag(commit);
  const env = checkedEnv(folder, tag);
  const source = mkdtempSync(join(tmpdir(), 'lzp-picasso-'));
  try {
    run('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', commit, source]);
    const buildEnv = {
      ...process.env,
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ?? '',
    };
    run(
      'docker',
      [
        'build',
        '--file',
        'apps/web/Dockerfile',
        '--tag',
        `lzp-picasso-web:${tag}`,
        '--build-arg',
        `NEXT_DEPLOYMENT_ID=${tag}`,
        '--secret',
        'id=next_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
        '.',
      ],
      buildEnv,
      source,
    );
    run(
      'docker',
      ['build', '--file', 'apps/worker/Dockerfile', '--tag', `lzp-picasso-worker:${tag}`, '.'],
      process.env,
      source,
    );

    // Chromium's sandbox must work in the image as the worker runs it (non-root, the seccomp profile, no capability),
    // or the deploy stops here, before any container is swapped (#383, §08 Security).
    run('docker', sandboxCheckArgs(tag, join(source, 'docker', 'seccomp', 'worker-chromium.json')));

    // The compose file and the scripts its services mount are kept with the instance: a restart must not depend on a
    // checkout, which may be on any branch.
    const current = join(folder, 'current');
    rmSync(current, { recursive: true, force: true });
    mkdirSync(join(current, 'docker'), { recursive: true });
    run('cp', ['-R', join(source, 'docker', '.'), join(current, 'docker')]);
  } finally {
    rmSync(source, { recursive: true, force: true });
  }

  const deployed = join(folder, 'deployed.env');
  const previous = existsSync(deployed) ? readFileSync(deployed, 'utf8') : '';
  writeFileSync(deployed, `LZP_IMAGE_TAG=${tag}\n`, { mode: 0o600 });
  try {
    run('docker', composeArgs(folder, ['up', '--detach', '--wait', 'postgres', 'storage', 'mail']));
    run('docker', composeArgs(folder, ['run', '--rm', 'migrate']));
    run(
      'docker',
      composeArgs(folder, ['up', '--detach', '--wait', '--remove-orphans', 'web', 'worker']),
    );
  } catch (error) {
    // The migrations only go forward and a web or worker may already run the new tag, so put the old tag back and start
    // the old images again (best effort); the instance is then on the old commit, or needs a redeploy.
    if (previous !== '') {
      writeFileSync(deployed, previous, { mode: 0o600 });
      spawnSync('docker', composeArgs(folder, ['up', '--detach', '--wait', 'web', 'worker']), {
        stdio: 'inherit',
      });
      console.error(
        'The deploy failed: the previous images were started again. See the output above.',
      );
    } else {
      console.error('The deploy failed on the first deploy: run it again.');
    }
    throw error;
  }
  appendFileSync(
    join(folder, 'deploys.log'),
    `${new Date().toISOString()} ${commit} deployed; Zeus: ${approvedBy.replaceAll('\n', ' ')}\n`,
  );
  console.log(`Deployed ${commit.slice(0, 12)}: ${APP_URL}`);
}

function seed(argv: string[]): void {
  const folder = dir();
  const deployed = parseEnvFile(readFileSync(join(folder, 'deployed.env'), 'utf8'));
  checkedEnv(folder, deployed.LZP_IMAGE_TAG ?? '');
  const interactive = process.stdin.isTTY ? [] : ['--no-TTY']; // a terminal gets the prompt; a pipe doesn't
  run(
    'docker',
    composeArgs(folder, [
      'run',
      '--rm',
      ...interactive,
      'seed',
      'node',
      'packages/db/src/seed/studio.ts',
      ...argv,
    ]),
  );
}

function installBackup(): void {
  const folder = dir();
  mkdirSync(join(folder, 'bin'), { recursive: true, mode: 0o700 });
  const script = join(folder, 'bin', 'picasso-backup.ts');
  // From main, not from whatever branch this checkout is on: the nightly job runs this copy.
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  writeFileSync(script, out('git', ['show', 'origin/main:scripts/picasso-backup.ts']), {
    mode: 0o600,
  });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.letzeuspost.picasso-backup</string>
  <key>ProgramArguments</key><array><string>${xmlText(process.execPath)}</string><string>${xmlText(script)}</string><string>backup</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>LZP_PICASSO_DIR</key><string>${xmlText(folder)}</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${xmlText(join(folder, 'backup.log'))}</string>
  <key>StandardErrorPath</key><string>${xmlText(join(folder, 'backup.log'))}</string>
</dict></plist>
`;
  writeFileSync(PLIST, plist);
  spawnSync('launchctl', ['bootout', `gui/${String(process.getuid?.() ?? 501)}`, PLIST], {
    stdio: 'ignore',
  });
  run('launchctl', ['bootstrap', `gui/${String(process.getuid?.() ?? 501)}`, PLIST]);
  console.log(
    `Nightly backup at 03:00: ${PLIST} (log: ${join(folder, 'backup.log')}). The Mac must be awake then; launchd runs a missed job on wake.`,
  );
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0 && command !== 'init') {
    throw new Error('Docker is not running: start OrbStack, then run this again.');
  }
  switch (command) {
    case 'init':
      init();
      return;
    case 'deploy':
      deploy(rest);
      return;
    case 'seed':
      seed(rest);
      return;
    case 'status':
      run('docker', composeArgs(dir(), ['ps', '--all']));
      return;
    case 'backup':
    case 'restore-test':
      run(process.execPath, [join(root, 'scripts', 'picasso-backup.ts'), command], {
        ...process.env,
        LZP_PICASSO_DIR: dir(),
      });
      return;
    case 'install-backup':
      installBackup();
      return;
    default:
      throw new Error(
        `Usage: node scripts/picasso.ts init | deploy <main commit> | seed | status | backup | restore-test | install-backup (project ${PROJECT})`,
      );
  }
}

if (isEntryPoint(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
