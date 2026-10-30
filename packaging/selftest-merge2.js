(async () => {
  const log = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = (sel) => (document.querySelector(sel)?.innerText || "").replace(/\s+/g, " ").trim();
  try {
    document.querySelector('[data-row-act="merge"]').click();
    await wait(1500);
    const reg = document.querySelector(".region.kind-conflict");
    log.push("KONFLIKT-DOM: " + reg.outerHTML.replace(/\s+/g, " ").slice(0, 700));
    log.push("BAR-BUTTONS: " + [...reg.querySelectorAll("[data-act]")].map((b) => b.dataset.act).join(","));

    // Diesmal die LOKALE Fassung wählen
    reg.querySelector('[data-act="take-ours"]').click();
    await wait(600);
    const reg2 = document.querySelector(".region.kind-conflict");
    log.push("NACH KLICK - KLASSE: " + reg2.className);
    log.push("NACH KLICK - CHIP: " + T(".region.kind-conflict .taken"));
    log.push("NACH KLICK - ERGEBNISTEXT: " + (reg2.querySelector(".cf-edit")?.value ?? "(kein Textfeld)").trim());
    log.push("KOPF-STATS: " + T(".merge-head .stats"));

    // anderen Bereich (nur eingehend) prüfen
    const lone = document.querySelector(".region.kind-theirs_only");
    log.push("NUR-EINGEHEND: " + (lone ? lone.innerText.replace(/\s+/g, " ").slice(0, 120) : "keiner"));

    document.querySelector('[data-act="save-resolve"]').click();
    await wait(1800);
    log.push("KONFLIKTE DANACH: " + document.querySelectorAll('[data-row-act="merge"]').length);
    log.push("TOAST: " + T(".toast"));
  } catch (e) {
    log.push("FEHLER: " + e);
  }
  await window.__TAURI__.core.invoke("selftest_report", { text: log.join("\n") });
})();
