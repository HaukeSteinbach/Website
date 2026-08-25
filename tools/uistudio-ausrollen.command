#!/bin/bash
#
# UI Studio ausrollen — die sieben Schritte, die das Werkzeug auf
# haukesteinbach.de bringen, der Reihe nach und mit Erklärung.
#
# Doppelklick genügt, oder im Terminal:
#     ~/Developer/03_Websites/Website/tools/uistudio-ausrollen.command
#
# Was das Skript NICHT tut:
#   · Es fasst keine Passwörter und keine Schlüssel an. Wo etwas Geheimes
#     nötig ist, öffnet es die richtige Seite und du gibst es dort selbst ein.
#   · Es ändert nichts, ohne vorher zu fragen. Jeder Schritt, der etwas
#     verändert, will ein ausdrückliches Ja.
#   · Es überspringt nichts still. Was ausgelassen wird, steht am Ende drin.
#
# Die Reihenfolge ist nicht beliebig: die Datenbank muss die Zugangsliste
# kennen, bevor die Edge Functions sie abfragen, und die Functions müssen
# stehen, bevor die Website jemanden hindurchschickt.

set -u
cd "$(dirname "$0")/.." || exit 1
WEBSITE="$(pwd)"
INSTRUMENTS="$HOME/Developer/03_Websites/steinbach-instruments"
PROJEKT="eojchbkieeqyfgfazydk"

# ── Darstellung ──────────────────────────────────────────────────────────

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

AUSGELASSEN=()
merke_aus() { AUSGELASSEN+=("$1"); }

# frage <text> — Ja ist die Ausnahme, nicht die Voreinstellung.
frage() {
  printf '\n    %s [j/N] ' "$1"
  read -r a
  case "$a" in [jJyY]*) return 0 ;; *) return 1 ;; esac
}

pause() { printf '\n    %s' "$(grau '[Enter] weiter ')"; read -r _; }

# ablage <text> — in die Zwischenablage, ohne es auf den Bildschirm zu werfen
ablage() { printf '%s' "$1" | pbcopy; }

oeffne() {
  printf '    %s\n' "$(grau "$1")"
  frage "Im Browser öffnen?" && open "$1" >/dev/null 2>&1
}

printf '\n%s\n' "$(B 'UI Studio auf haukesteinbach.de ausrollen')"
info "Werkzeug für die Plugin-Oberflächen, zu zweit gleichzeitig bedienbar."
info "Repos: $WEBSITE"
info "       $INSTRUMENTS"


# ── 0 · Vorprüfung ───────────────────────────────────────────────────────

titel "0 · Ist alles da?"
info "Nur nachsehen, nichts verändern. Fehlt hier etwas, bricht es später"
info "mitten im Ausrollen ab — und das ist der unangenehmere Zeitpunkt."

FEHLT=0

[ -d "$INSTRUMENTS/supabase" ] \
  && ok "Instruments-Repo gefunden (dort liegen die Edge Functions)" \
  || { err "Instruments-Repo fehlt: $INSTRUMENTS"; FEHLT=1; }

[ -f "$WEBSITE/tools/uistudio/uistudio-audio.html" ] \
  && ok "Studio-Datei da ($(wc -c < "$WEBSITE/tools/uistudio/uistudio-audio.html" | tr -d ' ') Bytes)" \
  || { err "tools/uistudio/uistudio-audio.html fehlt"; FEHLT=1; }

command -v node >/dev/null && ok "node $(node -v)" || { err "node fehlt"; FEHLT=1; }

if command -v supabase >/dev/null; then
  if supabase projects list 2>/dev/null | grep -q "$PROJEKT"; then
    ok "Supabase-CLI angemeldet, Projekt $PROJEKT erreichbar"
  else
    warn "Supabase-CLI da, aber nicht angemeldet"
    info "Anmelden mit:  supabase login"
    FEHLT=1
  fi
else
  err "Supabase-CLI fehlt — brew install supabase/tap/supabase"
  FEHLT=1
fi

if [ "$FEHLT" -ne 0 ]; then
  printf '\n'
  err "Erst das oben Fehlende nachholen, dann noch einmal starten."
  printf '\n'; exit 1
fi


# ── 1 · Prüfungen ────────────────────────────────────────────────────────

titel "1 · Prüfungen"
info "Drei Läufe, alle nur lesend. Der erste prüft die Mechanik, mit der"
info "eure beiden Bilder gleich bleiben — die Stelle, an der ein Fehler nicht"
info "auffällt, sondern still Arbeit kostet."

