import { t, h, m } from "./i18n";
// Panels: Änderungen, Branch-Liste, Historie, Konsole.

import type {
  BranchInfo,
  CommitInfo,
  CommandResult,
  FileChange,
  RepoSnapshot,
  RepoStatus,
} from "./api";
import { branchSync } from "./sync";
import { canMergeInto } from "./workflow";
import { baseName, dirName } from "./merge";
import { absTime, el, esc, fuzzy, icon, relTime, splitPath } from "./ui";

export interface PanelCtx {
  snapshot(): RepoSnapshot | null;
  status(): RepoStatus | null;
  branches(): BranchInfo[];
  history(): CommitInfo[];
  selectedCommit(): string | null;
  commitFiles(): FileChange[];
  logLines(): string[];
  openMerge(path: string): void;
  openWorkingDiff(path: string, area?: "staged" | "work" | "untracked"): void;
  previewFile?(path: string, area: "staged" | "work" | "untracked"): void;
  showFileHistory?(path: string): void;
  showBranchHistory?(branch: BranchInfo, outgoing?: boolean): void;
  historyPath?: string | null;
  historyBranch?: string | null;
  historyOutgoing?: boolean;
  favoriteBranches?(): Set<string>;
  toggleFavorite?(name: string): void;
  openCommitDiff(hash: string, path: string): void;
  selectCommit(hash: string): void;
  openBranchMenu(anchor: HTMLElement): void;
  checkout(b: BranchInfo): void;
  merge(b: BranchInfo): void;
  compare(b: BranchInfo): void;
  mergeAbort(): void;
  revertCommit?(commit:CommitInfo): void;
  revertControl?(abort:boolean): void;
  mergeContinue(): void;
  push?(): void;
  mergeError?:string;
  remove(b: BranchInfo): void;
  cleanupBranches?(): void;
  newFrom(b: BranchInfo | null): void;
  run(label: string, fn: () => Promise<CommandResult>): void;
  runMerge(label: string, fn: () => Promise<any>): void;
  commit(message: string, amend: boolean): void;
  stage(paths: string[]): void;
  unstage(paths: string[]): void;
  discard(paths: string[]): void;
  rollback(paths?: string[]): void;
  resolveSide(path: string, side: "ours" | "theirs"): void;
  rawGit(cmd: string): void;
  rawCommand(args: string[]): Promise<CommandResult>;
  /** Anker für das Branch-Popover (Branch-Chip in der Kopfzeile) */
  searchAnchor(): HTMLElement | null;
  mergeNoFF(): boolean;
  setMergeNoFF(v: boolean): void;
}

const STATUS_LETTER: Record<string, string> = {
  conflicted: "!",
  staged: "S",
  modified: "M",
  untracked: "?",
  deleted: "D",
  renamed: "R",
};

function fileRow(
  entry: { path: string; state: string; conflict_code?: string | null; orig_path?: string | null; partial?: boolean },
  actions: { act: string; label: string; title: string; danger?: boolean; primary?: boolean; disabled?: boolean }[],
  area = "work",
): string {
  const { dir, base } = splitPath(entry.path);
  return h`
    <div class="row" data-path="${esc(entry.path)}" data-area="${area}">
      ${entry.state !== "conflicted" ? `<label class="stage-check" title="${area === "staged" ? t("Aus dem nächsten Commit herausnehmen") : t("Änderungen für den nächsten Commit vormerken")}"><input type="checkbox" data-stage-file="${area}" ${area === "staged" ? "checked" : ""} aria-label="${area === "staged" ? t("Für Commit vorgemerkt") : t("Für Commit vormerken")}: ${esc(entry.path)}"></label>` : ""}
      <span class="status ${entry.state}" title="${esc(entry.conflict_code ?? entry.state)}">${
        esc(entry.conflict_code ?? STATUS_LETTER[entry.state] ?? "?")
      }</span>
      <button class="fpath" data-row-act="diff" title="Änderungen ansehen: ${esc(entry.path)}"><span class="dir">${esc(dir)}</span><b>${esc(base)}</b></button>
      ${
        entry.orig_path
          ? h`<span class="chip">aus ${esc(entry.orig_path)}</span>`
          : ""
      }
      ${entry.partial ? h`<span class="partial-stage" title="Ein Teil dieser Datei ist vorgemerkt. Weitere Änderungen stehen unter „Noch nicht vorgemerkt“.">Teilweise vorgemerkt</span>` : ""}
      <span class="actions">
        ${actions
          .filter(a => !["diff","stage","unstage"].includes(a.act))
          .map(
            (a) =>
              `<button class="mini${a.danger ? " danger" : ""}${a.primary ? " primary" : ""}" data-row-act="${a.act}" ${a.disabled ? "disabled" : ""} title="${esc(a.title)}" aria-label="${esc(a.label)}: ${esc(entry.path)}">${a.act === "rollback" ? icon("undo",15) : esc(a.label)}</button>`,
          )
          .join("")}
        <button class="mini row-secondary" data-row-act="history" title="Dateihistorie ansehen" aria-label="Historie: ${esc(entry.path)}">${icon("history",15)}</button>
      </span>
    </div>`;
}

