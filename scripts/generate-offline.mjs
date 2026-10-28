// After Vite builds hashed assets, create a versioned offline shell manifest.
// No texture files are precached, keeping the initial download small.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const base = process.env.GITHUB_PAGES === 'true' ? '/threejs-universe/' : '/';
const assets = (await readdir(path.join(dist, 'assets')))
  .filter(name => /\.(?:js|css)$/i.test(name))
  .map(name => 'assets/' + name).sort();
const shell = ['index.html', 'favicon.svg', 'manifest.webmanifest', ...assets];
const hash = createHash('sha256');
for (const file of shell) {
  hash.update(file);
  hash.update(await readFile(path.join(dist, file)));
}
const version = 'v3-' + hash.digest('hex').slice(0, 14);
let worker = await readFile('src/offline/service-worker-template.js', 'utf8');
worker = worker.replace('__COSMOS_BASE__', base)
  .replace('__COSMOS_VERSION__', version)
  .replace('/* __COSMOS_SHELL__ */ []', JSON.stringify(shell));
if (worker.includes('__COSMOS_')) throw new Error('Unfilled offline worker token');
await writeFile(path.join(dist, 'service-worker.js'), worker);
console.log('Offline shell:', version, base, shell.length, 'core files; textures on demand.');
