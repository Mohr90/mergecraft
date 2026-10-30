// Mergecraft – App-Rahmen: Kopfzeile, Aktivitätsleiste, Panels, Merge-Editor,
// Diff-Ansicht, Aktionen.

import {
  api,
  type BranchInfo,
  type CommandResult,
  type CommitInfo,
  type ConflictData,
  type FileChange,
  type MergeOutcome,
  type RepoSnapshot,
  type RepoStatus,
} from "./api";
import { openBranchMenu } from "./branchmenu";
import { DiffView } from "./diff";
import { baseName, dirName, MergeEditor } from "./merge";
import { renderBranches, renderChanges, renderConsole, renderHistory, type PanelCtx } from "./panels";
import { askText, confirmDialog, esc, icon, toast } from "./ui";

type Tab = "changes" | "branches" | "history" | "console";
type Overlay = "none" | "merge" | "diff";

const EMPTY_STATUS: RepoStatus = {
  conflicts: [],
  staged: [],
  changed: [],
  untracked: [],
  all: [],
  merging: false,
  head_subject: "",
  head_author: "",
  head_timestamp: 0,
};

class App implements PanelCtx {
  private snap: RepoSnapshot | null = null;
  private branchesList: BranchInfo[] = [];
  private statusData: RepoStatus = EMPTY_STATUS;
  private historyList: CommitInfo[] = [];
  private selected: string | null = null;
  private selectedFiles: FileChange[] = [];
  private logs: string[] = [];
  private tab: Tab = "changes";
  private overlay: Overlay = "none";
  private standalone = false;
  private noFF = true;
  private busy = false;
  private lastStatus = "";
  private welcomeError: { message: string; path: string } | null = null;
  private keysBound = false;

  private root: HTMLElement;
  private titlebar!: HTMLElement;
  private rail!: HTMLElement;
  private panelWrap!: HTMLElement;
  private panelHost!: HTMLElement;
  private mergeHost!: HTMLElement;
  private diffHost!: HTMLElement;
  private statusbar!: HTMLElement;
  private branchTrigger!: HTMLButtonElement;
  private mergeEditor: MergeEditor;
  private diffView: DiffView;
  private mergePath = "";

  constructor(root: HTMLElement) {
    this.root = root;
    this.mergeEditor = new MergeEditor({
      save: async (text, markResolved) => {
        try {
          const r = this.standalone
            ? await api.standaloneSave(text)
            : await api.saveConflict(this.mergePath, text, markResolved);
          return { ok: r.ok, message: r.stdout || r.stderr || "gespeichert" };
        } catch (e) {
          return { ok: false, message: String(e) };
        }
      },
      onSaved: (message, resolved) => {
        toast(message, "ok");
        this.log(message);
        if (resolved && !this.standalone) void this.afterResolve();
      },
      onError: (message) => toast(message, "err"),
      onClose: () => void this.requestCloseOverlay(),
      onSwitch: (path) => void this.openMerge(path),
    });
    this.diffView = new DiffView(() => void this.requestCloseOverlay());
  }

  // ----------------------------------------------------------- Lebenszyklus

  async boot() {
    this.root.innerHTML = `<div class="empty" style="padding-top:20vh">Mergecraft startet …</div>`;
    try {
      const standalone = await api.standaloneData();
      if (standalone) {
        this.standalone = true;
        this.buildShell();
        this.showMerge(standalone);
        toast(`Standalone-Merge: ${standalone.path}`, "info");
        return;
      }
    } catch {
      /* kein Standalone-Merge */
    }
    // Repository vom Aufruf übernehmen, sonst das zuletzt geöffnete
    let snap: RepoSnapshot | null = null;
    try {
      snap = await api.snapshot();
    } catch {
      snap = null;
    }
    if (!snap) {
      const recent = await api.recentRepos().catch(() => [] as string[]);
      for (const r of recent.slice(0, 5)) {
        try {
          snap = await api.openRepo(r);
          toast(`Zuletzt geöffnet: ${snap.name}`, "info");
          break;
        } catch {
          /* Eintrag verschwunden oder kein Repository mehr */
        }
      }
    }
    this.snap = snap;
    if (this.snap) {
      await this.refresh(true);
    } else {
      this.buildShell();
      this.render();
    }
  }

