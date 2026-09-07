#!/usr/bin/env bash
#
# Den Chain-Shop einrichten und ausrollen — ein Befehl, auf dem Server.
#
#   ./chain-shop.sh
#
# Es fragt nur nach dem, was fehlt, und zu jedem fehlenden Punkt steht die
# Adresse der Seite dabei, auf der genau dieser Wert steht. Wer alles schon
# eingetragen hat, bekommt eine Prüfung und den Neustart.
#
# WARUM EIN EIGENES SKRIPT NEBEN setup.sh: setup.sh richtet die Website als
# Ganzes ein und fragt nach dem, was sie zum Laufen braucht. Hier geht es um
# den Laden: Stripe, den Webhook, die Dateien hinter dem Download und die
# Frage, ob am Ende wirklich ein Kaufknopf auf der Seite steht. Beides in einem
# Skript hieße, dass man beim Nachrüsten des Shops durch zwanzig Fragen läuft,
# die längst beantwortet sind.
#
# Gebraucht werden docker und curl.

set -euo pipefail

ENV_FILE="backend/.env.runtime"
COMPOSE_FILE="docker-compose.runtime.yml"
SEITE="https://haukesteinbach.de"

if [ -t 0 ]; then INTERAKTIV=ja; else INTERAKTIV=nein; fi

if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'
  U=$'\033[4m'; N=$'\033[0m'
else
  B=''; DIM=''; R=''; G=''; Y=''; U=''; N=''
fi

