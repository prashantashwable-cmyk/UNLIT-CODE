// Writes <link rel="modulepreload"> for every module the first screen needs (the static import graph
// of js/app.js) into index.html, so the browser fetches them in parallel instead of one import level
// at a time (each level costs a round trip on 3G). Dev only: node tools/gen-preload.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function bootModules(entry = 'js/app.js') {
  const seen = new Set();
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    // Static imports only (dynamic import() loads later, on demand).
    for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm)) {
      walk(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])));
    }
  };
  walk(entry);
  seen.delete(entry);
  return [...seen].sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(root, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const links = bootModules().map((m) => `  <link rel="modulepreload" href="${m}">`).join('\n');
  const block = `<!-- PRELOAD:START -->\n${links}\n  <!-- PRELOAD:END -->`;
  const out = html.includes('<!-- PRELOAD:START -->')
    ? html.replace(/<!-- PRELOAD:START -->[\s\S]*<!-- PRELOAD:END -->/, block)
    : html.replace('  <script type="module" src="js/app.js"></script>', `  ${block}\n  <script type="module" src="js/app.js"></script>`);
  fs.writeFileSync(file, out);
  console.log(`${bootModules().length} modules preloaded`);
}
