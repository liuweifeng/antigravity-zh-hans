#!/usr/bin/env node
// Find English UI strings that still have no translation entry.
// Heuristics mirror tools/patch.mjs: spaced, short, not compared/keyed.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'bundle/pristine');
const dict = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'translations/zh-Hans.json'), 'utf8'))));

const BAD_PROPS = new Set(['id', 'name', 'code', 'screen', 'targetScreen', 'key', 'type', 'role', 'kind', 'mode', 'value', 'testId', 'className', 'style', 'path', 'url', 'uri', 'href', 'src', 'storageKey']);
const TAILWIND = /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|truncate|uppercase|lowercase|text-|bg-|border|rounded|shadow|p-|m-|w-|h-|gap-|items-|justify-|font-)/;

function acceptable(v) {
  v = v.trim();
  if (v.length < 2 || v.length > 140) return false;
  if (!/[A-Za-z]/.test(v) || !/\s/.test(v)) return false;
  if (/\uFFFD|\{\}|=>|&&|\|\||===|!==|[;{}]/.test(v)) return false;
  if (/^(https?:|data:|blob:|mailto:|tel:)/.test(v)) return false;
  if (/^[\w./-]+\.(js|mjs|css|json|svg|png|jpe?g|mp3|woff2?|wasm|md|html)$/i.test(v)) return false;
  if (/^[A-Za-z0-9+/=]{24,}$/.test(v)) return false;
  if (/^[\d\s.,:;%()+-]+$/.test(v)) return false;
  if (v.startsWith('#') || v.startsWith('\x1b') || v.includes('\n')) return false;
  const toks = v.split(/\s+/);
  if (toks.filter((t) => TAILWIND.test(t)).length / toks.length > 0.7) return false;
  return true;
}

const counts = new Map();
for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js') && !f.includes('prism'))) {
  const src = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const ast = parse(src, { sourceType: 'script', plugins: ['jsx', 'classProperties', 'topLevelAwait'], errorRecovery: true, allowReturnOutsideFunction: true });
  const walk = (node, ancestors) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, ancestors));
    if (typeof node.type !== 'string') return;
    if (node.type === 'StringLiteral' && !dict.has(node.value) && acceptable(node.value)) {
      let logic = false;
      for (let i = ancestors.length - 1; i >= 0 && !logic; i--) {
        const p = ancestors[i];
        if (p.type === 'BinaryExpression' && /^(===|!==|==|!=)$/.test(p.operator)) logic = true;
        else if (p.type === 'SwitchCase' && p.test && p.test.start <= node.start && node.end <= p.test.end) logic = true;
        else if (p.type === 'ObjectProperty' && p.key === node) logic = true;
        else if (p.type === 'MemberExpression' && p.property === node) logic = true;
        else if (p.type === 'ObjectProperty' && (parentKey(p) && BAD_PROPS.has(parentKey(p)))) logic = true;
      }
      if (!logic) counts.set(node.value, (counts.get(node.value) || 0) + 1);
    }
    ancestors.push(node);
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k.endsWith('Comments')) continue;
      const v = node[k];
      if (v && typeof v === 'object') walk(v, ancestors);
    }
    ancestors.pop();
  };
  function parentKey(p) {
    return p.key?.name ?? p.key?.value;
  }
  walk(ast, []);
}

const out = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
fs.mkdirSync(path.join(root, 'work'), { recursive: true });
fs.writeFileSync(path.join(root, 'work/missing-ui.json'), JSON.stringify(out, null, 1));
console.log('missing ui strings:', out.length);
for (const x of out.slice(0, 30)) console.log(x.count, JSON.stringify(x.value));
