import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

const files = process.argv.slice(2);

const UI_PROPS = new Set([
  'title', 'label', 'message', 'description', 'placeholder', 'tooltip', 'tooltipText', 'text', 'children', 'content', 'subtitle',
  'heading', 'helperText', 'error', 'errorText', 'hint', 'alt', 'aria-label', 'aria-description', 'aria-placeholder', 'caption',
  'confirmLabel', 'cancelLabel', 'submitLabel', 'emptyText', 'emptyMessage', 'loadingText', 'displayName', 'summary', 'detail',
  'confirmText', 'body', 'header', 'footer', 'notice', 'warning', 'reason', 'prompt', 'greeting', 'tagline', 'ariaLabel',
  'statusText', 'buttonText', 'actionLabel', 'linkText', 'helper', 'errorMessage', 'emptyState', 'noResults', 'toast', 'alert',
  'dialogTitle', 'dialogDescription', 'menuLabel', 'sectionTitle', 'tabLabel', 'hintText', 'infoText', 'titleText', 'descriptionText'
]);

const DANGEROUS_CALLEES = new Set([
  'get', 'set', 'has', 'delete', 'includes', 'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'match', 'test', 'exec',
  'querySelector', 'querySelectorAll', 'getElementById', 'getElementsByClassName', 'closest', 'matches', 'addEventListener',
  'removeEventListener', 'dispatchEvent', 'postMessage', 'send', 'emit', 'on', 'once', 'off', 'invoke', 'call', 'apply',
  'parse', 'stringify', 'open', 'writeFile', 'readFile', 'readFileSync', 'writeFileSync', 'execSync', 'spawn', 'execFile',
  'fetch', 'request', 'getItem', 'setItem', 'removeItem', 'createElement', 'createTextNode', 'setAttribute', 'getAttribute',
  'removeAttribute', 'hasAttribute', 'toggle', 'show', 'hide', 'focus', 'blur', 'scrollTo', 'scrollIntoView', 'cloneNode',
  'insertAdjacentHTML', 'innerHTML', 'textContent', 'innerText', 'format', 'replace', 'split', 'join', 'trim', 'toLowerCase',
  'toUpperCase', 'padStart', 'padEnd', 'repeat', 'concat', 'slice', 'substring', 'substr', 'charAt', 'codePointAt',
  'getPropertyValue', 'setProperty', 'removeProperty', 'createObjectURL', 'revokeObjectURL', 'atob', 'btoa',
  'decodeURIComponent', 'encodeURIComponent', 'openExternal', 'loadURL', 'setBackgroundColor', 'setTitle'
]);

const TAILWIND_TOKEN = /^(flex|grid|block|inline|inline-block|inline-flex|contents|hidden|visible|relative|absolute|fixed|sticky|static|truncate|italic|underline|uppercase|lowercase|capitalize|antialiased|transition|transform|sr-only|grow|shrink|shrink-0|grow-0|flex-1|flex-auto|flex-none|flex-col|flex-row|flex-wrap|flex-nowrap|items-|justify-|self-|content-|place-|gap-|space-|p-|px-|py-|pt-|pb-|pl-|pr-|m-|mx-|my-|mt-|mb-|ml-|mr-|w-|h-|min-|max-|size-|text-|font-|leading-|tracking-|bg-|border|border-|rounded|rounded-|shadow|shadow-|ring|ring-|outline|opacity-|z-|top-|bottom-|left-|right-|inset-|order-|col-|row-|grid-|auto-|overflow-|whitespace-|break-|select-|cursor-|pointer-events-|group|peer|dark:|hover:|focus:|active:|disabled:|sm:|md:|lg:|xl:|2xl:)/;

function isClassList(s) {
  const toks = s.trim().split(/\s+/);
  if (!toks.length) return false;
  let hits = 0;
  for (const t of toks) if (TAILWIND_TOKEN.test(t) || /^\[.*\]$/.test(t) || /^[-a-z0-9]+:/.test(t)) hits++;
  return hits / toks.length >= 0.7;
}

