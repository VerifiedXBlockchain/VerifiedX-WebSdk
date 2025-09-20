const esbuild = require('esbuild');

// Build browser-compatible ESM bundle
esbuild.build({
  entryPoints: ['src/browser/index.ts'],
  bundle: true,
  outfile: 'lib/browser.esm.js',
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  external: [], // Bundle everything
  define: {
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis',
  },
  inject: ['./scripts/process-shim.js'],
}).then(() => {
  console.log('✅ Browser ESM build complete');
}).catch((e) => {
  console.error('❌ Browser ESM build failed:', e);
  process.exit(1);
});

// Build browser-compatible UMD bundle
esbuild.build({
  entryPoints: ['src/browser/index.ts'],
  bundle: true,
  outfile: 'lib/browser.umd.js',
  format: 'iife',
  globalName: 'VfxWebSDK',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: true,
  external: [], // Bundle everything
  define: {
    'process.env.NODE_ENV': '"production"',
    global: 'globalThis',
  },
  inject: ['./scripts/process-shim.js'],
}).then(() => {
  console.log('✅ Browser UMD build complete');
}).catch((e) => {
  console.error('❌ Browser UMD build failed:', e);
  process.exit(1);
});