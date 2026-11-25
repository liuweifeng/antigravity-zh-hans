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
const allowPath = getArg('--allow', 'translations/allow-presentation.json');
let allowSet = new Set();
if (allowPath && fs.existsSync(path.resolve(allowPath))) {
  allowSet = new Set(JSON.parse(fs.readFileSync(path.resolve(allowPath), 'utf8')));
}
const forcePath = getArg('--force-global', 'translations/force-global.json');
let forceSet = new Set();
if (forcePath && fs.existsSync(path.resolve(forcePath))) {
  forceSet = new Set(JSON.parse(fs.readFileSync(path.resolve(forcePath), 'utf8')));
}

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

const IDENT_PROPS = new Set([
  'id', 'name', 'code', 'screen', 'targetScreen', 'activeScreen', 'key', 'type', 'role', 'kind', 'mode', 'value', 'storageKey',
  'testId', 'className', 'style', 'path', 'url', 'uri', 'href', 'src', 'form', 'method', 'action', 'event', 'actionType',
  'rel', 'target', 'as', 'sandbox', 'allow', 'encType', 'accept', 'acceptCharset', 'autoComplete', 'inputMode', 'pattern',
  'referrerPolicy', 'loading', 'decoding', 'sizes', 'srcSet', 'media', 'htmlFor', 'contentEditable', 'spellCheck', 'translate',
  'aria-hidden', 'aria-describedby', 'aria-labelledby', 'aria-controls', 'aria-live', 'aria-atomic', 'aria-modal', 'aria-expanded',
  'aria-selected', 'aria-checked', 'aria-disabled', 'aria-pressed', 'aria-current', 'aria-autocomplete', 'aria-haspopup',
  'aria-roledescription', 'aria-valuetext', 'aria-keyshortcuts', 'data-testid'
]);

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const dict = new Map();
if (Array.isArray(map)) {
  for (const e of map) if (e.value && e.zh) dict.set(e.value, e.zh);
} else {
  for (const [k, v] of Object.entries(map)) if (typeof v === 'string' && v) dict.set(k, v);
}
const tplPath = path.resolve('translations/templates.json');
const templates = fs.existsSync(tplPath) ? JSON.parse(fs.readFileSync(tplPath, 'utf8')) : {};

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js') && !f.includes('prism'));

// context of a string literal: presentation, logic (compared/switched/keyed), or neutral
function contextOf(node, ancestors) {
  const v = node.value;
  const spaced = /\s/.test(v.trim());
  const short = v.length <= 140 && !v.includes('\n') && !v.includes('\x1b');
  let presentation = false;
  const parent = ancestors[ancestors.length - 1];
  if (parent?.type === 'ExpressionStatement') return { presentation: false, logic: 'directive' };
  if (parent?.type === 'ObjectProperty') {
    const prop = parent.key?.name ?? parent.key?.value;
    if (parent.key !== node && PRESENTATION_PROPS.has(prop)) presentation = true;
    else if (parent.key !== node && IDENT_PROPS.has(prop)) return { presentation: false, logic: 'ident:' + prop };
    else if (parent.key !== node && typeof prop === 'string' && (prop.startsWith('data-') || (prop.startsWith('aria-') && !/^aria-(label|description|placeholder)$/.test(prop)))) {
      return { presentation: false, logic: 'attr:' + prop };
    }
  }
  if (parent?.type === 'JSXAttribute') {
    const attr = parent.name?.name ?? parent.name?.property?.name;
    if (IDENT_PROPS.has(attr)) return { presentation: false, logic: 'attr:' + attr };
  }
  if (spaced && short) presentation = true;
  if (parent?.type === 'CallExpression') {
    const callee = parent.callee?.name ?? parent.callee?.property?.name ?? '';
    if (/^(createElement|jsx|jsxs|jsxDEV|_jsx|_jsxs|h)$/.test(callee)) presentation = true;
    if (spaced && short && !DANGEROUS_CALLEES.has(callee)) presentation = true;
  }
  if (parent?.type === 'ArrayExpression' && ancestors[ancestors.length - 2]?.type === 'CallExpression') presentation = true;
  // labels picked in ternaries / logical defaults: localizable when they read like copy
  if ((parent?.type === 'ConditionalExpression' || parent?.type === 'LogicalExpression') && spaced && short) presentation = true;
  if (parent?.type === 'AssignmentExpression' && spaced && short) presentation = true;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const p = ancestors[i];
    if (p.type === 'CallExpression' || p.type === 'OptionalCallExpression') {
      const callee = p.callee?.name ?? p.callee?.property?.name ?? '';
      if (/^(createElement|jsx|jsxs|jsxDEV|_jsx|_jsxs|h)$/.test(callee)) presentation = true;
    }
    if (p.type === 'BinaryExpression' && /^(===|!==|==|!=)$/.test(p.operator)) return { presentation: false, logic: 'binary' };
    if (p.type === 'SwitchCase') {
      const inTest = p.test && p.test.start <= node.start && node.end <= p.test.end;
      if (inTest) return { presentation: false, logic: 'switch' };
    }
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
  parsed.set(file, { source, ast, hits: [], tplHits: [] });
  const walk = (node, ancestors) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, ancestors));
    if (typeof node.type !== 'string') return;
    if (node.type === 'TemplateLiteral' && node.expressions.length > 0) {
      const quasis = node.quasis.map((q) => q.value.cooked ?? '');
      const key = quasis.map((q, i) => (i < node.expressions.length ? q + `{${i}}` : q)).join('');
      if (templates[key]) parsed.get(file).tplHits.push({ start: node.start, end: node.end, key, node });
    }
    const ctx = node.type === 'StringLiteral' ? contextOf(node, ancestors) : null;
    if (node.type === 'StringLiteral' && forceSet.has(node.value)) {
      const parent = ancestors[ancestors.length - 1];
      const isKey = parent?.type === 'ObjectProperty' && parent.key === node;
      if (!isKey) parsed.get(file).hits.push({ start: node.start, end: node.end, value: node.value, forced: true });
    } else if (ctx?.logic) ambiguous.add(node.value);
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