export function renderChanges(ctx: PanelCtx): HTMLElement {
  const st = ctx.status();
  const wrap = el("div", "panel-pad changes-panel");
  if (!st) {
    wrap.appendChild(el("div", "empty", h`${icon("changes", 26)}<b>Kein Repository geöffnet</b>`));
    return wrap;
  }
  const snap = ctx.snapshot?.();
  const blocked = !!(st.merging || st.conflicts.length || snap?.rebasing || snap?.cherry_picking || snap?.reverting);
  const tracked = st.staged.length + st.changed.length;
  wrap.insertAdjacentHTML("beforeend", h`<header class="page-heading"><div><h1>Änderungen</h1><p class="muted">Prüfe deine Änderungen und bereite den nächsten Commit vor.</p></div>
    <div class="changes-actions"><button class="btn" data-top-act="rollback" ${blocked || !tracked || !snap?.head ? "disabled" : ""}>${icon("undo",14)} Rollback …</button></div></header>`);
  if(ctx.mergeError)wrap.insertAdjacentHTML('beforeend',`<p class="merge-inline-error" role="alert">${esc(ctx.mergeError)}</p>`);
  if(snap?.reverting)wrap.insertAdjacentHTML('beforeend',h`<div class="banner warn"><div><b>Revert läuft</b><p>${st.conflicts.length?t('Löse zuerst alle Konfliktdateien.'):t('Ergebnis prüfen und Revert abschließen. Danach kannst du pushen.')}</p></div><span class="right row-actions-gap"><button class="btn" data-top-act="revert-abort">Revert abbrechen</button><button class="btn primary" data-top-act="revert-continue" ${st.conflicts.length?'disabled':''}>Revert abschließen</button></span></div>`);
  const mergingBanner = st.merging
    ? h`<div class="banner error">${icon("merge", 15)}
        <b>Merge noch nicht abgeschlossen.</b> ${st.conflicts.length ? m`${st.conflicts.length} Datei(en) mit Konflikten. Löse diese zuerst.` : t("Alle Konflikte sind gelöst. „Merge abschließen“ erstellt den Merge-Commit. Danach kannst du pushen.")}
        <span class="right"><button class="btn" data-top-act="merge-abort">Merge abbrechen</button>
        ${
          st.conflicts.length === 0
            ? h`<button class="btn primary" data-top-act="merge-continue">Merge abschließen</button>`
            : h`<button class="btn primary" data-top-act="resolve-first">Konflikte lösen</button>`
        }</span></div>`
    : "";
  const current=ctx.branches?.().find(branch=>branch.is_current);
  if(st.merging)wrap.insertAdjacentHTML('beforeend',h`<p class="merge-steps">Konflikte lösen → Merge abschließen → Pushen</p>`);
  else if(current?.ahead)wrap.insertAdjacentHTML('beforeend',h`<div class="banner"><span>Commit erstellt · noch nicht gepusht</span><button class="btn primary" data-top-act="push">Pushen</button></div>`);
  if (mergingBanner) wrap.insertAdjacentHTML("beforeend", mergingBanner);
  const section = (
    title: string,
    entries: RepoStatus["all"],
    rows: string,
  ) => {
    if (!entries.length) return "";
    return `
      <section class="section">
        <header><h3>${title}</h3><span class="count">${entries.length}</span>
        </header>
        <div class="rows">${rows}</div>
      </section>`;
  };

  const conflictRows = st.conflicts
    .map((e) =>
      fileRow(e, [
        { act: "merge", label: t("auflösen"), title: t("Merge-Editor öffnen"), primary: true },
        { act: "take-ours", label: t("lokal"), title: t("Komplett die lokale Fassung nehmen") },
        { act: "take-theirs", label: t("eingehend"), title: t("Komplett die eingehende Fassung nehmen") },
      ]),
    )
    .join("");
  const stagedRows = st.staged
    .map((e) =>
      fileRow({...e,partial:st.changed.some(file=>file.path===e.path)}, [
        { act: "diff", label: "Diff", title: t("Änderungen ansehen") },
        { act: "unstage", label: t("Herausnehmen"), title: t("Zurück in die Arbeitskopie") },
        { act: "rollback", label: "Rollback", title: t("Auf den letzten Commit zurücksetzen"), danger: true, disabled: blocked },
      ], "staged"),
    )
    .join("");
  const changedRows = st.changed
    .map((e) =>
      fileRow({...e,partial:st.staged.some(file=>file.path===e.path)}, [
        { act: "diff", label: "Diff", title: t("Änderungen ansehen") },
        { act: "stage", label: t("Vormerken"), title: t("Zum Commit vormerken") },
        { act: "rollback", label: "Rollback", title: t("Auf den letzten Commit zurücksetzen"), danger: true, disabled: blocked },
      ]),
    )
    .join("");
  const untrackedRows = st.untracked
    .map((e) =>
      fileRow(e, [
        { act: "stage", label: t("Vormerken"), title: t("Zum Commit vormerken") },
        { act: "discard", label: t("löschen"), title: t("Datei löschen"), danger: true },
      ], "untracked"),
    )
    .join("");

  wrap.insertAdjacentHTML(
    "beforeend",
    `
    ${section(t("Konflikte"), st.conflicts, conflictRows)}
    ${section(t("Für Commit vorgemerkt"), st.staged, stagedRows)}
    ${section(t("Noch nicht vorgemerkt"), st.changed, changedRows)}
    ${section(t("Neue Dateien"), st.untracked, untrackedRows)}
    ${
      st.all.length === 0
        ? h`<div class="empty">${icon("check", 26)}<b>Arbeitskopie ist sauber</b><div class="small">Keine Änderungen, keine Konflikte.</div></div>`
        : ""
    }`,
  );

  const pending = [...new Set([...st.changed,...st.untracked].map(file=>file.path))];
  const selectable = st.staged.length + pending.length;
  if(selectable) {
    const selection=el("div","staging-summary");
    selection.innerHTML=h`<label><input type="checkbox" data-stage-all aria-label="Alle Änderungen für Commit vormerken" ${st.staged.length && !pending.length ? "checked" : ""}><span>Alle Änderungen</span></label><span class="small muted">${st.staged.length} vorgemerkt · ${pending.length} offen</span>`;
    selection.querySelector<HTMLInputElement>("input")!.indeterminate=st.staged.length>0 && pending.length>0;
    wrap.appendChild(selection);
  }
  const list=el("div", "changes-list");
  const sections=[...wrap.children].filter(node=>node.matches(".section,.empty"));
  if(sections.length) { wrap.insertBefore(list,sections[0]); sections.forEach(node=>list.appendChild(node)); }

  const summary=wrap.querySelector(".staging-summary");
  if(summary) list.prepend(summary);
  wrap.querySelectorAll<HTMLInputElement>('[data-stage-file]').forEach(input=>{
    const path=input.closest<HTMLElement>('.row')?.dataset.path;
    if(st.staged.some(f=>f.path===path)&&st.changed.some(f=>f.path===path)){input.indeterminate=true;input.setAttribute('aria-checked','mixed');}
  });
  wrap.addEventListener("change",event=>{
    const input=event.target as HTMLInputElement;
    if(!input.matches('input[data-stage-file],input[data-stage-all]')) return;
    let paths:string[]=[];
    let unstage=false;
    if(input.hasAttribute("data-stage-all")) {
      unstage=!input.checked;
      paths=unstage ? st.staged.map(file=>file.path) : pending;
    } else {
      const row=input.closest<HTMLElement>(".row")!;
      paths=[row.dataset.path!];unstage=!input.checked;
    }
    if(!paths.length) return;
    wrap.querySelectorAll<HTMLInputElement>('input[data-stage-file],input[data-stage-all]').forEach(control=>control.disabled=true);
    if(unstage)ctx.unstage(paths);else ctx.stage(paths);
  });

  // Commit-Box
  const box = el("section", "commit-box");
  box.innerHTML = h`
    <div class="commit-heading"><label for="commit-message">Commit vorbereiten</label><span class="commit-count">${st.staged.length} vorgemerkt</span>
      <button class="mini" data-top-act="last-message" title="Eine vorherige Commit-Nachricht übernehmen">Letzte Nachricht</button></div>
    <textarea id="commit-message" aria-label="Commit-Nachricht" class="commit-msg" placeholder="Commit-Nachricht …" rows="3"></textarea>
    <p class="small muted commit-hint" role="status"></p>
    <div class="line2">
      <label class="commit-mode-label">Commit-Art
        <select class="commit-mode" aria-label="Commit-Art">
          <option value="new">Neuer Commit</option>
          <option value="amend">Letzten Commit ändern (Amend)</option>
        </select>
      </label>
      <span class="right row-actions-gap">
        <button class="btn primary" data-top-act="commit" title="Lokalen Commit erstellen (Strg+Enter). Mit Push veröffentlichen.">${icon("check", 14)} Commit
          <span class="kbd">Strg+↵</span></button>
      </span>
    </div>`;
  const mode = box.querySelector<HTMLSelectElement>(".commit-mode")!;
  const updateCommit = () => {
    const button=box.querySelector<HTMLButtonElement>('[data-top-act="commit"]')!;
    button.innerHTML=h`${icon("check",14)} ${mode.value === "amend" ? t("Commit ändern") : "Commit"} <span class="kbd">Strg+↵</span>`;
    const amend=mode.value === "amend";
    button.disabled=blocked || (!amend && !st.staged.length) || (amend && !snap?.head);
    const hint=blocked ? t("Schließe zuerst den laufenden Git-Vorgang ab oder löse die Konflikte.") : amend ? t("Ändert den letzten Commit. Das ist auch ohne Dateiänderungen möglich.") : st.staged.length ? t("Die angehakten Änderungen werden lokal gespeichert. Danach kannst du pushen.") : st.all.length ? t("Hake zuerst die Dateien an, die du committen möchtest.") : t("Keine Änderungen vorhanden – es gibt nichts Neues zu committen.");
    box.querySelector(".commit-hint")!.textContent=hint;
    button.title=button.disabled ? hint : t("Lokalen Commit erstellen (Strg+Enter). Mit Push veröffentlichen.");
  };
  mode.addEventListener("change", updateCommit);
  updateCommit();
  wrap.appendChild(box);

  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const rowAct = (target.closest("[data-row-act]") as HTMLElement | null)?.dataset.rowAct;
    const path = (target.closest(".row") as HTMLElement | null)?.dataset.path;
    if (rowAct && path) {
      switch (rowAct) {
        case "merge":
          return ctx.openMerge(path);
        case "diff":
          if (st.conflicts.some(x=>x.path===path)) return ctx.openMerge(path);
          const area = (target.closest(".row") as HTMLElement).dataset.area as "staged" | "work" | "untracked";
          return ctx.previewFile ? ctx.previewFile(path, area) : ctx.openWorkingDiff(path, area);
        case "history": return ctx.showFileHistory?.(path);
        case "stage":
          return ctx.stage([path]);
        case "unstage":
          return ctx.unstage([path]);
        case "discard":
          return ctx.discard([path]);
        case "rollback":
          return ctx.rollback([path]);
        case "take-ours":
          return ctx.resolveSide(path, "ours");
        case "take-theirs":
          return ctx.resolveSide(path, "theirs");
      }
      return;
    }
    const top = (target.closest("[data-top-act]") as HTMLElement | null)?.dataset.topAct;
    if (!top) return;
    switch (top) {
      case "revert-abort": return ctx.revertControl?.(true);
      case "revert-continue": return ctx.revertControl?.(false);
      case "rollback": return ctx.rollback();
      case "stage-changed":
        return ctx.stage(st.changed.map((x) => x.path));
      case "stage-all":
        return ctx.stage(st.untracked.map((x) => x.path));
      case "unstage-all":
        return ctx.unstage(st.staged.map((x) => x.path));
      case "last-message": {
        const subjects = ctx
          .history()
          .slice(0, 10)
          .map((c) => c.subject);
        if (!subjects.length) return;
        const box2 = box.querySelector(".commit-msg") as HTMLTextAreaElement;
        box2.value = subjects[0];
        const menu = el("div", "popover");
        menu.style.width = "380px";
        const rect = (target as HTMLElement).getBoundingClientRect();
        menu.style.left = `${Math.max(8, rect.left - 240)}px`;
        menu.style.top = `${rect.bottom + 6}px`;
        menu.innerHTML = h`<div class="group-title">Letzte Commit-Nachrichten</div><div class="list">${subjects
          .map(
            (s, i) =>
              `<div class="pop-item" data-msg="${i}"><span class="bsub" style="flex:1">${esc(s)}</span></div>`,
          )
          .join("")}</div>`;
        document.body.appendChild(menu);
        const close = () => menu.remove();
        setTimeout(() => document.addEventListener("mousedown", close, { once: true }), 0);
        menu.addEventListener("click", (ev) => {
          const idx = (ev.target as HTMLElement).closest("[data-msg]")?.getAttribute("data-msg");
          if (idx === null || idx === undefined) return;
          box2.value = subjects[Number(idx)];
          close();
        });
        return;
      }
      case "commit": {
        const msg = (box.querySelector(".commit-msg") as HTMLTextAreaElement).value;
        const amend = (box.querySelector(".commit-mode") as HTMLSelectElement).value === "amend";
        return ctx.commit(msg, amend);
      }
      case "merge-abort":
        return ctx.mergeAbort();
      case "push": ctx.push?.(); break;
      case "merge-continue":
        return ctx.mergeContinue();
      case "resolve-first": {
        const first = ctx.status()?.conflicts[0];
        if (first) ctx.openMerge(first.path);
        return;
      }
    }
  });
  return wrap;
}

