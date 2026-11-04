import { t, h, m, localizeText } from "./i18n";
// 3-Wege-Merge-Editor im Stil des WebStorm-Merge-Dialogs:
// lokal | Ergebnis | eingehend, Konflikt für Konflikt entscheidbar.

import type { ConflictData, Highlights, Region, WordSpan } from "./api";
import { analyzeConflict, type Proposal } from "./auto";
export { simpleConflictResolution } from "./auto";
import { confirmDialog, el, esc, icon } from "./ui";

export interface MergeHost {
  save: (text: string, markResolved: boolean, expected:ConflictData) => Promise<{ ok: boolean; message: string }>;
  onSaved: (message: string, resolved: boolean) => void;
  onError: (message: string) => void;
  onClose: () => void;
  canAbort?: () => boolean;
  onAbort?: () => Promise<void>;
  takeSide?: (side: "ours" | "theirs") => Promise<void>;
  onSwitch?: (path: string) => void;
}

type Choice = "ours" | "theirs" | "both" | "base" | "custom" | "auto";
interface Resolution {
  choice: Choice;
  text?: string[];
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  return lines;
}

const kindHints = (): Record<string, string> => ({
  unchanged: "",
  ours_only: t("nur lokal geändert"),
  theirs_only: t("nur eingehend geändert"),
  both_same: t("auf beiden Seiten gleich"),
  conflict: t("Konflikt"),
});

function labelFor(choice: Choice): string {
  switch (choice) {
    case "ours":
      return t("lokal");
    case "theirs":
      return t("eingehend");
    case "both":
      return t("beide");
    case "base":
      return t("Basis");
    case "auto":
      return "Auto Resolve";
    default:
      return t("eigene Fassung");
  }
}

interface EditorSnapshot {res:Map<number,Resolution>;raw:boolean;text:string;current:number;}
export class MergeEditor {
  /** weitere Konfliktdateien für den Umschalter im Kopf */
  siblings: { path: string; code: string }[] = [];

  private data!: ConflictData;
  private host!: MergeHost;
  private oursLines: string[] = [];
  private theirsLines: string[] = [];
  private baseLines: string[] = [];
  private res = new Map<number, Resolution>();
  private nodes = new Map<number, HTMLElement>();
  private current = -1;
  private root: HTMLElement | null = null;
  private rawMode = false;
  private rawEl: HTMLTextAreaElement | null = null;
  private jumpOpen = false;
  private touched = false;
  private saving = false;
  private past:{state:EditorSnapshot;label:string}[]=[];
  private future:{state:EditorSnapshot;label:string}[]=[];
  private initial!:EditorSnapshot;
  private savedText="";
  private rawBefore="";
  private typingKey="";
  private typingTime=0;
  private proposals=new Map<number,Proposal|null>();
  private worker:Worker|null=null;
  private resultWidth=42;
  private knownFiles=new Set<string>();
  private inlineError="";
  private fileState = new Map<string,number|"resolved">();
  private scope="";
  setScope(scope:string) { if(scope!==this.scope){this.clearDrafts();this.scope=scope;} }
  private fingerprint(data:ConflictData):string {return JSON.stringify([data.root,data.path,data.base,data.ours,data.theirs,data.merged.text,data.merged.exists,data.ours_label,data.theirs_label]);}
  hasStaleDraft(data:ConflictData):boolean {const draft=this.drafts.get(data.path);return !!draft?.dirty && draft.fingerprint!==this.fingerprint(data);}
  dropDraft(path:string) {this.drafts.delete(path);}
  forget(path:string) {this.drafts.delete(path);this.fileState.set(path,"resolved");}
  private error(message:string) {this.inlineError=message;const node=this.root?.querySelector<HTMLElement>('.merge-inline-error');if(node){node.textContent=message;node.hidden=false;}this.host.onError(message);}
  private analyze() {
    this.worker?.terminate();this.worker=null;this.proposals.clear();
    if(this.data.guarded)return;
    for(const index of this.conflictIndices()) {
      const r=this.data.regions[index];const base=this.baseLines.slice(r.base[0],r.base[0]+r.base[1]),ours=this.regionSide(r,'ours'),theirs=this.regionSide(r,'theirs');
      if([...base,...ours,...theirs].join('').length>5000) {
        this.worker??=new Worker(new URL('./merge-worker.ts',import.meta.url),{type:'module'});
        this.worker.onerror=()=>{this.worker?.terminate();this.worker=null;};
        this.worker.onmessage=event=>{const {index,proposal}=event.data;this.proposals.set(index,proposal);if(!this.res.has(index)&&!this.nodes.get(index)?.contains(document.activeElement))this.updateRegion(index);this.updateHeader();};
        this.worker.postMessage({index,base,ours,theirs});
      } else this.proposals.set(index,analyzeConflict(base,ours,theirs));
    }
  }
  private drafts = new Map<string, {fingerprint:string;state:EditorSnapshot;past:{state:EditorSnapshot;label:string}[];future:{state:EditorSnapshot;label:string}[];initial:EditorSnapshot;saved:string;scroll:number;dirty:boolean}>();
  clearDrafts() { this.drafts.clear();this.knownFiles.clear();this.fileState.clear();this.worker?.terminate();this.worker=null; }
  stash() {
    if (!this.data || !this.root || this.fileState.get(this.data.path)==="resolved") return;
    this.fileState.set(this.data.path,this.openRegions().length);
    this.drafts.set(this.data.path,{fingerprint:this.fingerprint(this.data),state:this.snapshot(),past:[...this.past],future:[...this.future],initial:this.initial,saved:this.savedText,dirty:this.touched,scroll:this.root.querySelector('.panes')?.scrollTop??0});
  }

  constructor(host: MergeHost) {
    this.host = host;
  }

  // ------------------------------------------------------------ Zustand