PRUEFUNG_OK=1

printf '\n  %s\n' "$(grau 'Abgleich und Rückgängig …')"
if node "$WEBSITE/tools/uistudio/live-sync-test.mjs" >/tmp/uistudio-test.log 2>&1; then
  ok "$(grep -c '  ok ' /tmp/uistudio-test.log) Prüfungen bestanden"
else
  err "fehlgeschlagen — Ausgabe:"; sed 's/^/      /' /tmp/uistudio-test.log; PRUEFUNG_OK=0
fi

printf '  %s\n' "$(grau 'Backend, Syntax und Sicherheit …')"
if (cd "$WEBSITE/backend" && npm run check >/dev/null 2>&1); then ok "Syntax in Ordnung"; else err "Syntaxfehler im Backend"; PRUEFUNG_OK=0; fi
if (cd "$WEBSITE/backend" && npm run sec-test >/tmp/uistudio-sec.log 2>&1); then
  ok "$(grep -o '[0-9]* bestanden' /tmp/uistudio-sec.log | head -1) — darunter: die gelockerte CSP gilt nur für /uistudio.html"
else
  err "sec-test fehlgeschlagen"; tail -20 /tmp/uistudio-sec.log | sed 's/^/      /'; PRUEFUNG_OK=0
fi
if (cd "$WEBSITE/backend" && npm run flow-test >/tmp/uistudio-flow.log 2>&1); then
  ok "$(grep -o '[0-9]* passed' /tmp/uistudio-flow.log | head -1) — die Kundenwege sind unberührt"
else
  err "flow-test fehlgeschlagen"; tail -20 /tmp/uistudio-flow.log | sed 's/^/      /'; PRUEFUNG_OK=0
fi

if [ "$PRUEFUNG_OK" -ne 1 ]; then
  printf '\n'
  warn "Mindestens eine Prüfung ist rot."
  frage "Trotzdem weitermachen?" || { printf '\n'; exit 1; }
fi


# ── 2 · Datenbank ────────────────────────────────────────────────────────

titel "2 · Zugangsliste und Live-Kanal anlegen"
info "Eine Migration, zwei Dinge darin:"
info "  · die Tabelle uistudio_audio_members — wer ans Audio-Studio darf."
info "    Bewusst getrennt von der Cockpit-Liste: das eine Recht ist nicht"
info "    das andere."
info "  · zwei Policies auf realtime.messages. Sie entscheiden, wer auf den"
info "    Live-Kanal darf. Ohne sie wären die Kanäle offen — der anon-Key ist"
info "    öffentlich und die Kanalnamen sind die Projektnamen."
printf '\n'
info "Der Weg über den SQL-Editor ist Absicht: du siehst, was läuft, bevor es"
info "läuft. 'supabase db push' würde alles Ausstehende auf einmal einspielen."

MIGRATION="$INSTRUMENTS/supabase/migrations/0010_uistudio_audio.sql"
if [ ! -f "$MIGRATION" ]; then
  err "Migration nicht gefunden: $MIGRATION"; merke_aus "Schritt 2 (Migration fehlt)"
elif frage "SQL in die Zwischenablage legen und den Editor öffnen?"; then
  ablage "$(cat "$MIGRATION")"
  ok "In der Zwischenablage — im Editor einfügen und ausführen."
  oeffne "https://supabase.com/dashboard/project/$PROJEKT/sql/new"
  pause
else
  merke_aus "Schritt 2 — Migration 0010_uistudio_audio.sql einspielen"
fi


# ── 3 · Jakob eintragen ──────────────────────────────────────────────────

titel "3 · Jakob eintragen"
info "Eine Zeile in der eben angelegten Tabelle. Dieselbe Liste entscheidet"
info "an beiden Stellen: ob die Edge Function ihn durchlässt UND ob Postgres"
info "ihn auf den Live-Kanal lässt. Stünde die Wahrheit nur im Secret, könnte"
info "er die Projekte laden, aber nicht mitbekommen, dass du daran arbeitest."
printf '\n'
info "Er braucht ein Konto im selben Supabase-Projekt — das hat er über"
info "Steinbach Instruments schon. Ein neues legt das Tor nicht an."

printf '\n    %s' "Jakobs E-Mail-Adresse (leer = überspringen): "
read -r JAKOB
JAKOB="$(printf '%s' "$JAKOB" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

if [ -z "$JAKOB" ]; then
  merke_aus "Schritt 3 — Jakob in uistudio_audio_members eintragen"
