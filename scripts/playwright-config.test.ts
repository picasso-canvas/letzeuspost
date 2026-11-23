import { describe, expect, it } from 'vitest';
import config from '../playwright.config.ts';

// §21 (#129): "any changed pixel fails". Playwright's defaults (a colour threshold of 0.2) would let a small colour
// regression pass, so the config must name both limits and keep them at zero.
describe('the screenshot comparison in playwright.config.ts', () => {
  const compare = config.expect?.toHaveScreenshot;

  it('names its limits instead of leaving Playwright’s defaults', () => {
    expect(compare).toBeDefined();
  });

  it('accepts no per-pixel colour difference', () => {
    expect(compare?.threshold).toBe(0);
  });

  it('accepts no differing pixel', () => {
    expect(compare?.maxDiffPixels).toBe(0);
  });

  it('sets no looser limit another way', () => {
    expect(compare?.maxDiffPixelRatio).toBeUndefined();
  });

  it('has no project that loosens it', () => {
    for (const project of config.projects ?? [])
      expect(project.expect?.toHaveScreenshot, `project ${String(project.name)}`).toBeUndefined();
  });
});

// A run empties the output folder of every project it runs, and CI collects the end-to-end screens from the shared
// one (Q11): the render and golden projects, which run in a later step, must not share it (Cerberus F1 on #343).
describe('the output folders in playwright.config.ts', () => {
  const shared = config.outputDir;
  const own = (name: string) => config.projects?.find((p) => p.name === name)?.outputDir;

  it('give the render and golden projects folders of their own', () => {
    expect(own('render')).toBeDefined();
    expect(own('golden')).toBeDefined();
    expect(own('render')).not.toBe(shared);
    expect(own('golden')).not.toBe(shared);
    expect(own('render')).not.toBe(own('golden'));
  });

  // The projects that write to the shared folder (the screens Iris and Zeus approve) are the ones the end-to-end step
  // runs; any other project must have a folder of its own, different from every other project's (Cerberus F2 on #343).
  const sharing = ['gallery', 'app-light', 'app-dark', 'journeys'];

  it('give every other project a folder of its own, different from the rest', () => {
    const others = (config.projects ?? []).filter((p) => !sharing.includes(p.name ?? ''));
    const folders = others.map((p) => p.outputDir);
    expect(folders.every((folder) => folder !== undefined && folder !== shared)).toBe(true);
    expect(new Set(folders).size).toBe(folders.length);
  });
});