  load(data: ConflictData) {
    this.data = data;
    this.touched = false;
    this.past=[];this.future=[];this.typingKey="";
    this.rawEl = null;
    this.saving = false;
    this.res.clear();
    this.nodes.clear();
    this.current = -1;
    this.rawMode = false;
    this.jumpOpen = false;
    this.oursLines = splitLines(data.ours.text);
    this.theirsLines = splitLines(data.theirs.text);
    this.baseLines = splitLines(data.base.text);
    this.savedText=data.working_modified ? data.merged.text : this.resultText();
    this.analyze();this.inlineError="";
  }

  isSaving():boolean {return this.saving;}

  /** Wurde seit dem Laden etwas entschieden oder getippt? */
  hasUnsavedChanges(): boolean {
    return this.touched || [...this.drafts].some(([path,draft])=>path!==this.data.path && draft.dirty);
  }

  /** Änderungen verwerfen (nach Rückfrage). */
  discardChanges() {
    this.touched = false;this.drafts.clear();
  }

  private needsDecision(r: Region): boolean {
    return r.kind === "conflict" || (this.data.guarded && r.kind !== "unchanged");
  }

  private openRegions(): number[] {
    const out: number[] = [];
    this.data.regions.forEach((r, i) => {
      if (this.needsDecision(r) && !this.res.has(i)) out.push(i);
    });
    return out;
  }

  private conflictIndices(): number[] {
    const list: number[] = [];
    this.data.regions.forEach((r, i) => {
      if (this.needsDecision(r)) list.push(i);
    });
    return list;
  }

  private listForNav(): number[] {
    const open = this.openRegions();
    return open.length ? open : this.conflictIndices();
  }

  private regionSide(r: Region, side: "ours" | "theirs"): string[] {
    const lines = side === "ours" ? this.oursLines : this.theirsLines;
    const [start, len] = side === "ours" ? r.ours : r.theirs;
    return lines.slice(start, start + len);
  }

  private autoLines(r: Region): string[] {
    switch (r.kind) {
      case "ours_only":
      case "both_same":
        return this.regionSide(r, "ours");
      case "theirs_only":
        return this.regionSide(r, "theirs");
      default: {
        const [s, l] = r.base;
        return this.baseLines.slice(s, s + l);
      }
    }
  }

  private resolutionLines(r: Region, i: number): string[] | null {
    const res = this.res.get(i);
    if (!res) return null;
    switch (res.choice) {
      case "ours":
        return this.regionSide(r, "ours");
      case "theirs":
        return this.regionSide(r, "theirs");
      case "both":
        return [...this.regionSide(r, "ours"), ...this.regionSide(r, "theirs")];
      case "base": {
        const [s, l] = r.base;
        return this.baseLines.slice(s, s + l);
      }
      default:
        return res.text ?? [];
    }
  }

  private shownResultLines(r: Region, i: number): string[] {
    const res = this.resolutionLines(r, i);
    if (res) return res;
    if (this.needsDecision(r)) return this.regionSide(r, "ours"); // Startwert
    return this.autoLines(r);
  }

  /** Aktueller Inhalt der Ergebnisdatei (unaufgelöste Konflikte als Marker). */
  resultText(): string {
    const out: string[] = [];
    this.data.regions.forEach((r, i) => {
      const res = this.resolutionLines(r, i);
      if (res) {
        out.push(...res);
        return;
      }
      if (this.needsDecision(r)) {
        out.push(`<<<<<<< ${this.data.ours_label}`);
        out.push(...this.regionSide(r, "ours"));
        out.push("=======");
        out.push(...this.regionSide(r, "theirs"));
        out.push(`>>>>>>> ${this.data.theirs_label}`);
      } else {
        out.push(...this.autoLines(r));
      }
    });
    let text = out.join("\n");
    let trailing=this.data.trailing_newline;
    const last=this.data.regions.length-1;
    const choice=this.res.get(last)?.choice;
    if(choice==="ours") trailing=this.data.ours.text.endsWith("\n");
    else if(choice==="theirs") trailing=this.data.theirs.text.endsWith("\n");
    else if(choice==="base") trailing=this.data.base.text.endsWith("\n");
    else if(choice==="both") trailing=(this.regionSide(this.data.regions[last],"theirs").length ? this.data.theirs.text : this.data.ours.text).endsWith("\n");
    if (trailing && text !== "") text += "\n";
    return text;
  }

  // ------------------------------------------------------------ Aufbau

  mount(target: HTMLElement) {
    this.root = target;
    target.innerHTML = "";
    target.appendChild(this.build());
    this.bindTextareas(target);
    this.current = this.listForNav()[0] ?? -1;
    this.updateHeader();
    if (this.data.working_modified && this.root.querySelector('.grid')) {
      this.toggleRaw();
      if (this.rawEl) { this.rawEl.value = this.data.merged.text;this.rawBefore=this.rawEl.value; }
      this.updateDirtyState();
      const status = this.root.querySelector('.merge-foot .status');
      if (status) status.textContent = t("Vorhandene Arbeitsdatei geladen – bearbeite deine gespeicherte Fassung weiter.");
    }
    this.initial=this.snapshot();
    const draft=this.drafts.get(this.data.path);
    if(draft && draft.fingerprint===this.fingerprint(this.data)) {
      this.savedText=draft.saved;this.initial=draft.initial;this.past=draft.past;this.future=draft.future;this.restore(draft.state);
      const panes=this.root.querySelector('.panes');if(panes)panes.scrollTop=draft.scroll;
    }
  }

  /** Rebuild chrome from the existing editor model without reopening the file or resetting undo history. */
  relocalize(): void {
    if (!this.root || this.saving) return;
    const state=this.snapshot();
    const selections=[...this.root.querySelectorAll('textarea')].map(area=>({start:area.selectionStart,end:area.selectionEnd,scroll:area.scrollTop}));
    const openProposals=[...this.nodes].filter(([,node])=>node.querySelector<HTMLDetailsElement>('details.auto-suggestion')?.open).map(([index])=>index);
    this.restore(state);
    this.root.querySelectorAll('textarea').forEach((area,index)=>{
      const previous=selections[index];
      if(previous){area.setSelectionRange(previous.start,previous.end);area.scrollTop=previous.scroll;}
    });
    for (const index of openProposals) {
      const details=this.nodes.get(index)?.querySelector<HTMLDetailsElement>('details.auto-suggestion');
      if(details)details.open=true;
    }
  }

