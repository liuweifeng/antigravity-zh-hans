#!/usr/bin/env node
// Build the runtime text overlay.
//
// Antigravity serves its own index.html template, so script tags in the bundle
// dir are ignored. The overlay is therefore appended to main.js (served from
// the bundle dir) and also shipped as standalone files for the Swarm sidecar,
// which is a separate HTML app served from ~/.gemini.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'web');
const dict = JSON.parse(fs.readFileSync(path.join(root, 'translations/zh-Hans.json'), 'utf8'));
const patternsPath = path.join(root, 'translations/patterns.json');
const patterns = fs.existsSync(patternsPath) ? JSON.parse(fs.readFileSync(patternsPath, 'utf8')) : [];

const compact = {};
for (const [en, zh] of Object.entries(dict)) {
  if (en === zh || en.length > 400) continue;
  compact[en] = zh;
}

const overlayJs = `(function () {
  var DICT = window.__ZH_DICT__ || {};
  var PATTERNS = ${JSON.stringify(patterns)};
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, KBD: 1, SAMP: 1, SVG: 1 };
  var ATTRS = ['aria-label', 'placeholder', 'title', 'alt'];
  var pending = new Set();
  var scheduled = false;

  function skipped(el) {
    for (var n = el; n; n = n.parentElement) {
      if (SKIP_TAGS[n.tagName]) return true;
      if (n.isContentEditable) return true;
      if (n.dataset && n.dataset.zhSkip !== undefined) return true;
      if (n.classList && (n.classList.contains('monaco-editor') || n.classList.contains('cm-editor'))) return true;
    }
    return false;
  }

  function lookup(t) {
    var zh = DICT[t];
    if (zh && zh !== t) return zh;
    for (var i = 0; i < PATTERNS.length; i++) {
      var p = PATTERNS[i];
      var m;
      try { m = t.match(new RegExp(p.match)); } catch (e) { continue; }
      if (!m) continue;
      return p.zh.replace(/\\$(\\d)/g, function (_, n) { return m[Number(n)] || ''; });
    }
    return null;
  }

  function translateText(node) {
    var raw = node.nodeValue;
    if (!raw) return;
    var t = raw.trim();
    if (!t) return;
    var zh = lookup(t);
    if (!zh) return;
    var lead = raw.slice(0, raw.length - raw.trimStart().length);
    var trail = raw.slice(raw.trimEnd().length);
    node.nodeValue = lead + zh + trail;
  }

  function translateAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute && el.getAttribute(a);
      if (!v) continue;
      var zh = lookup(v.trim());
      if (zh) el.setAttribute(a, zh);
    }
  }

  function walk(root) {
    if (!root || root.nodeType === 8) return;
    if (root.nodeType === 3) {
      if (root.parentElement && !skipped(root.parentElement)) translateText(root);
      return;
    }
    if (root.nodeType !== 1) return;
    if (skipped(root)) return;
    translateAttrs(root);
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = tw.nextNode())) translateText(n);
  }

  function flush() {
    scheduled = false;
    var roots = pending;
    pending = new Set();
    roots.forEach(function (r) { try { walk(r); } catch (e) {} });
  }

  function queue(root) {
    if (!root) return;
    pending.add(root);
    if (!scheduled) { scheduled = true; window.requestAnimationFrame(flush); }
  }

  function start() {
    walk(document.body);
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'characterData') queue(r.target);
        else if (r.type === 'attributes') queue(r.target);
        else for (var j = 0; j < r.addedNodes.length; j++) queue(r.addedNodes[j]);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
`;

fs.writeFileSync(path.join(webDir, 'zh-dict.js'), `window.__ZH_DICT__=${JSON.stringify(compact)};\n`);
fs.writeFileSync(path.join(webDir, 'zh-overlay.js'), overlayJs);

const MARK = '/* zh-overlay */';
const mainPath = path.join(webDir, 'main.js');
fs.chmodSync(mainPath, 0o644);
let main = fs.readFileSync(mainPath, 'utf8');
const markerAt = main.indexOf(MARK);
if (markerAt !== -1) main = main.slice(0, markerAt);
fs.writeFileSync(mainPath, `${main}\n${MARK}\nwindow.__ZH_DICT__=${JSON.stringify(compact)};\n${overlayJs}`);

console.log(`overlay: ${Object.keys(compact).length} entries, ${patterns.length} patterns -> web/main.js + zh-overlay.js`);
