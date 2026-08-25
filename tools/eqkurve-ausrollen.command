#!/bin/bash
#
# EQ-Kurve ausrollen — bringt die neue Elementart und das Steinbach-EQ-Paket
# dorthin, wo Hauke und Jakob damit arbeiten können.
#
#   ~/Developer/03_Websites/Website/tools/eqkurve-ausrollen.command
#
# Das Studio kann seit heute EQ-Kurven: eine Anzeigefläche, die ihren Verlauf
# aus acht Bändern rechnet, statt ein Bild zu zeigen. Die Filtermathematik ist
# aus Source/DSP/EQBand.h portiert.
#
# DIE REIHENFOLGE IST WICHTIG. Das Studio lädt uistudio-eqcurve.js von
# haukesteinbach.de. Wird zuerst das Studio veröffentlicht und danach die
# Website, sucht das Werkzeug in der Zwischenzeit eine Datei, die es noch nicht
# gibt — die Kurve bliebe ein leeres Rechteck. Deshalb: erst die Website, dann
# das Studio.
#
# Wie die anderen Skripte hier: fragt vor jedem Schritt, der etwas verändert,
# fasst keine Schlüssel an außer über eine 600-Datei, und listet am Ende auf,
# was ausgelassen wurde.

set -u
cd "$(dirname "$0")/.." || exit 1
WEBSITE="$(pwd)"
EQ="$HOME/Developer/02_Steinbach Audio/SteinbachEQ 2"
PROJEKT="eojchbkieeqyfgfazydk"

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

# lauf <befehl…> — Ausgabe eingerückt, Status BLEIBT erhalten. Eine Pipe nach
# sed würde ihn verschlucken; genau daran ging beim ersten Ausrollen ein
# fehlgeschlagenes Veröffentlichen als Erfolg durch.
lauf() {
  local aus status
  aus="$("$@" 2>&1)"; status=$?
  [ -n "$aus" ] && printf '%s\n' "$aus" | sed 's/^/      /'
  return $status
}

printf '\n%s\n' "$(B 'EQ-Kurve ausrollen')"
info "Neue Elementart im Studio, dazu das Steinbach-EQ-Paket zum Einlesen."


# ── 0 · Ist alles da? ────────────────────────────────────────────────────

titel "0 · Ist alles da?"
FEHLT=0

[ -d "$EQ" ] && ok "EQ-Repo gefunden" || { err "EQ-Repo fehlt: $EQ"; FEHLT=1; }
[ -f "$WEBSITE/assets/js/uistudio-eqcurve.js" ] \
  && ok "Kurven-Modul da ($(wc -c < "$WEBSITE/assets/js/uistudio-eqcurve.js" | tr -d ' ') Bytes)" \
  || { err "assets/js/uistudio-eqcurve.js fehlt"; FEHLT=1; }
command -v node >/dev/null && ok "node $(node -v)" || { err "node fehlt"; FEHLT=1; }
python3 -c "import PIL" 2>/dev/null && ok "Pillow da (baut die Hintergrundbilder)" \
  || { err "Pillow fehlt — python3 -m pip install Pillow"; FEHLT=1; }

if [ "$FEHLT" -ne 0 ]; then
  printf '\n'; err "Erst das oben Fehlende nachholen."; printf '\n'; exit 1
fi


# ── 1 · Prüfungen ────────────────────────────────────────────────────────

titel "1 · Prüfungen"
info "Die erste prüft die portierte Filtermathematik gegen die Physik: ein"
info "Bell trifft bei seiner Mitte genau seinen Gain, ein Butterworth liegt"
info "an der Ecke auf -3,01 dB. Feste Sollwerte wären auch dann grün, wenn"
info "Original und Portierung denselben Fehler machten."

ROT=0
printf '\n  %s\n' "$(grau 'EQ-Kurve, Filtermathematik …')"
if node "$WEBSITE/tools/uistudio/eqcurve-test.mjs" >/tmp/eqk.log 2>&1; then
  ok "$(grep -c '  ok ' /tmp/eqk.log) Prüfungen bestanden"
