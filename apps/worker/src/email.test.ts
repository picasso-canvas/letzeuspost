import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('the worker loads email templates (Q8)', () => {
  it("imports @lzp/email's built output and renders a TSX template to HTML", async () => {
    // packages/email compiles with tsc (jsx: react-jsx) to dist; the worker never compiles JSX itself.
    execFileSync('pnpm', ['--filter', '@lzp/email', 'build'], { stdio: 'ignore' });
    const email = await import('@lzp/email');
    const html = await email.renderToHtml(email.EmailCheck({ name: 'Picasso Studio' }));
    expect(html).toContain('Picasso Studio');
    expect(html.toLowerCase()).toContain('<!doctype html');
  }, 60_000);
});
