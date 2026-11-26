#!/usr/bin/env node
// Patch strings inside app.asar without repacking it.
//
// asar stores file contents uncompressed; replacing a string literal with one of
// the exact same byte length keeps every offset valid. Padding goes after the
// closing quote as spaces, which the JS parser ignores.
import fs from 'node:fs';
import path from 'node:path';

const asarPath = process.argv[2] || '/Applications/Antigravity.app/Contents/Resources/app.asar';
const buf = fs.readFileSync(asarPath);

const pairs = [
  ["'No updates available'", "'已是最新版本'"],
  ["'Check for Updates'", "'检查更新'"],
];

function padTo(s, bytes) {
  const len = Buffer.byteLength(s, 'utf8');
  if (len > bytes) return null;
  return s + ' '.repeat(bytes - len);
}

let out = buf;
let changed = 0;
for (const [en, zh] of pairs) {
  const from = Buffer.from(en, 'utf8');
  let idx = out.indexOf(from);
  if (idx === -1) continue;
  const to = padTo(zh, from.length);
  if (!to) {
    console.error(`skip (too long): ${en}`);
    continue;
  }
  const toBuf = Buffer.from(to, 'utf8');
  if (toBuf.length !== from.length) {
    console.error(`skip (length): ${en}`);
    continue;
  }
  out = Buffer.concat([out.subarray(0, idx), toBuf, out.subarray(idx + from.length)]);
  changed++;
}

if (!changed) {
  console.log('app.asar: nothing to patch (already applied or strings missing)');
  process.exit(0);
}

const backup = `${asarPath}.orig`;
// keep the backup of the pre-patch file for the current app version
fs.writeFileSync(backup, buf);
fs.writeFileSync(asarPath, out);
console.log(`app.asar: ${changed} strings patched (backup: ${path.basename(backup)})`);