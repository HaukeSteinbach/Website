SELBST GEHOSTETE SCHRIFTEN
==========================

Alle drei Familien stammen von Google Fonts und stehen unter der
SIL Open Font License 1.1 (siehe OFL.txt). Selbst hosten ist davon
ausdruecklich erlaubt.

  Archivo Black   Anzeigeschrift (Ueberschriften, Wortmarke)
                  https://fonts.google.com/specimen/Archivo+Black
  Poppins         Lauftext
                  https://fonts.google.com/specimen/Poppins
  JetBrains Mono  Labels, Meta-Angaben, Buttons
                  https://fonts.google.com/specimen/JetBrains+Mono

WARUM SELBST GEHOSTET UND NICHT PER GOOGLE-CDN?

Ein <link> auf fonts.googleapis.com uebertraegt bei jedem Seitenaufruf
die IP-Adresse des Besuchers an Google. Das LG Muenchen I hat das 2022
(Az. 3 O 17493/20) als DSGVO-Verstoss gewertet und Schadensersatz
zugesprochen. Selbst gehostet entsteht diese Uebertragung nicht, die
Seite braucht dafuer keine Einwilligung, und sie laedt schneller.

Eingebunden werden die Dateien per @font-face in
assets/css/steinbach.css.

Es sind nur die Subsets "latin" und "latin-ext" enthalten (zusammen
142 KB) — Kyrillisch, Griechisch, Devanagari und Vietnamesisch wurden
weggelassen, weil die Seite sie nicht braucht.
