#!/bin/sh
# Preview the localized bundle without touching Antigravity:
# starts the bundled language_server with -web_bundle_path pointing at ./web.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUNDLE=${1:-"$ROOT/web"}
PORT=${PORT:-8899}
CSRF=${CSRF:-local-preview}
BIN="/Applications/Antigravity.app/Contents/Resources/bin/language_server"

exec "$BIN" \
  --standalone \
  --override_ide_name antigravity \
  --subclient_type hub \
  --override_ide_version "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Antigravity.app/Contents/Info.plist)" \
  --override_user_agent_name antigravity \
  --https_server_port "$PORT" \
  --csrf_token "$CSRF" \
  --app_data_dir antigravity-zh-preview \
  --web_bundle_path "$BUNDLE"
