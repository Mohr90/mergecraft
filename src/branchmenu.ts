import { h, t } from "./i18n";
// Branch-Auswahl als Popover mit Suche: wechseln, anlegen, mergen,
// löschen - mit Tastatursteuerung.

import type { BranchInfo } from "./api";
import { el, esc, fuzzy, icon, markHits, relTime, toast } from "./ui";

export interface BranchMenuActions {
  allowMerge?: boolean;
  onCheckout: (b: BranchInfo) => void;
  onMerge: (b: BranchInfo) => void;
  onDelete: (b: BranchInfo) => void;
  onNewFrom: (b: BranchInfo | null) => void;
  onCompare: (b: BranchInfo) => void;
  onCreate: () => void;
}

interface Item {
  branch: BranchInfo;
  hits: number[];
}

export function openBranchMenu(anchor: HTMLElement, branches: BranchInfo[], act: BranchMenuActions) {
  document.querySelector(".popover")?.remove();
  const pop = el("div", "popover");
  pop.innerHTML = h`
    <div class="search">${icon("search", 15)}<input type="text" aria-label="Branch suchen" placeholder="Branch suchen – lokal und remote" autocomplete="off" /></div>
    <div class="list"></div>
    <footer>
      <button class="btn" data-act="new">${icon("plus", 14)} Neuer Branch</button>
      <span class="hint"><span class="kbd">↑↓</span> wählen · <span class="kbd">Enter</span> wechseln · ${act.allowMerge === false ? "" : h`<span class="kbd">Alt+Enter</span> mergen · `}<span class="kbd">Esc</span> schließen</span>
    </footer>`;
  document.body.appendChild(pop);

  const rect = anchor.getBoundingClientRect();
  const width = 620;
  const left = Math.min(rect.left, window.innerWidth - width - 12);
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top = `${rect.bottom + 6}px`;

  const input = pop.querySelector("input") as HTMLInputElement;
  const list = pop.querySelector(".list") as HTMLElement;
  let items: Item[] = [];
  let cursor = 0;

  const build = () => {
    const query = input.value.trim();
    const scored: Item[] = [];
    for (const b of branches) {
      if (!query) {
        scored.push({ branch: b, hits: [] });
        continue;
      }
      const byName = fuzzy(query, b.name);
      if (byName) {
        scored.push({ branch: b, hits: byName.hits });
        continue;
      }
      const bySubject = b.subject.toLowerCase().includes(query.toLowerCase());
      if (bySubject) scored.push({ branch: b, hits: [] });
    }
    const local = scored
      .filter((s) => !s.branch.is_remote)
      .sort((x, y) => {
        if (query) {
          const sx = fuzzy(query, x.branch.name)?.score ?? 0;
          const sy = fuzzy(query, y.branch.name)?.score ?? 0;
          if (sx !== sy) return sy - sx;
        }
        return y.branch.timestamp - x.branch.timestamp;
      });
    const remote = scored
      .filter((s) => s.branch.is_remote)
      .sort((x, y) => y.branch.timestamp - x.branch.timestamp);
    items = [...local, ...remote];
    if (cursor >= items.length) cursor = Math.max(0, items.length - 1);

    if (!items.length) {
      list.innerHTML = h`<div class="empty">${icon("branch", 22)}<div>Kein Branch gefunden</div></div>`;
      return;
    }
    const rowHtml = (item: Item, idx: number) => {
      const b = item.branch;
      const ab = [
        b.ahead ? `<span class="up">↑${b.ahead}</span>` : "",
        b.behind ? `<span class="down">↓${b.behind}</span>` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return h`
        <div class="pop-item${idx === cursor ? " sel" : ""}${b.is_current ? " current" : ""}" data-idx="${idx}">
          <span class="dot${b.is_current ? " on" : ""}"></span>
          <span class="bname">${markHits(b.name, item.hits)}</span>
          ${b.is_current ? h`<span class="chip head">aktuell</span>` : ""}
          ${b.upstream ? `<span class="chip mono">→ ${esc(b.upstream)}</span>` : ""}
          ${ab ? `<span class="ab-count">${ab}</span>` : ""}
          <span class="bsub" title="${esc(b.subject)}">${esc(b.subject)}</span>
          <span class="small muted nowrap">${esc(b.short_hash)} · ${esc(relTime(b.timestamp))}</span>
          <span class="actions">
            ${
              b.is_current
                ? h`<span class="chip head" title="Dieser Branch ist ausgecheckt">ausgecheckt</span>`
                : h`<button class="mini" data-act="checkout" data-idx="${idx}"
                     title="Diesen Branch auschecken – Zeile anklicken genügt">${icon("right", 12)} wechseln</button>`
            }
            ${
              b.is_current || act.allowMerge === false
                ? ""
                : h`<button class="mini quiet" data-act="merge" data-idx="${idx}"
                     title="„${esc(b.name)}“ in den aktuellen Branch mergen (nicht auschecken)">${icon("merge", 12)}</button>`
            }
            ${!b.is_current ? h`<button class="mini quiet" data-act="compare" data-idx="${idx}" title="Mit aktuellem Branch vergleichen">Diff</button>` : ""}
            <button class="mini quiet" data-act="newfrom" data-idx="${idx}"
              title="Neuen Branch von „${esc(b.name)}“ aus starten">${icon("plus", 12)}</button>
            ${
              b.is_remote
                ? h`<button class="mini quiet danger" data-act="delete-remote" data-idx="${idx}" title="Remote-Branch löschen">${icon("trash", 12)}</button>`
                : b.is_current
                  ? ""
                  : h`<button class="mini quiet danger" data-act="delete" data-idx="${idx}" title="Lokalen Branch löschen">${icon("trash", 12)}</button>`
            }
          </span>
        </div>`;
    };
    const localIdx = (item: Item) => items.indexOf(item);
    list.innerHTML = `
      ${local.length ? h`<div class="group-title">Lokal (${local.length})</div>${local.map((x) => rowHtml(x, localIdx(x))).join("")}` : ""}
      ${remote.length ? h`<div class="group-title">Remote (${remote.length})</div>${remote.map((x) => rowHtml(x, localIdx(x))).join("")}` : ""}`;
  };

  const close = () => {
    pop.remove();
    document.removeEventListener("mousedown", onOutside, true);
  };
  const onOutside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) close();
  };

  const activate = (idx: number, mode: "checkout" | "merge" | "delete" | "delete-remote" | "newfrom" | "compare") => {
    const item = items[idx];
    if (!item) return;
    const b = item.branch;
    switch (mode) {
      case "checkout":
        act.onCheckout(b);
        break;
      case "merge":
        if(act.allowMerge === false) return;
        act.onMerge(b);
        break;
      case "compare":
        act.onCompare(b);
        break;
      case "delete":
        act.onDelete(b);
        break;
      case "delete-remote":
        act.onDelete(b);
        break;
      case "newfrom":
        act.onNewFrom(b);
        break;
    }
    close();
  };

  list.addEventListener("mouseover", (e) => {
    const row = (e.target as HTMLElement).closest(".pop-item") as HTMLElement | null;
    if (!row) return;
    cursor = Number(row.dataset.idx);
    list.querySelectorAll(".pop-item").forEach((n) => n.classList.remove("sel"));
    row.classList.add("sel");
  });

  pop.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest("[data-act]") as HTMLElement | null;
    if (btn && btn.dataset.act !== "new") {
      const idx = Number(btn.dataset.idx);
      activate(idx, btn.dataset.act as any);
      return;
    }
    if (target.closest('[data-act="new"]')) {
      act.onCreate();
      close();
      return;
    }
    const row = target.closest(".pop-item") as HTMLElement | null;
    if (row) activate(Number(row.dataset.idx), "checkout");
  });

  input.addEventListener("input", () => {
    cursor = 0;
    build();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      cursor = Math.min(items.length - 1, cursor + 1);
      build();
      list.querySelector(".pop-item.sel")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(0, cursor - 1);
      build();
      list.querySelector(".pop-item.sel")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && !e.altKey) {
      e.preventDefault();
      const item = items[cursor];
      if (!item) return;
      if (item.branch.is_current) {
        toast(t("Dieser Branch ist bereits ausgecheckt"), "info");
        return;
      }
      activate(cursor, "checkout");
    } else if (e.altKey && e.key === "Enter") {
      // Alt+Enter bleibt von der Texteingabe getrennt.
      const item = items[cursor];
      if (item && !item.branch.is_current && act.allowMerge !== false) {
        e.preventDefault();
        activate(cursor, "merge");
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  pop.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  });

  document.addEventListener("mousedown", onOutside, true);
  build();
  input.focus();
}
