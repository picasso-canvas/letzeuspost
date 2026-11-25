// The Picasso instance's compose file (#81): its promises, as text checks (no Docker, no YAML parser).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { processSettings } from '../config/env.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const picasso = read('../docker/compose.picasso.yml');
const dev = read('../docker/compose.yml');

/** The lines of one service under `services:` (from its two-space heading to the next one). */
function service(text: string, name: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) throw new Error(`no service ${name}`);
  const end = lines.findIndex((line, i) => i > start && /^( {0,2})\S/.test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/** The names under a service's `environment:`. */
function envNames(block: string): string[] {
  const after = block.split('    environment:\n')[1] ?? '';
  return [...after.matchAll(/^ {6}([A-Z_]+):/gm)].map((m) => m[1] ?? '');
}

describe('docker/compose.picasso.yml', () => {
  it('is its own project, so its volumes and containers are apart from dev:up', () => {
    expect(picasso).toMatch(/^name: letzeuspost-picasso$/m);
    expect(dev).toMatch(/^name: letzeuspost$/m);
  });

  it('publishes no host port', () => {
    expect(picasso).not.toMatch(/^\s*ports:/m);
    expect(picasso).not.toMatch(/network_mode|network:\s*host/);
  });

  it('runs the same pinned database, storage and mail images as the dev file', () => {
    for (const name of ['postgres', 'storage', 'mail']) {
      const image = (text: string) =>
        /image: (\S+@sha256:[0-9a-f]{64})/.exec(service(text, name))?.[1];
      expect(image(picasso)).toBeDefined();
      expect(image(picasso)).toBe(image(dev));
    }
  });

  it('gives web and worker exactly the settings config/env.ts lists for them (the deployment id from the image tag)', () => {
    const web = envNames(service(picasso, 'web'));
    expect(web.sort()).toEqual([...processSettings.web].sort());
    expect(service(picasso, 'web')).toContain('NEXT_DEPLOYMENT_ID: ${LZP_IMAGE_TAG}');
    expect(envNames(service(picasso, 'worker')).sort()).toEqual([...processSettings.worker].sort());
  });

  it("hands the owner role's url to migrate and seed only", () => {
    for (const name of ['web', 'worker', 'postgres', 'storage', 'mail']) {
      expect(service(picasso, name)).not.toContain('DATABASE_OWNER_URL');
    }
    for (const name of ['migrate', 'seed']) {
      expect(envNames(service(picasso, name)).sort()).toEqual([...processSettings.migrate].sort());
    }
  });

  it('has no env_file, which would hand every secret to every container', () => {
    expect(picasso).not.toMatch(/^\s*env_file:/m);
  });

  it('builds nothing itself: the images come from `scripts/picasso.ts deploy`', () => {
    expect(picasso).not.toMatch(/^\s*build:/m);
  });
});

describe("the worker's Chromium sandbox (#383)", () => {
  const profile = JSON.parse(read('../docker/seccomp/worker-chromium.json')) as {
    defaultAction: string;
    syscalls: { names: string[]; action: string }[];
  };
  const refused = profile.syscalls
    .filter((rule) => rule.action === 'SCMP_ACT_ERRNO')
    .flatMap((rule) => rule.names);

  it('starts the worker under that profile, with no capability and no new privileges', () => {
    const worker = service(picasso, 'worker');
    expect(worker).toContain('seccomp=./seccomp/worker-chromium.json');
    expect(worker).toContain('no-new-privileges:true');
    expect(worker).toMatch(/cap_drop: \[ALL\]/);
    expect(worker).not.toMatch(/^\s+(cap_add|privileged):|seccomp=unconfined|apparmor=unconfined/m);
  });

  it("lets the sandbox make user namespaces but refuses the calls Docker's default profile refuses", () => {
    expect(profile.defaultAction).toBe('SCMP_ACT_ALLOW');
    for (const needed of ['clone', 'clone3', 'unshare', 'prctl', 'seccomp']) {
      expect(refused).not.toContain(needed);
    }
    for (const never of [
      'ptrace',
      'mount',
      'umount2',
      'pivot_root',
      'bpf',
      'setns',
      'kexec_load',
      'init_module',
      'finit_module',
      'perf_event_open',
      'keyctl',
      'process_vm_readv',
      'process_vm_writev',
      'userfaultfd',
      'reboot',
      'swapon',
      'io_uring_setup',
      'io_uring_enter',
      'io_uring_register',
      'pidfd_getfd',
      'process_madvise',
    ]) {
      expect(refused).toContain(never);
    }
  });

  it('runs the image as the non-root node user, with Chromium kept where only root can write', () => {
    const dockerfile = read('../apps/worker/Dockerfile');
    const last = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
    expect(last).toMatch(/^USER node$/m);
    expect(last).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(last.indexOf('install --with-deps chromium')).toBeLessThan(last.indexOf('USER node'));
  });
});

describe('the deploy order (#383)', () => {
  const source = read('./picasso.ts');
  const at = (text: string) => source.indexOf(text);

  it('builds the worker image, then checks its sandbox, and only then swaps any container', () => {
    expect(at('sandboxCheckArgs(')).toBeGreaterThan(at("'apps/worker/Dockerfile'"));
    expect(at('sandboxCheckArgs(')).toBeLessThan(at("'up', '--detach', '--wait', 'postgres'"));
    expect(at('sandboxCheckArgs(')).toBeLessThan(at('writeFileSync(deployed, `LZP_IMAGE_TAG'));
  });
});
