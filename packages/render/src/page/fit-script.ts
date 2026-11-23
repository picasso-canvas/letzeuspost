// The script that runs inside the page after fonts and images are ready: it sizes image frames, finds the largest
// `--k` and reports the fit (§08 The fit check). The fit task replaces this constant. Whatever it holds is the one
// script the content policy allows, by its hash, so it must not need `unsafe-inline` or `eval`.
export const FIT_SCRIPT = '/* the fit script goes here (the fit task) */';