  private snapshot(rawText?:string):EditorSnapshot {return {res:new Map(this.res),raw:this.rawMode,text:rawText??this.rawEl?.value??"",current:this.current};}
  private checkpoint(label:string,typing="",rawText?:string) {
    if(!typing||typing!==this.typingKey||Date.now()-this.typingTime>700)this.past.push({state:this.snapshot(rawText),label});
    this.future=[];this.typingKey=typing;this.typingTime=Date.now();
  }
  private restore(state:EditorSnapshot) {
    if(!this.root)return;
    const scroll=this.root.querySelector(".panes")?.scrollTop??0;
    this.res=new Map(state.res);this.current=state.current;this.rawMode=false;this.rawEl=null;this.nodes.clear();
    this.root.innerHTML="";this.root.appendChild(this.build());this.bindTextareas(this.root);
    if(state.raw){this.toggleRaw();const raw=this.root.querySelector<HTMLTextAreaElement>(".raw-edit");if(raw){raw.value=state.text;this.rawBefore=state.text;}}
    this.touched=(this.root.querySelector<HTMLTextAreaElement>(".raw-edit")?.value??this.resultText())!==this.savedText;
    const panes=this.root.querySelector(".panes");if(panes)panes.scrollTop=scroll;
    this.typingKey="";this.updateHeader();
  }
  private undo(redo=false) {
    if(this.saving)return;
    const from=redo?this.future:this.past,to=redo?this.past:this.future;
    const entry=from.pop();if(!entry)return;
    to.push({state:this.snapshot(),label:entry.label});this.restore(entry.state);
    const area=this.rawMode ? this.root?.querySelector<HTMLTextAreaElement>(".raw-edit") : this.nodes.get(this.current)?.querySelector<HTMLTextAreaElement>(".cf-edit");
    area?.focus({preventScroll:true});
  }
  private async resetPreview() {
    const data=this.data;
    if(!await confirmDialog(t("Auswahl dieser Datei zurücksetzen?"),t("Setzt die Vorschau auf den beim Öffnen geladenen Stand zurück. Die Datei wird erst beim Speichern geändert."),t("Auswahl zurücksetzen")))return;
    if(this.data!==data||this.saving)return;
    this.checkpoint(t("Auswahl zurücksetzen"));this.restore(this.initial);
  }

  private fileNav():HTMLElement {
    const files=el('nav','merge-files');files.setAttribute('aria-label',t('Konfliktdateien'));
    this.siblings.forEach(file=>this.knownFiles.add(file.path));this.knownFiles.add(this.data.path);
    for(const path of this.knownFiles) {
      const button=el('button','merge-file');button.type='button';button.title=path;
      const state=this.fileState.get(path);
      const label=state==='resolved' ? t('Gelöst') : state===0 ? t('Prüfen') : typeof state==='number' ? `${state} ${t('offen')}` : t('offen');
      button.innerHTML=`<span>${esc(path)}</span><small>${esc(label)}</small>`;
      button.setAttribute('aria-current',String(path===this.data.path));
      button.disabled=!this.siblings.some(file=>file.path===path)||!this.host.onSwitch;
      button.addEventListener('click',()=>{if(!this.saving)this.host.onSwitch?.(path);});files.appendChild(button);
    }
    return files;
  }

