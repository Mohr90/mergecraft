import type { RepoSnapshot, TagInfo } from "./api";
import { absTime, el, esc, fuzzy, icon, relTime } from "./ui";

export interface TagViewState {
  query: string;
  scope: "all" | "annotated" | "lightweight";
  sort: "recent" | "name";
  scrollTop: number;
}

interface TagContext {
  tags(): TagInfo[];
  snapshot(): RepoSnapshot | null;
  compareTag(tag: TagInfo): void;
  showTagCommit(tag: TagInfo): void;
  newFromTag(tag: TagInfo): void;
}

export function renderTags(ctx: TagContext, state: TagViewState): HTMLElement {
  const wrap = el("div", "panel-pad tags-panel");
  const all = ctx.tags();
  const snap = ctx.snapshot();
  const blocked = !!(snap?.merging || snap?.rebasing || snap?.cherry_picking);
  wrap.innerHTML = `
    <div class="branch-toolbar">
      <header class="page-heading"><div><h1>Tags</h1><p class="muted">Releases und markierte Stände deines Repositories.</p></div></header>
      <div class="branch-tools">
        <label class="branch-search">${icon("search",16)}<input type="search" aria-label="Tags filtern" placeholder="Tag oder Beschreibung suchen …"></label>
        <label class="small">Anzeigen <select class="tag-scope" aria-label="Tag-Typ"><option value="all">Alle Tags</option><option value="annotated">Annotierte Tags</option><option value="lightweight">Einfache Tags</option></select></label>
        <label class="small">Sortierung <select class="tag-sort" aria-label="Tags sortieren"><option value="recent">Zuletzt erstellt</option><option value="name">Name A–Z</option></select></label>
      </div>
      <p class="tag-hint muted">${icon("tag",14)} Ein neuer Branch startet am gewählten Tag. Du wechselst direkt in den neuen Branch.</p>
      <div class="tag-filter-status branch-filter-status" role="status"></div>
    </div>
    <div class="tag-list branch-groups"></div>`;
  const input = wrap.querySelector<HTMLInputElement>('input')!;
  const scope = wrap.querySelector<HTMLSelectElement>('.tag-scope')!;
  const sort = wrap.querySelector<HTMLSelectElement>('.tag-sort')!;
  const list = wrap.querySelector<HTMLElement>('.tag-list')!;
  input.value = state.query; scope.value = state.scope; sort.value = state.sort;
  const draw = () => {
    state.query = input.value; state.scope = scope.value as TagViewState["scope"]; state.sort = sort.value as TagViewState["sort"];
    const query = input.value.trim();
    const tags = all.filter(t => (!query || fuzzy(query,t.name) || t.subject.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      && (state.scope === "all" || t.is_annotated === (state.scope === "annotated")))
      .sort((a,b) => state.sort === "name" ? a.name.localeCompare(b.name,undefined,{numeric:true}) : b.timestamp-a.timestamp);
    const filtered = !!query || state.scope !== "all";
    wrap.querySelector('.tag-filter-status')!.innerHTML = `<span>${tags.length} von ${all.length} Tags</span>${filtered ? '<button class="mini" data-tag-reset>Filter zurücksetzen</button>' : ''}`;
    list.innerHTML = tags.length ? `<div class="rows">${tags.map(tag => `
      <div class="branch-row tag-row" data-tag-name="${esc(tag.name)}">
        <span class="tag-symbol">${icon("tag",16)}</span>
        <div class="branch-detail"><div class="branch-identity"><span class="bname">${esc(tag.name)}</span>${tag.is_annotated ? '<span class="chip">Annotiert</span>' : ''}</div>
          <div class="branch-meta"><span class="bsub" title="${esc(tag.subject)}">${esc(tag.subject || "Keine Beschreibung")}</span><span class="bdate" title="${esc(absTime(tag.timestamp))}">${esc(tag.short_hash)} · ${esc(relTime(tag.timestamp))}</span></div>
          <span class="small muted">${tag.commit ? esc(tag.author) : "Zeigt auf kein Commit · nur Anzeige möglich"}</span></div>
        <div class="actions"><button class="btn" data-tag-act="commit" ${!tag.commit ? "disabled" : ""}>Commit ansehen</button>
          <button class="btn" data-tag-act="compare" ${!tag.commit || !snap?.head ? "disabled" : ""}>Vergleichen</button>
          <button class="btn tag-new-branch" data-tag-act="branch" ${!tag.commit || blocked ? "disabled" : ""}>${icon("plus",12)} Branch von hier</button></div>
      </div>`).join("")}</div>` : `<div class="empty">${icon("tag",28)}<b>${all.length ? "Keine passenden Tags" : "Noch keine Tags"}</b><span>${all.length ? "Passe Suche oder Filter an." : "In diesem Repository sind noch keine Tags vorhanden. Mit Fetch kannst du Remote-Referenzen aktualisieren."}</span></div>`;
  };
  const changed = () => {state.scrollTop=0;draw();list.scrollTop=0;};
  input.addEventListener('input',changed);scope.addEventListener('change',changed);sort.addEventListener('change',changed);
  list.addEventListener('scroll',()=>{state.scrollTop=list.scrollTop;});
  wrap.addEventListener('click',event=>{
    const target=event.target as HTMLElement;
    if(target.closest('[data-tag-reset]')){input.value='';scope.value='all';changed();input.focus();return;}
    const button=target.closest<HTMLButtonElement>('[data-tag-act]');
    const name=target.closest<HTMLElement>('[data-tag-name]')?.dataset.tagName;
    const tag=all.find(t=>t.name===name);
    if(!button || button.disabled || !tag)return;
    if(button.dataset.tagAct==='commit')ctx.showTagCommit(tag);
    if(button.dataset.tagAct==='compare')ctx.compareTag(tag);
    if(button.dataset.tagAct==='branch')ctx.newFromTag(tag);
  });
  draw();return wrap;
}