export interface BranchViewState {
  query: string;
  scope: "all" | "local" | "remote";
  sort: "recent" | "name";
  scrollTop: number;
}

export function renderBranches(ctx: PanelCtx, state: BranchViewState = {query: "", scope: "all", sort: "recent", scrollTop: 0}): HTMLElement {
  const wrap = el("div", "panel-pad branches-panel");
  const all = ctx.branches();
  const target = ctx.snapshot()?.head_branch ?? "detached HEAD";
  const allowMerge=canMergeInto(ctx.snapshot()?.head_branch);
  const merging = !!(ctx.snapshot()?.merging || ctx.snapshot()?.rebasing || ctx.snapshot()?.cherry_picking || ctx.snapshot()?.reverting);
  wrap.innerHTML = h`
    <div class="branch-toolbar"><header class="page-heading"><div><h1>Branches</h1>
      <p class="muted">Branches durchsuchen, wechseln und vergleichen.</p></div>
      <div class="row-actions-gap"><button class="btn" data-branch-act="cleanup" ${merging || !all.some(b=>!b.is_remote&&!b.is_current) ? "disabled" : ""}>Lokale Branches aufräumen …</button>
      <button class="btn primary" data-branch-act="create" ${merging ? "disabled" : ""}>${icon("plus", 14)} Neuer Branch</button></div></header>
    ${merging ? h`<div class="banner warn" role="status">Ein Git-Vorgang läuft. Löse zuerst die Konflikte unter „Änderungen“ und schließe den Vorgang ab.</div>` : ""}
    <div class="branch-tools">
      <label class="branch-search">${icon("search", 16)}<input type="search" aria-label="Branches filtern" placeholder="Name oder letzte Commit-Nachricht …"></label>
      <label class="small">Anzeigen <select class="branch-scope" aria-label="Branch-Typ"><option value="all">Alle Branches</option><option value="local">Nur lokal</option><option value="remote">Nur remote</option></select></label>
      <label class="small">Sortierung <select class="branch-sort" aria-label="Branches sortieren"><option value="recent">Zuletzt geändert</option><option value="name">Name A–Z</option></select></label>
    </div>
    ${allowMerge ? h`<div class="merge-direction">${icon("merge", 16)}<span>„Mergen“ übernimmt den gewählten Branch in <strong class="mono">${esc(target)}</strong>.</span>
      <label class="switch"><input type="checkbox" class="opt-noff" ${ctx.mergeNoFF() ? "checked" : ""}> Immer Merge-Commit erstellen</label></div>` : h`<p class="integration-note">Integration in <span class="mono">${esc(target)}</span> über Merge Requests in GitLab.</p>`}
    <div class="branch-filter-status" role="status"></div></div>
    <div class="branch-groups"></div>`;
  const search = wrap.querySelector('input[type="search"]') as HTMLInputElement;
  const scope = wrap.querySelector('.branch-scope') as HTMLSelectElement;
  const sort = wrap.querySelector('.branch-sort') as HTMLSelectElement;
  const groups = wrap.querySelector('.branch-groups') as HTMLElement;
  search.value = state.query; scope.value = state.scope; sort.value = state.sort;
  const draw = () => {
    state.query = search.value; state.scope = scope.value as BranchViewState["scope"]; state.sort = sort.value as BranchViewState["sort"];
    const query = search.value.trim();
    const filtered = all.filter(b => (!query || fuzzy(query, b.name) || b.subject.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      && (scope.value === "all" || b.is_remote === (scope.value === "remote")))
      .sort((a,b) => Number(b.is_current)-Number(a.is_current) || (sort.value === "name" ? a.name.localeCompare(b.name) : b.timestamp-a.timestamp));
    const filteredActive = !!query || scope.value !== "all";
    wrap.querySelector(".branch-filter-status")!.innerHTML = h`<span>${filtered.length} von ${all.length} Branches${filteredActive ? t(" · gefiltert") : ""}</span>${filteredActive ? h`<button class="mini" data-branch-act="reset">Filter zurücksetzen</button>` : ""}`;
    const favorites = ctx.favoriteBranches?.() ?? new Set<string>();
    groups.innerHTML = ["favorites", "local", "remote"].map(group => {
      const rows = filtered.filter(b=>group === "favorites" ? favorites.has(b.name) : !favorites.has(b.name) && b.is_remote === (group === "remote"));
      return rows.length ? `<section class="section"><header><h2>${group === "favorites" ? t("Favoriten") : group === "remote" ? t("Remote-Branches") : t("Lokale Branches")}</h2><span class="count">${rows.length}</span></header><div class="rows">${rows.map(b=>branchRow(b, merging, target, favorites.has(b.name), allowMerge)).join("")}</div></section>` : "";
    }).join("") || `<div class="empty"><b>${all.length ? t("Keine passenden Branches") : t("Noch keine Branches")}</b><span>${all.length ? t("Passe Suche oder Filter an.") : t("Erstelle zuerst einen Commit unter Änderungen.")}</span></div>`;
  };
  const filterChanged = () => { state.scrollTop = 0; draw(); groups.scrollTop = 0; };
  search.addEventListener("input", filterChanged); scope.addEventListener("change", filterChanged); sort.addEventListener("change", filterChanged);
  groups.addEventListener("scroll", () => { state.scrollTop = groups.scrollTop; });
  const noff = wrap.querySelector(".opt-noff") as HTMLInputElement;
  noff?.addEventListener("change", () => ctx.setMergeNoFF(noff.checked));
  wrap.addEventListener("click", e => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-branch-act="cleanup"]')) return ctx.cleanupBranches?.();
    if (target.closest('[data-branch-act="create"]')) return ctx.newFrom(null);
    if (target.closest('[data-branch-act="reset"]')) { search.value = ""; scope.value = "all"; filterChanged(); search.focus(); return; }
    const button = target.closest('[data-b-act]') as HTMLButtonElement | null;
    const name = (target.closest('.branch-row') as HTMLElement | null)?.dataset.name;
    const branch = all.find(b=>b.name === name);
    if (!button || button.disabled || !branch) return;
    switch(button.dataset.bAct) {
      case "favorite": return ctx.toggleFavorite?.(branch.name);
      case "checkout": return ctx.checkout(branch);
      case "merge": return ctx.merge(branch);
      case "compare": return ctx.compare(branch);
      case "history": return ctx.showBranchHistory?.(branch, !branch.is_remote && !!branch.upstream && branch.tracking_known && branch.ahead > 0);
      case "newfrom": return ctx.newFrom(branch);
      case "delete": return ctx.remove(branch);
    }
  });
  draw(); groups.scrollTop = state.scrollTop; return wrap;
}