  private build(): HTMLElement {
    const d = this.data;
    const wrap = el("div", "merge");

    // Kopfzeile
    const head = el("div", "merge-head");
    const dot = d.ours_label ? "" : "";
    head.innerHTML = h`
      <div class="file">
        <span class="name">${esc(baseName(d.path))}</span>
        <span class="dir">${esc(dirName(d.path))}</span>
      </div>
      <div class="stats"></div>
      <div class="nav">
        <button class="icon-btn small" data-act="prev" title="Vorheriger Konflikt (Alt+↑)"><span class="rot180">${icon("chevron", 14)}</span></button>
        <button class="pos-btn" data-act="jump" title="Konflikte auflisten"><span class="pos">– / –</span>${icon("chevron", 12)}</button>
        <button class="icon-btn small" data-act="next" title="Nächster Konflikt (Alt+↓)">${icon("chevron", 14)}</button>
      </div>
      <div class="right-actions">
        ${dot}
        <button class="icon-btn" data-act="undo" title="Rückgängig (Strg+Z)" aria-label="Rückgängig">${icon("undo",15)}</button>
        <button class="icon-btn" data-act="redo" title="Wiederholen (Strg+Umschalt+Z)" aria-label="Wiederholen"><span style="transform:scaleX(-1)">${icon("undo",15)}</span></button>
        <button class="btn ghost" data-act="reset-preview" title="Nur die Vorschau dieser Datei zurücksetzen">Auswahl zurücksetzen</button>
        ${this.host.canAbort?.() ? h`<button class="btn danger" data-act="abort-merge">Merge abbrechen</button>` : ""}
        <button class="btn" data-act="auto-resolve" title="Getrennte Änderungen über mehrere Bereiche kombinieren. Überschneidungen bleiben offen. Ergebnis bitte prüfen.">Auto Resolve</button>
        <button class="btn ghost" data-act="accept-ours-all" title="Nur noch offene Konflikte von links übernehmen; vorhandene Entscheidungen bleiben erhalten.">Offene von links</button>
        <button class="btn ghost" data-act="accept-theirs-all" title="Nur noch offene Konflikte von rechts übernehmen; vorhandene Entscheidungen bleiben erhalten.">Offene von rechts</button>
        <button class="btn ghost" data-act="raw" title="Die ganze Ergebnisdatei direkt bearbeiten">Roh-Modus</button>
        <button class="icon-btn" data-act="close" title="Editor schließen">${icon("close", 15)}</button>
      </div>`;
    wrap.appendChild(head);
    const direction=el('div','merge-direction');
    direction.innerHTML=`<b>${esc(d.theirs_label)} → ${esc(d.ours_label)}</b>`;
    direction.insertAdjacentHTML('beforeend',h`<span class="merge-steps">Konflikte lösen → Merge abschließen → Pushen</span>`);
    wrap.appendChild(direction);
    wrap.style.setProperty('--merge-result-width',`${this.resultWidth}%`);
    const width=el('label','merge-width',h`Ergebnisbreite <input type="range" min="30" max="60" step="1" value="${this.resultWidth}" aria-label="Ergebnisbreite">`);
    width.querySelector('input')!.addEventListener('input',event=>{this.resultWidth=Number((event.target as HTMLInputElement).value);wrap.style.setProperty('--merge-result-width',`${this.resultWidth}%`);});
    direction.appendChild(width);
    const inline=el('div','merge-inline-error');inline.setAttribute('role','alert');inline.hidden=!this.inlineError;inline.textContent=this.inlineError;wrap.appendChild(inline);
    const secondary=el('details','merge-tools');
    secondary.innerHTML=h`<summary>Weitere Aktionen</summary>`;
    for(const action of ['reset-preview','abort-merge','accept-ours-all','accept-theirs-all','raw']) {
      const button=head.querySelector(`[data-act="${action}"]`);if(button)secondary.appendChild(button);
    }
    head.querySelector('.right-actions')?.appendChild(secondary);
    if (d.ours.binary || d.theirs.binary || !d.ours.exists || !d.theirs.exists) {
      head.querySelectorAll('[data-act="undo"], [data-act="redo"], [data-act="reset-preview"], [data-act="raw"], [data-act="auto-resolve"], [data-act^="accept-"], .nav').forEach(n=>n.remove());
      const binary = el("div", "empty binary-choice", h`<h2>${d.ours.binary || d.theirs.binary ? t("Binärdatei") : t("Datei auf einer Seite gelöscht")}</h2>
        <p>Wähle die vollständige Datei oder bestätige die Löschung. Die gewählte Seite wird unverändert übernommen und als gelöst markiert.</p>
        <div class="row-actions-gap"><button class="btn" data-act="whole-ours">${d.ours.exists ? m`Lokale Datei übernehmen (${esc(d.ours_label)})` : t("Lokale Löschung übernehmen")}</button>
        <button class="btn primary" data-act="whole-theirs">${d.theirs.exists ? m`Eingehende Datei übernehmen (${esc(d.theirs_label)})` : t("Eingehende Löschung übernehmen")}</button></div>`);
      const workspace=el('div','merge-workspace');workspace.append(this.fileNav(),binary);wrap.appendChild(workspace);
      wrap.addEventListener("click", e => this.onClick(e));
      return wrap;
    }


    if (d.guarded) {
      wrap.appendChild(
        el(
          "div",
          "banner warn",
          h`${icon("warning", 14)}<span><b>Prüfmodus:</b> <code>git merge-file</code> sieht hier einen Konflikt, die automatische Analyse nicht
           (das passiert bei doppelten Zeilen). Deshalb wird kein Bereich stillschweigend übernommen – entscheide jeden geänderten Bereich selbst.</span>`,
        ),
      );
    }
    if (d.ours.binary || d.theirs.binary) {
      wrap.appendChild(
        el(
          "div",
          "banner warn",
          h`${icon("warning", 14)}<span><b>Binärdatei:</b> kein Textvergleich möglich – nimm links oder rechts komplett an.</span>`,
        ),
      );
    }

    const progress=el("div","merge-progress",'<span></span>');
    progress.setAttribute("role","progressbar");progress.setAttribute("aria-label",t("Konflikte aufgelöst"));wrap.appendChild(progress);

    wrap.appendChild(el("p","auto-summary"));
    // Spaltenköpfe + Raster
    const panes = el("div", "panes");
    const heads = el("div", "pane-heads");
    heads.innerHTML = h`
      <div class="ph"><span class="dot ours"></span><b>Aktueller Branch</b><span class="ref">${esc(d.ours_label)}</span>
        <span class="fname mono">${esc(baseName(d.path))}</span></div>
      <div class="ph"><span class="dot result"></span><b>Ergebnis</b><span class="sub">wird geschrieben</span></div>
      <div class="ph"><span class="dot theirs"></span><b>Eingehender Branch</b><span class="ref">${esc(d.theirs_label)}</span>
        <span class="fname mono">${esc(baseName(d.path))}</span></div>`;
    panes.appendChild(heads);

    const grid = el("div", "grid");
    d.regions.forEach((r, i) => {
      const node = this.buildRegion(r, i);
      this.nodes.set(i, node);
      grid.appendChild(node);
    });
    panes.appendChild(grid);
    const workspace=el('div','merge-workspace');
    const files=this.fileNav();
    workspace.append(files,panes);wrap.appendChild(workspace);

    // Fußzeile
    const foot = el("div", "merge-foot");
    foot.innerHTML = h`
      <span class="status"></span><span class="edit-state" aria-live="polite"></span>
      <span class="right-actions">
        <span class="hint muted small nowrap">Alt+↑/↓ Konflikt · Alt+←/→ übernehmen · Alt+B beide · Alt+Enter speichern</span>
        <button class="btn" data-act="save">Speichern</button>
        <button class="btn primary" data-act="save-resolve">Übernehmen &amp; nächste Datei</button>
      </span>`;
    wrap.appendChild(foot);

    wrap.addEventListener("click", (e) => this.onClick(e));
    wrap.addEventListener("change", (e) => this.onChange(e));
    wrap.addEventListener("keydown", (e) => this.onKey(e));
    return wrap;
  }

