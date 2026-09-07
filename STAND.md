# STAND
Website, 07.09.2026

## Was ist das
haukesteinbach.de, die Studio-Seite (Mixing, Mastering, Produkte) plus ein Express-Backend für Datei-Handoff und Shop-Bestellungen.

## Aktueller Stand
Git-Branch main, letzter Commit d21d451 vom 04.09.2026, Betreff "Dateinamen ohne doppeltes Kuerzel". Aktuell 19 geänderte bzw. neue Dateien im Arbeitsbaum: eine Änderung an steinbach-eq.html, der Rest sind neue Videos und Bilder unter assets/Video/steinbach-eq/ und assets/Video/Steinbach Chain/, offenbar in Arbeit für eine EQ-Werbeseite. Ein Remote: origin (HaukeSteinbach/Website).

## Wo man anfängt
README.md lesen, dort ist die Seitenstruktur tabelliert. Deploy auf dem Server läuft über ./setup.sh (fragt ab, was gebraucht wird, und deployt am Ende). Wer den Server nicht selbst betreibt, führt vorher lokal ./prepare.sh aus. Bei jedem Push nach main baut zusätzlich .github/workflows/docker-image.yml ein Image und veröffentlicht es nach GHCR (ghcr.io/haukesteinbach/haukesteinbach).

## Was liegt in _alt/ und warum
kein _alt/, nichts auszulagern gefunden.

## Woran ich erkannt habe, was aktuell ist
Stark. Git-Log und git status direkt geprüft. Die WO-LIEGT-WAS.md nannte das Repo "sauber", das stimmt nicht mehr: es liegen 19 nicht committete Dateien da, vermutlich laufende Arbeit an der EQ-Werbeseite (assets/Video/steinbach-eq/, assets/Video/Steinbach Chain/). Deploy-Mechanik über setup.sh, prepare.sh und den GitHub-Workflow ist anhand der Skript-Dateien und der Workflow-Datei selbst bestätigt, nicht geraten.
