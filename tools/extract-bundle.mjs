#!/usr/bin/env node
// Extract the compiled web UI bundle that Antigravity's language_server serves.
// The bundle is a zip embedded in the Go binary; we locate it by its
// end-of-central-directory record and extract it with `unzip`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BIN = '/Applications/Antigravity.app/Contents/Resources/bin/language_server';
const outDir = process.argv[2] || path.resolve('bundle/pristine');

const buf = fs.readFileSync(BIN);
console.log(`language_server: ${buf.length} bytes`);

const EOCD = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const candidates = [];
for (let i = buf.indexOf(EOCD); i !== -1; i = buf.indexOf(EOCD, i + 1)) candidates.push(i);

let picked = null;
for (const eocd of candidates) {
  if (eocd + 22 > buf.length) continue;
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  const total = cdOff + cdSize + 22;
  const start = eocd + 22 - total;
  if (start < 0) continue;
  const central = buf.subarray(start + cdOff, start + cdOff + cdSize);
  if (!central.includes(Buffer.from('main.js'))) continue;
  picked = { start, total };
  break;
}

if (!picked) throw new Error('no zip containing main.js found in language_server');
console.log(`web bundle zip: offset ${picked.start}, ${picked.total} bytes`);

fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, '..', 'web.zip');
fs.writeFileSync(zipPath, buf.subarray(picked.start, picked.start + picked.total));
execFileSync('unzip', ['-oq', zipPath, '-d', outDir]);
const index = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
const title = /<title>(.*?)<\/title>/.exec(index)?.[1] ?? '?';
console.log(`extracted to ${outDir} (title: ${title}, files: ${fs.readdirSync(outDir).length})`);