else
  err "fehlgeschlagen:"; sed 's/^/      /' /tmp/eqk.log; ROT=1
fi

printf '  %s\n' "$(grau 'Gemeinsames Arbeiten …')"
if node "$WEBSITE/tools/uistudio/live-sync-test.mjs" >/tmp/eqs.log 2>&1; then
  ok "$(grep -c '  ok ' /tmp/eqs.log) Prüfungen bestanden"
else
  err "fehlgeschlagen:"; sed 's/^/      /' /tmp/eqs.log; ROT=1
fi

printf '  %s\n' "$(grau 'Backend …')"
if (cd "$WEBSITE/backend" && npm run check >/dev/null 2>&1); then ok "Syntax in Ordnung"; else err "Syntaxfehler"; ROT=1; fi
if (cd "$WEBSITE/backend" && npm run sec-test >/tmp/eqsec.log 2>&1); then
  ok "$(grep -o '[0-9]* bestanden' /tmp/eqsec.log | head -1)"
else err "sec-test rot"; ROT=1; fi

if [ "$ROT" -ne 0 ]; then
  printf '\n'; warn "Mindestens eine Prüfung ist rot."
  frage "Trotzdem weiter?" || { printf '\n'; exit 1; }
fi


# ── 2 · Paket bauen ──────────────────────────────────────────────────────

titel "2 · Das Steinbach-EQ-Paket bauen"
info "Schneidet die drei Ansichten aus den Marketing-Aufnahmen, rechnet die"
info "Koordinaten der Bedienelemente aus resized() und layoutStrips() und"
info "legt die EQ-Anzeige als lebende Kurve an — nicht als Bild."

if frage "Paket jetzt bauen?"; then
  if (cd "$EQ" && lauf python3 tools/ui-paket-bauen.py); then
    ok "gebaut: $EQ/steinbach-eq.uipaket.json"
  else
    err "Bauen fehlgeschlagen."; merke "Paket bauen (python3 tools/ui-paket-bauen.py)"
  fi
else
  merke "Paket bauen"
fi


# ── 3 · Website ausliefern ───────────────────────────────────────────────

titel "3 · Website ausliefern"
info "ZUERST, nicht danach: das Studio lädt uistudio-eqcurve.js von dieser"
info "Seite. Fehlt die Datei dort, bleibt die Kurve ein leeres Rechteck."

printf '\n'
(cd "$WEBSITE" && git status -s | sed 's/^/      /')

