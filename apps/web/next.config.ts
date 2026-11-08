import type { NextConfig } from 'next';

// Builder-protected (Q17: cacheComponents and the like stay off). §13: a standalone server build. The workspace
// packages export TypeScript source, so Next compiles the ones the app imports.
const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@lzp/auth', '@lzp/config', '@lzp/core', '@lzp/db', '@lzp/ui'],
};

export default config;
