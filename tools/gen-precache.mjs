// Writes the list of shell files into sw.js (dev only): node tools/gen-precache.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['css', 'js', 'icons', 'vendor'];
const ROOT_FILES = ['index.html', 'offline.html', 'manifest.webmanifest'];
const SKIP = /(\.map|LICENSE|\.md)$/;

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    return d.isDirectory() ? walk(rel) : SKIP.test(d.name) ? [] : [rel];
  });
}

export function shellFiles() {
  return ['./', ...ROOT_FILES, ...DIRS.flatMap(walk)].map((f) => (f === './' ? f : `./${f}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = shellFiles();
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const list = `// PRECACHE:START\nconst PRECACHE = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];\n// PRECACHE:END`;
  fs.writeFileSync(path.join(root, 'sw.js'), sw.replace(/\/\/ PRECACHE:START[\s\S]*\/\/ PRECACHE:END/, list));
  console.log(`${files.length} files in PRECACHE`);
}
