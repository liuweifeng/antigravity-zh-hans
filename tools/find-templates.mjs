#!/usr/bin/env node
// List TemplateLiteral UI strings (with `${}` interpolation) that need
// whole-sentence translation, keyed as "text {0} text".
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'bundle/pristine');
const onlyMissing = process.argv.includes('--missing');
const known = onlyMissing
  ? new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'translations/templates.json'), 'utf8'))))
  : new Set();

const BAD_PROPS = new Set(['id', 'name', 'code', 'screen', 'targetScreen', 'key', 'type', 'role', 'kind', 'mode', 'value', 'testId', 'className', 'style', 'path', 'url', 'uri', 'href', 'src']);

const counts = new Map();
for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js') && !f.includes('prism'))) {
  const src = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const ast = parse(src, { sourceType: 'script', plugins: ['jsx', 'classProperties', 'topLevelAwait'], errorRecovery: true, allowReturnOutsideFunction: true });
  const walk = (node, ancestors) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, ancestors));
    if (typeof node.type !== 'string') return;
    if (node.type === 'TemplateLiteral' && node.expressions.length > 0 && node.expressions.length <= 3) {
      const quasis = node.quasis.map((q) => q.value.cooked ?? '');
      const key = quasis.map((q, i) => (i < node.expressions.length ? q + `{${i}}` : q)).join('');
      const text = key.replace(/\{\d\}/g, ' ');
      const ok = /\s/.test(text.trim()) && /[A-Za-z]{2,}/.test(text) && text.trim().length <= 140 && !text.includes('\n') && !text.includes('\x1b');
      let logic = false;
      for (let i = ancestors.length - 1; i >= 0 && !logic; i--) {
        const p = ancestors[i];
        if (p.type === 'BinaryExpression' && /^(===|!==|==|!=)$/.test(p.operator)) logic = true;
        else if (p.type === 'SwitchCase' && p.test && p.test.start <= node.start && node.end <= p.test.end) logic = true;
        else if (p.type === 'ObjectProperty' && p.key === node) logic = true;
        else if (p.type === 'MemberExpression' && p.property === node) logic = true;
        else if (p.type === 'ObjectProperty' && BAD_PROPS.has(p.key?.name ?? p.key?.value)) logic = true;
      }
      if (ok && !logic && !known.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    ancestors.push(node);
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k.endsWith('Comments')) continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v, ancestors);
    }
    ancestors.pop();
  };
  walk(ast, []);
}

const out = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
fs.writeFileSync(path.join(root, 'work/templates-missing.json'), JSON.stringify(out, null, 1));
console.log('template strings:', out.length);
for (const x of out.slice(0, 40)) console.log(x.count, JSON.stringify(x.value));
