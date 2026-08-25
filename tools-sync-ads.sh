#!/bin/bash
# Holt die drei geteilten Dateien aus dem Instruments-Repo hierher.
#
# Der Adminbereich von Steinbach Audio nutzt dieselbe Anzeigen-Oberfläche wie
# der von Steinbach Instruments. Die CSP dieser Seite erlaubt nur eigene
# Skripte ("script-src 'self'"), deshalb liegen sie als Kopie hier statt per
# Verweis auf die andere Domain. Nach jeder Änderung an ads.js dort:
#
#   ./tools-sync-ads.sh
#
set -eu
QUELLE="${1:-$HOME/Developer/03_Websites/steinbach-instruments/assets/js}"
ZIEL="$(dirname "$0")/assets/js/ads"
for f in store-config.js store.js ads.js; do
  cp "$QUELLE/$f" "$ZIEL/$f"
  echo "  ✓ $f"
done
echo "Abgeglichen aus $QUELLE"