for (const [file, { source, hits, tplHits }] of parsed) {
  let out = source;
  const tplRanges = tplHits.map((t) => [t.start, t.end]);
  const edits = [];

  for (const h of hits) {
    if (tplRanges.some(([s, e]) => h.start >= s && h.end <= e)) continue;
    const zh = dict.get(h.value);
    if (!h.forced && ambiguous.has(h.value) && !forceAmbiguous && !allowSet.has(h.value)) {
      if (!skippedAmbiguous.includes(h.value)) skippedAmbiguous.push(h.value);
      continue;
    }
    if (placeholders(h.value) !== placeholders(zh)) {
      problems.push({ file, value: h.value, reason: `placeholder-mismatch:${placeholders(h.value)}=>${placeholders(zh)}` });
      continue;
    }
    const final = (h.value.startsWith(' ') ? ' ' : '') + zh.trim() + (h.value.endsWith(' ') ? ' ' : '');
    edits.push({ start: h.start, end: h.end, text: JSON.stringify(final), value: h.value });
  }

  for (const t of tplHits) {
    const zh = templates[t.key];
    const parts = zh.split(/\{(\d+)\}/);
    const segs = [];
    const order = [];
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) segs.push(parts[i]);
      else order.push(Number(parts[i]));
    }
    const expected = t.node.expressions.map((_, i) => i).join(',');
    if (segs.length !== t.node.expressions.length + 1 || order.join(',') !== expected) {
      problems.push({ file, value: t.key, reason: 'template-placeholder-mismatch' });
      continue;
    }
    let built = '`';
    for (let i = 0; i < segs.length; i++) {
      built += segs[i].replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      if (i < t.node.expressions.length) {
        const e = t.node.expressions[i];
        built += '${' + source.slice(e.start, e.end) + '}';
      }
    }
    built += '`';
    edits.push({ start: t.start, end: t.end, text: built, value: t.key });
  }

  for (const e of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    used.add(e.value);
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
if (skippedAmbiguous.length) console.log('  ' + skippedAmbiguous.map((s) => JSON.stringify(s)).join(', '));
if (problems.length) {
  console.log(`skipped ${problems.length} invalid entries:`);
  for (const p of problems.slice(0, 10)) console.log(`  ${p.file} ${JSON.stringify(p.value)} (${p.reason})`);
}
