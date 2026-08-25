#!/bin/bash
#
# UI Studio fertigstellen — was nach dem ersten Ausrollen offen geblieben ist.
#
# Beim ersten Lauf ist das Veröffentlichen fehlgeschlagen (der Service-Role-Key
# war nirgends zu finden), und das Ausroll-Skript hat es fälschlich als Erfolg
# gemeldet. Beides ist behoben. Dieses Programm holt nach, was dadurch liegen
# blieb, und prüft die Schritte nach, deren Erfolg damals nicht belegt war.
#
#   ~/Developer/03_Websites/Website/tools/uistudio-fertigstellen.command
#
# Der Schlüssel:
#   · wird abgefragt, ohne dass er auf dem Bildschirm erscheint,
#   · landet nicht in der Shell-History,
#   · geht über eine Datei mit 600-Rechten an curl, nicht als Argument
#     (Argumente stehen in der Prozessliste und sind dort mitlesbar),
#   · wird am Ende gelöscht, auch bei Abbruch.
#
# Zu holen ist er hier:
#   https://supabase.com/dashboard/project/eojchbkieeqyfgfazydk/settings/api-keys

set -u
cd "$(dirname "$0")/.." || exit 1
WEBSITE="$(pwd)"
INSTRUMENTS="$HOME/Developer/03_Websites/steinbach-instruments"
PROJEKT="eojchbkieeqyfgfazydk"
BASIS="https://$PROJEKT.supabase.co"

B()     { printf '\033[1m%s\033[0m' "$1"; }
gruen() { printf '\033[32m%s\033[0m' "$1"; }
gelb()  { printf '\033[33m%s\033[0m' "$1"; }
rot()   { printf '\033[31m%s\033[0m' "$1"; }
grau()  { printf '\033[2m%s\033[0m' "$1"; }

ok()    { printf '  %s %s\n' "$(gruen '✓')" "$1"; }
warn()  { printf '  %s %s\n' "$(gelb '!')" "$1"; }
err()   { printf '  %s %s\n' "$(rot '✗')" "$1"; }
info()  { printf '    %s\n' "$(grau "$1")"; }
titel() { printf '\n%s\n%s\n' "$(B "$1")" "$(grau '──────────────────────────────────────────────────────────────')"; }

frage() { printf '\n    %s [j/N] ' "$1"; read -r a; case "$a" in [jJyY]*) return 0;; *) return 1;; esac; }

OFFEN=()
merke() { OFFEN+=("$1"); }

# ── Schlüssel entgegennehmen ─────────────────────────────────────────────

KONF=""
aufraeumen() {
  if [ -n "$KONF" ] && [ -f "$KONF" ]; then
    dd if=/dev/urandom of="$KONF" bs=1k count=4 conv=notrunc 2>/dev/null
    rm -f "$KONF"
  fi
  KONF=""
  unset SUPABASE_SERVICE_ROLE_KEY 2>/dev/null || true
}
trap 'aufraeumen; printf "\n"; exit 130' INT TERM
trap aufraeumen EXIT

printf '\n%s\n' "$(B 'UI Studio fertigstellen')"
info "Veröffentlicht das Werkzeug und prüft nach, was beim ersten Lauf"
info "unbelegt geblieben ist."

