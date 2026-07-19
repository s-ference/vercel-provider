import { defineConfig } from 'tsup';

export default defineConfig({
  name: 'sference-vercel-provider',
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  platform: 'neutral',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Keep imports external so consumers dedupe ai-sdk + zod.
  external: [
    'ai',
    '@ai-sdk/provider',
    '@ai-sdk/provider-utils',
    'zod',
    'zod/v3',
    'zod/v4',
    'eventsource-parser',
  ],
});