  private buildRegion(r: Region, i: number): HTMLElement {
    const node = el("div", `region kind-${r.kind}`);
    node.dataset.region = String(i);
    const decision = this.needsDecision(r);
    if (decision && !this.res.has(i)) node.classList.add("unresolved");
    if (this.data.guarded && r.kind !== "conflict") node.classList.add("guarded");

    // linke Spalte
    node.appendChild(
      this.buildSide("ours", r, decision && r.kind === "conflict" ? false : r.kind !== "unchanged"),
    );

    // Ergebnisspalte
    const resultCol = el("div", "col col-result");
    if (decision) {
      const res = this.res.get(i);
      const block = el("div", `cf${res ? " resolved" : ""}`);
      const bar = el("div", "cf-bar");
      bar.innerHTML = h`
        <span class="label${this.data.guarded && r.kind !== "conflict" ? " pruefen" : ""}">${
          res ? t("Gelöst") : this.data.guarded && r.kind !== "conflict" ? t("prüfen") : t("Konflikt")
        }</span>
        <button class="mini" data-act="take-ours" title="Links übernehmen: lokale Fassung (Alt+←)">${icon("right", 12)} Links übernehmen</button>
        <button class="mini" data-act="take-theirs" title="Rechts übernehmen: eingehende Fassung (Alt+→)">${icon("left", 12)} Rechts übernehmen</button>
        <button class="mini" data-act="edit-region">Bearbeiten</button>
        <button class="mini" data-act="take-both" title="Zuerst links, danach rechts übernehmen">${icon("both", 12)} Links → rechts</button>
        <button class="mini" data-act="revert" title="Entscheidung zurücknehmen">${icon("undo", 12)}</button>
        <span class="state ${res ? "ok" : "open"}">${
          res ? `✓ ${labelFor(res.choice)}` : t("offen")
        }</span>`;
      block.appendChild(bar);
      const area = el("textarea", "cf-edit");
      area.setAttribute("aria-label", m`Ergebnis für Konfliktbereich ${i + 1}`);
      area.spellcheck = false;
      area.dataset.region = String(i);
      area.rows = Math.max(1, this.shownResultLines(r, i).length);
      area.value = this.shownResultLines(r, i).join("\n");
      block.appendChild(area);
      const proposal=res ? null : this.autoCandidate(i);
      const analysis=this.proposals.get(i);
      if(!res)block.insertAdjacentHTML('beforeend',`<p class="proposal-reason">${esc(analysis ? t(analysis.kind==='review'?'Vorschlag prüfen':'Eindeutig zusammenführbar')+' · '+this.reason(analysis) : t('Manuelle Entscheidung nötig'))}</p>`);
      if(proposal!==null) {
        block.insertAdjacentHTML("beforeend",h`<details class="auto-suggestion"><summary>Automatischen Vorschlag ansehen</summary><pre>${esc(proposal.join("\n")||t("(leeres Ergebnis)"))}</pre><div><span>Noch nicht übernommen</span><button class="mini primary" data-act="auto-region">Vorschlag übernehmen</button></div></details>`);
      }
      resultCol.appendChild(block);
    } else {
      const lines = this.autoLines(r);
      const origin = r.kind === "theirs_only" ? "theirs" : "ours";
      const chip =
        lines.length > 0 && r.kind !== "unchanged"
          ? `<span class="taken ${origin}">${origin === "theirs" ? t("← eingehend") : t("lokal →")}</span>`
          : "";
      lines.forEach((line, k) => {
        const ln = el("div", "line");
        ln.innerHTML = `<span class="txt">${esc(line)}</span>${k === 0 ? chip : ""}`;
        if (r.kind === "ours_only" || r.kind === "both_same") ln.classList.add("from-ours");
        if (r.kind === "theirs_only") ln.classList.add("from-theirs");
        if (kindHints()[r.kind]) ln.title = kindHints()[r.kind];
        resultCol.appendChild(ln);
      });
      if (lines.length === 0) resultCol.appendChild(el("div", "line line-empty"));
    }
    node.appendChild(resultCol);

    // rechte Spalte
    node.appendChild(
      this.buildSide("theirs", r, decision && r.kind === "conflict" ? false : r.kind !== "unchanged"),
    );
    return node;
  }

  private buildSide(side: "ours" | "theirs", r: Region, highlight: boolean): HTMLElement {
    const col = el("div", `col col-${side}${highlight ? " changed" : ""}`);
    const lines = this.regionSide(r, side);
    const [start] = side === "ours" ? r.ours : r.theirs;
    const marks: Highlights = side === "ours" ? this.data.highlight_ours : this.data.highlight_theirs;
    if (lines.length === 0) {
      col.appendChild(el("div", "line line-empty"));
      return col;
    }
    lines.forEach((line, k) => {
      const num = start + k;
      const ln = el("div", "line");
      const spans: WordSpan[] | undefined = marks[String(num)];
      const body = spans
        ? spans
            .map((s) => (s.changed ? `<span class="w">${esc(s.text)}</span>` : esc(s.text)))
            .join("")
        : esc(line);
      ln.innerHTML = `<span class="ln">${num + 1}</span><span class="txt">${body}</span>`;
      col.appendChild(ln);
    });
    return col;
  }

  private updateRegion(i: number) {
    const node = this.nodes.get(i);
    if (!node || this.rawMode) return;
    const focused=document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement.dataset.act : undefined;
    const fresh = this.buildRegion(this.data.regions[i], i);
    node.replaceWith(fresh);
    this.nodes.set(i, fresh);
    this.bindTextareas(fresh);
    if(focused) [...fresh.querySelectorAll<HTMLButtonElement>("button[data-act]")].find(button=>button.dataset.act===focused)?.focus({preventScroll:true});
  }