  private get hasRepo(): boolean {
    return !!this.snap?.root;
  }

  private async refresh(deep = false) {
    if (!this.hasRepo) return;
    this.busy = true;
    this.root.querySelector(".shell")?.classList.add("busy");
    try {
      // Die vier Abfragen sind unabhängig - gemeinsam statt nacheinander
      const wantHistory = deep || !this.historyList.length;
      const [snap, branches, status, hist] = await Promise.all([
        api.snapshot(),
        // Einzelne Ausfälle dürfen die ganze Ansicht nicht kosten
        api.branches().catch(() => [] as BranchInfo[]),
        api.status().catch(() => EMPTY_STATUS),
        wantHistory ? api.history(300, false).catch(() => [] as CommitInfo[]) : Promise.resolve(null),
      ]);
      this.snap = snap;
      this.branchesList = branches;
      this.statusData = status;
      if (hist) this.historyList = hist;
      this.mergeEditor.siblings = this.statusData.conflicts.map((c) => ({
        path: c.path,
        code: c.conflict_code ?? "",
      }));
      if (this.selected) {
        this.selectedFiles = await api.commitFiles(this.selected);
      }
    } catch (e) {
      toast(`Repository nicht lesbar: ${String(e)}`, "err");
    } finally {
      this.busy = false;
    }
    this.render();
  }

  // ------------------------------------------------------------- Aufbau

