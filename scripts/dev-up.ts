#!/usr/bin/env node
// The whole local app in one command (#311), for a person at a Mac, not for builders (they have no Docker).
//   pnpm dev:up            start the services, migrate, seed Northwind Social, then run web and worker until Ctrl-C
//   pnpm dev:up --down     stop the services (the data stays); add --reset to delete the data as well
// It writes `.env` (mode 600, never committed) with fresh secrets the first time, and never prints a value from it.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/entry.ts';
import { checkEnv, devEnvText, parseEnvFile, WEB_PORT, webDevArgs } from './lib/dev-env.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const COMPOSE = ['compose', '-f', 'docker/compose.yml', '--env-file', '.env'];

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed`);
}

function main(argv: string[]): void {
  const envFile = join(root, '.env');
  // Docker first: a machine without it (a builder's clone) gets the message and no `.env`.
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    throw new Error(
      'Docker is not running: start Docker Desktop or OrbStack, then run this again.',
    );
  }
  if (argv.includes('--down')) {
    if (existsSync(envFile)) {
      run('docker', [...COMPOSE, 'down', ...(argv.includes('--reset') ? ['--volumes'] : [])]);
    } else {
      console.log('Nothing to stop: there is no .env, so dev:up never ran here.');
    }
    return;
  }
  if (!existsSync(envFile)) {
    writeFileSync(envFile, devEnvText(randomBytes), { mode: 0o600 });
    console.log('Wrote .env with fresh local secrets (it stays on this machine).');
  }
  const fileEnv = parseEnvFile(readFileSync(envFile, 'utf8'));
  const problems = checkEnv(fileEnv);
  if (problems.length > 0) {
    throw new Error(
      `${problems.join('\n')}\nThe .env here is out of date: delete it and run this again.`,
    );
  }
  const env = { ...process.env, ...fileEnv };
  run('docker', [...COMPOSE, 'up', '--detach', '--wait']);
  run('pnpm', ['--filter', '@lzp/db', 'migrate'], env);
  run('pnpm', ['--filter', '@lzp/db', 'seed:dev'], env);

  const children: ChildProcess[] = [
    spawn('pnpm', ['--filter', '@lzp/worker', 'start'], { cwd: root, env, stdio: 'inherit' }),
    spawn('pnpm', webDevArgs(), { cwd: root, env, stdio: 'inherit' }),
  ];
  let stopping = false;
  const stop = () => {
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  for (const child of children) {
    child.on('exit', (code) => {
      // A child that stops on its own with an error fails the command too; Ctrl-C is a normal stop.
      if (!stopping && code !== 0) process.exitCode = code ?? 1;
      stop();
    });
  }
  console.log(
    [
      '',
      `App:     http://localhost:${String(WEB_PORT)}  (sign in as nadia@northwind.invalid)`,
      'Email:   http://localhost:8025  (the sign-in link arrives here)',
      'Stop:    Ctrl-C here, then `pnpm dev:up --down` to stop the services.',
    ].join('\n'),
  );
}

if (isEntryPoint(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