  private updateHeader() {
    if (!this.root) return;
    const wrap = this.root;
    const conflicts = this.conflictIndices();
    const open = this.openRegions();
    const auto = this.data.regions.filter((r) => r.kind === "ours_only" || r.kind === "theirs_only" || r.kind === "both_same").length;

    const stats = wrap.querySelector(".merge-head .stats");
    if (stats) {
      stats.innerHTML = `
        ${conflicts.length ? h`<span class="badge conflict">${conflicts.length} ${conflicts.length === 1 ? t("Konflikt") : t("Konflikte")}</span>` : ""}
        ${auto ? h`<span class="badge">${auto} automatisch</span>` : ""}
        ${
          conflicts.length
            ? h`<span class="badge ${open.length ? "open" : "done"}">${conflicts.length - open.length} von ${conflicts.length} aufgelöst</span>`
            : h`<span class="badge done">keine Konflikte</span>`
        }`;
    }
    const progress=wrap.querySelector<HTMLElement>(".merge-progress");
    if(progress) {
      progress.setAttribute("aria-valuemin","0");progress.setAttribute("aria-valuemax",String(conflicts.length||1));
      progress.setAttribute("aria-valuenow",String(conflicts.length ? conflicts.length-open.length : 1));
      progress.setAttribute("aria-valuetext",m`${conflicts.length-open.length} von ${conflicts.length} aufgelöst`);
      progress.style.setProperty("--merge-complete",`${conflicts.length ? (conflicts.length-open.length)/conflicts.length*100 : 100}%`);
      progress.dataset.complete=String(!open.length);
    }
    this.nodes.forEach((node,index)=>node.classList.toggle("current",index===this.current));
    const currentFile=wrap.querySelector('.merge-file[aria-current="true"] small');
    if(currentFile)currentFile.textContent=open.length ? `${open.length} ${t('offen')}` : t('Prüfen');
    this.updateDirtyState();
    for(const [act,stack] of [["undo",this.past],["redo",this.future]] as const){
      const button=wrap.querySelector<HTMLButtonElement>(`[data-act="${act}"]`);
      if(button){button.disabled=this.saving||!stack.length;button.title=`${act==="undo"?t("Rückgängig"):t("Wiederholen")}${stack.length?": "+localizeText(stack[stack.length-1].label):""}`;}
    }
    wrap.querySelectorAll<HTMLButtonElement>('[data-act="reset-preview"],[data-act="abort-merge"]').forEach(button=>button.disabled=this.saving);
    const select=wrap.querySelector<HTMLSelectElement>(".file-select");if(select)select.disabled=this.saving;
    wrap.querySelectorAll<HTMLButtonElement>('[data-act^="take-"],[data-act="auto-region"],[data-act="revert"],[data-act="prev"],[data-act="next"],[data-act="jump"]').forEach(button=>button.disabled=this.saving);
    const candidates=this.autoCandidates();
    const safe=candidates.filter(candidate=>this.proposals.get(candidate.index)?.kind==='safe');
    const summary=wrap.querySelector('.auto-summary');
    if(summary)summary.textContent=`${safe.length} ${t('kombinierbar')} · ${candidates.length-safe.length} ${t('Vorschlag prüfen')} · ${open.length-candidates.length} ${t('manuell entscheiden')}`;
    const autoButton=wrap.querySelector<HTMLButtonElement>('[data-act="auto-resolve"]');
    if(autoButton) {autoButton.disabled=this.saving || this.rawMode || !safe.length;autoButton.textContent=safe.length ? `Auto Resolve (${safe.length})` : "Auto Resolve";}
    wrap.querySelectorAll<HTMLButtonElement>('[data-act="accept-ours-all"],[data-act="accept-theirs-all"]').forEach(button=>button.disabled=this.saving || this.rawMode || !open.length);
    wrap.querySelectorAll<HTMLButtonElement>('[data-act="save"],[data-act="save-resolve"],[data-act="raw"]').forEach(button=>button.disabled=this.saving);
    const list = this.listForNav();
    const pos = list.indexOf(this.current);
    const posEl = wrap.querySelector(".merge-head .nav .pos");
    if (posEl) posEl.textContent = list.length ? `${pos >= 0 ? pos + 1 : "–"} / ${list.length}` : "– / –";

    const status = wrap.querySelector(".merge-foot .status");
    if (status) {
      const total = conflicts.length;
      const done = total - open.length;
      status.textContent = open.length
        ? open.length === 1
          ? t("1 Bereich braucht noch eine Entscheidung")
          : m`${open.length} Bereiche brauchen noch eine Entscheidung`
        : total
          ? m`${total === 1 ? t("Konflikt") : m`Alle ${total} Konflikte`} aufgelöst`
          : t("keine Konflikte – nur bestätigen");
      status.className = `status ${open.length ? "warn" : "ok"}`;
      void done;
    }
  }

  // ------------------------------------------------------------ Ereignisse

  private goTo(delta: number) {
    const list = this.listForNav();
    if (!list.length) return;
    let pos = list.indexOf(this.current);
    pos = pos < 0 ? (delta > 0 ? 0 : list.length - 1) : (pos + delta + list.length) % list.length;
    this.jumpTo(list[pos]);
  }

  /** Zu einem Konflikt springen (auch aus der Konfliktliste). */
  private jumpTo(index: number) {
    this.current = index;
    const node = this.nodes.get(index);
    if (node) {
      node.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      (node.querySelector(".cf-edit") as HTMLTextAreaElement | null)?.focus({preventScroll:true});
    }
    this.updateHeader();
  }