if frage "Einchecken und pushen?"; then
  if (cd "$WEBSITE" && git add -A && git commit -q -m "UI Studio: eine EQ-Kurve als eigene Elementart

Das Studio setzte Oberflaechen bisher aus Bildern zusammen. Die zentrale
Flaeche des Steinbach EQ ist aber keine Grafik - sie rechnet ihren Verlauf
aus acht Baendern. Als Screenshot war sie im Editor tot: sie sah nicht aus
wie das Plug-in und konnte nichts.

Die Filtermathematik ist Zeile fuer Zeile aus Source/DSP/EQBand.h portiert,
Darstellung und Mausverhalten folgen EQDisplay.cpp. Ziehen bewegt Frequenz
und Gain, bei Cut-Filtern die Flankensteilheit; Cmd/Strg haelt die Guete.

Damit gibt es die Kurve dreimal - Plug-in, Max-Geraet, Studio. Deshalb 34
Pruefungen gegen die Physik statt gegen eingefrorene Zahlen: eingefrorene
Sollwerte waeren auch dann gruen, wenn beide Seiten denselben Fehler machten.
Vier davon schlugen zuerst an und lagen selbst falsch, nicht der Code.

Dazu die offenen Korrekturen: das Tor unterscheidet jetzt eine abgelaufene
Anmeldung von einem fehlenden Werkzeug im Speicher, und der Service-Role-Key
geht ueber eine 600-Datei an curl statt als Argument in die Prozessliste."); then
    (cd "$WEBSITE" && git push -q origin HEAD) && ok "gepusht" \
      || { err "Push fehlgeschlagen"; merke "Website pushen"; }
  else
    warn "Nichts einzuchecken, oder Commit fehlgeschlagen."
  fi
else
  merke "Website einchecken und pushen"
fi

printf '\n'
info "Der Push baut das Image. Auf dem SERVER danach:  ./setup.sh"
info "Ohne das holt der Server die neue Datei nicht."
if frage "Auf den fertigen Bau warten und dann prüfen?"; then
  printf '    %s' "$(grau 'warte auf GitHub Actions … ')"
  (cd "$WEBSITE" && gh run watch "$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')" >/dev/null 2>&1)
  printf '\n'
  (cd "$WEBSITE" && gh run list --limit 1 | sed 's/^/      /')
fi


# ── 4 · Studio veröffentlichen ───────────────────────────────────────────

titel "4 · Das Studio veröffentlichen"
info "Die Fassung im Speicher kennt die Elementart noch nicht. Erst dieser"
info "Schritt bringt sie dorthin — ein Website-Deploy tut es nicht."
printf '\n'
info "Der Schlüssel erscheint nicht auf dem Bildschirm und geht über eine"
info "Datei mit 600-Rechten an curl."
printf '    %s\n' "$(grau "https://supabase.com/dashboard/project/$PROJEKT/settings/api-keys")"

if frage "Studio veröffentlichen?"; then
  if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    printf '\n    %s' "Service-Role-Key einfügen und Enter: "
    read -rs SUPABASE_SERVICE_ROLE_KEY
    printf '\n'
    export SUPABASE_SERVICE_ROLE_KEY
  fi
  if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    err "Nichts eingegeben."
    merke "Studio veröffentlichen (./tools-publish-uistudio.sh)"
  elif lauf "$WEBSITE/tools-publish-uistudio.sh"; then
    ok "veröffentlicht"
  else
    err "Fehlgeschlagen — Ausgabe oben."
    merke "Studio veröffentlichen (./tools-publish-uistudio.sh)"
  fi
else
  merke "Studio veröffentlichen"
fi


# ── 5 · Nachsehen ────────────────────────────────────────────────────────

titel "5 · Nachsehen"

STATUS="$(curl -sS -o /dev/null -w '%{http_code}' https://haukesteinbach.de/assets/js/uistudio-eqcurve.js)"
if [ "$STATUS" = "200" ]; then
  ok "Das Kurven-Modul liegt auf dem Server"
else
  err "uistudio-eqcurve.js antwortet mit $STATUS — ohne die Datei bleibt die Kurve leer."
  info "Auf dem Server ./setup.sh laufen lassen, dann hier noch einmal."
  merke "Website auf dem Server ausliefern (./setup.sh)"
fi

TOR="$(curl -sS -o /dev/null -w '%{http_code}' https://haukesteinbach.de/uistudio.html)"
[ "$TOR" = "200" ] && ok "Das Tor antwortet" || warn "Das Tor antwortet mit $TOR."


# ── Abschluss ────────────────────────────────────────────────────────────

printf '\n'
if [ ${#OFFEN[@]} -eq 0 ]; then
  printf '%s\n' "$(gruen '  Alles durch.')"
else
  printf '%s\n' "$(B 'Offen geblieben:')"
  for x in "${OFFEN[@]}"; do printf '    %s %s\n' "$(gelb '·')" "$x"; done
fi

printf '\n%s\n' "$(B 'Zum Schluss, von Hand:')"
info "1. https://haukesteinbach.de/uistudio.html öffnen"
info "2. „Öffnen\" und diese Datei wählen:"
printf '       %s\n' "$(grau "$EQ/steinbach-eq.uipaket.json")"
info "3. „Sichern\" — damit liegt das Projekt im Team-Speicher und der"
info "   gemeinsame Kanal steht, und Jakob kann dasselbe Projekt öffnen."
printf '\n'
info "Oben neben dem Namen muss „2026-08-25 · EQ-Kurve\" stehen. Steht dort"
info "ein älterer Baustand, läuft eine alte Kopie im Browser-Cache."
printf '\n'
