// scripts/find_http_routes.js
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const exts = ['.js', '.cjs', '.mjs', '.ts'];
const isCodeFile = (p) => exts.includes(path.extname(p));

function walk(dir, out = []) {
  const names = fs.readdirSync(dir);
  for (const name of names) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory() && name !== 'node_modules' && name !== '.git') walk(full, out);
    else if (st.isFile() && isCodeFile(full)) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const anyHttpInQuotes = /['"`]\s*https?:\/\/[^'"`]+['"`]/i;
const routeHttpCall = /\b(router|app)\s*\.\s*(get|post|put|delete|patch|use)\s*\(\s*['"`]\s*https?:\/\//i;
const envAsPathRegex = /\b(router|app)\s*\.\s*(get|post|put|delete|patch|use)\s*\(\s*(process\.env\.[A-Z0-9_]+)\s*[,\)]/i;

let matches = [];

for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split(/\r?\n/);
  lines.forEach((ln, i) => {
    if (routeHttpCall.test(ln) || envAsPathRegex.test(ln) || anyHttpInQuotes.test(ln)) {
      matches.push({ file: f, line: i + 1, text: ln.trim() });
    }
  });
}

if (matches.length === 0) {
  console.log('✅ No se encontraron llamadas evidentes con URLs completas en rutas.');
  process.exit(0);
}

console.log('🔎 Posibles coincidencias encontradas (file:line):\n');
matches.forEach(m => {
  console.log(`${m.file}:${m.line}\n  ${m.text}\n`);
});
process.exit(0);