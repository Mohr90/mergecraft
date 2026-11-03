import type { StatusEntry } from "./api";
import { esc, showDialog } from "./ui";

/** A concrete file preview; committing history and untracked files are outside this action. */
export function chooseRollback(files: StatusEntry[], initial?: string[]): Promise<string[] | null> {
  return new Promise(resolve => {
    const selected = new Set(initial ?? files.map(file => file.path));
    const view = showDialog(`<h2 id="dialog-title">Lokale Änderungen zurückrollen</h2>
      <p class="detail">Die ausgewählten Dateien werden auf den letzten Commit zurückgesetzt, einschließlich Staging. Ihre lokalen Änderungen werden verworfen.</p>
      <p class="detail">Neue, bereits gestagte Dateien werden entfernt. Unversionierte Dateien bleiben erhalten. Commits und Branches werden nicht verändert.</p>
      <div class="rollback-files">${files.map((file,i)=>`<label><input type="checkbox" data-rollback-file="${i}" ${selected.has(file.path) ? 'checked' : ''}><span class="mono">${esc(file.path)}</span><span class="chip">${file.index === 'A' ? 'Neu gestagt' : file.index !== ' ' ? 'Gestagt / geändert' : 'Geändert'}</span></label>`).join('')}</div>
      <div class="rollback-count" role="status"></div>
      <div class="actions"><button class="btn" data-rollback-cancel>Abbrechen</button><button class="btn danger" data-rollback-confirm>Zurücksetzen</button></div>`);
    if(!view)return resolve(null);
    let done=false;
    const finish=(value:string[]|null)=>{if(done)return;done=true;view.close();resolve(value);};
    const update=()=>{
      const count=view.dialog.querySelectorAll<HTMLInputElement>('[data-rollback-file]:checked').length;
      view.dialog.querySelector('.rollback-count')!.textContent=`${count} von ${files.length} Dateien ausgewählt`;
      (view.dialog.querySelector('[data-rollback-confirm]') as HTMLButtonElement).disabled=count===0;
    };
    view.dialog.addEventListener('change',update);
    view.dialog.addEventListener('click',e=>{
      const target=e.target as HTMLElement;
      if(target.closest('[data-rollback-cancel]'))finish(null);
      if(target.closest('[data-rollback-confirm]')){
        const paths=[...view.dialog.querySelectorAll<HTMLInputElement>('[data-rollback-file]:checked')].map(box=>files[Number(box.dataset.rollbackFile)].path);
        if(paths.length)finish(paths);
      }
    });
    view.dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});update();
  });
}