function branchRow(b: BranchInfo, blocked: boolean, target: string, favorite = false, allowMerge = true): string {
  const disabled = blocked ? "disabled" : "";
  const sync=b.is_remote ? null : branchSync(b);
  return h`<div class="branch-row${b.is_current ? " current" : ""}" data-name="${esc(b.name)}">
    <button class="favorite-button" data-b-act="favorite" aria-pressed="${favorite}" aria-label="${esc(b.name)} ${favorite ? t("aus Favoriten entfernen") : t("als Favorit merken")}">${favorite ? "★" : "☆"}</button>
    <span class="dot${b.is_current ? " on" : ""}"></span>
    <div class="branch-detail"><div class="branch-identity"><span class="bname">${esc(b.name)}</span>
      ${b.is_current ? h`<span class="chip head">Aktueller Branch</span>` : ""}
      ${sync ? `<span class="chip sync-${sync.tone}" title="${esc(sync.detail)}">${esc(sync.label)}</span>` : ""}</div>
      <div class="branch-meta"><span class="bsub" title="${esc(b.subject)}">${esc(b.subject || t("Kein Commit"))}</span>
      <span class="bdate" title="${esc(absTime(b.timestamp))}">${esc(b.short_hash)} · ${esc(relTime(b.timestamp))}</span></div>
      <span class="small muted">${b.upstream ? m`Verfolgt ${esc(b.upstream)}` : b.is_remote ? t("Remote · beim Wechsel lokal verfolgen") : t("Lokal · kein Upstream")}</span></div>
    <div class="actions branch-actions">
      ${branchAction("history", t("Commits ansehen"), "history", b.name)}
      ${!b.is_current ? branchAction("checkout", t("Wechseln"), "checkout", b.name, disabled) : ""}
      ${!b.is_current ? branchAction("compare", t("Vergleichen"), "compare", b.name) : ""}
      ${!b.is_current && allowMerge ? branchAction("merge", m`In ${target} mergen`, "merge", b.name, disabled) : ""}
      ${branchAction("newfrom", t("Neuer Branch von hier"), "branchPlus", b.name, disabled)}
      ${!b.is_current ? branchAction("delete", t(b.is_remote ? "Remote-Branch löschen" : "Lokalen Branch löschen"), "trash", b.name, disabled, true) : ""}
    </div></div>`;
}

