#!/bin/sh
# 完整构建：解出原始 bundle（如缺失）-> 套用翻译 -> 语法自检
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

if [ ! -f bundle/pristine/main.js ]; then
  echo "== extract bundle =="
  node tools/extract-bundle.mjs
fi

if [ ! -f translations/zh-Hans.json ]; then
  echo "translations/zh-Hans.json missing; run tools/merge-translations.mjs" >&2
  exit 1
fi

echo "== patch =="
node tools/patch.mjs --map translations/zh-Hans.json

echo "== syntax check =="
for f in web/main.js web/page_agent_bundle.js web/page_facade_bundle.js; do
  node --check "$f" && echo "ok $f"
done

echo "== stats =="
printf 'translated strings: %s\n' "$(node -e 'console.log(Object.keys(require("./translations/zh-Hans.json")).length)')"
printf 'web bundle: %s\n' "$(du -sh web | cut -f1)"
