#!/usr/bin/env node
// Apply a translation map to a copy of the Antigravity web bundle.
// Replacements are AST-guided: only string literals in presentation positions
// are rewritten. Strings that the app also compares, switches on, or uses as
// keys are left untouched unless --force-ambiguous is passed, so app logic
// keeps working.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const forceAmbiguous = args.includes('--force-ambiguous');

const srcDir = path.resolve(getArg('--src', 'bundle/pristine'));
const outDir = path.resolve(getArg('--out', 'web'));
const mapPath = path.resolve(getArg('--map', 'translations/zh-Hans.json'));

const PRESENTATION_PROPS = new Set([
  'title', 'label', 'message', 'description', 'placeholder', 'tooltip', 'tooltipText', 'text', 'children', 'content', 'subtitle',
  'heading', 'helperText', 'errorText', 'hint', 'alt', 'aria-label', 'aria-description', 'aria-placeholder', 'caption',
  'ariaLabel', 'confirmLabel', 'cancelLabel', 'submitLabel', 'emptyText', 'emptyMessage', 'loadingText', 'displayName',
  'summary', 'detail', 'confirmText', 'body', 'header', 'footer', 'notice', 'warning', 'reason', 'prompt', 'greeting',
  'tagline', 'statusText', 'buttonText', 'actionLabel', 'linkText', 'helper', 'errorMessage', 'emptyState', 'noResults',
  'toast', 'alert'
]);

const DANGEROUS_CALLEES = new Set([
  'get', 'set', 'has', 'delete', 'includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'match', 'test', 'exec',
  'querySelector', 'querySelectorAll', 'getElementById', 'closest', 'matches', 'addEventListener', 'removeEventListener',
  'dispatchEvent', 'postMessage', 'send', 'emit', 'on', 'once', 'off', 'invoke', 'apply', 'parse', 'stringify', 'open',
  'writeFile', 'readFile', 'readFileSync', 'writeFileSync', 'execSync', 'spawn', 'execFile', 'fetch', 'request',
  'getItem', 'setItem', 'removeItem', 'setAttribute', 'getAttribute', 'removeAttribute', 'toggle', 'show', 'hide', 'focus',
  'blur', 'scrollTo', 'scrollIntoView', 'format', 'replace', 'split', 'join', 'trim', 'toLowerCase', 'toUpperCase',
  'padStart', 'padEnd', 'concat', 'slice', 'substring', 'charAt', 'createObjectURL', 'revokeObjectURL', 'atob', 'btoa',
  'decodeURIComponent', 'encodeURIComponent', 'openExternal', 'loadURL'
]);

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const dict = new Map();
if (Array.isArray(map)) {
  for (const e of map) if (e.value && e.zh) dict.set(e.value, e.zh);
} else {
  for (const [k, v] of Object.entries(map)) if (typeof v === 'string' && v) dict.set(k, v);
}

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js') && !f.includes('prism'));

// context of a string literal: presentation, logic (compared/switched/keyed), or neutral
function contextOf(node, ancestors) {
  let presentation = false;
  const parent = ancestors[ancestors.length - 1];
  if (parent?.type === 'ObjectProperty') {
    const prop = parent.key?.name ?? parent.key?.value;
    if (parent.key !== node && PRESENTATION_PROPS.has(prop)) presentation = true;
  }
  if (parent?.type === 'CallExpression') {
    const callee = parent.callee?.name ?? parent.callee?.property?.name ?? '';
    if (/^(createElement|jsx|jsxs|jsxDEV|_jsx|_jsxs|h)$/.test(callee)) presentation = true;
    if (parent.arguments?.[0] === node && !PRESENTATION_PROPS.has(callee)) {
      // first arg of a generic call: neutral unless it looks like presentation API
    }
  }
  if (parent?.type === 'ArrayExpression' && ancestors[ancestors.length - 2]?.type === 'CallExpression') presentation = true;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const p = ancestors[i];
    if (p.type === 'BinaryExpression' && /^(===|!==|==|!=)$/.test(p.operator)) return { presentation: false, logic: 'binary' };
    if (p.type === 'SwitchCase') return { presentation: false, logic: 'switch' };
    if (p.type === 'ObjectProperty' && p.key === node) return { presentation: false, logic: 'key' };
    if (p.type === 'MemberExpression' && p.property === node) return { presentation: false, logic: 'member' };
    if (p.type === 'CallExpression') {
      const callee = p.callee?.name ?? p.callee?.property?.name ?? '';
      if (DANGEROUS_CALLEES.has(callee)) return { presentation: false, logic: 'callee:' + callee };
    }
    if (p.type === 'JSXAttribute') {
      const a = p.name?.name ?? p.name?.property?.name;
      if (a === 'className' || a === 'style' || a === 'id' || a === 'key' || a === 'role') return { presentation: false, logic: 'attr:' + a };
    }
  }
  return { presentation, logic: null };
}