function acceptable(v) {
  v = v.trim();
  if (v.length < 2 || v.length > 400) return false;
  if (!/[A-Za-z]/.test(v)) return false;
  if (/\uFFFD|\{\}|=>|&&|\|\||===|!==|\bvar\b|\breturn\b|[;]/.test(v)) return false;
  if (/^(https?:|data:|blob:|mailto:|tel:)/.test(v)) return false;
  if (/^[\w./-]+\.(js|mjs|cjs|ts|tsx|jsx|css|scss|json|svg|png|jpe?g|gif|webp|mp3|wav|woff2?|ttf|wasm|proto|pb|md|yaml|yml|toml|sh|py|go|html)$/i.test(v)) return false;
  if (/^[A-Za-z0-9+/=]{24,}$/.test(v)) return false;
  if (/^[\d\s.,:;%()+-]+$/.test(v)) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(v)) return false;
  if (/^[a-z0-9]+[-_][a-z0-9_-]+$/.test(v)) return false;
  if (/^[A-Z0-9_]+$/.test(v)) return false;
  if (/^[\w]+(\.[\w]+)+$/.test(v) && !/\s/.test(v)) return false;
  if (/^[a-z]/.test(v) && !/\s/.test(v) && !/[.!?:]$/.test(v)) return false;
  if (isClassList(v)) return false;
  if (/^#[\w-]+$/.test(v)) return false;
  if (/^(aria|data)-[\w-]+$/.test(v)) return false;
  return true;
}

// walk up from a string literal and reject contexts where the literal is compared
// or used as an identifier-ish key.
function unsafe(node, ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const p = ancestors[i];
    if (p.type === 'BinaryExpression' && /^(===|!==|==|!=)$/.test(p.operator)) return 'binary';
    if (p.type === 'SwitchCase') return 'switch';
    if (p.type === 'ObjectProperty' && p.key === node) return 'key';
    if (p.type === 'MemberExpression' && p.property === node) return 'member';
    if (p.type === 'CallExpression') {
      const callee = p.callee?.name ?? p.callee?.property?.name ?? '';
      if (DANGEROUS_CALLEES.has(callee)) return 'callee:' + callee;
      if (p.callee?.type === 'MemberExpression') {
        const m = p.callee.property?.name ?? '';
        if (DANGEROUS_CALLEES.has(m)) return 'callee:' + m;
      }
    }
    if (p.type === 'JSXAttribute') {
      const attr = p.name?.name ?? p.name?.property?.name;
      if (attr === 'className' || attr === 'style' || attr === 'id' || attr === 'key' || attr === 'role') return 'attr:' + attr;
    }
    if (p.type === 'ObjectProperty' && (p.key?.name === 'className' || p.key?.name === 'style' || p.key?.name === 'key')) return 'prop:' + p.key.name;
  }
  return null;
}

const found = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parse(src, { sourceType: 'script', plugins: ['jsx', 'classProperties', 'topLevelAwait', 'importAttributes'], errorRecovery: true, allowReturnOutsideFunction: true });

  const walk = (node, ancestors) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, ancestors));
    if (typeof node.type !== 'string') return;
    if (node.type === 'StringLiteral' && acceptable(node.value)) {
      const danger = unsafe(node, ancestors);
      if (!danger) {
        const parent = ancestors[ancestors.length - 1];
        const prop = parent?.type === 'ObjectProperty' ? parent.key?.name ?? parent.key?.value : parent?.type === 'CallExpression' ? 'arg' : parent?.type ?? '';
        found.push({ file: path.basename(file), value: node.value, start: node.start, end: node.end, prop: String(prop ?? '') });
      }
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
  console.error(`${path.basename(file)}: ${found.length}`);
}

const byValue = new Map();
for (const e of found) {
  const cur = byValue.get(e.value) ?? { value: e.value, count: 0, files: new Set(), props: new Map() };
  cur.count++;
  cur.files.add(e.file);
  cur.props.set(e.prop, (cur.props.get(e.prop) ?? 0) + 1);
  byValue.set(e.value, cur);
}
const out = [...byValue.values()]
  .map((v) => ({ value: v.value, count: v.count, files: [...v.files], props: [...v.props.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}×${n}`) }))
  .sort((a, b) => b.count - a.count);
fs.writeFileSync('strings.all.json', JSON.stringify(out, null, 1));
console.log('unique:', out.length, 'occurrences:', out.reduce((n, x) => n + x.count, 0));
console.log('with space:', out.filter((x) => /\s/.test(x.value)).length);
for (const x of out.slice(0, 25)) console.log(x.count, JSON.stringify(x.value), x.props.join(','));
