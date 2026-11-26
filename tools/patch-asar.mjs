#!/usr/bin/env node
// Patch Electron main-process strings in app.asar.
//
// Native dialogs (quit confirmation, update check) are drawn by the main process
// with strings of arbitrary length, so the archive is rebuilt once from the
// pristine backup and all patches are applied there. asar integrity validation is
// disabled in this app, so a repacked archive loads normally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const asarPath = process.argv[2] || '/Applications/Antigravity.app/Contents/Resources/app.asar';
const backup = `${asarPath}.orig`;
const source = asarPath;

const EDITS = {
  'dist/updater.js': [
    ["'No updates available'", "'已是最新版本'"],
    ["'Check for Updates'", "'检查更新'"],
    ["buttons: ['OK']", "buttons: ['确定']"],
  ],
  'dist/main.js': [
    ["buttons: ['Cancel', 'Quit']", "buttons: ['取消', '退出']"],
    ["title: 'Confirm Quit'", "title: '确认退出'"],
    ["message: 'Are you sure you want to quit?'", "message: '确定要退出吗？'"],
    ["detail: 'There may be agents or background tasks running.'", "detail: '可能有智能体或后台任务正在运行。'"],
  ],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-zh-'));
const unpackDir = 'node_modules/chrome-devtools-mcp';
const asarCli = ['--yes', '@electron/asar'];

// asar resolves unpacked entries next to the archive (<file>.unpacked); the
// backup has no such sibling, so borrow the real one while extracting.
const srcUnpacked = `${source}.unpacked`;
const realUnpacked = `${asarPath}.unpacked`;
const linked = !fs.existsSync(srcUnpacked) && fs.existsSync(realUnpacked);
if (linked) fs.symlinkSync(realUnpacked, srcUnpacked);

try {
  execFileSync('npx', [...asarCli, 'extract', source, tmp], { stdio: 'inherit' });

  let changed = 0;
  for (const [file, pairs] of Object.entries(EDITS)) {
    const p = path.join(tmp, file);
    if (!fs.existsSync(p)) continue;
    let text = fs.readFileSync(p, 'utf8');
    for (const [from, to] of pairs) {
      if (!text.includes(from)) continue;
      text = text.split(from).join(to);
      changed++;
    }
    fs.writeFileSync(p, text);
  }

  if (!changed) {
    console.log('app.asar: strings already patched');
    process.exit(0);
  }

  const outTmp = path.join(tmp, '..', `app-${process.pid}.asar`);
  execFileSync('npx', [...asarCli, 'pack', tmp, outTmp, '--unpack-dir', unpackDir], { stdio: 'inherit' });

  fs.copyFileSync(asarPath, backup); // keep the pre-patch file of this app version
  fs.copyFileSync(outTmp, asarPath);

  const unpackedSrc = `${outTmp}.unpacked`;
  const unpackedDst = `${asarPath}.unpacked`;
  if (fs.existsSync(unpackedSrc)) {
    fs.rmSync(unpackedDst, { recursive: true, force: true });
    fs.cpSync(unpackedSrc, unpackedDst, { recursive: true });
    fs.rmSync(unpackedSrc, { recursive: true, force: true });
  }
  fs.rmSync(outTmp, { force: true });

  console.log(`app.asar: ${changed} strings patched (backup: ${path.basename(backup)})`);
} finally {
  if (linked) fs.rmSync(srcUnpacked, { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