elif ! printf '%s' "$JAKOB" | grep -q '^[^@]*@[^@]*\.[^@]*$'; then
  err "Das sieht nicht nach einer E-Mail-Adresse aus. Übersprungen."
  merke_aus "Schritt 3 — Jakob in uistudio_audio_members eintragen"
else
  SQL="insert into public.uistudio_audio_members (email)
values ('$JAKOB')
on conflict (email) do nothing;

-- Kontrolle: hier müssen jetzt beide stehen.
select email, added_at from public.uistudio_audio_members order by added_at;"
  ablage "$SQL"
  ok "SQL für $JAKOB liegt in der Zwischenablage."
  oeffne "https://supabase.com/dashboard/project/$PROJEKT/sql/new"
  pause
fi


# ── 4 · Edge Functions ───────────────────────────────────────────────────

titel "4 · Edge Functions ausrollen"
info "Zwei Funktionen sind geändert:"
info "  · uistudio-api    kennt jetzt Bereiche. Ohne Angabe bleibt alles wie"
info "                    bisher — die Instruments-Projekte merken nichts."
info "  · cockpit-content prüft je Dokument eine eigene Zugangsliste und"
info "                    liefert das neue uistudio-audio.html aus."
info "Der geteilte Code in _shared/ geht automatisch mit."

if frage "Jetzt ausrollen?"; then
  if (cd "$INSTRUMENTS" && supabase functions deploy uistudio-api cockpit-content 2>&1 | sed 's/^/      /'); then
    ok "Beide Funktionen sind draußen."
  else
    err "Ausrollen fehlgeschlagen — Ausgabe oben."
    merke_aus "Schritt 4 — Edge Functions ausrollen"
  fi
else
  merke_aus "Schritt 4 — supabase functions deploy uistudio-api cockpit-content"
fi


# ── 5 · Studio veröffentlichen ───────────────────────────────────────────

titel "5 · Das Werkzeug veröffentlichen"
info "Die Studio-Datei liegt NICHT im ausgelieferten Teil der Website — sonst"
info "käme jeder ohne Anmeldung daran. Sie geht in den privaten Storage und"
info "wird von dort nur an Angemeldete durchgereicht."
info "Ein Website-Deploy ändert sie deshalb nicht; dieser Schritt tut es."
printf '\n'
info "Der alte Stand wird vorher heruntergeladen und daneben gelegt."

if frage "Studio veröffentlichen?"; then
  if "$WEBSITE/tools-publish-uistudio.sh" 2>&1 | sed 's/^/      /'; then
    ok "Veröffentlicht."
  else
    err "Fehlgeschlagen. Meist fehlt der Service-Role-Key."
    info "Er wird aus steinbach-instruments/.env.local gelesen, oder:"
    info "  export SUPABASE_SERVICE_ROLE_KEY=…   und noch einmal"
    merke_aus "Schritt 5 — ./tools-publish-uistudio.sh"
  fi
else
  merke_aus "Schritt 5 — ./tools-publish-uistudio.sh"
fi


# ── 6 · Einchecken und ausliefern ────────────────────────────────────────

titel "6 · Einchecken und ausliefern"
info "Zwei Repos. Beim Instruments-Repo geht der Push in BEIDE Fernkopien —"
info "origin und Jakobs upstream. Wird eine vergessen, baut sein Host"
info "irgendwann aus einem alten Stand."
printf '\n'
info "Der Push auf main der Website startet den Bau des Images. Auf dem"
info "Server danach ./setup.sh, das holt es."

