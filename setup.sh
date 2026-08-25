#!/usr/bin/env bash
#
# Einrichten und Ausrollen — auf dem Server ausführen.
#
#   ./setup.sh
#
# Fragt nach dem, was fehlt, schreibt backend/.env.runtime, holt das Image und
# startet es. Mehrfach ausführbar: was schon eingetragen ist, wird nicht noch
# einmal gefragt. Die alte .env.runtime wird vorher gesichert.
#
# Gebraucht werden nur docker und curl.

set -euo pipefail

IMAGE="ghcr.io/haukesteinbach/haukesteinbach"
ENV_FILE="backend/.env.runtime"
COMPOSE_FILE="docker-compose.runtime.yml"

# ── Anzeige ──────────────────────────────────────────────────────────────────
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

# ── Vorbedingungen ───────────────────────────────────────────────────────────
command -v docker >/dev/null || fehler "docker ist nicht installiert."
docker compose version >/dev/null 2>&1 || fehler "docker compose fehlt (die alte Version 'docker-compose' reicht nicht)."
[ -f "$COMPOSE_FILE" ] || fehler "$COMPOSE_FILE nicht gefunden. Das Skript muss im Verzeichnis der Website laufen."

mkdir -p backend
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

# ── Lesen und Schreiben von .env.runtime ─────────────────────────────────────
lies() {                                   # lies SCHLUESSEL -> Wert oder leer
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

setze() {                                  # setze SCHLUESSEL WERT
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  grep -vE "^$key=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

frage() {                                  # frage SCHLUESSEL "Frage" [pflicht]
  local key="$1" text="$2" pflicht="${3:-ja}" vorhanden antwort
  vorhanden=$(lies "$key")

  if [ -n "$vorhanden" ]; then
    ok "$key steht schon drin"
    return
  fi

  while true; do
    printf '  %s\n  > ' "$text"
    read -r antwort
    antwort="${antwort#"${antwort%%[![:space:]]*}"}"     # Leerzeichen vorne weg
    antwort="${antwort%"${antwort##*[![:space:]]}"}"     # und hinten

    if [ -n "$antwort" ]; then
      setze "$key" "$antwort"
      ok "$key gespeichert"
      return
    fi

    if [ "$pflicht" != "ja" ]; then
      ok "$key bleibt leer"
      return
    fi

    warn "Das Feld wird gebraucht."
  done
}

# ── Sicherung ────────────────────────────────────────────────────────────────
if [ -s "$ENV_FILE" ]; then
  SICHERUNG="$ENV_FILE.$(date +%Y%m%d-%H%M%S).bak"
  cp "$ENV_FILE" "$SICHERUNG"
  chmod 600 "$SICHERUNG"
  hinweis "Alte Fassung gesichert: $SICHERUNG"
fi

cat <<EOF

${B}Steinbach — Einrichten${N}
${DIM}Alles, was schon eingetragen ist, wird übersprungen.
Abbrechen mit Strg+C ändert nichts Bleibendes.${N}
EOF

# ── 1. Cloudflare R2 ─────────────────────────────────────────────────────────
schritt "1 von 5 · Cloudflare R2"

if [ -n "$(lies S3_ACCESS_KEY)" ] && [ -n "$(lies S3_SECRET_KEY)" ] && [ -n "$(lies S3_ENDPOINT)" ]; then
  ok "R2 ist schon eingetragen"
else
  cat <<EOF
  Der Bucket ${B}steinbach-filehandoff${N} ist bereits angelegt.
  Was noch fehlt, ist ein Zugangsschlüssel dafür:

    1. dash.cloudflare.com öffnen
    2. links ${B}R2${N} anklicken
    3. rechts oben ${B}Manage API tokens${N}
    4. ${B}Create API token${N}
    5. Permissions auf ${B}Object Read & Write${N} stellen
    6. bei "Specify bucket" ${B}steinbach-filehandoff${N} auswählen
    7. ${B}Create API Token${N}

  Danach zeigt Cloudflare drei Dinge an. Die kommen jetzt hier rein.
  ${DIM}Die Seite schließt sich nach dem Verlassen — vorher kopieren.${N}

EOF
  frage S3_ACCESS_KEY "Access Key ID           ${DIM}(einfügen)${N}"
  frage S3_SECRET_KEY "Secret Access Key       ${DIM}(einfügen)${N}"

  echo
  hinweis "Der Endpunkt steht auf derselben Seite unter 'Use jurisdiction-specific"
  hinweis "endpoints' bzw. direkt als S3-Endpunkt. Er sieht so aus:"
  hinweis "https://abc123....r2.cloudflarestorage.com"
  echo
  frage S3_ENDPOINT "S3-Endpunkt             ${DIM}(einfügen, mit https://)${N}"
fi

setze S3_BUCKET steinbach-filehandoff
setze S3_REGION auto

# ── 2. Passwort für den Adminbereich ─────────────────────────────────────────
schritt "2 von 5 · Passwort für die Projektübersicht"

if [ -n "$(lies ADMIN_PASSWORD_HASH)" ]; then
  ok "Passwort ist schon gesetzt"
  hinweis "Neu setzen: Zeile ADMIN_PASSWORD_HASH= aus $ENV_FILE löschen und nochmal starten."
else
  echo "  Damit meldest du dich später auf /admin.html an."
  echo "  Mindestens 12 Zeichen. Die Eingabe bleibt unsichtbar."
  echo

  while true; do
    printf '  Passwort         > '; read -rs PW1; echo
    printf '  noch einmal      > '; read -rs PW2; echo

    if [ "$PW1" != "$PW2" ]; then
      warn "Die beiden stimmen nicht überein."
      continue
    fi

    if [ "${#PW1}" -lt 12 ]; then
      warn "Zu kurz (${#PW1} Zeichen). Es müssen mindestens 12 sein."
      continue
    fi

    break
  done

  echo
  hinweis "Hash wird im Image berechnet, das Passwort verlässt diesen Rechner nicht…"

  HASH=$(docker run --rm --entrypoint node "$IMAGE:latest" \
           scripts/admin-password.js --quiet "$PW1" 2>/dev/null \
           | grep -o 'scrypt\$[^ ]*' | tail -1) \
    || fehler "Der Hash konnte nicht berechnet werden. Läuft docker und ist das Image erreichbar?"

  case "$HASH" in
    scrypt\$*) ;;
    *) fehler "Unerwartete Antwort beim Hashen: ${HASH:-（leer）}" ;;
  esac

  setze ADMIN_PASSWORD_HASH "$HASH"
  unset PW1 PW2
  ok "Passwort gesetzt"
fi

if [ -z "$(lies SESSION_SECRET)" ]; then
  setze SESSION_SECRET "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  ok "SESSION_SECRET erzeugt"
else
  ok "SESSION_SECRET steht schon drin"
fi

# ── 3. Mailversand ───────────────────────────────────────────────────────────
schritt "3 von 5 · Mailversand an Kunden"

if [ -n "$(lies SMTP_HOST)" ]; then
  ok "SMTP ist eingetragen ($(lies SMTP_HOST))"
else
  cat <<EOF
  ${B}Ohne diesen Schritt bekommt kein Kunde eine Mail.${N}
  Die Lieferung wird trotzdem angelegt — die Projektübersicht sagt dir dann,
  dass die Mail nicht rausging, und zeigt den Link zum selbst Verschicken.

  Die Zugangsdaten stehen bei deinem Mailanbieter unter "SMTP" oder
  "Postausgang". Leer lassen geht auch, dann später nachtragen.

EOF
  frage SMTP_HOST     "SMTP-Server      ${DIM}(z.B. smtp.strato.de — leer lassen zum Überspringen)${N}" nein

  if [ -n "$(lies SMTP_HOST)" ]; then
    frage SMTP_USER     "Benutzername     ${DIM}(meist die Mailadresse)${N}"
    printf '  Passwort         > '; read -rs SMTP_PW; echo
    setze SMTP_PASSWORD "$SMTP_PW"; unset SMTP_PW
    ok "SMTP_PASSWORD gespeichert"

    printf '  Port             %s(587 für STARTTLS, 465 für SSL — Enter für 587)%s\n  > ' "$DIM" "$N"
    read -r SMTP_PORT_EIN; SMTP_PORT_EIN="${SMTP_PORT_EIN:-587}"
    setze SMTP_PORT "$SMTP_PORT_EIN"
    if [ "$SMTP_PORT_EIN" = "465" ]; then setze SMTP_SECURE true; else setze SMTP_SECURE false; fi
    ok "Port $SMTP_PORT_EIN"
  fi
fi

[ -n "$(lies MAIL_FROM_EMAIL)" ]   || setze MAIL_FROM_EMAIL mail@haukesteinbach.de
[ -n "$(lies NOTIFICATION_EMAIL)" ] || setze NOTIFICATION_EMAIL mail@haukesteinbach.de

# ── 4. Der Rest ──────────────────────────────────────────────────────────────
schritt "4 von 5 · Grundeinstellungen"

[ -n "$(lies PORT)" ]                 || setze PORT 3000
[ -n "$(lies NODE_ENV)" ]             || setze NODE_ENV production
[ -n "$(lies APP_ORIGIN)" ]           || setze APP_ORIGIN https://haukesteinbach.de
[ -n "$(lies CORS_ALLOWED_ORIGINS)" ] || setze CORS_ALLOWED_ORIGINS https://haukesteinbach.de
[ -n "$(lies UPLOAD_DIR)" ]           || setze UPLOAD_DIR /var/lib/steinbach/uploads
[ -n "$(lies SOURCE_DOWNLOAD_LINK_TTL_HOURS)" ] || setze SOURCE_DOWNLOAD_LINK_TTL_HOURS 168
[ -n "$(lies FORMSPREE_UPLOAD_ENDPOINT)" ] || setze FORMSPREE_UPLOAD_ENDPOINT https://formspree.io/f/xgopedgb
ok "eingetragen"

# ── 5. Ausrollen ─────────────────────────────────────────────────────────────
schritt "5 von 5 · Ausrollen"

TAG="${1:-}"
if [ -z "$TAG" ]; then
  hinweis "Neueste Fassung wird geholt…"
  TAG=$(curl -fsSL "https://api.github.com/repos/HaukeSteinbach/Website/commits/main" 2>/dev/null \
        | grep -m1 '"sha"' | cut -d'"' -f4) || true
  [ -n "$TAG" ] || TAG="latest"
fi

printf 'IMAGE_TAG=%s\nHOST_PORT=%s\n' "$TAG" "${HOST_PORT:-3000}" > .env
ok "Fassung ${TAG:0:12}"

echo
hinweis "Image wird geholt und gestartet…"
docker compose -f "$COMPOSE_FILE" up -d 2>&1 | sed 's/^/  /'

# ── Prüfen ───────────────────────────────────────────────────────────────────
schritt "Prüfen"

hinweis "Warte auf den Container…"
GESUND=""
for _ in $(seq 1 30); do
  sleep 2
  ANTWORT=$(curl -fsS "http://127.0.0.1:${HOST_PORT:-3000}/health" 2>/dev/null) || continue
  GESUND="$ANTWORT"
  break
done

if [ -z "$GESUND" ]; then
  warn "Der Container antwortet nicht. Was er sagt:"
  docker compose -f "$COMPOSE_FILE" logs --tail 30 2>&1 | sed 's/^/    /'
  fehler "Nicht gestartet. Die Zeilen oben sagen meist warum."
fi

echo "$GESUND" | grep -q '"ok":true' \
  && ok "Läuft, und der Bucket ist erreichbar" \
  || warn "Läuft, aber der Speicher meldet ein Problem:"

echo "$GESUND" | sed 's/^/    /'

if echo "$GESUND" | grep -q '"admin":"configured"'; then
  ok "Adminbereich ist entsperrt"
else
  warn "Adminbereich ist noch gesperrt — Passwort oder SESSION_SECRET fehlt"
fi

if [ -z "$(lies SMTP_HOST)" ]; then
  echo
  warn "Kein SMTP: Kunden bekommen keine Mail. Die Übersicht zeigt dir dann"
  warn "den Link zum selbst Verschicken. Nachtragen: dieses Skript nochmal starten."
fi

cat <<EOF

${G}${B}Fertig.${N}

  Projektübersicht   https://haukesteinbach.de/admin.html
  Kunden-Upload      https://haukesteinbach.de/upload.html

  ${DIM}Nächstes Mal reicht ./setup.sh — es fragt nur, was noch fehlt.
  Zugangsdaten liegen in $ENV_FILE (nur für dich lesbar).${N}

EOF
