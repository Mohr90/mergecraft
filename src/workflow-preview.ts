import {api, type MergePreview, type RevertPreview, type FileDiff} from './api';
import {t, h, m} from './i18n';
import {showDialog, esc, icon} from './ui';
import {DiffView} from './diff';

/** A focused sheet: inspect first, then explicitly run the checked mutation. */
export function workflowPreview(kind: 'merge', name: string, noFF: boolean): Promise<MergePreview|null>;
export function workflowPreview(kind: 'revert', name: string): Promise<RevertPreview|null>;
export function workflowPreview(kind: 'merge'|'revert', name: string, noFF=false): Promise<MergePreview|RevertPreview|null> {
  return new Promise(resolve=>{
    const view=showDialog(h`<h2 id="dialog-title">${kind==='merge'?t('Merge-Vorschau'):t('Commit zurücknehmen')}</h2>
      <div class="workflow-content" role="status"><p>Analyse läuft …</p></div>
      <div class="actions"><button class="btn" data-cancel>Abbrechen</button><button class="btn primary" data-start disabled>${kind==='merge'?t('Jetzt mergen'):t('Gegen-Commit erstellen')}</button></div>`);
    if(!view)return resolve(null);
    view.dialog.classList.add('workflow-preview');
    let done=false, data:MergePreview|RevertPreview|null=null, diffRequest=0;
    const finish=(result:typeof data)=>{if(done)return;done=true;diffRequest++;if(kind==='merge')void api.cancelMergePreview();view.close();resolve(result);};
    view.dialog.querySelector('[data-cancel]')!.addEventListener('click',()=>finish(null));
    view.dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
    view.dialog.querySelector('[data-start]')!.addEventListener('click',()=>finish(data));
    const content=view.dialog.querySelector<HTMLElement>('.workflow-content')!;
    const load=async()=>{
      try {
        data=kind==='merge'?await api.mergePreview(name):await api.revertPreview(name);
        if(done)return;
        content.removeAttribute("role");
        const merge=kind==='merge'?data as MergePreview:null;
        const revert=kind==='revert'?data as RevertPreview:null;
        const kinds:Record<string,string>={up_to_date:t('Bereits aktuell'),fast_forward:noFF?t('Merge-Commit ohne Textkonflikte möglich'):t('Fast-forward möglich'),clean:t('Keine Textkonflikte gefunden'),conflicts:t('Konflikte erwartet')};
        content.innerHTML=`<div class="workflow-direction">${icon(kind==='merge'?'merge':'undo',22)}<strong>${esc(merge?merge.source+' → '+merge.target:revert!.commit.short_hash+' → '+revert!.target)}</strong></div>
          <p class="detail">${esc(merge?t('Vorschau auf Basis lokaler Commits und zuletzt gefetchter Remote-Stände. Kein Fetch wird ausgeführt.'):t('Erstellt einen neuen Gegen-Commit im aktuellen Branch. Bereits veröffentlichte Historie bleibt erhalten.'))}</p>
          <div class="workflow-summary" role="status"><b>${esc(merge?kinds[merge.kind]:revert!.commit.subject)}</b><span>${merge?m`Eingehende Commits: ${merge.incoming} · Dateien: ${merge.files.length} · Konfliktdateien: ${merge.conflicts.length}`:m`Betroffene Dateien: ${data.files.length}`}</span></div>
          <p class="small muted">${esc(merge?(merge.kind==='conflicts'?t('Die markierten Dateien brauchen nach dem Start deine Entscheidung.'):t('Keine Textkonflikte bedeutet nicht automatisch fachlich korrekten Code.')):t('Gezeigt wird die Umkehrung des ausgewählten Commits. Spätere Änderungen können beim Anwenden Konflikte erzeugen.'))}</p>
          <div class="workflow-files">${data.files.map((f,i)=>`<button class="workflow-file" data-preview-file="${i}"><span class="status">${esc(f.status)}</span><span class="mono">${esc(f.path)}</span><span class="chip">${esc(merge?.conflicts.includes(f.path)?t('Konflikt'):t('Diff ansehen'))}</span></button>`).join('')}</div><div class="workflow-diff"></div>`;
        const start=view.dialog.querySelector<HTMLButtonElement>('[data-start]')!;
        start.disabled=merge?.kind==='up_to_date';
        content.querySelectorAll<HTMLButtonElement>('[data-preview-file]').forEach(button=>button.addEventListener('click',async()=>{
          const request=++diffRequest;
          const file=data!.files[Number(button.dataset.previewFile)];
          const host=content.querySelector<HTMLElement>('.workflow-diff')!;
          host.textContent=t('Vergleich wird geladen …');
          try {
            let diff:FileDiff;
            if(merge) {
              diff=await api.fileDiff(merge.target_oid,merge.tree_oid,file.path,merge.target,t("Merge-Vorschau"));
            } else diff=await api.compareDiff(revert!.commit.hash,revert!.commit.parents[0],file.path);
            if(done||request!==diffRequest)return;
            host.innerHTML=''; const diffView=new DiffView(()=>{diffRequest++;host.replaceChildren();});
            diffView.set(diff,'unified');diffView.mount(host);
          } catch(error){if(!done&&request===diffRequest)host.textContent=String(error);}
        }));
      } catch(error) {
        if(done)return;
        content.innerHTML=`<p class="merge-inline-error" role="alert">${esc(String(error))}</p><button class="btn" data-retry>${t('Erneut prüfen')}</button>`;
        content.querySelector('[data-retry]')!.addEventListener('click',()=>{content.textContent=t('Analyse läuft …');void load();});
      }
    };
    void load();
  });
}