function branchAction(action:string, label:string, glyph:string, branch:string, disabled="", danger=false):string {
  const description = label + " · " + branch;
  return `<button class="icon-btn${danger ? " danger" : ""}" data-b-act="${action}" ${disabled} title="${esc(description)}" aria-label="${esc(description)}">${icon(glyph,16)}</button>`;
}

export function renderHistory(ctx: PanelCtx): HTMLElement {
  const wrap = el("div", "panel-pad");
  const commits = ctx.history();
  wrap.addEventListener("click", e => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-all-history]")) ctx.showFileHistory?.("");
    if (target.closest("[data-branch-history]")) {
      const branch = ctx.branches().find(b => b.name === ctx.historyBranch);
      if (branch) ctx.showBranchHistory?.(branch, !ctx.historyOutgoing && !!branch.upstream && branch.tracking_known && branch.ahead > 0);
    }
  });
  const selected = ctx.selectedCommit();
  const files = ctx.commitFiles();
  const sel = commits.find((c) => c.hash === selected);
  wrap.innerHTML = `
    ${ctx.historyPath ? h`<header class="page-heading"><h1>Dateihistorie: ${esc(ctx.historyPath)}</h1><button class="btn" data-all-history>Gesamte Historie</button></header>` : ""}
    ${ctx.historyBranch ? h`<header class="page-heading"><div><h1>${ctx.historyOutgoing ? t("Ausstehende Commits") : t("Branch-Historie")}: ${esc(ctx.historyBranch)}</h1><p class="muted">${ctx.historyOutgoing ? t("Diese Commits fehlen dem lokal bekannten Tracking-Branch.") : t("Commits dieses Branches ohne Checkout.")}</p></div><div class="row-actions-gap">${ctx.historyOutgoing || (ctx.branches().find(b=>b.name===ctx.historyBranch)?.ahead ?? 0)>0 ? `<button class="btn" data-branch-history>${ctx.historyOutgoing ? t("Alle Commits") : t("Ausstehende Commits")}</button>` : ""}<button class="btn" data-all-history>${t("Gesamte Historie")}</button></div></header>` : ""}
    <div class="hist" style="height:calc(100vh - 120px)">
      <div class="hist-list">
        ${
          commits.length
            ? commits.map((c) => commitRow(c, selected === c.hash)).join("")
            : h`<div class="empty">${icon("history", 26)}<b>Keine Commits</b></div>`
        }
      </div>
      <div class="hist-side">
        ${
          sel
            ? `<div class="commit-head">
                 <div class="subj">${esc(sel.subject)}</div>
                 <div class="meta">${esc(sel.hash.slice(0, 12))} · ${esc(sel.author)} · ${esc(
                   absTime(sel.timestamp),
                 )}</div>
                 <button class="btn" data-revert-commit ${sel.parents.length!==1?'disabled':''} title="${esc(sel.parents.length===1?t('Erstellt einen Gegen-Commit im aktuellen Branch'):t('Nur normale Commits mit einem Vorgänger können hier zurückgenommen werden.'))}">${icon('undo',14)} ${t('Commit zurücknehmen')}</button>
               </div>`
            : h`<div class="empty">${icon("history", 22)}<b>Commit auswählen</b><div class="small">um die geänderten Dateien zu sehen</div></div>`
        }
        ${
          sel && files.length
            ? `<div class="rows">${files
                .map(
                  (f) => h`
              <div class="row" data-path="${esc(f.path)}">
                <span class="status ${f.status.startsWith("D") ? "changed" : "staged"}">${esc(f.status.trim())}</span>
                <span class="fpath"><span class="dir">${esc(dirName(f.path))}</span><b>${esc(
                  baseName(f.path),
                )}</b></span>
                <span class="actions"><button class="mini" data-file-act="diff">Diff</button></span>
              </div>`,
                )
                .join("")}</div>`
            : ""
        }
      </div>
    </div>`;
  wrap.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if(target.closest("[data-revert-commit]")&&sel)return ctx.revertCommit?.(sel);
    const row = target.closest(".commit-row") as HTMLElement | null;
    if (row?.dataset.hash) return ctx.selectCommit(row.dataset.hash);
    const fileDiff = (target.closest("[data-file-act]") as HTMLElement | null)?.dataset.fileAct;
    const path = (target.closest(".row") as HTMLElement | null)?.dataset.path;
    if (fileDiff === "diff" && path && selected) ctx.openCommitDiff(selected, path);
  });
  wrap.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".commit-row");
    if (row?.dataset.hash) { e.preventDefault(); ctx.selectCommit(row.dataset.hash); }
  });
  return wrap;
}