printf '\n  %s\n' "$(B 'Website')"
(cd "$WEBSITE" && git status -s | sed 's/^/      /')
if frage "Einchecken und pushen?"; then
  (cd "$WEBSITE" && git add -A && git commit -q -m "UI Studio: Tor, eigener Bereich und gemeinsames Arbeiten

Das Werkzeug fuer die Plugin-Oberflaechen ist jetzt von haukesteinbach.de
aus erreichbar, und Hauke und Jakob koennen gleichzeitig daran arbeiten.

Das Tor haengt an der Team-Anmeldung bei Supabase, nicht am Admin-Passwort:
dort liegen die Kundenprojekte, und der Grafiker hat dort nichts zu suchen.

Aenderungen werden nicht gemeldet, sondern abgeleitet - autosave() vergleicht
gegen einen Schatten und schickt die Differenz je Feld. Damit gewinnt der
letzte je Feld, nicht je Element: schieben und umbenennen am selben Knopf
kosten sich gegenseitig nichts.

Rueckgaengig ist persoenlich. Vorher legte es einen alten Schnappschuss auf,
was zu zweit die Arbeit des anderen mitgeloescht haette.

Nebenbei: [hidden] wurde von den display-Regeln ueberstimmt und war fuenfmal
einzeln nachgebessert - jetzt einmal grundsaetzlich." \
    && git push -q origin HEAD && printf '      ') && ok "Website gepusht" || { err "Website: Einchecken oder Push fehlgeschlagen"; merke_aus "Schritt 6 — Website pushen"; }
else
  merke_aus "Schritt 6 — Website einchecken und pushen"
fi

printf '\n  %s\n' "$(B 'Instruments')"
(cd "$INSTRUMENTS" && git status -s | sed 's/^/      /')
if frage "Einchecken und in BEIDE Fernkopien pushen?"; then
  if (cd "$INSTRUMENTS" && git add -A && git commit -q -m "uistudio-api: getrennte Bereiche fuer Instruments und Audio

Die Plugin-Oberflaechen von haukesteinbach.de sind eine andere Arbeit als die
Kontakt-Instrumente, mit einer anderen Runde von Beteiligten. Projekte liegen
deshalb getrennt (_uistudio-audio/), und der Zugang haengt am Bereich.

Ohne scope bleibt alles wie bisher - die Instruments-Fassung merkt nichts.

Dazu die Zugangsliste und die Policies fuer den Live-Kanal, und ein Fehler in
der load-Antwort: sie trug eine eigene CORS-Liste ohne haukesteinbach.de,
womit das Laden von der Audio-Seite am Browser gescheitert waere."); then
    (cd "$INSTRUMENTS" && git push -q origin HEAD) && ok "origin" || { err "origin fehlgeschlagen"; merke_aus "Instruments → origin pushen"; }
    (cd "$INSTRUMENTS" && git push -q upstream HEAD) && ok "upstream (Jakob)" || { err "upstream fehlgeschlagen"; merke_aus "Instruments → upstream pushen"; }
  else
    err "Einchecken fehlgeschlagen"; merke_aus "Schritt 6 — Instruments einchecken"
  fi
else
  merke_aus "Schritt 6 — Instruments einchecken und in beide Fernkopien pushen"
fi


# ── 7 · Nachsehen ────────────────────────────────────────────────────────

titel "7 · Nachsehen"
info "Erst nach dem Deploy auf dem Server aussagekräftig. Bis dahin antwortet"
info "noch der alte Stand."

if frage "Jetzt gegen die Live-Seite prüfen?"; then
  KOPF="$(curl -sS -D - -o /dev/null https://haukesteinbach.de/uistudio.html 2>/dev/null)"
  printf '%s' "$KOPF" | head -1 | grep -q '200' \
    && ok "Die Seite antwortet" || warn "Kein 200 — läuft schon der neue Stand?"
  printf '%s' "$KOPF" | grep -qi "script-src 'self' 'unsafe-inline'" \
    && ok "Die eigene CSP für das Studio greift" \
    || warn "Die gelockerte CSP fehlt — dann startet das Werkzeug nicht."
  printf '%s' "$KOPF" | grep -qi 'wss://' \
    && ok "Der Live-Kanal ist erlaubt" || warn "wss:// fehlt in der CSP."
  printf '\n'
  info "Zum Schluss zu zweit: beide https://haukesteinbach.de/uistudio.html"
  info "öffnen, dasselbe Projekt laden, und einer schiebt einen Knopf. Oben"
  info "rechts stehen die Anfangsbuchstaben des anderen, auf der Fläche sein"
  info "Zeiger."
fi


# ── Abschluss ────────────────────────────────────────────────────────────

printf '\n'
if [ ${#AUSGELASSEN[@]} -eq 0 ]; then
  printf '%s\n' "$(gruen '  Alle Schritte durchlaufen.')"
else
  printf '%s\n' "$(B 'Ausgelassen — bleibt zu tun:')"
  for x in "${AUSGELASSEN[@]}"; do printf '    %s %s\n' "$(gelb '·')" "$x"; done
fi
printf '\n'
info "Neue Fassung des Werkzeugs später veröffentlichen: ./tools-publish-uistudio.sh"
info "Baustand steht im Werkzeug oben neben dem Namen. Steht dort ein alter"
info "Wert, läuft eine alte Kopie im Browser-Cache."
printf '\n'
