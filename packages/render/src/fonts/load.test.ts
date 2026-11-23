import { afterEach, describe, expect, it, vi } from 'vitest';
import { FONT_MANIFEST } from './library.ts';
import { loadFonts } from './load.ts';
import type { FontManifest } from './manifest.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const nunito = () => {
  const font = FONT_MANIFEST.fonts.find((entry) => entry.family === 'Nunito');
  if (!font) throw new Error('Nunito is not in the library');
  return font;
};
/** The library with Nunito changed, and no look pairs (they would name the other fonts). */
const onlyNunito = (change: (font: ReturnType<typeof nunito>) => void): FontManifest => {
  const font = structuredClone(nunito());
  change(font);
  return { fonts: [font], looks: {} };
};

describe('loadFonts', () => {
  it('loads every file of the launch library, each matching its hash', async () => {
    const loaded = await loadFonts(FONT_MANIFEST);
    expect(loaded.map((font) => font.family)).toEqual(FONT_MANIFEST.fonts.map((f) => f.family));
    const files = loaded.flatMap((font) => font.files);
    expect(files).toHaveLength(FONT_MANIFEST.fonts.flatMap((font) => font.files).length);
    for (const file of files) expect(file.data.byteLength).toBeGreaterThan(1000);
    const hind = loaded.find((font) => font.family === 'Hind Siliguri');
    expect(hind?.banglaLineHeight).toEqual({ body: 1.65, heading: 1.3 });
  });

  it('never touches the network', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network used'));
    await loadFonts(FONT_MANIFEST);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a web address before reading anything', async () => {
    const manifest = onlyNunito((font) => {
      const first = font.files[0];
      if (first) first.path = 'https://fonts.gstatic.com/s/nunito/v1/nunito.woff2';
    });
    await expect(loadFonts(manifest)).rejects.toThrow(/path/);
  });

  it('fails with the font name when a file does not match its hash', async () => {
    const manifest = onlyNunito((font) => {
      const first = font.files[0];
      if (first) first.sha256 = '0'.repeat(64);
    });
    await expect(loadFonts(manifest)).rejects.toThrow(/Nunito.*sha256/);
  });

  it('fails with the font name when a file is missing', async () => {
    const manifest = onlyNunito((font) => {
      const first = font.files[0];
      if (first) first.path = '@fontsource/nunito/files/nunito-latin-450-normal.woff2';
    });
    await expect(loadFonts(manifest)).rejects.toThrow(/Nunito.*missing/);
  });

  it('fails with the font name when a font package is not installed', async () => {
    const manifest = onlyNunito((font) => {
      const first = font.files[0];
      if (first) first.path = '@fontsource/not-a-font/files/not-a-font-latin-400-normal.woff2';
    });
    await expect(loadFonts(manifest)).rejects.toThrow(/Nunito.*missing/);
  });

  it('fails with the font name when its licence text is missing', async () => {
    const manifest = onlyNunito((font) => {
      font.licence.path = '@fontsource/not-a-font/LICENSE';
    });
    await expect(loadFonts(manifest)).rejects.toThrow(/Nunito.*licence/);
  });

  it('refuses a Latin-only font set for Bangla, naming the font and the letters it lacks', async () => {
    const manifest = onlyNunito((font) => {
      // Nunito's Latin file, labelled as its Bengali subset: the hash matches, the letters don't.
      font.languages = ['bn'];
      font.banglaLineHeight = { body: 1.65, heading: 1.3 };
      font.files = font.files.flatMap((file) => [file, { ...file, subset: 'bengali' as const }]);
    });
    await expect(loadFonts(manifest)).rejects.toThrow(/Nunito.*Bengali.*অ/);
  });
});
