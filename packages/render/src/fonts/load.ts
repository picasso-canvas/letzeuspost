import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { missingLetters } from './coverage.ts';
import { FontManifestSchema, type Font, type FontFile, type FontManifest } from './manifest.ts';

// Loads the manifest's fonts from the installed font packages (§08: self-hosted, never fetched at render time). Every
// file must match its sha256 and every weight must draw the letters of each language the font is set for; anything
// else fails, naming the font, so a render never substitutes one silently.

export interface LoadedFontFile extends FontFile {
  data: Uint8Array;
}

export interface LoadedFont extends Omit<Font, 'files'> {
  files: LoadedFontFile[];
}

const require = createRequire(import.meta.url);

/** The file's place on disk, or undefined when its package or the file isn't installed. */
async function locate(path: string): Promise<string | undefined> {
  try {
    const file = require.resolve(path);
    await access(file);
    return file;
  } catch {
    return undefined;
  }
}

async function loadFile(family: string, file: FontFile): Promise<LoadedFontFile> {
  const where = await locate(file.path);
  if (where === undefined) throw new Error(`Font "${family}": file ${file.path} is missing`);
  const data = new Uint8Array(await readFile(where));
  const sha256 = createHash('sha256').update(data).digest('hex');
  if (sha256 !== file.sha256)
    throw new Error(
      `Font "${family}": ${file.path} has sha256 ${sha256}, the manifest says ${file.sha256}`,
    );
  return { ...file, data };
}

async function loadFont(font: Font): Promise<LoadedFont> {
  if ((await locate(font.licence.path)) === undefined)
    throw new Error(`Font "${font.family}": its licence text ${font.licence.path} is missing`);
  const files = await Promise.all(font.files.map((file) => loadFile(font.family, file)));
  for (const weight of font.weights) {
    const data = files.filter((file) => file.weight === weight).map((file) => file.data);
    for (const language of font.languages) {
      const missing = missingLetters(data, language);
      if (missing.length > 0) {
        const script = language === 'bn' ? 'Bengali' : 'Latin';
        throw new Error(
          `Font "${font.family}" weight ${String(weight)} is set for ${language} but has no glyph for the ${script} letters ${missing.join(' ')}`,
        );
      }
    }
  }
  return { ...font, files };
}

/** Reads every font file in the manifest, checks its hash and its letters, and returns the font data. */
export async function loadFonts(manifest: FontManifest): Promise<LoadedFont[]> {
  const parsed = FontManifestSchema.safeParse(manifest);
  if (!parsed.success)
    throw new Error(
      `Font manifest refused: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return Promise.all(parsed.data.fonts.map(loadFont));
}
