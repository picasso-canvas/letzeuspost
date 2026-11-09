import { readdirSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from '@lzp/ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@lzp/ui/components/field';
import { Input } from '@lzp/ui/components/input';
import { Label } from '@lzp/ui/components/label';

interface ComponentsJson {
  style: string;
  rsc: boolean;
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

  it('is set for React Server Components, as apps/web (Next.js App Router) uses them', () => {
    expect(config.rsc).toBe(true);
  });
});

describe('client components (Next.js App Router)', () => {
  it("marks every component that uses a React hook with 'use client'", () => {
    const files = readdirSync(new URL('.', import.meta.url)).filter(
      (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      if (/\buse[A-Z]\w*\(/.test(source)) expect(source, file).toMatch(/^'use client';/);
    }
  });
});

const classesOf = (html: string): string[] => /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];

describe('the shadcn components', () => {
  it('renders a button in each variant, each with its own look', () => {
    const own = {
      default: 'bg-primary',
      secondary: 'text-secondary-foreground',
      ghost: 'dark:hover:bg-muted/50',
      destructive: 'text-destructive',
      outline: 'border-border',
      link: 'underline',
    } as const;
    for (const [variant, cls] of Object.entries(own) as [keyof typeof own, string][]) {
      const html = renderToStaticMarkup(<Button variant={variant}>Approve</Button>);
      expect(html).toMatch(/^<button /);
      expect(html).toContain('data-slot="button"');
      expect(html).toContain('>Approve</button>');
      expect(classesOf(html), variant).toContain(cls);
      for (const [other, otherCls] of Object.entries(own))
        if (other !== variant && otherCls !== 'underline')
          expect(classesOf(html), `${variant} has ${other}'s ${otherCls}`).not.toContain(otherCls);
    }
  });

  it("draws the mockup's plain button: a strong border on the card colour, a surface tint on hover", () => {
    for (const variant of ['secondary', 'destructive'] as const) {
      const classes = classesOf(renderToStaticMarkup(<Button variant={variant}>Save</Button>));
      for (const cls of ['border-border-strong', 'bg-card', 'hover:bg-secondary'])
        expect(classes, variant).toContain(cls);
    }
  });

  it('darkens the gold on hover, as the mockup does, instead of washing it out', () => {
    const classes = classesOf(renderToStaticMarkup(<Button>Approve</Button>));
    expect(classes).toContain('hover:brightness-90');
    expect(classes).not.toContain('hover:bg-primary/80');
  });

  it('draws focus as a solid 2 px outline with a 2 px gap, never a see-through ring (§05 mockup)', () => {
    for (const html of [
      renderToStaticMarkup(<Button>Approve</Button>),
      renderToStaticMarkup(<Input aria-label="Brand name" />),
    ]) {
      const classes = classesOf(html);
      for (const cls of [
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-solid',
        'focus-visible:outline-ring',
      ])
        expect(classes).toContain(cls);
      expect(classes.filter((c) => /^focus-visible:ring/.test(c))).toEqual([]);
    }
  });

  it("sets the ring colour at rest, in every variant, so focus never fades in from the text's colour", () => {
    // `transition` animates outline-color. With the colour set only on :focus-visible, it starts from currentColor
    // (the text, or the destructive red) and a read just after focus sees that, not the ring token (#74 round 2).
    const variants = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const;
    const buttons = variants.map((variant) =>
      renderToStaticMarkup(<Button variant={variant}>Approve</Button>),
    );
    const inputs = [
      renderToStaticMarkup(<Input aria-label="Brand name" />),
      renderToStaticMarkup(<Input aria-label="Brand name" aria-invalid />),
    ];
    for (const html of [...buttons, ...inputs]) {
      const classes = classesOf(html);
      expect(classes).toContain('outline-ring');
      expect(
        classes.filter((c) => /outline-(destructive|primary|foreground|current)/.test(c)),
      ).toEqual([]);
    }
  });

  it('keeps gold off text in light mode: the link is ink, gold only in dark (§05, §21)', () => {
    const classes = classesOf(renderToStaticMarkup(<Button variant="link">Open</Button>));
    expect(classes).toContain('text-foreground');
    expect(classes).toContain('dark:text-primary');
    expect(classes).not.toContain('text-primary');
  });

  it('moves nothing when reduced motion is asked for', () => {
    const classes = classesOf(renderToStaticMarkup(<Button>Approve</Button>));
    expect(classes).toContain('motion-reduce:transition-none');
    expect(classes.filter((c) => c.includes('translate') && !c.startsWith('motion-safe:'))).toEqual(
      [],
    );
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
