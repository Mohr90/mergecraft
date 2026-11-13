import { t, getLanguage, setLanguage, localizeText, h, m, type Language } from "./i18n";
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
  type TagInfo,
} from "./api";
import { branchSync } from "./sync";
import { canMergeInto } from "./workflow";
import { openProjects } from "./projects";
import { openBranchMenu } from "./branchmenu";
import { DiffView } from "./diff";
import { baseName, dirName, MergeEditor } from "./merge";
import { renderBranches, renderChanges, renderConsole, renderHistory, type PanelCtx, type BranchViewState } from "./panels";
import { cleanupInventory, chooseBranchCleanup } from "./branch-cleanup";
import { chooseRollback } from "./rollback";
import { renderTags, type TagViewState } from "./tags";
import { askText, confirmDialog, modal, esc, icon, toast, relocalizeToasts } from "./ui";

import {workflowPreview} from "./workflow-preview";

import { Updates } from "./updates";

type Tab = "changes" | "branches" | "history" | "console" | "tags";
type Overlay = "none" | "merge" | "diff" | "compare";

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
  mergeError="";
  private updates = new Updates(() => {
    this.root.querySelectorAll("[data-app-info]").forEach(button => { button.outerHTML = this.updates.button(); });
  });
  historyPath: string | null = null;
  historyBranch: string | null = null;
  historyOutgoing = false;
  revertEligible = false;
  revertEligibilityHint = "";
  private lastFocusRefresh = 0;
  private previewSelection: {path:string;area:"staged"|"work"|"untracked"} | null = null;
  private previewRequest = 0;
  private snap: RepoSnapshot | null = null;
  private branchesList: BranchInfo[] = [];
  private tagsList: TagInfo[] = [];
  private tagView: TagViewState = {query:"",scope:"all",sort:"recent",scrollTop:0};
  private statusData: RepoStatus = EMPTY_STATUS;
  private historyList: CommitInfo[] = [];
  private selected: string | null = null;
  private selectedFiles: FileChange[] = [];
  private logs: string[] = [];
  private tab: Tab = "branches";
  private overlay: Overlay = "none";
  private standalone = false;
  private noFF = true;
  private busy = false;
  private lastStatus = "";
  private welcomeError: { message: string; path: string } | null = null;
  private keysBound = false;
  private explicitTheme = false;
  private closePending = false;
  private commitRequest = 0;
  private branchView: BranchViewState = { query: "", scope: "all", sort: "recent", scrollTop: 0 };

  private root: HTMLElement;
  private titlebar!: HTMLElement;
  private rail!: HTMLElement;
  private panelWrap!: HTMLElement;
  private panelHost!: HTMLElement;
  private mergeHost!: HTMLElement;
  private diffHost!: HTMLElement;
  private compareHost!: HTMLElement;
  private comparison: { a: string; b: string; label: string; files: FileChange[]; tag: boolean } | null = null;
  private projectViews = new Map<string,{tab:Tab;branch:BranchViewState;tags:TagViewState;commit:{message:string;amend:boolean};historyPath:string|null}>();
  private projectsRequest=0;
  private commitDraft = { message: "", amend: false };
  private statusbar!: HTMLElement;
  private branchTrigger!: HTMLButtonElement;
  private mergeEditor: MergeEditor;
  private diffView: DiffView;
  private mergePath = "";
  private mergeRequest=0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener("click", event => { if ((event.target as HTMLElement).closest("[data-app-info]")) this.updates.open(); });
    let storedTheme: string | null = null;
    try { storedTheme = localStorage.getItem("mergecraft-theme"); localStorage.removeItem("mergecraft-reduced-transparency"); } catch { /* Preferences can work for this session without storage. */ }
    this.explicitTheme = storedTheme === "light" || storedTheme === "dark";
    const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
    this.setTheme(this.explicitTheme ? storedTheme as "light" | "dark" : systemAppearance.matches ? "dark" : "light");
    systemAppearance.addEventListener("change", event => { if (!this.explicitTheme) this.setTheme(event.matches ? "dark" : "light"); });
    this.root.addEventListener("click", e => {
      this.root.querySelectorAll<HTMLDetailsElement>("details.branch-more[open]").forEach(menu => { if (!menu.contains(e.target as Node)) menu.open = false; });
    });
    this.mergeEditor = new MergeEditor({
      save: async (text, markResolved, expected) => {
        try {
          const r = this.standalone
            ? await api.standaloneSave(text)
            : await api.saveConflict(this.mergePath, text, markResolved,expected);
          return { ok: r.ok, message: r.stdout || r.stderr || t("gespeichert") };
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
      takeSide: async side => {
        if (!(await confirmDialog(t("Vollständige Konfliktseite übernehmen?"), t("Die aktuelle Arbeitsdatei wird durch diese Seite ersetzt oder gelöscht."), t("Übernehmen")))) return;
        if (this.standalone) await this.run(t("Dateiseite übernehmen"), () => api.standaloneSide(side));
        else { await this.run(t("Dateiseite übernehmen"), () => api.resolveWithSide(this.mergePath, side)); await this.afterResolve(); }
      },
      canAbort:()=>!this.standalone&&!!(this.snap?.merging||this.snap?.reverting),
      isRevert:()=>!!this.snap?.reverting,
      onAbort:()=>this.snap?.reverting?this.revertControl(true):this.mergeAbort(),
      onClose: () => void this.requestCloseOverlay(),
      readConflict: path => api.conflictData(path),
      onSwitch: (path) => void this.openMerge(path),
    });
    this.diffView = new DiffView(() => void this.requestCloseOverlay());
  }

  // ----------------------------------------------------------- Lebenszyklus

  async boot() {
    setTimeout(() => void this.updates.start(), 3000);
    window.addEventListener("beforeunload", e => {
      if (this.overlay === "merge" && (this.mergeEditor.hasUnsavedChanges()||this.mergeEditor.isSaving())) { e.preventDefault(); e.returnValue = ""; }
    });
    if (api.inTauri) {
      void import("@tauri-apps/api/window").then(({getCurrentWindow})=>getCurrentWindow().onCloseRequested(async event=>{
        if (this.overlay !== "merge" || (!this.mergeEditor.hasUnsavedChanges()&&!this.mergeEditor.isSaving())) return;
        event.preventDefault();
        if (this.closePending) return;
        this.closePending = true;
        try { if (await this.leaveMerge()) await getCurrentWindow().destroy(); }
        catch(e) { toast(m`Fenster konnte nicht geschlossen werden: ${String(e)}`, "err"); }
        finally { this.closePending = false; }
      })).catch(e=>this.log(m`Fensterschutz: ${String(e)}`));
    }
    this.root.innerHTML = h`<div class="empty" style="padding-top:20vh">Mergecraft startet …</div>`;
    try {
      const standalone = await api.standaloneData();
      if (standalone) {
        this.standalone = true;
        this.buildShell();
        this.showMerge(standalone);
        toast(m`Standalone-Merge: ${standalone.path}`, "info");
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
          toast(m`Zuletzt geöffnet: ${snap.name}`, "info");
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
      const [snap, branches, status, hist, tags] = await Promise.all([
        api.snapshot(),
        // Statusfehler sichtbar melden; keinen leeren, vermeintlich sauberen Status vortäuschen.
        api.branches(),
        api.status(),
        wantHistory ? (this.historyPath ? api.fileHistory(this.historyPath) : this.historyBranch ? api.branchLog(this.historyBranch, this.historyOutgoing) : api.history(300, false)).catch(() => [] as CommitInfo[]) : Promise.resolve(null),
        api.tags(),
      ]);
      if (this.snap?.root !== snap.root) {
        this.mergeEditor.clearDrafts();this.mergeError="";
        this.previewSelection=null; this.historyPath=null; this.historyBranch=null; this.historyOutgoing=false; ++this.previewRequest;
      }
      this.snap = snap;
      this.branchesList = branches;
      this.tagsList = tags;
      this.statusData = status;
      if (hist) {
        const pinned = this.historyList.find(commit => commit.hash === this.selected);
        this.historyList = !this.historyPath && pinned && !hist.some(commit => commit.hash === pinned.hash) ? [pinned, ...hist] : hist;
      }
      this.mergeEditor.siblings = this.statusData.conflicts.map((c) => ({
        path: c.path,
        code: c.conflict_code ?? "",
      }));
      if (this.selected) {
        const hash = this.selected;
        const request = this.commitRequest;
        const files = await api.commitFiles(hash).catch(e => {
          if (this.selected === hash) toast(m`Commit-Dateien nicht lesbar: ${String(e)}`, "err");
          return [] as FileChange[];
        });
        if (request === this.commitRequest && this.selected === hash) this.selectedFiles = files;
      }
    } catch (e) {
      toast(m`Repository nicht lesbar: ${String(e)}`, "err");
    } finally {
      this.busy = false;
    }
    this.render();
  }

  // ------------------------------------------------------------- Aufbau

  private buildShell() {
    this.root.innerHTML = h`
      <div class="shell">
        <div class="titlebar"></div>
        <div class="body">
          <nav class="rail" aria-label="Hauptnavigation"></nav>
          <div class="panel-wrap">
            <div class="panel"></div>
            <div class="merge-host hidden"></div>
            <div class="diff-host hidden"></div>
            <div class="compare-host hidden"></div>
          </div>
        </div>
        <div class="statusbar"></div>
        <div class="toasts" aria-label="Benachrichtigungen"></div>
        <div class="modal-host"></div>
      </div>`;
    this.titlebar = this.root.querySelector(".titlebar") as HTMLElement;
    this.rail = this.root.querySelector(".rail") as HTMLElement;
    this.panelWrap = this.root.querySelector(".panel-wrap") as HTMLElement;
    this.panelHost = this.root.querySelector(".panel") as HTMLElement;
    this.mergeHost = this.root.querySelector(".merge-host") as HTMLElement;
    this.diffHost = this.root.querySelector(".diff-host") as HTMLElement;
    this.compareHost = this.root.querySelector(".compare-host") as HTMLElement;
    this.statusbar = this.root.querySelector(".statusbar") as HTMLElement;

    // Ereignisbehandlung genau einmal binden: die Panels werden bei jedem
    // Zeichnen ersetzt, die Rahmen-Elemente bleiben - sonst sammeln sich
    // Listener und jede Aktion liefe mehrfach.
    this.titlebar.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
      if (!act || this.busy) return;
      switch (act) {
        case "branches":
          if (this.branchTrigger) this.openBranchMenu(this.branchTrigger);
          break;
        case "open":
          void this.pickRepo();
          break;
        case "projects":
          void this.showProjects((e.target as HTMLElement).closest("button")!);
          break;
        case "fetch":
          void this.run("Fetch", () => api.fetchRemote(null));
          break;
        case "pull":
          void this.pull();
          break;
        case "push":
          void this.push();
          break;
        case "refresh":
          void this.refresh(true);
          break;
        case "outgoing": {
          const current = this.branchesList.find(b => b.is_current);
          if (current) void this.showBranchHistory(current, !!current.upstream && current.tracking_known && current.ahead > 0);
          break;
        }
      }
    });

    this.rail.addEventListener("click", (e) => {
      const tab = (e.target as HTMLElement).closest("[data-tab]")?.getAttribute("data-tab") as Tab;
      if (!tab) return;
      void this.switchTab(tab);
    });

    this.rail.addEventListener("click", e => {
      const language = (e.target as HTMLElement).closest<HTMLElement>("[data-language-choice]")?.dataset.languageChoice;
      if (language === "de" || language === "en") this.changeLanguage(language);
    });

    this.rail.addEventListener("click", e => {
      const theme = (e.target as HTMLElement).closest<HTMLElement>("[data-theme-choice]")?.dataset.themeChoice;
      if (theme !== "light" && theme !== "dark") return;
      this.explicitTheme = true;
      this.setTheme(theme);
      try { localStorage.setItem("mergecraft-theme", theme); } catch { /* Session preference still applies. */ }
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
      const refreshOnFocus = () => {
        if (document.hidden || !this.hasRepo || this.standalone || this.busy) return;
        const now = Date.now();
        if (now - this.lastFocusRefresh < 500) return;
        this.lastFocusRefresh = now;
        void this.refresh(true);
      };
      window.addEventListener("focus", refreshOnFocus);
      document.addEventListener("visibilitychange", refreshOnFocus);
    }
  }

  /** Globale Tastenkürzel. */
  private onGlobalKey(e: KeyboardEvent) {
    if (document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const target = e.target as HTMLElement | null;
    const typing =
      !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    if (mod && e.key === "Enter" && typing && target?.classList.contains("commit-msg")) {
      e.preventDefault();
      const box = target.closest(".commit-box") as HTMLElement | null;
      const amend = (box?.querySelector(".commit-mode") as HTMLSelectElement | null)?.value === "amend";
      this.commit((target as HTMLTextAreaElement).value, amend);
      return;
    }
    if (e.key === "F5" || (mod && e.key.toLowerCase() === "r")) {
      e.preventDefault();
      if (this.hasRepo && !this.busy) void this.refresh(true);
      return;
    }
    if (mod && ["1", "2", "3", "4", "5"].includes(e.key)) {
      e.preventDefault();
      const tabs: Tab[] = ["changes", "branches", "history", "console", "tags"];
      void this.switchTab(tabs[Number(e.key) - 1]);
      return;
    }
    if (mod && (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "b")) {
      e.preventDefault();
      if (this.hasRepo && this.branchTrigger) this.openBranchMenu(this.branchTrigger);
      return;
    }
    if (e.key === "Escape") {
      const menus = this.root.querySelectorAll<HTMLDetailsElement>("details.branch-more[open]");
      if (menus.length) { menus.forEach(menu => menu.open = false); e.preventDefault(); return; }
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
    if(this.overlay==="merge"&&this.mergeEditor.isSaving()){toast(t("Speichern läuft noch. Bitte kurz warten."),"info");return ;}
    if (this.tab === tab && this.overlay === "none") return;
    if (this.overlay === "merge" && this.mergeEditor.hasUnsavedChanges()) {
      const ok = await confirmDialog(
        t("Ungespeicherte Änderungen verwerfen?"),
        t("Der Merge-Editor enthält Änderungen, die noch nicht geschrieben wurden."),
        t("Verwerfen"),
      );
      if (!ok) return;
      this.mergeEditor.discardChanges();
    }
    this.captureCommitDraft();
    this.comparison = null;
    this.tab = tab;
    this.overlay = "none";
    this.render();
  }

  /** Überlagerung schließen, mit Rückfrage bei ungesicherten Änderungen. */
  async requestCloseOverlay() {
    if(this.overlay==="merge"&&this.mergeEditor.isSaving()){toast(t("Speichern läuft noch. Bitte kurz warten."),"info");return ;}
    if (this.overlay === "merge" && this.mergeEditor.hasUnsavedChanges()) {
      const ok = await confirmDialog(
        t("Merge-Editor schließen?"),
        t("Die Änderungen wurden noch nicht gespeichert."),
        t("Schließen ohne Speichern"),
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
    this.compareHost.classList.toggle("hidden", this.overlay !== "compare");
    if (this.overlay === "none") this.renderPanel();
    this.syncWindowTitle();
  }

  /** Eigene Kopfzeile, wenn Mergecraft als externes Merge-Tool läuft. */
  private renderStandaloneChrome() {
    this.titlebar.innerHTML = h`
      <span class="brand">${icon("logo", 18)} Mergecraft</span>
      <span class="repo-name" title="${esc(this.mergePath)}">${esc(baseName(this.mergePath))}</span>
      <span class="chip merging">Merge-Tool-Modus</span>
      <span class="right row-actions-gap">
        <span class="muted small">lokal | Ergebnis | eingehend</span>
      </span>`;
    this.rail.innerHTML = `<span class="rail-spacer"></span>${this.preferenceControls()}`;
    this.statusbar.innerHTML = h`
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
      ? `${this.snap.name} – ${this.snap.head_branch ?? "HEAD"}${this.statusData.conflicts.length ? m` (${this.statusData.conflicts.length} Konflikte)` : ""} – Mergecraft`
      : this.standalone
        ? m`${baseName(this.mergePath)} – Mergecraft (Merge-Tool)`
        : "Mergecraft";
    void api.setTitle(title);
  }

  private renderTitlebar() {
    const s = this.snap!;
    const current = this.branchesList.find((b) => b.is_current);
    const ab = current
      ? [
          current.ahead ? h`<span class="up" title="${current.ahead} Commits voraus">↑${current.ahead}</span>` : "",
          current.behind ? h`<span class="down" title="${current.behind} Commits zurück">↓${current.behind}</span>` : "",
        ]
          .filter(Boolean)
          .join("")
      : "";
    const sync=current ? branchSync(current) : null;
    const conflicts = this.statusData.conflicts.length;
    this.titlebar.innerHTML = h`
      <span class="brand">${icon("logo", 18)} Mergecraft</span>
      <div class="workspace-toolbar"><span class="repo-name" title="${esc(s.root)}">${esc(s.name)}</span>
      <span class="sep"></span>
      <button class="branch-trigger" data-act="branches" title="Branches durchsuchen und wechseln">
        ${icon("branch", 14)}
        <span class="name">${esc(s.head_branch ?? "detached HEAD")}</span>
        <span class="ab">${ab}</span>
        ${icon("chevron", 13)}
      </button>
      ${sync ? `<button class="sync-indicator sync-${sync.tone}" type="button" data-act="outgoing" title="${esc(sync.detail)} · ${esc(t("Commits ansehen"))}" aria-label="${esc(sync.label)} · ${esc(t("Commits ansehen"))}" data-sync-state="${sync.tone}">${icon(sync.tone==="ok"?"check":sync.tone==="pending"?"push":"info",14)}<span>${esc(sync.label)}</span></button>` : ""}
      ${s.merging ? h`<span class="chip merging">${icon("merge", 12)} Merge noch nicht committet</span>` : ""}
      ${s.reverting ? h`<span class="chip merging">Revert läuft</span>` : ""}
      ${s.rebasing ? h`<span class="chip merging">Rebase läuft</span>` : ""}
      ${s.cherry_picking ? h`<span class="chip merging">Cherry-pick läuft</span>` : ""}
      ${conflicts ? h`<span class="chip conflict">${conflicts} ${conflicts === 1 ? t("Konflikt") : t("Konflikte")}</span>` : ""}
      <span class="right row-actions-gap">
        <button class="btn ghost" data-act="projects" title="Projekte wechseln" aria-label="Projekte wechseln" aria-haspopup="dialog" aria-expanded="false">${icon("folder", 14)} Öffnen ${icon("chevron",12)}</button>
        <span class="sep"></span>
        <button class="btn ghost" data-act="fetch" title="Remote-Branches aktualisieren (--all --prune)">${icon("fetch", 15)} Fetch</button>
        <button class="btn ghost" data-act="pull" title="Remote-Änderungen in den aktuellen Branch holen">${icon("pull", 15)} Pull</button>
        <button class="btn ghost" data-act="push" title="Aktuellen Branch veröffentlichen">${icon("push", 15)} Push</button>
        <button class="icon-btn" data-act="refresh" aria-label="Aktualisieren" title="Aktualisieren">${icon("refresh", 15)}</button>
      </span></div>`;
    this.branchTrigger = this.titlebar.querySelector(".branch-trigger") as HTMLButtonElement;
  }

  private preferenceControls(): string {
    const deFlag = new URL("./assets/flags/de.svg", import.meta.url).href;
    const enFlag = new URL("./assets/flags/en.svg", import.meta.url).href;
    return h`<div class="sidebar-footer"><div class="theme-switch" role="group" aria-label="Farbschema">
      <button type="button" data-theme-choice="light" aria-pressed="${document.documentElement.dataset.theme === 'light'}">${icon('sun',14)} Hell</button>
      <button type="button" data-theme-choice="dark" aria-pressed="${document.documentElement.dataset.theme === 'dark'}">${icon('moon',14)} Dunkel</button>
    </div><div class="language-switch" role="group" aria-label="Sprache">
      <button type="button" data-language-choice="de" lang="de" aria-label="Deutsch" title="Deutsch" aria-pressed="${getLanguage()==='de'}"><img src="${deFlag}" alt="" width="18" height="12"><span class="language-name">Deutsch</span><span class="language-code" aria-hidden="true">DE</span></button>
      <button type="button" data-language-choice="en" lang="en" aria-label="English" title="English" aria-pressed="${getLanguage()==='en'}"><img src="${enFlag}" alt="" width="18" height="12"><span class="language-name">English</span><span class="language-code" aria-hidden="true">EN</span></button>
    </div>${this.updates.button()}</div>`;
  }

  private changeLanguage(language: Language): void {
    if (language === getLanguage()) { setLanguage(language); return; }
    if (this.mergeEditor.isSaving()) { toast(t("Speichern läuft noch. Bitte kurz warten."), "info"); return; }
    this.captureCommitDraft();
    const controls = [...this.panelHost.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input:not([type="checkbox"]),textarea,select')].map(control=>({value:control.value,start:control instanceof HTMLSelectElement ? null : control.selectionStart,end:control instanceof HTMLSelectElement ? null : control.selectionEnd}));
    const scroll = this.panelHost.scrollTop;
    document.querySelector('.popover')?.remove();
    setLanguage(language);
    this.lastStatus=localizeText(this.lastStatus);
    this.render();
    if (this.overlay === 'merge') this.mergeEditor.relocalize();
    if (this.overlay === 'diff') this.diffView.relocalize();
    if (this.overlay === 'compare') this.renderComparison();
    this.panelHost.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>('input:not([type="checkbox"]),textarea,select').forEach((control,index)=>{
      const previous=controls[index];if(!previous)return;
      control.value=previous.value;
      if (!(control instanceof HTMLSelectElement) && previous.start!==null && previous.end!==null) control.setSelectionRange(previous.start,previous.end);
    });
    this.panelHost.scrollTop=scroll;
    relocalizeToasts();
    this.rail.querySelector<HTMLButtonElement>(`[data-language-choice="${language}"]`)?.focus({preventScroll:true});
  }

  private setTheme(theme: "light" | "dark") {
    document.documentElement.dataset.theme = theme;
    this.root.querySelectorAll<HTMLElement>("[data-theme-choice]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme)));
  }

  private renderRail() {
    const items: { tab: Tab; icon: string; title: string; count?: number }[] = [
      {
        tab: "changes",
        icon: "changes",
        title: t("Änderungen"),
        count: this.statusData.conflicts.length,
      },
      { tab: "branches", icon: "branch", title: "Branches" },
      { tab: "tags", icon: "tag", title: "Tags" },
      { tab: "history", icon: "history", title: t("Historie") },
      { tab: "console", icon: "console", title: t("Konsole") },
    ];
    this.rail.innerHTML = h`
      <div class="sidebar-caption">Repository</div>
      ${items
        .map(
          (i) => `
        <button data-tab="${i.tab}" class="${this.tab === i.tab && this.overlay === "none" ? "active" : ""}" aria-label="${i.title}" aria-current="${this.tab === i.tab && this.overlay === "none" ? "page" : "false"}" title="${i.title}">
          ${icon(i.icon, 18)}<span class="rail-label">${i.title}</span>
          ${i.count ? `<span class="rail-badge">${i.count}</span>` : ""}
        </button>`,
        )
        .join("")}
      <span class="rail-spacer"></span>
      ${this.preferenceControls()}`;
  }

  private renderStatusbar() {
    const s = this.snap!;
    const st = this.statusData;
    this.statusbar.innerHTML = h`
      <button class="link path" data-act="reveal" title="${esc(s.root)}">${esc(s.root)}</button>
      ${this.lastStatus ? `<span class="status-message ${this.lastStatus.startsWith("!") ? "err" : ""}" title="${esc(this.lastStatus.replace(/^!/, ""))}">${esc(this.lastStatus.replace(/^!/, ""))}</span>` : ""}
      <span class="right"></span>
      <span>${st.staged.length} gestaged</span>
      <span>${st.changed.length} geändert</span>
      <span>${st.untracked.length} unversioniert</span>
      <span class="${st.conflicts.length ? "warn" : ""}">${st.conflicts.length} Konflikte</span>
      <span class="dim">${esc(s.head.slice(0, 8))}</span>
      <span class="dim">${esc(s.head_branch ?? "")} · ${esc(st.head_subject.slice(0, 40))}</span>`;
  }

  private renderPanel() {
    const search = this.panelHost.querySelector<HTMLInputElement>('.branch-search input');
    const restoreSearch = !!search && document.activeElement === search;
    const cursor = search?.selectionStart;
    this.captureCommitDraft();
    this.panelHost.innerHTML = "";
    switch (this.tab) {
      case "changes":
        this.panelHost.appendChild(renderChanges(this));
        (this.panelHost.querySelector(".commit-msg") as HTMLTextAreaElement).value = this.commitDraft.message;
        const mode=this.panelHost.querySelector<HTMLSelectElement>(".commit-mode")!;
        mode.value=this.commitDraft.amend ? "amend" : "new";
        mode.dispatchEvent(new Event("change"));
        this.mountPreview();
        break;
      case "branches":
        this.panelHost.appendChild(renderBranches(this, this.branchView));
        (this.panelHost.querySelector(".branch-groups") as HTMLElement).scrollTop = this.branchView.scrollTop;
        if (restoreSearch) {
          const input = this.panelHost.querySelector<HTMLInputElement>('.branch-search input')!;
          input.focus({preventScroll: true});
          if (cursor != null && input.type === "text") input.setSelectionRange(cursor, cursor);
        }
        break;
      case "tags":
        this.panelHost.appendChild(renderTags(this, this.tagView));
        (this.panelHost.querySelector(".tag-list") as HTMLElement).scrollTop = this.tagView.scrollTop;
        break;
      case "history":
        this.panelHost.appendChild(renderHistory(this));
        break;
      case "console":
        this.panelHost.appendChild(renderConsole(this));
        break;
    }
  }

  private captureCommitDraft() {
    const message = this.panelHost?.querySelector(".commit-msg") as HTMLTextAreaElement | null;
    if (!message) return;
    this.commitDraft.message = message.value;
    this.commitDraft.amend = this.panelHost.querySelector<HTMLSelectElement>(".commit-mode")?.value === "amend";
  }

  private async leaveMerge(): Promise<boolean> {
    if(this.overlay==="merge"&&this.mergeEditor.isSaving()){toast(t("Speichern läuft noch. Bitte kurz warten."),"info");return false;}
    if (this.overlay !== "merge" || !this.mergeEditor.hasUnsavedChanges()) return true;
    const ok = await confirmDialog(t("Ungespeicherte Merge-Änderungen verwerfen?"), t("Speichere die aktuelle Fassung, um sie zu behalten."), t("Verwerfen"));
    if (ok) this.mergeEditor.discardChanges();
    return ok;
  }

  private renderWelcome() {
    this.titlebar.innerHTML = h`
      <span class="brand">${icon("logo", 18)} Mergecraft</span>
      <span class="right row-actions-gap"><span class="muted small">kein Repository geöffnet</span></span>`;
    this.rail.innerHTML = `<span class="rail-spacer"></span>${this.preferenceControls()}`;
    this.statusbar.innerHTML = "";
    this.panelHost.classList.remove("hidden");
    const err = this.welcomeError;
    this.panelHost.innerHTML = h`
      <div class="welcome">
        <div class="logo">${icon("logo", 30)}<h1>Mergecraft</h1></div>
        <p class="lead">Git-Client mit 3-Wege-Merge-Editor: <b>lokal</b> | <b>Ergebnis</b> | <b>eingehend</b> –
        Konflikte Bereich für Bereich auflösen, wie im WebStorm-Merge-Dialog.</p>
        ${
          err
            ? h`<div class="banner error" style="max-width:620px;margin:0 auto 18px">
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
        : h`<p class="muted small">noch keine Repositories geöffnet</p>`;
    });
  }

  // ------------------------------------------------------------- Aktionen

  private log(line: string) {
    this.logs.push(line);
  }

  async run(label: string, fn: () => Promise<CommandResult>, quiet = false) {
    if (this.busy) return;
    this.busy = true;
    this.root.querySelector(".shell")?.classList.add("busy");
    this.root.setAttribute("aria-busy", "true");
    try {
      const r = await fn();
      const out = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).trim();
      this.log(`$ ${label}\n${out || `(exit ${r.code})`}`);
      this.lastStatus = r.ok ? `${label}: ok` : `!${label}: ${/nothing to commit|no changes added to commit|nothing added to commit/i.test(out) ? t("Keine Änderungen zum Commit vorgemerkt. Hake zuerst die gewünschten Dateien an.") : (r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 600)}`;
      if (r.ok && label === "Commit") {
        this.commitDraft = { message: "", amend: false };
        const message = this.panelHost.querySelector(".commit-msg") as HTMLTextAreaElement | null;
        if (message) message.value = "";
        const mode=this.panelHost.querySelector<HTMLSelectElement>(".commit-mode");
        if(mode) { mode.value="new"; mode.dispatchEvent(new Event("change")); }
      }
      if (!quiet || !r.ok) toast(r.ok ? label === "Push" ? t("Push abgeschlossen – Commits veröffentlicht") : label === "Commit" ? t("Commit lokal erstellt – noch nicht veröffentlicht") : m`${label} abgeschlossen` : this.lastStatus.slice(1), r.ok ? "ok" : "err");
    } catch (e) {
      this.lastStatus = `!${label}: ${String(e)}`;
      toast(this.lastStatus.slice(1), "err");
    } finally {
      this.busy = false;
      this.root.setAttribute("aria-busy", "false");
    }
    await this.refresh(true);
  }

  private async showProjects(anchor:HTMLElement) {
    const request=++this.projectsRequest;
    const recent=await api.recentRepos().catch(()=>[] as string[]);
    if(request!==this.projectsRequest||!anchor.isConnected||this.busy)return;
    openProjects(anchor,recent,this.snap?.root??null,path=>void this.openRepo(path),()=>void this.pickRepo());
  }

  private async pickRepo() {
    try {
      const path = await api.pickFolder(t("Repository wählen"));
      if (path) return void (await this.openRepo(path));
      return;
    } catch (e) {
      toast(t("Systemdialog nicht verfügbar – Pfad bitte eintippen"), "err");
      this.log(m`Ordnerauswahl fehlgeschlagen: ${String(e)}`);
    }
    const typed = await askText(t("Repository öffnen"), t("Pfad zum Repository oder Unterordner"), this.snap?.root ?? "");
    if (typed) await this.openRepo(typed);
  }

  async openRepo(path: string, fromWelcome = false) {
    if (this.busy || !(await this.leaveMerge())) return;
    this.captureCommitDraft();
    const previous=this.snap?.root;
    if(previous)this.projectViews.set(previous,{tab:this.tab,branch:{...this.branchView},tags:{...this.tagView},commit:{...this.commitDraft},historyPath:this.historyPath});
    this.busy=true;
    try {
      const opened=await api.openRepo(path);
      this.snap=opened;
      const remembered=this.projectViews.get(opened.root);
      this.commitDraft = remembered?.commit??{ message: "", amend: false };
      this.branchView = { query: "", scope: "all", sort: "recent", scrollTop: 0 };
      this.tagView = {query:"",scope:"all",sort:"recent",scrollTop:0};
      this.panelHost?.querySelector(".commit-box")?.remove();
      this.comparison = null;
      this.historyList = [];
      this.selected = null;
      this.selectedFiles = [];
      this.tab = remembered?.tab??"branches";
      this.branchView=remembered?.branch??this.branchView;
      this.tagView=remembered?.tags??this.tagView;
      this.historyPath=remembered?.historyPath??null;
      this.mergeEditor.clearDrafts();
      this.overlay = "none";
      this.welcomeError = null;
      await this.refresh(true);
      if (this.statusData.conflicts.length) {
        toast(m`${this.statusData.conflicts.length} Konflikt(e) gefunden`, "err");
      }
    } catch (e) {
      const message = String(e).replace(/^Error: /, "");
      if (fromWelcome) {
        this.welcomeError = { message, path };
        this.snap = null;
        this.buildShellOnce();
        this.render();
      } else {
        toast(m`Kein Git-Repository: ${message}`, "err");
      }
    }
    finally { this.busy=false; }
  }

  /** Repository anlegen, wenn im Ordner noch keines ist. */
  private async initRepo(path: string) {
    try {
      this.snap = await api.initRepo(path);
      this.welcomeError = null;
      this.tab = "changes";
      await this.refresh(true);
      toast(m`Repository angelegt: ${this.snap.name}`, "ok");
    } catch (e) {
      toast(m`Anlegen fehlgeschlagen: ${String(e)}`, "err");
    }
  }

  private buildShellOnce() {
    if (!this.root.querySelector(".shell")) this.buildShell();
  }

  private async afterResolve() {
    const resolvedPath = this.mergePath;
    const request=this.mergeRequest,root=this.snap?.root;
    await this.refresh(true);
    if(request!==this.mergeRequest||root!==this.snap?.root||this.overlay!=="merge"||this.mergePath!==resolvedPath)return;
    if (this.statusData.conflicts.some((c) => c.path === resolvedPath)) return;
    const next = this.statusData.conflicts[0];
    if (next) {
      toast(m`Nächster Konflikt: ${baseName(next.path)}`, "info");
      await this.openMerge(next.path);
    } else {
      this.closeOverlay();
      toast(this.snap?.merging ? t("Alle Konflikte gelöst – Merge kann abgeschlossen werden") : t("Alle Konflikte gelöst – Ergebnis kann geprüft und committet werden"), "ok");
    }
  }

  async openMerge(path: string) {
    if(this.mergeEditor.isSaving()){toast(t("Speichern läuft noch. Bitte kurz warten."),"info");return;}
    this.mergeEditor.setScope(`${this.snap?.root}:${this.snap?.head}`);
    const request=++this.mergeRequest,root=this.snap?.root;
    if(this.overlay === "merge") this.mergeEditor.stash();
    try {
      const data = await api.conflictData(path);
      if(request!==this.mergeRequest||root!==this.snap?.root)return;
      if(this.mergeEditor.hasStaleDraft(data)) {
        if(!await confirmDialog(t('Datei wurde außerhalb des Editors geändert'),t('Dein Entwurf bleibt erhalten. Neu laden verwirft nur diesen Entwurf und zeigt den aktuellen Dateistand.'),t('Neu laden')))return;
        if(request!==this.mergeRequest||root!==this.snap?.root)return;
        this.mergeEditor.dropDraft(path);
      }
      this.mergePath = path;
      this.showMerge(data);
    } catch (e) {
      toast(m`Datei nicht lesbar: ${String(e)}`, "err");
    }
  }

  private showMerge(data: ConflictData) {
    document.querySelector(".popover")?.remove();
    this.mergeEditor.load(data);
    this.mergeEditor.mount(this.mergeHost);
    this.overlay = "merge";
    this.render();
  }

  favoriteBranches(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem("mergecraft-favorites:"+this.snap?.root) || "[]")); }
    catch { return new Set(); }
  }
  toggleFavorite(name: string) {
    const favorites=this.favoriteBranches();
    if(favorites.has(name)) favorites.delete(name); else favorites.add(name);
    try { localStorage.setItem("mergecraft-favorites:"+this.snap?.root,JSON.stringify([...favorites])); } catch { toast(t("Favoriten konnten nicht gespeichert werden"), "err"); }
    this.renderPanel();
  }

  async showFileHistory(path: string) {
    if (!(await this.leaveMerge())) return;
    const root = this.snap?.root;
    const request = ++this.previewRequest;
    this.historyPath = path || null;
    this.historyBranch = null; this.historyOutgoing = false;
    try {
      const commits = path ? await api.fileHistory(path) : await api.history(300, false);
      if (request !== this.previewRequest || root !== this.snap?.root) return;
      this.historyList = commits; this.selected = null; this.selectedFiles = [];
      this.tab = "history"; this.overlay = "none"; this.render();
    } catch(e) { toast(String(e), "err"); }
  }

  async showBranchHistory(branch: BranchInfo, outgoing = false) {
    if (!(await this.leaveMerge())) return;
    const root = this.snap?.root;
    const request = ++this.previewRequest;
    try {
      const commits = await api.branchLog(branch.name, outgoing);
      if (request !== this.previewRequest || root !== this.snap?.root) return;
      this.historyPath = null; this.historyBranch = branch.name; this.historyOutgoing = outgoing;
      this.historyList = commits; this.selected = null; this.selectedFiles = [];
      this.tab = "history"; this.overlay = "none"; this.render();
    } catch(e) { toast(String(e), "err"); }
  }

  previewFile(path: string, area: "staged"|"work"|"untracked") {
    this.previewSelection = {path,area}; this.mountPreview();
  }

  private async mountPreview() {
    if (this.tab !== "changes") return;
    let host = this.panelHost.querySelector<HTMLElement>(".changes-preview");
    if (!host) {
      host = document.createElement("section"); host.className = "changes-preview";
      this.panelHost.appendChild(host);
    }
    const selection = this.previewSelection;
    const request = ++this.previewRequest;
    this.panelHost.querySelectorAll<HTMLElement>(".row[data-path][data-area]").forEach(row=>{
      const selected=!!selection && row.dataset.path===selection.path && row.dataset.area===selection.area;
      row.classList.toggle("preview-selected",selected);
      row.querySelector(".fpath")?.setAttribute("aria-pressed",String(selected));
    });
    if (!selection) { host.innerHTML = h`<div class="empty"><b>Datei auswählen</b><span>Hier siehst du direkt, was sich geändert hat.</span></div>`; return; }
    const entries = selection.area === "staged" ? this.statusData.staged : selection.area === "work" ? this.statusData.changed : this.statusData.untracked;
    if (!entries.some(e=>e.path===selection.path)) {
      const next = this.statusData.staged.some(e=>e.path===selection.path) ? "staged" : this.statusData.changed.some(e=>e.path===selection.path) ? "work" : this.statusData.untracked.some(e=>e.path===selection.path) ? "untracked" : null;
      this.previewSelection=next ? {path:selection.path,area:next} : null; void this.mountPreview(); return;
    }
    host.innerHTML = h`<div class="empty" role="status">Vergleich wird geladen …</div>`;
    try {
      const hunks = await api.hunkSet(selection.path,selection.area);
      const diff = await api.workingDiff(selection.path,selection.area);
      if(request!==this.previewRequest || !host.isConnected) return;
      host.innerHTML = '';
      const toolbar = document.createElement("div"); toolbar.className="preview-toolbar";
      const label=document.createElement("span"); label.className="preview-caption"; label.textContent=t("Änderungsvorschau"); toolbar.appendChild(label);
      const expand = document.createElement("button"); expand.className="btn"; expand.textContent=t("Vergrößern");
      expand.onclick=()=>void this.openWorkingDiff(selection.path,selection.area); toolbar.appendChild(expand); host.appendChild(toolbar);
      const body=document.createElement("div"); body.className="preview-body"; host.appendChild(body);
      const view=new DiffView(()=>{ this.previewSelection=null; void this.mountPreview(); }); view.set(diff,"unified",true); if(hunks)view.setHunks(hunks,selection.area,async index=>{await this.run(t("Änderungsblock vormerken"),()=>api.applyHunk(selection.path,selection.area,index,hunks.token));}); view.mount(body);
    } catch(e) { if(request===this.previewRequest && host.isConnected) { host.textContent=m`Vergleich nicht verfügbar: ${String(e)}`; } }
  }

  async openWorkingDiff(path: string, area: "staged"|"work"|"untracked" = "work") {
    if (!(await this.leaveMerge())) return;
    this.comparison = null;
    try {
    document.querySelector(".popover")?.remove();
    const hunks = await api.hunkSet(path,area);
    const diff = await api.workingDiff(path, area);
    this.diffView.set(diff,"split",true);
    if(hunks)this.diffView.setHunks(hunks,area,async index=>{await this.run(t(area==='staged'?"Block herausnehmen":"Block vormerken"),()=>api.applyHunk(path,area,index,hunks.token));
      const next=this.statusData.staged.some(f=>f.path===path)?'staged':this.statusData.changed.some(f=>f.path===path)?'work':null;
      if(next)await this.openWorkingDiff(path,next);else {this.overlay='none';this.render();}});
    this.diffView.mount(this.diffHost);
    this.overlay = "diff";
    this.render();
    } catch (e) { toast(m`Diff nicht lesbar: ${String(e)}`, "err"); }
  }

  async openCommitDiff(hash: string, path: string) {
    if (!(await this.leaveMerge())) return;
    this.comparison = null;
    try {
    document.querySelector(".popover")?.remove();
    const diff = await api.commitFileDiff(hash, path);
    this.diffView.set(diff);
    this.diffView.mount(this.diffHost);
    this.overlay = "diff";
    this.render();
    } catch (e) { toast(m`Diff nicht lesbar: ${String(e)}`, "err"); }
  }

  private closeOverlay() {
    if (this.overlay === "diff" && this.comparison) { this.overlay = "compare"; this.render(); return; }
    this.comparison = null;
    this.overlay = "none";
    this.render();
  }

  openBranchMenu(anchor: HTMLElement) {
    openBranchMenu(anchor, this.branchesList, {
      allowMerge: canMergeInto(this.snap?.head_branch),
      onCheckout: (b) => void this.checkoutBranch(b),
      onMerge: (b) => void this.mergeBranch(b),
      onDelete: (b) => void this.deleteBranch(b),
      onNewFrom: (b) => void this.createBranch(b),
      onCompare: (b) => void this.compare(b),
      onCreate: () => void this.createBranch(null),
    });
  }

  private async checkoutBranch(b: BranchInfo) {
    if (this.busy || b.is_current || !(await this.leaveMerge())) return;
    if (this.gitOperationRunning()) return;
    const root=this.snap?.root;
    const local=b.is_remote ? this.branchesList.find(branch=>!branch.is_remote && branch.name===b.checkout_name) : null;
    let update=false;
    if (local) {
      const same=local.short_hash===b.short_hash;
      const action=await modal(t("Lokaler Branch bereits vorhanden"), m`„${local.name}“ (${local.short_hash}) existiert bereits. „${b.name}“ steht auf ${b.short_hash}. ${same ? t("Beide zeigen auf denselben Commit.") : t("Du kannst den lokalen Stand öffnen oder ihn ohne Verlust lokaler Commits auf den Remote-Stand vorziehen (Fast-forward). Eigene Commits und offene Dateiänderungen werden dabei geschützt.")}`, [
        {label:t("Abbrechen"),value:"cancel"},
        ...(!same ? [{label:t("Mit Remote aktualisieren"),value:"update"}] : []),
        {label:t("Lokalen Branch öffnen"),value:"open",primary:true},
      ]);
      if (!action || action==="cancel" || root!==this.snap?.root) return;
      update=action==="update";
    }
    const head = this.snap?.head;
    let discard: string[] | null = null;
    try {
      const status = await api.status();
      if (root !== this.snap?.root || head !== this.snap?.head) return;
      const files = status.all.filter(file => file.state !== "untracked" && file.state !== "conflicted");
      if (files.length) {
        const action = await modal(t("Lokale Änderungen beim Branchwechsel"), m`${files.length} Dateien haben lokale Änderungen. Wähle, wie du zu ${b.checkout_name} wechseln möchtest.`, [
          {label:t("Abbrechen"),value:"cancel"},
          {label:t("Änderungen verwerfen …"),value:"discard"},
          {label:t("Änderungen mitnehmen"),value:"keep",primary:true},
        ]);
        if (!action || action === "cancel") return;
        if (action === "discard") {
          discard = await chooseRollback(files);
          if (!discard?.length) return;
        }
      }
    } catch (error) { toast(String(error), "err"); return; }
    if (root !== this.snap?.root || head !== this.snap?.head || this.busy) return;
    toast(`${update ? t("Aktualisiere") : t("Wechsle zu")} ${b.name} …`, "info");
    await this.run(
      update ? m`Aktualisiere ${b.checkout_name} aus ${b.name}` : m`Wechsel zu ${local?.name ?? b.name}`,
      async () => {
        if (discard) {
          const rollback = await api.rollback(discard, head!);
          if (!rollback.ok) return rollback;
        }
        return api.checkout(local && !update ? local.name : b.name, {
        track: b.is_remote && !local,
        localName: b.is_remote ? b.checkout_name : undefined,
        updateFromRemote:update,
        expectedLocal:local?.short_hash,
        expectedRemote:b.short_hash,
      });
      },
      !update,
    );
    if (this.snap?.head_branch === (b.is_remote ? b.checkout_name : b.name)) {
      this.overlay = "none"; this.comparison = null; this.tab = "branches"; this.render();
    }
  }

  private async mergeBranch(b: BranchInfo) {
    if(!canMergeInto(this.snap?.head_branch)) { toast(t("Für diesen Branch verwendest du Merge Requests in GitLab."),"info"); return; }
    if (this.busy || b.is_current || !(await this.leaveMerge()) || this.gitOperationRunning()) return;
    const root=this.snap?.root;
    const preview=await workflowPreview('merge',b.name,this.noFF);
    if(!preview||root!==this.snap?.root)return;
    await this.runMerge(`Merge ${b.name}`, () => api.mergeChecked(preview,this.noFF));
  }

  async cleanupBranches() {
    if (this.busy || this.gitOperationRunning() || !(await this.leaveMerge())) return;
    const root = this.snap?.root, head = this.snap?.head;
    if (!root || !head) return;
    await this.run(t("Lokale Branches aufräumen"), async () => {
      const rows = await cleanupInventory(head);
      const selected = await chooseBranchCleanup(rows);
      const cancelled = {ok:true, code:0, stdout:"", stderr:""};
      if (!selected?.length) return cancelled;
      const own = selected.filter(row => row.ownCommits);
      const detail = selected.map(row => row.branch.name + (row.ownCommits ? " · " + t("Eigene Commits") : "")).join("\n")
        + (own.length ? "\n\n" + t("Die markierten Branches enthalten eigene Commits. Beim Löschen können diese Commits unerreichbar werden.") : "");
      if (!await confirmDialog(m`${selected.length} lokale Branches löschen?`, detail, t("Ausgewählte Branches löschen"))) return cancelled;
      const deleted:string[] = [], failures:string[] = [];
      for (const row of selected) {
        const snapshot = await api.snapshot();
        if (snapshot.root !== root || snapshot.head !== head) {
          failures.push(t("Repository oder aktueller Commit wurde geändert. Aufräumen gestoppt."));
          break;
        }
        try {
          const result = await api.deleteBranch(row.branch.name, row.ownCommits, false, row.branch.short_hash, head);
          if (result.ok) deleted.push(row.branch.name);
          else failures.push(row.branch.name + ": " + (result.stderr || result.stdout));
        } catch (error) { failures.push(row.branch.name + ": " + String(error)); }
      }
      const summary = m`${deleted.length} lokale Branches gelöscht`;
      if (!failures.length) toast(summary);
      return {ok:!failures.length, code:failures.length ? 1 : 0, stdout:summary, stderr:failures.length ? summary + "\n" + failures.join("\n") : ""};
    }, true);
  }

  private async deleteBranch(b: BranchInfo) {
    if (this.busy || b.is_current || this.gitOperationRunning()) return;
    const root = this.snap?.root;
    try {
      let force = false;
      if (!b.is_remote) {
        const ancestry = await api.gitRaw(["merge-base", "--is-ancestor", b.full_name, "HEAD"]);
        if (!ancestry.ok && ancestry.code !== 1) throw new Error(ancestry.stderr || ancestry.stdout);
        force = ancestry.code === 1;
      }
      const worktree=b.is_remote?null:await api.worktreeBranchPreview(b.full_name);
      if(worktree) {
        if(worktree.blocked){await modal(t("Branch ist in einem Worktree geöffnet"),b.name+"\n"+worktree.path+"\n\n"+localizeText(worktree.blocked),[{label:t("Schließen"),value:false}]);return;}
        const explanation=t("Entfernt das Worktree-Verzeichnis und danach den lokalen Branch. Der Remote-Branch bleibt erhalten.");
        const own=force?t("Dieser Branch enthält Commits, die nicht im aktuellen Branch enthalten sind. Beim Löschen können diese Commits unerreichbar werden. Vergleiche die Branches, wenn du sie noch benötigst."):"";
        if(!await modal(t("Worktree und Branch entfernen?"),b.name+"\n"+worktree.path+"\n\n"+explanation+(own?"\n\n"+own:""),[{label:t("Abbrechen"),value:false},{label:t("Worktree und Branch entfernen"),value:true,danger:true}]))return;
        if(root!==this.snap?.root||this.busy)return;
        await this.run(t("Worktree und Branch entfernen"),()=>api.removeWorktreeBranch(worktree,force));return;
      }
      const title = b.is_remote ? m`Remote-Branch „${b.name}“ löschen?` : m`Lokalen Branch „${b.name}“ löschen?`;
      const detail = b.is_remote ? t("Entfernt den Branch auf dem Remote per push --delete.")
        : force ? t("Dieser Branch enthält Commits, die nicht im aktuellen Branch enthalten sind. Beim Löschen können diese Commits unerreichbar werden. Vergleiche die Branches, wenn du sie noch benötigst.")
        : t("Entfernt den lokalen Branch. Der Remote-Branch bleibt verfügbar.");
      if (!await confirmDialog(title, detail, t(force ? "Branch samt eigenen Commits löschen" : "Löschen"))) return;
      if (root !== this.snap?.root || this.busy) return;
      await this.run(t("Branch löschen"), () => api.deleteBranch(b.name, force, b.is_remote, b.short_hash));
    } catch (error) { toast(String(error), "err"); }
  }

  private async createBranch(from: Pick<BranchInfo,"name" | "checkout_name"> | null) {
    if (this.busy || this.gitOperationRunning() || !(await this.leaveMerge())) return;
    const start = from ? from.name : this.snap?.head_branch ?? null;
    const name = await askText(
      t("Neuer Branch"),
      from ? m`Startpunkt: ${from.name.replace(/^refs\/tags\//, "Tag ")}` : m`Startpunkt: ${start ?? "HEAD"}`,
      from ? `feature/${from.checkout_name.split("/").pop()}` : "feature/",
    );
    if (name) {
      await this.run(t("Branch anlegen"), () => api.createBranch(name, start, true));
      if (this.snap?.head_branch === name) { this.overlay = "none"; this.comparison = null; this.tab = "branches"; this.render(); }
    }
  }

  private gitOperationRunning(): boolean {
    if (!this.snap?.merging && !this.snap?.rebasing && !this.snap?.cherry_picking && !this.snap?.reverting) return false;
    toast(t("Ein Git-Vorgang läuft. Schließe ihn zuerst unter Änderungen ab."), "err");
    return true;
  }

  async compare(b: Pick<BranchInfo,"name" | "full_name">) {
    if (this.busy || !(await this.leaveMerge())) return;
    try {
      const a = this.snap?.head;
      if (!a) { toast(t("Für einen Vergleich ist zuerst ein Commit nötig."), "info"); return; }
      const resolved = await api.gitRaw(["rev-parse", "--verify", `${b.full_name}^{commit}`]);
      if (!resolved.ok) throw new Error(resolved.stderr);
      const revision = resolved.stdout.trim();
      const files = await api.compareFiles(a, revision);
      this.comparison = { a, b: revision, label: b.name, files, tag:b.full_name.startsWith("refs/tags/") };
      this.renderComparison();
      this.overlay = "compare"; this.render();
    } catch(e) { toast(m`Vergleich fehlgeschlagen: ${String(e)}`, "err"); }
  }

  private renderComparison(): void {
    const c=this.comparison;if(!c)return;
    const files=c.files;
      this.compareHost.innerHTML = h`<div class="panel-pad"><header class="page-heading"><div><h1>${c.tag ? t("Tag-Vergleich") : t("Branch-Vergleich")}</h1>
        <p class="muted"><strong>${esc(this.snap?.head_branch ?? "HEAD")}</strong> → <strong>${esc(c.label)}</strong> · ${files.length} geänderte Dateien</p></div>
        <button class="btn" data-compare-close>Zurück zur Übersicht</button></header>
        <p class="muted">Vergleicht die gespeicherten Commits. Deine Arbeitskopie wird nicht verändert.</p>
        ${files.length ? `<div class="rows">${files.map((f,i)=>h`<button class="compare-file" data-compare-file="${i}"><span class="chip mono">${esc(f.status)}</span><span class="mono">${esc(f.path)}</span><span class="right">Diff öffnen →</span></button>`).join("")}</div>` : h`<div class="empty"><b>Keine Unterschiede</b><span>Beide Branches enthalten dieselben Dateien.</span></div>`}</div>`;
      this.compareHost.querySelector('[data-compare-close]')?.addEventListener("click",()=>this.closeOverlay());
      this.compareHost.querySelectorAll('[data-compare-file]').forEach(button=>button.addEventListener("click",()=>{
        const c = this.comparison; if (!c) return;
        const file = c.files[Number((button as HTMLElement).dataset.compareFile)];
        void api.versionsDiff(c.a, c.b, file.path, this.snap?.head_branch ?? "HEAD", c.label).then(diff=>{
          this.diffView.set(diff); this.diffView.mount(this.diffHost); this.overlay = "diff"; this.render();
        }).catch(e=>toast(m`Diff nicht lesbar: ${String(e)}`, "err"));
      }));
  }

  tags() { return this.tagsList; }

  compareTag(tag: TagInfo) {
    if (tag.commit) void this.compare(tag);
  }

  newFromTag(tag: TagInfo) {
    if (tag.commit) void this.createBranch({name:tag.full_name, checkout_name:tag.name});
  }

  async showTagCommit(tag: TagInfo) {
    if (this.busy || !tag.commit || !(await this.leaveMerge())) return;
    this.historyPath=null;
    const root = this.snap?.root;
    const request = ++this.commitRequest;
    try {
      const info = await api.commitInfo(tag.commit);
      if (request !== this.commitRequest || root !== this.snap?.root) return;
      this.historyList = [info, ...this.historyList.filter(commit=>commit.hash!==info.hash)];
      this.tab = "history"; this.overlay = "none"; this.comparison = null;
      this.selectCommit(info.hash);
    } catch(e) {
      if (request === this.commitRequest) toast(m`Tag-Commit nicht lesbar: ${String(e)}`, "err");
    }
  }

  async pull() {
    if (this.busy || this.standalone || !this.hasRepo) return;
    if (this.snap?.merging || this.snap?.rebasing || this.snap?.cherry_picking || this.snap?.reverting) {
      toast(t("Schließe zuerst den laufenden Git-Vorgang ab."), "err"); return;
    }
    const current=this.branchesList.find(b=>b.is_current);
    if (!current) { toast(t("Wechsle zuerst auf einen lokalen Branch."), "err"); return; }
    const root=this.snap?.root;
    let trackSameName=false;
    if (!current.upstream) {
      const candidates=this.branchesList.filter(b=>b.is_remote && b.checkout_name===current.name);
      if (candidates.length!==1) {
        toast(candidates.length ? t("Mehrere gleichnamige Remote-Branches gefunden. Bitte zuerst einen Upstream zuordnen.") : t("Kein passender Remote-Branch bekannt. Aktualisiere mit Fetch. Falls der Branch nur lokal existiert, kannst du ihn mit Push veröffentlichen."), "info"); return;
      }
      trackSameName=await confirmDialog(t("Remote-Branch zuordnen?"), m`„${current.name}“ hat noch keinen Upstream. Soll „${candidates[0].name}“ dauerhaft für Pull und Push zugeordnet und anschließend Pull ausgeführt werden?`, t("Zuordnen und pullen"));
      if (!trackSameName || root!==this.snap?.root || current.name!==this.snap?.head_branch) return;
    }
    await this.run("Pull", ()=>api.pull(current.name,trackSameName));
  }

  async push() {
    if (this.busy || this.standalone || !this.hasRepo) return;
    if (this.snap?.reverting) {toast(t("Schließe zuerst den Revert unter Änderungen ab."),"err");return;}
    if (this.snap?.merging) {
      if (!(await this.leaveMerge())) return;
      this.overlay = "none";
      this.tab = "changes";
      this.render();
      toast(t("Noch nicht gepusht: Schließe zuerst den Merge unter Änderungen ab. Dabei entsteht der Merge-Commit."), "err");
      return;
    }
    await this.run("Push", () => api.push(!this.branchesList.find(b => b.is_current)?.upstream));
  }

  async revertCommit(commit:CommitInfo) {
    if(this.busy||this.gitOperationRunning()||!await this.leaveMerge())return;
    const root=this.snap?.root;
    const preview=await workflowPreview('revert',commit.hash);
    if(!preview||root!==this.snap?.root)return;
    await this.runMerge(t('Commit zurücknehmen'),()=>api.revertChecked(preview.commit.hash,preview.token));
  }

  async revertControl(abort:boolean) {
    if(this.busy||this.mergeEditor.isSaving()||!this.snap?.reverting)return;
    const root=this.snap.root;
    try {
      const expected=await api.workflowToken();
      if(abort&&!await confirmDialog(t('Revert abbrechen?'),t('Verwirft die Auflösungen des laufenden Reverts und stellt den Stand vor dem Revert wieder her.'),t('Revert abbrechen')))return;
      if(root!==this.snap?.root)return;
      this.mergeError='';
      await this.run(t(abort?'Revert abbrechen':'Revert abschließen'),async()=>{
        const result=await api.revertControl(abort,expected);
        if(result.ok){this.mergeEditor.clearDrafts();this.mergeEditor.discardChanges();this.overlay='none';this.tab='changes';}
        else this.mergeError=result.stderr||result.stdout;
        return result;
      });
    }catch(error){this.mergeError=String(error);toast(String(error),'err');this.render();}
  }

  async mergeAbort() {
    if (this.busy || this.mergeEditor.isSaving() || this.standalone || !this.snap?.merging) return;
    const root=this.snap.root,head=this.snap.head;
    const ok = await confirmDialog(t("Gesamten Merge abbrechen?"), t("Verwirft die Konfliktentscheidungen dieses laufenden Merges, auch bereits gespeicherte Auflösungen. Git versucht, den Stand vor dem Merge wiederherzustellen. Bereits vorher vorhandene lokale Änderungen können das verhindern."), t("Merge abbrechen"));
    if(!ok||root!==this.snap?.root||head!==this.snap?.head||!this.snap.merging)return;
    let aborted=false;
    await this.run(t("Merge abbrechen"),async()=>{const result=await api.mergeAbort();aborted=result.ok;return result;});
    if(aborted&&root===this.snap?.root&&!this.snap.merging){this.mergeEditor.clearDrafts();this.mergeEditor.discardChanges();this.overlay="none";this.tab="changes";this.render();}
  }

  mergeContinue() {
    if (this.statusData.conflicts.length) { toast(t("Löse zuerst alle Konfliktdateien."), "err"); return; }
    this.mergeError="";
    void this.run(t("Merge abschließen"), async () => {
      try {const result=await api.mergeContinue();if(result.ok)this.mergeEditor.clearDrafts();else this.mergeError=result.stderr||result.stdout;return result;}
      catch(error){this.mergeError=String(error);throw error;}
    });
  }

  async runMerge(label: string, fn: () => Promise<MergeOutcome>) {
    if (this.busy) return;
    this.mergeError="";
    this.busy = true;
    this.root.querySelector(".shell")?.classList.add("busy");
    this.root.setAttribute("aria-busy", "true");
    try {
      const r = await fn();
      this.log(`$ ${label}\n${r.stdout}${r.stderr ? "\n" + r.stderr : ""}`);
      if (r.ok) {
        this.lastStatus = m`${label}: abgeschlossen`;
        toast(m`${label}: abgeschlossen`, "ok");
        this.tab = "changes";
      } else if (r.conflicts.length) {
        this.lastStatus = m`!${label}: ${r.conflicts.length} Konflikt(e)`;
        toast(m`${label}: ${r.conflicts.length} Datei(en) mit Konflikten`, "err");
        this.tab = "changes";
        await this.refresh(true);
        const first = this.statusData.conflicts[0];
        if (first) await this.openMerge(first.path);
        return;
      } else {
        this.mergeError = r.stderr || r.stdout;
        this.tab="changes";this.overlay="none";
        this.lastStatus = `!${label}: ${(r.stderr || r.stdout || "fehlgeschlagen").split("\n")[0]}`;
        toast(this.lastStatus.slice(1), "err");
      }
    } catch (e) {
      this.mergeError=String(e);
      toast(String(e), "err");
    } finally {
      this.busy = false;
      this.root.setAttribute("aria-busy", "false");
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
      toast(r.split("\n").slice(0, 2).join(" · ") || t("ausgeführt"), "info");
    });
  }
  selectCommit(hash: string) {
    const request = ++this.commitRequest;
    const root = this.snap?.root;
    this.selected = hash;
    this.revertEligible=false;
    this.revertEligibilityHint=t("Erreichbarkeit wird geprüft …");
    const head=this.snap?.head;
    if(head)void api.gitRaw(["merge-base","--is-ancestor",hash,head]).then(result=>{
      if(request!==this.commitRequest||root!==this.snap?.root||head!==this.snap?.head)return;
      this.revertEligible=result.ok;
      this.revertEligibilityHint=result.ok?"":t("Der Commit gehört nicht zum aktuellen Branch.");
      this.render();
    }).catch(()=>{if(request===this.commitRequest){this.revertEligibilityHint=t("Bitte aktualisieren und erneut prüfen.");this.render();}});
    this.selectedFiles = [];
    this.render();
    void api.commitFiles(hash).then(files => {
      if (request !== this.commitRequest || root !== this.snap?.root) return;
      this.selectedFiles = files;
      this.render();
    }).catch(e => {
      if (request !== this.commitRequest || root !== this.snap?.root) return;
      this.selectedFiles = [];
      toast(m`Commit-Dateien nicht lesbar: ${String(e)}`, "err");
      this.render();
    });
  }
  stage(paths: string[]) {
    if (!paths.length) return;
    void this.run(t("Stagen"), () => api.stage(paths), true);
  }
  unstage(paths: string[]) {
    if (!paths.length) return;
    void this.run(t("Unstagen"), () => api.unstage(paths), true);
  }

  async rollback(paths?: string[]) {
    if (this.busy || !(await this.leaveMerge()) || this.gitOperationRunning()) return;
    const root = this.snap?.root;
    const head = this.snap?.head;
    if (!root || !head) { toast(t("Für einen Rollback ist zuerst ein Commit nötig."), "err"); return; }
    try {
      const status = await api.status();
      if (status.conflicts.length) { toast(t("Löse zuerst alle Konflikte."), "err"); return; }
      const files = status.all.filter(file=>file.state !== "untracked" && file.state !== "conflicted");
      if (!files.length) { toast(t("Keine versionierten Änderungen für einen Rollback."), "info"); return; }
      let selected: string[] | null;
      if (paths?.length === 1) {
        const file = files.find(file=>file.path===paths[0]);
        if (!file) { toast(t("Die Datei ist nicht mehr geändert. Bitte aktualisieren."), "info"); return; }
        const detail = file.index === "A" ? t("Diese neu gestagte Datei ist im letzten Commit nicht vorhanden und wird entfernt.") : t("Setzt diese Datei auf den letzten Commit zurück, einschließlich Staging. Die lokalen Änderungen dieser Datei werden verworfen.");
        const ok = await confirmDialog(m`„${paths[0]}“ zurücksetzen?`, detail, t("Zurücksetzen"));
        selected = ok ? paths : null;
      } else selected = await chooseRollback(files, paths);
      if (!selected || root !== this.snap?.root) return;
      await this.run("Rollback",()=>api.rollback(selected,head));
    } catch(e) { toast(m`Rollback nicht möglich: ${String(e)}`, "err"); }
  }

  async discard(paths: string[]) {
    if (!paths.length) return;
    const ok = await confirmDialog(
      paths.length === 1 ? m`Änderungen an „${paths[0]}“ verwerfen?` : m`${paths.length} Dateien verwerfen?`,
      t("Nicht gespeicherte Änderungen gehen verloren."),
      t("Verwerfen"),
    );
    if (!ok) return;
    void this.run(t("Verwerfen"), () => api.discard(paths), true);
  }
  async resolveSide(path: string, side: "ours" | "theirs") {
    const ok = await confirmDialog(
      m`${side === "ours" ? t("Lokale") : t("Eingehende")} Fassung komplett nehmen?`,
      path,
    );
    if (!ok) return;
    void this.run(t("Konflikt auflösen"), () => api.resolveWithSide(path, side));
  }
  commit(message: string, amend: boolean) {
    if (this.snap?.merging || this.statusData.conflicts.length || this.snap?.rebasing || this.snap?.cherry_picking || this.snap?.reverting) {
      toast(t("Schließe zuerst den laufenden Git-Vorgang ab oder löse die Konflikte."), "err"); return;
    }
    if (!amend && !this.statusData.staged.length) {
      toast(this.statusData.all.length ? t("Keine Dateien vorgemerkt. Hake zuerst die Änderungen an, die du committen möchtest.") : t("Keine Änderungen vorhanden – es gibt nichts Neues zu committen."), "info"); return;
    }
    if (!message.trim() && !amend) {
      toast(t("Bitte eine Commit-Nachricht eingeben"), "err");
      return;
    }
    void this.run("Commit", () => api.commit(message, amend, false, false));
  }
  checkout(b: BranchInfo) {
    void this.checkoutBranch(b);
  }
  merge(b: BranchInfo) {
    void this.mergeBranch(b);
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
void app.boot().then(() => api.startSelftest()).catch(error => console.error(error));
(window as any).mergecraft = app;