  /** Liste aller Konflikte mit Zeilennummern (WebStorm: Konflikt-Navigation). */
  private openJumpList(anchor: HTMLElement) {
    document.querySelector(".popover")?.remove();
    const list = this.conflictIndices();
    if (!list.length) return;
    const pop = el("div", "popover");
    pop.style.width = "520px";
    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(rect.left - 60, window.innerWidth - 540))}px`;
    pop.style.top = `${rect.bottom + 6}px`;
    pop.innerHTML = h`
      <div class="group-title">Konflikte in ${esc(baseName(this.data.path))}</div>
      <div class="list">${list
        .map((idx, n) => {
          const r = this.data.regions[idx];
          const res = this.res.get(idx);
          const lineNo = r.ours[0] + 1;
          const preview = this.oursLines[r.ours[0]] ?? "";
          const theirsPreview = this.theirsLines[r.theirs[0]] ?? "";
          return `
          <div class="pop-item" data-jump="${idx}">
            <span class="dot ${res ? "on" : ""}"></span>
            <span class="mono small" style="width:52px">${lineNo}${r.ours[1] > 1 ? `–${r.ours[0] + r.ours[1]}` : ""}</span>
            <span class="bsub"><span class="mono">${esc(preview.trim() || theirsPreview.trim() || "(leer)")}</span></span>
            <span class="chip ${res ? "ok" : "conflict"}">${res ? `✓ ${labelFor(res.choice)}` : `${n + 1}/${list.length}`}</span>
          </div>`;
        })
        .join("")}</div>`;
    document.body.appendChild(pop);
    const close = () => pop.remove();
    pop.addEventListener("click", (ev) => {
      const raw = (ev.target as HTMLElement).closest("[data-jump]")?.getAttribute("data-jump");
      if (raw === null || raw === undefined) return;
      this.jumpTo(Number(raw));
      close();
    });
    setTimeout(() => document.addEventListener("mousedown", close, { once: true }), 0);
  }

  private autoCandidate(index:number):string[]|null {
    if(this.data.guarded||this.rawMode||this.res.has(index)||this.data.ours.binary||this.data.theirs.binary||!this.data.ours.exists||!this.data.theirs.exists)return null;
    const region=this.data.regions[index];if(!this.needsDecision(region))return null;
    if(index===this.data.regions.length-1&&this.data.ours.text.endsWith("\n")!==this.data.theirs.text.endsWith("\n"))return null;
    return this.proposals.get(index)?.lines??null;
  }
  private reason(proposal:Proposal):string {
    return t(proposal.reason==='same'?'Beide Seiten enthalten dieselbe Änderung':proposal.reason==='one-side'?'Nur eine Seite weicht von der Basis ab':proposal.reason==='separate'?'Änderungen betreffen getrennte Textstellen':'Änderungen innerhalb derselben Zeile: Ergebnis prüfen');
  }
  private autoCandidates(): {index:number;lines:string[]}[] {
    return this.openRegions().flatMap(index=>{const lines=this.autoCandidate(index);return lines===null?[]:[{index,lines}];});
  }

  private async previewAuto() {
    const data=this.data,candidates=this.autoCandidates().filter(candidate=>this.proposals.get(candidate.index)?.kind==='safe');
    if(!candidates.length)return;
    const detail=`${candidates.length} ${t("kombinierbar")} · ${this.openRegions().length-candidates.length} ${t("manuell entscheiden")}\n\n`+candidates.map(candidate=>`${this.reason(this.proposals.get(candidate.index)!)}\n${candidate.lines.join('\n')}`).join('\n\n');
    const approved=await confirmDialog(t("Automatischen Vorschlag ansehen"),detail,t("Vorschlag übernehmen"));
    if(approved && this.data===data && !this.saving && !this.rawMode) this.applyDecisions(candidates.filter(candidate=>!this.res.has(candidate.index)).map(candidate=>({...candidate,choice:"auto"})));
  }

  private updateDirtyState() {
    this.touched=(this.rawMode ? this.rawEl?.value??this.resultText() : this.resultText())!==this.savedText;
    const label=this.root?.querySelector<HTMLElement>(".edit-state");
    if(label) { label.textContent=this.saving ? t("Wird gespeichert …") : this.touched ? t("Nicht gespeichert") : "";label.classList.toggle("saving",this.saving); }
  }

  private applyDecisions(decisions:{index:number;choice:Choice;lines?:string[]}[]) {
    if(!decisions.length) return;
    this.checkpoint(decisions[0].choice==="auto"?"Auto Resolve":t("Offene Konflikte übernehmen"));
    this.touched=true;
    for(const decision of decisions) { this.res.set(decision.index,{choice:decision.choice,text:decision.lines});this.updateRegion(decision.index); }
    this.updateHeader();
  }

  private decide(i: number, choice: Choice, text?: string[]) {
    this.checkpoint(m`Bereich ${i+1}: ${labelFor(choice)}`);
    this.touched = true;
    this.res.set(i, { choice, text });
    this.updateRegion(i);
    this.updateHeader();
  }

  private onClick(e: Event) {
    const target = e.target as HTMLElement;
    const act = (target.closest("[data-act]") as HTMLElement | null)?.dataset.act;
    if (!act || this.saving || (target.closest("button") as HTMLButtonElement | null)?.disabled) return;
    switch (act) {
      case "undo": return this.undo();
      case "redo": return this.undo(true);
      case "reset-preview": void this.resetPreview();return;
      case "abort-merge": void this.host.onAbort?.();return;
      case "whole-ours":
        void this.host.takeSide?.("ours");
        return;
      case "whole-theirs":
        void this.host.takeSide?.("theirs");
        return;
      case "prev":
        return this.goTo(-1);
      case "next":
        return this.goTo(1);
      case "jump":
        return this.openJumpList(target.closest("[data-act]") as HTMLElement);
      case "raw":
        return this.toggleRaw();
      case "close":
        return this.host.onClose();
      case "save":
        void this.doSave(false);
        return;
      case "save-resolve":
        void this.doSave(true);
        return;
      case "auto-resolve":
        if(this.rawMode) return;
        void this.previewAuto();
        return;
      case "accept-ours-all":
        if(this.rawMode) return;
        this.applyDecisions(this.openRegions().map(index=>({index,choice:"ours"})));
        return;
      case "accept-theirs-all":
        if(this.rawMode) return;
        this.applyDecisions(this.openRegions().map(index=>({index,choice:"theirs"})));
        return;
      default:
        break;
    }
    const idx = Number((target.closest(".region") as HTMLElement | null)?.dataset.region);
    if (Number.isNaN(idx)) return;
    this.current=idx;
    switch (act) {
      case "edit-region": this.nodes.get(idx)?.querySelector<HTMLTextAreaElement>(".cf-edit")?.focus();break;
      case "auto-region": {const proposal=this.autoCandidate(idx);if(proposal!==null)this.decide(idx,"auto",proposal);break;}
      case "take-ours":
        this.decide(idx, "ours");
        break;
      case "take-theirs":
        this.decide(idx, "theirs");
        break;
      case "take-both":
        this.decide(idx, "both");
        break;
      case "revert":
        this.checkpoint(t("Bereich zurücksetzen"));
        this.touched = true;
        this.res.delete(idx);
        this.updateRegion(idx);
        this.updateHeader();
        break;
      default:
        break;
    }
  }

  private onChange(e: Event) {
    if(this.saving)return;
    const t = e.target as HTMLSelectElement;
    if (t.dataset.act === "switch" && this.host.onSwitch) this.host.onSwitch(t.value);
  }

  private onKey(e: KeyboardEvent) {
    if((e.ctrlKey||e.metaKey)&&!e.altKey&&(e.key.toLowerCase()==="z"||e.key.toLowerCase()==="y")) {
      e.preventDefault();e.stopPropagation();this.undo(e.shiftKey||e.key.toLowerCase()==="y");return;
    }
    if (this.saving || (this.rawMode && e.key !== "Enter")) return;
    if (!e.altKey) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.goTo(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.goTo(-1);
    } else if (e.key === "ArrowRight" && this.current >= 0) {
      e.preventDefault();
      this.decide(this.current, "theirs");
    } else if (e.key === "ArrowLeft" && this.current >= 0) {
      e.preventDefault();
      this.decide(this.current, "ours");
    } else if (e.key.toLowerCase() === "b" && this.current >= 0) {
      e.preventDefault();
      this.decide(this.current, "both");
    } else if (e.key === "Enter") {
      e.preventDefault();
      void this.doSave(true);
    }
  }

  private bindTextareas(scope: HTMLElement) {
    scope.querySelectorAll("textarea.cf-edit").forEach((node) => {
      const area = node as HTMLTextAreaElement;
      area.addEventListener("focus",()=>{this.current=Number(area.dataset.region);this.nodes.forEach((node,index)=>node.classList.toggle("current",index===this.current));});
      area.addEventListener("input", () => {
        const idx = Number(area.dataset.region);
        const lines = area.value.split("\n");
        this.checkpoint(t("Text bearbeiten"),`block-${idx}`);
        this.touched = true;
        this.res.set(idx, { choice: "custom", text: lines });
        area.rows = Math.max(1, lines.length);
        const region = this.nodes.get(idx);
        if (region) {
          region.querySelector(".auto-suggestion")?.remove();
          region.classList.remove("unresolved");
          region.querySelector(".cf")?.classList.add("resolved");
          const state = region.querySelector(".cf-bar .state");
          if (state) {
            state.textContent = t("✓ eigene Fassung");
            state.className = "state ok";
          }
        }
        this.updateHeader();
      });
    });
  }

  private toggleRaw() {
    if (!this.root) return;
    const grid = this.root.querySelector(".grid") as HTMLElement;
    const btn = this.root.querySelector('[data-act="raw"]') as HTMLButtonElement;
    if (!this.rawMode) {
      this.rawMode = true;
      btn.classList.add("active");
      btn.textContent = t("Block-Ansicht");
      const area = el("textarea", "raw-edit");
      area.spellcheck = false;
      area.setAttribute("aria-label", t("Ergebnisdatei frei bearbeiten"));
      area.value = this.resultText();
      this.rawBefore=area.value;
      area.addEventListener("input", () => {
        this.checkpoint(t("Ergebnis bearbeiten"),"raw",this.rawBefore);this.rawBefore=area.value;
        this.touched = true;
        this.updateHeader();
      });
      this.rawEl = area;
      grid.innerHTML = "";
      grid.classList.add("raw");
      grid.appendChild(area);
    } else {
      if (this.rawEl && this.rawEl.value !== this.resultText()) {
        this.error(t("Die freie Fassung bleibt im Textmodus erhalten. Speichere sie hier; die Block-Ansicht kann freien Text nicht verlustfrei zuordnen."));
        return;
      }
      this.rawMode = false;
      btn.classList.remove("active");
      btn.textContent = t("Roh-Modus");
      this.rawEl = null;
      grid.classList.remove("raw");
      grid.innerHTML = "";
      this.data.regions.forEach((r, i) => {
        const node = this.buildRegion(r, i);
        this.nodes.set(i, node);
        grid.appendChild(node);
      });
      this.bindTextareas(this.root);
    }
    this.updateHeader();
  }

  private async saveOnce(text: string, resolved: boolean) {
    this.saving = true;
    this.updateHeader();
    this.root?.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(area=>area.readOnly=true);
    try { return await this.host.save(text, resolved,this.data); }
    catch(e) { return { ok: false, message: String(e) }; }
    finally {
      this.saving = false;
      this.root?.querySelectorAll<HTMLTextAreaElement>("textarea").forEach(area=>area.readOnly=false);
      this.updateHeader();
    }
  }

  private async doSave(markResolved: boolean) {
    if (this.saving) return;
    if (this.data.ours.binary || this.data.theirs.binary) { this.error(t("Bitte eine vollständige Dateiseite übernehmen.")); return; }
    if (this.rawMode && this.rawEl) {
      const text = this.rawEl.value;
      const hasMarkers = /^(<{7}|={7}|>{7}|\|{7})/m.test(text);
      if (markResolved && hasMarkers) { this.error(t("Entferne zuerst alle Konfliktmarker oder speichere die Datei als Zwischenstand.")); return; }
      const r = await this.saveOnce(text, markResolved && !hasMarkers);
      if (r.ok) {
        this.drafts.delete(this.data.path);this.data.merged.text=text;this.savedText=text;this.typingKey="";
        this.touched = false;
        this.updateDirtyState();
        if(markResolved)this.forget(this.data.path);
        this.host.onSaved(r.message, markResolved && !hasMarkers);
      } else this.error(r.message);
      return;
    }
    const open = this.openRegions();
    if (markResolved && open.length) {
      this.error(
        m`${open.length} ${open.length === 1 ? t("Bereich") : t("Bereiche")} noch offen. Wähle links, rechts oder bearbeite das Ergebnis.`,
      );
      return;
    }
    const result=this.resultText();
    if(markResolved && /^(<{7}|={7}|>{7}|\|{7})/m.test(result)) { this.error(t("Entferne zuerst alle Konfliktmarker aus dem Ergebnis.")); return; }
    const r = await this.saveOnce(result, markResolved);
    if (r.ok) {
      this.drafts.delete(this.data.path);this.data.merged.text=result;this.savedText=result;this.typingKey="";
      this.touched = false;
      this.updateDirtyState();
      if(markResolved)this.forget(this.data.path);
      this.host.onSaved(r.message, markResolved);
    } else this.error(r.message);
  }
}

export function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

export function dirName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}
