#!/usr/bin/env node
// Translate the Swarm board sidecar.
//
// The board is a separate HTML app that the language server extracts to
// ~/.gemini/<app>/builtin/plugins/swarm/sidecars/swarm_board. It is not part of
// the main web bundle, so it gets its own copy of the runtime overlay plus a few
// in-place text fixes for strings that are concatenated around <code> tags.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const dir = process.argv[2] ||
  path.join(os.homedir(), '.gemini/antigravity/builtin/plugins/swarm/sidecars/swarm_board');
const webDir = process.argv[3] || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');

if (!fs.existsSync(path.join(dir, 'index.html'))) {
  console.error(`swarm board not found: ${dir}`);
  process.exit(1);
}

const htmlReplacements = [
  ['>No swarm in this conversation<', '>此对话中没有智能体集群<'],
  ['Watching for a swarm', '正在等待智能体集群'],
  ["Looking for this conversation's swarm…", '正在查找此对话的智能体集群…'],
];

const jsReplacements = [
  [
    'Swarms started in this conversation appear here automatically, with their board, ',
    '在此对话中启动的集群会自动出现在这里，连同看板、',
  ],
  ['members and @mention graph. Start one with <code>/swarm</code>.', '成员和 @ 提及关系图。使用 <code>/swarm</code> 启动一个。'],
  [
    'Open this pane from a conversation to see its swarm. Swarms started there ',
    '从对话中打开此面板即可查看其智能体集群。在那里启动的集群',
  ],
  ['appear here automatically; start one with <code>/swarm</code>.', '会自动出现在这里；使用 <code>/swarm</code> 启动一个。'],
];

function replaceAll(text, pairs) {
  let out = text;
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

const htmlPath = path.join(dir, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const before = html;
html = replaceAll(html, htmlReplacements);
if (!html.includes('zh-overlay.js')) {
  html = html.replace('</body>', '  <!-- zh-swarm -->\n  <script src="/zh-dict.js"></script>\n  <script defer src="/zh-overlay.js"></script>\n</body>');
}
if (html !== before) fs.writeFileSync(htmlPath, html);

const jsPath = path.join(dir, 'app.js');
if (fs.existsSync(jsPath)) {
  const beforeJs = fs.readFileSync(jsPath, 'utf8');
  const afterJs = replaceAll(beforeJs, jsReplacements);
  if (afterJs !== beforeJs) fs.writeFileSync(jsPath, afterJs);
}

for (const f of ['zh-dict.js', 'zh-overlay.js']) {
  fs.copyFileSync(path.join(webDir, f), path.join(dir, f));
}

console.log(`swarm board patched: ${dir}`);