schritt() { printf '\n%s──  %s  %s\n' "$B" "$1" "$N"; }
ok()      { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
warn()    { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
fehler()  { printf '\n  %s✗ %s%s\n\n' "$R" "$1" "$N"; exit 1; }
hinweis() { printf '  %s%s%s\n' "$DIM" "$1" "$N"; }

# Ein anklickbarer Verweis. Jedes Terminal der letzten Jahre macht daraus einen
# Link, der die Seite öffnet; die anderen zeigen einfach die Adresse. Deshalb
# steht sie im sichtbaren Text und nicht nur in der Verknüpfung.
link() {
  printf '  %s→%s %s%s%s\n' "$B" "$N" "$U" "$1" "$N"
}

command -v docker >/dev/null || fehler "docker ist nicht installiert."
docker compose version >/dev/null 2>&1 || fehler "docker compose fehlt."
[ -f "$COMPOSE_FILE" ] || fehler "$COMPOSE_FILE nicht gefunden. Das Skript gehört ins Verzeichnis der Website."

mkdir -p backend
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

lies()  { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
setze() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  grep -vE "^$key=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# frage SCHLUESSEL "Erklärung" "Adresse der Seite" [pflicht]
frage() {
  local key="$1" text="$2" adresse="$3" pflicht="${4:-ja}" vorhanden antwort

  vorhanden=$(lies "$key")
  if [ -n "$vorhanden" ]; then
    ok "$key steht schon drin"
    return
  fi

  printf '\n  %s%s%s\n' "$B" "$text" "$N"
  [ -n "$adresse" ] && link "$adresse"

  if [ "$INTERAKTIV" = nein ]; then
    if [ "$pflicht" = ja ]; then
      fehler "$key fehlt und es sitzt niemand am Terminal. Trage es in $ENV_FILE ein."
    fi
    warn "$key bleibt leer"
    return
  fi

  while true; do
    printf '  > '
    read -r antwort
    antwort="${antwort#"${antwort%%[![:space:]]*}"}"
    antwort="${antwort%"${antwort##*[![:space:]]}"}"

    if [ -n "$antwort" ]; then
      setze "$key" "$antwort"
      ok "$key gespeichert"
      return
    fi
    if [ "$pflicht" != ja ]; then
      warn "$key bleibt leer"
      return
    fi
    warn "Ohne diesen Wert bleibt der Kaufknopf verborgen."
  done
}

# ─────────────────────────────────────────────────────────────────────────────
schritt "1. Stripe"
# Der geheime Schlüssel entscheidet allein darüber, ob der Kaufknopf überhaupt
# erscheint: assets/js/shop.js fragt vorher beim Server nach und lässt sonst
# den Weg über die Kontaktseite stehen.
frage STRIPE_SECRET_KEY \
  "Der geheime Schlüssel (sk_live_… oder sk_test_… zum Proben). Auf der Seite unten rechts, 'Geheimschlüssel'." \
  "https://dashboard.stripe.com/apikeys"

schritt "2. Der Webhook"
# Ohne ihn wird bezahlt und nichts passiert: keine Rechnung, kein Schlüssel,
# keine Mail. Der Kunde sieht eine Bestätigung von Stripe und wartet dann.
hinweis "Ohne Webhook wird bezahlt und danach passiert nichts: keine Rechnung,"
hinweis "kein Lizenzschlüssel, keine Mail. Neuen Endpunkt anlegen mit"
hinweis "  Adresse:  $SEITE/api/v1/public/shop/webhook"
hinweis "  Ereignis: checkout.session.completed"
frage STRIPE_WEBHOOK_SECRET \
  "Das Signaturgeheimnis des Endpunkts (whsec_…). Nach dem Anlegen bei 'Signing secret'." \
  "https://dashboard.stripe.com/webhooks/create?events=checkout.session.completed"

schritt "3. Die Dateien hinter dem Download"
hinweis "Feste Adressen, absichtlich nicht je Käufer und nicht ablaufend: was"
hinweis "hier hängt, ist die Demo, also das vollständige Plug-in, das der"
hinweis "Schlüssel freischaltet. Am besten ein öffentlicher R2-Bucket mit"
hinweis "eigener Domain, dann liefert Cloudflare aus und der Server bleibt frei."
hinweis "Was leer bleibt, taucht auf der Seite gar nicht erst als Knopf auf."
frage CHAIN_DOWNLOAD_MAC \
  "Adresse der macOS-Fassung (leer lassen, wenn sie noch nicht liegt)." \
  "https://dash.cloudflare.com/?to=/:account/r2/overview" nein
frage CHAIN_DOWNLOAD_WIN \
  "Adresse der Windows-Fassung." \
  "" nein
frage CHAIN_MANUAL_URL \
  "Adresse des Handbuchs als PDF." \
  "" nein
frage CHAIN_REPORT_URL \
  "Adresse des Messberichts als PDF." \
  "" nein

# ─────────────────────────────────────────────────────────────────────────────
schritt "4. Was sonst noch nötig ist"
# Diese vier hängen nicht am Shop, aber ohne sie kommt keine Mail beim Käufer
# an und keine Rechnung in die Ablage. Sie werden hier nur geprüft, gefragt
# wird danach in setup.sh.
fehlend=""
for schluessel in SMTP_HOST MAIL_FROM_EMAIL S3_BUCKET SESSION_SECRET; do
  if [ -z "$(lies "$schluessel")" ]; then
    fehlend="$fehlend $schluessel"
  else
    ok "$schluessel steht drin"
  fi
done

if [ -n "$fehlend" ]; then
  warn "Es fehlt:$fehlend"
  hinweis "Ohne SMTP bekommt der Käufer weder Rechnung noch Lizenzschlüssel."
  hinweis "Ohne S3_BUCKET wird keine Bestellung abgelegt und der Kaufknopf bleibt aus."
  hinweis "Ohne SESSION_SECRET kann sich niemand im Kontobereich anmelden."
  hinweis "Nachtragen mit:  ./setup.sh"
fi

# ─────────────────────────────────────────────────────────────────────────────
schritt "5. Ausrollen"
docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" up -d
ok "Container läuft auf dem neuen Stand"

# Kurz warten, bis der Server antwortet. Zehn Versuche im Sekundentakt reichen
# auch einem langsamen Start, und schneller als das ist eine Prüfung wertlos.
schritt "6. Nachsehen, ob es wirklich läuft"
versuch=0
until curl -fsS "$SEITE/health" >/dev/null 2>&1 || [ "$versuch" -ge 10 ]; do
  versuch=$((versuch + 1))
  sleep 1
done

gesundheit=$(curl -fsS "$SEITE/health" 2>/dev/null || echo '')
if [ -z "$gesundheit" ]; then
  warn "Der Server antwortet noch nicht auf $SEITE/health"
  link "$SEITE/health"
else
  laden=$(curl -fsS "$SEITE/api/v1/public/shop/products/chain" 2>/dev/null || echo '')
  case "$laden" in
    *'"available":true'*) ok "Der Kaufknopf ist auf der Chain-Seite sichtbar" ;;
    *'"available":false'*)
      warn "Chain ist bekannt, aber der Laden ist zu (Stripe oder Ablage fehlt)"
      link "$SEITE/health" ;;
    *) warn "Die Auskunft zu Chain kam nicht zurück"
       link "$SEITE/api/v1/public/shop/products/chain" ;;
  esac

  case "$laden" in
    *'"downloads":[]'*) warn "Keine Downloadadressen hinterlegt: die Demoknöpfe bleiben aus" ;;
    *'"downloads"'*)    ok "Downloadadressen sind hinterlegt" ;;
  esac
fi

# ─────────────────────────────────────────────────────────────────────────────
schritt "Fertig. Was du jetzt anschauen willst"
link "$SEITE/steinbach-chain.html#buy"
hinweis "Die Produktseite mit dem Kaufknopf."
link "$SEITE/account.html"
hinweis "Der Kontobereich: Anmeldung per Code, Schlüssel, Download, Handbuch."
link "$SEITE/health"
hinweis "Was der Server für eingerichtet hält."
link "https://dashboard.stripe.com/payments"
hinweis "Die Zahlungen. Im Probebetrieb oben rechts auf Testdaten schalten."
link "https://dashboard.stripe.com/webhooks"
hinweis "Der Webhook. Bleibt eine Bestellung aus, steht der Grund hier."
printf '\n'
hinweis "Zum Proben: sk_test_… eintragen, mit Karte 4242 4242 4242 4242 kaufen,"
hinweis "danach im Kontobereich mit derselben Adresse anmelden."
printf '\n'
