// Writes the list of server calls into js/api-remote.js: every `export async function` of
// js/api.js, except the few that are local to the phone or server-only. Dev only:
// node tools/gen-remote.mjs   (CI checks the file is current)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = new Set(['init', 'sync', 'outboxCount', 'getFileURL', 'fileAccess', 'runAs', 'getDocument']);

export function rpcNames() {
  const src = fs.readFileSync(path.join(root, 'js/api.js'), 'utf8');
  return [...src.matchAll(/^export async function (\w+)/gm)].map((m) => m[1]).filter((n) => !LOCAL.has(n));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = path.join(root, 'js/api-remote.js');
  const src = fs.readFileSync(file, 'utf8');
  const lines = rpcNames().map((n) => `export const ${n} = (...a) => rpc('${n}', a);`).join('\n');
  fs.writeFileSync(file, src.replace(/\/\/ RPC:START[^\n]*\n[\s\S]*\/\/ RPC:END/, (m) => `${m.split('\n')[0]}\n${lines}\n// RPC:END`));
  console.log(`${rpcNames().length} server calls`);
}
