import * as esbuild from 'esbuild';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const chrome = process.argv.includes('--chrome');
const outdir = chrome ? 'dist-chrome' : 'dist';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));

await rm(outdir, { recursive: true, force: true });
await cp('public', outdir, { recursive: true });

const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
manifest.version = version;

if (chrome) {
  const pngIcons = Object.fromEntries([16, 32, 48, 128].map((size) => [size, `icons/icon-${size}.png`]));
  delete manifest.browser_specific_settings;
  manifest.background = { service_worker: 'background.js' };
  manifest.icons = pngIcons;
  manifest.action.default_icon = pngIcons;
  manifest.commands['copy-captions'].suggested_key = { default: 'Alt+C' };
  await rm(`${outdir}/icons/icon.svg`);
  await rm(`${outdir}/icons/icon-96.png`);
}

await writeFile(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');

const shared = {
  outdir,
  bundle: true,
  format: 'iife',
  target: chrome ? 'chrome120' : 'firefox109',
  logLevel: 'info'
};

const builds = [
  {
    ...shared,
    entryPoints: {
      background: 'src/background.ts',
      content: 'src/content.ts',
      'popup/popup': 'src/popup.ts'
    },
    inject: chrome ? ['src/chrome-polyfill.ts'] : []
  },
  {
    ...shared,
    entryPoints: { 'page-script': 'src/page-script.ts' }
  }
];

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
