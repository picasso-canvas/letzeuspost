// The worker's render browser (§08), its own entry `@lzp/render/browser`: it needs Playwright and node:fs, so it stays
// out of `@lzp/render`, which the editor loads too.
export { CHROMIUM_ARGS, LAUNCH_OPTIONS } from './flags.ts';
export type { BlockFonts, FontFallback, UsedFont } from './fonts.ts';
export { postDeadline, RENDER_LIMITS, RenderFailure } from './limits.ts';
export { PAGE_ORIGIN, type RenderAsset } from './requests.ts';
export {
  createRenderer,
  type BlockedRequest,
  type Log,
  type Renderer,
  type RendererOptions,
  type RenderLimits,
  type RenderPageInput,
  type RenderResult,
} from './runner.ts';