function placeholders(s) {
  return (s.match(/%[sdif@]|\{\d+\}|[{}]/g) || []).sort().join(',');
}

// ---- pass 1: which values appear in logic contexts anywhere?
const ambiguous = new Set();
const parsed = new Map();
for (const file of files) {
  const source = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const ast = parse(source, { sourceType: 'script', plugins: ['jsx', 'classProperties', 'topLevelAwait', 'importAttributes'], errorRecovery: true, allowReturnOutsideFunction: true });
  parsed.set(file, { source, ast, hits: [] });
  const walk = (node, ancestors) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, ancestors));
    if (typeof node.type !== 'string') return;
    const ctx = node.type === 'StringLiteral' ? contextOf(node, ancestors) : null;
    if (ctx?.logic) ambiguous.add(node.value);
    else if (ctx && ctx.presentation && dict.has(node.value)) parsed.get(file).hits.push({ start: node.start, end: node.end, value: node.value });
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

// ---- pass 2: rewrite presentation literals
let totalApplied = 0;
const used = new Set();
const problems = [];
const skippedAmbiguous = [];

for (const [file, { source, hits }] of parsed) {
  let out = source;
  for (const h of hits.sort((a, b) => b.start - a.start)) {
    const zh = dict.get(h.value);
    if (ambiguous.has(h.value) && !forceAmbiguous) {
      if (!skippedAmbiguous.includes(h.value)) skippedAmbiguous.push(h.value);
      continue;
    }
    if (h.value !== h.value.trim() || zh !== zh.trim()) {
      problems.push({ file, value: h.value, reason: 'whitespace-edge' });
      continue;
    }
    if (placeholders(h.value) !== placeholders(zh)) {
      problems.push({ file, value: h.value, reason: `placeholder-mismatch:${placeholders(h.value)}=>${placeholders(zh)}` });
      continue;
    }
    out = out.slice(0, h.start) + JSON.stringify(zh) + out.slice(h.end);
    used.add(h.value);
    totalApplied++;
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, file), out);
}

for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
  if (entry.name.endsWith('.js') && !entry.name.includes('prism')) continue;
  fs.cpSync(path.join(srcDir, entry.name), path.join(outDir, entry.name), { recursive: true });
}

const unused = [...dict.keys()].filter((k) => !used.has(k));
console.log(`applied ${totalApplied} replacements, ${used.size} distinct strings -> ${outDir}`);
console.log(`unused map entries: ${unused.length}${unused.length ? ' e.g. ' + unused.slice(0, 4).map((s) => JSON.stringify(s)).join(', ') : ''}`);
console.log(`left untranslated because app logic compares them: ${skippedAmbiguous.length}`);
if (skippedAmbiguous.length) console.log('  ' + skippedAmbiguous.slice(0, 12).map((s) => JSON.stringify(s)).join(', '));
if (problems.length) {
  console.log(`skipped ${problems.length} invalid entries:`);
  for (const p of problems.slice(0, 10)) console.log(`  ${p.file} ${JSON.stringify(p.value)} (${p.reason})`);
}
