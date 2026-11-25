#!/bin/sh
# Make Antigravity serve a bundled web UI from disk.
# Works by wrapping resources/bin/language_server (a shell script that execs the
# real binary with -web_bundle_path). Nothing inside app.asar or the signed
# binary is modified, so reverting is a single mv.
set -eu
BIN="/Applications/Antigravity.app/Contents/Resources/bin"
WEB_DIR=${1:-"$HOME/Library/Application Support/Antigravity/zh-web"}

if [ ! -f "$WEB_DIR/main.js" ] || [ ! -f "$WEB_DIR/index.html" ]; then
  echo "not a web bundle (main.js/index.html missing): $WEB_DIR" >&2
  exit 1
fi

if [ ! -f "$BIN/language_server.real" ]; then
  mv "$BIN/language_server" "$BIN/language_server.real"
fi

cat > "$BIN/language_server" <<EOF
#!/bin/sh
WEB_DIR="\${ANTIGRAVITY_WEB_BUNDLE_PATH:-$WEB_DIR}"
if [ -f "\$WEB_DIR/main.js" ]; then
  exec "\$(dirname "\$0")/language_server.real" "\$@" --web_bundle_path="\$WEB_DIR"
fi
exec "\$(dirname "\$0")/language_server.real" "\$@"
EOF
chmod +x "$BIN/language_server"

echo "installed. web bundle: $WEB_DIR"
echo "quit and reopen Antigravity to apply."