  private buildShell() {
    this.root.innerHTML = `
      <div class="shell">
        <div class="titlebar"></div>
        <div class="body">
          <div class="rail"></div>
          <div class="panel-wrap">
            <div class="panel"></div>
            <div class="merge-host hidden"></div>
            <div class="diff-host hidden"></div>
          </div>
        </div>
        <div class="statusbar"></div>
        <div class="toasts"></div>
        <div class="modal-host"></div>
      </div>`;
    this.titlebar = this.root.querySelector(".titlebar") as HTMLElement;
    this.rail = this.root.querySelector(".rail") as HTMLElement;
    this.panelWrap = this.root.querySelector(".panel-wrap") as HTMLElement;
    this.panelHost = this.root.querySelector(".panel") as HTMLElement;
    this.mergeHost = this.root.querySelector(".merge-host") as HTMLElement;
    this.diffHost = this.root.querySelector(".diff-host") as HTMLElement;
    this.statusbar = this.root.querySelector(".statusbar") as HTMLElement;

    // Ereignisbehandlung genau einmal binden: die Panels werden bei jedem
    // Zeichnen ersetzt, die Rahmen-Elemente bleiben - sonst sammeln sich
    // Listener und jede Aktion liefe mehrfach.
    this.titlebar.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (!act) return;
      switch (act) {
        case "branches":
          if (this.branchTrigger) this.openBranchMenu(this.branchTrigger);
          break;
        case "open":
          void this.pickRepo();
          break;
        case "fetch":
          void this.run("Fetch", () => api.fetchRemote(null));
          break;
        case "pull":
          void this.run("Pull", () => api.pull());
          break;
        case "push":
          void this.run("Push", () => api.push(false));
          break;
        case "refresh":
          void this.refresh(true);
          break;
      }
    });

    this.rail.addEventListener("click", (e) => {
      const tab = (e.target as HTMLElement).closest("[data-tab]")?.getAttribute("data-tab") as Tab;
      if (!tab) return;
      void this.switchTab(tab);
    });

    this.statusbar.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).dataset.act === "reveal" && this.snap) {
        void api.openPath(this.snap.root);
      }
    });

    // Willkommensseite: Pfadeingabe, Ordnerauswahl, Repository anlegen
    this.panelHost.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-act="pick"]')) return void this.pickRepo();
      if (target.closest('[data-act="init"]')) {
        const path = this.welcomeError?.path;
        if (path) void this.initRepo(path);
        return;
      }
      const item = target.closest("[data-recent]") as HTMLElement | null;
      if (item?.dataset.recent) void this.openRepo(item.dataset.recent, true);
    });
    this.panelHost.addEventListener("keydown", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.classList.contains("repo-path") && e.key === "Enter" && input.value.trim()) {
        void this.openRepo(input.value.trim(), true);
      }
    });

    if (!this.keysBound) {
      this.keysBound = true;
      window.addEventListener("keydown", (e) => this.onGlobalKey(e));
    }
  }

  /** Globale Tastenkürzel. */
  private onGlobalKey(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    const target = e.target as HTMLElement | null;
    const typing =
      !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    if (mod && e.key === "Enter" && typing && target?.classList.contains("commit-msg")) {
      e.preventDefault();
      const box = target.closest(".commit-box") as HTMLElement | null;
      const all = (box?.querySelector(".opt-all") as HTMLInputElement | null)?.checked ?? false;
      const amend = (box?.querySelector(".opt-amend") as HTMLInputElement | null)?.checked ?? false;
      const sign = (box?.querySelector(".opt-sign") as HTMLInputElement | null)?.checked ?? false;
      this.commit((target as HTMLTextAreaElement).value, amend, sign, all);
      return;
    }
    if (e.key === "F5" || (mod && e.key.toLowerCase() === "r")) {
      e.preventDefault();
      if (this.hasRepo) void this.refresh(true);
      return;
    }
    if (mod && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      const tabs: Tab[] = ["changes", "branches", "history", "console"];
      void this.switchTab(tabs[Number(e.key) - 1]);
      return;
    }
    if (mod && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "b")) {
      e.preventDefault();
      if (this.hasRepo && this.branchTrigger) this.openBranchMenu(this.branchTrigger);
      return;
    }
    if (e.key === "Escape") {
      // Dialoge behandeln Escape selbst - sonst käme eine zweite Rückfrage
      if (document.querySelector(".modal")) return;
      const pop = document.querySelector(".popover");
      if (pop) {
        pop.remove();
        return;
      }
      if (this.overlay !== "none") void this.requestCloseOverlay();
    }
  }

  /** Tabwechsel mit Schutz vor ungesicherten Merge-Änderungen. */
  private async switchTab(tab: Tab) {
    if (this.tab === tab && this.overlay === "none") return;
    if (this.overlay === "merge" && this.mergeEditor.hasUnsavedChanges()) {
      const ok = await confirmDialog(
        "Ungespeicherte Änderungen verwerfen?",
        "Der Merge-Editor enthält Änderungen, die noch nicht geschrieben wurden.",
        "Verwerfen",
      );
      if (!ok) return;
      this.mergeEditor.discardChanges();
    }
    this.tab = tab;
    this.overlay = "none";
    this.render();
  }

  /** Überlagerung schließen, mit Rückfrage bei ungesicherten Änderungen. */
  async requestCloseOverlay() {
    if (this.overlay === "merge" && this.mergeEditor.hasUnsavedChanges()) {
      const ok = await confirmDialog(
        "Merge-Editor schließen?",
        "Die Änderungen wurden noch nicht gespeichert.",
        "Schließen ohne Speichern",
      );
      if (!ok) return;
      this.mergeEditor.discardChanges();
    }
    this.closeOverlay();
  }

  private render() {
    if (!this.root.querySelector(".shell")) this.buildShell();
    this.root.querySelector(".shell")?.classList.toggle("busy", this.busy);
    if (this.standalone && !this.hasRepo) return this.renderStandaloneChrome();
    if (!this.hasRepo) {
      this.panelHost.classList.remove("hidden");
      this.mergeHost.classList.add("hidden");
      this.diffHost.classList.add("hidden");
      this.renderWelcome();
      return;
    }
    this.renderTitlebar();
    this.renderRail();
    this.renderStatusbar();
    this.panelHost.classList.toggle("hidden", this.overlay !== "none");
    this.mergeHost.classList.toggle("hidden", this.overlay !== "merge");
    this.diffHost.classList.toggle("hidden", this.overlay !== "diff");
    if (this.overlay === "none") this.renderPanel();
    this.syncWindowTitle();
  }

  /** Eigene Kopfzeile, wenn Mergecraft als externes Merge-Tool läuft. */
  private renderStandaloneChrome() {
    this.titlebar.innerHTML = `
      <span class="brand">${icon("logo", 18)} Mergecraft</span>
      <span class="repo-name" title="${esc(this.mergePath)}">${esc(baseName(this.mergePath))}</span>
      <span class="chip merging">Merge-Tool-Modus</span>
      <span class="right row-actions-gap">
        <span class="muted small">lokal | Ergebnis | eingehend</span>
      </span>`;
    this.rail.innerHTML = "";
    this.statusbar.innerHTML = `
      <span class="path">${esc(dirName(this.mergePath))}</span>
      <span class="right dim">ohne Repository – Ergebnis wird in die übergebene Datei geschrieben</span>`;
    this.panelHost.classList.add("hidden");
    this.mergeHost.classList.toggle("hidden", this.overlay !== "merge");
    this.diffHost.classList.add("hidden");
    this.syncWindowTitle();
  }

  /** Fenstertitel der Arbeitsumgebung mitpflegen. */
  private syncWindowTitle() {
    const title = this.hasRepo && this.snap
      ? `${this.snap.name} – ${this.snap.head_branch ?? "HEAD"}${this.statusData.conflicts.length ? ` (${this.statusData.conflicts.length} Konflikte)` : ""} – Mergecraft`
      : this.standalone
        ? `${baseName(this.mergePath)} – Mergecraft (Merge-Tool)`
        : "Mergecraft";
    void api.setTitle(title);
  }

  private renderTitlebar() {
    const s = this.snap!;
    const current = this.branchesList.find((b) => b.is_current);
    const ab = current
      ? [
          current.ahead ? `<span class="up" title="${current.ahead} Commits voraus">↑${current.ahead}</span>` : "",
          current.behind ? `<span class="down" title="${current.behind} Commits zurück">↓${current.behind}</span>` : "",
        ]
          .filter(Boolean)
          .join("")
      : "";
    const conflicts = this.statusData.conflicts.length;
    this.titlebar.innerHTML = `
      <span class="brand">${icon("logo", 18)} Mergecraft</span>
      <span class="repo-name" title="${esc(s.root)}">${esc(s.name)}</span>
      <span class="sep"></span>
      <button class="branch-trigger" data-act="branches" title="Branches durchsuchen und wechseln">
        ${icon("branch", 14)}
        <span class="name">${esc(s.head_branch ?? "detached HEAD")}</span>
        <span class="ab">${ab}</span>
        ${icon("chevron", 13)}
      </button>
      ${s.merging ? `<span class="chip merging">${icon("merge", 12)} Merge läuft</span>` : ""}
      ${s.rebasing ? `<span class="chip merging">Rebase läuft</span>` : ""}
      ${s.cherry_picking ? `<span class="chip merging">Cherry-pick läuft</span>` : ""}
      ${conflicts ? `<span class="chip conflict">${conflicts} Konflikt${conflicts === 1 ? "" : "e"}</span>` : ""}
      <span class="right row-actions-gap">
        <button class="btn ghost" data-act="open" title="Anderes Repository öffnen">${icon("folder", 14)} Öffnen</button>
        <span class="sep"></span>
        <button class="icon-btn" data-act="fetch" title="Fetch (--all --prune)">${icon("fetch", 15)}</button>
        <button class="icon-btn" data-act="pull" title="Pull (= Fetch + Merge)">${icon("pull", 15)}<span style="display:none"></span></button>
        <button class="icon-btn" data-act="push" title="Push">${icon("push", 15)}</button>
        <button class="icon-btn" data-act="refresh" title="Aktualisieren">${icon("refresh", 15)}</button>
      </span>`;
    this.branchTrigger = this.titlebar.querySelector(".branch-trigger") as HTMLButtonElement;
  }

  private renderRail() {
    const items: { tab: Tab; icon: string; title: string; count?: number }[] = [
      {
        tab: "changes",
        icon: "changes",
        title: "Änderungen",
        count: this.statusData.conflicts.length,
      },
      { tab: "branches", icon: "branch", title: "Branches" },
      { tab: "history", icon: "history", title: "Historie" },
      { tab: "console", icon: "console", title: "Konsole" },
    ];
    this.rail.innerHTML = `
      ${items
        .map(
          (i) => `
        <button data-tab="${i.tab}" class="${this.tab === i.tab ? "active" : ""}" title="${i.title}">
          ${icon(i.icon, 18)}
          ${i.count ? `<span class="rail-badge">${i.count}</span>` : ""}
        </button>`,
        )
        .join("")}
      <span class="rail-spacer"></span>`;
  }

  private renderStatusbar() {
    const s = this.snap!;
    const st = this.statusData;
    this.statusbar.innerHTML = `
      <button class="link path" data-act="reveal" title="${esc(s.root)}">${esc(s.root)}</button>
      ${this.lastStatus ? `<span class="${this.lastStatus.startsWith("!") ? "err" : ""}">${esc(this.lastStatus.replace(/^!/, ""))}</span>` : ""}
      <span class="right"></span>
      <span>${st.staged.length} gestaged</span>
      <span>${st.changed.length} geändert</span>
      <span>${st.untracked.length} unversioniert</span>
      <span class="${st.conflicts.length ? "warn" : ""}">${st.conflicts.length} Konflikte</span>
      <span class="dim">${esc(s.head.slice(0, 8))}</span>
      <span class="dim">${esc(s.head_branch ?? "")} · ${esc(st.head_subject.slice(0, 40))}</span>`;
  }

  private renderPanel() {
    this.panelHost.innerHTML = "";
    switch (this.tab) {
      case "changes":
        this.panelHost.appendChild(renderChanges(this));
        break;
      case "branches":
        this.panelHost.appendChild(renderBranches(this));
        break;
      case "history":
        this.panelHost.appendChild(renderHistory(this));
        break;
      case "console":
        this.panelHost.appendChild(renderConsole(this));
        break;
    }
  }

  private renderWelcome() {
    this.titlebar.innerHTML = `
      <span class="brand">${icon("logo", 18)} Mergecraft</span>
      <span class="right row-actions-gap"><span class="muted small">kein Repository geöffnet</span></span>`;
    this.rail.innerHTML = "";
    this.statusbar.innerHTML = "";
    this.panelHost.classList.remove("hidden");
    const err = this.welcomeError;
    this.panelHost.innerHTML = `
      <div class="welcome">
        <div class="logo">${icon("logo", 30)}<h1>Mergecraft</h1></div>
        <p class="lead">Git-Client mit 3-Wege-Merge-Editor: <b>lokal</b> | <b>Ergebnis</b> | <b>eingehend</b> –
        Konflikte Bereich für Bereich auflösen, wie im WebStorm-Merge-Dialog.</p>
        ${
          err
            ? `<div class="banner error" style="max-width:620px;margin:0 auto 18px">
                 ${icon("warning", 15)} <b>Kein Git-Repository gefunden.</b>
                 <span class="mono small" style="display:block;margin-top:4px;opacity:.8">${esc(
                   err.path,
                 )}</span>
                 <span class="small" style="display:block;margin-top:4px;opacity:.8">${esc(
                   err.message,
                 )}</span>
                 <span class="right row-actions-gap">
                   <button class="btn" data-act="init">${icon("plus", 14)} Repository hier anlegen</button>
                 </span>
               </div>`
            : ""
        }
        <div class="open-row">
          <input type="text" class="repo-path" placeholder="/pfad/zum/repo – auch mit ~ am Anfang"
            value="${esc(err?.path ?? "")}" />
          <button class="btn primary big" data-act="pick">${icon("folder", 16)} Ordner wählen …</button>
        </div>
        <div class="recent"><h3>Zuletzt geöffnet</h3><div class="recent-list">
          <p class="muted small">lädt …</p></div></div>
        <div class="hint">
          <h3>Bedienung</h3>
          <p class="small muted">Branch-Chip oben links: suchen, wechseln, mergen, anlegen.
          <b>Strg+1…4</b> wechselt die Bereiche, <b>Strg+R</b> aktualisiert,
          <b>Alt+↑/↓</b> springt im Merge-Editor von Konflikt zu Konflikt.</p>
          <h3>Direkt starten</h3>
          <pre>mergecraft /pfad/zum/repo</pre>
          <h3>Als externes Merge-Tool (ohne gitconfig-Änderung)</h3>
          <pre>mergecraft --merge &lt;lokal&gt; &lt;basis&gt; &lt;eingehend&gt; &lt;ergebnis&gt;</pre>
        </div>
      </div>`;
    const input = this.panelHost.querySelector(".repo-path") as HTMLInputElement;
    if (err) input.select();
    const list = this.panelHost.querySelector(".recent-list") as HTMLElement;
    void api.recentRepos().then((repos) => {
      list.innerHTML = repos.length
        ? `<ul>${repos
            .map(
              (r) =>
                `<li><button data-recent="${esc(r)}" title="${esc(r)}">${icon("folder", 13)} ${esc(
                  r,
                )}</button></li>`,
            )
            .join("")}</ul>`
        : `<p class="muted small">noch keine Repositories geöffnet</p>`;
    });
  }

  // ------------------------------------------------------------- Aktionen

  private log(line: string) {
    this.logs.push(line);
  }

  async run(label: string, fn: () => Promise<CommandResult>, quiet = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await fn();
      const out = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
      this.log(`$ ${label}\n${out || `(exit ${r.code})`}`);
      this.lastStatus = r.ok ? `${label}: ok` : `!${label}: ${(r.stderr || r.stdout || `exit ${r.code}`).split("\n")[0]}`;
      if (!quiet) toast(r.ok ? `${label}: ok` : this.lastStatus.slice(1), r.ok ? "ok" : "err");
    } catch (e) {
      this.lastStatus = `!${label}: ${String(e)}`;
      toast(this.lastStatus.slice(1), "err");
    } finally {
      this.busy = false;
    }
    await this.refresh(true);
  }

  private async pickRepo() {
    try {
      const path = await api.pickFolder("Repository wählen");
      if (path) return void (await this.openRepo(path));
      return;
    } catch (e) {
      toast("Systemdialog nicht verfügbar – Pfad bitte eintippen", "err");
      this.log(`Ordnerauswahl fehlgeschlagen: ${String(e)}`);
    }
    const typed = await askText("Repository öffnen", "Pfad zum Repository oder Unterordner", this.snap?.root ?? "");
    if (typed) await this.openRepo(typed);
  }

  async openRepo(path: string, fromWelcome = false) {
    try {
      this.snap = await api.openRepo(path);
      this.historyList = [];
      this.selected = null;
      this.selectedFiles = [];
      this.tab = "changes";
      this.overlay = "none";
      this.welcomeError = null;
      await this.refresh(true);
      if (this.statusData.conflicts.length) {
        toast(`${this.statusData.conflicts.length} Konflikt(e) gefunden`, "err");
      }
    } catch (e) {
      const message = String(e).replace(/^Error: /, "");
      if (fromWelcome) {
        this.welcomeError = { message, path };
        this.snap = null;
        this.buildShellOnce();
        this.render();
      } else {
        toast(`Kein Git-Repository: ${message}`, "err");
      }
    }
  }

  /** Repository anlegen, wenn im Ordner noch keines ist. */
  private async initRepo(path: string) {
    try {
      this.snap = await api.initRepo(path);
      this.welcomeError = null;
      this.tab = "changes";
      await this.refresh(true);
      toast(`Repository angelegt: ${this.snap.name}`, "ok");
    } catch (e) {
      toast(`Anlegen fehlgeschlagen: ${String(e)}`, "err");
    }
  }

  private buildShellOnce() {
    if (!this.root.querySelector(".shell")) this.buildShell();
  }

  private async afterResolve() {
    const resolvedPath = this.mergePath;
    await this.refresh(true);
    if (this.statusData.conflicts.some((c) => c.path === resolvedPath)) return;
    const next = this.statusData.conflicts[0];
    if (next) {
      toast(`Nächster Konflikt: ${baseName(next.path)}`, "info");
      await this.openMerge(next.path);
    } else {
      this.closeOverlay();
      toast("Alle Konflikte gelöst – Merge kann abgeschlossen werden", "ok");
    }
  }

  async openMerge(path: string) {
    if (
      this.overlay === "merge" &&
      path !== this.mergePath &&
      this.mergeEditor.hasUnsavedChanges()
    ) {
      const ok = await confirmDialog(
        "Nächsten Konflikt bearbeiten?",
        "Der aktuelle enthält ungespeicherte Änderungen.",
        "Ohne Speichern weiter",
      );
      if (!ok) return;
      this.mergeEditor.discardChanges();
    }
    try {
      const data = await api.conflictData(path);
      this.mergePath = path;
      this.showMerge(data);
    } catch (e) {
      toast(`Datei nicht lesbar: ${String(e)}`, "err");
    }
  }

  private showMerge(data: ConflictData) {
    document.querySelector(".popover")?.remove();
    this.mergeEditor.load(data);
    this.mergeEditor.mount(this.mergeHost);
    this.overlay = "merge";
    this.render();
  }

  async openWorkingDiff(path: string) {
    document.querySelector(".popover")?.remove();
    const diff = await api.fileDiff("HEAD", "WORK", path, "HEAD", "Arbeitskopie");
    this.diffView.set(diff);
    this.diffView.mount(this.diffHost);
    this.overlay = "diff";
    this.render();
  }

  async openCommitDiff(hash: string, path: string) {
    document.querySelector(".popover")?.remove();
    const diff = await api.commitFileDiff(hash, path);
    this.diffView.set(diff);
    this.diffView.mount(this.diffHost);
    this.overlay = "diff";
    this.render();
  }

  private closeOverlay() {
    this.overlay = "none";
    this.render();
  }

  openBranchMenu(anchor: HTMLElement) {
    openBranchMenu(anchor, this.branchesList, {
      onCheckout: (b) => void this.checkoutBranch(b),
      onMerge: (b) => void this.mergeBranch(b),
      onRename: (b) => void this.renameBranch(b),
      onDelete: (b) => void this.deleteBranch(b),
      onNewFrom: (b) => void this.createBranch(b),
      onCompare: async (b) => {
        toast(`Vergleich mit ${b.name} ist noch nicht angebunden`, "info");
      },
      onCreate: () => void this.createBranch(null),
    });
  }

  private async checkoutBranch(b: BranchInfo) {
    if (!b.is_remote && !b.is_current) {
      const ok = await confirmDialog(`Zu „${b.name}“ wechseln?`, b.subject);
      if (!ok) return;
    }
    await this.run(
      `Wechsel zu ${b.name}`,
      () =>
        api.checkout(b.is_remote ? b.name : b.name, {
          track: b.is_remote,
          localName: b.is_remote ? b.checkout_name : undefined,
        }),
    );
  }

  private async mergeBranch(b: BranchInfo) {
    const target = this.snap?.head_branch ?? "?";
    const ok = await confirmDialog(
      `„${b.name}“ in „${target}“ mergen?`,
      this.noFF ? "Erzeugt einen Merge-Commit (--no-ff)." : "Fast-forward, wenn möglich.",
    );
    if (!ok) return;
    await this.runMerge(`Merge ${b.name}`, () => api.mergeBranch(b.name, this.noFF));
  }

  private async renameBranch(b: BranchInfo) {
    const name = await askText(`„${b.name}“ umbenennen in`, "Neuer Name", b.checkout_name);
    if (name) await this.run("Branch umbenennen", () => api.renameBranch(b.name, name));
  }

  private async deleteBranch(b: BranchInfo) {
    const ok = await confirmDialog(
      `Branch „${b.name}“ ${b.is_remote ? "auf dem Remote " : ""}löschen?`,
      b.is_remote ? "Wird per push --delete entfernt." : "Nicht gemergte Commits gehen verloren.",
    );
    if (!ok) return;
    await this.run("Branch löschen", async () => {
      if (b.is_remote) return api.deleteBranch(b.name, false, true);
      const forced = await api.deleteBranch(b.name, true, false);
      return forced;
    });
  }

  private async createBranch(from: BranchInfo | null) {
    const start = from ? from.name : this.snap?.head_branch ?? null;
    const name = await askText(
      "Neuer Branch",
      from ? `Startpunkt: ${from.name}` : `Startpunkt: ${start ?? "HEAD"}`,
      from ? `feature/${from.checkout_name.split("/").pop()}` : "feature/",
    );
    if (name) await this.run("Branch anlegen", () => api.createBranch(name, start, true));
  }

  async runMerge(label: string, fn: () => Promise<MergeOutcome>) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await fn();
      this.log(`$ ${label}\n${r.stdout}${r.stderr ? "\n" + r.stderr : ""}`);
      if (r.ok) {
        this.lastStatus = `${label}: abgeschlossen`;
        toast(`${label}: abgeschlossen`, "ok");
        this.tab = "changes";
      } else if (r.conflicts.length) {
        this.lastStatus = `!${label}: ${r.conflicts.length} Konflikt(e)`;
        toast(`${label}: ${r.conflicts.length} Datei(en) mit Konflikten`, "err");
        this.tab = "changes";
        await this.refresh(true);
        const first = this.statusData.conflicts[0];
        if (first) await this.openMerge(first.path);
        return;
      } else {
        this.lastStatus = `!${label}: ${(r.stderr || r.stdout || "fehlgeschlagen").split("\n")[0]}`;
        toast(this.lastStatus.slice(1), "err");
      }
    } catch (e) {
      toast(String(e), "err");
    } finally {
      this.busy = false;
    }
    await this.refresh(true);
  }

  // ------------------------------------------------- PanelCtx (für panels.ts)

  snapshot() {
    return this.snap;
  }
  status() {
    return this.statusData;
  }
  branches() {
    return this.branchesList;
  }
  history() {
    return this.historyList;
  }
  selectedCommit() {
    return this.selected;
  }
  commitFiles() {
    return this.selectedFiles;
  }
  logLines() {
    return this.logs;
  }
  mergeNoFF() {
    return this.noFF;
  }
  setMergeNoFF(v: boolean) {
    this.noFF = v;
  }
  searchAnchor() {
    return this.branchTrigger ?? null;
  }
  rawCommand(args: string[]) {
    return api.gitRaw(args);
  }
  rawGit(cmd: string) {
    const args = cmd.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/^"|"$/g, "")) ?? [];
    this.logs.push(`$ git ${args.join(" ")}`);
    void this.run("git " + args.join(" "), () => api.gitRaw(args), true).then(() => {
      const r = this.logs[this.logs.length - 1];
      toast(r.split("\n").slice(0, 2).join(" · ") || "ausgeführt", "info");
    });
  }
  selectCommit(hash: string) {
    this.selected = hash;
    void api.commitFiles(hash).then((files) => {
      this.selectedFiles = files;
      this.render();
    });
    this.render();
  }
  stage(paths: string[]) {
    if (!paths.length) return;
    void this.run("Stagen", () => api.stage(paths), true);
  }
  unstage(paths: string[]) {
    if (!paths.length) return;
    void this.run("Unstagen", () => api.unstage(paths), true);
  }
  async discard(paths: string[]) {
    if (!paths.length) return;
    const ok = await confirmDialog(
      paths.length === 1 ? `Änderungen an „${paths[0]}“ verwerfen?` : `${paths.length} Dateien verwerfen?`,
      "Nicht gespeicherte Änderungen gehen verloren.",
      "Verwerfen",
    );
    if (!ok) return;
    void this.run("Verwerfen", () => api.discard(paths), true);
  }
  async resolveSide(path: string, side: "ours" | "theirs") {
    const ok = await confirmDialog(
      `${side === "ours" ? "Lokale" : "Eingehende"} Fassung komplett nehmen?`,
      path,
    );
    if (!ok) return;
    void this.run("Konflikt auflösen", () => api.resolveWithSide(path, side));
  }
  commit(message: string, amend: boolean, sign: boolean, all: boolean) {
    if (!message.trim() && !amend) {
      toast("Bitte eine Commit-Nachricht eingeben", "err");
      return;
    }
    void this.run("Commit", () => api.commit(message, amend, sign, all));
  }
  checkout(b: BranchInfo) {
    void this.checkoutBranch(b);
  }
  merge(b: BranchInfo) {
    void this.mergeBranch(b);
  }
  rename(b: BranchInfo) {
    void this.renameBranch(b);
  }
  remove(b: BranchInfo) {
    void this.deleteBranch(b);
  }
  newFrom(b: BranchInfo | null) {
    void this.createBranch(b);
  }
}

const root = document.getElementById("app");
if (!root) throw new Error("#app fehlt");
const app = new App(root);
void app.boot();
(window as any).mergecraft = app;
