// scripts/find_route_args.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IGNORES = ['node_modules', '.git', 'dist', 'build'];
const exts = ['.js', '.mjs', '.cjs'];

function walk(dir, cb) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (IGNORES.includes(f)) continue;
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, cb);
    else if (stat.isFile() && exts.includes(path.extname(full))) cb(full);
  }
}

const regex = /\b(app|router)\.(use|get|post|put|patch|delete)\s*\(\s*([^\n,]+)/gi;

const results = [];

walk(ROOT, (file) => {
  const txt = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = regex.exec(txt)) !== null) {
    const fn = m[1], method = m[2], arg = m[3].trim();
    const safeLiteral = /^['"`]\s*\/.*/.test(arg);
    if (!safeLiteral) {
      const lines = txt.split(/\r?\n/);
      const pos = txt.slice(0, m.index).split(/\r?\n/).length;
      const contextStart = Math.max(0, pos - 3);
      const contextEnd = Math.min(lines.length - 1, pos + 3);
      const context = lines.slice(contextStart, contextEnd + 1).map((l, i) => {
        const num = contextStart + i + 1;
        return `${num.toString().padStart(4)}| ${l}`;
      }).join('\n');
      results.push({ file, line: pos, fn, method, arg, context });
    }
  }
});

if (results.length === 0) {
  console.log('✅ No se encontraron llamadas app/router con primer argumento sospechoso.');
} else {
  console.log('--- Encontradas llamadas sospechosas ---\n');
  results.forEach(r => {
    console.log(`FILE: ${r.file}`);
    console.log(`LINE: ${r.line}`);
    console.log(`CALL: ${r.fn}.${r.method}( ${r.arg} , ...)`);
    console.log('CONTEXT:\n' + r.context);
    console.log('--------------------------------------\n');
  });
}