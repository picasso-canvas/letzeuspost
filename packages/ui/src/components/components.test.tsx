import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '@lzp/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@lzp/ui/components/field';
import { Input } from '@lzp/ui/components/input';
import { Label } from '@lzp/ui/components/label';

interface ComponentsJson {
  style: string;
  iconLibrary: string;
  registries?: unknown;
  aliases: Record<string, string>;
}

const config = JSON.parse(
  readFileSync(new URL('../../components.json', import.meta.url), 'utf8'),
) as ComponentsJson;

describe('components.json (#107)', () => {
  it('uses the vega style on Base UI and Lucide icons only (§13, §21)', () => {
    expect(config.style).toBe('base-vega');
    expect(config.iconLibrary).toBe('lucide');
  });

  it('adds no registry: components come only from the official @shadcn one', () => {
    expect(config.registries).toBeUndefined();
  });

  it('resolves every alias inside packages/ui', () => {
    for (const alias of Object.values(config.aliases)) expect(alias).toMatch(/^@lzp\/ui\//);
  });
});

describe('the shadcn components', () => {
  it('renders a button in each of the §05 variants', () => {
    for (const variant of ['default', 'secondary', 'ghost', 'destructive'] as const) {
      const html = renderToStaticMarkup(<Button variant={variant}>Approve</Button>);
      expect(html).toMatch(/^<button /);
      expect(html).toContain('data-slot="button"');
      expect(html).toContain('>Approve</button>');
    }
  });

  it('renders an input with its label, description and error text', () => {
    const html = renderToStaticMarkup(
      <Field data-invalid>
        <FieldLabel htmlFor="brand-name">Brand name</FieldLabel>
        <Input id="brand-name" aria-invalid />
        <FieldDescription>As your clients know it.</FieldDescription>
        <FieldError>Add a name.</FieldError>
      </Field>,
    );
    expect(html).toContain('<label data-slot="field-label"');
    expect(html).toContain('for="brand-name"');
    expect(html).toMatch(/<input[^>]*id="brand-name"/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('As your clients know it.');
    expect(html).toMatch(/role="alert"[^>]*>Add a name\.<\/div>/);
  });

  it("shows nothing for a field error with no message, and one message once when it's repeated", () => {
    expect(renderToStaticMarkup(<FieldError errors={[]} />)).toBe('');
    const html = renderToStaticMarkup(
      <FieldError errors={[{ message: 'Too long.' }, { message: 'Too long.' }]} />,
    );
    expect(html.match(/Too long\./g)).toHaveLength(1);
  });

  it('renders a label', () => {
    expect(renderToStaticMarkup(<Label htmlFor="x">Name</Label>)).toContain(
      '<label data-slot="label"',
    );
  });
});
