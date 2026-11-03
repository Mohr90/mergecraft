# Feinschliff: Darstellung und robuste Bedienabläufe

- Gespeicherte Auswahl Hell/Dunkel unten links; kein manueller Transparenzschalter.
- Entfernte Umbenennen-Aktionen in Branch-Übersicht und Schnellauswahl.
- Eigener Scrollbereich für Branches bei dauerhaft sichtbaren Such-/Filteraktionen.
- Suche, Typfilter, Sortierung und Scrollposition bleiben bei Refresh, Fetch und
  Bereichswechsel erhalten. Ein Repositorywechsel setzt sie zurück.
- Mehr-Menüs schließen sich gegenseitig und lassen sich mit Escape schließen.
- Alte Antworten bei schneller Commit-Auswahl werden verworfen. Lesefehler werden
  gemeldet; die vorherige Dateiliste wird nicht als aktuelle angezeigt.
- Fetch, Pull und Push nutzen einen Hintergrund-Worker statt des GUI-Threads.
- Tastatursteuerung für Commit-Zeilen und Schutz modaler Dialoge vor Bereichskürzeln.

Prüfung: reproduzierende Browser-Regressionen für verlorene Filter und alte
Commit-Antworten; 326 Remote-Branches; Hell/Dunkel nach Neustart; vollständige
Branch-/Merge-Abläufe; nativer Test mit langsamem Push-Hook in einem lokalen
wegwerfbaren Bare-Repository. Keine Operationen gegen produktive Remotes.


Tags sind ein eigener Navigationsbereich (Strg+5): Suche, Typfilter, Sortierung,
Commit ansehen, Vergleich und neuer Branch vom Tag. Annotierte, einfache,
verschachtelte und nicht auf Commits zeigende Tags sind in Git-Tests abgedeckt.
Tag-Startpunkte verwenden voll qualifizierte Referenzen. Ältere ausgewählte
Tag-Commits bleiben bei Aktualisierung in der Historie sichtbar.
