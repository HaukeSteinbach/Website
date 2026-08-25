#!/bin/bash
# Veröffentlicht das UI Studio (Audio-Fassung) in den privaten Supabase-Storage.
#
# Das Werkzeug wird NICHT mit dieser Website ausgeliefert. uistudio.html ist nur
# das Anmelde-Tor; die eigentliche Datei holt die Edge Function cockpit-content
# aus installers/_docs/uistudio-audio.html. Ein Deploy dieser Website ändert am
# Werkzeug also nichts — dafür ist dieses Skript da.
#
#   ./tools-publish-uistudio.sh
#
# Braucht SUPABASE_SERVICE_ROLE_KEY in der Umgebung oder in
# ~/Developer/03_Websites/steinbach-instruments/.env.local. Der Schlüssel gehört
# zum Supabase-Projekt der Instrumente — dort liegt der Bucket.
#
# Der alte Stand wird vorher heruntergeladen und daneben gelegt. Ein Upload mit
# x-upsert überschreibt ohne Rückfrage, und die Datei ist die einzige Kopie im
# Netz.
set -eu

PROJEKT="eojchbkieeqyfgfazydk"
BUCKET="installers"
ZIEL="_docs/uistudio-audio.html"
QUELLE="$(dirname "$0")/tools/uistudio/uistudio-audio.html"
SICHERUNG="$(dirname "$0")/tools/uistudio/uistudio-audio.VORHER.html"

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  ENVDATEI="$HOME/Developer/03_Websites/steinbach-instruments/.env.local"
  if [ -f "$ENVDATEI" ]; then
    # shellcheck disable=SC1090
    SUPABASE_SERVICE_ROLE_KEY="$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' "$ENVDATEI" | cut -d= -f2-)"
  fi
fi

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "SUPABASE_SERVICE_ROLE_KEY fehlt. Entweder exportieren oder in" >&2
  echo "steinbach-instruments/.env.local hinterlegen. Der Schlüssel steht in" >&2
  echo "https://supabase.com/dashboard/project/$PROJEKT/settings/api-keys" >&2
  exit 1
fi

test -f "$QUELLE" || { echo "Nicht gefunden: $QUELLE" >&2; exit 1; }

BASIS="https://$PROJEKT.supabase.co/storage/v1/object"

# Der Schlüssel geht über eine curl-Konfigurationsdatei mit 600-Rechten, nicht
# als -H auf der Kommandozeile: Argumente stehen in der Prozessliste und sind
# damit für jeden auf dem Rechner lesbar.
KONF="$(mktemp)"
chmod 600 "$KONF"
trap 'rm -f "$KONF"' EXIT INT TERM
{
  printf 'header = "apikey: %s"\n' "$SUPABASE_SERVICE_ROLE_KEY"
  printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_SERVICE_ROLE_KEY"
} > "$KONF"

echo "→ alten Stand sichern …"
if curl -fsS -K "$KONF" "$BASIS/$BUCKET/$ZIEL" -o "$SICHERUNG"; then
  echo "  ✓ $SICHERUNG ($(wc -c < "$SICHERUNG" | tr -d ' ') Bytes)"
else
  echo "  · noch nichts da — erste Veröffentlichung"
fi

echo "→ hochladen ($(wc -c < "$QUELLE" | tr -d ' ') Bytes) …"
curl -fsS -K "$KONF" -X POST "$BASIS/$BUCKET/$ZIEL" \
  -H "Content-Type: text/html" \
  -H "x-upsert: true" \
  --data-binary "@$QUELLE" > /dev/null

BAUSTAND="$(grep -o 'id="buildTag"[^>]*>[^<]*' "$QUELLE" | sed 's/.*>//')"
echo "  ✓ veröffentlicht · Baustand: $BAUSTAND"
echo
echo "Prüfen: https://haukesteinbach.de/uistudio.html — steht oben neben dem"
echo "Namen ein anderer Baustand, läuft noch die alte Kopie im Browser-Cache."
