// The numbers the render benchmark is judged by (§08 "When renders happen, and caching", #342). Every one is here, so a
// change is one line and the README can point at it.

/** §08's target on the production server: 95% of slide renders within this, per size. Reported, never enforced in CI. */
export const TARGET_P95_MS = 1_500;

/**
 * The loose ceiling CI checks the 95th percentile against. The 1.5 s target is for the production server; a shared
 * CI runner is slower and noisier, so this only catches a render gone wrong (a hang, a 4× slowdown), not a target miss.
 */
export const CI_P95_CEILING_MS = 6_000;

/** The short CI run: this many renders, with the browser's restart count lowered so a restart happens within it. */
export const CI_RENDERS = 50;
export const CI_RENDERS_PER_BROWSER = 20;

/** The soak (`LZP_RENDER_SOAK=1`): this many renders in a row at §08's own restart limit. */
export const SOAK_RENDERS = 1_000;

/** The soak's baseline is the browser's memory after this many renders: Chrome's caches have filled by then. */
export const SOAK_BASELINE_RENDERS = 50;

/**
 * How far above the baseline the memory after the last render may be, as a fraction of the baseline. The README says
 * why. It is a starting value, kept until the first measurement on the Picasso Mac says otherwise.
 */
export const SOAK_MARGIN = 0.25;

/** What one run does. `rendersPerBrowser` is the renderer's own limit (§08: 500) when left out. */
export type BenchOptions = {
  /** How many slide renders; the sample batch is repeated from its start when this is more than it holds. */
  renders: number;
  rendersPerBrowser?: number;
  /** Fail when memory has grown more than `SOAK_MARGIN` since the baseline. */
  soak: boolean;
};

/** The batch is one 12-post batch (§08); the soak is `LZP_RENDER_SOAK=1`, and CI never sets it. */
export function optionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  batchRenders: number,
): BenchOptions {
  if (env['LZP_RENDER_SOAK'] === '1') return { renders: SOAK_RENDERS, soak: true };
  return { renders: batchRenders, soak: false };
}
