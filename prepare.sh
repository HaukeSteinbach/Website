#!/usr/bin/env bash
#
# Konfiguration vorbereiten — auf DEINEM Rechner ausführen, nicht auf dem Server.
#
#   ./prepare.sh
#
# Für den Fall, dass jemand anderes den Server bedient. Fragt hier nach allem,
# was geheim ist, und legt eine fertige Datei ab, die weitergegeben werden kann.
#
# Dein Admin-Passwort ist darin nicht enthalten — nur sein Hash, aus dem es sich
# nicht zurückrechnen lässt. Wer die Datei einspielt, kann sich damit also nicht
# in deiner Projektübersicht anmelden.
#
# Gebraucht wird nur node.

set -euo pipefail

AUSGABE="${1:-$HOME/Desktop/steinbach-server-konfiguration.txt}"
HIER="$(cd "$(dirname "$0")" && pwd)"

if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; N=$'\033[0m'
else
  B=''; DIM=''; R=''; G=''; Y=''; N=''
fi

schritt() { printf '\n%s──  %s  %s\n' "$B" "$1" "$N"; }
ok()      { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
warn()    { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
fehler()  { printf '\n  %s✗ %s%s\n\n' "$R" "$1" "$N"; exit 1; }
hinweis() { printf '  %s%s%s\n' "$DIM" "$1" "$N"; }

command -v node >/dev/null || fehler "node ist nicht installiert."
[ -f "$HIER/backend/src/middleware/auth.js" ] || fehler "Das Skript muss im Website-Verzeichnis liegen."

frage() {                          # frage "Text" -> Antwort auf stdout
  local text="$1" antwort
  while true; do
    printf '  %s\n  > ' "$text" >&2
    read -r antwort
    antwort="${antwort#"${antwort%%[![:space:]]*}"}"
    antwort="${antwort%"${antwort##*[![:space:]]}"}"
    [ -n "$antwort" ] && { printf '%s' "$antwort"; return; }
    printf '  %s!%s Das Feld wird gebraucht.\n' "$Y" "$N" >&2
  done
}

cat <<EOF

${B}Steinbach — Konfiguration vorbereiten${N}
${DIM}Läuft hier auf deinem Rechner. Am Ende liegt eine Datei auf dem
Schreibtisch, die zusammen mit einem Befehl weitergegeben wird.${N}
EOF

# ── 1. Cloudflare R2 ─────────────────────────────────────────────────────────
schritt "1 von 3 · Cloudflare R2"

cat <<EOF
  Der Bucket ${B}steinbach-filehandoff${N} ist schon angelegt. Es fehlt ein
  Zugangsschlüssel dafür:

    1. ${B}dash.cloudflare.com${N} öffnen
    2. links auf ${B}R2${N}
    3. rechts oben ${B}Manage API tokens${N}
    4. ${B}Create API token${N}
    5. Permissions: ${B}Object Read & Write${N}
    6. bei "Specify bucket" ${B}steinbach-filehandoff${N} wählen
    7. ${B}Create API Token${N}

  Cloudflare zeigt danach drei Werte. Die kommen jetzt hier rein.
  ${DIM}Das Secret zeigt Cloudflare nur ein einziges Mal — vorher kopieren.${N}

EOF

R2_KEY=$(frage "Access Key ID          ${DIM}(einfügen)${N}")
R2_SECRET=$(frage "Secret Access Key      ${DIM}(einfügen)${N}")
echo >&2
hinweis "Der Endpunkt steht auf derselben Seite und sieht so aus:"
hinweis "https://abc123....r2.cloudflarestorage.com"
echo >&2
R2_ENDPOINT=$(frage "S3-Endpunkt            ${DIM}(einfügen, mit https://)${N}")

case "$R2_ENDPOINT" in
  https://*r2.cloudflarestorage.com*) ok "sieht richtig aus" ;;
  *) warn "Das sieht nicht nach einem R2-Endpunkt aus — trotzdem übernommen." ;;
esac

# ── 2. Passwort ──────────────────────────────────────────────────────────────
schritt "2 von 3 · Dein Passwort für die Projektübersicht"

echo "  Damit meldest du dich auf haukesteinbach.de/admin.html an."
echo "  Mindestens 12 Zeichen. Die Eingabe bleibt unsichtbar."
echo "  ${DIM}Es wird sofort in einen Hash umgerechnet. Nur der wird weitergegeben.${N}"
echo

while true; do
  printf '  Passwort         > '; read -rs PW1; echo
  printf '  noch einmal      > '; read -rs PW2; echo
  [ "$PW1" != "$PW2" ] && { warn "Die beiden stimmen nicht überein."; continue; }
  [ "${#PW1}" -lt 12 ] && { warn "Zu kurz (${#PW1} Zeichen), es müssen mindestens 12 sein."; continue; }
  break
done

HASH=$(cd "$HIER/backend" && node scripts/admin-password.js --quiet "$PW1" 2>/dev/null | grep -o 'scrypt\$[^ ]*' | tail -1) \
  || fehler "Der Hash konnte nicht berechnet werden."
[ -n "$HASH" ] || fehler "Der Hash kam leer zurück."
unset PW1 PW2
ok "Hash erzeugt — das Passwort selbst geht nirgendwo hin"

GEHEIMNIS=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ok "SESSION_SECRET erzeugt"

# ── 3. Mail ──────────────────────────────────────────────────────────────────
schritt "3 von 3 · Mailversand an Kunden"

cat <<EOF
  ${B}Ohne diesen Schritt bekommt kein Kunde eine Mail.${N}
  Die Lieferung entsteht trotzdem — die Projektübersicht sagt dir dann, dass
  die Mail nicht rausging, und zeigt dir den Link zum selbst Verschicken.

  Die Daten stehen bei deinem Mailanbieter unter "SMTP" oder "Postausgang".
  Mit Enter überspringen und später nachtragen geht auch.

EOF

printf '  SMTP-Server      %s(z.B. smtp.strato.de — Enter zum Überspringen)%s\n  > ' "$DIM" "$N"
read -r SMTP_HOST

SMTP_BLOCK=""
if [ -n "$SMTP_HOST" ]; then
  SMTP_USER=$(frage "Benutzername     ${DIM}(meist die Mailadresse)${N}")
  printf '  Passwort         > '; read -rs SMTP_PW; echo
  printf '  Port             %s(587 für STARTTLS, 465 für SSL — Enter für 587)%s\n  > ' "$DIM" "$N"
  read -r SMTP_PORT; SMTP_PORT="${SMTP_PORT:-587}"
  [ "$SMTP_PORT" = "465" ] && SMTP_SECURE=true || SMTP_SECURE=false

  SMTP_BLOCK="SMTP_HOST=$SMTP_HOST
SMTP_USER=$SMTP_USER
SMTP_PASSWORD=$SMTP_PW
SMTP_PORT=$SMTP_PORT
SMTP_SECURE=$SMTP_SECURE"
  unset SMTP_PW
  ok "Mailversand eingerichtet"
else
  ok "übersprungen — Kunden bekommen vorerst keine Mail"
fi

# ── Datei schreiben ──────────────────────────────────────────────────────────
umask 077
cat > "$AUSGABE" <<EOF
# ============================================================================
# Steinbach — Serverkonfiguration, erzeugt am $(date '+%d.%m.%Y um %H:%M')
# ============================================================================
#
# ANLEITUNG (für wen den Server bedient)
#
#   Server: 116.203.28.158 · Verzeichnis mit docker-compose.runtime.yml
#
#   1. Neuesten Stand holen
#        git pull
#      Falls das kein Git-Verzeichnis ist:
#        curl -fsSLO https://raw.githubusercontent.com/HaukeSteinbach/Website/main/setup.sh
#        chmod +x setup.sh
#
#   2. Diese Datei ablegen
#        cp <diese-datei> backend/.env.runtime
#        chmod 600 backend/.env.runtime
#
#   3. Starten
#        ./setup.sh
#
#      Fragt nichts — alles Nötige steht hier drin. Es holt das Image, startet
#      es und prüft am Ende, ob es läuft. Erwartete Ausgabe:
#
#        [ok] Laeuft, und der Bucket ist erreichbar
#        [ok] Adminbereich ist entsperrt
#
#      Kommt stattdessen ein Fehler, stehen darunter die Logzeilen, die sagen
#      warum.
#
#   4. Diese Datei danach löschen — sie enthält Zugangsdaten.
#
# Der Rest der Website läuft weiter wie bisher; das hier schaltet nur den
# Dateiaustausch und die Projektübersicht scharf.
# ============================================================================

S3_ENDPOINT=$R2_ENDPOINT
S3_BUCKET=steinbach-filehandoff
S3_REGION=auto
S3_ACCESS_KEY=$R2_KEY
S3_SECRET_KEY=$R2_SECRET

ADMIN_PASSWORD_HASH=$HASH
SESSION_SECRET=$GEHEIMNIS
$SMTP_BLOCK

MAIL_FROM_EMAIL=mail@haukesteinbach.de
NOTIFICATION_EMAIL=mail@haukesteinbach.de
APP_ORIGIN=https://haukesteinbach.de
CORS_ALLOWED_ORIGINS=https://haukesteinbach.de
FORMSPREE_UPLOAD_ENDPOINT=https://formspree.io/f/xgopedgb
UPLOAD_DIR=/var/lib/steinbach/uploads
SOURCE_DOWNLOAD_LINK_TTL_HOURS=168
PORT=3000
NODE_ENV=production
EOF
chmod 600 "$AUSGABE"

cat <<EOF

${G}${B}Fertig.${N}

  Die Datei liegt hier:
  ${B}$AUSGABE${N}

  ${DIM}Sie enthält deine Cloudflare- und Mail-Zugangsdaten, aber nicht dein
  Passwort für die Projektübersicht — nur dessen Hash.${N}

  ${B}Das gibst du weiter:${N}

    1. diese Datei
    2. die Anweisung: auf dem Server ins Website-Verzeichnis, dann

         git pull
         cp <diese-datei> backend/.env.runtime
         chmod 600 backend/.env.runtime
         ./setup.sh

  ${DIM}setup.sh ergänzt nur noch, was fehlt, holt das Image, startet es und
  prüft am Ende, ob alles läuft. Es fragt nichts mehr.${N}

  ${Y}Nach dem Einspielen sollte die weitergegebene Datei gelöscht werden —
  bei dir und beim Empfänger.${N}

EOF