titel "Schlüssel"
info "Service-Role-Key aus dem Supabase-Dashboard. Er erscheint nicht auf dem"
info "Bildschirm; zur Kontrolle siehst du nur Länge und die letzten vier"
info "Zeichen. Nach dem Lauf ist er wieder weg."
printf '\n    %s\n' "$(grau "$BASIS  →  Project Settings → API Keys → service_role")"

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && [ -f "$INSTRUMENTS/.env.local" ]; then
  SUPABASE_SERVICE_ROLE_KEY="$(grep -m1 '^SUPABASE_SERVICE_ROLE_KEY=' "$INSTRUMENTS/.env.local" | cut -d= -f2-)"
  [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && ok "aus .env.local gelesen"
fi

if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  printf '\n    %s' "Schlüssel einfügen und Enter: "
  read -rs SUPABASE_SERVICE_ROLE_KEY
  printf '\n'
fi
export SUPABASE_SERVICE_ROLE_KEY

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  err "Nichts eingegeben. Ohne Schlüssel geht keiner der Schritte."
  printf '\n'; exit 1
fi

N=${#SUPABASE_SERVICE_ROLE_KEY}
ok "entgegengenommen: $N Zeichen, endet auf …${SUPABASE_SERVICE_ROLE_KEY: -4}"

KONF="$(mktemp)"; chmod 600 "$KONF"
{
  printf 'header = "apikey: %s"\n' "$SUPABASE_SERVICE_ROLE_KEY"
  printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_SERVICE_ROLE_KEY"
} > "$KONF"

# Gültig? Ein Fehlgriff soll hier auffallen und nicht bei Schritt drei.
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' -K "$KONF" "$BASIS/rest/v1/")"
if [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  err "Der Schlüssel wird abgelehnt (HTTP $STATUS). Ist es wirklich der"
  info "service_role-Key und nicht der anon-Key?"
  printf '\n'; exit 1
fi
ok "Schlüssel gilt"


# ── 1 · Werkzeug veröffentlichen ─────────────────────────────────────────

titel "1 · Das Werkzeug veröffentlichen"
info "Das ist der Schritt, der beim ersten Mal fehlschlug. Ohne ihn liegt im"
info "Speicher keine Datei, cockpit-content antwortet mit 500, und das Tor"
info "meldete das bisher als abgelaufene Anmeldung."

if "$WEBSITE/tools-publish-uistudio.sh" > /tmp/uistudio-publish.log 2>&1; then
  sed 's/^/      /' /tmp/uistudio-publish.log
  ok "Veröffentlicht"
else
  sed 's/^/      /' /tmp/uistudio-publish.log
  err "Fehlgeschlagen — Ausgabe oben."
  merke "Werkzeug veröffentlichen"
fi

# Nachsehen statt glauben: liegt die Datei wirklich da?
GROESSE="$(curl -sS -o /dev/null -w '%{size_download}' -K "$KONF" \
  "$BASIS/storage/v1/object/installers/_docs/uistudio-audio.html")"
if [ "${GROESSE:-0}" -gt 100000 ]; then
  ok "im Speicher nachgewiesen: $GROESSE Bytes"
else
  err "Die Datei ist nicht im Speicher (Antwort: ${GROESSE:-0} Bytes)."
  merke "Werkzeug veröffentlichen"
fi


# ── 2 · Zugangsliste ─────────────────────────────────────────────────────

titel "2 · Zugangsliste"
info "Beim ersten Lauf nicht belegt: du kommst als Inhaber über ADMIN_ALLOWED"
info "überall durch, auch ohne diese Tabelle. Jakob nicht. Ob die Migration"
info "wirklich lief, merkst du deshalb erst an ihm — oder hier."

ANTWORT="$(curl -sS -K "$KONF" "$BASIS/rest/v1/uistudio_audio_members?select=email,added_at&order=added_at")"

if printf '%s' "$ANTWORT" | grep -q 'does not exist\|PGRST205\|42P01'; then
  err "Die Tabelle gibt es nicht — die Migration ist nicht gelaufen."
  info "SQL kommt in die Zwischenablage; im Editor einfügen und ausführen."
  if frage "Zwischenablage füllen und Editor öffnen?"; then
    pbcopy < "$INSTRUMENTS/supabase/migrations/0010_uistudio_audio.sql"
    ok "In der Zwischenablage."
    open "https://supabase.com/dashboard/project/$PROJEKT/sql/new" >/dev/null 2>&1
    printf '\n    %s' "$(grau 'Danach hier [Enter] ')"; read -r _
    ANTWORT="$(curl -sS -K "$KONF" "$BASIS/rest/v1/uistudio_audio_members?select=email,added_at&order=added_at")"
  fi
fi

if printf '%s' "$ANTWORT" | grep -q '^\['; then
  ANZAHL="$(printf '%s' "$ANTWORT" | grep -o '"email"' | wc -l | tr -d ' ')"
  ok "Tabelle da, $ANZAHL Eintrag/Einträge:"
  printf '%s' "$ANTWORT" | grep -o '"email":"[^"]*"' | cut -d'"' -f4 | sed 's/^/        · /'

  printf '\n    %s' "Weitere Adresse eintragen (leer = keine): "
  read -r NEU
  NEU="$(printf '%s' "$NEU" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  if [ -n "$NEU" ]; then
    if printf '%s' "$NEU" | grep -q '^[^@]*@[^@]*\.[^@]*$'; then
      EIN="$(curl -sS -o /dev/null -w '%{http_code}' -K "$KONF" -X POST \
        -H 'Content-Type: application/json' -H 'Prefer: resolution=ignore-duplicates' \
        -d "{\"email\":\"$NEU\"}" "$BASIS/rest/v1/uistudio_audio_members")"
      case "$EIN" in
        20*) ok "$NEU eingetragen" ;;
        *)   err "Eintragen fehlgeschlagen (HTTP $EIN)"; merke "$NEU eintragen" ;;
      esac
    else
      err "Das sieht nicht nach einer E-Mail-Adresse aus — nicht eingetragen."
      merke "Adresse eintragen"
    fi
  fi
else
  err "Die Tabelle ist nicht lesbar. Antwort:"
  printf '%s' "$ANTWORT" | head -c 300 | sed 's/^/      /'; printf '\n'
  merke "Migration 0010_uistudio_audio.sql einspielen"
fi


# ── 3 · Nachsehen ────────────────────────────────────────────────────────

titel "3 · Nachsehen"

KOPF="$(curl -sS -D - -o /dev/null https://haukesteinbach.de/uistudio.html 2>/dev/null)"
printf '%s' "$KOPF" | head -1 | grep -q '200' \
  && ok "Das Tor antwortet" || { err "Das Tor antwortet nicht mit 200."; merke "Website ausliefern (./setup.sh auf dem Server)"; }
printf '%s' "$KOPF" | grep -qi "script-src 'self' 'unsafe-inline'" \
  && ok "Die eigene CSP für das Studio greift" \
  || { warn "Die gelockerte CSP fehlt — dann startet das Werkzeug nicht."; merke "Website ausliefern"; }

# Die Funktion muss ohne Anmeldung abweisen — und zwar am Tor, nicht mit 500.
FSTATUS="$(curl -sS -o /dev/null -w '%{http_code}' "$BASIS/functions/v1/cockpit-content?doc=uistudio-audio")"
[ "$FSTATUS" = "401" ] \
  && ok "cockpit-content steht und weist Unangemeldete ab" \
  || { warn "cockpit-content antwortet mit $FSTATUS statt 401."; merke "Edge Functions prüfen"; }


# ── Abschluss ────────────────────────────────────────────────────────────

printf '\n'
if [ ${#OFFEN[@]} -eq 0 ]; then
  printf '%s\n' "$(gruen '  Fertig.')"
  printf '\n'
  info "Jetzt https://haukesteinbach.de/uistudio.html neu laden — du solltest"
  info "ohne erneute Anmeldung direkt im Studio landen."
  info "Dann zu zweit: beide öffnen, dasselbe Projekt laden, einer schiebt"
  info "einen Knopf. Oben rechts stehen die Anfangsbuchstaben des anderen."
else
  printf '%s\n' "$(B 'Offen geblieben:')"
  for x in "${OFFEN[@]}"; do printf '    %s %s\n' "$(gelb '·')" "$x"; done
fi
printf '\n'
info "Der Schlüssel und die curl-Datei sind gelöscht. Hattest du ihn vorher"
info "selbst exportiert, liegt er weiter in DIESER Shell — dann noch:"
info "  unset SUPABASE_SERVICE_ROLE_KEY"
printf '\n'
