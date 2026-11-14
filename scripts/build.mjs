// Bundles the game two ways:
//   dist/                          index.html + styles.css + game.js, for any static host
//   Neon Drift Slipstream.html     the whole game in one file: styles and script inlined
// Both use a classic (non-module) script, so they also run when opened straight from disk.
import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile, copyFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/main.js')],
  outfile: resolve(out, 'game.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});

const html = await readFile(resolve(root, 'index.html'), 'utf8');
const importMap = /\s*<script type="importmap">[\s\S]*?<\/script>/;
const entry = '<script type="module" src="./src/main.js"></script>';
if (!importMap.test(html) || !html.includes(entry)) throw new Error('index.html no longer matches what the build rewrites.');
await writeFile(resolve(out, 'index.html'), html.replace(importMap, '').replace(entry, '<script defer src="./game.js"></script>'));
await copyFile(resolve(root, 'styles.css'), resolve(out, 'styles.css'));

// The single-file edition. Inside an inline <script> or <style> the only text that
// can end the element early is its own closing tag (or an HTML comment opener), so
// those sequences are escaped; functions are used as replacements so that "$" in
// the bundle is never read as a substitution pattern.
const styleLink = '<link rel="stylesheet" href="styles.css">';
if (!html.includes(styleLink)) throw new Error('index.html no longer links styles.css the way the build expects.');
const css = (await readFile(resolve(root, 'styles.css'), 'utf8')).replaceAll('</style', '<\\/style');
const js = (await readFile(resolve(out, 'game.js'), 'utf8')).replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');
const single = html.replace(importMap, '')
  .replace(styleLink, () => `<style>\n${css}</style>`)
  .replace(entry, () => `<script>\n${js}</script>`);
const singlePath = resolve(root, 'Neon Drift Slipstream.html');
await writeFile(singlePath, single);

const { size } = await stat(resolve(out, 'game.js'));
console.log(`dist/ ready — game.js ${(size / 1024).toFixed(0)} kB\nNeon Drift Slipstream.html ready — ${((await stat(singlePath)).size / 1024).toFixed(0)} kB, self-contained`);
