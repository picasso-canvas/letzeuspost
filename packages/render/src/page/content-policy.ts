import { ASSET_SCHEME } from './assets.ts';

/**
 * The page's content policy (§08 Security: "a strict content policy allows only our fit script, by hash"). Nothing is
 * allowed unless it is named here: scripts only by the sha256 of the fit script, styles only by the sha256 of the
 * page's one `<style>` (so no `'unsafe-inline'`; the fit script may still set variables through the CSS object model,
 * which a policy doesn't restrict), images and fonts only from the job's own asset scheme, and no connection, frame,
 * form or base address at all (they fall back to `default-src 'none'`).
 */
export function contentPolicy(scriptHash: string, styleHash: string): string {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    `img-src ${ASSET_SCHEME}:`,
    `font-src ${ASSET_SCHEME}:`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
