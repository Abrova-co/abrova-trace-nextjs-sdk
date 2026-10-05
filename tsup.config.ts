import { defineConfig } from 'tsup';

// The "/react" bundle imports the SDK from the main bundle next to it instead of
// carrying a second copy, so both share one instance and one set of breadcrumbs.
const sharedCore = {
  name: 'shared-core',
  setup(build: any) {
    build.onResolve({ filter: /^\.\.\/index$/ }, () => ({
      path: build.initialOptions.format === 'esm' ? '../index.mjs' : '../index.js',
      external: true,
    }));
  },
};

export default defineConfig([
  // Main SDK bundle
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    external: ['react', 'next'],
    splitting: false,
  },
  // React-specific bundle
  {
    entry: {
      'react/index': 'src/react/index.tsx',
    },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    minify: false,
    external: ['react', 'next'],
    splitting: false,
    esbuildPlugins: [sharedCore],
  },
]);
