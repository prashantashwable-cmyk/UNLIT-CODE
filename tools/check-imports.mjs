// Dev check: every named import refers to a real export (no bundler to catch it).
import fs from 'node:fs';
import path from 'node:path';
const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') && files.push(path.join(d, e.name))));
walk('js');
const exportsOf = (f) => {
  const s = fs.readFileSync(f, 'utf8');
  const names = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach((x) => names.add(x.trim().split(/\s+as\s+/).pop()));
  if (/export default/.test(s)) names.add('default');
  return names;
};
let bad = 0;
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const target = path.join(path.dirname(f), m[2]);
    if (!fs.existsSync(target)) { console.log(`${f}: missing file ${m[2]}`); bad++; continue; }
    const ex = exportsOf(target);
    for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!ex.has(n)) { console.log(`${f}: ${n} not exported by ${m[2]}`); bad++; }
    }
  }
}
console.log(bad ? `${bad} problems` : 'imports ok');
process.exit(bad ? 1 : 0);
