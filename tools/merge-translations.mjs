#!/usr/bin/env node
// Merge translation batches into translations/zh-Hans.json.
// Sources: work/batch-*.zh.json, work/miss2-*.zh.json,
//          translations/zh-Hans.demo.json (curated, wins),
//          translations/zh-Hans.extra.json (curated extras, wins).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = path.join(root, 'work');

const wanted = new Set();
for (const file of ['catalog/strings.json', 'work/missing-ui.json', 'work/single-filtered.json']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  for (const x of JSON.parse(fs.readFileSync(p, 'utf8'))) wanted.add(x.value);
}

const placeholders = (s) => (s.match(/%[sdif@]|\{\d+\}|[{}]/g) || []).sort().join(',');

const merged = new Map();
const problems = [];
const batches = fs.readdirSync(workDir).filter((f) => /^(batch-\d+|miss2-\d+|single-filtered)\.zh\.json$/.test(f));
for (const file of batches) {
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(path.join(workDir, file), 'utf8'));
  } catch (err) {
    problems.push(`${file}: invalid JSON (${err.message})`);
    continue;
  }
  let n = 0;
  for (const [en, zh] of Object.entries(obj)) {
    if (typeof zh !== 'string' || !zh.trim()) continue;
    if (!wanted.has(en)) continue;
    if (placeholders(en) !== placeholders(zh)) {
      problems.push(`${file}: placeholder mismatch ${JSON.stringify(en)}`);
      continue;
    }
    merged.set(en, zh);
    n++;
  }
  console.log(`${file}: ${n} kept`);
}

for (const file of ['translations/zh-Hans.demo.json', 'translations/zh-Hans.extra.json']) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) continue;
  const curated = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  for (const [en, zh] of Object.entries(curated)) {
    if (typeof zh !== 'string' || !zh.trim()) continue;
    if (placeholders(en) !== placeholders(zh)) {
      problems.push(`${file}: placeholder mismatch ${JSON.stringify(en)}`);
      continue;
    }
    merged.set(en, zh);
    wanted.add(en);
    n++;
  }
  console.log(`${file}: ${n} curated`);
}

const missing = [...wanted].filter((v) => !merged.has(v));
const identity = [...merged.entries()].filter(([en, zh]) => en === zh).map(([en]) => en);

const out = {};
for (const en of [...merged.keys()].sort()) out[en] = merged.get(en);
fs.writeFileSync(path.join(root, 'translations/zh-Hans.json'), JSON.stringify(out, null, 1) + '\n');

console.log(`\nmerged: ${Object.keys(out).length} (target ${wanted.size})`);
console.log(`missing: ${missing.length}, identity: ${identity.length}`);
if (problems.length) {
  console.log(`problems: ${problems.length}`);
  for (const p of problems.slice(0, 15)) console.log('  ' + p);
}
if (missing.length) fs.writeFileSync(path.join(workDir, 'missing.json'), JSON.stringify(missing, null, 1));
