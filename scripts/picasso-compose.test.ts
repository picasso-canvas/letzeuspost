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
