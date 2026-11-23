// What the editor and the worker share. `loadFonts` reads files with node:fs, so it has its own entry,
// `@lzp/render/fonts/load`, kept out of this one: the slide builder also runs in the editor (§08).
export { FONT_MANIFEST } from './fonts/library.ts';
export {
  BANGLA_LINE_HEIGHT_MIN,
  FONT_LANGUAGES,
  FONT_SUBSETS,
  FontManifestSchema,
  type Font,
  type FontFile,
  type FontLanguage,
  type FontManifest,
  type FontSubset,
} from './fonts/manifest.ts';
export {
  SIZES,
  SIZE_NAMES,
  SMALL_PRINT_PX,
  type Edges,
  type SizeName,
  type SizeSpec,
} from './sizes.ts';
export {
  LookDefinitionSchema,
  RenderKitSchema,
  type LookDefinition,
  type RenderKit,
} from './kit.ts';
export { buildSlide, buildSlideWithWarnings, type BuildResult } from './page/build-slide.ts';
export { ASSET_SCHEME, assetUrl, type AssetKind, type BuildWarning } from './page/assets.ts';
export { registerLook } from './page/looks.ts';
