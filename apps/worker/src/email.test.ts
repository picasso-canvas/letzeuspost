import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('the worker loads email templates (Q8)', () => {
  it("imports @lzp/email's built output and renders a template to HTML and plain text", async () => {
    // packages/email compiles with tsc (jsx: react-jsx) to dist; the worker never compiles JSX itself.
    execFileSync('pnpm', ['--filter', '@lzp/email', 'build'], { stdio: 'ignore' });
    const email = await import('@lzp/email');
    const rendered = await email.renderTemplate(
      'email-check',
      { name: 'Picasso Studio' },
      { appUrl: 'http://localhost:3000' },
    );
    expect(rendered.html).toContain('Picasso Studio');
    expect(rendered.html.toLowerCase()).toContain('<!doctype html');
    expect(rendered.text).toContain('Picasso Studio');
  }, 60_000);
});
