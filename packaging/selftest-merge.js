(async () => {
  const log = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = (sel) => (document.querySelector(sel)?.innerText || "").replace(/\s+/g, " ").trim();
  try {
    log.push("TITEL: " + T(".titlebar"));
    log.push("KONFLIKT-ZEILEN: " + document.querySelectorAll('[data-row-act="merge"]').length);
    log.push("BRANCH-CHIP: " + T(".branch-trigger"));

    // Merge-Editor über die Konfliktzeile öffnen
    document.querySelector('[data-row-act="merge"]').click();
    await wait(1500);
    log.push("EDITOR: " + (document.querySelector(".merge") ? "offen" : "FEHLT"));
    log.push("KOPF: " + T(".merge-head"));
    log.push("PANES: " + [...document.querySelectorAll(".pane-head")].map((p) => p.innerText.replace(/\s+/g, " ")).join(" || "));
    log.push("REGIONEN: " + [...document.querySelectorAll(".region")].map((r) => r.className.split(" ")[1]).join(", "));
    log.push("KONFLIKT-TEXT-LOKAL: " + T(".region.kind-conflict .col-ours .txt"));
    log.push("KONFLIKT-TEXT-EINGEHEND: " + T(".region.kind-conflict .col-theirs .txt"));

    // Bereich einzeln entscheiden: eingehende Fassung
    document.querySelector('.region.kind-conflict [data-act="take-theirs"]').click();
    await wait(500);
    log.push("ENTSCHEIDUNG: " + (document.querySelector(".region.kind-conflict .taken")?.innerText.trim() || "keine"));
    log.push("ERGEBNIS-BEREICH: " + T(".region.kind-conflict .cf-edit").slice(0, 120));

    // Zweiter Konflikt? Sonst direkt speichern
    document.querySelector('[data-act="save-resolve"]').click();
    await wait(1800);
    log.push("NACH DEM SPEICHERN - KONFLIKTZEILEN: " + document.querySelectorAll('[data-row-act="merge"]').length);
    log.push("STATUSZEILE: " + T(".statusbar"));
    log.push("TOAST: " + T(".toast"));
    log.push("ÜBERLAGERUNG: " + (document.querySelector(".merge") ? "editor offen" : "geschlossen"));
  } catch (e) {
    log.push("FEHLER: " + e);
  }
  await window.__TAURI__.core.invoke("selftest_report", { text: log.join("\n") });
})();
