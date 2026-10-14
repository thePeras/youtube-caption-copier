import * as esbuild from 'esbuild';
import { cp, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

await rm('dist', { recursive: true, force: true });
await cp('public', 'dist', { recursive: true });

const options = {
  entryPoints: {
    background: 'src/background.ts',
    content: 'src/content.ts',
    'page-script': 'src/page-script.ts',
    'popup/popup': 'src/popup.ts'
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'firefox109',
  logLevel: 'info'
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
