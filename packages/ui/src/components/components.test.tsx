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
      ghost: 'hover:bg-accent',
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

  it("fills the primary button with the mockup's hover gold on hover, from the token", () => {
    const classes = classesOf(renderToStaticMarkup(<Button>Approve</Button>));
    expect(classes).toContain('hover:bg-primary-hover');
    expect(classes.filter((c) => /brightness|hover:bg-primary\//.test(c))).toEqual([]);
  });

  it("sets button text at the mockup's 550 weight from the token, not 500", () => {
    // Tailwind reads `font-button` as the font family (`--font-button`), so the weight is asked for by type.
    const classes = classesOf(renderToStaticMarkup(<Button>Approve</Button>));
    expect(classes).toContain('font-(weight:--font-weight-button)');
    expect(classes.filter((c) => /^font-(medium|button)$/.test(c))).toEqual([]);
  });

  it('tints a ghost button with the secondary surface on hover, which shows in dark too', () => {
    const classes = classesOf(renderToStaticMarkup(<Button variant="ghost">Cancel</Button>));
    expect(classes).toContain('hover:bg-accent');
    expect(classes.filter((c) => /bg-muted/.test(c))).toEqual([]);
  });

  it('fills an input with the card surface in both themes, so the page never shows through', () => {
    const classes = classesOf(renderToStaticMarkup(<Input aria-label="Brand name" />));
    expect(classes).toContain('bg-card');
    expect(classes.filter((c) => /^(dark:)?bg-(transparent|input)/.test(c))).toEqual([]);
  });

  it('draws an invalid input with a solid destructive border and no halo or see-through red', () => {
    const classes = classesOf(renderToStaticMarkup(<Input aria-label="Brand name" aria-invalid />));
    expect(classes).toContain('aria-invalid:border-destructive');
    expect(classes.filter((c) => /aria-invalid:.*ring|destructive\//.test(c))).toEqual([]);
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
        'outline-ring',
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

  it("sets a label quiet and close to its field, as the mockup does, and red when it's invalid", () => {
    const html = renderToStaticMarkup(
      <Field>
        <FieldLabel htmlFor="x">Brand name</FieldLabel>
        <Input id="x" />
      </Field>,
    );
    const label = classesOf(/<label[^>]*class="[^"]*"/.exec(html)?.[0] ?? '');
    for (const cls of ['text-label', 'font-(weight:--font-weight-label)', 'text-muted-foreground'])
      expect(label).toContain(cls);
    expect(label).toContain('group-data-[invalid=true]/field:text-destructive');
    expect(label).not.toContain('text-sm');
    expect(label.filter((c) => /^font-(medium|label)$/.test(c))).toEqual([]);
    const field = classesOf(html);
    expect(field).toContain('gap-1');
    expect(field).not.toContain('gap-3');
  });

  it("keeps a disabled field's description at full strength, so it still reads at 4.5:1", () => {
    const html = renderToStaticMarkup(
      <Field data-disabled>
        <FieldDescription>As your clients know it.</FieldDescription>
      </Field>,
    );
    const description = /<p[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
    expect(description).toContain('text-muted-foreground');
    expect(description.filter((c) => c.includes('opacity'))).toEqual([]);
  });

  it('renders a label', () => {
    expect(renderToStaticMarkup(<Label htmlFor="x">Name</Label>)).toContain(
      '<label data-slot="label"',
    );
  });
});