function commitRow(c: CommitInfo, selected: boolean): string {
  const merge = c.parents.length > 1;
  const isHead = c.refs.some((r) => r.includes("HEAD"));
  const dotColor = isHead ? "var(--green)" : merge ? "var(--violet)" : "var(--fg-3)";
  return h`
    <div role="button" tabindex="0" aria-label="Commit ${esc(c.short_hash)}: ${esc(c.subject)}" class="commit-row${selected ? " selected" : ""}" data-hash="${esc(c.hash)}">
      <span class="graph">
        <svg width="22" height="20" viewBox="0 0 22 20">
          <line x1="11" y1="0" x2="11" y2="20" stroke="var(--line)" stroke-width="1.5"/>
          ${
            merge
              ? `<path d="M11 10 L19 3" stroke="var(--violet)" stroke-width="1.3" fill="none" opacity=".7"/>`
              : ""
          }
          <circle cx="11" cy="10" r="${isHead ? 4.5 : 3.6}" fill="${dotColor}"/>
        </svg>
      </span>
      <span class="chash">${esc(c.short_hash)}</span>
      <span class="csubject">${esc(c.subject)}</span>
      <span class="crefs">${c.refs
        .map((r) => {
          const kind = r.includes("HEAD")
            ? "head"
            : r.startsWith("tag:")
              ? "tag"
              : r.includes("/")
                ? "remote"
                : "local";
          return `<span class="chip ${kind}">${esc(r.replace("tag: ", ""))}</span>`;
        })
        .join("")}</span>
      <span class="cauthor">${esc(c.author)}</span>
      <span class="cdate" title="${esc(absTime(c.timestamp))}">${esc(relTime(c.timestamp))}</span>
    </div>`;
}

export function renderConsole(ctx: PanelCtx): HTMLElement {
  const wrap = el("div", "console");
  const log = ctx.logLines();
  wrap.innerHTML = h`
    <div class="log">${
      log.length
        ? log
            .map((l) =>
              l.startsWith("$ ")
                ? `<span class="cmd">${esc(l)}</span>`
                : esc(l),
            )
            .join("\n\n")
        : t("Bereit. Befehle ohne führendes »git« eingeben, z. B. »status --short«.")
    }</div>
    <div class="input">
      <span class="prompt">git</span>
      <input type="text" placeholder="status --short" autocomplete="off" />
      <button class="btn" data-con-act="run">Ausführen</button>
    </div>`;
  const input = wrap.querySelector("input") as HTMLInputElement;
  const run = () => {
    const value = input.value.trim();
    if (!value) return;
    input.value = "";
    ctx.rawGit(value);
  };
  (wrap.querySelector('[data-con-act="run"]') as HTMLElement).addEventListener("click", run);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") run();
  });
  return wrap;
}
