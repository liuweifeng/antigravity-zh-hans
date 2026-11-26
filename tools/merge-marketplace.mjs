#!/usr/bin/env node
// Merge translated marketplace entries (work/mkt-*.zh.json) into
// translations/marketplace-extra.json, keeping hand-written entries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workDir = path.join(root, 'work');
const outPath = path.join(root, 'translations/marketplace-extra.json');

const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
let added = 0;

for (const file of fs.readdirSync(workDir).filter((f) => /^mkt-\d+\.zh\.json$/.test(f))) {
  const rows = JSON.parse(fs.readFileSync(path.join(workDir, file), 'utf8'));
  for (const r of rows) {
    if (r.name && r.zh_name && r.zh_name !== r.name) {
      out[r.name] = r.zh_name;
      added++;
    }
    if (r.desc && r.zh_desc) {
      out[r.desc] = r.zh_desc;
      added++;
    }
  }
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(`marketplace entries: ${Object.keys(out).length} (merged ${added} from batches)`);
