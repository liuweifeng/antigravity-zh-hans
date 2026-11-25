#!/bin/sh
# Remove the wrapper and restore the original language_server binary.
set -eu
BIN="/Applications/Antigravity.app/Contents/Resources/bin"

if [ -f "$BIN/language_server.real" ]; then
  rm -f "$BIN/language_server"
  mv "$BIN/language_server.real" "$BIN/language_server"
  chmod +x "$BIN/language_server"
  echo "restored original language_server"
else
  echo "nothing to restore"
fi
